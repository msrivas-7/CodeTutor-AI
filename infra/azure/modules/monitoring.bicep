// Log Analytics workspace (PerGB2018 — first 5 GB/mo free) + Azure Monitor
// action group routing alerts to the admin email. The action group is
// referenced by the VM Resource Health alert in main.bicep.

param location string
param alertEmail string
param tags object

var workspaceName = 'codetutor-ai-la'
var actionGroupName = 'codetutor-ai-ag'

resource workspace 'Microsoft.OperationalInsights/workspaces@2023-09-01' = {
  name: workspaceName
  location: location
  tags: tags
  properties: {
    sku: { name: 'PerGB2018' }
    retentionInDays: 30
    features: {
      // Disable unused capabilities to keep the bill predictable.
      enableLogAccessUsingOnlyResourcePermissions: true
    }
  }
}

// Action groups must be deployed to 'global' location. The 'global' string
// is accepted by the control plane even though it's not a real region.
resource actionGroup 'Microsoft.Insights/actionGroups@2023-09-01-preview' = {
  name: actionGroupName
  location: 'global'
  tags: tags
  properties: {
    groupShortName: 'ctai'
    enabled: true
    emailReceivers: [
      {
        name: 'admin-email'
        emailAddress: alertEmail
        useCommonAlertSchema: true
      }
    ]
  }
}

output workspaceId string = workspace.id
output workspaceName string = workspace.name
output actionGroupId string = actionGroup.id
