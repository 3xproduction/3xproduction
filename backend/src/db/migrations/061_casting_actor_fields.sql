-- 061: Расширенные поля для анкеты актёра/массовки. Языки, права,
-- спорт/танец/музыка, размеры, татуировки/приметы, город, портфолио,
-- готовности (раздевание/трюки/выезды/загранпаспорт). Все опциональные.
--
-- Триггер casting_search_vector_update() обновляем — добавляем skills,
-- music_skills, dance_skills, languages, tattoos, city, social_links
-- в поисковый индекс с весом D (рядом с search_tags).

DO $$ BEGIN ALTER TABLE casting_cards ADD COLUMN IF NOT EXISTS languages       TEXT;     EXCEPTION WHEN OTHERS THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE casting_cards ADD COLUMN IF NOT EXISTS driver_license  TEXT;     EXCEPTION WHEN OTHERS THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE casting_cards ADD COLUMN IF NOT EXISTS has_car         BOOLEAN;  EXCEPTION WHEN OTHERS THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE casting_cards ADD COLUMN IF NOT EXISTS skills          TEXT;     EXCEPTION WHEN OTHERS THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE casting_cards ADD COLUMN IF NOT EXISTS music_skills    TEXT;     EXCEPTION WHEN OTHERS THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE casting_cards ADD COLUMN IF NOT EXISTS dance_skills    TEXT;     EXCEPTION WHEN OTHERS THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE casting_cards ADD COLUMN IF NOT EXISTS clothing_size   TEXT;     EXCEPTION WHEN OTHERS THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE casting_cards ADD COLUMN IF NOT EXISTS shoe_size       TEXT;     EXCEPTION WHEN OTHERS THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE casting_cards ADD COLUMN IF NOT EXISTS tattoos         TEXT;     EXCEPTION WHEN OTHERS THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE casting_cards ADD COLUMN IF NOT EXISTS accepts_nudity  BOOLEAN;  EXCEPTION WHEN OTHERS THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE casting_cards ADD COLUMN IF NOT EXISTS accepts_stunts  BOOLEAN;  EXCEPTION WHEN OTHERS THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE casting_cards ADD COLUMN IF NOT EXISTS accepts_travel  BOOLEAN;  EXCEPTION WHEN OTHERS THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE casting_cards ADD COLUMN IF NOT EXISTS has_passport    BOOLEAN;  EXCEPTION WHEN OTHERS THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE casting_cards ADD COLUMN IF NOT EXISTS city            TEXT;     EXCEPTION WHEN OTHERS THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE casting_cards ADD COLUMN IF NOT EXISTS social_links    TEXT;     EXCEPTION WHEN OTHERS THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE casting_cards ADD COLUMN IF NOT EXISTS rate            TEXT;     EXCEPTION WHEN OTHERS THEN NULL; END $$;

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
      setweight(to_tsvector('ru_search', coalesce(NEW.search_tags, '')), 'D') ||
      setweight(to_tsvector('ru_search', coalesce(NEW.languages, '')), 'D') ||
      setweight(to_tsvector('ru_search', coalesce(NEW.skills, '')), 'D') ||
      setweight(to_tsvector('ru_search', coalesce(NEW.music_skills, '')), 'D') ||
      setweight(to_tsvector('ru_search', coalesce(NEW.dance_skills, '')), 'D') ||
      setweight(to_tsvector('ru_search', coalesce(NEW.tattoos, '')), 'D') ||
      setweight(to_tsvector('ru_search', coalesce(NEW.city, '')), 'D') ||
      setweight(to_tsvector('ru_search', coalesce(NEW.social_links, '')), 'D');
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

-- Backfill: пересчитать search_vector
DO $$ BEGIN UPDATE casting_cards SET name = name; EXCEPTION WHEN OTHERS THEN NULL; END $$;
