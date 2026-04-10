-- Locations catalog (filming locations)
CREATE TABLE IF NOT EXISTS locations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  type VARCHAR(20) NOT NULL DEFAULT 'interior', -- interior | exterior
  address TEXT,
  description TEXT,
  contact_name TEXT,
  contact_phone TEXT,
  price_per_day NUMERIC,
  area_sqm NUMERIC,
  features TEXT[] DEFAULT '{}',
  notes TEXT,
  project_id UUID REFERENCES projects(id),
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS location_photos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  location_id UUID NOT NULL REFERENCES locations(id) ON DELETE CASCADE,
  url TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);
