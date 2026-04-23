// Compatibility matrix between warehouse section types for moving a unit.
// Rule of thumb:
//   - Shelf items are small/rigid → shelf only.
//   - Hanger items are flexible (clothing) → any shelf-type section.
//   - Place items are oversized (vehicles, furniture) → only another place.
//   - Pavilion is an "always-on" destination (shooting floor) — anything can go there
//     and from a pavilion anything can return to any warehouse section type.
//
// Keep this in sync with frontend/src/constants/storageRules.js

const SECTION_TYPES = ['shelf', 'hanger', 'place']

// MOVE_MATRIX[from][to] = boolean
const MOVE_MATRIX = {
  shelf:  { shelf: true,  hanger: false, place: false },
  hanger: { shelf: true,  hanger: true,  place: false },
  place:  { shelf: false, hanger: false, place: true  },
}

// When the unit has no current cell (fresh unit, or coming from pavilion),
// fall back to a category->types map. 'custom' is wildcard.
// Mirrors CATEGORIES_BY_STORAGE on the frontend.
const CATEGORIES_BY_STORAGE = {
  shelf:  ['props', 'art_fill', 'dummy', 'decor', 'scenery', 'tech', 'shoes', 'jewelry', 'accessories', 'costumes', 'food', 'drinks', 'other'],
  hanger: ['costumes', 'shoes', 'accessories', 'jewelry'],
  place:  ['auto', 'furniture', 'dummy', 'tech'],
}

function canMoveBetweenSections(fromType, toType) {
  if (!fromType || !toType) return false
  return Boolean(MOVE_MATRIX[fromType]?.[toType])
}

function allowedSectionTypesForCategory(category) {
  const result = []
  for (const t of SECTION_TYPES) {
    if (CATEGORIES_BY_STORAGE[t].includes(category)) result.push(t)
  }
  return result
}

module.exports = {
  SECTION_TYPES,
  MOVE_MATRIX,
  CATEGORIES_BY_STORAGE,
  canMoveBetweenSections,
  allowedSectionTypesForCategory,
}
