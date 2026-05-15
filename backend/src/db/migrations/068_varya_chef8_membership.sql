-- 068: Бартновская Варя (costume_designer) — добавить второй проект «Шеф-8»
-- на склад проекта (scoped multi-project из 067). Primary project_id у неё
-- остаётся «Закон тайги-3» (его членство уже создано backfill'ом 067).
--
-- Идемпотентно и консервативно: вставляем строку членства ТОЛЬКО когда
-- однозначно резолвится РОВНО один costume_designer Варя/Варвара и РОВНО
-- один проект «Шеф-8». Иначе — безопасный no-op с диагностическим NOTICE.

DO $$
DECLARE
  v_user   UUID;
  v_ucnt   INT;
  v_proj   UUID;
  v_pcnt   INT;
  v_ins    INT;
BEGIN
  SELECT count(*), min(id) INTO v_ucnt, v_user
  FROM users
  WHERE role = 'costume_designer'
    AND lower(split_part(regexp_replace(trim(name), '[[:space:]]+', ' ', 'g'), ' ', 1))
        IN ('варя', 'варвара');

  SELECT count(*), min(id) INTO v_pcnt, v_proj
  FROM projects
  WHERE lower(trim(name)) = lower('Шеф-8');

  IF v_ucnt = 1 AND v_pcnt = 1 THEN
    INSERT INTO user_projects (user_id, project_id)
    VALUES (v_user, v_proj)
    ON CONFLICT (user_id, project_id) DO NOTHING;
    GET DIAGNOSTICS v_ins = ROW_COUNT;
    RAISE NOTICE '068: Varya<->Шеф-8 membership: user=% project=% inserted=%',
      v_user, v_proj, v_ins;
  ELSE
    RAISE NOTICE '068: no-op (ambiguous) costume_designer Варя count=%, project «Шеф-8» count=%',
      v_ucnt, v_pcnt;
  END IF;
END $$;
