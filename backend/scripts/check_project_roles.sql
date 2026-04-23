-- Проверка привязки ролей площадки к проекту «Наш спецназ 4 сезон».
-- Запускать вручную:
--   psql "$DATABASE_URL" -f backend/scripts/check_project_roles.sql

-- 1) Кто уже привязан к «Наш спецназ 4 сезон».
SELECT u.role, u.name, u.email
FROM users u
JOIN projects p ON p.id = u.project_id
WHERE p.name ILIKE '%спецназ%'
ORDER BY u.role, u.name;

-- 2) Production-роли без привязки к проекту — их при необходимости можно добавить.
SELECT u.role, u.name, u.email
FROM users u
WHERE u.project_id IS NULL
  AND u.role IN (
    'producer', 'project_director', 'project_deputy', 'project_deputy_upload',
    'director', 'first_assistant_director', 'assistant_director', 'set_admin',
    'production_designer', 'art_director_assistant',
    'props_master', 'props_assistant',
    'costumer', 'costume_assistant',
    'decorator', 'makeup_artist',
    'stunt_coordinator', 'pyrotechnician',
    'ams_assistant', 'location_manager'
  )
ORDER BY u.role, u.name;

-- 3) Production-роли, привязанные к другим проектам (не к «Наш спецназ»).
SELECT u.role, u.name, u.email, p.name AS current_project
FROM users u
LEFT JOIN projects p ON p.id = u.project_id
WHERE u.project_id IS NOT NULL
  AND p.name NOT ILIKE '%спецназ%'
  AND u.role IN (
    'producer', 'project_director', 'project_deputy', 'project_deputy_upload',
    'director', 'first_assistant_director', 'assistant_director', 'set_admin',
    'production_designer', 'art_director_assistant',
    'props_master', 'props_assistant',
    'costumer', 'costume_assistant',
    'decorator', 'makeup_artist',
    'stunt_coordinator', 'pyrotechnician',
    'ams_assistant', 'location_manager'
  )
ORDER BY p.name, u.role, u.name;

-- 4) Привязать всех production-юзеров БЕЗ проекта к «Наш спецназ».
-- ЗАПУСКАТЬ ТОЛЬКО после просмотра (2) и одобрения:
--
-- UPDATE users
-- SET project_id = (SELECT id FROM projects WHERE name ILIKE '%спецназ%' LIMIT 1)
-- WHERE project_id IS NULL
--   AND role IN (
--     'producer', 'project_director', 'project_deputy', 'project_deputy_upload',
--     'director', 'first_assistant_director', 'assistant_director', 'set_admin',
--     'production_designer', 'art_director_assistant',
--     'props_master', 'props_assistant',
--     'costumer', 'costume_assistant',
--     'decorator', 'makeup_artist',
--     'stunt_coordinator', 'pyrotechnician',
--     'ams_assistant', 'location_manager'
--   );
