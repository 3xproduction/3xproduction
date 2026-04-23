// Storage-type compatibility matrix for moving a unit between warehouse sections.
// Mirror of backend/src/constants/storageRules.js — keep in sync.
//
// Rule summary:
//   - Shelf: small/rigid items. Can only move to another shelf.
//   - Hanger: flexible clothing. Can move to shelf or hanger. Not to place.
//   - Place: oversized items (auto/furniture). Only to another place.
//   - Pavilion: separate dimension (a decoration of type=pavilion).
//     Any unit can go to a pavilion. Coming back from a pavilion is
//     handled by picking a regular section according to the unit's category.

export const SECTION_TYPES = ['shelf', 'hanger', 'place']

export const MOVE_MATRIX = {
  shelf:  { shelf: true,  hanger: false, place: false },
  hanger: { shelf: true,  hanger: true,  place: false },
  place:  { shelf: false, hanger: false, place: true  },
}

export function canMoveBetweenSections(fromType, toType) {
  if (!fromType || !toType) return false
  return Boolean(MOVE_MATRIX[fromType]?.[toType])
}

export const SECTION_TYPE_LABEL = {
  shelf:  '📚 Полка',
  hanger: '👗 Вешалка',
  place:  '🅿️ Место',
}

export const SECTION_TYPE_ICON = {
  shelf: '📚', hanger: '👗', place: '🅿️',
}
