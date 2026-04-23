-- 048: Пересорт — единицы, которые не нашлись при сборке заявки.
-- Флаг, не новый статус (ALTER TYPE ADD VALUE ломает миграции).
-- Значение true = помечено «нет в наличии». На складе такие блюрятся и видны
-- в отдельной вкладке «Пересорт». Возвращается в on_stock, когда нашли.

ALTER TABLE units ADD COLUMN IF NOT EXISTS misplaced BOOLEAN NOT NULL DEFAULT false;
CREATE INDEX IF NOT EXISTS idx_units_misplaced ON units(misplaced) WHERE misplaced = true;
