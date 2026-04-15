const router = require('express').Router()
const crypto = require('crypto')
const db     = require('../db')
const { verifyJWT, checkRole } = require('../middleware/auth')

const CAN_INVITE = [
  'warehouse_director',
  'warehouse_deputy',
  'producer',
  'project_director',
]

// POST /invites/generate
router.post('/generate', verifyJWT, checkRole(...CAN_INVITE), async (req, res) => {
  const { role, project_id, warehouse_zone, upload_rights } = req.body
  if (!role) return res.status(400).json({ error: 'Missing role' })

  // For project_deputy with upload rights → use project_deputy_upload role
  let resolvedRole = role
  if (role === 'project_deputy' && upload_rights && (upload_rights.kpp || upload_rights.scenario || upload_rights.callsheet)) {
    resolvedRole = 'project_deputy_upload'
  }

  try {
    const token = crypto.randomBytes(24).toString('hex')
    const { rows } = await db.query(
      `INSERT INTO invites (token, role, project_id, warehouse_zone, created_by, upload_rights)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [token, resolvedRole, project_id || null, warehouse_zone || null, req.user.id, JSON.stringify(upload_rights || {})]
    )
    res.json({ invite: rows[0] })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Server error' })
  }
})

// GET /invites/:token
router.get('/:token', async (req, res) => {
  try {
    const { rows } = await db.query(
      `SELECT i.*, p.name AS project_name
       FROM invites i
       LEFT JOIN projects p ON p.id = i.project_id
       WHERE i.token = $1 AND i.used = FALSE`,
      [req.params.token]
    )
    if (!rows.length) return res.status(404).json({ error: 'Invite not found or already used' })
    res.json({ invite: rows[0] })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Server error' })
  }
})

module.exports = router
