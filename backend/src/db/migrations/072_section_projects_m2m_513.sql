-- 072: M2M «зал ↔ проекты» + привязка зала 513 к Шеф-8 И Закон тайги-3.
--
-- warehouse_sections.project_id — один FK, а зал 513 обслуживает ДВА проекта
-- (Шеф-8 и Закон тайги-3). Вводим M2M-таблицу section_projects (как
-- user_projects из 067). На текущий момент НИКАКОЙ код не читает
-- warehouse_sections.project_id, поэтому это чисто аддитивная запись связи —
-- фундамент для будущей логики (ячейка на художника по костюмам и т.п.).
-- Колонку warehouse_sections.project_id НЕ трогаем (легаси, безвредна).
--
-- Полностью идемпотентно, guarded (no-op + NOTICE при неоднозначности),
-- единицы/остатки не затрагиваются.

CREATE TABLE IF NOT EXISTS section_projects (
  section_id UUID NOT NULL REFERENCES warehouse_sections(id) ON DELETE CASCADE,
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (section_id, project_id)
);
CREATE INDEX IF NOT EXISTS idx_section_projects_section ON section_projects(section_id);
CREATE INDEX IF NOT EXISTS idx_section_projects_project ON section_projects(project_id);

-- Перенос уже существующих одиночных привязок (217 → Опасный-2 из 070).
INSERT INTO section_projects (section_id, project_id)
SELECT id, project_id FROM warehouse_sections WHERE project_id IS NOT NULL
ON CONFLICT (section_id, project_id) DO NOTHING;

DO $$
DECLARE
  v_hall  UUID;
  v_hcnt  INT;
  v_chef  UUID;
  v_zakon UUID;
  v_pcnt  INT;
BEGIN
  -- Зал 513 (type='hall'), ровно один.
  SELECT count(*) INTO v_hcnt FROM warehouse_sections
   WHERE type = 'hall' AND name ~ '(^|[^0-9])513([^0-9]|$)';
  SELECT id INTO v_hall FROM warehouse_sections
   WHERE type = 'hall' AND name ~ '(^|[^0-9])513([^0-9]|$)'
   ORDER BY created_at, id LIMIT 1;
  IF v_hcnt <> 1 OR v_hall IS NULL THEN
    RAISE NOTICE '072: зал 513 (hall) не однозначен (count=%): no-op', v_hcnt; RETURN;
  END IF;

  -- Шеф-8 (ровно один).
  SELECT count(*) INTO v_pcnt FROM projects
   WHERE regexp_replace(lower(trim(name)), '[[:space:]-]+', '', 'g') = 'шеф8';
  SELECT id INTO v_chef FROM projects
   WHERE regexp_replace(lower(trim(name)), '[[:space:]-]+', '', 'g') = 'шеф8'
   ORDER BY created_at DESC, id LIMIT 1;
  IF v_pcnt = 1 THEN
    INSERT INTO section_projects (section_id, project_id)
    VALUES (v_hall, v_chef) ON CONFLICT (section_id, project_id) DO NOTHING;
  ELSE
    RAISE NOTICE '072: «Шеф-8» не однозначен (count=%): 513↛Шеф-8', v_pcnt;
  END IF;

  -- Закон тайги-3 (ровно один).
  SELECT count(*) INTO v_pcnt FROM projects
   WHERE regexp_replace(lower(trim(name)), '[[:space:]-]+', '', 'g') = 'законтайги3';
  SELECT id INTO v_zakon FROM projects
   WHERE regexp_replace(lower(trim(name)), '[[:space:]-]+', '', 'g') = 'законтайги3'
   ORDER BY created_at DESC, id LIMIT 1;
  IF v_pcnt = 1 THEN
    INSERT INTO section_projects (section_id, project_id)
    VALUES (v_hall, v_zakon) ON CONFLICT (section_id, project_id) DO NOTHING;
  ELSE
    RAISE NOTICE '072: «Закон тайги-3» не однозначен (count=%): 513↛Закон тайги-3', v_pcnt;
  END IF;

  RAISE NOTICE '072: зал 513=% → Шеф-8=% Закон тайги-3=%', v_hall, v_chef, v_zakon;
END $$;
