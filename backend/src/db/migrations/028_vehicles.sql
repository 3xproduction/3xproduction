-- Vehicles catalog (transport for filming)
CREATE TABLE IF NOT EXISTS vehicles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  type VARCHAR(20) DEFAULT 'car', -- car | truck | bus | motorcycle | special
  brand TEXT,
  model TEXT,
  year INTEGER,
  color TEXT,
  license_plate TEXT,
  vin TEXT,
  description TEXT,
  condition TEXT,
  status VARCHAR(20) DEFAULT 'available', -- available | in_use | rented | repair
  daily_rate NUMERIC,
  owner_name TEXT,
  owner_contact TEXT,
  project_id UUID REFERENCES projects(id),
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS vehicle_photos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id UUID NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  url TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);
