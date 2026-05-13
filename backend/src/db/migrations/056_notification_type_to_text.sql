-- Убираем enum notification_type и меняем колонку на TEXT.
--
-- Причина: ALTER TYPE ADD VALUE не работает внутри транзакции (migrate.js
-- оборачивает каждую миграцию в BEGIN/COMMIT), поэтому попытки расширить
-- enum молча падают, и любые INSERT с новыми значениями ('new_unit',
-- 'no_cell_threshold', 'loan_*', 'warehouse_return_*' и т.д.) валятся с
-- "invalid input value for enum". Это ломает пуш-уведомления по половине
-- событий.
--
-- Решение: перевести notifications.type в TEXT. Новые типы добавляются
-- без миграций, фронтенд игнорирует неизвестные.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'notifications' AND column_name = 'type'
      AND udt_name = 'notification_type'
  ) THEN
    ALTER TABLE notifications ALTER COLUMN type TYPE TEXT USING type::text;
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'notifications' AND column_name = 'entity_type'
      AND udt_name = 'entity_type'
  ) THEN
    ALTER TABLE notifications ALTER COLUMN entity_type TYPE TEXT USING entity_type::text;
  END IF;
END $$;

-- Типы оставляем — возможно в будущем переиспользуем, DROP не обязателен.
