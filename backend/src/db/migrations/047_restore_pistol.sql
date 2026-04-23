-- 047: Повторное восстановление пистолета-пулемёта на склад проекта.
-- Он ещё раз ушёл на общий склад через writeoff/confirm — возвращаем идемпотентно.

DO $$
DECLARE
  pid UUID;
BEGIN
  SELECT id INTO pid FROM projects WHERE name ILIKE '%спецназ%' LIMIT 1;
  IF pid IS NOT NULL THEN
    UPDATE units
       SET is_project_kept = true,
           project_id = pid,
           warehouse_id = NULL,
           cell_id = NULL,
           pavilion_id = NULL,
           status = 'on_stock',
           on_loan_to_project_id = NULL,
           pending_transfer = false
     WHERE (name ILIKE '%пневмат%пулемет%глушител%' OR name ILIKE '%пневматический пистолет-пулемет%');

    -- Отменяем незакрытые return-запросы и writeoffs на этой единице, чтобы она
    -- не числилась в процессе возврата и не оставалась written_off.
    UPDATE warehouse_return_requests SET status = 'cancelled'
     WHERE unit_id IN (SELECT id FROM units WHERE name ILIKE '%пневмат%пулемет%глушител%')
       AND status = 'pending';

    DELETE FROM writeoffs
     WHERE unit_id IN (SELECT id FROM units WHERE name ILIKE '%пневмат%пулемет%глушител%');
  END IF;
END $$;
