-- 058: разрешаем NULL в users.email.
--
-- Walk-in выдача (миграция 057) заводит провизорных юзеров на месте, у
-- которых email может быть не указан (директор склада оформляет выдачу
-- срочно — потом получатель сам введёт email при /auth/claim/:token).
--
-- До этой миграции INSERT INTO users без email падал с
-- "null value in column email violates not-null constraint" → /walkin/issue
-- возвращал 500.
--
-- Логин/recover ищут по email — для NULL-юзеров не найдут совпадений (NULL=$1
-- = false по умолчанию в PG), что нормально: они вообще не могут залогиниться
-- пока не активируют аккаунт через claim-link и не зададут email.
--
-- UNIQUE-constraint на email сохраняется: PG считает каждый NULL отдельным
-- значением, дубликатов NULL не запрещает.

DO $$
BEGIN
  BEGIN
    ALTER TABLE users ALTER COLUMN email DROP NOT NULL;
  EXCEPTION WHEN others THEN
    NULL;
  END;
END $$;
