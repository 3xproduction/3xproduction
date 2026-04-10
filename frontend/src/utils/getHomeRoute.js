import { ROLES } from '../constants/roles'

/**
 * Returns the landing route for a given role after login.
 */
export function getHomeRoute(role) {
  if (!role) return '/dashboard'

  const def = ROLES[role]
  if (!def) return '/dashboard'

  // Warehouse world
  if (def.world === 'warehouse') return '/dashboard'

  // Production world
  if (role === 'producer') return '/analytics/producer'

  // Roles that only read documents (no own lists)
  const readOnlyRoles = [
    'driver', 'gaffer', 'dop', 'camera_mechanic',
    'playback', 'casting_director', 'casting_assistant',
    'assistant_director', 'set_admin',
    'project_deputy', 'project_deputy_upload',
    'director', 'ams_assistant',
  ]
  if (readOnlyRoles.includes(role)) return '/production/documents'

  // Roles with own lists
  return '/production/lists'
}
