-- ============================================================
-- 037: Lower AI tag weight from B to D in search_vector
-- Tags were overpowering name matches, causing false positives
-- (e.g. "нож" in weapon search matching "ножки" in chair tags)
-- ============================================================

-- 1. Update trigger: search_tags moved from weight B to weight D
CREATE OR REPLACE FUNCTION units_search_vector_update() RETURNS trigger AS $$
BEGIN
  NEW.search_vector :=
    setweight(to_tsvector('ru_search', coalesce(NEW.name, '')), 'A') ||
    setweight(to_tsvector('ru_search', coalesce(NEW.serial, '')), 'B') ||
    setweight(to_tsvector('ru_search', coalesce(NEW.category, '')), 'B') ||
    setweight(to_tsvector('ru_search', coalesce(NEW.description, '')), 'C') ||
    setweight(to_tsvector('ru_search', coalesce(NEW.condition, '')), 'C') ||
    setweight(to_tsvector('ru_search', coalesce(array_to_string(NEW.search_tags, ' '), '')), 'D') ||
    setweight(to_tsvector('ru_search', coalesce(NEW.period, '')), 'D') ||
    setweight(to_tsvector('ru_search', coalesce(NEW.dimensions, '')), 'D') ||
    setweight(to_tsvector('ru_search', coalesce(NEW.source, '')), 'D');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 2. Re-backfill all units so vectors are recalculated with new weights
UPDATE units SET name = name;
