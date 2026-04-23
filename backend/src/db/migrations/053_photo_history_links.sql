-- 053: Link unit_photos and unit_history to specific issuance/return/rent_deal
-- Цель: в карточке единицы показывать только исходные фото (type='stock'),
-- а фото выдачи/возврата — внутри соответствующих записей истории.

ALTER TABLE unit_photos
  ADD COLUMN IF NOT EXISTS issuance_id  UUID REFERENCES issuances(id)  ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS return_id    UUID REFERENCES returns(id)    ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS rent_deal_id UUID REFERENCES rent_deals(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_unit_photos_issuance  ON unit_photos(issuance_id)  WHERE issuance_id  IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_unit_photos_return    ON unit_photos(return_id)    WHERE return_id    IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_unit_photos_rent_deal ON unit_photos(rent_deal_id) WHERE rent_deal_id IS NOT NULL;

ALTER TABLE unit_history
  ADD COLUMN IF NOT EXISTS issuance_id  UUID REFERENCES issuances(id)  ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS return_id    UUID REFERENCES returns(id)    ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS rent_deal_id UUID REFERENCES rent_deals(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_unit_history_issuance ON unit_history(issuance_id) WHERE issuance_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_unit_history_return   ON unit_history(return_id)   WHERE return_id   IS NOT NULL;
