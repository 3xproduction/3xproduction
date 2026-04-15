-- 033: Add pending_review status for public cart rental requests

-- New enum values
ALTER TYPE rent_status ADD VALUE IF NOT EXISTS 'pending_review';
ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'rent_request';
ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'rent_signed';
ALTER TYPE entity_type ADD VALUE IF NOT EXISTS 'rent';

-- Requester info columns for external cart requests
ALTER TABLE rent_deals ADD COLUMN IF NOT EXISTS requester_name TEXT;
ALTER TABLE rent_deals ADD COLUMN IF NOT EXISTS requester_phone TEXT;
ALTER TABLE rent_deals ADD COLUMN IF NOT EXISTS requester_project TEXT;
ALTER TABLE rent_deals ADD COLUMN IF NOT EXISTS requester_message TEXT;

-- Allow NULL period for pending_review deals (director sets dates when processing)
ALTER TABLE rent_deals ALTER COLUMN period_start DROP NOT NULL;
ALTER TABLE rent_deals ALTER COLUMN period_end DROP NOT NULL;
