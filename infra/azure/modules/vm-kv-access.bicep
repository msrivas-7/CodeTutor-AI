// Grant a principal "Key Vault Secrets User" on a single KV. Split into its
// own module so we can scope the role assignment at the KV resource without
// creating a circular dependency in main.bicep.

param keyVaultName string
param principalId string

resource kv 'Microsoft.KeyVault/vaults@2024-11-01' existing = {
  name: keyVaultName
}

// Built-in role: Key Vault Secrets User (get + list secrets only).
var secretsUserRoleId = '4633458b-17de-408a-b874-0445c86b69e6'

resource assignment 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  scope: kv
  name: guid(kv.id, principalId, secretsUserRoleId)
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', secretsUserRoleId)
    principalId: principalId
    principalType: 'ServicePrincipal'
  }
}
