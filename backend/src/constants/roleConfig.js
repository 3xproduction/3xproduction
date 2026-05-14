// Единый источник правды для маппинга роль → категории списков.
// ВАЖНО: значения ROLE_CATEGORIES должны совпадать с ownLists в
// frontend/src/constants/roles.js. При изменении — менять ОБА файла.

const ALL_CATEGORIES = [
  'props', 'art_fill', 'dummy', 'auto', 'decoration',
  'costumes', 'makeup', 'stunts', 'pyrotechnics', 'consultant', 'locations',
]

const ROLE_CATEGORIES = {
  production_designer:      ALL_CATEGORIES.filter(c => c !== 'locations'),
  art_director_assistant:   ALL_CATEGORIES.filter(c => c !== 'locations'),
  first_assistant_director: ALL_CATEGORIES.filter(c => c !== 'locations'),
  director:                 ['auto', 'decoration', 'stunts', 'pyrotechnics', 'consultant', 'makeup'],
  assistant_director:       ['auto', 'decoration', 'stunts', 'pyrotechnics', 'consultant', 'makeup'],
  props_master:             ['props', 'art_fill', 'dummy', 'auto', 'decoration', 'pyrotechnics', 'consultant', 'costumes'],
  props_assistant:          ['props', 'art_fill', 'dummy', 'auto', 'decoration', 'pyrotechnics', 'costumes'],
  decorator:                ['decoration', 'props', 'art_fill', 'dummy', 'consultant'],
  costumer:                 ['costumes'],
  costume_designer:         ['costumes'],
  costume_assistant:        ['costumes'],
  makeup_artist:            ['makeup'],
  stunt_coordinator:        ['stunts'],
  pyrotechnician:           ['pyrotechnics'],
  location_manager:         ['locations'],
}

const SEE_ALL_ROLES = [
  'production_designer', 'art_director_assistant',
  'first_assistant_director', 'director', 'project_director', 'producer',
]

module.exports = { ALL_CATEGORIES, ROLE_CATEGORIES, SEE_ALL_ROLES }
