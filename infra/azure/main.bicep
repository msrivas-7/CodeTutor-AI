// CodeTutor AI — Azure production infrastructure.
// Single-VM topology: Ubuntu B2s runs the backend stack (docker compose),
// SWA hosts the frontend, Key Vault holds all runtime secrets, Log Analytics
// captures diagnostics, and Azure Monitor alerts email on VM unavailability.
//
// Deploy:
//   az deployment group create \
//     -g codetutor-ai-prod-rg \
//     --template-file main.bicep \
//     --parameters @main.parameters.json \
//     --parameters adminPublicKey="$(cat ~/.ssh/codetutor_ai_vm.pub)" \
//                  sshSourceIp="$(curl -s https://checkip.amazonaws.com)/32"

targetScope = 'resourceGroup'

@description('Azure region for all resources. SWA is region-independent but declared for consistency.')
param location string = resourceGroup().location

@description('VM hostname / DNS label prefix. Full FQDN is <prefix>.<region>.cloudapp.azure.com.')
param vmName string = 'codetutor-ai-vm'

@description('Linux admin username on the VM.')
param adminUsername string = 'codetutor'

@description('SSH public key authorized for the admin user. Required — password auth is disabled.')
@secure()
param adminPublicKey string

@description('CIDR permitted to SSH into the VM (port 22). Keep tight; rotate if the admin laptop IP changes.')
param sshSourceIp string

@description('VM SKU. B2s (2 vCPU / 4 GB) is needed so first-boot docker builds of the backend image do not OOM; runtime-only would fit on B1s.')
param vmSize string = 'Standard_B2s'

@description('OS disk size in GB.')
param osDiskSizeGB int = 32

@description('Email address to receive monitor alerts.')
param alertEmail string = 'msrivas4017@gmail.com'

@description('Object ID of the principal that should have Key Vault Secrets Officer access for bootstrap secret seeding (run `az ad signed-in-user show --query id -o tsv`).')
param bootstrapPrincipalObjectId string

@description('Public git URL the VM clones on first boot. Must not require auth.')
param repoUrl string = 'https://github.com/msrivas-7/CodeTutor-AI.git'

@description('GHCR tag for the backend image. Pre-19c this is the target for local builds; post-19c it is pulled.')
param backendImage string = 'ghcr.io/msrivas-7/codetutor-backend:latest'

@description('GHCR tag for the runner image. Backend spawns session containers from this.')
param runnerImage string = 'ghcr.io/msrivas-7/codetutor-runner:latest'

@description('Custom mail domain for outbound Supabase auth emails. DNS records for this domain are added to the operator-managed DNS provider (Wix, for msrivas.com) after the ACS module deploys — see infra/azure/README.md. Uses a `mail.` subdomain because the apex (`codetutor.msrivas.com`) is already a CNAME to the SWA and DNS forbids TXT records at a CNAME name.')
param mailDomain string = 'mail.codetutor.msrivas.com'

var tags = {
  project: 'codetutor'
  environment: 'prod'
  managedBy: 'bicep'
}

// ---------------------------------------------------------------------------
// Network: VNet + subnet + NSG + Standard Public IP + NIC.
// ---------------------------------------------------------------------------
module network 'modules/network.bicep' = {
  name: 'network'
  params: {
    location: location
    vmName: vmName
    sshSourceIp: sshSourceIp
    tags: tags
  }
}

// ---------------------------------------------------------------------------
// Log Analytics + Azure Monitor action group + VM-unavailable alert.
// Alert uses Resource Health (no agent required) so it fires even if the VM
// is wedged at the host level, not just the OS.
// ---------------------------------------------------------------------------
module monitoring 'modules/monitoring.bicep' = {
  name: 'monitoring'
  params: {
    location: location
    alertEmail: alertEmail
    tags: tags
  }
}

// ---------------------------------------------------------------------------
// Key Vault (RBAC mode). VM's system-assigned MI gets Secrets User at the
// end of this file once the VM exists; the deploying principal gets Secrets
// Officer so `az keyvault secret set` works post-deploy for initial seeding.
// ---------------------------------------------------------------------------
module keyvault 'modules/keyvault.bicep' = {
  name: 'keyvault'
  params: {
    location: location
    bootstrapPrincipalObjectId: bootstrapPrincipalObjectId
    tags: tags
  }
}

// ---------------------------------------------------------------------------
// Static Web App for the frontend. Declared before the VM because the VM's
// cloud-init bakes the SWA hostname into backend CORS_ORIGIN.
// ---------------------------------------------------------------------------
module swa 'modules/swa.bicep' = {
  name: 'swa'
  params: {
    location: 'eastus2'
    name: 'codetutor-ai-swa'
    tags: tags
  }
}

// ---------------------------------------------------------------------------
// VM: Ubuntu 24.04 LTS, system-assigned MI, SSH-only. cloud-init provisions
// Docker + Azure CLI + the compose stack on first boot and hands lifecycle
// to a systemd unit. Template vars (KV name, SWA host, etc.) are substituted
// into cloud-init.yaml before base64-encoding into customData.
// ---------------------------------------------------------------------------
module vm 'modules/vm.bicep' = {
  name: 'vm'
  params: {
    location: location
    vmName: vmName
    vmSize: vmSize
    osDiskSizeGB: osDiskSizeGB
    adminUsername: adminUsername
    adminPublicKey: adminPublicKey
    nicId: network.outputs.nicId
    logAnalyticsWorkspaceId: monitoring.outputs.workspaceId
    tags: tags
    keyVaultName: keyvault.outputs.name
    vmFqdn: network.outputs.fqdn
    swaHostname: swa.outputs.defaultHostname
    repoUrl: repoUrl
    backendImage: backendImage
    runnerImage: runnerImage
    adminEmail: alertEmail
  }
}

// VM Resource Health alert. References vm.outputs.vmId so it is scoped to the
// specific VM, not the whole RG.
module vmHealthAlert 'modules/vm-health-alert.bicep' = {
  name: 'vm-health-alert'
  params: {
    vmId: vm.outputs.vmId
    actionGroupId: monitoring.outputs.actionGroupId
    tags: tags
  }
}

// Guest-level metric/log alerts (memory, CPU, disk, OOM killer). Scheduled
// against the LA workspace — the AMA DCR in vm.bicep forwards the counters
// + syslog, so the data lands there without a separate platform-metrics
// destination.
module alerts 'modules/alerts.bicep' = {
  name: 'alerts'
  params: {
    location: location
    workspaceId: monitoring.outputs.workspaceId
    actionGroupId: monitoring.outputs.actionGroupId
    tags: tags
  }
}

// Grant the VM's managed identity "Key Vault Secrets User" so it can read
// secret values at runtime. `dependsOn` is implicit via vm/keyvault module
// outputs but we scope the role assignment at the KV resource level to
// keep blast radius narrow.
module vmKvAccess 'modules/vm-kv-access.bicep' = {
  name: 'vm-kv-access'
  params: {
    keyVaultName: keyvault.outputs.name
    principalId: vm.outputs.principalId
  }
}

// ---------------------------------------------------------------------------
// Azure Communication Services — Email (Phase 20-P2). Outbound SMTP for
// Supabase Auth (signup verify / password reset / magic link). Replaces
// Supabase's default sandbox mailer (2 emails/hr cap). Custom domain —
// operator adds DNS records at Wix post-deploy; see README.md.
// ---------------------------------------------------------------------------
module acsEmail 'modules/acsEmail.bicep' = {
  name: 'acs-email'
  params: {
    tags: tags
    mailDomain: mailDomain
  }
}

// ---------------------------------------------------------------------------
// Azure Backup (Phase 20-P0 #2): weekly OS-disk snapshot, 4-week retention.
// Vault + policy are declared here; enrolling the VM as a protected item is
// a one-time `az backup protection enable-for-vm` step (see README.md). LRS
// storage, ~$0.50–1/mo for a 32 GB disk.
// ---------------------------------------------------------------------------
module backup 'modules/backup.bicep' = {
  name: 'backup'
  params: {
    location: location
    tags: tags
  }
}

output vmFqdn string = network.outputs.fqdn
output vmPublicIp string = network.outputs.publicIp
output keyVaultName string = keyvault.outputs.name
output swaHostname string = swa.outputs.defaultHostname
output swaName string = swa.outputs.name
output logAnalyticsWorkspaceName string = monitoring.outputs.workspaceName
output backupVaultName string = backup.outputs.vaultName
output backupPolicyName string = backup.outputs.policyName
output acsCommunicationServiceName string = acsEmail.outputs.communicationServiceName
output acsEmailServiceName string = acsEmail.outputs.emailServiceName
output mailDomainName string = acsEmail.outputs.mailDomainName
output mailFrom string = acsEmail.outputs.mailFrom
