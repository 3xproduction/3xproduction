-- 050: workflow_stage для публичных заявок аренды.
-- Публичная rent_deal (status='pending_review') проходит те же три шага, что
-- и обычный request: null → 'collecting' (Принять) → 'ready' (Готово) →
-- обработка ReviewModal (Выдать). Не расширяем rent_status enum — ALTER TYPE
-- ADD VALUE ломает миграции (см. урок 043). Используем отдельный TEXT-столбец.

ALTER TABLE rent_deals ADD COLUMN IF NOT EXISTS workflow_stage TEXT;
CREATE INDEX IF NOT EXISTS idx_rent_deals_workflow_stage ON rent_deals(workflow_stage) WHERE workflow_stage IS NOT NULL;
