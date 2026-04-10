-- Fuzzy search with pg_trgm + synonyms table
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- GIN index for trigram similarity on units
CREATE INDEX IF NOT EXISTS idx_units_name_trgm ON units USING gin (name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_units_description_trgm ON units USING gin (description gin_trgm_ops);

-- Synonyms table for intuitive search
CREATE TABLE IF NOT EXISTS search_synonyms (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  term TEXT NOT NULL,
  synonyms TEXT[] NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_synonyms_term ON search_synonyms (lower(term));

-- Seed basic synonyms for film production props
INSERT INTO search_synonyms (term, synonyms) VALUES
  ('стул', ARRAY['кресло', 'табурет', 'стульчик', 'табуретка']),
  ('кресло', ARRAY['стул', 'диван', 'кушетка']),
  ('стол', ARRAY['столик', 'парта', 'бюро', 'комод']),
  ('пистолет', ARRAY['оружие', 'револьвер', 'ствол', 'наган', 'маузер', 'беретта']),
  ('оружие', ARRAY['пистолет', 'винтовка', 'ружьё', 'автомат', 'сабля', 'меч', 'кинжал']),
  ('телефон', ARRAY['мобильный', 'смартфон', 'сотовый', 'трубка']),
  ('лампа', ARRAY['светильник', 'торшер', 'люстра', 'бра', 'фонарь']),
  ('шкаф', ARRAY['комод', 'буфет', 'сервант', 'гардероб', 'тумба']),
  ('машина', ARRAY['автомобиль', 'авто', 'транспорт']),
  ('платье', ARRAY['костюм', 'наряд', 'одежда', 'туалет']),
  ('картина', ARRAY['полотно', 'портрет', 'пейзаж', 'холст', 'рамка']),
  ('книга', ARRAY['том', 'фолиант', 'журнал', 'газета', 'альбом']),
  ('посуда', ARRAY['тарелка', 'чашка', 'бокал', 'кувшин', 'ваза', 'блюдо']),
  ('ковёр', ARRAY['палас', 'дорожка', 'коврик', 'гобелен']),
  ('зеркало', ARRAY['трюмо', 'трельяж']),
  ('часы', ARRAY['будильник', 'хронометр', 'ходики']),
  ('чемодан', ARRAY['сумка', 'саквояж', 'баул', 'портфель', 'кейс']),
  ('свеча', ARRAY['подсвечник', 'канделябр', 'лампада'])
ON CONFLICT DO NOTHING;
