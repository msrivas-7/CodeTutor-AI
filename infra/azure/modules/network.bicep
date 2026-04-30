// VNet + two subnets + NSGs + Standard SKU public IP + NIC. Standard SKU is
// required — Basic SKU public IPs were retired 2025-09-30. Standard defaults
// to deny-all inbound, so the NSG must explicitly open 22/80/443.
//
// Phase 24B: a second subnet `aci` is delegated to Microsoft.ContainerInstance/
// containerGroups for the ACI hybrid burst overflow. Its NSG mirrors the
// LocalDocker `NetworkMode: none` posture as closely as Azure allows:
//   - inbound: TCP 5757 (the in-runner agent) from the VM subnet ONLY
//   - outbound: deny all to Internet — preserves the C2 network=none claim
// See infra/azure/README.md for the image-pull caveat and how to verify
// the NSG-vs-pull behavior in the soak test.

param location string
param vmName string
param sshSourceIp string
param tags object

var vnetName = '${vmName}-vnet'
var subnetName = 'default'
var aciSubnetName = 'aci'
var nsgName = '${vmName}-nsg'
var aciNsgName = '${vmName}-aci-nsg'
var pipName = '${vmName}-pip'
var nicName = '${vmName}-nic'

// CIDR plan inside 10.20.0.0/16:
//   - default: 10.20.1.0/24 (VM, ~250 host IPs — plenty for one VM)
//   - aci:     10.20.2.0/24 (ACI overflow, 250+ ephemeral container IPs)
// 10.20.0.0/24 reserved for any future infra needing intra-VNet IPs;
// 10.20.3+/24 is free for additional subnets without re-CIDRing.
var defaultSubnetCidr = '10.20.1.0/24'
var aciSubnetCidr = '10.20.2.0/24'

resource nsg 'Microsoft.Network/networkSecurityGroups@2024-05-01' = {
  name: nsgName
  location: location
  tags: tags
  properties: {
    securityRules: [
      {
        name: 'AllowSSHFromAdmin'
        properties: {
          priority: 1000
          direction: 'Inbound'
          access: 'Allow'
          protocol: 'Tcp'
          sourceAddressPrefix: sshSourceIp
          sourcePortRange: '*'
          destinationAddressPrefix: '*'
          destinationPortRange: '22'
        }
      }
      {
        name: 'AllowHTTP'
        properties: {
          priority: 1010
          direction: 'Inbound'
          access: 'Allow'
          protocol: 'Tcp'
          sourceAddressPrefix: 'Internet'
          sourcePortRange: '*'
          destinationAddressPrefix: '*'
          destinationPortRange: '80'
        }
      }
      {
        name: 'AllowHTTPS'
        properties: {
          priority: 1020
          direction: 'Inbound'
          access: 'Allow'
          protocol: 'Tcp'
          sourceAddressPrefix: 'Internet'
          sourcePortRange: '*'
          destinationAddressPrefix: '*'
          destinationPortRange: '443'
        }
      }
    ]
  }
}

// ACI subnet NSG. Mirrors LocalDocker's `NetworkMode: none` posture as
// closely as Azure allows:
//   - inbound: ONLY TCP 5757 (sidecar agent) from the VM subnet — and
//     ONLY from the VM subnet, not from any other VNet peer or Internet.
//   - outbound: deny everything except VNet-internal so the ACI agent
//     can reply to the backend on the established TCP socket.
// The "deny outbound to Internet" rule preserves the C2 (network=none)
// security claim in the e2e/security-suite catalog.
//
// Image-pull caveat: ACI's hosting plane pulls the runner image at
// container-group create time, BEFORE the container's network namespace
// is bound to this NSG. So image pull from GHCR works even with all
// outbound denied here. If a future Azure update changes that, the
// soak test in slice 10 catches it (synthetic 30 concurrent sessions
// would all fail to spawn) and we'd switch to an ACR private mirror.
resource aciNsg 'Microsoft.Network/networkSecurityGroups@2024-05-01' = {
  name: aciNsgName
  location: location
  tags: tags
  properties: {
    securityRules: [
      {
        // Inbound from VM subnet to sidecar agent. Source-port wildcard
        // (high ephemerals); destination is fixed at the agent port.
        name: 'AllowAgentFromVmSubnet'
        properties: {
          priority: 1000
          direction: 'Inbound'
          access: 'Allow'
          protocol: 'Tcp'
          sourceAddressPrefix: defaultSubnetCidr
          sourcePortRange: '*'
          destinationAddressPrefix: '*'
          destinationPortRange: '5757'
        }
      }
      {
        // Belt-and-suspenders deny — the default Azure rules also deny,
        // but explicit-deny at a high priority makes the posture obvious
        // in the portal and survives any future default-rule change.
        name: 'DenyAllInbound'
        properties: {
          priority: 4096
          direction: 'Inbound'
          access: 'Deny'
          protocol: '*'
          sourceAddressPrefix: '*'
          sourcePortRange: '*'
          destinationAddressPrefix: '*'
          destinationPortRange: '*'
        }
      }
      {
        // Reply-traffic outbound — TCP back to the VM subnet so the
        // agent can answer the backend's HTTP requests. Other outbound
        // is denied so learner code can't reach the Internet (C2).
        name: 'AllowReplyToVmSubnet'
        properties: {
          priority: 1000
          direction: 'Outbound'
          access: 'Allow'
          protocol: 'Tcp'
          sourceAddressPrefix: '*'
          sourcePortRange: '*'
          destinationAddressPrefix: defaultSubnetCidr
          destinationPortRange: '*'
        }
      }
      {
        // Deny everything else outbound. Includes Internet, AzureCloud,
        // and the VirtualNetwork-broad default. Only the rule above
        // allows reply traffic to the specific VM subnet.
        name: 'DenyAllOutbound'
        properties: {
          priority: 4096
          direction: 'Outbound'
          access: 'Deny'
          protocol: '*'
          sourceAddressPrefix: '*'
          sourcePortRange: '*'
          destinationAddressPrefix: '*'
          destinationPortRange: '*'
        }
      }
    ]
  }
}

resource vnet 'Microsoft.Network/virtualNetworks@2024-05-01' = {
  name: vnetName
  location: location
  tags: tags
  properties: {
    addressSpace: {
      addressPrefixes: [ '10.20.0.0/16' ]
    }
    subnets: [
      {
        name: subnetName
        properties: {
          addressPrefix: defaultSubnetCidr
          networkSecurityGroup: { id: nsg.id }
        }
      }
      {
        // ACI subnet — delegated to Microsoft.ContainerInstance/containerGroups.
        // Delegation is required for ACI VNet deployment; without it,
        // beginCreateOrUpdate fails with "subnet not delegated."
        name: aciSubnetName
        properties: {
          addressPrefix: aciSubnetCidr
          networkSecurityGroup: { id: aciNsg.id }
          delegations: [
            {
              name: 'aciContainerGroups'
              properties: {
                serviceName: 'Microsoft.ContainerInstance/containerGroups'
              }
            }
          ]
        }
      }
    ]
  }
}

resource pip 'Microsoft.Network/publicIPAddresses@2024-05-01' = {
  name: pipName
  location: location
  tags: tags
  sku: { name: 'Standard' }
  properties: {
    publicIPAllocationMethod: 'Static'
    publicIPAddressVersion: 'IPv4'
    dnsSettings: {
      // Produces <vmName>.<region>.cloudapp.azure.com — stable across VM
      // stop/start/resize; Let's Encrypt happily issues certs for this.
      domainNameLabel: vmName
    }
  }
}

resource nic 'Microsoft.Network/networkInterfaces@2024-05-01' = {
  name: nicName
  location: location
  tags: tags
  properties: {
    ipConfigurations: [
      {
        name: 'ipconfig1'
        properties: {
          privateIPAllocationMethod: 'Dynamic'
          subnet: { id: '${vnet.id}/subnets/${subnetName}' }
          publicIPAddress: { id: pip.id }
        }
      }
    ]
  }
}

output nicId string = nic.id
output publicIp string = pip.properties.ipAddress
output fqdn string = pip.properties.dnsSettings.fqdn

// Phase 24B outputs — wired into the operator's KV-seeding step so
// AciExecutionBackend's container-group spec gets the right subnet ID
// at runtime. See infra/azure/README.md for the full seeding command.
output aciSubnetId string = '${vnet.id}/subnets/${aciSubnetName}'
output aciSubnetName string = aciSubnetName
