-- Document groups (blocks) for organizing documents within a project
CREATE TABLE IF NOT EXISTS document_groups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID REFERENCES projects(id) ON DELETE CASCADE,
  name VARCHAR(100) NOT NULL,
  sort_order INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Add group_id to documents
ALTER TABLE documents ADD COLUMN IF NOT EXISTS group_id UUID REFERENCES document_groups(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_document_groups_project ON document_groups(project_id);
CREATE INDEX IF NOT EXISTS idx_documents_group ON documents(group_id);
