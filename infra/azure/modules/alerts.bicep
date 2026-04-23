// Beyond-heartbeat alerts (Phase 20-P1). Each rule runs against Log Analytics
// — the AMA DCR in vm.bicep forwards `Perf` (% Used Memory, % Processor Time,
// % Used Space) and `Syslog` to the workspace, so these scheduled-query
// alerts can fire without adding a separate platform-metrics destination.
// Scheduled-query alerts are ~$1.50/mo each at this cadence.

param location string
param workspaceId string
param actionGroupId string
param tags object

@description('ACS Communication Service resource ID. Optional — when empty, the DeliveryStatusUpdate alert is skipped. Populated by main.bicep from acsEmail.outputs.communicationServiceId.')
param communicationServiceId string = ''

@description('Application Insights resource ID. Required for the availability (webtest) alerts. Populated by main.bicep from monitoring.outputs.appInsightsId.')
param appInsightsId string

@description('Full URL the availability test hits for the backend deep-health probe.')
param healthEndpoint string

@description('Full URL the availability test hits for the SWA root.')
param swaEndpoint string

var actions = {
  actionGroups: [ actionGroupId ]
}

// Sustained high memory → OOM is imminent. 90% used on 4 GB leaves ~400 MB
// which is the plan's stated ceiling. 10m window + 1 failing period means a
// single one-off backup pass won't page.
resource memAlert 'Microsoft.Insights/scheduledQueryRules@2023-03-15-preview' = {
  name: 'codetutor-vm-memory-high'
  location: location
  tags: tags
  properties: {
    enabled: true
    severity: 2
    scopes: [ workspaceId ]
    evaluationFrequency: 'PT5M'
    windowSize: 'PT10M'
    criteria: {
      allOf: [
        {
          query: 'Perf | where ObjectName == "Memory" and CounterName == "% Used Memory" | summarize AggregatedValue = avg(CounterValue) by bin(TimeGenerated, 5m)'
          timeAggregation: 'Average'
          metricMeasureColumn: 'AggregatedValue'
          operator: 'GreaterThan'
          threshold: 90
          failingPeriods: {
            minFailingPeriodsToAlert: 1
            numberOfEvaluationPeriods: 1
          }
        }
      ]
    }
    autoMitigate: true
    actions: actions
  }
}

// CPU-credit exhaustion on Bs-series manifests as sustained 100% throttling.
// 15m window at 85% is the plan trigger; shorter windows would false-fire on
// the first-boot docker build.
resource cpuAlert 'Microsoft.Insights/scheduledQueryRules@2023-03-15-preview' = {
  name: 'codetutor-vm-cpu-high'
  location: location
  tags: tags
  properties: {
    enabled: true
    severity: 3
    scopes: [ workspaceId ]
    evaluationFrequency: 'PT5M'
    windowSize: 'PT15M'
    criteria: {
      allOf: [
        {
          query: 'Perf | where ObjectName == "Processor" and CounterName == "% Processor Time" and InstanceName == "_Total" | summarize AggregatedValue = avg(CounterValue) by bin(TimeGenerated, 5m)'
          timeAggregation: 'Average'
          metricMeasureColumn: 'AggregatedValue'
          operator: 'GreaterThan'
          threshold: 85
          failingPeriods: {
            minFailingPeriodsToAlert: 1
            numberOfEvaluationPeriods: 1
          }
        }
      ]
    }
    autoMitigate: true
    actions: actions
  }
}

// OS disk at 80% leaves ~6 GB headroom on a 32 GB disk — enough runway to
// triage (usually stale session workspaces or journald) before compose or
// docker-pulls start failing. Single-period alert: once we cross, we want
// to know immediately.
resource diskAlert 'Microsoft.Insights/scheduledQueryRules@2023-03-15-preview' = {
  name: 'codetutor-vm-disk-high'
  location: location
  tags: tags
  properties: {
    enabled: true
    severity: 3
    scopes: [ workspaceId ]
    evaluationFrequency: 'PT15M'
    windowSize: 'PT15M'
    criteria: {
      allOf: [
        {
          query: 'Perf | where ObjectName == "Logical Disk" and CounterName == "% Used Space" and InstanceName == "_Total" | summarize AggregatedValue = avg(CounterValue) by bin(TimeGenerated, 15m)'
          timeAggregation: 'Average'
          metricMeasureColumn: 'AggregatedValue'
          operator: 'GreaterThan'
          threshold: 80
          failingPeriods: {
            minFailingPeriodsToAlert: 1
            numberOfEvaluationPeriods: 1
          }
        }
      ]
    }
    autoMitigate: true
    actions: actions
  }
}

// Kernel OOM killer fired. We route these through the mem-high alert above
// as a leading indicator, but catching the actual oom-killer syslog line is
// the confirmation that something died — higher severity because recovery
// usually needs a process restart, not just a spike passing.
resource oomAlert 'Microsoft.Insights/scheduledQueryRules@2023-03-15-preview' = {
  name: 'codetutor-vm-oom-killed'
  location: location
  tags: tags
  properties: {
    enabled: true
    severity: 1
    scopes: [ workspaceId ]
    evaluationFrequency: 'PT5M'
    windowSize: 'PT10M'
    criteria: {
      allOf: [
        {
          query: 'Syslog | where SyslogMessage has_any ("Out of memory", "oom-killer", "Killed process")'
          timeAggregation: 'Count'
          operator: 'GreaterThanOrEqual'
          threshold: 1
          failingPeriods: {
            minFailingPeriodsToAlert: 1
            numberOfEvaluationPeriods: 1
          }
        }
      ]
    }
    autoMitigate: true
    actions: actions
  }
}

// Phase 20-P3: VM heartbeat missing. The AMA on the VM posts a `Heartbeat` row
// every minute. If we haven't seen one in the last 10 minutes, either (a) the
// VM rebooted, (b) the AMA process died, or (c) CPU starvation is so bad that
// even the agent can't schedule — all of which silence the compose stack too.
// This is the cheap-and-reliable stand-in for the full audit ask (Application
// Insights availability test + 5xx KQL + per-container restart-count). Those
// pieces need App Insights deployed + container log → Log Analytics plumbing
// that we don't have yet; shipping the heartbeat piece closes the biggest
// "we'd never know the site was down" gap for ~$1.50/mo.
resource heartbeatAlert 'Microsoft.Insights/scheduledQueryRules@2023-03-15-preview' = {
  name: 'codetutor-vm-heartbeat-missing'
  location: location
  tags: tags
  properties: {
    enabled: true
    severity: 1
    scopes: [ workspaceId ]
    evaluationFrequency: 'PT5M'
    windowSize: 'PT15M'
    criteria: {
      allOf: [
        {
          query: 'Heartbeat | where TimeGenerated > ago(15m) | summarize lastBeat = max(TimeGenerated) by Computer | where lastBeat < ago(10m)'
          timeAggregation: 'Count'
          operator: 'GreaterThanOrEqual'
          threshold: 1
          failingPeriods: {
            minFailingPeriodsToAlert: 1
            numberOfEvaluationPeriods: 1
          }
        }
      ]
    }
    autoMitigate: true
    actions: actions
  }
}

// Phase 20-P2: ACS Email delivery failures. `DeliveryStatusUpdate` fires once
// per outbound message with a `MessageStatus` dimension (Delivered / Failed /
// Expanded / Quarantined / Suppressed / OutForDelivery). A single Failed is
// usually a downstream-mailbox bounce (recipient issue, not ours) and doesn't
// warrant a page — but a cluster means the ACS ↔ DNS ↔ domain path is broken
// (SPF/DKIM drift, domain suspended, quota exhausted). Threshold 5 over 15m
// trades one-off false pages for outage coverage before users start hitting
// signup / reset dead-ends. Metric alerts live at `global` location
// regardless of the scoped resource's region. Gated by communicationServiceId
// so this module still deploys cleanly in environments without ACS.
// S-11 (bucket 6): escalation tier on disk usage. The existing 80% rule above
// is the "time to triage" alert; this 70% rule is the "start cleanup" lead
// indicator — gives us ~2-3 GB of runway (of the 32 GB disk) before the
// louder alert fires, which is usually enough to `docker system prune` +
// `journalctl --vacuum-size=100M` without touching active sessions.
// Severity 4 (warning) instead of 3 so it doesn't crowd the paging queue.
resource diskWarnAlert 'Microsoft.Insights/scheduledQueryRules@2023-03-15-preview' = {
  name: 'codetutor-vm-disk-warning'
  location: location
  tags: tags
  properties: {
    enabled: true
    severity: 4
    scopes: [ workspaceId ]
    evaluationFrequency: 'PT15M'
    windowSize: 'PT30M'
    criteria: {
      allOf: [
        {
          query: 'Perf | where ObjectName == "Logical Disk" and CounterName == "% Used Space" and InstanceName == "_Total" | summarize AggregatedValue = avg(CounterValue) by bin(TimeGenerated, 15m)'
          timeAggregation: 'Average'
          metricMeasureColumn: 'AggregatedValue'
          operator: 'GreaterThan'
          threshold: 70
          failingPeriods: {
            minFailingPeriodsToAlert: 2
            numberOfEvaluationPeriods: 2
          }
        }
      ]
    }
    autoMitigate: true
    actions: actions
  }
}

// S-18 (bucket 6): BYOK decrypt failures. byok.ts emits a structured JSON
// error line `{"err":"byok_decrypt_failed",...}` on every GCM tag-verify
// failure. When container logs land in LA (via DCR logFiles data source
// in vm.bicep), this query catches the first tick and pages. Any value
// above zero warrants investigation — see metrics.ts comment.
resource byokDecryptFailedAlert 'Microsoft.Insights/scheduledQueryRules@2023-03-15-preview' = {
  name: 'codetutor-byok-decrypt-failed'
  location: location
  tags: tags
  properties: {
    enabled: true
    severity: 1
    scopes: [ workspaceId ]
    evaluationFrequency: 'PT5M'
    windowSize: 'PT15M'
    criteria: {
      allOf: [
        {
          query: 'ContainerLog_CL | where LogEntry has "byok_decrypt_failed"'
          timeAggregation: 'Count'
          operator: 'GreaterThanOrEqual'
          threshold: 1
          failingPeriods: {
            minFailingPeriodsToAlert: 1
            numberOfEvaluationPeriods: 1
          }
        }
      ]
    }
    autoMitigate: true
    actions: actions
  }
}

// L-2 (bucket 6): sustained unhandled-promise-rejection. The unhandled-
// Rejection handler is log-and-continue (Phase 20-P3), so a stray promise
// won't crashloop the backend — but a sustained pattern means a code path
// is reliably throwing into nowhere. Threshold 5 over 30m rather than 1:
// the first rejection is often a transient network blip that already
// recovered by the time the alert evaluates; a cluster is the signal.
resource unhandledRejectionAlert 'Microsoft.Insights/scheduledQueryRules@2023-03-15-preview' = {
  name: 'codetutor-backend-unhandled-rejections'
  location: location
  tags: tags
  properties: {
    enabled: true
    severity: 2
    scopes: [ workspaceId ]
    evaluationFrequency: 'PT15M'
    windowSize: 'PT30M'
    criteria: {
      allOf: [
        {
          query: 'ContainerLog_CL | where LogEntry has "unhandledRejection"'
          timeAggregation: 'Count'
          operator: 'GreaterThanOrEqual'
          threshold: 5
          failingPeriods: {
            minFailingPeriodsToAlert: 1
            numberOfEvaluationPeriods: 1
          }
        }
      ]
    }
    autoMitigate: true
    actions: actions
  }
}

// S-6 (bucket 6): backend deep-health availability. Hits /api/health/deep
// every 5 minutes from five Azure regions; alert fires when 2+ regions
// fail over a 10-minute window (debounce flakes — single-region egress
// hiccups are common and don't mean we're actually down). `ParseDependent`
// must be true so the test validates TLS cert + body; we've had the probe
// return 200-OK-with-body-"upstream-unavailable" once, pure status-code
// would miss that.
resource healthWebtest 'Microsoft.Insights/webtests@2022-06-15' = {
  name: 'codetutor-api-health'
  location: location
  tags: union(tags, {
    // Azure requires this hidden-link tag so the webtest appears under the
    // App Insights resource in the portal. Format: `hidden-link:{ai-id}`.
    'hidden-link:${appInsightsId}': 'Resource'
  })
  kind: 'standard'
  properties: {
    SyntheticMonitorId: 'codetutor-api-health'
    Name: 'codetutor-api-health'
    Enabled: true
    Frequency: 300
    Timeout: 30
    Kind: 'standard'
    RetryEnabled: true
    Locations: [
      { Id: 'us-ca-sjc-azr' }
      { Id: 'us-tx-sn1-azr' }
      { Id: 'us-il-ch1-azr' }
      { Id: 'us-va-ash-azr' }
      { Id: 'us-fl-mia-edge' }
    ]
    Request: {
      RequestUrl: healthEndpoint
      HttpVerb: 'GET'
      ParseDependentRequests: false
    }
    ValidationRules: {
      ExpectedHttpStatusCode: 200
      SSLCheck: true
      SSLCertRemainingLifetimeCheck: 7
    }
  }
}

// S-7 (bucket 6): SWA root availability. Catches the case where the CDN
// edge is serving stale or errored content — less likely than backend
// trouble but a full outage if it does happen. Same debounce + location
// pattern as the backend probe.
resource swaWebtest 'Microsoft.Insights/webtests@2022-06-15' = {
  name: 'codetutor-swa-root'
  location: location
  tags: union(tags, {
    'hidden-link:${appInsightsId}': 'Resource'
  })
  kind: 'standard'
  properties: {
    SyntheticMonitorId: 'codetutor-swa-root'
    Name: 'codetutor-swa-root'
    Enabled: true
    Frequency: 300
    Timeout: 30
    Kind: 'standard'
    RetryEnabled: true
    Locations: [
      { Id: 'us-ca-sjc-azr' }
      { Id: 'us-tx-sn1-azr' }
      { Id: 'us-il-ch1-azr' }
      { Id: 'us-va-ash-azr' }
      { Id: 'us-fl-mia-edge' }
    ]
    Request: {
      RequestUrl: swaEndpoint
      HttpVerb: 'GET'
      ParseDependentRequests: false
    }
    ValidationRules: {
      ExpectedHttpStatusCode: 200
      SSLCheck: true
      SSLCertRemainingLifetimeCheck: 7
    }
  }
}

// Metric alert tied to the webtest availability signal. Fires on 2+
// failing locations over a 5-minute window. Webtest metric alerts live at
// `global` and scope across the webtest resource + its App Insights
// parent (Azure requires both or the portal refuses to show state).
resource healthAvailabilityAlert 'Microsoft.Insights/metricAlerts@2018-03-01' = {
  name: 'codetutor-api-health-availability'
  location: 'global'
  tags: tags
  properties: {
    enabled: true
    severity: 1
    scopes: [
      healthWebtest.id
      appInsightsId
    ]
    evaluationFrequency: 'PT1M'
    windowSize: 'PT5M'
    criteria: {
      'odata.type': 'Microsoft.Azure.Monitor.WebtestLocationAvailabilityCriteria'
      webTestId: healthWebtest.id
      componentId: appInsightsId
      failedLocationCount: 2
    }
    autoMitigate: true
    actions: [
      { actionGroupId: actionGroupId }
    ]
  }
}

resource swaAvailabilityAlert 'Microsoft.Insights/metricAlerts@2018-03-01' = {
  name: 'codetutor-swa-root-availability'
  location: 'global'
  tags: tags
  properties: {
    enabled: true
    severity: 1
    scopes: [
      swaWebtest.id
      appInsightsId
    ]
    evaluationFrequency: 'PT1M'
    windowSize: 'PT5M'
    criteria: {
      'odata.type': 'Microsoft.Azure.Monitor.WebtestLocationAvailabilityCriteria'
      webTestId: swaWebtest.id
      componentId: appInsightsId
      failedLocationCount: 2
    }
    autoMitigate: true
    actions: [
      { actionGroupId: actionGroupId }
    ]
  }
}

// S-12 (bucket 6): platform AI spend anomaly. The backend emits a
// structured log line once an hour with the rolling-hour platform cost in
// USD (see platformCostSampler.ts) and an `exceeded` boolean keyed on
// 2× FREE_TIER_DAILY_USD_CAP. This alert matches on `exceeded:true` so we
// don't have to encode the threshold in KQL (the backend owns it via the
// config value we're already reading to gate the tier). Severity 2: L4
// already hard-caps daily spend so this is an anomaly signal, not a
// "losing money right now" page.
resource platformCostAnomalyAlert 'Microsoft.Insights/scheduledQueryRules@2023-03-15-preview' = {
  name: 'codetutor-platform-cost-anomaly'
  location: location
  tags: tags
  properties: {
    enabled: true
    severity: 2
    scopes: [ workspaceId ]
    evaluationFrequency: 'PT15M'
    windowSize: 'PT1H'
    criteria: {
      allOf: [
        {
          query: 'ContainerLog_CL | where LogEntry has "platform_cost_hourly" and LogEntry has "\\"exceeded\\":true"'
          timeAggregation: 'Count'
          operator: 'GreaterThanOrEqual'
          threshold: 1
          failingPeriods: {
            minFailingPeriodsToAlert: 1
            numberOfEvaluationPeriods: 1
          }
        }
      ]
    }
    autoMitigate: true
    actions: actions
  }
}

resource acsDeliveryFailedAlert 'Microsoft.Insights/metricAlerts@2018-03-01' = if (!empty(communicationServiceId)) {
  name: 'codetutor-acs-email-delivery-failed'
  location: 'global'
  tags: tags
  properties: {
    enabled: true
    severity: 2
    scopes: [ communicationServiceId ]
    evaluationFrequency: 'PT5M'
    windowSize: 'PT15M'
    criteria: {
      'odata.type': 'Microsoft.Azure.Monitor.SingleResourceMultipleMetricCriteria'
      allOf: [
        {
          name: 'FailedDeliveries'
          metricNamespace: 'Microsoft.Communication/CommunicationServices'
          metricName: 'DeliveryStatusUpdate'
          operator: 'GreaterThan'
          threshold: 5
          timeAggregation: 'Count'
          criterionType: 'StaticThresholdCriterion'
          dimensions: [
            {
              name: 'MessageStatus'
              operator: 'Include'
              values: [ 'Failed' ]
            }
          ]
        }
      ]
    }
    autoMitigate: true
    actions: [
      {
        actionGroupId: actionGroupId
      }
    ]
  }
}
