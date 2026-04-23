-- Иерархия секций: type='hall' — родительский зал, внутри которого
-- живут обычные секции shelf/hanger/place через parent_section_id.
-- NULL = секция на уровне склада (как было раньше).
DO $$
BEGIN
  BEGIN
    ALTER TABLE warehouse_sections
      ADD COLUMN IF NOT EXISTS parent_section_id UUID
        REFERENCES warehouse_sections(id) ON DELETE CASCADE;
  EXCEPTION WHEN duplicate_column THEN NULL;
  END;
END $$;

CREATE INDEX IF NOT EXISTS idx_warehouse_sections_parent
  ON warehouse_sections(parent_section_id)
  WHERE parent_section_id IS NOT NULL;
