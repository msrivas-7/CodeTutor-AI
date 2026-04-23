# Local runbook values — template

Copy to `ops/runbook-values.local.md` and fill in. This file is
committed; your `.local.md` copy is gitignored. Update the local copy
after every quarterly drill and every key rotation.

## Azure resources

| Key | Value |
| --- | --- |
| Resource group | `codetutor-ai-prod-rg` |
| VM name | `codetutor-ai-vm` |
| VM FQDN | `codetutor-ai-vm.eastus2.cloudapp.azure.com` |
| Key Vault name | `<look up from deployment outputs>` |
| Recovery Services Vault | `<look up from bicep outputs>` |
| Log Analytics workspace | `<look up from bicep outputs>` |
| SWA hostname | `<look up from deployment outputs>` |

These are public-infra names — the values ARE derivable from bicep
modules, but writing them here once saves a shell spin-up during an
incident.

## Operator identities

| Key | Value |
| --- | --- |
| Admin email (action-group target) | `you@example.com` |
| Current deployer CIDR | `0.0.0.0/32` (refresh via `curl https://checkip.amazonaws.com`) |
| VM admin SSH key fingerprint | `<ssh-keygen -lf ~/.ssh/codetutor_ai_vm.pub>` |

## Rotation history

Fill in after each rotation. The "planned next" column is what drives
your calendar reminder.

| Secret | Last rotated | Planned next | Reason |
| --- | --- | --- | --- |
| `BYOK-ENCRYPTION-KEY` | `YYYY-MM-DD` | `YYYY-MM-DD` | |
| `PLATFORM-OPENAI-API-KEY` | `YYYY-MM-DD` | `YYYY-MM-DD` | |
| `SUPABASE-SERVICE-ROLE-KEY` | `YYYY-MM-DD` | `YYYY-MM-DD` | |
| ACS Email client secret | `YYYY-MM-DD` | `2028-04-21` (hard expiry) | |

## Backup / restore-drill state

| Key | Value |
| --- | --- |
| Last successful backup job ID | `<az backup job list ...>` |
| Last restore drill | `YYYY-MM-DD` |
| Next restore drill due | `YYYY-MM-DD` (quarterly) |
| Storage account used for last drill | `<name>` |

## Incident log

Brief notes on notable events. Full postmortems go in a committed
`docs/postmortems/` when they're worth the team reading.

- `YYYY-MM-DD`: short description — what broke, how long, what changed.
