const MISSING_UNIT_DATA_ROLES = new Set([
  'warehouse_director',
  'warehouse_deputy',
  'warehouse_staff',
  'producer',
])

function hasValue(value) {
  return value !== null && value !== undefined && String(value).trim() !== ''
}

function unitMissingFields(unit = {}) {
  const missing = []
  if (!hasValue(unit.source)) missing.push('source')
  if (!hasValue(unit.valuation) && !hasValue(unit.purchase_price)) missing.push('valuation')
  if (!hasValue(unit.dimensions)) missing.push('dimensions')
  return missing
}

function canSeeMissingUnitData(role) {
  return MISSING_UNIT_DATA_ROLES.has(role)
}

module.exports = { unitMissingFields, canSeeMissingUnitData }
