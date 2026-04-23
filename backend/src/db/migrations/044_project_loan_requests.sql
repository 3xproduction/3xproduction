-- 044: Inter-project loan requests.
-- Реализация запроса единицы у чужого проекта: одна сторона просит, другая выдаёт.
-- Не расширяет enum статусов (см. урок 043 — ALTER TYPE ADD VALUE ломает миграцию).

CREATE TABLE IF NOT EXISTS project_loan_requests (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  unit_id                  UUID NOT NULL REFERENCES units(id) ON DELETE CASCADE,
  from_project_id          UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE, -- владелец
  to_project_id            UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE, -- запрашивающий
  requested_by             UUID NOT NULL REFERENCES users(id),
  responder_id             UUID REFERENCES users(id),                               -- кому адресован
  status                   TEXT NOT NULL DEFAULT 'pending',
  -- pending | accepted | rejected | returned | cancelled
  deadline                 DATE,
  extension_requested      BOOLEAN NOT NULL DEFAULT false,
  extension_new_deadline   DATE,
  comment                  TEXT,
  response_comment         TEXT,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  decided_at               TIMESTAMPTZ,
  returned_at              TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_plr_from_project ON project_loan_requests(from_project_id);
CREATE INDEX IF NOT EXISTS idx_plr_to_project   ON project_loan_requests(to_project_id);
CREATE INDEX IF NOT EXISTS idx_plr_responder    ON project_loan_requests(responder_id);
CREATE INDEX IF NOT EXISTS idx_plr_requested_by ON project_loan_requests(requested_by);
CREATE INDEX IF NOT EXISTS idx_plr_status       ON project_loan_requests(status);
CREATE INDEX IF NOT EXISTS idx_plr_unit         ON project_loan_requests(unit_id);

-- Флаг "единица сейчас одолжена другому проекту" — чтобы на чужом складе её не заказали повторно.
ALTER TABLE units
  ADD COLUMN IF NOT EXISTS on_loan_to_project_id UUID REFERENCES projects(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_units_on_loan_to ON units(on_loan_to_project_id);
