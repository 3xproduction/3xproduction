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
  if (role === 'costume_designer') return '/production/project-warehouse?tab=my'

  // All production roles go to documents
  return '/production/documents'
}
