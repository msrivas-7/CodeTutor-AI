// CodeTutor AI — Azure production infrastructure.
// Single-VM topology: Ubuntu B1s runs the backend stack (docker compose),
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

@description('VM SKU. B1s fits on VS Enterprise monthly credits and handles 3-5 concurrent sessions.')
param vmSize string = 'Standard_B1s'

@description('OS disk size in GB.')
param osDiskSizeGB int = 32

@description('Email address to receive monitor alerts.')
param alertEmail string = 'msrivas4017@gmail.com'

@description('Object ID of the principal that should have Key Vault Secrets Officer access for bootstrap secret seeding (run `az ad signed-in-user show --query id -o tsv`).')
param bootstrapPrincipalObjectId string

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
// VM: Ubuntu 24.04 LTS, system-assigned MI, SSH-only, cloud-init injected
// in 19b. For 19a we deploy with an empty custom data so the VM boots bare
// and can be iterated on without reprovisioning.
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
// Static Web App for the frontend. Created unlinked; connect to the GitHub
// repo via the SWA GitHub App after deploy (that flow auto-generates the
// workflow file). Free SKU — no bandwidth charges under 100 GB/mo.
// ---------------------------------------------------------------------------
module swa 'modules/swa.bicep' = {
  name: 'swa'
  params: {
    location: 'eastus2'
    name: 'codetutor-ai-swa'
    tags: tags
  }
}

output vmFqdn string = network.outputs.fqdn
output vmPublicIp string = network.outputs.publicIp
output keyVaultName string = keyvault.outputs.name
output swaHostname string = swa.outputs.defaultHostname
output swaName string = swa.outputs.name
output logAnalyticsWorkspaceName string = monitoring.outputs.workspaceName
