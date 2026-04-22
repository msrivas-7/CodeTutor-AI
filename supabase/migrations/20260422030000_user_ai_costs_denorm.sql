-- P-H1 (adversarial audit, bucket 4b): denormalized per-user lifetime AI cost
-- so the credential resolver's L3 check can read a single row instead of
-- scanning every ai_usage_ledger row for the user. The ledger is the durable
-- record; this table is a hot-path denorm updated in the same transaction as
-- each ledger INSERT.
--
-- Rollout: write both (this migration + tx-wrapped writeUsageRow) ship
-- together. The backfill below seeds every existing user's lifetime cost
-- from the ledger SUM at migration time, so the first read after deploy
-- returns the same answer the old SUM would have. There's no dual-read
-- window because the new denorm is written atomically with every new
-- ledger row from the moment the code ships.

CREATE TABLE IF NOT EXISTS public.user_ai_costs (
  user_id           uuid        PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  lifetime_cost_usd numeric(14, 6) NOT NULL DEFAULT 0,
  updated_at        timestamptz NOT NULL DEFAULT now()
);

-- Backfill from the durable ledger. Only funding_source='platform' counts —
-- the L3 brake is a platform-spend budget; BYOK rows don't contribute.
-- ON CONFLICT keeps the migration idempotent on re-run.
INSERT INTO public.user_ai_costs (user_id, lifetime_cost_usd, updated_at)
SELECT user_id,
       COALESCE(SUM(cost_usd), 0),
       now()
  FROM public.ai_usage_ledger
 WHERE funding_source = 'platform'
 GROUP BY user_id
ON CONFLICT (user_id) DO UPDATE
  SET lifetime_cost_usd = EXCLUDED.lifetime_cost_usd,
      updated_at        = EXCLUDED.updated_at;
