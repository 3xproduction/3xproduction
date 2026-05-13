-- 064: Security/data-integrity fixes from pre-staging review.
-- - Store provisional claim tokens as SHA-256 hashes.
-- - Preserve unit_history.project_id by restricting project deletes.
-- - Allocate generated unit serials from atomic per-prefix counters.

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS claim_token_hash TEXT;

DO $$
BEGIN
  UPDATE users
     SET claim_token_hash = encode(sha256(convert_to(claim_token, 'UTF8')), 'hex'),
         claim_token = NULL
   WHERE claim_token IS NOT NULL
     AND claim_token_hash IS NULL;
EXCEPTION WHEN undefined_function THEN
  -- If the database cannot hash legacy raw tokens, expire them instead of
  -- keeping account-claim secrets in plaintext.
  UPDATE users
     SET claim_token = NULL,
         claim_token_expires = NULL
   WHERE claim_token IS NOT NULL
     AND claim_token_hash IS NULL;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_claim_token_hash
  ON users(claim_token_hash)
  WHERE claim_token_hash IS NOT NULL;

ALTER TABLE unit_history
  ADD COLUMN IF NOT EXISTS project_id UUID;

DO $$
DECLARE
  fk_name TEXT;
BEGIN
  SELECT con.conname
    INTO fk_name
    FROM pg_constraint con
    JOIN pg_attribute att
      ON att.attrelid = con.conrelid
     AND att.attnum = ANY(con.conkey)
   WHERE con.conrelid = 'unit_history'::regclass
     AND con.contype = 'f'
     AND att.attname = 'project_id'
   LIMIT 1;

  IF fk_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE unit_history DROP CONSTRAINT %I', fk_name);
  END IF;

  ALTER TABLE unit_history
    ADD CONSTRAINT unit_history_project_id_fkey
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE RESTRICT;
EXCEPTION WHEN duplicate_object THEN
  NULL;
END $$;

CREATE INDEX IF NOT EXISTS idx_unit_history_project
  ON unit_history(project_id)
  WHERE project_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS unit_serial_counters (
  prefix TEXT PRIMARY KEY,
  next_value INTEGER NOT NULL CHECK (next_value > 0)
);

INSERT INTO unit_serial_counters (prefix, next_value)
SELECT prefix, MAX(num) + 1
FROM (
  SELECT
    substring(serial from '^([A-Z0-9]+)-[0-9]+$') AS prefix,
    substring(serial from '^[A-Z0-9]+-([0-9]+)$')::int AS num
  FROM units
  WHERE serial ~ '^[A-Z0-9]+-[0-9]+$'
) parsed
WHERE prefix IS NOT NULL
GROUP BY prefix
ON CONFLICT (prefix) DO UPDATE
  SET next_value = GREATEST(unit_serial_counters.next_value, EXCLUDED.next_value);
