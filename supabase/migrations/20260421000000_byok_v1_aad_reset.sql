-- Phase 20-P0 #7: bump BYOK ciphertext format to v1. New format prepends a
-- 1-byte version marker (0x01) and binds the auth tag to both that version
-- byte and the owning user_id via AES-256-GCM AAD. This stops a row-swap
-- attack (copying user A's cipher + nonce into user B's row) from silently
-- decrypting A's OpenAI key under B's identity at the AI-route boundary.
--
-- Existing v0 ciphertexts (no version byte, no AAD) cannot be decrypted by
-- the v1 reader. There's exactly one real user today, so null the columns
-- and let the user re-enter their key in Settings — same invariant we
-- already document for BYOK_ENCRYPTION_KEY rotation. If/when we ever have
-- enough users for this to be painful, the fix is a read-path that tries
-- v0 first and re-encrypts under v1 on access; for now the dead code isn't
-- worth it.
--
-- No schema change — only data reset on the existing columns from
-- 20260420140000_byok_storage.sql.

UPDATE public.user_preferences
   SET openai_api_key_cipher = NULL,
       openai_api_key_nonce  = NULL,
       updated_at            = now()
 WHERE openai_api_key_cipher IS NOT NULL
    OR openai_api_key_nonce  IS NOT NULL;
