// Key Vault in RBAC mode (no access policies). The bootstrap principal gets
// Secrets Officer so the deploying user can seed secret values after infra
// is up. The VM's managed identity gets Secrets User in a separate module
// once the VM exists (chicken-and-egg — principalId is a VM output).

param location string
param bootstrapPrincipalObjectId string
param tags object

// KV names are globally unique and capped at 24 chars. Prefix eats 16, so
// truncate the uniqueness hash to 8 to stay in bounds.
var keyVaultName = 'codetutor-ai-kv-${take(uniqueString(subscription().id, resourceGroup().id), 8)}'

resource kv 'Microsoft.KeyVault/vaults@2024-11-01' = {
  name: keyVaultName
  location: location
  tags: tags
  properties: {
    sku: {
      family: 'A'
      name: 'standard'
    }
    tenantId: subscription().tenantId
    enableRbacAuthorization: true
    enableSoftDelete: true
    softDeleteRetentionInDays: 7
    enablePurgeProtection: null
    publicNetworkAccess: 'Enabled'
    networkAcls: {
      defaultAction: 'Allow'
      bypass: 'AzureServices'
    }
  }
}

// "Key Vault Secrets Officer" — built-in role that allows get/list/set/delete
// of secrets. Scoped to this KV only.
var secretsOfficerRoleId = 'b86a8fe4-44ce-4948-aee5-eccb2c155cd7'

resource bootstrapAccess 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  scope: kv
  name: guid(kv.id, bootstrapPrincipalObjectId, secretsOfficerRoleId)
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', secretsOfficerRoleId)
    principalId: bootstrapPrincipalObjectId
    principalType: 'User'
  }
}

output name string = kv.name
output id string = kv.id
output uri string = kv.properties.vaultUri
