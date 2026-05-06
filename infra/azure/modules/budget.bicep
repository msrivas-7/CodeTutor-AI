// Phase 22A: native Azure Cost Management Budget for infra-side spend.
//
// Application-side $ alerts (backend's budgetWatcher.ts) only see what
// our backend tracks (OpenAI per-user spend). They miss infra-cost
// spikes — Azure Monitor jumping 3x last week, Storage hitting Pro
// tier overage, a runaway VM. Azure Cost Management has a native
// Budget feature for this — free, declared in Bicep, fires the same
// `codetutor-ai-ag` action group that all other alerts use → email
// to the operator's inbox at 50/80/100% of the monthly cap.
//
// Budgets are RG-scoped resources at this deployment scope. The cap
// is sized at $80/month — ~25% above the expected ~$34/month run rate
// post-24B-resize (B2s VM ~$30 + Azure Monitor ~$2.50 + Storage/Network
// ~$1.50 + headroom). Hitting 100% means actual spend reached $80 —
// time to investigate, not panic. Note: the main.bicep override sets
// monthlyCapUsd=400 to absorb the ACI overflow envelope; this default
// only applies if the module is consumed standalone.

@description('Resource ID of the action group whose email receiver fires on threshold crossings.')
param actionGroupId string

@description('Monthly $ cap. 50/80/100% trip notifications.')
param monthlyCapUsd int = 80

@description('Date the budget starts evaluating from. Must be the first of a month.')
param startDate string

@description('Operator email address. Surfaced as a redundant `contactEmails` recipient on each notification — Cost Management will email this address even if the action-group receiver is misconfigured.')
param operatorEmail string

resource budget 'Microsoft.Consumption/budgets@2024-08-01' = {
  name: 'codetutor-ai-monthly'
  properties: {
    category: 'Cost'
    amount: monthlyCapUsd
    timeGrain: 'Monthly'
    timePeriod: {
      startDate: startDate
    }
    notifications: {
      atPercent50: {
        enabled: true
        operator: 'GreaterThan'
        threshold: 50
        contactEmails: [ operatorEmail ]
        contactGroups: [ actionGroupId ]
        locale: 'en-us'
        thresholdType: 'Actual'
      }
      atPercent80: {
        enabled: true
        operator: 'GreaterThan'
        threshold: 80
        contactEmails: [ operatorEmail ]
        contactGroups: [ actionGroupId ]
        locale: 'en-us'
        thresholdType: 'Actual'
      }
      atPercent100: {
        enabled: true
        operator: 'GreaterThan'
        threshold: 100
        contactEmails: [ operatorEmail ]
        contactGroups: [ actionGroupId ]
        locale: 'en-us'
        thresholdType: 'Actual'
      }
    }
  }
}

output budgetId string = budget.id
output budgetName string = budget.name
