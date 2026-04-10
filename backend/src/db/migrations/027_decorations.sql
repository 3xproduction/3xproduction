-- Decorations catalog (sets, pavilions)
CREATE TABLE IF NOT EXISTS decorations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  type VARCHAR(20) NOT NULL DEFAULT 'decoration', -- decoration | pavilion
  description TEXT,
  location_id UUID REFERENCES locations(id),
  area_sqm NUMERIC,
  status VARCHAR(20) DEFAULT 'available', -- available | in_use | dismantled
  project_id UUID REFERENCES projects(id),
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS decoration_photos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  decoration_id UUID NOT NULL REFERENCES decorations(id) ON DELETE CASCADE,
  url TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Link decorations to units (props/costumes inside)
CREATE TABLE IF NOT EXISTS decoration_units (
  decoration_id UUID NOT NULL REFERENCES decorations(id) ON DELETE CASCADE,
  unit_id UUID NOT NULL REFERENCES units(id) ON DELETE CASCADE,
  PRIMARY KEY (decoration_id, unit_id)
);
