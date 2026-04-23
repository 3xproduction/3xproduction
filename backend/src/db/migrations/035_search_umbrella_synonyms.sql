-- ============================================================
-- 035: Umbrella / meta synonym terms for category-level search
-- Adds generic terms like "одежда", "мебель" that map to
-- all items in their category, enabling cross-group discovery
-- ============================================================

-- Meta-terms for clothing
INSERT INTO search_synonyms (term, synonyms, category) VALUES
('одежда', ARRAY['халат','костюм','платье','рубашка','брюки','юбка','пиджак','свитер','футболка','майка','блуза','сорочка','туника','сарафан','пижама','комбинезон','фартук','корсет','камзол','пальто','куртка','шуба','плащ','жилет','накидка','пуховик','кафтан','шинель','тулуп','дублёнка'], 'meta')
ON CONFLICT (lower(term)) DO UPDATE SET synonyms = EXCLUDED.synonyms, category = EXCLUDED.category;

INSERT INTO search_synonyms (term, synonyms, category) VALUES
('верхняя_одежда', ARRAY['пальто','куртка','шуба','плащ','накидка','жилет','пуховик','ветровка','бомбер','парка','тренч','кардиган','пончо','мантия','кафтан','бушлат','шинель','тулуп','дублёнка','полушубок'], 'meta')
ON CONFLICT (lower(term)) DO UPDATE SET synonyms = EXCLUDED.synonyms, category = EXCLUDED.category;

-- Meta-terms for furniture
INSERT INTO search_synonyms (term, synonyms, category) VALUES
('мебель', ARRAY['стул','стол','шкаф','диван','кровать','полка','тумба','скамья','кресло','табурет','комод','буфет','сервант','трюмо','этажерка','банкетка','пуф','оттоманка','кушетка','софа','тахта','секретер','бюро','конторка','парта','верстак','витрина','ширма','раскладушка','гамак','колыбель'], 'meta')
ON CONFLICT (lower(term)) DO UPDATE SET synonyms = EXCLUDED.synonyms, category = EXCLUDED.category;

-- Meta-terms for headwear
INSERT INTO search_synonyms (term, synonyms, category) VALUES
('головной_убор', ARRAY['шляпа','шапка','кепка','берет','панама','платок','фуражка','каска','шлем','тюрбан','колпак','цилиндр','котелок','пилотка','папаха','ушанка','бандана','тиара','корона','капюшон','чалма','буденовка'], 'meta')
ON CONFLICT (lower(term)) DO UPDATE SET synonyms = EXCLUDED.synonyms, category = EXCLUDED.category;

-- Meta-terms for footwear
INSERT INTO search_synonyms (term, synonyms, category) VALUES
('обувь', ARRAY['сапоги','ботинки','туфли','кеды','кроссовки','тапочки','сандалии','босоножки','валенки','лапти','мокасины','калоши','шлёпанцы','лоферы','ботфорты','унты','чешки','балетки'], 'meta')
ON CONFLICT (lower(term)) DO UPDATE SET synonyms = EXCLUDED.synonyms, category = EXCLUDED.category;

-- Meta-terms for weapons
INSERT INTO search_synonyms (term, synonyms, category) VALUES
('оружие', ARRAY['меч','сабля','шпага','кинжал','нож','топор','копьё','лук','арбалет','щит','булава','палица','кистень','алебарда','ружьё','пистолет','револьвер','мушкет','пулемёт','кобура','патронташ','граната'], 'meta')
ON CONFLICT (lower(term)) DO UPDATE SET synonyms = EXCLUDED.synonyms, category = EXCLUDED.category;

-- Meta-terms for tableware
INSERT INTO search_synonyms (term, synonyms, category) VALUES
('посуда', ARRAY['тарелка','чашка','стакан','кружка','бокал','рюмка','кувшин','чайник','кастрюля','сковорода','ложка','вилка','нож','половник','миска','салатник','блюдо','супница','соусник','графин','самовар','поднос','сахарница','молочник','маслёнка','солонка'], 'meta')
ON CONFLICT (lower(term)) DO UPDATE SET synonyms = EXCLUDED.synonyms, category = EXCLUDED.category;

-- Meta-terms for kitchen
INSERT INTO search_synonyms (term, synonyms, category) VALUES
('кухня', ARRAY['плита','духовка','холодильник','микроволновка','тостер','чайник','кофеварка','блендер','мясорубка','скалка','ступка','дуршлаг','разделочная_доска','противень','казан','самовар'], 'meta')
ON CONFLICT (lower(term)) DO UPDATE SET synonyms = EXCLUDED.synonyms, category = EXCLUDED.category;

-- Meta-terms for lighting
INSERT INTO search_synonyms (term, synonyms, category) VALUES
('освещение', ARRAY['люстра','лампа','светильник','торшер','бра','фонарь','канделябр','подсвечник','свечи','керосиновая_лампа','настольная_лампа','абажур','ночник'], 'meta')
ON CONFLICT (lower(term)) DO UPDATE SET synonyms = EXCLUDED.synonyms, category = EXCLUDED.category;

INSERT INTO search_synonyms (term, synonyms, category) VALUES
('свет', ARRAY['люстра','лампа','светильник','торшер','бра','фонарь','канделябр','подсвечник','свечи','керосиновая_лампа','настольная_лампа','абажур','ночник'], 'meta')
ON CONFLICT (lower(term)) DO UPDATE SET synonyms = EXCLUDED.synonyms, category = EXCLUDED.category;

-- Meta-terms for medical
INSERT INTO search_synonyms (term, synonyms, category) VALUES
('медицина', ARRAY['аптечка','шприц','стетоскоп','костыли','бинт','скальпель','пинцет','термометр','капельница','тонометр','носилки','каталка','гипс','повязка'], 'meta')
ON CONFLICT (lower(term)) DO UPDATE SET synonyms = EXCLUDED.synonyms, category = EXCLUDED.category;

-- Meta-terms for textiles
INSERT INTO search_synonyms (term, synonyms, category) VALUES
('текстиль', ARRAY['штора','занавеска','тюль','скатерть','салфетка','полотенце','одеяло','подушка','покрывало','плед','ковёр','половик','гобелен','портьера','балдахин','постельное_бельё'], 'meta')
ON CONFLICT (lower(term)) DO UPDATE SET synonyms = EXCLUDED.synonyms, category = EXCLUDED.category;

-- Meta-terms for decor
INSERT INTO search_synonyms (term, synonyms, category) VALUES
('декор', ARRAY['картина','рамка','зеркало','ваза','статуэтка','часы','подсвечник','фоторамка','панно','барельеф','бюст','глобус','икона'], 'meta')
ON CONFLICT (lower(term)) DO UPDATE SET synonyms = EXCLUDED.synonyms, category = EXCLUDED.category;

-- Meta-terms for office
INSERT INTO search_synonyms (term, synonyms, category) VALUES
('канцелярия', ARRAY['ручка','карандаш','перо','чернильница','блокнот','тетрадь','папка','конверт','печать','штамп','степлер','дырокол','линейка','калькулятор','глобус','пресс-папье'], 'meta')
ON CONFLICT (lower(term)) DO UPDATE SET synonyms = EXCLUDED.synonyms, category = EXCLUDED.category;

-- Meta-terms for musical instruments
INSERT INTO search_synonyms (term, synonyms, category) VALUES
('музыка', ARRAY['гитара','скрипка','пианино','рояль','баян','аккордеон','балалайка','барабан','бубен','флейта','труба','саксофон','арфа','контрабас','виолончель','орган','гармонь','домра','дудка'], 'meta')
ON CONFLICT (lower(term)) DO UPDATE SET synonyms = EXCLUDED.synonyms, category = EXCLUDED.category;

-- Meta-terms for transport
INSERT INTO search_synonyms (term, synonyms, category) VALUES
('транспорт', ARRAY['автомобиль','машина','велосипед','мотоцикл','повозка','карета','телега','сани','лодка','корабль','самолёт','поезд','трамвай','троллейбус','коляска'], 'meta')
ON CONFLICT (lower(term)) DO UPDATE SET synonyms = EXCLUDED.synonyms, category = EXCLUDED.category;

-- Meta-terms for electronics
INSERT INTO search_synonyms (term, synonyms, category) VALUES
('электроника', ARRAY['телевизор','радио','магнитофон','проигрыватель','пластинка','телефон','компьютер','монитор','клавиатура','принтер','факс','пейджер','фотоаппарат','камера','видеокамера'], 'meta')
ON CONFLICT (lower(term)) DO UPDATE SET synonyms = EXCLUDED.synonyms, category = EXCLUDED.category;

-- Meta-terms for tools
INSERT INTO search_synonyms (term, synonyms, category) VALUES
('инструменты', ARRAY['молоток','пила','отвёртка','гаечный_ключ','плоскогубцы','дрель','рубанок','стамеска','напильник','тиски','лопата','грабли','топор','кувалда','ножовка','зубило','шуруповёрт'], 'meta')
ON CONFLICT (lower(term)) DO UPDATE SET synonyms = EXCLUDED.synonyms, category = EXCLUDED.category;

-- Meta-terms for bags
INSERT INTO search_synonyms (term, synonyms, category) VALUES
('сумки', ARRAY['сумка','чемодан','рюкзак','портфель','саквояж','ранец','баул','торба','ридикюль','клатч','авоська','котомка','мешок','кошелёк'], 'meta')
ON CONFLICT (lower(term)) DO UPDATE SET synonyms = EXCLUDED.synonyms, category = EXCLUDED.category;

-- Meta-terms for accessories
INSERT INTO search_synonyms (term, synonyms, category) VALUES
('аксессуары', ARRAY['часы','очки','зонт','трость','веер','перчатки','шарф','галстук','бабочка','ремень','подтяжки','запонки','брошь','цепочка','кольцо','серьги','браслет','кулон','ожерелье'], 'meta')
ON CONFLICT (lower(term)) DO UPDATE SET synonyms = EXCLUDED.synonyms, category = EXCLUDED.category;
