-- Casting AMS cards
CREATE TABLE IF NOT EXISTS casting_cards (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  role_name TEXT,
  gender VARCHAR(20),
  age_range VARCHAR(20),
  height INTEGER,
  weight INTEGER,
  hair_color TEXT,
  eye_color TEXT,
  body_type TEXT,
  ethnicity TEXT,
  phone VARCHAR(50),
  email VARCHAR(255),
  agency TEXT,
  experience TEXT,
  notes TEXT,
  status VARCHAR(20) DEFAULT 'considering', -- considering | approved | rejected
  project_id UUID REFERENCES projects(id),
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS casting_photos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  card_id UUID NOT NULL REFERENCES casting_cards(id) ON DELETE CASCADE,
  url TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);
