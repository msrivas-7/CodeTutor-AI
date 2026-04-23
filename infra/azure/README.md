# Azure prod infrastructure

Single-VM topology for the CodeTutor AI prod environment. VM runs the backend
stack via `docker compose`; Static Web Apps hosts the frontend; Key Vault
holds all runtime secrets; Log Analytics + Azure Monitor alert on VM health.

## Files

| Path | Purpose |
| --- | --- |
| `main.bicep` | Top-level template — calls the modules. |
| `main.parameters.json` | Non-secret parameter values (region, VM size, etc). |
| `modules/network.bicep` | VNet, NSG, Standard public IP (with `cloudapp.azure.com` FQDN), NIC. |
| `modules/vm.bicep` | Ubuntu 24.04 B2s + system-assigned MI + Azure Monitor Agent + DCR. |
| `modules/keyvault.bicep` | RBAC-mode KV + Secrets Officer role for bootstrap principal. |
| `modules/monitoring.bicep` | Log Analytics workspace + action group. |
| `modules/vm-health-alert.bicep` | Activity log alert on VM ResourceHealth. |
| `modules/alerts.bicep` | Scheduled-query alerts against Log Analytics — memory ≥90%, CPU ≥85%, OS disk ≥80% (+ 70% warning tier), syslog OOM-kill, container-log-backed alerts on BYOK decrypt failure / unhandled rejections / platform-cost anomaly + App Insights availability tests for `/api/health/deep` and SWA root. |
| `modules/vm-kv-access.bicep` | Grants VM MI "Key Vault Secrets User" on the KV. |
| `modules/swa.bicep` | Azure Static Web App (Free), unlinked. |
| `modules/backup.bicep` | Recovery Services Vault + weekly backup policy (4-week retention). |

## One-time setup

1. **SSH key for VM admin.** Keep this separate from your personal key so it
   can be rotated without touching anything else:
   ```bash
   ssh-keygen -t ed25519 -f ~/.ssh/codetutor_ai_vm -C codetutor-ai-vm-admin -N ""
   ```

2. **Resource group.**
   ```bash
   az group create -n codetutor-ai-prod-rg -l eastus2
   ```

3. **Bootstrap principal.** Used to seed KV secrets post-deploy. Under normal
   use this is you (the admin running deploys):
   ```bash
   BOOTSTRAP_OID=$(az ad signed-in-user show --query id -o tsv)
   ```

## Deploy

```bash
az deployment group create \
  -g codetutor-ai-prod-rg \
  --template-file main.bicep \
  --parameters @main.parameters.json \
  --parameters \
    adminPublicKey="$(cat ~/.ssh/codetutor_ai_vm.pub)" \
    sshSourceIp="$(curl -s https://checkip.amazonaws.com)/32" \
    bootstrapPrincipalObjectId="$BOOTSTRAP_OID"
```

Idempotent — re-run whenever `main.bicep` changes. The deployment prints the
VM FQDN, public IP, KV name, and SWA hostname as outputs. Save them for the
cloud-init step.

## Seed Key Vault secrets (post-deploy)

Once the deployment finishes, write the secrets the backend needs. The KV
name is in the deployment outputs:

```bash
KV=$(az deployment group show -g codetutor-ai-prod-rg -n main --query properties.outputs.keyVaultName.value -o tsv)

az keyvault secret set --vault-name "$KV" --name SUPABASE-URL               --value "..."
az keyvault secret set --vault-name "$KV" --name SUPABASE-SERVICE-ROLE-KEY --value "..."
az keyvault secret set --vault-name "$KV" --name DATABASE-URL              --value "..."
az keyvault secret set --vault-name "$KV" --name BYOK-ENCRYPTION-KEY       --value "..."
az keyvault secret set --vault-name "$KV" --name VITE-SUPABASE-URL         --value "..."
az keyvault secret set --vault-name "$KV" --name VITE-SUPABASE-ANON-KEY    --value "..."
az keyvault secret set --vault-name "$KV" --name CORS-ORIGIN               --value "https://codetutor.msrivas.com"
```

### Operator-funded tutor tier (optional)

Seed these only when enabling the operator-funded allowance so signed-in
learners without BYOK can reach the tutor on an operator-held OpenAI key.
`refresh-env` reads each via `fetch_optional` — any one missing keeps the
tier off. Cap values are chosen per deployment and documented in the
private ops runbook, not here.

```bash
az keyvault secret set --vault-name "$KV" --name ENABLE-FREE-TIER                --value "0"
az keyvault secret set --vault-name "$KV" --name FREE-TIER-DAILY-QUESTIONS       --value "..."
az keyvault secret set --vault-name "$KV" --name FREE-TIER-DAILY-USD-PER-USER    --value "..."
az keyvault secret set --vault-name "$KV" --name FREE-TIER-LIFETIME-USD-PER-USER --value "..."
az keyvault secret set --vault-name "$KV" --name FREE-TIER-DAILY-USD-CAP         --value "..."
az keyvault secret set --vault-name "$KV" --name PLATFORM-OPENAI-API-KEY         --value "sk-..."
```

`docker compose restart backend` is NOT sufficient after rotating any of
these — it keeps the container's original env. Use
`docker compose up -d --force-recreate backend` so compose re-reads `.env`.
Verify with `docker exec codetutor-backend-1 printenv <VAR>` before
declaring the rotation complete.

`METRICS-TOKEN` — **recommended to set by default** even before you wire in
an external scraper. When absent, `/api/metrics` falls back to loopback-only
(`127.0.0.1` / `::1` / `::ffff:127.0.0.1`) via `req.ip`. That check relies
on `trust proxy = 1` + Caddy as the only hop; a future operator who drops a
Prometheus container on the backend's own Docker bridge will hit the
backend with a non-loopback `req.ip` and get `403 forbidden` with no hint
about why. Seeding a token up-front eliminates that debugging trap.

```bash
az keyvault secret set --vault-name "$KV" --name METRICS-TOKEN \
  --value "$(openssl rand -base64 32)"
```

After seeding, scrape with `Authorization: Bearer <token>`. The token is
picked up by `refresh-env` on the next daily tick, or immediately via
`sudo systemctl restart codetutor-refresh-env.service` followed by
`docker compose up -d --force-recreate backend`.

Secret names use hyphens (KV disallows underscores); the `refresh-env` script
on the VM maps them back to `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` /
etc. when writing the VM's `.env`.

## Enable VM backup (one-time, post-deploy)

The `backup.bicep` module creates the Recovery Services Vault + weekly
policy, but enrolling the VM as a protected item is a separate step —
Bicep's protected-item resource name format is finicky enough that it's
cleaner as a CLI call:

```bash
VAULT=$(az deployment group show -g codetutor-ai-prod-rg -n main --query properties.outputs.backupVaultName.value -o tsv)
POLICY=$(az deployment group show -g codetutor-ai-prod-rg -n main --query properties.outputs.backupPolicyName.value -o tsv)

az backup protection enable-for-vm \
  --resource-group codetutor-ai-prod-rg \
  --vault-name "$VAULT" \
  --vm codetutor-ai-vm \
  --policy-name "$POLICY"
```

Idempotent in the sense that re-running when protection is already enabled
fails with a clear error. To change the policy on a VM that's already
protected, use `az backup protection update-for-vm` instead.

To verify the first backup fires as expected, check after the next Sunday
02:00 UTC:
```bash
az backup job list \
  --resource-group codetutor-ai-prod-rg \
  --vault-name "$VAULT" \
  --query "[?properties.entityFriendlyName=='codetutor-ai-vm']"
```

## Tight SSH source

`sshSourceIp` is locked to your current public IP. If it changes, re-deploy
with the new CIDR — the NSG rule updates in place, no VM restart required.

## Operational hardening

The cloud-init + alerts module cover the "no observability past heartbeat"
and "OOM kills the box" gaps:

- **2 GB swap** + `vm.swappiness=10` added at first boot. B2s has no swap
  by default, so a single memory spike went straight to the OOM killer.
- **Unattended-upgrades auto-reboot at 03:00 UTC** — kernel/security
  updates installed by `unattended-upgrades` now actually apply. See
  `/etc/apt/apt.conf.d/52unattended-upgrades-reboot` on the VM.
- **Session workspace cleanup timer** — `codetutor-session-cleanup.timer`
  runs hourly, prunes dirs under `/opt/codetutor/temp/sessions` older than
  24 hours (widened from 120 min in bucket 7 so it can't race the in-
  process sweeper at `config.session.idleTimeoutMs` ≈ 45 min). Backend's
  startup orphan-purge handles restarts; this handles steady-state growth.
- **Metric alerts** (via `modules/alerts.bicep`) email the admin action
  group on sustained high memory / CPU / disk plus any OOM-killer syslog
  signal. These complement the existing VM ResourceHealth alert.

### Disk growth risk (bucket 6)

`/opt/codetutor/temp/sessions` is the host-side backing for every runner
container's workspace (bind-mounted as `/home/runner/workspace`). A stuck
or mis-reaped session can leave behind multi-GB `.venv` / `node_modules` /
`target/` trees — at 32 GB total disk with ~12 GB consumed by OS + Docker
images + journald at steady state, 10 leaked sessions can fill the
remaining headroom in under an hour.

Two defense layers:
1. `codetutor-session-cleanup.timer` prunes sessions older than 120 min
   hourly (see "Session workspace cleanup timer" above).
2. Two scheduled-query alerts in `modules/alerts.bicep` — `codetutor-vm-
   disk-warning` at 70% (severity 4, lead indicator) and
   `codetutor-vm-disk-high` at 80% (severity 3, paging). The 70% tier
   gives ~2–3 GB of runway to `docker system prune` +
   `journalctl --vacuum-size=100M` before the louder one fires.

If the warning tier fires persistently without the paging tier crossing,
investigate the sweeper first: `systemctl status codetutor-session-cleanup`,
then `ls -lah /opt/codetutor/temp/sessions/` for ownership / mtime anomalies.

### Budget + daily LA ingest cap (bucket 6)

- **Resource-group monthly budget** (`codetutor-ai-rg-monthly`, default $30)
  alerts at 80% actual + 100% forecast. Tune via the `monthlyBudgetUsd`
  param on the `monitoring` module when B2s gets upgraded or extra
  services (App Insights traffic, ACS Email volume) push the floor up.
- **Log Analytics daily ingest cap** (`workspaceCapping.dailyQuotaGb: 1`)
  drops new rows after 1 GB in a day. Steady-state ingest is ~100 MB/day;
  a breach means either an upstream log-storm OR a new stream landed
  (e.g. adding a custom table without sizing it). When the cap trips
  alerts still fire from pre-cap data but the Kusto dataset goes stale —
  raise the cap briefly + investigate the source.

### Container log ingestion (bucket 6)

The DCR in `modules/vm.bicep` tails `/var/lib/docker/containers/*/*-json.log`
and lands the lines into a `ContainerLog_CL` custom table. Three alerts
key off this table:
- `codetutor-byok-decrypt-failed` — `"byok_decrypt_failed"` marker (sev 1).
- `codetutor-backend-unhandled-rejections` — `"unhandledRejection"` marker,
  ≥5 in 30m (sev 2).
- `codetutor-platform-cost-anomaly` — `"platform_cost_hourly"` +
  `"exceeded":true` from the hourly sampler (sev 2).

If the alerts never fire under a fault injection, check
`ContainerLog_CL | take 10` in the LA query console first — the usual
cause is the Docker log-driver switching away from `json-file` or the
DCR association missing from the VM.

### App Insights availability tests (bucket 6)

Two Standard webtests (`modules/alerts.bicep`) probe the public-facing
URLs from 5 US Azure regions every 5 min:
- `codetutor-api-health` → `https://<vm-fqdn>/api/health/deep`
- `codetutor-swa-root` → `https://<swa-hostname>/`

Alerts fire on 2+ failing locations in a 5-min window. The backend probe
also enforces TLS + cert-lifetime ≥7 days, so an expired Caddy cert pages
before users hit the outage. When the custom domain lands, rewire
`healthEndpoint` in `main.bicep` to `https://api.codetutor.msrivas.com/api/health/deep`.

## Image pinning

The deploy workflow pushes each backend/runner build to GHCR under both
`:<github.sha>` and `:latest`. On the VM, `infra/scripts/vm-deploy-backend.sh`
pulls the specific SHA tag and retags it to `:latest` locally so compose
always runs an immutable image. Rollback pulls `${IMAGE}:${PREV_SHA}`
directly — no reliance on local cache surviving a VM rebuild.

## Runbooks (bucket 7)

These are the incident / rotation procedures we expect to need under
outage pressure. Keep them callable verbatim — anything that requires a
judgment call during an incident belongs somewhere else.

**Live values** (current deployer CIDR, latest backup job ID, exact
rotation dates, admin email) live in [`ops/runbook-values.local.md`](../../ops/)
— gitignored per-machine file. First-time setup:
`cp ops/runbook-values.example.md ops/runbook-values.local.md` and fill in.
References below spelled `$RSV_VAULT`, `$KV`, etc. come from there.

### VM restore drill (S-1)

Backups fire weekly Sunday 02:00 UTC via the Recovery Services Vault
(`$RSV_VAULT`, see `modules/backup.bicep`) with 4-week retention.
The procedure below restores a backed-up point-in-time image to a
side-by-side VM so we can verify the snapshot without disturbing prod —
run it **quarterly** so the restore path is known-working the day it's
actually needed.

1. Source the local values, then list recent recovery points:
   ```bash
   # Values from ops/runbook-values.local.md
   RG=codetutor-ai-prod-rg
   VM=codetutor-ai-vm
   RSV_VAULT=<from runbook-values.local.md>
   az backup recoverypoint list \
     --resource-group "$RG" --vault-name "$RSV_VAULT" \
     --container-name "$VM" --item-name "$VM" \
     -o table
   ```
2. Pick the most recent `Completed` point and trigger a restore to a new
   disk (not an in-place swap — we never clobber the live VM during a
   drill):
   ```bash
   az backup restore restore-disks \
     --resource-group "$RG" --vault-name "$RSV_VAULT" \
     --container-name "$VM" --item-name "$VM" \
     --rp-name <RECOVERY_POINT_NAME> \
     --storage-account <SA_FOR_RESTORE> \
     --restore-to-staging-storage-account
   ```
3. Attach the restored disk to a fresh VM (portal is fine for this step;
   the drill is about "do we have the bytes", not infra-as-code reps).
   Sanity-check: `systemctl status codetutor-ai` comes up, `/api/health`
   returns green, `.env` has the expected KV-sourced values.
4. Delete the drill VM + disks after verification so the RSV bill doesn't
   drift.
5. Log the drill in `ops/runbook-values.local.md` (date + recovery-point
   name restored + any issues).

When an actual restore is needed, skip the staging-account step and use
`--restore-mode OriginalLocation` to overwrite the prod VM's disk.

### 03:00 UTC reboot window (S-14)

`/etc/apt/apt.conf.d/52unattended-upgrades-reboot` sets
`Automatic-Reboot "true"` with `Automatic-Reboot-Time "03:00"` UTC.
Reboots trigger only when a security upgrade actually landed AND flagged
a reboot — they're not daily. During the reboot:
- `codetutor-ai.service` stops via systemd, triggering the 30 s shutdown
  grace (bucket 7, S-13) so in-flight SSE streams flush their ledger row.
- Caddy terminates with the VM; TLS connections drop. The edge does not
  drain gracefully — a learner mid-turn will see a connection reset.
- Backend restarts on boot; `/api/health/deep` typically returns green
  within 30–60 s.

Before manual reboots during business hours, check active session count:
```bash
ssh codetutor-ai-vm.eastus2.cloudapp.azure.com \
  'curl -s http://127.0.0.1:4000/api/health/deep | jq .sessions'
```
If `activeSessions > 0`, either wait or accept the user-visible reset.
(We don't gate systemd reboots on this — the 03:00 UTC window was
picked because learner traffic is near-zero — just use this before
operator-initiated reboots.)

### Serial-console break-glass (S-16)

If SSH lockout happens (bad NSG rule, misconfigured `sshSourceIp`, lost
SSH key), Azure's serial-console is the only way in without reprovisioning:
1. Portal → VM → Support + troubleshooting → Serial console. Sign in
   with the VM admin user (name in `ops/runbook-values.local.md`);
   password-based login is disabled, so set a one-time password first:
   ```bash
   az vm user update -g codetutor-ai-prod-rg -n codetutor-ai-vm \
     -u <admin-user> -p "$(openssl rand -base64 24)"
   ```
   (Reverts when cloud-init re-runs; or `az vm user delete` to clean up.)
2. Fix the underlying issue (NSG re-open, restore SSH authorized_keys,
   etc), then rotate the temp password out.

**Deployer CIDR:** the NSG rule for `sshSourceIp` is whatever CIDR the
last deploy was run from. Record the current deployer CIDR in
`ops/runbook-values.local.md` so you can re-deploy from a known-good
address when you need to. Refresh it whenever the deploy host's public
IP shifts (coffee shop, home → office, etc):
```bash
# Refresh in ops/runbook-values.local.md:
curl -s https://checkip.amazonaws.com
# Then re-run main.bicep with sshSourceIp="<that>/32" to update the NSG in place.
```

### BYOK_ENCRYPTION_KEY rotation (S-19)

**User-visible impact — notify users first.** Every per-user BYOK OpenAI
key stored in `user_preferences.openai_api_key_cipher` is AES-GCM
encrypted under this master key. Rotating the master key *without*
re-encrypting existing ciphertexts makes every stored BYOK key suddenly
undecryptable — learners with a stored BYOK will see "provider auth
failed" until they re-paste their key.

The safe rotation sequence:
1. Post a banner notifying users (frontend has a `GET /api/status`-fed
   notice mechanism — pick copy along the lines of "one-time: re-paste
   your OpenAI key after 2026-05-01 04:00 UTC").
2. Wait ≥24 h for the notice to reach users.
3. At the announced time:
   ```bash
   NEW_KEY=$(openssl rand -base64 32)
   az keyvault secret set --vault-name "$KV" --name BYOK-ENCRYPTION-KEY \
     --value "$NEW_KEY"
   az vm run-command invoke -g codetutor-ai-prod-rg -n codetutor-ai-vm \
     --command-id RunShellScript \
     --scripts 'systemctl start codetutor-ai-refresh-env.service'
   ```
   `refresh-env` detects the env hash change and force-recreates the
   backend (bucket 6 wiring). All stored ciphertexts immediately return
   the "provider auth failed" error surface on decrypt.
4. Users re-paste their BYOK keys on next visit; the BYOK modal's
   "failed to decrypt" path triggers re-entry.
5. Log the rotation date in `ops/runbook-values.local.md` (rotation
   history table). Next planned rotation ≥ 12 months out unless a leak
   is suspected.

**Never** skip the notice. The rotation itself is instant; the user
impact is the recovery window.

### PLATFORM_OPENAI_API_KEY rotation (operator-funded free tier)

No user-visible impact — platform-held key. Rotate when the current key
is suspected leaked or when Platform spend policy changes.
```bash
az keyvault secret set --vault-name "$KV" --name PLATFORM-OPENAI-API-KEY \
  --value "sk-..."
az vm run-command invoke -g codetutor-ai-prod-rg -n codetutor-ai-vm \
  --command-id RunShellScript \
  --scripts 'systemctl start codetutor-ai-refresh-env.service'
```
Verify: `docker exec codetutor-backend-1 printenv PLATFORM_OPENAI_API_KEY`
returns the new value, and `/api/health/deep` → `platformAuth.ok: true`.

### SUPABASE_SERVICE_ROLE_KEY rotation

No user-visible impact during the rotation itself, BUT the rotation
procedure involves a brief window where the backend can't talk to
Supabase — queue any ops work that doesn't need DB access during the
minute-long recreate.
1. Rotate at Supabase (project → Settings → API → "Rotate service role
   key"). Copy the new key.
2. Write to KV and refresh:
   ```bash
   az keyvault secret set --vault-name "$KV" --name SUPABASE-SERVICE-ROLE-KEY \
     --value "<new-key>"
   az vm run-command invoke -g codetutor-ai-prod-rg -n codetutor-ai-vm \
     --command-id RunShellScript \
     --scripts 'systemctl start codetutor-ai-refresh-env.service'
   ```
3. Verify `/api/health/deep` → `db.ok: true`. If red, the old key is
   still cached somewhere (Supabase's edge, typically); wait 60 s and
   retry the refresh-env service.

## What this does NOT include

- **VM provisioning** (cloud-init, systemd units, Caddy compose service) —
  see `infra/azure/cloud-init.yaml` + compose overrides.
- **CI/CD** — see `.github/workflows/deploy.yml`.
- **SWA → repo linking** — use the portal's GitHub App flow after deploy;
  it auto-generates the deployment workflow.
- **Custom domain** — `codetutor.msrivas.com` is the user-facing URL. Both
  the apex CNAME (SWA) and the `CORS_ORIGIN` KV secret point at it. The
  Azure-provided FQDNs (`*.azurestaticapps.net`,
  `codetutor-ai-vm.eastus2.cloudapp.azure.com`) stay reachable as fallbacks.
