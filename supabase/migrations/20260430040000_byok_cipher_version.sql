-- Phase 23 P1 #4: surface BYOK cipher version as a queryable column.
--
-- Today the version byte is the first byte of `openai_api_key_cipher`
-- (see backend/src/services/crypto/byok.ts) and the GCM AAD binds that
-- byte into the auth tag, so cross-version row swaps fail to decrypt.
-- That's enough for the security property — it is NOT enough for an
-- operator who needs to re-encrypt every BYOK row after a master-key
-- rotation: scanning bytea first-bytes across N rows is awkward + slow.
--
-- A dedicated `byok_cipher_version` smallint column gives the rotation
-- runbook a clean predicate: `WHERE byok_cipher_version = 1` finds every
-- row still on the old key. The column is nullable — NULL means "no
-- BYOK key set", matching `openai_api_key_cipher IS NULL`. Writes are
-- maintained by setOpenAIKey/clearOpenAIKey on the backend side.
--
-- Backfill: every existing row with a non-null cipher today is on v1
-- (CURRENT_VERSION = 0x01 since launch). One-shot UPDATE handles them.
--
-- No CHECK constraint linking cipher + version: keeping the column
-- nullable + unconstrained means an old code path that inserts a
-- cipher without a version still succeeds (during a deploy window
-- between migration apply and code roll-out, for instance). The read
-- path (decryptKey) only looks at the byte embedded in cipher[0], so
-- a missing version column is purely a runbook-query inconvenience,
-- not a correctness issue.

ALTER TABLE public.user_preferences
  ADD COLUMN byok_cipher_version smallint;

UPDATE public.user_preferences
   SET byok_cipher_version = 1
 WHERE openai_api_key_cipher IS NOT NULL;
