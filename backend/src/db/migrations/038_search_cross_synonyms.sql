-- ============================================================
-- 038: Cross-reference related synonym groups
-- "чашка" should find "стакан", "стакан" should find "кружка", etc.
-- Adds missing links between related groups.
-- ============================================================

-- Drinking vessels: merge чашка ↔ стакан ↔ кружка
UPDATE search_synonyms
SET synonyms = ARRAY['кружка','чашечка','пиала','бульонница','чаша','чайная_чашка','кружечка','пивная_кружка','бокал_пивной','штайн','жбан','стакан','бокал','рюмка','фужер']
WHERE lower(term) = 'чашка';

UPDATE search_synonyms
SET synonyms = ARRAY['бокал','кубок','рюмка','фужер','кружка','чашка','чашечка','пиала','стаканчик','фужерчик']
WHERE lower(term) = 'стакан';

-- Кружка: add стакан and чашка
UPDATE search_synonyms
SET synonyms = ARRAY['чашка','стакан','кружечка','пивная_кружка','бокал_пивной','штайн','жбан','пиала']
WHERE lower(term) = 'кружка';

-- Ножи / клинки: ensure cross-links
UPDATE search_synonyms
SET synonyms = ARRAY['кинжал','клинок','лезвие','стилет','мачете','тесак','финка','перочинный_нож']
WHERE lower(term) = 'нож';

-- Куртка ↔ пальто cross-link
UPDATE search_synonyms
SET synonyms = ARRAY['ветровка','жакет','бомбер','анорак','штормовка','олимпийка','курточка','пальто','плащ']
WHERE lower(term) = 'куртка';

-- Халат: add relevant cross-links
UPDATE search_synonyms
SET synonyms = ARRAY['домашний_халат','банный_халат','медицинский_халат','кимоно','пеньюар','капот','накидка']
WHERE lower(term) = 'халат';
