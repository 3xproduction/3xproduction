-- 043: Missing pending_transfer column (was added to 041 retroactively but 041 was already
-- marked as applied in _migrations, so we need a separate migration to land the column).

ALTER TABLE units
  ADD COLUMN IF NOT EXISTS pending_transfer BOOLEAN DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_units_pending_transfer ON units(pending_transfer);
