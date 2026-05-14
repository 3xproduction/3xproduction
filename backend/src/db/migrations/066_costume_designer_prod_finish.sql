-- 066: Finish costume-designer prod data adjustments.
-- Idempotent data migration for the 2026-05-14 request.

WITH seed_projects(name) AS (
  VALUES ('Опасный'), ('Шеф'), ('Закон тайги')
)
INSERT INTO projects (name)
SELECT sp.name
FROM seed_projects sp
WHERE NOT EXISTS (
  SELECT 1 FROM projects p WHERE lower(trim(p.name)) = lower(trim(sp.name))
);

UPDATE units
   SET source = 'С общего склада'
 WHERE is_project_kept = true
   AND source IS NOT NULL
   AND (
     lower(source) LIKE '%сво%'
     OR lower(source) LIKE '%найден%'
   );

WITH raw_projects AS (
  SELECT id, created_at,
         CASE
           WHEN lower(trim(name)) = lower('Опасный') THEN 'opasny'
           WHEN lower(trim(name)) = lower('Шеф') THEN 'chef'
           WHEN lower(trim(name)) = lower('Закон тайги') THEN 'zakon_taigi'
           ELSE NULL
         END AS project_key
  FROM projects
  WHERE lower(trim(name)) IN (lower('Опасный'), lower('Шеф'), lower('Закон тайги'))
),
project_keys AS (
  SELECT DISTINCT ON (project_key) project_key, id
  FROM raw_projects
  WHERE project_key IS NOT NULL
  ORDER BY project_key, created_at DESC
),
varya_users AS (
  SELECT u.id
  FROM users u
  JOIN project_keys pk ON pk.id = u.project_id
  WHERE pk.project_key IN ('chef', 'zakon_taigi')
    AND u.role IN ('art_director_assistant', 'costume_assistant', 'costumer', 'production_designer')
    AND lower(split_part(regexp_replace(trim(u.name), '[[:space:]]+', ' ', 'g'), ' ', 1)) IN ('варя', 'варвара')
)
UPDATE users u
   SET role = 'costume_designer'
  FROM varya_users vu
 WHERE u.id = vu.id
   AND u.role <> 'costume_designer';

WITH raw_projects AS (
  SELECT id, created_at,
         CASE
           WHEN lower(trim(name)) = lower('Опасный') THEN 'opasny'
           WHEN lower(trim(name)) = lower('Шеф') THEN 'chef'
           WHEN lower(trim(name)) = lower('Закон тайги') THEN 'zakon_taigi'
           ELSE NULL
         END AS project_key
  FROM projects
  WHERE lower(trim(name)) IN (lower('Опасный'), lower('Шеф'), lower('Закон тайги'))
),
project_keys AS (
  SELECT DISTINCT ON (project_key) project_key, id
  FROM raw_projects
  WHERE project_key IS NOT NULL
  ORDER BY project_key, created_at DESC
)
UPDATE warehouses w
   SET project_id = pk.id
  FROM project_keys pk
 WHERE (
       (pk.project_key = 'opasny'
        AND trim(lower(w.name)) IN (lower('217'), lower('зал 217'), lower('217 зал')))
    OR (pk.project_key = 'chef'
        AND lower(w.name) LIKE '%513%'
        AND lower(w.name) LIKE '%шеф%')
    OR (pk.project_key = 'zakon_taigi'
        AND lower(w.name) LIKE '%513%'
        AND lower(w.name) LIKE '%закон%'
        AND lower(w.name) LIKE '%тайг%')
   )
   AND w.project_id IS DISTINCT FROM pk.id;

WITH raw_projects AS (
  SELECT id, created_at,
         CASE
           WHEN lower(trim(name)) = lower('Опасный') THEN 'opasny'
           WHEN lower(trim(name)) = lower('Шеф') THEN 'chef'
           WHEN lower(trim(name)) = lower('Закон тайги') THEN 'zakon_taigi'
           ELSE NULL
         END AS project_key
  FROM projects
  WHERE lower(trim(name)) IN (lower('Опасный'), lower('Шеф'), lower('Закон тайги'))
),
project_keys AS (
  SELECT DISTINCT ON (project_key) project_key, id
  FROM raw_projects
  WHERE project_key IS NOT NULL
  ORDER BY project_key, created_at DESC
),
located_units AS (
  SELECT u.id,
         u.name,
         u.source,
         u.description,
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
           WHEN lu.location_text ~ '(^|[^0-9])217([^0-9]|$)'
             THEN (SELECT id FROM project_keys WHERE project_key = 'opasny')
           WHEN lu.location_text ~ '(^|[^0-9])513([^0-9]|$)'
                AND (
                  lu.warehouse_project_id = (SELECT id FROM project_keys WHERE project_key = 'chef')
                  OR lu.location_text LIKE '%шеф%'
                  OR lu.unit_text LIKE '%шеф%'
                )
             THEN (SELECT id FROM project_keys WHERE project_key = 'chef')
           WHEN lu.location_text ~ '(^|[^0-9])513([^0-9]|$)'
                AND (
                  lu.warehouse_project_id = (SELECT id FROM project_keys WHERE project_key = 'zakon_taigi')
                  OR (lu.location_text LIKE '%закон%' AND lu.location_text LIKE '%тайг%')
                  OR (lu.unit_text LIKE '%закон%' AND lu.unit_text LIKE '%тайг%')
                )
             THEN (SELECT id FROM project_keys WHERE project_key = 'zakon_taigi')
           ELSE NULL
         END AS target_project_id,
         CASE
           WHEN lu.location_text ~ '(^|[^0-9])217([^0-9]|$)' THEN 'hall 217 -> Опасный'
           WHEN lu.location_text ~ '(^|[^0-9])513([^0-9]|$)' THEN 'hall 513 -> project warehouse'
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
  RETURNING u.id, tu.target_project_id, tu.move_note
)
INSERT INTO unit_history (unit_id, action, project_id, notes)
SELECT moved.id,
       'Перенесено на склад проекта из зала',
       moved.target_project_id,
       moved.move_note
FROM moved;
