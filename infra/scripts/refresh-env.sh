#!/bin/bash
# /usr/local/bin/refresh-env — re-render /opt/codetutor/.env from Key Vault.
#
# Sourced from this repo on every deploy (vm-promote-candidate.sh) so adding a
# new KV secret propagates without VM reprovision. Per-VM identity values
# (KV_NAME, image tags, FQDN, admin email) live in /etc/codetutor/env.conf,
# which is written once at first-boot via cloud-init template substitution.
#
# Drift fix (2026-04-29): extracted from cloud-init.yaml's inline write_files
# entry. The previous shape baked {{KV_NAME}} + sibling template vars into
# the shipped script at first-boot only; subsequent edits to cloud-init.yaml
# never reached the live VM unless someone SSH'd in and patched manually.
# Now this file is the source of truth and a deploy step keeps the VM in sync.

set -euo pipefail

# Per-VM identity. env.conf is written by cloud-init at first-boot with
# template-substituted values; rare manual edits are accepted (e.g. when
# the VM FQDN changes). Missing → hard fail (we'd otherwise write empty
# values into .env and silently take the backend down on next recreate).
ENV_CONF=/etc/codetutor/env.conf
if [ ! -f "$ENV_CONF" ]; then
  echo "[refresh-env] $ENV_CONF missing — refusing to render .env" >&2
  exit 1
fi
# shellcheck disable=SC1090,SC1091
source "$ENV_CONF"

: "${KV_NAME:?KV_NAME must be set in $ENV_CONF}"
: "${BACKEND_IMAGE:?BACKEND_IMAGE must be set in $ENV_CONF}"
: "${RUNNER_IMAGE:?RUNNER_IMAGE must be set in $ENV_CONF}"
: "${VM_FQDN:?VM_FQDN must be set in $ENV_CONF}"
: "${ADMIN_EMAIL:?ADMIN_EMAIL must be set in $ENV_CONF}"

ENV_FILE=/opt/codetutor/.env
COMPOSE_DIR=/opt/codetutor
TMP=$(mktemp)
chmod 0600 "$TMP"

# Managed-identity login. --allow-no-subscriptions: the VM MI has no
# subscription-level role, only KV secret reads, so skip sub hydrate.
az login --identity --allow-no-subscriptions >/dev/null

fetch() {
  az keyvault secret show --vault-name "$KV_NAME" --name "$1" \
    --query value -o tsv
}

# Soft variant for secrets that are optional in prod — returns empty
# string when the KV secret doesn't exist, so refresh-env doesn't fail
# under `set -e`. Backend treats empty string as "not configured".
fetch_optional() {
  az keyvault secret show --vault-name "$KV_NAME" --name "$1" \
    --query value -o tsv 2>/dev/null || echo ""
}

# Plain echoes into a grouped redirect — no heredocs (kept the same shape
# as the prior cloud-init inline script for diff-friendliness).
{
  echo "SUPABASE_URL=$(fetch SUPABASE-URL)"
  echo "SUPABASE_SERVICE_ROLE_KEY=$(fetch SUPABASE-SERVICE-ROLE-KEY)"
  echo "DATABASE_URL=$(fetch DATABASE-URL)"
  echo "BYOK_ENCRYPTION_KEY=$(fetch BYOK-ENCRYPTION-KEY)"
  # Phase 26 (audit M-1): BYOK rotation support. V2/V3 + CURRENT_VERSION
  # are optional; absent → legacy single-key shape (V1 only). Operator
  # uses these for the rotation sequence:
  #   1. Set BYOK-ENCRYPTION-KEY-V2 in KV (new key)
  #   2. refresh-env on VM → V2 now decryptable
  #   3. Set BYOK-CURRENT-VERSION=2 → new writes use V2
  #   4. Run re-encrypt sweep cron (separate job)
  #   5. After 0 V1 rows remain, delete BYOK-ENCRYPTION-KEY (or KEY-V1)
  echo "BYOK_ENCRYPTION_KEY_V2=$(fetch_optional BYOK-ENCRYPTION-KEY-V2)"
  echo "BYOK_ENCRYPTION_KEY_V3=$(fetch_optional BYOK-ENCRYPTION-KEY-V3)"
  echo "BYOK_CURRENT_VERSION=$(fetch_optional BYOK-CURRENT-VERSION)"
  echo "VITE_SUPABASE_URL=$(fetch VITE-SUPABASE-URL)"
  echo "VITE_SUPABASE_ANON_KEY=$(fetch VITE-SUPABASE-ANON-KEY)"
  # Optional: METRICS-TOKEN gates /api/metrics. When absent from KV
  # the endpoint is loopback-only (fine for prod today — no external
  # scraper). Seed it in KV when wiring in Prometheus.
  echo "METRICS_TOKEN=$(fetch_optional METRICS-TOKEN)"
  # Release 0A: purpose-specific HMAC for SWA crawler metadata. Current +
  # previous pairs provide a zero-downtime rotation overlap. The preview
  # route remains fail-closed (503) when no current secret is configured;
  # public browser share reads are independent and stay live.
  echo "SHARE_PREVIEW_HMAC_CURRENT_KEY_ID=$(fetch_optional SHARE-PREVIEW-HMAC-CURRENT-KEY-ID)"
  echo "SHARE_PREVIEW_HMAC_CURRENT_SECRET=$(fetch_optional SHARE-PREVIEW-HMAC-CURRENT-SECRET)"
  echo "SHARE_PREVIEW_HMAC_PREVIOUS_KEY_ID=$(fetch_optional SHARE-PREVIEW-HMAC-PREVIOUS-KEY-ID)"
  echo "SHARE_PREVIEW_HMAC_PREVIOUS_SECRET=$(fetch_optional SHARE-PREVIEW-HMAC-PREVIOUS-SECRET)"
  echo "SHARE_PREVIEW_DISABLED=$(fetch_optional SHARE-PREVIEW-DISABLED)"
  # Phase 20-P4: Free AI tier. All six are fetched as optional so a
  # first boot without these KV secrets (older envs, or a rebuild
  # before P4 ships) still comes up cleanly — absent values just mean
  # free tier stays off. assertConfigValid only requires the OpenAI
  # key when ENABLE_FREE_TIER=1. To flip the feature on: rotate the
  # ENABLE-FREE-TIER secret to "1" and re-run refresh-env.
  echo "ENABLE_FREE_TIER=$(fetch_optional ENABLE-FREE-TIER)"
  echo "FREE_TIER_DAILY_QUESTIONS=$(fetch_optional FREE-TIER-DAILY-QUESTIONS)"
  echo "FREE_TIER_DAILY_USD_PER_USER=$(fetch_optional FREE-TIER-DAILY-USD-PER-USER)"
  echo "FREE_TIER_LIFETIME_USD_PER_USER=$(fetch_optional FREE-TIER-LIFETIME-USD-PER-USER)"
  echo "FREE_TIER_DAILY_USD_CAP=$(fetch_optional FREE-TIER-DAILY-USD-CAP)"
  echo "PLATFORM_OPENAI_API_KEY=$(fetch_optional PLATFORM-OPENAI-API-KEY)"
  # Phase 22A: backend-originated email via Azure Communication
  # Services. Used for budget alerts (50/80/100% of daily $ cap) and
  # the Phase 22D streak-nudge retention email. Optional fetches —
  # in dev or first-boot envs where these aren't seeded yet, the
  # backend boots fine and email-send paths throw
  # EmailNotConfiguredError (caught + logged by callers).
  echo "ACS_CONNECTION_STRING=$(fetch_optional ACS-CONNECTION-STRING)"
  echo "ACS_SENDER_EMAIL=$(fetch_optional ACS-SENDER-EMAIL)"
  echo "OPERATOR_ALERT_EMAIL=$(fetch_optional OPERATOR-ALERT-EMAIL)"
  # Phase 22D: HMAC secret for one-click unsubscribe links in the
  # streak nudge email. Tokens never expire, so rotating this
  # secret invalidates ALL outstanding unsubscribe links at once.
  # Optional — if missing, digestSweeper logs and refuses to send
  # (CAN-SPAM floor: never send without a working unsub link).
  # Generate with: openssl rand -base64 48
  # Then store: az keyvault secret set --vault-name <kv> \
  #               --name EMAIL-UNSUBSCRIBE-SECRET --value "<value>"
  echo "EMAIL_UNSUBSCRIBE_SECRET=$(fetch_optional EMAIL-UNSUBSCRIBE-SECRET)"
  # Phase 24B: ACI hybrid burst overflow. All optional — when these
  # secrets are absent (default), the backend's factory falls through
  # to plain LocalDocker and HybridBackend is never constructed. To
  # activate: seed the secrets in KV and flip ENABLE-ACI-OVERFLOW=1.
  # See memory: project_phase_24b_iam_bootstrap.md for the full
  # 5-step activation runbook.
  echo "ENABLE_ACI_OVERFLOW=$(fetch_optional ENABLE-ACI-OVERFLOW)"
  echo "AZURE_SUBSCRIPTION_ID=$(fetch_optional AZURE-SUBSCRIPTION-ID)"
  echo "AZURE_RG=$(fetch_optional AZURE-RG)"
  echo "AZURE_LOCATION=$(fetch_optional AZURE-LOCATION)"
  echo "ACI_SUBNET_ID=$(fetch_optional ACI-SUBNET-ID)"
  echo "ACI_RUNNER_IMAGE=$(fetch_optional ACI-RUNNER-IMAGE)"
  echo "ACI_SIDECAR_PORT=$(fetch_optional ACI-SIDECAR-PORT)"
  echo "ACI_COLD_START_TIMEOUT_MS=$(fetch_optional ACI-COLD-START-TIMEOUT-MS)"
  echo "ACI_DAILY_USD_CAP=$(fetch_optional ACI-DAILY-USD-CAP)"
  echo "ACI_MAX_OVERFLOW=$(fetch_optional ACI-MAX-OVERFLOW)"
  echo "ACI_WARM_POOL_ENABLED=$(fetch_optional ACI-WARM-POOL-ENABLED)"
  # Non-secret prod config. CORS is sourced from KV (`CORS-ORIGIN`)
  # so the frontend hostname is never hardcoded in the provisioning
  # template — avoids the template/live-script drift that bit us when
  # the custom domain was added post-provisioning and refresh-env on
  # the live VM kept substituting the original SWA default. Rate
  # limits back to prod-tight values (dev's 500/2000/500 headroom was
  # for the parallel e2e workers, not real traffic).
  echo "BACKEND_PORT=4000"
  echo "BACKEND_BIND=127.0.0.1"
  echo "CORS_ORIGIN=$(fetch CORS-ORIGIN)"
  echo "BACKEND_IMAGE=${BACKEND_IMAGE}"
  echo "RUNNER_IMAGE=${RUNNER_IMAGE}"
  echo "DOCKER_HOST=tcp://socket-proxy:2375"
  echo "WORKSPACE_ROOT=/workspace-root"
  echo "WORKSPACE_HOST_PATH=/opt/codetutor/temp/sessions"
  echo "SESSION_CREATE_RATE_LIMIT_MAX=30"
  echo "MUTATION_RATE_LIMIT_MAX=120"
  echo "AI_RATE_LIMIT_MAX=60"
  # Phase 24B-resize: session caps from KV so the operator can rotate
  # them without a code change when resizing the VM SKU. Both optional
  # — empty values mean config.ts defaults apply (maxPerUser=2,
  # maxGlobal=5 on B2s, was 14 on B2ms). Set MAX-SESSIONS-GLOBAL in
  # KV when resizing up; this wire-through lets the new value land
  # via `refresh-env.sh` + force-recreate, no redeploy needed.
  echo "MAX_SESSIONS_PER_USER=$(fetch_optional MAX-SESSIONS-PER-USER)"
  echo "MAX_SESSIONS_GLOBAL=$(fetch_optional MAX-SESSIONS-GLOBAL)"
  echo "VM_FQDN=${VM_FQDN}"
  echo "ADMIN_EMAIL=${ADMIN_EMAIL}"
} > "$TMP"

chown codetutor:codetutor "$TMP"

# Phase 20-P3: detect env changes and force-recreate the backend when
# something rotated. Docker compose `up -d` (without --force-recreate)
# is a no-op for containers whose compose-level config is unchanged —
# .env var diffs don't trigger a restart on their own. Without this,
# rotating BYOK_ENCRYPTION_KEY in Key Vault would silently do nothing
# until a VM reboot, and the next boot's freshly-recreated container
# would come up with the new master key → every stored ciphertext
# suddenly undecryptable. Force-recreate on change closes that gap.
#
# Only fires when the backend is already running (codetutor-ai.service
# up). During first boot the containers don't exist yet; the main
# compose-up in codetutor-ai.service will pick up the fresh env
# directly — no need to recreate anything.
old_hash=""
if [ -f "$ENV_FILE" ]; then
  old_hash=$(sha256sum "$ENV_FILE" | awk '{print $1}')
fi
new_hash=$(sha256sum "$TMP" | awk '{print $1}')

mv "$TMP" "$ENV_FILE"

if [ "$old_hash" != "$new_hash" ] && [ -n "$old_hash" ]; then
  echo "[refresh-env] env changed (old=${old_hash:0:8} new=${new_hash:0:8})"
  # Only recreate if the stack is actually up — if this runs during a
  # shutdown window, skip and let the next main-service start handle it.
  if sudo -u codetutor docker compose \
    -f "$COMPOSE_DIR/docker-compose.yml" \
    -f "$COMPOSE_DIR/docker-compose.prod.yml" \
    --env-file "$ENV_FILE" ps --status running --quiet backend | grep -q .; then
    echo "[refresh-env] force-recreating backend to pick up new env"
    sudo -u codetutor docker compose \
      -f "$COMPOSE_DIR/docker-compose.yml" \
      -f "$COMPOSE_DIR/docker-compose.prod.yml" \
      --env-file "$ENV_FILE" up -d --force-recreate --no-deps backend
  else
    echo "[refresh-env] backend not running; skipping recreate"
  fi
else
  echo "[refresh-env] env unchanged (hash=${new_hash:0:8})"
fi
