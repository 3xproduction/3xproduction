-- 040: Units can be physically placed in a pavilion (any decoration with type='pavilion').
-- pavilion_id and cell_id are mutually exclusive.
-- NOTE: we avoid ALTER TYPE ... ADD VALUE here because migrate.js wraps each
-- migration in BEGIN/COMMIT and Postgres forbids enum-add inside a transaction.
-- Presence in a pavilion is indicated by pavilion_id IS NOT NULL, not a dedicated status.

ALTER TABLE units
  ADD COLUMN IF NOT EXISTS pavilion_id UUID REFERENCES decorations(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_units_pavilion ON units(pavilion_id);
