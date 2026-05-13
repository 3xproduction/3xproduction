-- 060: Категория casting-карточки (взрослые / дети / животные) +
-- description (фактологическое описание внешности от AI) + search_tags
-- (теги-ассоциации, тот же паттерн что у units.search_tags).
--
-- Триггер casting_search_vector_update() пересоздаём с kind (вес B),
-- description (вес C) и search_tags (вес D). Backfill через no-op UPDATE.

DO $$ BEGIN
  ALTER TABLE casting_cards
    ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'adult'
      CHECK (kind IN ('adult','child','animal'));
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'casting_cards.kind add skipped: %', SQLERRM;
END $$;

DO $$ BEGIN
  ALTER TABLE casting_cards ADD COLUMN IF NOT EXISTS description TEXT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'casting_cards.description add skipped: %', SQLERRM;
END $$;

DO $$ BEGIN
  ALTER TABLE casting_cards ADD COLUMN IF NOT EXISTS search_tags TEXT;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'casting_cards.search_tags add skipped: %', SQLERRM;
END $$;

DO $$ BEGIN
  CREATE OR REPLACE FUNCTION casting_search_vector_update() RETURNS trigger AS $fn$
  BEGIN
    NEW.search_vector :=
      setweight(to_tsvector('ru_search', coalesce(NEW.name, '')), 'A') ||
      setweight(to_tsvector('ru_search', coalesce(NEW.role_name, '')), 'B') ||
      setweight(to_tsvector('ru_search', coalesce(NEW.kind, '')), 'B') ||
      setweight(to_tsvector('ru_search', coalesce(NEW.agency, '')), 'C') ||
      setweight(to_tsvector('ru_search', coalesce(NEW.experience, '')), 'C') ||
      setweight(to_tsvector('ru_search', coalesce(NEW.notes, '')), 'C') ||
      setweight(to_tsvector('ru_search', coalesce(NEW.description, '')), 'C') ||
      setweight(to_tsvector('ru_search', coalesce(NEW.search_tags, '')), 'D');
    RETURN NEW;
  END;
  $fn$ LANGUAGE plpgsql;
  DROP TRIGGER IF EXISTS trig_casting_search_vector ON casting_cards;
  CREATE TRIGGER trig_casting_search_vector
    BEFORE INSERT OR UPDATE ON casting_cards
    FOR EACH ROW EXECUTE FUNCTION casting_search_vector_update();
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'casting trigger update skipped: %', SQLERRM;
END $$;

-- Backfill: пересчитать search_vector для существующих записей
DO $$ BEGIN UPDATE casting_cards SET name = name; EXCEPTION WHEN OTHERS THEN NULL; END $$;
