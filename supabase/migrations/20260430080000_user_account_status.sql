-- Phase 25: extend ai_platform_denylist with full account-freeze fields.
--
-- Today the denylist blocks platform AI only — a denylisted user can still
-- sign in, create sessions, run code, and use BYOK. That's the right
-- granularity for "stop spending operator $$ on this user" but it's not
-- enough when the operator decides a user must be fully blocked.
--
-- Phase 25 adds a `frozen` boolean (and metadata) to the same row so that:
--   - frozen=true AND user denylisted (always paired)  → fully blocked
--     - platform AI denied (existing denylist behavior)
--     - session creation rejected with 403 ACCOUNT_FROZEN
--     - frontend hydration shows "account suspended" banner
--   - frozen=false AND denylisted (existing behavior)  → AI-only block
--     - platform AI denied
--     - sessions still allowed
--
-- A row in ai_platform_denylist is the source of truth; `frozen` is the
-- escalation flag. Removing the freeze leaves the denylist row intact
-- (admin can independently un-denylist after).
--
-- Why one table: the freeze concept is tightly coupled to denylist state.
-- A user can't be frozen without also being denied (free-tier abuse =>
-- denylist => freeze if persistent). Splitting into two tables would
-- create the ability to be "frozen but not denylisted" which makes no
-- sense in the product.

ALTER TABLE public.ai_platform_denylist
  ADD COLUMN frozen         boolean       NOT NULL DEFAULT false,
  ADD COLUMN frozen_reason  text          NULL,
  ADD COLUMN frozen_at      timestamptz   NULL,
  ADD COLUMN frozen_set_by  uuid          NULL REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE public.ai_platform_denylist
  ADD CONSTRAINT ai_platform_denylist_frozen_reason_len
  CHECK (frozen_reason IS NULL OR char_length(frozen_reason) BETWEEN 1 AND 500);

-- Frozen rows must have the metadata set; unfrozen rows must clear it.
-- Caught at the row level so the table can't drift into half-frozen state.
ALTER TABLE public.ai_platform_denylist
  ADD CONSTRAINT ai_platform_denylist_frozen_metadata_consistent
  CHECK (
    (frozen = true AND frozen_reason IS NOT NULL AND frozen_at IS NOT NULL)
    OR
    (frozen = false AND frozen_reason IS NULL AND frozen_at IS NULL AND frozen_set_by IS NULL)
  );

-- Partial index: most denylist rows aren't frozen, so the lookup
-- "is this user frozen" stays cheap.
CREATE INDEX idx_ai_platform_denylist_frozen
  ON public.ai_platform_denylist (user_id)
  WHERE frozen = true;
