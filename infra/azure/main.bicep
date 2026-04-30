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
param vmSize string = 'Standard_B2ms'

// Phase 22A: bumped B2s → B2ms (2 vCPU, 8 GB RAM) for launch-tier
// memory headroom. B2s's 4 GB couldn't safely support MAX_SESSIONS_GLOBAL=20
// × 512 MB runner containers. ~$30 → ~$60/mo.
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

@description('Set true ONLY on initial VM creation (or intentional recreate). Gates VM `customData` — Azure rejects any deployment that sends customData against a running VM, so idempotent redeploys must default to false.')
param newVm bool = false

@description('Set true ONLY on initial provisioning (or when reseating role assignments). Gates the KV-scoped role assignments (vmKvAccess + bootstrapAccess) so the deploy-infra workflow SP — which only has Contributor and cannot write Microsoft.Authorization/roleAssignments — does not fail incremental deploys. Role assignments are set-once and stay valid across redeploys.')
param manageRoleAssignments bool = false

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
    manageRoleAssignments: manageRoleAssignments
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
    newVm: newVm
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

// Guest-level metric/log alerts (memory, CPU, disk, OOM killer) + ACS Email
// delivery-failed alert. The guest-level rules run scheduled queries against
// the LA workspace — the AMA DCR in vm.bicep forwards the counters + syslog,
// so the data lands there without a separate platform-metrics destination.
// The ACS rule is a platform metric alert on the CS resource; the CS id flows
// in from the acsEmail module below.
module alerts 'modules/alerts.bicep' = {
  name: 'alerts'
  params: {
    location: location
    workspaceId: monitoring.outputs.workspaceId
    actionGroupId: monitoring.outputs.actionGroupId
    tags: tags
    communicationServiceId: acsEmail.outputs.communicationServiceId
    appInsightsId: monitoring.outputs.appInsightsId
    healthEndpoint: 'https://${network.outputs.fqdn}/api/health/deep'
    swaEndpoint: 'https://${swa.outputs.defaultHostname}/'
    // P0-5a: ACI NSG resource ID for the NSG-drift Activity Log alert.
    aciNsgId: network.outputs.aciNsgId
  }
}

// Phase 22A: native Cost Management Budget for infra-side spend.
// Application-side $ alerts (backend's budgetWatcher) only see what
// our backend tracks. The Budget here catches runaway Azure resource
// spend (Monitor, Storage, VM resize, etc.) that the backend wouldn't
// otherwise see. Fires the same action group → email at 50/80/100%.
//
// P2-6 (audit fix): cap raised $80 → $400/month. Pre-fix the $80 cap
// collided with the ACI overflow envelope: at the configured daily $20
// cap × 30 days = $600 of legitimate ACI spend, the budget's 50/80/100%
// thresholds would all fire on a busy month — making the budget alert
// indistinguishable from a runaway-spend signal. New cap of $400/mo
// covers:
//   - VM (B2ms) ~$60
//   - Azure Monitor + LA ~$5
//   - Storage / Network ~$2
//   - ACI overflow envelope: 30 days × $20 daily-cap = $600 ceiling,
//     but realistic spend is ~10% of cap → ~$60-$100 expected
//   - Headroom for unexpected (~$100-$200)
// Operator who sees this fire knows it's because of an UNUSUAL cost
// pattern (not just overflow being used heavily on launch day).
module budget 'modules/budget.bicep' = {
  name: 'budget'
  params: {
    actionGroupId: monitoring.outputs.actionGroupId
    operatorEmail: alertEmail
    monthlyCapUsd: 400
    startDate: '2026-05-01'
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
    manageRoleAssignments: manageRoleAssignments
  }
}

// Phase 24B: grant the VM's MI a custom "ACI Executor" role on this RG
// so the backend can spawn / monitor / destroy the per-session container
// groups for the ACI hybrid burst overflow. Same `manageRoleAssignments`
// gate as vm-kv-access — Owner-level operator on first apply, deploy
// SP just sees no-ops on subsequent runs.
module vmAciAccess 'modules/vm-aci-access.bicep' = {
  name: 'vm-aci-access'
  params: {
    principalId: vm.outputs.principalId
    manageRoleAssignments: manageRoleAssignments
    // P1-5: subnet-scoped assignment for the join action so a compromised
    // backend can't attach an ACI container to the VM subnet.
    aciSubnetId: network.outputs.aciSubnetId
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
    // Domain DNS verification has landed in prod (DKIM/Domain/SPF all
    // green), so step 3 of the two-phase flow described in
    // modules/acsEmail.bicep applies: link the verified domain to the
    // Communication Service so SMTP send actually works. Without this,
    // every Bicep redeploy strips `linkedDomains` and Supabase Auth
    // stops sending verification / magic-link / password-reset email.
    // For brand-new environments where DNS isn't verified yet, drop
    // this back to the default (false) on the first deploy and re-run
    // with true after `az communication email domain initiate-verification`.
    linkDomain: true
  }
}

// Azure Backup note: the Recovery Services Vault + policy + VM enrollment
// were created out-of-band (portal/CLI) and stay that way. The old
// `modules/backup.bicep` still exists on disk but is no longer invoked —
// its RSV declaration throws `Parameter NO_PARAM in request is invalid`
// during incremental deploys, and there's no product value in IaC-managing
// a one-off vault whose enrollment step (`az backup protection enable-for-vm`)
// is imperative anyway.

output vmFqdn string = network.outputs.fqdn
output vmPublicIp string = network.outputs.publicIp
// Phase 24B: ACI subnet for the hybrid burst overflow. Operator seeds
// this into Key Vault as ACI-SUBNET-ID; refresh-env materializes it as
// ACI_SUBNET_ID on the VM, where AciExecutionBackend reads it. See
// infra/azure/README.md for the post-deploy seeding step.
output aciSubnetId string = network.outputs.aciSubnetId
output aciSubnetName string = network.outputs.aciSubnetName
output keyVaultName string = keyvault.outputs.name
output swaHostname string = swa.outputs.defaultHostname
output swaName string = swa.outputs.name
output logAnalyticsWorkspaceName string = monitoring.outputs.workspaceName
output acsCommunicationServiceName string = acsEmail.outputs.communicationServiceName
output acsEmailServiceName string = acsEmail.outputs.emailServiceName
output mailDomainName string = acsEmail.outputs.mailDomainName
output mailFrom string = acsEmail.outputs.mailFrom
