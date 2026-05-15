const db = require('../db')

// Эффективный набор проектов пользователя для склада проекта:
// primary users.project_id ∪ членства user_projects (scoped multi-project).
async function getUserProjectIds(userId) {
  if (!userId) return []
  const { rows } = await db.query(
    `SELECT project_id FROM user_projects WHERE user_id = $1
     UNION
     SELECT project_id FROM users WHERE id = $1 AND project_id IS NOT NULL`,
    [userId]
  )
  return rows.map(r => r.project_id)
}

module.exports = { getUserProjectIds }
