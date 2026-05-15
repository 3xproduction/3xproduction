-- 067: Scoped multi-project membership for users (used only by the project
-- warehouse view) + free-text permanent project storage location on units.
--
-- Fully additive and idempotent. users.project_id stays the primary project
-- and the source of truth for invites/debts/requests/issuances/JWT — this
-- table is an ADDITIVE secondary set consumed only by GET /project-units.

CREATE TABLE IF NOT EXISTS user_projects (
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, project_id)
);

CREATE INDEX IF NOT EXISTS idx_user_projects_user    ON user_projects(user_id);
CREATE INDEX IF NOT EXISTS idx_user_projects_project ON user_projects(project_id);

-- Parity backfill: every user's existing primary project is also a membership
-- row, so the new ANY()-filter behaves identically for single-project users.
INSERT INTO user_projects (user_id, project_id)
SELECT id, project_id FROM users WHERE project_id IS NOT NULL
ON CONFLICT (user_id, project_id) DO NOTHING;

-- Permanent project storage place (зал/кабинет). Kept separate from
-- units.period ("адресное хранение") — both models intentionally coexist.
ALTER TABLE units ADD COLUMN IF NOT EXISTS project_location TEXT;
