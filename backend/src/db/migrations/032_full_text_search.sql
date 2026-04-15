-- ============================================================
-- 032: Full-text search infrastructure
-- tsvector columns, GIN indexes, triggers, expanded synonyms
-- ============================================================

-- Extensions
CREATE EXTENSION IF NOT EXISTS unaccent;

-- Russian text search configuration with unaccent support
DO $$ BEGIN
  CREATE TEXT SEARCH CONFIGURATION ru_search (COPY = russian);
EXCEPTION WHEN unique_violation THEN NULL;
END $$;

ALTER TEXT SEARCH CONFIGURATION ru_search
  ALTER MAPPING FOR asciiword, asciihword, hword_asciipart, word, hword, hword_part
  WITH unaccent, russian_stem;

-- ============================================================
-- 1. UNITS
-- ============================================================
ALTER TABLE units ADD COLUMN IF NOT EXISTS search_vector tsvector;

CREATE OR REPLACE FUNCTION units_search_vector_update() RETURNS trigger AS $$
BEGIN
  NEW.search_vector :=
    setweight(to_tsvector('ru_search', coalesce(NEW.name, '')), 'A') ||
    setweight(to_tsvector('ru_search', coalesce(NEW.serial, '')), 'B') ||
    setweight(to_tsvector('ru_search', coalesce(NEW.category, '')), 'B') ||
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

CREATE INDEX IF NOT EXISTS idx_units_search_vector ON units USING gin (search_vector);

-- ============================================================
-- 2. SCENES
-- ============================================================
ALTER TABLE scenes ADD COLUMN IF NOT EXISTS search_vector tsvector;

CREATE OR REPLACE FUNCTION scenes_search_vector_update() RETURNS trigger AS $$
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
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trig_scenes_search_vector ON scenes;
CREATE TRIGGER trig_scenes_search_vector
  BEFORE INSERT OR UPDATE ON scenes
  FOR EACH ROW EXECUTE FUNCTION scenes_search_vector_update();

CREATE INDEX IF NOT EXISTS idx_scenes_search_vector ON scenes USING gin (search_vector);

-- ============================================================
-- 3. DOCUMENTS
-- ============================================================
ALTER TABLE documents ADD COLUMN IF NOT EXISTS search_vector tsvector;

CREATE OR REPLACE FUNCTION documents_search_vector_update() RETURNS trigger AS $$
DECLARE
  content_text TEXT := '';
  scenes_text  TEXT := '';
BEGIN
  -- Extract text from parsed_content JSONB
  IF NEW.parsed_content IS NOT NULL THEN
    BEGIN
      scenes_text := coalesce(
        (SELECT string_agg(
          coalesce(s->>'object', '') || ' ' ||
          coalesce(s->>'synopsis', '') || ' ' ||
          coalesce(s->>'location', '') || ' ' ||
          coalesce(s->>'notes', ''),
          ' '
        ) FROM jsonb_array_elements(
          CASE WHEN jsonb_typeof(NEW.parsed_content->'scenes') = 'array'
               THEN NEW.parsed_content->'scenes'
               ELSE '[]'::jsonb END
        ) AS s),
        ''
      );
    EXCEPTION WHEN OTHERS THEN
      scenes_text := '';
    END;
    content_text := scenes_text;
  END IF;

  -- Extract from parsed_data JSONB (items by category)
  IF NEW.parsed_data IS NOT NULL THEN
    BEGIN
      content_text := content_text || ' ' || coalesce(
        (SELECT string_agg(item->>'name', ' ')
         FROM jsonb_each(NEW.parsed_data) AS kv(key, val),
              LATERAL jsonb_array_elements(
                CASE WHEN jsonb_typeof(val) = 'array' THEN val ELSE '[]'::jsonb END
              ) AS item
         WHERE jsonb_typeof(item) = 'object' AND item ? 'name'),
        ''
      );
    EXCEPTION WHEN OTHERS THEN
      NULL;
    END;
  END IF;

  NEW.search_vector :=
    setweight(to_tsvector('ru_search', coalesce(NEW.original_name, '')), 'A') ||
    setweight(to_tsvector('ru_search', coalesce(NEW.type::text, '')), 'B') ||
    setweight(to_tsvector('ru_search', left(content_text, 50000)), 'C');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trig_documents_search_vector ON documents;
CREATE TRIGGER trig_documents_search_vector
  BEFORE INSERT OR UPDATE ON documents
  FOR EACH ROW EXECUTE FUNCTION documents_search_vector_update();

CREATE INDEX IF NOT EXISTS idx_documents_search_vector ON documents USING gin (search_vector);

-- ============================================================
-- 4. PRODUCTION LIST ITEMS
-- ============================================================
ALTER TABLE production_list_items ADD COLUMN IF NOT EXISTS search_vector tsvector;

CREATE OR REPLACE FUNCTION pli_search_vector_update() RETURNS trigger AS $$
BEGIN
  NEW.search_vector :=
    setweight(to_tsvector('ru_search', coalesce(NEW.name, '')), 'A') ||
    setweight(to_tsvector('ru_search', coalesce(NEW.scene, '')), 'B') ||
    setweight(to_tsvector('ru_search', coalesce(NEW.note, '')), 'C') ||
    setweight(to_tsvector('ru_search', coalesce(NEW.location, '')), 'D');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trig_pli_search_vector ON production_list_items;
CREATE TRIGGER trig_pli_search_vector
  BEFORE INSERT OR UPDATE ON production_list_items
  FOR EACH ROW EXECUTE FUNCTION pli_search_vector_update();

CREATE INDEX IF NOT EXISTS idx_pli_search_vector ON production_list_items USING gin (search_vector);

-- ============================================================
-- 5. RENT DEALS
-- ============================================================
ALTER TABLE rent_deals ADD COLUMN IF NOT EXISTS search_vector tsvector;

CREATE OR REPLACE FUNCTION rent_deals_search_vector_update() RETURNS trigger AS $$
BEGIN
  NEW.search_vector :=
    setweight(to_tsvector('ru_search', coalesce(NEW.counterparty_name, '')), 'A') ||
    setweight(to_tsvector('ru_search', coalesce(NEW.inn, '')), 'B') ||
    setweight(to_tsvector('ru_search', coalesce(NEW.counterparty_contact, '')), 'C') ||
    setweight(to_tsvector('ru_search', coalesce(NEW.legal_address, '')), 'C') ||
    setweight(to_tsvector('ru_search', coalesce(NEW.counterparty_email, '')), 'D');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trig_rent_deals_search_vector ON rent_deals;
CREATE TRIGGER trig_rent_deals_search_vector
  BEFORE INSERT OR UPDATE ON rent_deals
  FOR EACH ROW EXECUTE FUNCTION rent_deals_search_vector_update();

CREATE INDEX IF NOT EXISTS idx_rent_deals_search_vector ON rent_deals USING gin (search_vector);

-- ============================================================
-- 6. LOCATIONS
-- ============================================================
ALTER TABLE locations ADD COLUMN IF NOT EXISTS search_vector tsvector;

CREATE OR REPLACE FUNCTION locations_search_vector_update() RETURNS trigger AS $$
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
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trig_locations_search_vector ON locations;
CREATE TRIGGER trig_locations_search_vector
  BEFORE INSERT OR UPDATE ON locations
  FOR EACH ROW EXECUTE FUNCTION locations_search_vector_update();

CREATE INDEX IF NOT EXISTS idx_locations_search_vector ON locations USING gin (search_vector);

-- ============================================================
-- 7. DECORATIONS
-- ============================================================
ALTER TABLE decorations ADD COLUMN IF NOT EXISTS search_vector tsvector;

CREATE OR REPLACE FUNCTION decorations_search_vector_update() RETURNS trigger AS $$
BEGIN
  NEW.search_vector :=
    setweight(to_tsvector('ru_search', coalesce(NEW.name, '')), 'A') ||
    setweight(to_tsvector('ru_search', coalesce(NEW.description, '')), 'C');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trig_decorations_search_vector ON decorations;
CREATE TRIGGER trig_decorations_search_vector
  BEFORE INSERT OR UPDATE ON decorations
  FOR EACH ROW EXECUTE FUNCTION decorations_search_vector_update();

CREATE INDEX IF NOT EXISTS idx_decorations_search_vector ON decorations USING gin (search_vector);

-- ============================================================
-- 8. VEHICLES
-- ============================================================
ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS search_vector tsvector;

CREATE OR REPLACE FUNCTION vehicles_search_vector_update() RETURNS trigger AS $$
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
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trig_vehicles_search_vector ON vehicles;
CREATE TRIGGER trig_vehicles_search_vector
  BEFORE INSERT OR UPDATE ON vehicles
  FOR EACH ROW EXECUTE FUNCTION vehicles_search_vector_update();

CREATE INDEX IF NOT EXISTS idx_vehicles_search_vector ON vehicles USING gin (search_vector);

-- ============================================================
-- 9. CASTING CARDS
-- ============================================================
ALTER TABLE casting_cards ADD COLUMN IF NOT EXISTS search_vector tsvector;

CREATE OR REPLACE FUNCTION casting_search_vector_update() RETURNS trigger AS $$
BEGIN
  NEW.search_vector :=
    setweight(to_tsvector('ru_search', coalesce(NEW.name, '')), 'A') ||
    setweight(to_tsvector('ru_search', coalesce(NEW.role_name, '')), 'B') ||
    setweight(to_tsvector('ru_search', coalesce(NEW.agency, '')), 'C') ||
    setweight(to_tsvector('ru_search', coalesce(NEW.experience, '')), 'C') ||
    setweight(to_tsvector('ru_search', coalesce(NEW.notes, '')), 'C');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trig_casting_search_vector ON casting_cards;
CREATE TRIGGER trig_casting_search_vector
  BEFORE INSERT OR UPDATE ON casting_cards
  FOR EACH ROW EXECUTE FUNCTION casting_search_vector_update();

CREATE INDEX IF NOT EXISTS idx_casting_search_vector ON casting_cards USING gin (search_vector);

-- ============================================================
-- 10. BACKFILL existing data (triggers fire on UPDATE)
-- ============================================================
UPDATE units SET name = name;
UPDATE scenes SET canonical_id = canonical_id;
UPDATE documents SET original_name = original_name;
UPDATE production_list_items SET name = name;
UPDATE rent_deals SET counterparty_name = counterparty_name;
UPDATE locations SET name = name;
UPDATE decorations SET name = name;
UPDATE vehicles SET name = name;
UPDATE casting_cards SET name = name;

-- ============================================================
-- 11. EXPAND search_synonyms
-- ============================================================
ALTER TABLE search_synonyms ADD COLUMN IF NOT EXISTS category TEXT DEFAULT 'general';

INSERT INTO search_synonyms (term, synonyms, category) VALUES
  -- Мебель (расширение)
  ('диван', ARRAY['софа', 'кушетка', 'канапе', 'тахта'], 'furniture'),
  ('кровать', ARRAY['койка', 'ложе', 'постель', 'топчан'], 'furniture'),
  ('тумба', ARRAY['тумбочка', 'подставка', 'комод'], 'furniture'),
  ('полка', ARRAY['стеллаж', 'этажерка', 'подставка'], 'furniture'),
  ('скамья', ARRAY['скамейка', 'лавка', 'банкетка'], 'furniture'),
  -- Оружие (расширение)
  ('нож', ARRAY['кинжал', 'клинок', 'лезвие', 'стилет', 'мачете'], 'weapons'),
  ('меч', ARRAY['шпага', 'сабля', 'клинок', 'палаш', 'рапира'], 'weapons'),
  ('ружьё', ARRAY['винтовка', 'карабин', 'мушкет', 'дробовик', 'обрез'], 'weapons'),
  ('граната', ARRAY['бомба', 'взрывчатка', 'мина', 'снаряд'], 'weapons'),
  ('щит', ARRAY['броня', 'латы', 'кираса', 'доспехи'], 'weapons'),
  -- Одежда
  ('шляпа', ARRAY['шапка', 'кепка', 'берет', 'фуражка', 'каска', 'цилиндр'], 'clothing'),
  ('пальто', ARRAY['шинель', 'плащ', 'накидка', 'шуба', 'дублёнка', 'тулуп'], 'clothing'),
  ('сапоги', ARRAY['ботинки', 'обувь', 'валенки', 'туфли', 'кеды'], 'clothing'),
  ('перчатки', ARRAY['рукавицы', 'варежки', 'краги'], 'clothing'),
  ('ремень', ARRAY['пояс', 'портупея', 'кушак'], 'clothing'),
  ('рубашка', ARRAY['блуза', 'блузка', 'сорочка', 'гимнастёрка'], 'clothing'),
  ('брюки', ARRAY['штаны', 'джинсы', 'шаровары', 'галифе', 'бриджи'], 'clothing'),
  ('юбка', ARRAY['подол', 'кринолин', 'пачка'], 'clothing'),
  -- Освещение
  ('фонарь', ARRAY['факел', 'лампа', 'светильник', 'прожектор', 'фонарик'], 'lighting'),
  ('свечи', ARRAY['свеча', 'подсвечник', 'канделябр', 'лампада'], 'lighting'),
  -- Транспорт
  ('лошадь', ARRAY['конь', 'скакун', 'жеребец', 'кобыла'], 'transport'),
  ('повозка', ARRAY['карета', 'телега', 'бричка', 'дрожки', 'тачанка'], 'transport'),
  ('велосипед', ARRAY['мотоцикл', 'самокат', 'мопед'], 'transport'),
  ('грузовик', ARRAY['фура', 'газель', 'пикап', 'камаз'], 'transport'),
  -- Посуда / еда
  ('бутылка', ARRAY['фляга', 'графин', 'штоф', 'кувшин', 'бутыль'], 'props'),
  ('стакан', ARRAY['бокал', 'кубок', 'рюмка', 'фужер', 'кружка'], 'props'),
  ('тарелка', ARRAY['блюдо', 'миска', 'поднос', 'блюдце'], 'props'),
  ('нож_столовый', ARRAY['вилка', 'ложка', 'столовые_приборы'], 'props'),
  -- Документы / канцелярия
  ('письмо', ARRAY['записка', 'послание', 'телеграмма', 'конверт', 'открытка'], 'props'),
  ('газета', ARRAY['журнал', 'книга', 'брошюра', 'буклет'], 'props'),
  ('ручка', ARRAY['перо', 'карандаш', 'фломастер', 'маркер'], 'props'),
  -- Техника / электроника
  ('радио', ARRAY['рация', 'приёмник', 'магнитофон', 'патефон', 'граммофон'], 'tech'),
  ('компьютер', ARRAY['ноутбук', 'монитор', 'клавиатура', 'планшет'], 'tech'),
  ('камера', ARRAY['фотоаппарат', 'видеокамера', 'объектив'], 'tech'),
  -- Декор
  ('цветы', ARRAY['букет', 'венок', 'гирлянда', 'ваза_с_цветами'], 'decor'),
  ('занавес', ARRAY['штора', 'занавеска', 'портьера', 'гардина', 'тюль'], 'decor'),
  ('ковёр_стенной', ARRAY['гобелен', 'панно', 'ковёр'], 'decor'),
  ('рама', ARRAY['рамка', 'багет', 'обрамление'], 'decor'),
  -- Медицина
  ('аптечка', ARRAY['бинт', 'медикаменты', 'лекарства', 'шприц'], 'props'),
  ('носилки', ARRAY['каталка', 'кресло-каталка', 'костыли'], 'props'),
  -- Инструменты
  ('молоток', ARRAY['кувалда', 'киянка'], 'tools'),
  ('пила', ARRAY['ножовка', 'бензопила', 'лобзик'], 'tools'),
  ('лопата', ARRAY['кирка', 'мотыга', 'грабли', 'вилы'], 'tools'),
  ('верёвка', ARRAY['канат', 'трос', 'шнур', 'бечёвка', 'цепь'], 'tools')
ON CONFLICT DO NOTHING;

-- ============================================================
-- 12. Search history (for recent searches UI)
-- ============================================================
CREATE TABLE IF NOT EXISTS search_history (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID REFERENCES users(id) ON DELETE CASCADE,
  query      TEXT NOT NULL,
  result_count INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_search_history_user ON search_history(user_id, created_at DESC);
