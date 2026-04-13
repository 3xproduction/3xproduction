const router = require('express').Router()
const db     = require('../db')
const { verifyJWT } = require('../middleware/auth')

// GET /team — list team members visible to current user
router.get('/', verifyJWT, async (req, res) => {
  const user = req.user
  try {
    let rows

    if (user.project_id) {
      // Production roles — show everyone in the same project
      const result = await db.query(
        `SELECT id, name, email, role, warehouse_zone, created_at
         FROM users WHERE project_id = $1 ORDER BY name`,
        [user.project_id]
      )
      rows = result.rows
    } else {
      // Warehouse roles — show all warehouse users (no project_id)
      const result = await db.query(
        `SELECT id, name, email, role, warehouse_zone, created_at
         FROM users WHERE project_id IS NULL ORDER BY name`
      )
      rows = result.rows
    }

    res.json({ team: rows })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Server error' })
  }
})

// DELETE /team/:userId — remove team member (revoke access)
router.delete('/:userId', verifyJWT, async (req, res) => {
  const user = req.user
  const targetId = req.params.userId

  // Only directors can remove members
  const canRemove = ['warehouse_director', 'project_director'].includes(user.role)
  if (!canRemove) return res.status(403).json({ error: 'Forbidden' })

  // Cannot remove yourself
  if (targetId === user.id) return res.status(400).json({ error: 'Cannot remove yourself' })

  try {
    const { rows } = await db.query(`SELECT id, role, project_id FROM users WHERE id = $1`, [targetId])
    if (!rows.length) return res.status(404).json({ error: 'User not found' })

    const target = rows[0]

    // warehouse_director can only remove warehouse users (no project_id)
    if (user.role === 'warehouse_director' && target.project_id) {
      return res.status(403).json({ error: 'Cannot remove production users' })
    }
    // project_director can only remove users in same project
    if (user.role === 'project_director' && target.project_id !== user.project_id) {
      return res.status(403).json({ error: 'Cannot remove users from other projects' })
    }

    await db.query(`DELETE FROM users WHERE id = $1`, [targetId])
    res.json({ ok: true })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Server error' })
  }
})

// PATCH /team/:userId/project — move user to a different project (producer only)
router.patch('/:userId/project', verifyJWT, async (req, res) => {
  if (req.user.role !== 'producer') return res.status(403).json({ error: 'Producer only' })
  const { project_id } = req.body
  if (!project_id) return res.status(400).json({ error: 'Missing project_id' })
  try {
    const { rows: target } = await db.query(`SELECT id, role FROM users WHERE id = $1`, [req.params.userId])
    if (!target.length) return res.status(404).json({ error: 'User not found' })
    // Don't move warehouse roles or producers
    const noMove = ['warehouse_director', 'warehouse_deputy', 'warehouse_staff', 'producer']
    if (noMove.includes(target[0].role)) return res.status(400).json({ error: 'Cannot move this role' })
    await db.query(`UPDATE users SET project_id = $1 WHERE id = $2`, [project_id, req.params.userId])
    res.json({ ok: true })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Server error' })
  }
})

// POST /team/bulk-move — move all production users without project to a specific project
router.post('/bulk-move', verifyJWT, async (req, res) => {
  if (req.user.role !== 'producer') return res.status(403).json({ error: 'Producer only' })
  const { project_id } = req.body
  if (!project_id) return res.status(400).json({ error: 'Missing project_id' })
  try {
    const noMove = ['warehouse_director', 'warehouse_deputy', 'warehouse_staff', 'producer']
    const { rowCount } = await db.query(
      `UPDATE users SET project_id = $1
       WHERE project_id IS NULL AND role NOT IN (${noMove.map((_, i) => `$${i + 2}`).join(',')})`,
      [project_id, ...noMove]
    )
    res.json({ ok: true, moved: rowCount })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Server error' })
  }
})

module.exports = router
