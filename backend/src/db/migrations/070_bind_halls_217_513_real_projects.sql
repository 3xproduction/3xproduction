-- 070: Привязка залов-складов 217 и 513 к РЕАЛЬНЫМ проектам.
--
-- Контекст: миграция 066 уже реализовала эту логику, но целилась в bare-имена
-- проектов «Опасный»/«Шеф»/«Закон тайги» (и сеяла их). На проде эти дубли
-- удалены, реальные проекты — «Опасный-2», «Шеф-8», «Закон тайги-3»
-- (см. 068/069: lower(trim(name)) = lower('Шеф-8')). Поэтому привязка 217/513
-- на проде указывала на несуществующие/удалённые проекты.
--
-- Эта миграция: (1) резолвит реальные проекты по точному имени (толерантна к
-- '-' / ' '); (2) привязывает warehouses 217 → Опасный-2, 513+шеф → Шеф-8,
-- 513+закон тайги → Закон тайги-3; (3) переотносит on_stock-единицы,
-- физически лежащие в зале 217/513, на склад нужного реального проекта
-- (is_project_kept=true), чтобы публикация этих проектов наполняла И их склад
-- проекта, И привязанный зал (это один пул, два среза).
--
-- Полностью идемпотентна, БЕЗ сидинга проектов, guarded: если реальный проект
-- не резолвится однозначно — безопасный no-op + RAISE NOTICE.

DO $$
DECLARE
  v_opasny UUID;
  v_chef   UUID;
  v_zakon  UUID;
  v_cnt    INT;
BEGIN
  -- Реальные проекты: точное имя, толерантно к дефису/пробелу и регистру.
  SELECT id INTO v_opasny FROM projects
   WHERE regexp_replace(lower(trim(name)), '[[:space:]-]+', '', 'g') = 'опасный2'
   ORDER BY created_at DESC, id LIMIT 1;
  SELECT count(*) INTO v_cnt FROM projects
   WHERE regexp_replace(lower(trim(name)), '[[:space:]-]+', '', 'g') = 'опасный2';
  IF v_cnt <> 1 THEN v_opasny := NULL; RAISE NOTICE '070: «Опасный-2» не однозначен (count=%): no-op для 217', v_cnt; END IF;

  SELECT id INTO v_chef FROM projects
   WHERE regexp_replace(lower(trim(name)), '[[:space:]-]+', '', 'g') = 'шеф8'
   ORDER BY created_at DESC, id LIMIT 1;
  SELECT count(*) INTO v_cnt FROM projects
   WHERE regexp_replace(lower(trim(name)), '[[:space:]-]+', '', 'g') = 'шеф8';
  IF v_cnt <> 1 THEN v_chef := NULL; RAISE NOTICE '070: «Шеф-8» не однозначен (count=%): no-op для 513/шеф', v_cnt; END IF;

  SELECT id INTO v_zakon FROM projects
   WHERE regexp_replace(lower(trim(name)), '[[:space:]-]+', '', 'g') = 'законтайги3'
   ORDER BY created_at DESC, id LIMIT 1;
  SELECT count(*) INTO v_cnt FROM projects
   WHERE regexp_replace(lower(trim(name)), '[[:space:]-]+', '', 'g') = 'законтайги3';
  IF v_cnt <> 1 THEN v_zakon := NULL; RAISE NOTICE '070: «Закон тайги-3» не однозначен (count=%): no-op для 513/закон', v_cnt; END IF;

  -- (2) Привязка warehouses-залов к реальным проектам (идемпотентно).
  IF v_opasny IS NOT NULL THEN
    UPDATE warehouses w SET project_id = v_opasny
     WHERE trim(lower(w.name)) IN ('217', 'зал 217', '217 зал')
       AND w.project_id IS DISTINCT FROM v_opasny;
  END IF;
  IF v_chef IS NOT NULL THEN
    UPDATE warehouses w SET project_id = v_chef
     WHERE lower(w.name) LIKE '%513%'
       AND lower(w.name) LIKE '%шеф%'
       AND w.project_id IS DISTINCT FROM v_chef;
  END IF;
  IF v_zakon IS NOT NULL THEN
    UPDATE warehouses w SET project_id = v_zakon
     WHERE lower(w.name) LIKE '%513%'
       AND lower(w.name) LIKE '%закон%'
       AND lower(w.name) LIKE '%тайг%'
       AND w.project_id IS DISTINCT FROM v_zakon;
  END IF;

  -- (2b) Если 217/513 — это warehouse_sections (зал/hall), а не warehouses:
  -- секции исторически НЕ несли project_id (см. 065). Добавляем идемпотентно
  -- и привязываем зал-секцию к нужному проекту. Аддитивно и безопасно.
  ALTER TABLE warehouse_sections ADD COLUMN IF NOT EXISTS project_id
    UUID REFERENCES projects(id) ON DELETE SET NULL;

  IF v_opasny IS NOT NULL THEN
    UPDATE warehouse_sections s SET project_id = v_opasny
     WHERE s.name ~ '(^|[^0-9])217([^0-9]|$)'
       AND s.project_id IS DISTINCT FROM v_opasny;
  END IF;
  IF v_chef IS NOT NULL THEN
    UPDATE warehouse_sections s SET project_id = v_chef
     WHERE s.name ~ '(^|[^0-9])513([^0-9]|$)'
       AND (lower(s.name) LIKE '%шеф%')
       AND s.project_id IS DISTINCT FROM v_chef;
  END IF;
  IF v_zakon IS NOT NULL THEN
    UPDATE warehouse_sections s SET project_id = v_zakon
     WHERE s.name ~ '(^|[^0-9])513([^0-9]|$)'
       AND (lower(s.name) LIKE '%закон%' AND lower(s.name) LIKE '%тайг%')
       AND s.project_id IS DISTINCT FROM v_zakon;
  END IF;

  -- (3) Переотнести on_stock-единицы, физически лежащие в зале 217/513, на
  -- склад нужного реального проекта (как 066, но с правильными проектами).
  WITH located_units AS (
    SELECT u.id,
           w.project_id AS warehouse_project_id,
           lower(concat_ws(' ', w.name, h.name, s.name, c.custom_name, c.code)) AS location_text,
           lower(concat_ws(' ', u.name, u.source, u.description)) AS unit_text
      FROM units u
      LEFT JOIN warehouses w ON w.id = u.warehouse_id
      LEFT JOIN cells c ON c.id = u.cell_id
      LEFT JOIN warehouse_sections s ON s.id = c.section_id
      LEFT JOIN warehouse_sections h ON h.id = s.parent_section_id
     WHERE u.status = 'on_stock'
       AND COALESCE(u.is_project_kept, false) = false
       AND COALESCE(u.is_admin_stock, false) = false
       AND COALESCE(u.pending_transfer, false) = false
  ),
  targeted_units AS (
    SELECT lu.id,
           CASE
             WHEN v_opasny IS NOT NULL
                  AND lu.location_text ~ '(^|[^0-9])217([^0-9]|$)'
               THEN v_opasny
             WHEN v_chef IS NOT NULL
                  AND lu.location_text ~ '(^|[^0-9])513([^0-9]|$)'
                  AND (lu.warehouse_project_id = v_chef
                       OR lu.location_text LIKE '%шеф%'
                       OR lu.unit_text LIKE '%шеф%')
               THEN v_chef
             WHEN v_zakon IS NOT NULL
                  AND lu.location_text ~ '(^|[^0-9])513([^0-9]|$)'
                  AND (lu.warehouse_project_id = v_zakon
                       OR (lu.location_text LIKE '%закон%' AND lu.location_text LIKE '%тайг%')
                       OR (lu.unit_text LIKE '%закон%' AND lu.unit_text LIKE '%тайг%'))
               THEN v_zakon
             ELSE NULL
           END AS target_project_id,
           CASE
             WHEN lu.location_text ~ '(^|[^0-9])217([^0-9]|$)' THEN 'зал 217 -> склад проекта'
             WHEN lu.location_text ~ '(^|[^0-9])513([^0-9]|$)' THEN 'зал 513 -> склад проекта'
             ELSE NULL
           END AS move_note
      FROM located_units lu
     WHERE lu.location_text ~ '(^|[^0-9])(217|513)([^0-9]|$)'
  ),
  moved AS (
    UPDATE units u
       SET is_project_kept = true,
           project_id = tu.target_project_id,
           warehouse_id = NULL,
           cell_id = NULL,
           pavilion_id = NULL,
           pending_transfer = false
      FROM targeted_units tu
     WHERE u.id = tu.id
       AND tu.target_project_id IS NOT NULL
       AND (u.project_id IS DISTINCT FROM tu.target_project_id
            OR COALESCE(u.is_project_kept, false) = false)
    RETURNING u.id, tu.target_project_id, tu.move_note
  )
  INSERT INTO unit_history (unit_id, action, project_id, notes)
  SELECT moved.id, 'Перенесено на склад проекта из зала',
         moved.target_project_id, moved.move_note
    FROM moved;

  RAISE NOTICE '070: bind done. opasny=% chef=% zakon=%', v_opasny, v_chef, v_zakon;
END $$;
