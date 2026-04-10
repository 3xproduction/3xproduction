-- Add type to warehouse_sections for shelf/hanger distinction
ALTER TABLE warehouse_sections ADD COLUMN IF NOT EXISTS type VARCHAR(20) DEFAULT 'shelf';
