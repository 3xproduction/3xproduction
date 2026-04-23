-- 052: return_requested_at для публичных аренд.
-- Позволяет партнёру или складу «запросить возврат» по активной rent_deal — до
-- этого не было поля для отметки (в проектных заявках оно живёт на issuances).
-- Без изменения rent_status enum (урок 043).

ALTER TABLE rent_deals ADD COLUMN IF NOT EXISTS return_requested_at TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS idx_rent_deals_return_requested
  ON rent_deals(return_requested_at)
  WHERE return_requested_at IS NOT NULL;
