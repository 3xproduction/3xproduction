-- 059: Колонка thumb_url у unit_photos для маленьких превью каталога.
--
-- Раньше каталог UnitsPage запрашивал оригинальный URL (1500-2000px) и
-- ужимал его браузером в 170px ячейку — на регулярных текстурах (плетёные
-- ремни, ткань) возникал муар.
--
-- Теперь POST /units/:id/photos дополнительно генерит 400px JPEG через sharp
-- и кладёт его в S3 рядом с оригиналом. Каталог берёт `photo_thumb_url`
-- (через COALESCE → photo_url для старых фото без thumb).
--
-- Старые фото подтягиваются через POST /units/admin/regen-thumbs.

ALTER TABLE unit_photos
  ADD COLUMN IF NOT EXISTS thumb_url TEXT;
