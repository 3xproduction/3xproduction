// Handover acts — inventory transfer between employees on a project.
// MVP: snapshot of project units → checklist → sign.

const router = require('express').Router()
const db = require('../db')
const { verifyJWT } = require('../middleware/auth')

const PROJECT_WRITER_ROLES = new Set([
  'producer', 'project_director', 'director',
  'props_master', 'props_assistant',
  'costumer', 'costume_assistant',
])

// POST /handovers — create a new handover act (snapshot of project inventory).
// Body: { to_user_id, scope?='all' }
router.post('/', verifyJWT, async (req, res) => {
  if (!PROJECT_WRITER_ROLES.has(req.user.role)) return res.status(403).json({ error: 'Forbidden' })
  const projectId = req.user.project_id
  if (!projectId) return res.status(400).json({ error: 'No project' })
  const { to_user_id, scope = 'all' } = req.body
  if (!['all', 'props', 'costumes'].includes(scope)) return res.status(400).json({ error: 'Bad scope' })

  const client = await db.getClient()
  try {
    await client.query('BEGIN')
    const { rows: [handover] } = await client.query(
      `INSERT INTO handovers (project_id, from_user_id, to_user_id, scope, status, created_by)
       VALUES ($1,$2,$3,$4,'checking',$5) RETURNING *`,
      [projectId, req.user.id, to_user_id || null, scope, req.user.id]
    )

    // Snapshot: all non-written-off project-kept units + items issued to this project.
    const COSTUME_CATS = ['costumes', 'shoes', 'jewelry', 'accessories', 'clothing']
    let filter = ''
    if (scope === 'props')    filter = `AND u.category NOT IN (${COSTUME_CATS.map((_, i) => `$${i+2}`).join(',')})`
    if (scope === 'costumes') filter = `AND u.category IN (${COSTUME_CATS.map((_, i) => `$${i+2}`).join(',')})`
    const { rows: units } = await client.query(
      `SELECT u.id, u.name, u.category, u.qty FROM units u
       WHERE u.project_id = $1 AND u.is_project_kept = true AND u.status != 'written_off'
       ${filter}`,
      scope === 'all' ? [projectId] : [projectId, ...COSTUME_CATS]
    )
    for (const u of units) {
      await client.query(
        `INSERT INTO handover_items (handover_id, unit_id, unit_name, unit_category, qty_expected)
         VALUES ($1,$2,$3,$4,$5)`,
        [handover.id, u.id, u.name, u.category, u.qty || 1]
      )
    }
    await client.query('COMMIT')
    res.json({ handover })
  } catch (err) {
    await client.query('ROLLBACK')
    console.error(err)
    res.status(500).json({ error: 'Server error' })
  } finally { client.release() }
})

// GET /handovers?project_id=
router.get('/', verifyJWT, async (req, res) => {
  const projectId = req.query.project_id || req.user.project_id
  if (!projectId) return res.json({ handovers: [] })
  try {
    const { rows } = await db.query(
      `SELECT h.*, uf.name AS from_user_name, ut.name AS to_user_name,
              (SELECT COUNT(*) FROM handover_items WHERE handover_id = h.id) AS items_total,
              (SELECT COUNT(*) FROM handover_items WHERE handover_id = h.id AND check_status != 'pending') AS items_checked
       FROM handovers h
       LEFT JOIN users uf ON uf.id = h.from_user_id
       LEFT JOIN users ut ON ut.id = h.to_user_id
       WHERE h.project_id = $1
       ORDER BY h.created_at DESC`,
      [projectId]
    )
    res.json({ handovers: rows })
  } catch (err) {
    console.error(err)
    res.json({ handovers: [] })
  }
})

// GET /handovers/:id — act with items.
router.get('/:id', verifyJWT, async (req, res) => {
  try {
    const { rows: [handover] } = await db.query(
      `SELECT h.*, uf.name AS from_user_name, ut.name AS to_user_name, p.name AS project_name
       FROM handovers h
       LEFT JOIN users uf ON uf.id = h.from_user_id
       LEFT JOIN users ut ON ut.id = h.to_user_id
       LEFT JOIN projects p ON p.id = h.project_id
       WHERE h.id = $1`, [req.params.id]
    )
    if (!handover) return res.status(404).json({ error: 'Not found' })
    const { rows: items } = await db.query(
      `SELECT hi.*,
              (SELECT url FROM unit_photos WHERE unit_id = hi.unit_id LIMIT 1) AS unit_photo_url
       FROM handover_items hi WHERE hi.handover_id = $1 ORDER BY hi.unit_name`,
      [handover.id]
    )
    res.json({ handover, items })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Server error' })
  }
})

// PUT /handovers/:id/items/:itemId — mark checked: { check_status, note?, photo_url? }
router.put('/:id/items/:itemId', verifyJWT, async (req, res) => {
  const { check_status, note, photo_url } = req.body
  if (!['pending', 'ok', 'missing', 'damaged'].includes(check_status)) {
    return res.status(400).json({ error: 'Bad status' })
  }
  try {
    const { rows } = await db.query(
      `UPDATE handover_items
         SET check_status=$1, note=$2, photo_url=$3, checked_at=NOW(), checked_by=$4
       WHERE id=$5 AND handover_id=$6 RETURNING *`,
      [check_status, note || null, photo_url || null, req.user.id, req.params.itemId, req.params.id]
    )
    if (!rows.length) return res.status(404).json({ error: 'Not found' })
    res.json({ item: rows[0] })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Server error' })
  }
})

// POST /handovers/:id/sign — mark as signed (both sides implicitly agreed in MVP).
router.post('/:id/sign', verifyJWT, async (req, res) => {
  try {
    const { rows } = await db.query(
      `UPDATE handovers SET status='signed', signed_at=NOW() WHERE id=$1 AND status='checking' RETURNING *`,
      [req.params.id]
    )
    if (!rows.length) return res.status(404).json({ error: 'Not found or not in checking state' })
    res.json({ handover: rows[0] })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Server error' })
  }
})

// DELETE /handovers/:id
router.delete('/:id', verifyJWT, async (req, res) => {
  try {
    await db.query(`DELETE FROM handovers WHERE id=$1 AND created_by=$2`, [req.params.id, req.user.id])
    res.json({ ok: true })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Server error' })
  }
})

module.exports = router
