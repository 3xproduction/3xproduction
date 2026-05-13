const VISIBLE_ROLES = new Set([
  'warehouse_director',
  'warehouse_deputy',
  'warehouse_staff',
  'producer',
])

const LABELS = {
  source: 'источник',
  valuation: 'цена',
  dimensions: 'размер',
}

function hasValue(value) {
  return value !== null && value !== undefined && String(value).trim() !== ''
}

function missingFromFields(unit = {}) {
  const missing = []
  if (!hasValue(unit.source)) missing.push('source')
  const hasPriceField = Object.prototype.hasOwnProperty.call(unit, 'valuation')
    || Object.prototype.hasOwnProperty.call(unit, 'purchase_price')
  if (hasPriceField && !hasValue(unit.valuation) && !hasValue(unit.purchase_price)) missing.push('valuation')
  if (!hasValue(unit.dimensions)) missing.push('dimensions')
  return missing
}

export function getUnitMissingFields(unit, role) {
  if (!VISIBLE_ROLES.has(role)) return []
  const fields = Array.isArray(unit?.missing_fields) ? unit.missing_fields : missingFromFields(unit)
  return fields.filter(key => LABELS[key])
}

export function missingUnitCardStyle(unit, role) {
  return getUnitMissingFields(unit, role).length
    ? {
        border: '2px solid #f97316',
        boxShadow: '0 0 0 3px rgba(249, 115, 22, 0.18)',
      }
    : {}
}

export function formatMissingUnitDataText(fields) {
  return `Заполнить: ${fields.map(key => LABELS[key]).join(', ')}`
}
