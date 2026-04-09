-- Add deposit and return PDF URL to rent_deals
ALTER TABLE rent_deals ADD COLUMN IF NOT EXISTS deposit NUMERIC(12,2);
ALTER TABLE rent_deals ADD COLUMN IF NOT EXISTS return_pdf_url TEXT;
