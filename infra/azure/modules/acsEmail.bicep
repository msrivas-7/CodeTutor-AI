// Azure Communication Services — Email (Phase 20-P2). Swaps Supabase Auth off
// its default sandbox SMTP (2 emails/hr cap) and onto a real sender so the
// email-verified gate in authMiddleware won't wedge users behind a rate limit.
//
// Topology:
//   CommunicationServices (SMTP endpoint + Entra auth)
//     └── linkedDomains[] ──► EmailCommunicationServices ──► domain(s)
//         └── senderUsernames (authorizes `noreply@…` as a valid MailFrom)
//
// Control-plane location MUST be `global` for all three resource types (the
// region the resource "lives" in is decided by `dataLocation`). dataLocation
// `UnitedStates` keeps mail + metadata in US datacenters, matching the VM +
// SWA + Log Analytics in eastus2.
//
// Custom-domain verification is two-phase:
//   1. `az deployment group create` lands the resources in Unverified state.
//   2. Operator adds DNS records (SPF TXT, DKIM CNAME x2, optional DMARC TXT)
//      to the domain's DNS host (Wix for msrivas.com), then triggers
//      `az communication email domain initiate-verification` per record.
// This module doesn't try to block on DNS propagation — that's an out-of-band
// step covered in infra/azure/README.md.

param location string = 'global'
param tags object

@description('Fully-qualified custom mail domain. MailFrom will be <sender>@<this>.')
param mailDomain string

@description('MailFrom local-part (e.g. `noreply` → noreply@<mailDomain>).')
param mailSender string = 'noreply'

@description('Friendly display name shown in the From header of outbound mail.')
param mailDisplayName string = 'CodeTutor AI'

var communicationServiceName = 'codetutor-ai-acs'
var emailServiceName = 'codetutor-ai-email'
// Azure requires domain resource names match the DNS name exactly (not a
// sanitized variant), so the resource name is the mailDomain itself.
var domainResourceName = mailDomain

// Communication Services — the top-level resource that exposes the SMTP
// endpoint and issues auth tokens. Connection-string-based SMTP auth is
// deprecated; outgoing SMTP goes through an Entra app registration that the
// operator wires up post-deploy (see README.md).
//
// `linkedDomains` is intentionally empty on first deploy: ACS refuses to
// link an unverified domain, so the flow is:
//   1. Deploy this module (CS + domain + sender all unlinked).
//   2. Operator adds the DNS records to Wix + initiates verification
//      (`az communication email domain initiate-verification`).
//   3. Once DNS verifies, re-run this deploy with `linkDomain=true` to
//      patch the CS resource and attach the domain for SMTP.
param linkDomain bool = false

resource communicationService 'Microsoft.Communication/communicationServices@2023-06-01-preview' = {
  name: communicationServiceName
  location: location
  tags: tags
  properties: {
    dataLocation: 'UnitedStates'
    linkedDomains: linkDomain ? [ domain.id ] : []
  }
}

// Email Communication Services — the container for one or more domains.
// Kept separate from the Communication Service so multiple CS resources
// could share a domain without re-verifying DNS.
resource emailService 'Microsoft.Communication/emailServices@2023-06-01-preview' = {
  name: emailServiceName
  location: location
  tags: tags
  properties: {
    dataLocation: 'UnitedStates'
  }
}

// Custom domain (`CustomerManaged` = operator adds DNS records manually).
// Alternative is `AzureManaged` which attaches `*.azurecomm.net` with no
// DNS work — rejected here because verification emails from a raw
// azurecomm.net sender land in spam more readily than a matching-domain
// sender.
resource domain 'Microsoft.Communication/emailServices/domains@2023-06-01-preview' = {
  parent: emailService
  name: domainResourceName
  // Domain resources MUST be 'global'. Deploying to a region like `eastus2`
  // here will fail with an obscure "location not supported" error.
  location: 'global'
  tags: tags
  properties: {
    domainManagement: 'CustomerManaged'
    // Enable the full set of verification records so we get SPF + DKIM
    // out of the box. DMARC is optional; we leave it off and let the
    // operator add a DMARC policy TXT record to Wix separately once
    // deliverability is proven.
    userEngagementTracking: 'Disabled'
  }
}

// Authorize `<mailSender>@<mailDomain>` as a legal MailFrom. ACS rejects
// sends where the From header doesn't match a registered sender username
// on the parent domain, so this is load-bearing for Supabase.
resource sender 'Microsoft.Communication/emailServices/domains/senderUsernames@2023-06-01-preview' = {
  parent: domain
  name: mailSender
  properties: {
    username: mailSender
    displayName: mailDisplayName
  }
}

// Outputs consumed by the deploy-time wiring steps in README.md (DNS record
// lookups, Key Vault secret seeding, Supabase SMTP paste).
output communicationServiceName string = communicationService.name
output communicationServiceId string = communicationService.id
output emailServiceName string = emailService.name
output mailDomainId string = domain.id
output mailDomainName string = domain.name
output mailFrom string = '${mailSender}@${mailDomain}'
