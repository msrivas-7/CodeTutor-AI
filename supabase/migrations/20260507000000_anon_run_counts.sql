-- Phase A — A5 (operational floor): per-IP daily run-count cap.
--
-- Independent of the L_anon=8 AI-question cap (which lives in
-- ai_anon_usage_ledger). This counter is for /api/anon/run — the Python
-- execution route — which today is bounded only by aiRateLimit's per-min
-- ceiling (60/min/IP) but has no daily cap. Without this, a single IP
-- could spawn ~86k anon containers in a UTC day, eating real cost
-- per-spawn (cold start + image pull + sidecar boot).
--
-- The cap (default 100/IP/day, configurable via system_config
-- `anon_daily_runs_per_ip`) is a daily DOS shield. Per-min ceiling
-- handles burst; per-day ceiling handles sustained.
--
-- Persisted (not in-process) so a backend restart can't reset abusers'
-- caps to zero. Daily UTC reset by adding a new row each day; periodic
-- TTL sweep can prune rows older than ~7d.
--
-- Schema:
--   ip_hash + day_utc compose the key. count is monotonically increasing
--   across the UTC day for a given IP. UPSERT pattern on each /run hit:
--     INSERT ... ON CONFLICT (ip_hash, day_utc) DO UPDATE SET count = count + 1
--
-- RLS deny-all-by-default — service-role pool writes only. The cap query
-- is a single SELECT on (ip_hash, day_utc) — fast under the PK index.

CREATE TABLE IF NOT EXISTS public.anon_run_counts (
  ip_hash   text          NOT NULL,
  day_utc   date          NOT NULL,
  count     integer       NOT NULL DEFAULT 1,
  -- Last-touched timestamp lets the TTL sweep pick stale rows even
  -- if day_utc-by-itself is ambiguous around timezone boundaries.
  updated_at timestamptz  NOT NULL DEFAULT now(),

  PRIMARY KEY (ip_hash, day_utc),
  CONSTRAINT anon_run_counts_count_nonneg
    CHECK (count >= 0),
  CONSTRAINT anon_run_counts_ip_hash_shape
    CHECK (length(ip_hash) BETWEEN 16 AND 128)
);

-- TTL-sweep helper index (pick rows older than N days for cleanup).
-- The PK already covers the lookup path (ip_hash, day_utc); this is
-- only for the periodic prune job.
CREATE INDEX IF NOT EXISTS idx_anon_run_counts_day
  ON public.anon_run_counts (day_utc);

ALTER TABLE public.anon_run_counts ENABLE ROW LEVEL SECURITY;
