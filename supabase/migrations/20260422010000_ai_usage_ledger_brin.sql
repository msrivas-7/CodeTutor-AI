-- P-M6 (adversarial audit, bucket 4a): partial BRIN index on created_at for
-- platform ledger rows.
--
-- The existing btree `idx_ai_usage_ledger_platform_cost` already covers the
-- same key+predicate, which is fine today at ~5 DAU. BRIN complements it for
-- the dominant query shape — `WHERE created_at >= $dayStart AND funding_source
-- = 'platform'` fan-out across cachedGlobalToday / cachedUserDaily /
-- cachedUserLifetime — because:
--
--   - ai_usage_ledger is strictly append-only with monotonically increasing
--     created_at, which is the textbook BRIN win: page-range summaries compress
--     ~100x vs btree and need far less maintenance on every INSERT.
--   - The planner picks whichever index has the lower estimated cost per query.
--     At current scale btree wins; as the ledger grows BRIN takes over and the
--     btree can be dropped in a follow-up without query changes.
--
-- We don't use CREATE INDEX CONCURRENTLY here because (a) Supabase wraps each
-- migration in a transaction, disallowing CONCURRENTLY, and (b) the table is
-- tiny (<10k rows in prod) so a regular CREATE INDEX completes in milliseconds.
-- If this migration ever replays on a multi-million-row ledger, split it into
-- a no-txn file per Supabase's `-- transaction: false` directive.
--
-- pages_per_range defaulted (128). At the current insert rate the whole table
-- fits in <1 page range, so a smaller value would waste overhead; we can tune
-- downward once the ledger crosses ~1 M rows.

CREATE INDEX IF NOT EXISTS idx_ai_usage_ledger_platform_created_brin
  ON public.ai_usage_ledger
  USING brin (created_at)
  WHERE funding_source = 'platform';
