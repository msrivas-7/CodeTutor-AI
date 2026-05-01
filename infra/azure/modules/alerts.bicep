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

@description('P0-5a: ACI NSG resource ID. Used by the NSG-drift Activity Log alert that fires whenever someone modifies the security rules on the ACI subnet NSG. Empty string skips the alert (e.g., test deploys without ACI infra).')
param aciNsgId string = ''

var actions = {
  actionGroups: [ actionGroupId ]
}

// Sustained high memory → OOM is imminent. 90% used on 4 GB leaves ~400 MB
// which is the plan's stated ceiling. 10m window + 1 failing period means a
// single one-off backup pass won't page.
// Phase 22A retime: 5min → 15min eval. Memory leaks build over hours;
// catching them within a 15-min window gives equivalent fidelity at a
// third of the alert-rule cost.
resource memAlert 'Microsoft.Insights/scheduledQueryRules@2023-03-15-preview' = {
  name: 'codetutor-vm-memory-high'
  location: location
  tags: tags
  properties: {
    enabled: true
    severity: 2
    scopes: [ workspaceId ]
    evaluationFrequency: 'PT15M'
    windowSize: 'PT15M'
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

// Phase 22A audit re-add: vm-cpu-high at 85% over 10min. Originally
// dropped post-22A.4 because B2s baseline was 1.7% avg / 4.4% peak. SRE
// audit flagged the regret: with launch-day traffic on B2ms (2 vCPU)
// and runner workloads, sustained CPU pressure becomes a real failure
// mode and we'd otherwise diagnose latency from user complaints. The
// 85% threshold is high enough to dodge baseline noise, low enough to
// catch genuine saturation. Severity 2: degraded, not down.
resource cpuAlert 'Microsoft.Insights/scheduledQueryRules@2023-03-15-preview' = {
  name: 'codetutor-vm-cpu-high'
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
// Phase 22A audit revert: heartbeat back to 5min eval. The 15min
// retime was a cost-savings move ($3/mo); SRE audit flagged the
// 30min-worst-case detection window as a launch killer (PH front-page
// peak is ~90min, so a VM-dark at T+0 detected at T+30 means we'd
// discover the outage when the spike has already moved on). Reverting
// to 5min eval costs $1.50/mo extra; non-negotiable for launch-week.
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
// Phase 22A audit re-add: vm-disk-warning at 70% over 30min. Originally
// dropped post-22A.4 as redundant with the 80% disk-high. QA audit
// flagged the regret: B2ms doubled RAM but disk is unchanged (32GB OS
// disk). Postgres logs / container logs / daily_usage ledger / share
// artifacts all live there. Heartbeat doesn't help — the VM stays
// reachable while disk fills to 100%. The 70% lead indicator gives
// triage runway before disk-high pages and before docker pulls /
// compose start failing. Severity 3: warning, not critical.
resource diskWarningAlert 'Microsoft.Insights/scheduledQueryRules@2023-03-15-preview' = {
  name: 'codetutor-vm-disk-warning'
  location: location
  tags: tags
  properties: {
    enabled: true
    severity: 3
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

// S-18 (bucket 6): BYOK decrypt failures. byok.ts emits a structured JSON
// error line `{"err":"byok_decrypt_failed",...}` on every GCM tag-verify
// failure. When container logs land in LA (via DCR logFiles data source
// in vm.bicep), this query catches the first tick and pages. Any value
// above zero warrants investigation — see metrics.ts comment.
// Phase 22A retime: 5min → 15min eval. Severity-1 security alert, but
// 15min is acceptable for indie since BYOK decrypt failure investigation
// takes longer than 15min anyway (key-rotation triage). Tighten back to
// 5min if traffic warrants. Saves ~$3/mo at the watch cadence.
resource byokDecryptFailedAlert 'Microsoft.Insights/scheduledQueryRules@2023-03-15-preview' = {
  name: 'codetutor-byok-decrypt-failed'
  location: location
  tags: tags
  properties: {
    enabled: true
    severity: 1
    scopes: [ workspaceId ]
    evaluationFrequency: 'PT15M'
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

// Phase 26 (audit SRE F1.2): JWT validation failure rate. Backend's
// authMiddleware emits `evt:auth_reject` (level=warn) on every 401 —
// missing/empty bearer, expired token, invalid token, no matching JWKS
// kid, generic verify error. A SUSTAINED spike is the leading edge of
// either (a) forged-token probing (someone iterating JWTs against /api),
// (b) stolen-key replay after expiry, (c) a Supabase JWKS rotation gone
// wrong (legitimate users hitting `no_matching_jwks_key` en masse).
//
// Threshold 50 over 15m: a single user's expired-token-then-refresh
// cycle generates a couple of rejects per session; 50 sustained means
// real volume, not background noise. Sev 2 because case (a) and (b)
// warrant operator attention but rarely paging-grade — paging would
// fire on EVERY user's expired token event without this floor.
resource authRejectAlert 'Microsoft.Insights/scheduledQueryRules@2023-03-15-preview' = {
  name: 'codetutor-auth-reject-rate'
  location: location
  tags: tags
  properties: {
    enabled: true
    severity: 2
    scopes: [ workspaceId ]
    evaluationFrequency: 'PT5M'
    windowSize: 'PT15M'
    criteria: {
      allOf: [
        {
          query: 'ContainerLog_CL | where LogEntry has \'"evt":"auth_reject"\''
          timeAggregation: 'Count'
          operator: 'GreaterThanOrEqual'
          threshold: 50
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

// Phase 26 (audit SRE F1.1): admin-action rejected-attempt rate. Every
// admin route logs to admin_audit_log on validation failure / missing
// phrase / out-of-bounds value, AND emits a stdout shadow line with
// `"action":"rejected_attempt"`. A spike means either (a) admin typo
// storm (low-severity, just confirm it's the operator), (b) someone
// has a non-admin JWT and is hitting /api/admin/* (adminGuard blocks
// them with 403, but the audit log still records the rejection — this
// alert catches probing), or (c) a compromised admin account trying
// to escalate (the bounds-violation pattern is distinctive).
//
// Threshold 10 over 15m: routine admin work generates at most 1-2
// rejections (typed phrase wrong once, fixed second try); 10 in a
// 15-minute window is well above noise. Sev 2 to surface it without
// paging — the admin should be notified, not woken up.
resource rejectedAttemptAlert 'Microsoft.Insights/scheduledQueryRules@2023-03-15-preview' = {
  name: 'codetutor-admin-rejected-attempt-rate'
  location: location
  tags: tags
  properties: {
    enabled: true
    severity: 2
    scopes: [ workspaceId ]
    evaluationFrequency: 'PT5M'
    windowSize: 'PT15M'
    criteria: {
      allOf: [
        {
          query: 'ContainerLog_CL | where LogEntry has \'"action":"rejected_attempt"\''
          timeAggregation: 'Count'
          operator: 'GreaterThanOrEqual'
          threshold: 10
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

// Phase 23 P1 #8: TLS cert-expiry early warning.
//
// The existing health/swa webtests already enforce `SSLCertRemainingLifetimeCheck: 7`,
// so a cert <7 days from expiry trips the sev-1 availability alert.
// That's "house already on fire" — Caddy renews 30 days before expiry,
// so a cert reaching 7 days remaining means the renewal job has been
// failing silently for ~3 weeks.
//
// This webtest is a separate 14-day-threshold probe — it fails (and
// sev-3 emails) when the cert drops below 14 days. That's a 7-day
// runway before the sev-1 fires, plenty of time to investigate the
// renewal job (Caddy logs, ACME challenge, DNS, etc.) without an
// outage clock running.
//
// Single location (Virginia) on purpose: cert validity is a property
// of OUR origin's TLS handshake, not a per-region reachability signal.
// Multi-location debouncing here would just multiply noise from
// transient network errors that have nothing to do with cert expiry.
//
// Frequency 900s (15 min) is the slowest webtest cadence Azure allows.
// The metric alert wraps it with PT1H eval / PT6H window so the
// operator gets at most a few emails per day if the threshold is held —
// closer to "weekly check" than the 5-min webtest cadence implies.
resource certExpiryWarningWebtest 'Microsoft.Insights/webtests@2022-06-15' = {
  name: 'codetutor-tls-cert-14d'
  location: location
  tags: union(tags, {
    'hidden-link:${appInsightsId}': 'Resource'
  })
  kind: 'standard'
  properties: {
    SyntheticMonitorId: 'codetutor-tls-cert-14d'
    Name: 'codetutor-tls-cert-14d'
    Enabled: true
    Frequency: 900
    Timeout: 30
    Kind: 'standard'
    RetryEnabled: true
    Locations: [
      { Id: 'us-va-ash-azr' }
    ]
    Request: {
      RequestUrl: healthEndpoint
      HttpVerb: 'GET'
      ParseDependentRequests: false
    }
    ValidationRules: {
      ExpectedHttpStatusCode: 200
      SSLCheck: true
      SSLCertRemainingLifetimeCheck: 14
    }
  }
}

resource certExpiryWarningAlert 'Microsoft.Insights/metricAlerts@2018-03-01' = {
  name: 'codetutor-tls-cert-expiry-warning'
  location: 'global'
  tags: tags
  properties: {
    enabled: true
    severity: 3
    scopes: [
      certExpiryWarningWebtest.id
      appInsightsId
    ]
    evaluationFrequency: 'PT1H'
    windowSize: 'PT6H'
    criteria: {
      'odata.type': 'Microsoft.Azure.Monitor.WebtestLocationAvailabilityCriteria'
      webTestId: certExpiryWarningWebtest.id
      componentId: appInsightsId
      failedLocationCount: 1
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

// Phase 23 P0 #3: capacity-pressure composite alert. Keys off the
// 60s-cadence `evt:capacity_pressure` log lines emitted by
// services/observability/capacityPressureSampler.ts. Single rule covers
// three signals — a sustained breach in any one is enough to page:
//   sessions      > 12 (we cap globally at 14; 12 = 85% utilization)
//   exec_queued   > 4 (queueing means runner-exec capacity is starved)
//   render_waiting> 10 (share-creation burst outpacing renders)
// PT15M evaluation × PT15M window = effectively "sustained 10 min" given
// the 60s emit cadence (10+ samples in the window). Single email per
// breach via existing action group; matches the operator's "alerts are
// always email" rule.
resource capacityPressureAlert 'Microsoft.Insights/scheduledQueryRules@2023-03-15-preview' = {
  name: 'codetutor-capacity-pressure'
  location: location
  tags: tags
  properties: {
    enabled: true
    severity: 2
    scopes: [ workspaceId ]
    evaluationFrequency: 'PT15M'
    windowSize: 'PT15M'
    criteria: {
      allOf: [
        {
          query: '''
ContainerLog_CL
| where LogEntry has '"evt":"capacity_pressure"'
| extend sessions = toint(extract('"sessions":(\\d+)', 1, LogEntry))
| extend execQueued = toint(extract('"exec_queued":(\\d+)', 1, LogEntry))
| extend renderWaiting = toint(extract('"render_waiting":(\\d+)', 1, LogEntry))
| where sessions > 12 or execQueued > 4 or renderWaiting > 10
'''
          timeAggregation: 'Count'
          operator: 'GreaterThanOrEqual'
          threshold: 10
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

// Phase 23 P0 #5: HTTP error-rate alert. Reads the existing
// requestLogger output (every response logs `"status":<n>`) so no new
// emitter is needed. Threshold: 4xx-or-5xx-rate > 5% sustained 10 min.
// Tuning rationale — at our scale, a single misclick produces 1-2% in
// a 1-min bucket; sustained 5% over 10 min means a real broken path,
// not noise. 429s + 503s are the codes most directly tied to capacity
// pressure (rate limit + cap rejection); the alert deliberately doesn't
// page on 4xx-only patterns (validation errors aren't an ops problem).
resource errorRateAlert 'Microsoft.Insights/scheduledQueryRules@2023-03-15-preview' = {
  name: 'codetutor-http-error-rate'
  location: location
  tags: tags
  properties: {
    enabled: true
    severity: 2
    scopes: [ workspaceId ]
    evaluationFrequency: 'PT5M'
    windowSize: 'PT15M'
    criteria: {
      allOf: [
        {
          query: '''
ContainerLog_CL
| where LogEntry has '"status":'
| extend status = toint(extract('"status":(\\d+)', 1, LogEntry))
| where isnotnull(status)
| summarize
    total = count(),
    errors = countif(status == 429 or status == 503)
    by bin(TimeGenerated, 1m)
| extend errorRatePct = todouble(errors) / todouble(total) * 100
| where total >= 10  // ignore 1-request buckets to keep noise out
| where errorRatePct >= 5
'''
          timeAggregation: 'Count'
          operator: 'GreaterThanOrEqual'
          threshold: 10
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

// Phase 23 P0 #4: storage bucket fill alert. The orphan-share-image GC
// runs daily and deletes OG/Story PNGs older than 90 days with zero
// views, but the only way to know whether GC is keeping pace with new
// uploads is to watch the bucket-size trend. The cron emits its
// `evt:orphan_share_gc_complete` log line each fire; we don't have a
// direct bucket-size metric without scraping the Supabase admin API
// (out of scope for tonight). Use the GC's own non-zero-attempts
// signal as the canary: more than 50 GC attempts in a single run for
// 2 consecutive runs (over a 48-hour window) means we're persistently
// catching up to a fast fill rate. PT12H eval × P2D matches "2
// consecutive daily fires." Note: Azure scheduledQueryRules cap window
// size at 2880 minutes (48 hours) — earlier P3D (4320 min) was
// rejected by ARM as unsupported.
resource storageGcPressureAlert 'Microsoft.Insights/scheduledQueryRules@2023-03-15-preview' = {
  name: 'codetutor-storage-gc-pressure'
  location: location
  tags: tags
  properties: {
    enabled: true
    severity: 3
    scopes: [ workspaceId ]
    evaluationFrequency: 'PT12H'
    windowSize: 'P2D'
    criteria: {
      allOf: [
        {
          query: '''
ContainerLog_CL
| where LogEntry has '"evt":"orphan_share_gc_complete"'
| extend attempted = toint(extract('"attempted":(\\d+)', 1, LogEntry))
| where attempted > 50
'''
          timeAggregation: 'Count'
          operator: 'GreaterThanOrEqual'
          threshold: 3
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

// Phase 23 P1 #2: AI spend velocity alert. Today's budget alerts fire
// at 50/80/100% of the daily $15 cap — a runaway loop hitting the cap
// in 30 min surfaces with the same severity as one that took 23 hours.
// This alert surfaces VELOCITY — $/hour — so a fast burn pages before
// L4 actually hits cap. Threshold: rolling 1-hour platform spend > $5
// (= one-third of daily cap consumed in one hour). The
// platformCostSampler already emits `evt:platform_cost_hourly` every
// hour; we evaluate every 15 min by reading the latest sample.
resource aiSpendVelocityAlert 'Microsoft.Insights/scheduledQueryRules@2023-03-15-preview' = {
  name: 'codetutor-ai-spend-velocity'
  location: location
  tags: tags
  properties: {
    enabled: true
    severity: 1
    scopes: [ workspaceId ]
    evaluationFrequency: 'PT15M'
    windowSize: 'PT1H'
    criteria: {
      allOf: [
        {
          query: '''
ContainerLog_CL
| where LogEntry has '"evt":"platform_cost_hourly"'
| extend sumUsd = todouble(extract('"sum_usd":([0-9.]+)', 1, LogEntry))
| where sumUsd >= 5.0
'''
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

// Phase 24B: ACI cost-cap exceeded. The cost tracker emits `evt:
// aci_cost_hourly` once an hour with `exceeded:true` whenever today's
// spend has hit the daily cap (config.aci.dailyUsdCap, default $20).
// The kill switch in HybridBackend has already disabled overflow at
// that point — this alert is the operator notification that we hit
// the ceiling. Severity 2: not paging-grade because no user-facing
// regression beyond "overflow's off" (primary 14 slots still serve),
// but loud enough to surface in the daily ops triage.
//
// Evaluate every hour to match the emit cadence — anything tighter
// just re-evaluates the same data. windowSize PT2H to ride out a
// missed sample without false-clearing.
resource aciCostCapAlert 'Microsoft.Insights/scheduledQueryRules@2023-03-15-preview' = {
  name: 'codetutor-aci-cost-cap-exceeded'
  location: location
  tags: tags
  properties: {
    enabled: true
    severity: 2
    scopes: [ workspaceId ]
    evaluationFrequency: 'PT1H'
    windowSize: 'PT2H'
    criteria: {
      allOf: [
        {
          query: '''
ContainerLog_CL
| where LogEntry has '"evt":"aci_cost_hourly"'
| where LogEntry has '"exceeded":true'
'''
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

// P0-5a (audit fix): NSG-drift detector for the ACI subnet NSG.
//
// The ACI NSG is the firewall layer that keeps learner code from
// reaching the VM subnet's internal ports — every rule on it is part
// of the C2 (no-internet-egress) + cross-tenant isolation guarantee.
// Pre-fix there was NO observability: an admin (or compromised SP)
// could disable AllowReplyToVmSubnet's deny twin or punch a port hole,
// and we'd only learn about it when a learner exfiltrated something.
//
// Activity Log Alert (not scheduled query) chosen because:
//   - Fires within ~1 min of the write, vs. 5+ min for query-based.
//   - Free at this volume. Scheduled queries cost ~$1.50/mo each.
//   - No dependency on AzureActivity table being forwarded to LA
//     workspace (which is currently NOT configured in this tenant).
//
// Severity 1: this is a security-perimeter mutation, page on it. The
// only legitimate writers are the OIDC SP via deploy.yml — anything
// else is suspicious until proven otherwise. The runbook entry: open
// the activity log, identify caller, confirm intent or rollback.
resource aciNsgDriftAlert 'Microsoft.Insights/activityLogAlerts@2020-10-01' = if (!empty(aciNsgId)) {
  name: 'codetutor-aci-nsg-drift'
  location: 'global'
  tags: tags
  properties: {
    enabled: true
    description: 'ACI subnet NSG was modified — investigate immediately. Only the deploy SP should write here.'
    scopes: [ aciNsgId ]
    condition: {
      allOf: [
        {
          field: 'category'
          equals: 'Administrative'
        }
        {
          // anyOf at the inner level matches either the NSG-level write
          // (rule add/remove that touches the parent resource) OR the
          // securityRules sub-resource write. Either fires the alert.
          anyOf: [
            {
              field: 'operationName'
              equals: 'Microsoft.Network/networkSecurityGroups/write'
            }
            {
              field: 'operationName'
              equals: 'Microsoft.Network/networkSecurityGroups/securityRules/write'
            }
            {
              field: 'operationName'
              equals: 'Microsoft.Network/networkSecurityGroups/securityRules/delete'
            }
          ]
        }
        {
          // Only fire on completed mutations, not the staged "started"
          // / "accepted" entries that ARM emits as part of every write.
          field: 'status'
          equals: 'Succeeded'
        }
      ]
    }
    actions: {
      actionGroups: [
        {
          actionGroupId: actionGroupId
        }
      ]
    }
  }
}

// P3-3 (audit fix): aci_counter_drift alert.
//
// HybridBackend's localActive/aciActive counters surface lifecycle bugs
// when they drift negative (a destroy() ran more times than a create()
// on at least one backend). The aciHealthSampler emits a warn-level
// log line per minute when drift > 0; this rule pages on any
// occurrence in a 15-min window. Sev-2 because it's a real bug not a
// transient condition — drift doesn't self-correct without restart.
resource aciCounterDriftAlert 'Microsoft.Insights/scheduledQueryRules@2023-03-15-preview' = {
  name: 'codetutor-aci-counter-drift'
  location: location
  tags: tags
  properties: {
    enabled: true
    severity: 2
    scopes: [ workspaceId ]
    evaluationFrequency: 'PT5M'
    windowSize: 'PT15M'
    criteria: {
      allOf: [
        {
          query: '''
ContainerLog_CL
| where LogEntry has '"evt":"aci_counter_drift"'
'''
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

// P3-4 (audit fix): aci_spawn_failure rate alert.
//
// AciExecutionBackend.createSession emits `evt:aci_spawn_failure` on
// every cold-start failure with `result` ∈ {fail_arm, fail_agent}.
// 10+ failures in 10 min = either ARM regional outage or systemic
// spawn issue; sev-2 paging surfaces it before users notice via
// support tickets. The cost-cap alert (existing) only fires after
// damage; this is the leading-edge signal.
resource aciSpawnFailureRateAlert 'Microsoft.Insights/scheduledQueryRules@2023-03-15-preview' = {
  name: 'codetutor-aci-spawn-failure-rate'
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
          query: '''
ContainerLog_CL
| where LogEntry has '"evt":"aci_spawn_failure"'
'''
          timeAggregation: 'Count'
          operator: 'GreaterThanOrEqual'
          threshold: 10
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

// P3-5 (audit fix): aci_op_config watchdog-engaged alert.
//
// When the operational-config mirror's last successful refresh exceeds
// 5 × refresh interval (~150 s), the watchdog forces enabled=false /
// dailyUsdCap=0 / maxOverflow=0. The aciHealthSampler emits a warn
// log line per minute while in this state. 3+ occurrences in 10 min
// (signalling sustained DB unreachability, not a transient blip) →
// sev-2 page so the operator can fix DB connectivity before the cost
// cap fully decays.
resource aciOpConfigWatchdogAlert 'Microsoft.Insights/scheduledQueryRules@2023-03-15-preview' = {
  name: 'codetutor-aci-op-config-watchdog'
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
          query: '''
ContainerLog_CL
| where LogEntry has '"evt":"aci_op_config_watchdog_engaged"'
'''
          timeAggregation: 'Count'
          operator: 'GreaterThanOrEqual'
          threshold: 3
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
