const router = require('express').Router()
const db     = require('../db')
const { verifyJWT, checkRole } = require('../middleware/auth')

const DIRECTOR_ROLES = ['warehouse_director', 'warehouse_deputy']

// GET /warehouses
router.get('/', verifyJWT, async (req, res) => {
  try {
    const { rows } = await db.query(`SELECT * FROM warehouses ORDER BY name`)
    res.json({ warehouses: rows })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Server error' })
  }
})

// POST /warehouses — create warehouse
router.post('/', verifyJWT, checkRole(...DIRECTOR_ROLES), async (req, res) => {
  const { name, address } = req.body
  if (!name) return res.status(400).json({ error: 'Name required' })
  try {
    const { rows } = await db.query(
      `INSERT INTO warehouses (name, address) VALUES ($1, $2) RETURNING *`, [name, address || null]
    )
    res.status(201).json({ warehouse: rows[0] })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: err.message || 'Server error' })
  }
})

// GET /warehouses/:id/cells — sections with cells
router.get('/:id/cells', verifyJWT, async (req, res) => {
  try {
    const { rows: sections } = await db.query(
      `SELECT * FROM warehouse_sections WHERE warehouse_id = $1 ORDER BY sort_order, name`,
      [req.params.id]
    )

    for (const section of sections) {
      const { rows: cells } = await db.query(
        `SELECT c.*, u.id AS unit_id, u.name AS unit_name, u.status AS unit_status
         FROM cells c
         LEFT JOIN units u ON u.cell_id = c.id AND u.status != 'written_off'
         WHERE c.section_id = $1 ORDER BY c.code`,
        [section.id]
      )
      section.cells = cells
    }

    res.json({ sections })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Server error' })
  }
})

// POST /sections — create section with cells
router.post('/sections', verifyJWT, checkRole(...DIRECTOR_ROLES), async (req, res) => {
  const { warehouse_id, name, category, rows: numRows, shelves, cells, type } = req.body
  if (!warehouse_id || !name || !category) return res.status(400).json({ error: 'Missing fields' })

  const client = await db.getClient()
  try {
    await client.query('BEGIN')

    const { rows: sec } = await client.query(
      `INSERT INTO warehouse_sections (warehouse_id, name, category, rows, shelves, type)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [warehouse_id, name, category, numRows || 1, shelves || 1, type || 'shelf']
    )
    const section = sec[0]

    if (cells && cells.length) {
      const seen = new Set()
      for (const cell of cells) {
        const code = (cell.id || '').trim()
        if (!code || seen.has(code)) continue
        seen.add(code)
        await client.query(
          `INSERT INTO cells (section_id, code, custom_name) VALUES ($1,$2,$3)`,
          [section.id, code, cell.custom || null]
        )
      }
    }

    await client.query('COMMIT')
    res.status(201).json({ section })
  } catch (err) {
    await client.query('ROLLBACK')
    console.error('Create section error:', err.message, err.detail || '')
    res.status(500).json({ error: err.message || 'Server error' })
  } finally {
    client.release()
  }
})

// PUT /cells/:id — rename cell
router.put('/cells/:id', verifyJWT, checkRole(...DIRECTOR_ROLES), async (req, res) => {
  const { custom_name } = req.body
  try {
    const { rows } = await db.query(
      `UPDATE cells SET custom_name=$1 WHERE id=$2 RETURNING *`,
      [custom_name || null, req.params.id]
    )
    if (!rows.length) return res.status(404).json({ error: 'Cell not found' })
    res.json({ cell: rows[0] })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Server error' })
  }
})

// PUT /sections/reorder — reorder sections
router.put('/sections/reorder', verifyJWT, checkRole(...DIRECTOR_ROLES), async (req, res) => {
  const { section_ids } = req.body
  if (!Array.isArray(section_ids)) return res.status(400).json({ error: 'section_ids required' })
  try {
    for (let i = 0; i < section_ids.length; i++) {
      await db.query(`UPDATE warehouse_sections SET sort_order=$1 WHERE id=$2`, [i, section_ids[i]])
    }
    res.json({ ok: true })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Server error' })
  }
})

// DELETE /cells/:id — delete cell
router.delete('/cells/:id', verifyJWT, checkRole(...DIRECTOR_ROLES), async (req, res) => {
  try {
    // Check if cell has units
    const { rows: units } = await db.query(
      `SELECT id FROM units WHERE cell_id = $1 AND status != 'written_off' LIMIT 1`,
      [req.params.id]
    )
    if (units.length) return res.status(400).json({ error: 'Cell has units, cannot delete' })

    const { rows } = await db.query(`DELETE FROM cells WHERE id = $1 RETURNING *`, [req.params.id])
    if (!rows.length) return res.status(404).json({ error: 'Cell not found' })
    res.json({ ok: true })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Server error' })
  }
})

// ─── Request Visibility Settings ─────────────────────────────────────────────

// GET /warehouses/request-visibility — get visibility settings
router.get('/request-visibility', verifyJWT, checkRole('warehouse_director', 'warehouse_deputy'), async (req, res) => {
  try {
    // Get all warehouse staff/deputy with their visibility setting
    const { rows } = await db.query(
      `SELECT u.id, u.name, u.role,
              COALESCE(rv.can_see_requests, true) AS can_see_requests
       FROM users u
       LEFT JOIN request_visibility rv ON rv.user_id = u.id
       WHERE u.role IN ('warehouse_deputy', 'warehouse_staff')
         AND u.project_id IS NULL
       ORDER BY u.name`
    )
    res.json({ settings: rows })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Server error' })
  }
})

// PUT /warehouses/request-visibility — update visibility for a user
router.put('/request-visibility', verifyJWT, checkRole('warehouse_director', 'warehouse_deputy'), async (req, res) => {
  const { user_id, can_see_requests } = req.body
  if (!user_id || typeof can_see_requests !== 'boolean') {
    return res.status(400).json({ error: 'Missing user_id or can_see_requests' })
  }
  try {
    await db.query(
      `INSERT INTO request_visibility (user_id, can_see_requests)
       VALUES ($1, $2)
       ON CONFLICT (user_id) DO UPDATE SET can_see_requests = $2`,
      [user_id, can_see_requests]
    )
    res.json({ ok: true })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Server error' })
  }
})

// DELETE /warehouses/:id — delete warehouse (director/deputy only)
router.delete('/:id', verifyJWT, checkRole(...DIRECTOR_ROLES), async (req, res) => {
  try {
    await db.query(`DELETE FROM warehouses WHERE id = $1`, [req.params.id])
    res.json({ ok: true })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Server error' })
  }
})

module.exports = router
