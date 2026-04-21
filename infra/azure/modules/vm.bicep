// Ubuntu 24.04 LTS VM with system-assigned managed identity + SSH-only auth.
// cloud-init is empty in 19a — 19b injects it via customData. Boot diagnostics
// pipe console output to a managed storage location (free tier covers it).

param location string
param vmName string
param vmSize string
param osDiskSizeGB int
param adminUsername string
@secure()
param adminPublicKey string
param nicId string
param logAnalyticsWorkspaceId string
param tags object

// cloud-init template variables — substituted into the embedded YAML before
// it's base64-passed into VM customData. Changing any of these requires the
// VM to be recreated (customData is first-boot only).
param keyVaultName string
param vmFqdn string
param swaHostname string
param repoUrl string
param backendImage string
param runnerImage string
param adminEmail string

var cloudInitTemplate = loadTextContent('../cloud-init.yaml')
var cloudInitResolved = replace(replace(replace(replace(replace(replace(replace(
  cloudInitTemplate,
  '{{KV_NAME}}', keyVaultName),
  '{{VM_FQDN}}', vmFqdn),
  '{{SWA_HOSTNAME}}', swaHostname),
  '{{REPO_URL}}', repoUrl),
  '{{BACKEND_IMAGE}}', backendImage),
  '{{RUNNER_IMAGE}}', runnerImage),
  '{{ADMIN_EMAIL}}', adminEmail)

resource vm 'Microsoft.Compute/virtualMachines@2024-07-01' = {
  name: vmName
  location: location
  tags: tags
  identity: { type: 'SystemAssigned' }
  properties: {
    hardwareProfile: { vmSize: vmSize }
    storageProfile: {
      imageReference: {
        publisher: 'Canonical'
        offer: 'ubuntu-24_04-lts'
        sku: 'server'
        version: 'latest'
      }
      osDisk: {
        createOption: 'FromImage'
        diskSizeGB: osDiskSizeGB
        managedDisk: { storageAccountType: 'Premium_LRS' }
      }
    }
    osProfile: {
      computerName: vmName
      adminUsername: adminUsername
      customData: base64(cloudInitResolved)
      linuxConfiguration: {
        disablePasswordAuthentication: true
        ssh: {
          publicKeys: [
            {
              path: '/home/${adminUsername}/.ssh/authorized_keys'
              keyData: adminPublicKey
            }
          ]
        }
      }
    }
    networkProfile: {
      networkInterfaces: [ { id: nicId } ]
    }
    diagnosticsProfile: {
      bootDiagnostics: { enabled: true }
    }
  }
}

// Azure Monitor Agent — sends VM metrics/heartbeat to the Log Analytics
// workspace. Paired with a Data Collection Rule below so the agent knows
// which destination to use.
resource ama 'Microsoft.Compute/virtualMachines/extensions@2024-07-01' = {
  parent: vm
  name: 'AzureMonitorLinuxAgent'
  location: location
  properties: {
    publisher: 'Microsoft.Azure.Monitor'
    type: 'AzureMonitorLinuxAgent'
    typeHandlerVersion: '1.33'
    autoUpgradeMinorVersion: true
    enableAutomaticUpgrade: true
  }
}

resource dcr 'Microsoft.Insights/dataCollectionRules@2023-03-11' = {
  name: '${vmName}-dcr'
  location: location
  tags: tags
  kind: 'Linux'
  properties: {
    dataSources: {
      performanceCounters: [
        {
          name: 'vmBasicMetrics'
          streams: [ 'Microsoft-Perf' ]
          samplingFrequencyInSeconds: 60
          counterSpecifiers: [
            '\\Processor(_Total)\\% Processor Time'
            '\\Memory\\% Used Memory'
            '\\Logical Disk(_Total)\\% Used Space'
          ]
        }
      ]
      syslog: [
        {
          name: 'syslogBase'
          streams: [ 'Microsoft-Syslog' ]
          facilityNames: [ 'daemon', 'syslog', 'user' ]
          logLevels: [ 'Warning', 'Error', 'Critical', 'Alert', 'Emergency' ]
        }
      ]
    }
    destinations: {
      logAnalytics: [
        {
          workspaceResourceId: logAnalyticsWorkspaceId
          name: 'codetutor-la'
        }
      ]
    }
    dataFlows: [
      {
        streams: [ 'Microsoft-Perf', 'Microsoft-Syslog' ]
        destinations: [ 'codetutor-la' ]
      }
    ]
  }
}

resource dcrAssociation 'Microsoft.Insights/dataCollectionRuleAssociations@2023-03-11' = {
  name: '${vmName}-dcr-assoc'
  scope: vm
  properties: {
    dataCollectionRuleId: dcr.id
    description: 'Associate CodeTutor VM with its DCR'
  }
}

output vmId string = vm.id
output principalId string = vm.identity.principalId
