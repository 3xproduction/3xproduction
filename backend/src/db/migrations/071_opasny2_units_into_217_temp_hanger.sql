-- 071: Показать единицы «Опасный-2» в зале 217.
--
-- Контекст: 21 единица «Опасный-2» — is_project_kept=true, project_id=Опасный-2,
-- но БЕЗ места (cell_id=NULL). Поэтому видны в складе проекта (по project_id),
-- но зал 217 (считает по cells→секция→зал) показывает 0. Пользователь:
-- положить их в ячейку «Временная вешалка» в зале 217; 513 пуст — там НИЧЕГО
-- не создавать.
--
-- Делаем дочернюю секцию (type='hanger') «Временная вешалка» под залом 217,
-- одну ячейку в ней, и переносим placeless-единицы «Опасный-2» в эту ячейку,
-- СОХРАНЯЯ is_project_kept/project_id (значит остаются и в складе проекта).
-- Полностью идемпотентно, guarded, остатки (units_total/qty/written_off) не
-- меняются. 513 не трогается.

DO $$
DECLARE
  v_proj   UUID;
  v_pcnt   INT;
  v_hall   UUID;
  v_wh     UUID;
  v_hcnt   INT;
  v_cat    TEXT;
  v_sec    UUID;
  v_cell   UUID;
  v_moved  INT;
BEGIN
  -- Проект «Опасный-2» (толерантно к '-'/' '), ровно один.
  SELECT count(*) INTO v_pcnt FROM projects
   WHERE regexp_replace(lower(trim(name)), '[[:space:]-]+', '', 'g') = 'опасный2';
  SELECT id INTO v_proj FROM projects
   WHERE regexp_replace(lower(trim(name)), '[[:space:]-]+', '', 'g') = 'опасный2'
   ORDER BY created_at DESC, id LIMIT 1;
  IF v_pcnt <> 1 THEN
    RAISE NOTICE '071: «Опасный-2» не однозначен (count=%): no-op', v_pcnt; RETURN;
  END IF;

  -- Зал 217 (type='hall'), ровно один.
  SELECT count(*) INTO v_hcnt FROM warehouse_sections
   WHERE type = 'hall' AND name ~ '(^|[^0-9])217([^0-9]|$)';
  SELECT id, warehouse_id, category INTO v_hall, v_wh, v_cat
   FROM warehouse_sections
   WHERE type = 'hall' AND name ~ '(^|[^0-9])217([^0-9]|$)'
   ORDER BY created_at, id LIMIT 1;
  IF v_hcnt <> 1 OR v_hall IS NULL THEN
    RAISE NOTICE '071: зал 217 (hall) не однозначен (count=%): no-op', v_hcnt; RETURN;
  END IF;

  -- Дочерняя секция «Временная вешалка» под залом 217 (идемпотентно).
  SELECT id INTO v_sec FROM warehouse_sections
   WHERE parent_section_id = v_hall AND name = 'Временная вешалка'
   ORDER BY created_at, id LIMIT 1;
  IF v_sec IS NULL THEN
    INSERT INTO warehouse_sections
      (warehouse_id, name, category, type, parent_section_id, project_id)
    VALUES
      (v_wh, 'Временная вешалка', COALESCE(NULLIF(v_cat,''), 'Прочее'),
       'hanger', v_hall, v_proj)
    RETURNING id INTO v_sec;
  END IF;

  -- Одна ячейка в секции (идемпотентно через UNIQUE(section_id,code)).
  INSERT INTO cells (section_id, code, custom_name)
  VALUES (v_sec, '1', 'Временная вешалка')
  ON CONFLICT (section_id, code) DO NOTHING;
  SELECT id INTO v_cell FROM cells
   WHERE section_id = v_sec ORDER BY code LIMIT 1;

  -- Перенос placeless-единиц «Опасный-2» в ячейку. Сохраняем
  -- is_project_kept/project_id (остаются в складе проекта). Не трогаем
  -- written_off; кол-во/сумма не меняются. Идемпотентно: повторно те же
  -- единицы уже cell_id IS NOT NULL → не попадут.
  WITH moved AS (
    UPDATE units u
       SET cell_id = v_cell, warehouse_id = v_wh
     WHERE u.is_project_kept = true
       AND u.project_id = v_proj
       AND u.cell_id IS NULL
       AND u.status <> 'written_off'
    RETURNING u.id
  )
  SELECT count(*) INTO v_moved FROM moved;

  INSERT INTO unit_history (unit_id, action, project_id, notes)
  SELECT u.id, 'Размещено в зале 217 (Временная вешалка)', v_proj,
         'Опасный-2 → зал 217 / Временная вешалка'
    FROM units u
   WHERE u.cell_id = v_cell AND u.project_id = v_proj
     AND NOT EXISTS (
       SELECT 1 FROM unit_history h
        WHERE h.unit_id = u.id
          AND h.action = 'Размещено в зале 217 (Временная вешалка)');

  RAISE NOTICE '071: проект=% зал=% секция=% ячейка=% перенесено=%',
    v_proj, v_hall, v_sec, v_cell, v_moved;
END $$;
