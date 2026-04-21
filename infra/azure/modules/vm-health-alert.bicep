// Resource Health alert on the VM. Fires when the platform reports the VM
// Unavailable or Degraded — covers host-level wedges that wouldn't surface
// through the in-guest agent. Routes to the shared action group.

param vmId string
param actionGroupId string
param tags object

resource alert 'Microsoft.Insights/activityLogAlerts@2020-10-01' = {
  name: 'codetutor-vm-unavailable'
  location: 'global'
  tags: tags
  properties: {
    enabled: true
    scopes: [ vmId ]
    condition: {
      allOf: [
        {
          field: 'category'
          equals: 'ResourceHealth'
        }
        {
          anyOf: [
            {
              field: 'properties.currentHealthStatus'
              equals: 'Unavailable'
            }
            {
              field: 'properties.currentHealthStatus'
              equals: 'Degraded'
            }
          ]
        }
      ]
    }
    actions: {
      actionGroups: [
        { actionGroupId: actionGroupId }
      ]
    }
  }
}
