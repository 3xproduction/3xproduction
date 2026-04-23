-- Миграция 051 — поворот секций на карте склада.
--
-- Добавляет колонку rotation (в градусах: 0, 90, 180, 270) к warehouse_sections.
-- Используется frontend'ом MapCanvas для применения CSS transform: rotate().
-- Nullable с DEFAULT 0 — существующие секции остаются без поворота.
--
-- Обёрнуто в DO $$ ... EXCEPTION END $$ для идемпотентности (совместимо
-- с Yandex Managed PostgreSQL — см. wiki/decisions.md).

DO $$
BEGIN
  ALTER TABLE warehouse_sections
    ADD COLUMN rotation INTEGER NOT NULL DEFAULT 0;
EXCEPTION
  WHEN duplicate_column THEN
    NULL;
END $$;
