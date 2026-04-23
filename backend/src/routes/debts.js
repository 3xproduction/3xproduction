const router = require('express').Router()
const db     = require('../db')
const { verifyJWT, checkRole } = require('../middleware/auth')

const WAREHOUSE_ROLES = ['warehouse_director', 'warehouse_deputy', 'warehouse_staff']
// GET /debts — видят все авторизованные пользователи.
// Warehouse-роли + producer — все долги. Площадные роли — только долги своего проекта
// (чтобы сотрудники одного проекта видели долги коллег, но не чужих).
router.get('/', verifyJWT, async (req, res) => {
  const { status } = req.query
  try {
    let q = `
      SELECT d.*, u.name AS user_name, un.name AS unit_name,
             p.name AS project_name
      FROM debts d
      JOIN users u ON u.id = d.user_id
      JOIN units un ON un.id = d.unit_id
      LEFT JOIN projects p ON p.id = d.project_id
      WHERE 1=1
    `
    const params = []
    const fullAccess = [...WAREHOUSE_ROLES, 'producer'].includes(req.user.role)
    if (!fullAccess) {
      // Площадная роль — видит долги своего проекта: либо d.project_id совпадает,
      // либо должник (d.user_id) работает в этом проекте.
      const projectId = req.user.project_id && req.user.project_id !== ''
        ? req.user.project_id : null
      if (!projectId) return res.json({ debts: [] })
      params.push(projectId)
      q += ` AND (d.project_id = $${params.length} OR u.project_id = $${params.length})`
    }
    if (status) { params.push(status); q += ` AND d.status = $${params.length}` }
    q += ` ORDER BY d.created_at DESC`

    const { rows } = await db.query(q, params)
    res.json({ debts: rows })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Server error' })
  }
})

// POST /debts — create debt (when item not returned)
router.post('/', verifyJWT, checkRole(...WAREHOUSE_ROLES), async (req, res) => {
  const { user_id, unit_id, issuance_id, project_id, reason } = req.body
  if (!user_id || !unit_id) return res.status(400).json({ error: 'Missing user_id or unit_id' })

  try {
    const { rows } = await db.query(
      `INSERT INTO debts (user_id, unit_id, issuance_id, project_id, reason)
       VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [user_id, unit_id, issuance_id || null, project_id || null, reason || null]
    )
    // Update unit status
    await db.query(`UPDATE units SET status='debt' WHERE id=$1`, [unit_id])
    await db.query(
      `INSERT INTO unit_history (unit_id, action, user_id, notes) VALUES ($1,'Долг',$2,$3)`,
      [unit_id, req.user.id, reason || 'Не возвращено']
    )
    res.status(201).json({ debt: rows[0] })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Server error' })
  }
})

// POST /debts/:id/close — close debt
router.post('/:id/close', verifyJWT, checkRole('warehouse_director', 'warehouse_deputy', 'producer'), async (req, res) => {
  try {
    const { rows } = await db.query(
      `UPDATE debts SET status='closed', closed_at=NOW(), closed_by=$1
       WHERE id=$2 AND status='open' RETURNING *`,
      [req.user.id, req.params.id]
    )
    if (!rows.length) return res.status(404).json({ error: 'Debt not found or already closed' })

    // Return unit to stock
    await db.query(`UPDATE units SET status='on_stock' WHERE id=$1`, [rows[0].unit_id])
    await db.query(
      `INSERT INTO unit_history (unit_id, action, user_id) VALUES ($1,'Долг закрыт',$2)`,
      [rows[0].unit_id, req.user.id]
    )
    res.json({ debt: rows[0] })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Server error' })
  }
})

// POST /debts/:id/writeoff — списать единицу из долга
// Долг закрывается, единица уходит в списания (writeoffs.kind=writeoff),
// статус единицы → written_off.
router.post('/:id/writeoff', verifyJWT, checkRole('warehouse_director', 'warehouse_deputy', 'producer'), async (req, res) => {
  const { reason } = req.body
  try {
    const { rows: debtRows } = await db.query(
      `SELECT * FROM debts WHERE id=$1 AND status='open'`,
      [req.params.id]
    )
    if (!debtRows.length) return res.status(404).json({ error: 'Debt not found or already closed' })
    const debt = debtRows[0]

    const writeoffReason = (reason || debt.reason || 'Списано из долга').slice(0, 500)
    await db.query(
      `INSERT INTO writeoffs (unit_id, source, source_ref, project_id, reason, kind, created_by)
       VALUES ($1, 'direct', $2, $3, $4, 'writeoff', $5)`,
      [debt.unit_id, debt.id, debt.project_id || null, writeoffReason, req.user.id]
    )
    await db.query(
      `UPDATE debts SET status='closed', closed_at=NOW(), closed_by=$1 WHERE id=$2`,
      [req.user.id, debt.id]
    )
    await db.query(`UPDATE units SET status='written_off' WHERE id=$1`, [debt.unit_id])
    await db.query(
      `INSERT INTO unit_history (unit_id, action, user_id, notes) VALUES ($1,'Списано (из долга)',$2,$3)`,
      [debt.unit_id, req.user.id, writeoffReason]
    )

    res.json({ ok: true })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Server error' })
  }
})

// GET /debts/stats — debt stats for analytics
router.get('/stats', verifyJWT, checkRole('warehouse_director', 'warehouse_deputy'), async (req, res) => {
  try {
    const { rows } = await db.query(`
      SELECT
        COUNT(*) FILTER (WHERE status = 'open') AS open_count,
        COUNT(*) FILTER (WHERE status = 'closed') AS closed_count,
        COUNT(*) AS total
      FROM debts
    `)
    const { rows: byUser } = await db.query(`
      SELECT u.name, COUNT(*) AS debt_count
      FROM debts d JOIN users u ON u.id = d.user_id
      WHERE d.status = 'open'
      GROUP BY u.name ORDER BY debt_count DESC LIMIT 10
    `)
    res.json({ totals: rows[0], by_user: byUser })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Server error' })
  }
})

module.exports = router
