-- 041: Project-owned units.
-- A unit can belong to a project (stays only in the project inventory, not on a physical shelf)
-- or be a regular warehouse unit. Project-owned units never appear in the public catalog.
-- Transfer state is signalled by the pending_transfer boolean, not a new enum value,
-- because ALTER TYPE ADD VALUE cannot run inside the per-migration transaction.

ALTER TABLE units
  ADD COLUMN IF NOT EXISTS project_id        UUID REFERENCES projects(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS is_project_kept   BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS purchased         BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS purchase_price    NUMERIC(12,2),
  ADD COLUMN IF NOT EXISTS purchase_date     DATE,
  ADD COLUMN IF NOT EXISTS vendor            TEXT,
  ADD COLUMN IF NOT EXISTS receipt_url       TEXT,
  ADD COLUMN IF NOT EXISTS created_by        UUID REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS pending_transfer  BOOLEAN DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_units_project_id      ON units(project_id);
CREATE INDEX IF NOT EXISTS idx_units_is_project_kept ON units(is_project_kept);
CREATE INDEX IF NOT EXISTS idx_units_pending_transfer ON units(pending_transfer);
