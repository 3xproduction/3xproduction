-- 049: Внешние пользователи публичного каталога (личный кабинет по публичной ссылке).
-- Отдельно от таблицы `users`, чтобы не смешивать внешних с сотрудниками.

CREATE TABLE IF NOT EXISTS public_users (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email          TEXT NOT NULL UNIQUE,
  password_hash  TEXT NOT NULL,
  name           TEXT NOT NULL,
  phone          TEXT,
  counterparty_type TEXT DEFAULT 'person', -- person | company
  inn            TEXT,
  legal_address  TEXT,
  project_name   TEXT,
  extra_contact  TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_public_users_email ON public_users(email);
CREATE INDEX IF NOT EXISTS idx_public_users_phone ON public_users(phone);

-- Коды восстановления отдельной таблицей, чтобы внешние коды не попали
-- в recover_codes внутренних пользователей.
CREATE TABLE IF NOT EXISTS public_recover_codes (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email       TEXT NOT NULL,
  code        TEXT NOT NULL,
  expires_at  TIMESTAMPTZ NOT NULL,
  used        BOOLEAN NOT NULL DEFAULT FALSE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_public_recover_email ON public_recover_codes(email);
