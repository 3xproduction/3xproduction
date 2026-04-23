-- 045: Двухэтапный возврат единицы со склада проекта на общий склад.
-- Сторона склада (директор/зам/сотрудник склада/продюсер) запрашивает возврат →
-- у проекта-владельца 3 дня чтобы физически принести вещь → та же сторона подтверждает,
-- единица переходит на общий склад.
--
-- Дополнительно: одноразовое восстановление единицы «Пневматический пистолет-пулемёт
-- с глушителем» на склад проекта (она была отправлена прямой кнопкой до перехода
-- на двухэтапный поток).

CREATE TABLE IF NOT EXISTS warehouse_return_requests (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  unit_id           UUID NOT NULL REFERENCES units(id) ON DELETE CASCADE,
  from_project_id   UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  requested_by      UUID NOT NULL REFERENCES users(id),
  status            TEXT NOT NULL DEFAULT 'pending',
  -- pending | confirmed | cancelled
  deadline          DATE,
  comment           TEXT,
  confirmed_by      UUID REFERENCES users(id),
  confirmed_at      TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_wrr_unit_status     ON warehouse_return_requests(unit_id, status);
CREATE INDEX IF NOT EXISTS idx_wrr_from_project    ON warehouse_return_requests(from_project_id);
CREATE INDEX IF NOT EXISTS idx_wrr_status          ON warehouse_return_requests(status);

-- Одноразовое восстановление. Выполнится только если единица действительно не
-- в проектах и есть подходящий проект. Идемпотентно по is_project_kept.
DO $$
DECLARE
  pid UUID;
BEGIN
  SELECT id INTO pid FROM projects WHERE name ILIKE '%спецназ%' LIMIT 1;
  IF pid IS NOT NULL THEN
    UPDATE units
       SET is_project_kept = true,
           project_id = pid,
           warehouse_id = NULL,
           cell_id = NULL,
           pavilion_id = NULL
     WHERE (name ILIKE '%пневмат%пулемет%глушител%' OR name ILIKE '%пневматический пистолет-пулемет%')
       AND COALESCE(is_project_kept, false) = false
       AND status != 'written_off';
  END IF;
END $$;
