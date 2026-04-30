// Phase 24B: grant the VM's system-assigned MI just enough Azure
// permissions to manage ACI container groups for overflow sessions.
//
// We use a CUSTOM role rather than the broad built-in "Contributor"
// because:
//   - Contributor lets the principal create/destroy ANY resource in the
//     RG (the VM itself, KV, ACS, etc). If the backend were compromised,
//     that's an immediate privilege escalation.
//   - The actions we actually need are bounded: read/write/delete
//     container groups + the network-action that lets ACI deploy into
//     the dedicated subnet.
//
// Same deploy-pattern as `vm-kv-access.bicep`: gated behind a
// `manageRoleAssignments` flag that's false by default. The deploy-
// infra workflow's SP only has Contributor (it cannot write
// Microsoft.Authorization/* without RBAC-admin), so this module is
// expected to be a one-time apply by an Owner-level operator. Once
// the role + assignment exist, every subsequent incremental redeploy
// leaves them untouched.

@description('System-assigned MI principal ID of the VM that runs the backend.')
param principalId string

@description('When true, (re)create the custom role + assignment. False during incremental deploys by the contributor-only deploy SP. Must be true on the initial apply by an Owner-level operator.')
param manageRoleAssignments bool = false

// Stable, deterministic role id — derived from the RG name + a fixed
// salt so re-deploys to the same RG hit the same role definition (no
// "role X already exists" errors when the deploy SP isn't allowed to
// write roleDefinitions).
var aciExecutorRoleName = guid(
  resourceGroup().id,
  'codetutor-aci-executor-role'
)

// Custom role: minimum surface for ACI overflow.
//
//   Microsoft.ContainerInstance/containerGroups/* — list, get, create,
//     update, delete the per-session container groups.
//   Microsoft.Network/virtualNetworks/subnets/join/action — required
//     to deploy a container group into a delegated subnet. Without this,
//     beginCreateOrUpdate fails with NetworkProfileLinkPermissionFailed.
//   Microsoft.Network/networkProfiles/* — ACI may auto-create + reuse a
//     network profile when deploying VNet container groups; granting
//     read+write avoids "couldn't find the auto-created profile" failures.
//
// Notably ABSENT: any compute/ KV / storage / DNS actions. A backend
// compromise can spin up + destroy ACI session containers (which can't
// reach Internet thanks to the subnet NSG) but can't touch anything
// else in the RG.
resource aciExecutorRole 'Microsoft.Authorization/roleDefinitions@2022-04-01' = if (manageRoleAssignments) {
  name: aciExecutorRoleName
  properties: {
    roleName: 'Codetutor ACI Executor (${resourceGroup().name})'
    description: 'Phase 24B custom role: ACI container group lifecycle + subnet join. Scoped to a single RG.'
    type: 'CustomRole'
    permissions: [
      {
        actions: [
          'Microsoft.ContainerInstance/containerGroups/read'
          'Microsoft.ContainerInstance/containerGroups/write'
          'Microsoft.ContainerInstance/containerGroups/delete'
          // Operations endpoint lets the SDK poll for "Running" state.
          'Microsoft.ContainerInstance/containerGroups/operations/read'
          'Microsoft.ContainerInstance/locations/operations/read'
          'Microsoft.Network/virtualNetworks/subnets/join/action'
          'Microsoft.Network/networkProfiles/read'
          'Microsoft.Network/networkProfiles/write'
          'Microsoft.Network/networkProfiles/delete'
        ]
        notActions: []
        dataActions: []
        notDataActions: []
      }
    ]
    assignableScopes: [
      resourceGroup().id
    ]
  }
}

// Assignment of the custom role to the VM's MI, scoped to the RG.
// Name is a deterministic guid so re-applies converge.
resource assignment 'Microsoft.Authorization/roleAssignments@2022-04-01' = if (manageRoleAssignments) {
  name: guid(resourceGroup().id, principalId, aciExecutorRoleName)
  properties: {
    roleDefinitionId: aciExecutorRole.id
    principalId: principalId
    principalType: 'ServicePrincipal'
  }
}

// Used by the deploy-infra workflow logs so the operator can verify the
// role landed without portal-clicking. Only meaningful when the conditional
// resources actually got created.
output aciExecutorRoleId string = manageRoleAssignments ? aciExecutorRole.id : ''
output aciExecutorAssignmentId string = manageRoleAssignments ? assignment.id : ''
