-- 046: Журнал списаний.
-- Списание возможно при возврате по заявке, по публичной ссылке, а также при
-- возврате со склада проекта. Строка тут — одна списанная единица.

CREATE TABLE IF NOT EXISTS writeoffs (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  unit_id         UUID NOT NULL REFERENCES units(id) ON DELETE CASCADE,
  source          TEXT NOT NULL,
  -- source: issue | rent | public | project | direct
  source_ref      UUID,         -- id issuances / rent_deal / warehouse_return_request (если есть)
  project_id      UUID REFERENCES projects(id) ON DELETE SET NULL,
  reason          TEXT,
  -- Если помечено «долг» — долговая запись создаётся отдельно в debts,
  -- тут факт списания. Поле kind различает: writeoff (повреждено/потеряно) или debt (долг).
  kind            TEXT NOT NULL DEFAULT 'writeoff',
  created_by      UUID REFERENCES users(id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_writeoffs_unit    ON writeoffs(unit_id);
CREATE INDEX IF NOT EXISTS idx_writeoffs_source  ON writeoffs(source);
CREATE INDEX IF NOT EXISTS idx_writeoffs_kind    ON writeoffs(kind);
CREATE INDEX IF NOT EXISTS idx_writeoffs_created ON writeoffs(created_at DESC);
