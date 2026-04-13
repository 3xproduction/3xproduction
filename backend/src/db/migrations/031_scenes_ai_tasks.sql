-- ============================================================
-- 031: Canonical scenes table + AI task queue
-- ============================================================

-- Canonical scenes table: single source of truth for scene identity.
-- Both КПП and Сценарий populate it independently (order doesn't matter).
CREATE TABLE IF NOT EXISTS scenes (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id      UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  series          INTEGER,
  scene_number    INTEGER NOT NULL,
  canonical_id    TEXT NOT NULL,  -- normalized "{series}-{scene}" e.g. "46-22"

  -- КПП fields
  date            TEXT,
  day_number      INTEGER,
  time_slot       TEXT,
  duration        TEXT,
  mode            TEXT,
  int_nat         TEXT,
  object          TEXT,
  synopsis        TEXT,
  location        TEXT,
  platform        TEXT,
  characters      TEXT[],
  extras          TEXT,
  notes           TEXT,

  -- Сценарий fields
  scenario_text   TEXT,

  -- Source document tracking
  kpp_document_id      UUID REFERENCES documents(id) ON DELETE SET NULL,
  scenario_document_id UUID REFERENCES documents(id) ON DELETE SET NULL,

  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE(project_id, canonical_id)
);

CREATE INDEX IF NOT EXISTS idx_scenes_project ON scenes(project_id);
CREATE INDEX IF NOT EXISTS idx_scenes_project_canonical ON scenes(project_id, canonical_id);

-- AI task queue: reliable async processing with retry
CREATE TABLE IF NOT EXISTS ai_tasks (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id      UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  document_id     UUID REFERENCES documents(id) ON DELETE CASCADE,
  task_type       TEXT NOT NULL,           -- 'cross_scenes', 'analyze_scenario'
  status          TEXT NOT NULL DEFAULT 'pending',  -- pending, processing, completed, failed
  attempts        INTEGER NOT NULL DEFAULT 0,
  max_attempts    INTEGER NOT NULL DEFAULT 3,
  params          JSONB,                   -- input data for retry
  result          JSONB,
  error           TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at    TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_ai_tasks_status ON ai_tasks(status);
CREATE INDEX IF NOT EXISTS idx_ai_tasks_project ON ai_tasks(project_id);
