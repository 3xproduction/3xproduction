-- 062: Link unit history entries to a project when movement crosses project stock.

ALTER TABLE unit_history
  ADD COLUMN IF NOT EXISTS project_id UUID REFERENCES projects(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_unit_history_project
  ON unit_history(project_id)
  WHERE project_id IS NOT NULL;
