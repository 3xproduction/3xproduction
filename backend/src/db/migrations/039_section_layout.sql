-- Spatial layout for warehouse sections (visual map with drag/resize)
ALTER TABLE warehouse_sections
  ADD COLUMN IF NOT EXISTS x_pos  INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS y_pos  INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS width  INTEGER DEFAULT 420,
  ADD COLUMN IF NOT EXISTS height INTEGER DEFAULT 180;
