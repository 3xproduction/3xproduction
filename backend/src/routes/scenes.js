const router = require('express').Router()
const db = require('../db')
const { verifyJWT } = require('../middleware/auth')

// GET /scenes?project_id=X — list all scenes for a project
router.get('/', verifyJWT, async (req, res) => {
  const { project_id } = req.query
  if (!project_id) return res.status(400).json({ error: 'Missing project_id' })
  try {
    const { rows } = await db.query(
      `SELECT canonical_id, series, scene_number, date, day_number, time_slot, object, synopsis, location
       FROM scenes WHERE project_id = $1
       ORDER BY series NULLS FIRST, scene_number`,
      [project_id]
    )
    res.json({ scenes: rows })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Server error' })
  }
})

// GET /scenes/ai-tasks?project_id=X — list AI task statuses for a project
router.get('/ai-tasks', verifyJWT, async (req, res) => {
  const { project_id } = req.query
  if (!project_id) return res.status(400).json({ error: 'Missing project_id' })
  try {
    const { rows } = await db.query(
      `SELECT id, document_id, task_type, status, attempts, max_attempts, error, created_at, completed_at
       FROM ai_tasks WHERE project_id = $1
       ORDER BY created_at DESC LIMIT 20`,
      [project_id]
    )
    res.json({ tasks: rows })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Server error' })
  }
})

// POST /scenes/ai-tasks/:id/retry — retry a failed AI task
router.post('/ai-tasks/:id/retry', verifyJWT, async (req, res) => {
  if (!['producer', 'project_director'].includes(req.user.role)) {
    return res.status(403).json({ error: 'Producer only' })
  }
  try {
    await db.query(
      `UPDATE ai_tasks SET status = 'pending', attempts = 0, error = NULL WHERE id = $1`,
      [req.params.id]
    )
    res.json({ ok: true })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Server error' })
  }
})

module.exports = router
