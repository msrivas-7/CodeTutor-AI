// Azure Static Web App — free tier. Created unlinked; the GitHub App flow
// in the portal wires up `msrivas-7/AICodeEditor` and auto-generates the
// deployment workflow YAML.

param location string
param name string
param tags object

resource swa 'Microsoft.Web/staticSites@2024-04-01' = {
  name: name
  location: location
  tags: tags
  sku: {
    name: 'Free'
    tier: 'Free'
  }
  properties: {
    // Leave repository unlinked. The SWA GitHub App integration adds these
    // post-deploy without us burning a PAT in CI.
    allowConfigFileUpdates: true
    provider: 'None'
  }
}

output defaultHostname string = swa.properties.defaultHostname
output name string = swa.name
