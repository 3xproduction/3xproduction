// Единый словарь категорий: ключ (БД) → русское название
// Исторические ключи (costumes, clothing, lighting, sound, camera, makeup) оставлены
// для совместимости со старыми данными — но в новых формах не предлагаются.
export const CATEGORY_MAP = {
  props:     'Реквизит',
  art_fill:  'Художественное наполнение',
  dummy:     'Бутафория',
  auto:      'Автомобили',
  furniture: 'Мебель',
  decor:     'Декор',
  scenery:   'Декорации',
  tech:      'Техника',
  shoes:       'Обувь',
  jewelry:     'Украшения',
  accessories: 'Аксессуары',
  costumes:    'Костюмы',
  food:        'Еда',
  drinks:      'Напитки',
  other:       'Прочее',
  // legacy-ключи для отображения уже существующих единиц
  clothing:  'Одежда',
  lighting:  'Осветительное оборудование',
  sound:     'Звуковое оборудование',
  camera:    'Камерное оборудование',
  makeup:    'Грим и косметика',
}

export const ALL_CATEGORIES = Object.keys(CATEGORY_MAP)
export const ALL_CATEGORIES_RU = Object.values(CATEGORY_MAP)
export const CATEGORIES_FILTER = ['all', ...ALL_CATEGORIES]

// Категории, предлагаемые в UI при создании секций/единиц
export const ACTIVE_CATEGORIES = [
  'props', 'art_fill', 'dummy',
  'auto', 'furniture', 'decor', 'scenery', 'tech',
  'shoes', 'jewelry', 'accessories', 'costumes',
  'food', 'drinks',
  'other',
]

// Категории, относящиеся к расходному (исходящему) фонду —
// всё, что не возвращается: еда, напитки.
export const CONSUMABLE_CATEGORIES = new Set(['food', 'drinks'])

// Подмножества категорий, подходящие под конкретный тип хранения.
// Используются в конструкторе секции.
export const CATEGORIES_BY_STORAGE = {
  shelf:  ['props', 'art_fill', 'dummy', 'decor', 'scenery', 'tech', 'shoes', 'jewelry', 'accessories', 'costumes', 'food', 'drinks', 'other'],
  hanger: ['costumes', 'shoes', 'accessories', 'jewelry'],
  place:  ['auto', 'furniture', 'dummy', 'tech'],
}

export const categoryLabel = (key) => CATEGORY_MAP[key] || key
export const categoryKey = (label) => Object.keys(CATEGORY_MAP).find(k => CATEGORY_MAP[k] === label) || label
