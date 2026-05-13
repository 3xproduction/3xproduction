// Сетки размеров для одежды/костюмов и обуви.
// Используется в AddUnitModal, UnitsPage (визард) и UnitCardModal (edit-mode).

export const CLOTHING_SIZES_INT = ['XS', 'S', 'M', 'L', 'XL', 'XXL', 'XXXL']
export const CLOTHING_SIZES_RU  = ['40', '42', '44', '46', '48', '50', '52', '54', '56', '58', '60']
export const SHOE_SIZES         = ['35', '36', '37', '38', '39', '40', '41', '42', '43', '44', '45', '46', '47']

// Категории, которые поддерживают сетку размеров (одежда/обувь/аксессуары).
export const IS_SIZED_CAT = (cat) => ['costumes', 'clothing', 'shoes', 'accessories'].includes(cat)

// Категория, у которой по умолчанию сетка обуви (без переключателя).
export const IS_SHOES_CAT = (cat) => cat === 'shoes'

// Backwards-compat: старое имя продолжает работать.
export const IS_CLOTHING_CAT = IS_SIZED_CAT

// Угадать тип сетки по сохранённому значению `dimensions` и категории.
// Возвращает { kind, region } где kind — 'clothing' | 'shoe' | 'free',
// region — 'ru' | 'int' (только для clothing).
export function guessSizeMode(value, category) {
  const isShoes = IS_SHOES_CAT(category)
  const isSized = IS_SIZED_CAT(category)
  if (!value) {
    if (isShoes) return { kind: 'shoe', region: 'ru' }
    return { kind: isSized ? 'clothing' : 'free', region: 'ru' }
  }
  const v = String(value).trim().toUpperCase()
  if (isSized) {
    if (CLOTHING_SIZES_INT.includes(v)) return { kind: 'clothing', region: 'int' }
    if (CLOTHING_SIZES_RU.includes(v))  return { kind: 'clothing', region: 'ru' }
    if (SHOE_SIZES.includes(v))         return { kind: 'shoe', region: 'ru' }
    return { kind: isShoes ? 'shoe' : 'free', region: 'ru' }
  }
  return { kind: 'free', region: 'ru' }
}
