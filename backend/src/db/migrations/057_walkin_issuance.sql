-- 057: Walk-in выдача со склада.
--
-- Сценарий: сотрудник проекта приехал на склад, выбирает реквизит/костюм
-- из физической наличности; ни сам он, ни вещи ещё не в БД (идёт
-- инвентаризация). Директор/зам склада в одном flow создаёт проект (если
-- новый), project_director'а проекта (provisional, без пароля), получателя
-- (provisional), вносит юниты по фото и оформляет выдачу с PDF.
--
-- Изменения:
--   1. units.is_walkin / created_via — пометить юниты, заведённые из walk-in
--      (минимально заполненные: name, category, qty, photo). Остальные поля
--      (valuation, cell_id, source) дозаполняются на возврате.
--   2. users.is_provisional / claim_token / claim_token_expires — юзер
--      создан складом без пароля, ждёт активации через claim-link на email.
--      password_hash → NULL allowed.
--   3. issuances.request_id NULLABLE — walk-in выдача без заявки.

DO $$
BEGIN
  -- units flags
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name='units' AND column_name='is_walkin'
  ) THEN
    ALTER TABLE units ADD COLUMN is_walkin BOOLEAN NOT NULL DEFAULT false;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name='units' AND column_name='created_via'
  ) THEN
    ALTER TABLE units ADD COLUMN created_via TEXT;
  END IF;

  -- users provisional
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name='users' AND column_name='is_provisional'
  ) THEN
    ALTER TABLE users ADD COLUMN is_provisional BOOLEAN NOT NULL DEFAULT false;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name='users' AND column_name='claim_token'
  ) THEN
    ALTER TABLE users ADD COLUMN claim_token TEXT;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name='users' AND column_name='claim_token_hash'
  ) THEN
    ALTER TABLE users ADD COLUMN claim_token_hash TEXT;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name='users' AND column_name='claim_token_expires'
  ) THEN
    ALTER TABLE users ADD COLUMN claim_token_expires TIMESTAMPTZ;
  END IF;

  -- password_hash NULLABLE — provisional users заводятся без пароля,
  -- ставят его при активации через /auth/claim/:token.
  BEGIN
    ALTER TABLE users ALTER COLUMN password_hash DROP NOT NULL;
  EXCEPTION WHEN others THEN
    -- уже nullable или другая причина — ок
    NULL;
  END;

  -- issuances.request_id NULLABLE для walk-in.
  BEGIN
    ALTER TABLE issuances ALTER COLUMN request_id DROP NOT NULL;
  EXCEPTION WHEN others THEN
    NULL;
  END;
END $$;

-- Уникальный индекс на claim_token_hash (быстрый lookup при /auth/claim/:token).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname='public' AND indexname='idx_users_claim_token_hash'
  ) THEN
    CREATE UNIQUE INDEX idx_users_claim_token_hash ON users(claim_token_hash)
      WHERE claim_token_hash IS NOT NULL;
  END IF;
END $$;
