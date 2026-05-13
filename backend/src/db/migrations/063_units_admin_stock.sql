-- 063: Administrative shop stock.
-- Admin-stock units are stored in the common units table but kept out of the
-- regular warehouse, project warehouse, public catalog and global search.

ALTER TABLE units
  ADD COLUMN IF NOT EXISTS is_admin_stock BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_units_is_admin_stock ON units(is_admin_stock);
