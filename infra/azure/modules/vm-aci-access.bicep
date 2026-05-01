// Phase 24B: grant the VM's system-assigned MI just enough Azure
// permissions to manage ACI container groups for overflow sessions.
//
// We use CUSTOM roles rather than the broad built-in "Contributor"
// because:
//   - Contributor lets the principal create/destroy ANY resource in the
//     RG (the VM itself, KV, ACS, etc). If the backend were compromised,
//     that's an immediate privilege escalation.
//   - The actions we actually need are bounded: read/write/delete
//     container groups + the network-action that lets ACI deploy into
//     the dedicated subnet.
//
// P1-5 (audit fix): split into TWO roles + TWO assignments so each
// permission is at its narrowest scope.
//
//   1. Codetutor ACI Executor — RG-scoped. Container-group lifecycle
//      + read/write on networkProfiles (ACI auto-creates a profile per
//      subnet+location pair on first deploy). Networkprofiles/delete
//      DROPPED — the backend never deletes profiles, only ARM does on
//      RG teardown. If the audit's "tighten to read-only" turns out to
//      work in practice (i.e. the operator pre-creates the profile),
//      `write` can be dropped too in a future PR.
//
//   2. Codetutor ACI Subnet Joiner — SUBNET-scoped. Just the single
//      subnets/join/action so the MI can attach a container group's NIC
//      to the ACI subnet specifically. Pre-fix this was assigned at the
//      RG, meaning the MI could join the VM subnet too — letting a
//      compromised backend spawn an ACI container into the same subnet
//      as the VM, defeating the network isolation between the two.
//
// Same deploy-pattern as `vm-kv-access.bicep`: gated behind a
// `manageRoleAssignments` flag that's false by default. The deploy-
// infra workflow's SP only has Contributor (it cannot write
// Microsoft.Authorization/* without RBAC-admin), so this module is
// expected to be a one-time apply by an Owner-level operator. Once
// the role + assignments exist, every subsequent incremental redeploy
// leaves them untouched.

@description('System-assigned MI principal ID of the VM that runs the backend.')
param principalId string

@description('When true, (re)create the custom roles + assignments. False during incremental deploys by the contributor-only deploy SP. Must be true on the initial apply by an Owner-level operator.')
param manageRoleAssignments bool = false

@description('P1-5: full ARM resource ID of the ACI subnet. The subnet-scoped join role assignment lands HERE, not at the RG, so the MI can join only this subnet (not the VM subnet).')
param aciSubnetId string

// Stable, deterministic role ids — derived from the RG name + a fixed
// salt so re-deploys to the same RG hit the same role definitions (no
// "role X already exists" errors when the deploy SP isn't allowed to
// write roleDefinitions).
var aciExecutorRoleName = guid(
  resourceGroup().id,
  'codetutor-aci-executor-role'
)
var aciSubnetJoinerRoleName = guid(
  resourceGroup().id,
  'codetutor-aci-subnet-joiner-role'
)

// ── Role 1: ACI Executor (RG-scoped) ──────────────────────────────
//
// Container-group lifecycle + the networkProfiles read/write that ACI
// implicitly requires to auto-create + reuse a profile per
// {subnet, location} pair.
//
// Notably ABSENT: any compute / KV / storage / DNS actions. A backend
// compromise can spin up + destroy ACI session containers but can't
// touch anything else in the RG.
resource aciExecutorRole 'Microsoft.Authorization/roleDefinitions@2022-04-01' = if (manageRoleAssignments) {
  name: aciExecutorRoleName
  properties: {
    roleName: 'Codetutor ACI Executor (${resourceGroup().name})'
    description: 'Phase 24B custom role: ACI container-group lifecycle + networkProfiles. Scoped to a single RG.'
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
          // P1-5: read+write only (no delete). ACI auto-creates a profile
          // per {subnet, location} on first deploy and reuses it after.
          // We never delete profiles ourselves; ARM tears them down on
          // RG cleanup if needed.
          'Microsoft.Network/networkProfiles/read'
          'Microsoft.Network/networkProfiles/write'
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

resource executorAssignment 'Microsoft.Authorization/roleAssignments@2022-04-01' = if (manageRoleAssignments) {
  name: guid(resourceGroup().id, principalId, aciExecutorRoleName)
  properties: {
    roleDefinitionId: aciExecutorRole.id
    principalId: principalId
    principalType: 'ServicePrincipal'
  }
}

// ── Role 2: ACI Subnet Joiner (SUBNET-scoped) ─────────────────────
//
// Single action: subnets/join/action. Pre-fix this was bundled into the
// RG-scoped role above, which meant the MI could join the VM subnet
// too — a compromised backend could place an ACI container into the
// same subnet as the VM, breaking the C2 isolation guarantee.
//
// assignableScopes lists the subnet AND the RG so the role can be
// assigned at either. The actual assignment below targets the subnet,
// which means at evaluation time the MI gets this action ONLY when
// operating against that subnet. Any attempt to join a different
// subnet returns 403.
resource aciSubnetJoinerRole 'Microsoft.Authorization/roleDefinitions@2022-04-01' = if (manageRoleAssignments) {
  name: aciSubnetJoinerRoleName
  properties: {
    roleName: 'Codetutor ACI Subnet Joiner (${resourceGroup().name})'
    description: 'Phase 24B P1-5 custom role: ONLY subnets/join/action, intended to be assigned at a single subnet, not RG-wide.'
    type: 'CustomRole'
    permissions: [
      {
        actions: [
          'Microsoft.Network/virtualNetworks/subnets/join/action'
        ]
        notActions: []
        dataActions: []
        notDataActions: []
      }
    ]
    assignableScopes: [
      // RG must appear here so the operator's az role create succeeds.
      // The assignment itself targets the subnet ID below.
      resourceGroup().id
    ]
  }
}

// Subnet-scoped assignment. `scope` here is the only way to nail this
// down to a sub-resource of the subnet's parent vnet — `existing` lookup
// + `scope:` on the assignment.
resource aciSubnet 'Microsoft.Network/virtualNetworks/subnets@2024-05-01' existing = {
  // Parse the subnet ID into vnet + subnet name. Format:
  //   /subscriptions/<sub>/resourceGroups/<rg>/providers/Microsoft.Network/virtualNetworks/<vnet>/subnets/<subnet>
  // last() splits on '/' and takes the last segment.
  name: '${last(split(split(aciSubnetId, '/subnets/')[0], '/'))}/${last(split(aciSubnetId, '/'))}'
}

resource subnetJoinerAssignment 'Microsoft.Authorization/roleAssignments@2022-04-01' = if (manageRoleAssignments) {
  scope: aciSubnet
  name: guid(aciSubnetId, principalId, aciSubnetJoinerRoleName)
  properties: {
    roleDefinitionId: aciSubnetJoinerRole.id
    principalId: principalId
    principalType: 'ServicePrincipal'
  }
}

// Used by the deploy-infra workflow logs so the operator can verify the
// roles + assignments landed without portal-clicking. Only meaningful
// when the conditional resources actually got created.
output aciExecutorRoleId string = manageRoleAssignments ? aciExecutorRole.id : ''
output aciExecutorAssignmentId string = manageRoleAssignments ? executorAssignment.id : ''
output aciSubnetJoinerRoleId string = manageRoleAssignments ? aciSubnetJoinerRole.id : ''
output aciSubnetJoinerAssignmentId string = manageRoleAssignments ? subnetJoinerAssignment.id : ''
