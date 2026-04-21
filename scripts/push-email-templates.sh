#!/usr/bin/env bash
# Push branded email templates to a Supabase project's auth config.
# Uses the Management API (PATCH /v1/projects/{ref}/config/auth) so it only
# updates the six mailer_* fields — never touches SMTP, OAuth, rate limits,
# or anything else configured in the Dashboard.
#
# Usage:  scripts/push-email-templates.sh {dev|prod}
#
# Token resolution: $SUPABASE_ACCESS_TOKEN wins; otherwise reads
# ~/.supabase/access-token; otherwise (macOS) reads the keychain entry
# Supabase CLI writes on `supabase login`. The keychain value has a
# `go-keyring-base64:` prefix from the go-keyring library — strip + decode.

set -euo pipefail

ENV_NAME="${1:-}"
case "$ENV_NAME" in
  dev)  PROJECT_REF="jizysywayotcmapgnbrc" ;;
  prod) PROJECT_REF="aocqmabbcqrpkcuabzbr" ;;
  *)    echo "usage: $0 {dev|prod}" >&2; exit 2 ;;
esac

TOKEN="${SUPABASE_ACCESS_TOKEN:-}"
if [[ -z "$TOKEN" && -f "$HOME/.supabase/access-token" ]]; then
  TOKEN="$(cat "$HOME/.supabase/access-token")"
fi
if [[ -z "$TOKEN" && "$(uname)" == "Darwin" ]]; then
  RAW="$(security find-generic-password -s 'Supabase CLI' -a 'supabase' -w 2>/dev/null || true)"
  if [[ -n "$RAW" ]]; then
    case "$RAW" in
      go-keyring-base64:*) TOKEN="$(printf '%s' "${RAW#go-keyring-base64:}" | base64 -d)" ;;
      *)                   TOKEN="$RAW" ;;
    esac
  fi
fi
if [[ -z "$TOKEN" ]]; then
  echo "error: no token. Run 'npx supabase login' or export SUPABASE_ACCESS_TOKEN." >&2
  exit 1
fi

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TPL_DIR="$REPO_ROOT/supabase/templates"

for f in confirmation.html magic_link.html recovery.html; do
  [[ -f "$TPL_DIR/$f" ]] || { echo "missing: $TPL_DIR/$f" >&2; exit 1; }
done

# jq encodes HTML as a JSON string (handles quotes, newlines, backslashes
# correctly — don't hand-roll). --rawfile slurps the file as a single string.
PAYLOAD="$(jq -n \
  --rawfile conf     "$TPL_DIR/confirmation.html" \
  --rawfile magic    "$TPL_DIR/magic_link.html" \
  --rawfile recovery "$TPL_DIR/recovery.html" \
  '{
    mailer_subjects_confirmation: "Confirm your CodeTutor AI email",
    mailer_templates_confirmation_content: $conf,
    mailer_subjects_magic_link: "Your CodeTutor AI sign-in link",
    mailer_templates_magic_link_content: $magic,
    mailer_subjects_recovery: "Reset your CodeTutor AI password",
    mailer_templates_recovery_content: $recovery
  }')"

echo "Pushing 3 templates to $ENV_NAME ($PROJECT_REF)..."

HTTP_CODE="$(curl -sS -o /tmp/supa-patch-resp.json -w '%{http_code}' \
  -X PATCH "https://api.supabase.com/v1/projects/$PROJECT_REF/config/auth" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d "$PAYLOAD")"

if [[ "$HTTP_CODE" != "200" ]]; then
  echo "error: PATCH returned $HTTP_CODE" >&2
  cat /tmp/supa-patch-resp.json >&2
  echo >&2
  exit 1
fi

echo "OK — verify in Dashboard: https://supabase.com/dashboard/project/$PROJECT_REF/auth/templates"
