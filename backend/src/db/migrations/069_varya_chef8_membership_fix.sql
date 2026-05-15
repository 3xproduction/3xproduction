-- 069: Надёжный матчинг Варя ↔ «Шеф-8» (068 ушла в no-op: имена в проде в
-- формате «Фамилия Имя Отчество», а 068/065/066 матчили первый токен =
-- фамилию). Здесь матчим по фамилии И имени одновременно среди
-- costume_designer — это однозначно Бартновская Варвара. Идемпотентно,
-- вставка только при РОВНО одном пользователе и РОВНО одном проекте «Шеф-8»;
-- иначе безопасный no-op + NOTICE. Стоковые данные не затрагиваются.

DO $$
DECLARE
  v_user UUID;
  v_ucnt INT;
  v_proj UUID;
  v_pcnt INT;
  v_ins  INT;
BEGIN
  SELECT count(*) INTO v_ucnt
  FROM users
  WHERE role = 'costume_designer'
    AND lower(name) LIKE '%бартнов%'
    AND lower(name) LIKE '%варвар%';

  SELECT id INTO v_user
  FROM users
  WHERE role = 'costume_designer'
    AND lower(name) LIKE '%бартнов%'
    AND lower(name) LIKE '%варвар%'
  ORDER BY created_at, id
  LIMIT 1;

  SELECT count(*) INTO v_pcnt
  FROM projects
  WHERE lower(trim(name)) = lower('Шеф-8');

  SELECT id INTO v_proj
  FROM projects
  WHERE lower(trim(name)) = lower('Шеф-8')
  ORDER BY created_at DESC, id
  LIMIT 1;

  IF v_ucnt = 1 AND v_pcnt = 1 THEN
    INSERT INTO user_projects (user_id, project_id)
    VALUES (v_user, v_proj)
    ON CONFLICT (user_id, project_id) DO NOTHING;
    GET DIAGNOSTICS v_ins = ROW_COUNT;
    RAISE NOTICE '069: Варя<->Шеф-8: user=% project=% inserted=%', v_user, v_proj, v_ins;
  ELSE
    RAISE NOTICE '069: no-op (ambiguous) costume_designer Бартновская Варвара count=%, «Шеф-8» count=%',
      v_ucnt, v_pcnt;
  END IF;
END $$;
