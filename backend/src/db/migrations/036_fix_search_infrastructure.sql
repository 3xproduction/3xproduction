-- ============================================================
-- 036: Fix search infrastructure
-- Migration 032 never applied because CREATE EXTENSION fails
-- on Yandex Managed PostgreSQL (no superuser).
-- This migration redoes everything from 032 with proper
-- error handling so it won't rollback.
-- ============================================================

-- 0. Extensions — wrap in DO blocks so permission errors don't kill migration
DO $$ BEGIN
  CREATE EXTENSION IF NOT EXISTS unaccent;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'unaccent extension not available: %', SQLERRM;
END $$;

DO $$ BEGIN
  CREATE EXTENSION IF NOT EXISTS pg_trgm;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'pg_trgm extension not available: %', SQLERRM;
END $$;

-- 1. Text search configuration (safe — 034 may have created it)
DO $$ BEGIN
  CREATE TEXT SEARCH CONFIGURATION ru_search (COPY = russian);
EXCEPTION WHEN unique_violation THEN NULL; WHEN OTHERS THEN NULL;
END $$;

-- Try to add unaccent mapping, fall back to russian_stem only
DO $$ BEGIN
  ALTER TEXT SEARCH CONFIGURATION ru_search
    ALTER MAPPING FOR asciiword, asciihword, hword_asciipart, word, hword, hword_part
    WITH unaccent, russian_stem;
EXCEPTION WHEN OTHERS THEN
  BEGIN
    ALTER TEXT SEARCH CONFIGURATION ru_search
      ALTER MAPPING FOR asciiword, asciihword, hword_asciipart, word, hword, hword_part
      WITH russian_stem;
  EXCEPTION WHEN OTHERS THEN NULL;
  END;
END $$;

-- ============================================================
-- 2. Add search_vector columns to ALL tables (IF NOT EXISTS)
-- ============================================================
ALTER TABLE units ADD COLUMN IF NOT EXISTS search_vector tsvector;
ALTER TABLE units ADD COLUMN IF NOT EXISTS search_tags TEXT[] DEFAULT '{}';

DO $$ BEGIN ALTER TABLE scenes ADD COLUMN IF NOT EXISTS search_vector tsvector; EXCEPTION WHEN OTHERS THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE documents ADD COLUMN IF NOT EXISTS search_vector tsvector; EXCEPTION WHEN OTHERS THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE production_list_items ADD COLUMN IF NOT EXISTS search_vector tsvector; EXCEPTION WHEN OTHERS THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE rent_deals ADD COLUMN IF NOT EXISTS search_vector tsvector; EXCEPTION WHEN OTHERS THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE locations ADD COLUMN IF NOT EXISTS search_vector tsvector; EXCEPTION WHEN OTHERS THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE decorations ADD COLUMN IF NOT EXISTS search_vector tsvector; EXCEPTION WHEN OTHERS THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS search_vector tsvector; EXCEPTION WHEN OTHERS THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE casting_cards ADD COLUMN IF NOT EXISTS search_vector tsvector; EXCEPTION WHEN OTHERS THEN NULL; END $$;

-- ============================================================
-- 3. Create GIN indexes
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_units_search_vector ON units USING gin (search_vector);
DO $$ BEGIN CREATE INDEX IF NOT EXISTS idx_scenes_search_vector ON scenes USING gin (search_vector); EXCEPTION WHEN OTHERS THEN NULL; END $$;
DO $$ BEGIN CREATE INDEX IF NOT EXISTS idx_documents_search_vector ON documents USING gin (search_vector); EXCEPTION WHEN OTHERS THEN NULL; END $$;
DO $$ BEGIN CREATE INDEX IF NOT EXISTS idx_pli_search_vector ON production_list_items USING gin (search_vector); EXCEPTION WHEN OTHERS THEN NULL; END $$;
DO $$ BEGIN CREATE INDEX IF NOT EXISTS idx_rent_deals_search_vector ON rent_deals USING gin (search_vector); EXCEPTION WHEN OTHERS THEN NULL; END $$;
DO $$ BEGIN CREATE INDEX IF NOT EXISTS idx_locations_search_vector ON locations USING gin (search_vector); EXCEPTION WHEN OTHERS THEN NULL; END $$;
DO $$ BEGIN CREATE INDEX IF NOT EXISTS idx_decorations_search_vector ON decorations USING gin (search_vector); EXCEPTION WHEN OTHERS THEN NULL; END $$;
DO $$ BEGIN CREATE INDEX IF NOT EXISTS idx_vehicles_search_vector ON vehicles USING gin (search_vector); EXCEPTION WHEN OTHERS THEN NULL; END $$;
DO $$ BEGIN CREATE INDEX IF NOT EXISTS idx_casting_search_vector ON casting_cards USING gin (search_vector); EXCEPTION WHEN OTHERS THEN NULL; END $$;

-- ============================================================
-- 4. Create/replace trigger functions
-- ============================================================
CREATE OR REPLACE FUNCTION units_search_vector_update() RETURNS trigger AS $$
BEGIN
  NEW.search_vector :=
    setweight(to_tsvector('ru_search', coalesce(NEW.name, '')), 'A') ||
    setweight(to_tsvector('ru_search', coalesce(NEW.serial, '')), 'B') ||
    setweight(to_tsvector('ru_search', coalesce(NEW.category, '')), 'B') ||
    setweight(to_tsvector('ru_search', coalesce(array_to_string(NEW.search_tags, ' '), '')), 'B') ||
    setweight(to_tsvector('ru_search', coalesce(NEW.description, '')), 'C') ||
    setweight(to_tsvector('ru_search', coalesce(NEW.condition, '')), 'C') ||
    setweight(to_tsvector('ru_search', coalesce(NEW.period, '')), 'D') ||
    setweight(to_tsvector('ru_search', coalesce(NEW.dimensions, '')), 'D') ||
    setweight(to_tsvector('ru_search', coalesce(NEW.source, '')), 'D');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trig_units_search_vector ON units;
CREATE TRIGGER trig_units_search_vector
  BEFORE INSERT OR UPDATE ON units
  FOR EACH ROW EXECUTE FUNCTION units_search_vector_update();

DO $$ BEGIN
  CREATE OR REPLACE FUNCTION scenes_search_vector_update() RETURNS trigger AS $fn$
  BEGIN
    NEW.search_vector :=
      setweight(to_tsvector('ru_search', coalesce(NEW.canonical_id, '')), 'A') ||
      setweight(to_tsvector('ru_search', coalesce(NEW.scene_number::text, '')), 'A') ||
      setweight(to_tsvector('ru_search', coalesce(NEW.object, '')), 'B') ||
      setweight(to_tsvector('ru_search', coalesce(NEW.location, '')), 'B') ||
      setweight(to_tsvector('ru_search', coalesce(NEW.synopsis, '')), 'C') ||
      setweight(to_tsvector('ru_search', coalesce(NEW.platform, '')), 'C') ||
      setweight(to_tsvector('ru_search', coalesce(array_to_string(NEW.characters, ' '), '')), 'C') ||
      setweight(to_tsvector('ru_search', coalesce(NEW.extras, '')), 'D') ||
      setweight(to_tsvector('ru_search', coalesce(NEW.notes, '')), 'D') ||
      setweight(to_tsvector('ru_search', left(coalesce(NEW.scenario_text, ''), 50000)), 'D');
    RETURN NEW;
  END;
  $fn$ LANGUAGE plpgsql;
  DROP TRIGGER IF EXISTS trig_scenes_search_vector ON scenes;
  CREATE TRIGGER trig_scenes_search_vector
    BEFORE INSERT OR UPDATE ON scenes
    FOR EACH ROW EXECUTE FUNCTION scenes_search_vector_update();
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'scenes trigger skipped: %', SQLERRM;
END $$;

DO $$ BEGIN
  CREATE OR REPLACE FUNCTION documents_search_vector_update() RETURNS trigger AS $fn$
  DECLARE content_text TEXT := ''; scenes_text TEXT := '';
  BEGIN
    IF NEW.parsed_content IS NOT NULL THEN
      BEGIN
        scenes_text := coalesce(
          (SELECT string_agg(
            coalesce(s->>'object','') || ' ' || coalesce(s->>'synopsis','') || ' ' ||
            coalesce(s->>'location','') || ' ' || coalesce(s->>'notes',''), ' '
          ) FROM jsonb_array_elements(
            CASE WHEN jsonb_typeof(NEW.parsed_content->'scenes') = 'array'
                 THEN NEW.parsed_content->'scenes' ELSE '[]'::jsonb END
          ) AS s), '');
      EXCEPTION WHEN OTHERS THEN scenes_text := ''; END;
      content_text := scenes_text;
    END IF;
    IF NEW.parsed_data IS NOT NULL THEN
      BEGIN
        content_text := content_text || ' ' || coalesce(
          (SELECT string_agg(item->>'name', ' ')
           FROM jsonb_each(NEW.parsed_data) AS kv(key, val),
                LATERAL jsonb_array_elements(
                  CASE WHEN jsonb_typeof(val) = 'array' THEN val ELSE '[]'::jsonb END
                ) AS item
           WHERE jsonb_typeof(item) = 'object' AND item ? 'name'), '');
      EXCEPTION WHEN OTHERS THEN NULL; END;
    END IF;
    NEW.search_vector :=
      setweight(to_tsvector('ru_search', coalesce(NEW.original_name, '')), 'A') ||
      setweight(to_tsvector('ru_search', coalesce(NEW.type::text, '')), 'B') ||
      setweight(to_tsvector('ru_search', left(content_text, 50000)), 'C');
    RETURN NEW;
  END;
  $fn$ LANGUAGE plpgsql;
  DROP TRIGGER IF EXISTS trig_documents_search_vector ON documents;
  CREATE TRIGGER trig_documents_search_vector
    BEFORE INSERT OR UPDATE ON documents
    FOR EACH ROW EXECUTE FUNCTION documents_search_vector_update();
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'documents trigger skipped: %', SQLERRM;
END $$;

DO $$ BEGIN
  CREATE OR REPLACE FUNCTION pli_search_vector_update() RETURNS trigger AS $fn$
  BEGIN
    NEW.search_vector :=
      setweight(to_tsvector('ru_search', coalesce(NEW.name, '')), 'A') ||
      setweight(to_tsvector('ru_search', coalesce(NEW.scene, '')), 'B') ||
      setweight(to_tsvector('ru_search', coalesce(NEW.note, '')), 'C') ||
      setweight(to_tsvector('ru_search', coalesce(NEW.location, '')), 'D');
    RETURN NEW;
  END;
  $fn$ LANGUAGE plpgsql;
  DROP TRIGGER IF EXISTS trig_pli_search_vector ON production_list_items;
  CREATE TRIGGER trig_pli_search_vector
    BEFORE INSERT OR UPDATE ON production_list_items
    FOR EACH ROW EXECUTE FUNCTION pli_search_vector_update();
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'pli trigger skipped: %', SQLERRM;
END $$;

DO $$ BEGIN
  CREATE OR REPLACE FUNCTION rent_deals_search_vector_update() RETURNS trigger AS $fn$
  BEGIN
    NEW.search_vector :=
      setweight(to_tsvector('ru_search', coalesce(NEW.counterparty_name, '')), 'A') ||
      setweight(to_tsvector('ru_search', coalesce(NEW.inn, '')), 'B') ||
      setweight(to_tsvector('ru_search', coalesce(NEW.counterparty_contact, '')), 'C') ||
      setweight(to_tsvector('ru_search', coalesce(NEW.legal_address, '')), 'C') ||
      setweight(to_tsvector('ru_search', coalesce(NEW.counterparty_email, '')), 'D');
    RETURN NEW;
  END;
  $fn$ LANGUAGE plpgsql;
  DROP TRIGGER IF EXISTS trig_rent_deals_search_vector ON rent_deals;
  CREATE TRIGGER trig_rent_deals_search_vector
    BEFORE INSERT OR UPDATE ON rent_deals
    FOR EACH ROW EXECUTE FUNCTION rent_deals_search_vector_update();
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'rent_deals trigger skipped: %', SQLERRM;
END $$;

DO $$ BEGIN
  CREATE OR REPLACE FUNCTION locations_search_vector_update() RETURNS trigger AS $fn$
  BEGIN
    NEW.search_vector :=
      setweight(to_tsvector('ru_search', coalesce(NEW.name, '')), 'A') ||
      setweight(to_tsvector('ru_search', coalesce(NEW.address, '')), 'B') ||
      setweight(to_tsvector('ru_search', coalesce(NEW.description, '')), 'C') ||
      setweight(to_tsvector('ru_search', coalesce(NEW.notes, '')), 'C') ||
      setweight(to_tsvector('ru_search', coalesce(NEW.contact_name, '')), 'D') ||
      setweight(to_tsvector('ru_search', coalesce(array_to_string(NEW.features, ' '), '')), 'D');
    RETURN NEW;
  END;
  $fn$ LANGUAGE plpgsql;
  DROP TRIGGER IF EXISTS trig_locations_search_vector ON locations;
  CREATE TRIGGER trig_locations_search_vector
    BEFORE INSERT OR UPDATE ON locations
    FOR EACH ROW EXECUTE FUNCTION locations_search_vector_update();
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'locations trigger skipped: %', SQLERRM;
END $$;

DO $$ BEGIN
  CREATE OR REPLACE FUNCTION decorations_search_vector_update() RETURNS trigger AS $fn$
  BEGIN
    NEW.search_vector :=
      setweight(to_tsvector('ru_search', coalesce(NEW.name, '')), 'A') ||
      setweight(to_tsvector('ru_search', coalesce(NEW.description, '')), 'C');
    RETURN NEW;
  END;
  $fn$ LANGUAGE plpgsql;
  DROP TRIGGER IF EXISTS trig_decorations_search_vector ON decorations;
  CREATE TRIGGER trig_decorations_search_vector
    BEFORE INSERT OR UPDATE ON decorations
    FOR EACH ROW EXECUTE FUNCTION decorations_search_vector_update();
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'decorations trigger skipped: %', SQLERRM;
END $$;

DO $$ BEGIN
  CREATE OR REPLACE FUNCTION vehicles_search_vector_update() RETURNS trigger AS $fn$
  BEGIN
    NEW.search_vector :=
      setweight(to_tsvector('ru_search', coalesce(NEW.name, '')), 'A') ||
      setweight(to_tsvector('ru_search', coalesce(NEW.brand, '')), 'B') ||
      setweight(to_tsvector('ru_search', coalesce(NEW.model, '')), 'B') ||
      setweight(to_tsvector('ru_search', coalesce(NEW.license_plate, '')), 'B') ||
      setweight(to_tsvector('ru_search', coalesce(NEW.description, '')), 'C') ||
      setweight(to_tsvector('ru_search', coalesce(NEW.color, '')), 'D') ||
      setweight(to_tsvector('ru_search', coalesce(NEW.vin, '')), 'D') ||
      setweight(to_tsvector('ru_search', coalesce(NEW.owner_name, '')), 'D');
    RETURN NEW;
  END;
  $fn$ LANGUAGE plpgsql;
  DROP TRIGGER IF EXISTS trig_vehicles_search_vector ON vehicles;
  CREATE TRIGGER trig_vehicles_search_vector
    BEFORE INSERT OR UPDATE ON vehicles
    FOR EACH ROW EXECUTE FUNCTION vehicles_search_vector_update();
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'vehicles trigger skipped: %', SQLERRM;
END $$;

DO $$ BEGIN
  CREATE OR REPLACE FUNCTION casting_search_vector_update() RETURNS trigger AS $fn$
  BEGIN
    NEW.search_vector :=
      setweight(to_tsvector('ru_search', coalesce(NEW.name, '')), 'A') ||
      setweight(to_tsvector('ru_search', coalesce(NEW.role_name, '')), 'B') ||
      setweight(to_tsvector('ru_search', coalesce(NEW.agency, '')), 'C') ||
      setweight(to_tsvector('ru_search', coalesce(NEW.experience, '')), 'C') ||
      setweight(to_tsvector('ru_search', coalesce(NEW.notes, '')), 'C');
    RETURN NEW;
  END;
  $fn$ LANGUAGE plpgsql;
  DROP TRIGGER IF EXISTS trig_casting_search_vector ON casting_cards;
  CREATE TRIGGER trig_casting_search_vector
    BEFORE INSERT OR UPDATE ON casting_cards
    FOR EACH ROW EXECUTE FUNCTION casting_search_vector_update();
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'casting trigger skipped: %', SQLERRM;
END $$;

-- ============================================================
-- 5. BACKFILL all existing data (triggers fire on UPDATE)
-- ============================================================
UPDATE units SET name = name WHERE search_vector IS NULL;
DO $$ BEGIN UPDATE scenes SET canonical_id = canonical_id WHERE search_vector IS NULL; EXCEPTION WHEN OTHERS THEN NULL; END $$;
DO $$ BEGIN UPDATE documents SET original_name = original_name WHERE search_vector IS NULL; EXCEPTION WHEN OTHERS THEN NULL; END $$;
DO $$ BEGIN UPDATE production_list_items SET name = name WHERE search_vector IS NULL; EXCEPTION WHEN OTHERS THEN NULL; END $$;
DO $$ BEGIN UPDATE rent_deals SET counterparty_name = counterparty_name WHERE search_vector IS NULL; EXCEPTION WHEN OTHERS THEN NULL; END $$;
DO $$ BEGIN UPDATE locations SET name = name WHERE search_vector IS NULL; EXCEPTION WHEN OTHERS THEN NULL; END $$;
DO $$ BEGIN UPDATE decorations SET name = name WHERE search_vector IS NULL; EXCEPTION WHEN OTHERS THEN NULL; END $$;
DO $$ BEGIN UPDATE vehicles SET name = name WHERE search_vector IS NULL; EXCEPTION WHEN OTHERS THEN NULL; END $$;
DO $$ BEGIN UPDATE casting_cards SET name = name WHERE search_vector IS NULL; EXCEPTION WHEN OTHERS THEN NULL; END $$;

-- ============================================================
-- 6. Search history table
-- ============================================================
CREATE TABLE IF NOT EXISTS search_history (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID REFERENCES users(id) ON DELETE CASCADE,
  query      TEXT NOT NULL,
  result_count INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_search_history_user ON search_history(user_id, created_at DESC);
