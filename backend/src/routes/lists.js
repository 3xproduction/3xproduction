const router = require('express').Router()
const db     = require('../db')
const { verifyJWT } = require('../middleware/auth')

const { ALL_CATEGORIES, ROLE_CATEGORIES, SEE_ALL_ROLES } = require('../constants/roleConfig')

function getOwnTypes(role) {
  return ROLE_CATEGORIES[role] || []
}

// GET /lists — own lists (or all if seeAllLists role)
router.get('/', verifyJWT, async (req, res) => {
  const raw = req.query.project_id
  const projectId = (raw && raw !== 'null' && raw !== 'undefined') ? raw : req.user.project_id
  if (!projectId) return res.status(400).json({ error: 'Missing project_id' })
  const seeAll = SEE_ALL_ROLES.includes(req.user.role)

  try {
    let rows
    if (seeAll) {
      // Return all lists for the project with owner info
      const result = await db.query(
        `SELECT l.*, u.name AS user_name, u.role AS user_role
         FROM production_lists l
         JOIN users u ON u.id = l.user_id
         WHERE l.project_id = $1
         ORDER BY l.type, u.name`,
        [projectId]
      )
      rows = result.rows
    } else {
      // Return only own lists
      const result = await db.query(
        `SELECT * FROM production_lists
         WHERE project_id = $1 AND user_id = $2`,
        [projectId, req.user.id]
      )
      rows = result.rows
    }

    res.json({ lists: rows })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Server error' })
  }
})

// GET /lists/:type/items — get or auto-create list + items
router.get('/:type/items', verifyJWT, async (req, res) => {
  const { type } = req.params
  const raw = req.query.project_id
  const projectId = (raw && raw !== 'null' && raw !== 'undefined') ? raw : req.user.project_id
  if (!projectId) return res.status(400).json({ error: 'Missing project_id' })
  const rawUserId = req.query.user_id
  const targetUserId = (rawUserId && rawUserId !== 'null' && rawUserId !== 'undefined') ? rawUserId : undefined
  const seeAll = SEE_ALL_ROLES.includes(req.user.role)

  // Permission check
  const isFullAccess = ['producer', 'project_director'].includes(req.user.role)
  const ownTypes = isFullAccess ? ALL_CATEGORIES : getOwnTypes(req.user.role)
  if (!seeAll && !isFullAccess && !ownTypes.includes(type)) {
    return res.status(403).json({ error: 'Access denied' })
  }

  try {
    // If seeAll and no specific user_id — return deduplicated items for this project+type
    if (seeAll && !targetUserId) {
      const items = await db.query(
        `SELECT sub.*, u.name AS user_name
         FROM (
           SELECT DISTINCT ON (LOWER(TRIM(i.name)), COALESCE(i.scene, ''))
                  i.*
           FROM production_list_items i
           JOIN production_lists l ON l.id = i.list_id
           WHERE l.project_id=$1 AND l.type=$2
           ORDER BY LOWER(TRIM(i.name)), COALESCE(i.scene, ''),
                    LENGTH(COALESCE(i.note,'')) DESC,
                    i.created_at DESC
         ) sub
         LEFT JOIN production_lists l2 ON l2.id = sub.list_id
         LEFT JOIN users u ON u.id = l2.user_id`,
        [projectId, type]
      )
      return res.json({ list: null, items: items.rows })
    }

    // Find or create list for specific user
    const userId = targetUserId || req.user.id
    let { rows } = await db.query(
      `SELECT * FROM production_lists WHERE project_id=$1 AND user_id=$2 AND type=$3`,
      [projectId, userId, type]
    )

    let list
    if (rows.length) {
      list = rows[0]
    } else if (userId === String(req.user.id)) {
      // Auto-create own list
      const ins = await db.query(
        `INSERT INTO production_lists (project_id, user_id, type)
         VALUES ($1, $2, $3) RETURNING *`,
        [projectId, req.user.id, type]
      )
      list = ins.rows[0]
    } else {
      return res.json({ list: null, items: [] })
    }

    const items = await db.query(
      `SELECT * FROM production_list_items WHERE list_id=$1 ORDER BY sort_order, created_at`,
      [list.id]
    )

    res.json({ list, items: items.rows })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Server error' })
  }
})

// GET /lists/matched-units — get matched units from latest document for project
router.get('/matched-units', verifyJWT, async (req, res) => {
  const raw = req.query.project_id
  const projectId = (raw && raw !== 'null' && raw !== 'undefined') ? raw : req.user.project_id
  if (!projectId) return res.status(400).json({ error: 'Missing project_id' })
  try {
    const { rows } = await db.query(
      `SELECT matched_units FROM documents
       WHERE project_id=$1 AND matched_units IS NOT NULL
       ORDER BY version DESC LIMIT 1`,
      [projectId]
    )
    res.json({ matched_units: rows[0]?.matched_units || [] })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Server error' })
  }
})

// POST /lists/:type/items — add item
router.post('/:type/items', verifyJWT, async (req, res) => {
  const { type } = req.params
  const projectId = req.user.project_id
  const isFullAccess = ['producer', 'project_director'].includes(req.user.role)
  const ownTypes = isFullAccess ? ALL_CATEGORIES : getOwnTypes(req.user.role)

  if (!ownTypes.includes(type)) {
    return res.status(403).json({ error: 'Access denied' })
  }

  const { name, scene, day, time, location, qty, source, note } = req.body
  if (!name) return res.status(400).json({ error: 'Missing name' })

  try {
    // Ensure list exists
    await db.query(
      `INSERT INTO production_lists (project_id, user_id, type)
       VALUES ($1, $2, $3)
       ON CONFLICT (project_id, user_id, type) DO NOTHING`,
      [projectId, req.user.id, type]
    )

    const { rows: listRows } = await db.query(
      `SELECT id FROM production_lists WHERE project_id=$1 AND user_id=$2 AND type=$3`,
      [projectId, req.user.id, type]
    )
    const listId = listRows[0].id

    const { rows } = await db.query(
      `INSERT INTO production_list_items (list_id, name, scene, day, time, location, qty, source, note)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
      [listId, name, scene || null, day || null, time || null, location || null, qty || 1, source || 'manual', note || null]
    )

    res.json({ item: rows[0] })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Server error' })
  }
})

// PATCH /lists/items/:id — update note/qty/ai_status
router.patch('/items/:id', verifyJWT, async (req, res) => {
  const { note, qty, ai_status, name, scene, day, time, location, source } = req.body

  try {
    // Verify ownership
    const { rows: check } = await db.query(
      `SELECT i.id FROM production_list_items i
       JOIN production_lists l ON l.id = i.list_id
       WHERE i.id=$1 AND l.user_id=$2`,
      [req.params.id, req.user.id]
    )
    if (!check.length) return res.status(403).json({ error: 'Access denied' })

    const { rows } = await db.query(
      `UPDATE production_list_items
       SET note=$1, qty=COALESCE($2, qty), ai_status=COALESCE($3, ai_status),
           name=COALESCE($4, name), scene=COALESCE($5, scene),
           day=COALESCE($6, day), time=COALESCE($7, time),
           location=COALESCE($8, location), source=COALESCE($9, source)
       WHERE id=$10 RETURNING *`,
      [note ?? null, qty || null, ai_status || null, name || null, scene || null,
       day || null, time || null, location || null, source || null, req.params.id]
    )
    res.json({ item: rows[0] })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Server error' })
  }
})

// DELETE /lists/items/:id
router.delete('/items/:id', verifyJWT, async (req, res) => {
  try {
    const { rows: check } = await db.query(
      `SELECT i.id FROM production_list_items i
       JOIN production_lists l ON l.id = i.list_id
       WHERE i.id=$1 AND l.user_id=$2`,
      [req.params.id, req.user.id]
    )
    if (!check.length) return res.status(403).json({ error: 'Access denied' })

    await db.query(`DELETE FROM production_list_items WHERE id=$1`, [req.params.id])
    res.json({ ok: true })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Server error' })
  }
})

// PATCH /lists/items/:id/assign-scene — assign a scene to an item (fixes "Без даты")
router.patch('/items/:id/assign-scene', verifyJWT, async (req, res) => {
  const { canonical_id } = req.body
  if (!canonical_id) return res.status(400).json({ error: 'Missing canonical_id' })
  try {
    // Find item's project
    const { rows: itemInfo } = await db.query(
      `SELECT pl.project_id FROM production_list_items pli
       JOIN production_lists pl ON pl.id = pli.list_id
       WHERE pli.id = $1`, [req.params.id]
    )
    if (!itemInfo.length) return res.status(404).json({ error: 'Item not found' })

    // Look up scene data
    const { rows: sceneRows } = await db.query(
      `SELECT date, day_number, time_slot, scenario_text FROM scenes
       WHERE project_id = $1 AND canonical_id = $2`,
      [itemInfo[0].project_id, canonical_id]
    )
    const scene = sceneRows[0]
    const dayLabel = scene?.day_number ? `СД ${scene.day_number}` : null
    const slotTime = scene?.time_slot || ''
    const time = dayLabel && slotTime ? `${dayLabel} · ${slotTime}` : dayLabel

    // Update item with scene + date/time + scenario text
    let noteUpdate = ''
    if (scene?.scenario_text) {
      const { rows: item } = await db.query(`SELECT note FROM production_list_items WHERE id = $1`, [req.params.id])
      const existingNote = (item[0]?.note || '').trim()
      if (!existingNote.includes('📝 ')) {
        const separator = existingNote ? '\n---\n' : ''
        noteUpdate = existingNote + separator + '📝 ' + scene.scenario_text
      }
    }

    if (noteUpdate) {
      await db.query(
        `UPDATE production_list_items SET scene = $1, day = $2, time = $3, note = $4 WHERE id = $5`,
        [canonical_id, scene?.date || null, time, noteUpdate, req.params.id]
      )
    } else {
      await db.query(
        `UPDATE production_list_items SET scene = $1, day = $2, time = $3 WHERE id = $4`,
        [canonical_id, scene?.date || null, time, req.params.id]
      )
    }

    res.json({ ok: true })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Server error' })
  }
})

module.exports = router
