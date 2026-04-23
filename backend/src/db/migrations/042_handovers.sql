-- 042: Handover acts between employees inside a project.
-- When a props/costume employee leaves and a new one arrives,
-- the system captures a snapshot of the project inventory and the new employee
-- walks through the list confirming each item is present / missing / damaged.

CREATE TABLE IF NOT EXISTS handovers (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  project_id   UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  from_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  to_user_id   UUID REFERENCES users(id) ON DELETE SET NULL,
  scope        TEXT NOT NULL DEFAULT 'all',   -- 'all' | 'props' | 'costumes'
  status       TEXT NOT NULL DEFAULT 'draft', -- draft | checking | signed | disputed
  notes        TEXT,
  signed_at    TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by   UUID REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_handovers_project ON handovers(project_id);
CREATE INDEX IF NOT EXISTS idx_handovers_status  ON handovers(status);

CREATE TABLE IF NOT EXISTS handover_items (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  handover_id   UUID NOT NULL REFERENCES handovers(id) ON DELETE CASCADE,
  unit_id       UUID REFERENCES units(id) ON DELETE SET NULL,
  unit_name     TEXT NOT NULL,
  unit_category TEXT,
  qty_expected  INTEGER DEFAULT 1,
  check_status  TEXT DEFAULT 'pending',  -- pending | ok | missing | damaged
  note          TEXT,
  photo_url     TEXT,
  checked_at    TIMESTAMPTZ,
  checked_by    UUID REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_handover_items_handover ON handover_items(handover_id);
