-- 054: индекс на units.cell_id для быстрого LEFT JOIN ячеек с units.
-- До этого запросы WHERE cell_id=? (GET /warehouses/:id/cells,
-- GET /units?cell_id=, DELETE /cells/:id) делали Seq Scan по units.
-- Partial-индекс — пустые cell_id (units не размещены) не попадают в индекс.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname='idx_units_cell_id'
  ) THEN
    CREATE INDEX idx_units_cell_id ON units(cell_id) WHERE cell_id IS NOT NULL;
  END IF;
END $$;
