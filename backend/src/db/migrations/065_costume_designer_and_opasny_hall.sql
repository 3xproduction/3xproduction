-- 065: Costume designer role data fix + bind 217 hall/warehouse to "Опасный".

-- Varya and Yulia were previously created as artist/costume assistants.
-- Keep this idempotent and narrow: only existing assistants with these names move.
WITH candidates AS (
  SELECT id,
         lower(split_part(regexp_replace(trim(name), '[[:space:]]+', ' ', 'g'), ' ', 1)) AS first_name
    FROM users
   WHERE role IN ('art_director_assistant', 'costume_assistant')
),
keyed_candidates AS (
  SELECT id,
         CASE
           WHEN first_name IN ('варя', 'варвара') THEN 'varya'
           WHEN first_name IN ('юля', 'юлия') THEN 'yulia'
           ELSE NULL
         END AS person_key
    FROM candidates
   WHERE char_length(first_name) >= 3
),
single_candidates AS (
  SELECT id
    FROM (
      SELECT id, person_key, COUNT(*) OVER (PARTITION BY person_key) AS person_count
        FROM keyed_candidates
       WHERE person_key IS NOT NULL
    ) ranked
   WHERE person_count = 1
)
UPDATE users u
   SET role = 'costume_designer'
  FROM single_candidates sc
 WHERE u.id = sc.id;

-- If "217" is represented as a warehouse row, attach it to project "Опасный".
-- If the production row is only a warehouse_sections hall, this is a safe no-op
-- because sections do not currently carry project_id.
WITH target_project AS (
  SELECT id
    FROM projects
   WHERE lower(name) = lower('Опасный')
   LIMIT 1
)
UPDATE warehouses w
   SET project_id = target_project.id
  FROM target_project
 WHERE trim(lower(w.name)) IN (lower('217'), lower('зал 217'), lower('217 зал'))
   AND w.project_id IS DISTINCT FROM target_project.id;
