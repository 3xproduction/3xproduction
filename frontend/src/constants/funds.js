// Классификация единицы по фонду — derives automatically from category + valuation.
// Не хранится в БД: всегда вычисляется на лету, чтобы одна таблица цен/категорий.

import { CONSUMABLE_CATEGORIES } from './categories'

export const FUND_CONSUMABLE = 'consumable'   // Исходящий (еда, напитки)
export const FUND_PERMANENT  = 'permanent'    // Постоянный (< 10 000 ₽)
export const FUND_VALUABLE   = 'valuable'     // Ценный (≥ 10 000 ₽)

export const VALUABLE_THRESHOLD = 10000

export function unitFund(unit) {
  if (!unit) return FUND_PERMANENT
  if (CONSUMABLE_CATEGORIES.has(unit.category)) return FUND_CONSUMABLE
  const val = Number(unit.valuation)
  if (Number.isFinite(val) && val >= VALUABLE_THRESHOLD) return FUND_VALUABLE
  return FUND_PERMANENT
}

export const FUND_LABEL = {
  [FUND_CONSUMABLE]: 'Исходящий',
  [FUND_PERMANENT]:  'Постоянный',
  [FUND_VALUABLE]:   'Ценный',
}

export const FUND_COLOR = {
  [FUND_CONSUMABLE]: '#d97706',   // amber — расходный
  [FUND_PERMANENT]:  '#6b7280',   // gray — постоянный
  [FUND_VALUABLE]:   '#b45309',   // burnished gold — ценный
}
