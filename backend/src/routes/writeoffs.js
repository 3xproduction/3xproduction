// Списания — журнал вещей, помеченных как списанные или переведённые в долг
// при возврате (с заявки, аренды, публичной ссылки, склада проекта).

const router = require('express').Router()
const db = require('../db')
const { verifyJWT } = require('../middleware/auth')

// GET /writeoffs — список записей.
// Warehouse + producer видят всё; площадные роли — только свой проект.
router.get('/', verifyJWT, async (req, res) => {
  try {
    const WAREHOUSE = ['warehouse_director', 'warehouse_deputy', 'warehouse_staff']
    const fullAccess = [...WAREHOUSE, 'producer'].includes(req.user.role)
    let q = `
      SELECT w.*,
             u.name AS unit_name, u.category AS unit_category,
             p.name AS project_name,
             usr.name AS created_by_name
      FROM writeoffs w
      JOIN units u        ON u.id = w.unit_id
      LEFT JOIN projects p ON p.id = w.project_id
      LEFT JOIN users usr ON usr.id = w.created_by
    `
    const params = []
    if (!fullAccess) {
      const projectId = req.user.project_id && req.user.project_id !== ''
        ? req.user.project_id : null
      if (!projectId) return res.json({ writeoffs: [] })
      params.push(projectId)
      // Списание видно в проекте, если w.project_id совпадает либо создатель — из того же проекта.
      q += ` WHERE (w.project_id = $${params.length} OR usr.project_id = $${params.length})`
    }
    q += ` ORDER BY w.created_at DESC`
    const { rows } = await db.query(q, params)
    res.json({ writeoffs: rows })
  } catch (err) {
    console.error(err)
    res.json({ writeoffs: [] })
  }
})

// POST /writeoffs/:id/convert-to-writeoff — конвертировать legacy-запись долга
// (kind=debt) в реальное списание: kind=writeoff, unit.status=written_off.
router.post('/:id/convert-to-writeoff', verifyJWT, async (req, res) => {
  const canWrite = ['warehouse_director', 'warehouse_deputy', 'producer'].includes(req.user.role)
  if (!canWrite) return res.status(403).json({ error: 'Forbidden' })

  try {
    const { rows } = await db.query(
      `UPDATE writeoffs SET kind='writeoff' WHERE id=$1 AND kind='debt' RETURNING *`,
      [req.params.id]
    )
    if (!rows.length) return res.status(404).json({ error: 'Writeoff-debt not found' })
    await db.query(`UPDATE units SET status='written_off' WHERE id=$1`, [rows[0].unit_id])
    await db.query(
      `INSERT INTO unit_history (unit_id, action, user_id, notes) VALUES ($1,'Списано (из долга)',$2,$3)`,
      [rows[0].unit_id, req.user.id, rows[0].reason || null]
    )
    res.json({ writeoff: rows[0] })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Server error' })
  }
})

// POST /writeoffs — пометить единицу как списанную/долг.
// body: { unit_id, source, source_ref?, project_id?, reason?, kind? }
router.post('/', verifyJWT, async (req, res) => {
  const { unit_id, source, source_ref, project_id, reason, kind } = req.body
  if (!unit_id || !source) return res.status(400).json({ error: 'unit_id and source required' })
  const canWrite = ['warehouse_director', 'warehouse_deputy', 'warehouse_staff', 'producer']
    .includes(req.user.role)
  if (!canWrite) return res.status(403).json({ error: 'Forbidden' })

  try {
    const { rows } = await db.query(
      `INSERT INTO writeoffs (unit_id, source, source_ref, project_id, reason, kind, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [unit_id, source, source_ref || null, project_id || null,
       (reason || '').slice(0, 500) || null, kind || 'writeoff', req.user.id]
    )
    // Сразу помечаем саму единицу как списанную.
    await db.query(`UPDATE units SET status='written_off' WHERE id=$1`, [unit_id])
    await db.query(
      `INSERT INTO unit_history (unit_id, action, user_id, notes)
       VALUES ($1, $2, $3, $4)`,
      [unit_id, kind === 'debt' ? 'Перевод в долг' : 'Списано',
       req.user.id, (reason || '').slice(0, 500) || null]
    )
    res.status(201).json({ writeoff: rows[0] })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Server error' })
  }
})

module.exports = router
