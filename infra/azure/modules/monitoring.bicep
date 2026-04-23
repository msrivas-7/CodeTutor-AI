// Log Analytics workspace (PerGB2018 — first 5 GB/mo free) + Azure Monitor
// action group routing alerts to the admin email. The action group is
// referenced by the VM Resource Health alert in main.bicep.

param location string
param alertEmail string
param tags object

@description('Monthly budget ceiling in USD for the resource group. When actual or forecast spend crosses 80/100% thresholds, alertEmail is notified. Default 30 keeps an always-on B2s + LA + SWA + KV + ACS floor (~$15-20/mo) with ~50% headroom before paging.')
param monthlyBudgetUsd int = 30

var workspaceName = 'codetutor-ai-la'
var actionGroupName = 'codetutor-ai-ag'

resource workspace 'Microsoft.OperationalInsights/workspaces@2023-09-01' = {
  name: workspaceName
  location: location
  tags: tags
  properties: {
    sku: { name: 'PerGB2018' }
    retentionInDays: 30
    // S-8 (bucket 6): cap daily ingest at 1 GB. Without this, a runaway log
    // loop can blow through the free 5 GB/mo in a single bad day and start
    // billing at $2.30/GB. At steady-state we ingest <100 MB/day (Perf +
    // Syslog + a trickle of ContainerLog), so 1 GB is ~10x headroom. When
    // the cap trips, new data is dropped until 00:00 UTC — we'd rather lose
    // a noisy day's logs than get a surprise bill.
    workspaceCapping: {
      dailyQuotaGb: 1
    }
    features: {
      // Disable unused capabilities to keep the bill predictable.
      enableLogAccessUsingOnlyResourcePermissions: true
    }
  }
}

// S-18 / platform-cost anomaly (bucket 6): custom table for Docker stdout
// ingested by the DCR. ARM will not let a DCR target a Custom-* stream
// unless the matching *_CL table exists first, and our alert KQL
// references it by name so it must be created before the alerts module.
// Schema mirrors the streamDeclarations in vm.bicep.
resource containerLogTable 'Microsoft.OperationalInsights/workspaces/tables@2023-09-01' = {
  parent: workspace
  name: 'ContainerLog_CL'
  properties: {
    plan: 'Analytics'
    retentionInDays: 30
    schema: {
      name: 'ContainerLog_CL'
      columns: [
        { name: 'TimeGenerated', type: 'datetime' }
        { name: 'LogEntry',      type: 'string' }
        { name: 'FilePath',      type: 'string' }
        { name: 'Computer',      type: 'string' }
      ]
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

// S-8 (bucket 6): resource-group-scoped consumption budget. Fires at 80% of
// actual spend (warning, still recoverable) and 100% of forecast (we expect
// to overshoot this month at current burn). Both route to the existing
// action group so they land in the same inbox as platform health alerts.
// Budget resources are scoped via `scope: resourceGroup()` and their name
// must be unique within that scope.
resource monthlyBudget 'Microsoft.Consumption/budgets@2023-05-01' = {
  name: 'codetutor-ai-rg-monthly'
  properties: {
    category: 'Cost'
    amount: monthlyBudgetUsd
    timeGrain: 'Monthly'
    timePeriod: {
      // Azure requires a startDate aligned to month start and NOT prior to
      // the current month. Pinning to the first-deploy month keeps the
      // budget stable across re-deploys; if the resource is ever recreated
      // in a future month, bump this to that month (old-history rows stay
      // readable via Cost Management, they just aren't attached to the
      // renamed budget).
      startDate: '2026-04-01'
    }
    notifications: {
      actual80: {
        enabled: true
        operator: 'GreaterThan'
        threshold: 80
        thresholdType: 'Actual'
        contactEmails: [ alertEmail ]
        contactGroups: [ actionGroup.id ]
      }
      forecast100: {
        enabled: true
        operator: 'GreaterThan'
        threshold: 100
        thresholdType: 'Forecasted'
        contactEmails: [ alertEmail ]
        contactGroups: [ actionGroup.id ]
      }
    }
  }
}

// S-6/S-7 (bucket 6): workspace-based Application Insights. Required for
// availability (uptime) web tests against /api/health/deep and the SWA
// root. Workspace-based mode routes AI data into the existing LA workspace,
// so we don't get a second billing surface — availability telemetry lands
// in `AppAvailabilityResults` and scheduled-query alerts can read it from
// LA directly. ~$0 at this volume (two tests × 12 probes/hour × 30 days =
// ~17k transactions/mo, well under the 1 GB/mo free tier).
resource appInsights 'Microsoft.Insights/components@2020-02-02' = {
  name: 'codetutor-ai-ai'
  location: location
  tags: tags
  kind: 'web'
  properties: {
    Application_Type: 'web'
    WorkspaceResourceId: workspace.id
    IngestionMode: 'LogAnalytics'
    publicNetworkAccessForIngestion: 'Enabled'
    publicNetworkAccessForQuery: 'Enabled'
  }
}

output workspaceId string = workspace.id
output workspaceName string = workspace.name
output actionGroupId string = actionGroup.id
output appInsightsId string = appInsights.id
output appInsightsName string = appInsights.name
// Surfaced so dependent modules (alerts, vm/DCR) can take a module-level
// dependency and deploy only after the custom table exists.
output containerLogTableId string = containerLogTable.id
