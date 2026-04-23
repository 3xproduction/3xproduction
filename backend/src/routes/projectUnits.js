// Project-kept units: items owned by a specific project, never physically placed
// on a warehouse shelf/hanger/place. They exist only in the project inventory.
// Other projects cannot see them by default; the public catalog never lists them.

const router = require('express').Router()
const multer = require('multer')
const db = require('../db')
const { verifyJWT } = require('../middleware/auth')
const { uploadFile } = require('../services/r2')
const { createNotification } = require('../services/notifications')

// Роли, которые могут ИНИЦИИРОВАТЬ и ПОДТВЕРЖДАТЬ возврат с любого склада проекта.
// По требованию заказчика: warehouse_director, warehouse_deputy, warehouse_staff, producer.
const RETURN_REQUESTER_ROLES = new Set([
  'warehouse_director', 'warehouse_deputy', 'warehouse_staff', 'producer',
])
// Роли проекта, которым идёт уведомление о необходимости вернуть единицу.
// Набор повторяет логику responderRolesForCategory из colleagues.js.
const PROPS_RESPONDER_ROLES = [
  'project_director', 'production_designer', 'art_director_assistant',
  'props_master', 'props_assistant',
]
const COSTUMES_RESPONDER_ROLES = [
  'project_director', 'production_designer', 'costumer', 'costume_assistant',
]
const COSTUME_CATEGORIES = new Set(['costumes', 'shoes', 'jewelry', 'accessories', 'clothing'])
function responderRoles(category) {
  return COSTUME_CATEGORIES.has(category) ? COSTUMES_RESPONDER_ROLES : PROPS_RESPONDER_ROLES
}

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 100 * 1024 * 1024 },
})

// Roles allowed to add items to their project warehouse.
const PROJECT_WRITER_ROLES = new Set([
  'producer', 'project_director', 'director',
  'production_designer', 'art_director_assistant',
  'first_assistant_director', 'assistant_director',
  'props_master', 'props_assistant',
  'costumer', 'costume_assistant',
  'decorator', 'makeup_artist',
])

const WAREHOUSE_DIRECTOR_ROLES = new Set(['warehouse_director', 'warehouse_deputy'])
// Роли, которые могут забрать единицу с любого склада проекта на общий склад
// независимо от своей project_id (директорский уровень контроля над складом).
const CROSS_PROJECT_TRANSFER_ROLES = new Set([
  'warehouse_director', 'warehouse_deputy', 'producer',
])

function canWriteToProject(user) {
  return PROJECT_WRITER_ROLES.has(user.role)
}

// GET /project-units?project_id=&category=
// Lists units kept by a project. If project_id omitted, uses req.user.project_id.
// Warehouse directors can view any project.
router.get('/', verifyJWT, async (req, res) => {
  try {
    const requestedProject = req.query.project_id
    const isDirector = WAREHOUSE_DIRECTOR_ROLES.has(req.user.role)
    const projectId = requestedProject || req.user.project_id
    if (!projectId) return res.json({ units: [] })
    if (!isDirector && String(projectId) !== String(req.user.project_id)) {
      return res.status(403).json({ error: 'Forbidden' })
    }

    const params = [projectId]
    let q = `
      SELECT u.*, p.name AS project_name,
             uc.name AS created_by_name,
             (SELECT url FROM unit_photos WHERE unit_id = u.id
              ORDER BY CASE WHEN url ~* '\\.(mp4|webm|mov)$' THEN 1 ELSE 0 END, created_at LIMIT 1) AS photo_url
      FROM units u
      LEFT JOIN projects p ON p.id = u.project_id
      LEFT JOIN users uc ON uc.id = u.created_by
      WHERE u.is_project_kept = true AND u.project_id = $1
        AND u.status != 'written_off'
    `
    if (req.query.category) {
      params.push(req.query.category)
      q += ` AND u.category = $${params.length}`
    }
    if (req.query.created_by_me === '1') {
      params.push(req.user.id)
      q += ` AND u.created_by = $${params.length}`
    }
    q += ` ORDER BY u.created_at DESC`
    const { rows } = await db.query(q, params)
    const units = rows.map(({ search_vector, search_tags, ...rest }) => rest)
    res.json({ units })
  } catch (err) {
    console.error('project-units list:', err)
    res.json({ units: [] })
  }
})

// POST /project-units — create a project-kept unit (no approval).
router.post('/', verifyJWT, async (req, res) => {
  if (!canWriteToProject(req.user)) return res.status(403).json({ error: 'Forbidden' })
  if (!req.user.project_id) return res.status(400).json({ error: 'User has no project' })

  const { name, category, description, qty, condition, period,
          purchased, purchase_price, purchase_date, vendor, receipt_url,
          valuation, serial } = req.body

  if (!name || !category) return res.status(400).json({ error: 'Name and category required' })
  if (purchased && (!receipt_url || !purchase_price)) {
    return res.status(400).json({ error: 'For purchased items receipt and price are required' })
  }

  try {
    // Project-kept units use status='on_stock' conceptually (owned and in-use)
    // but carry is_project_kept=true and no cell/warehouse.
    const { rows } = await db.query(
      `INSERT INTO units
         (name, category, serial, description, qty, condition, period,
          valuation, status, is_project_kept, project_id, created_by,
          purchased, purchase_price, purchase_date, vendor, receipt_url)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'on_stock',true,$9,$10,$11,$12,$13,$14,$15) RETURNING *`,
      [
        name, category, serial || null, description || null,
        qty || 1, condition || null, period || null,
        purchased ? (purchase_price || valuation || null) : (valuation || null),
        req.user.project_id, req.user.id,
        Boolean(purchased),
        purchase_price || null,
        purchase_date || null,
        vendor || null,
        receipt_url || null,
      ]
    )
    await db.query(
      `INSERT INTO unit_history (unit_id, action, user_id) VALUES ($1,'Создано на складе проекта',$2)`,
      [rows[0].id, req.user.id]
    )
    res.json({ unit: rows[0] })
  } catch (err) {
    console.error('project-unit create:', err)
    res.status(500).json({ error: 'Server error' })
  }
})

// POST /project-units/upload-receipt — upload receipt image, returns URL.
router.post('/upload-receipt', verifyJWT, upload.single('receipt'), async (req, res) => {
  if (!canWriteToProject(req.user)) return res.status(403).json({ error: 'Forbidden' })
  if (!req.file) return res.status(400).json({ error: 'No file' })
  try {
    const url = await uploadFile(req.file.buffer, req.file.originalname, 'receipts')
    res.json({ url })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Upload failed' })
  }
})

// PUT /project-units/:id — edit a project-kept unit.
router.put('/:id', verifyJWT, async (req, res) => {
  if (!canWriteToProject(req.user) && !WAREHOUSE_DIRECTOR_ROLES.has(req.user.role)) {
    return res.status(403).json({ error: 'Forbidden' })
  }
  try {
    const { rows: existing } = await db.query(
      `SELECT * FROM units WHERE id = $1 AND is_project_kept = true`, [req.params.id]
    )
    if (!existing.length) return res.status(404).json({ error: 'Not found' })
    if (!WAREHOUSE_DIRECTOR_ROLES.has(req.user.role)
        && String(existing[0].project_id) !== String(req.user.project_id)) {
      return res.status(403).json({ error: 'Forbidden' })
    }
    const { name, category, serial, description, qty, condition, period,
            valuation, purchased, purchase_price, purchase_date, vendor, receipt_url } = req.body
    const { rows } = await db.query(
      `UPDATE units SET name=$1, category=$2, serial=$3, description=$4, qty=$5,
        condition=$6, period=$7, valuation=$8, purchased=$9,
        purchase_price=$10, purchase_date=$11, vendor=$12, receipt_url=$13
       WHERE id=$14 RETURNING *`,
      [name, category, serial || null, description || null, qty || 1,
       condition || null, period || null, valuation || null,
       Boolean(purchased), purchase_price || null, purchase_date || null,
       vendor || null, receipt_url || null, req.params.id]
    )
    res.json({ unit: rows[0] })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Server error' })
  }
})

// DELETE /project-units/:id — soft delete = write-off.
router.delete('/:id', verifyJWT, async (req, res) => {
  if (!canWriteToProject(req.user)) return res.status(403).json({ error: 'Forbidden' })
  try {
    const { rows } = await db.query(
      `SELECT * FROM units WHERE id = $1 AND is_project_kept = true`, [req.params.id]
    )
    if (!rows.length) return res.status(404).json({ error: 'Not found' })
    if (String(rows[0].project_id) !== String(req.user.project_id)) {
      return res.status(403).json({ error: 'Forbidden' })
    }
    await db.query(`UPDATE units SET status='written_off' WHERE id=$1`, [req.params.id])
    await db.query(
      `INSERT INTO unit_history (unit_id, action, user_id, notes) VALUES ($1,'Списано со склада проекта',$2,$3)`,
      [req.params.id, req.user.id, req.body?.reason || null]
    )
    res.json({ ok: true })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Server error' })
  }
})

// POST /project-units/:id/transfer-to-warehouse — immediate transfer (approvals removed).
// Единица сразу уходит из склада проекта в общий склад без pending-этапа. Если
// указаны warehouse_id и cell_id — сразу раскладывается на полку; иначе лежит
// без места и директор/зам склада расставляют вручную из UnitsPage.
router.post('/:id/transfer-to-warehouse', verifyJWT, async (req, res) => {
  if (!canWriteToProject(req.user) && !CROSS_PROJECT_TRANSFER_ROLES.has(req.user.role)) {
    return res.status(403).json({ error: 'Forbidden' })
  }
  try {
    const { rows } = await db.query(
      `SELECT * FROM units WHERE id = $1 AND is_project_kept = true`, [req.params.id]
    )
    if (!rows.length) return res.status(404).json({ error: 'Not found' })
    if (!CROSS_PROJECT_TRANSFER_ROLES.has(req.user.role)
        && String(rows[0].project_id) !== String(req.user.project_id)) {
      return res.status(403).json({ error: 'Forbidden' })
    }
    const { warehouse_id, cell_id } = req.body || {}
    const comment = (req.body?.comment || '').toString().slice(0, 500)

    // Валидация категории/типа секции отключена — места безлимитные.
    if (cell_id) {
      const { rows: secRows } = await db.query(
        `SELECT c.id FROM cells c WHERE c.id = $1`,
        [cell_id]
      )
      if (!secRows.length) return res.status(400).json({ error: 'Ячейка не найдена' })
    }

    await db.query(
      `UPDATE units
         SET is_project_kept=false, project_id=NULL, pending_transfer=false,
             warehouse_id=COALESCE($2, warehouse_id),
             cell_id=COALESCE($3, cell_id)
       WHERE id=$1`,
      [req.params.id, warehouse_id || null, cell_id || null]
    )
    await db.query(
      `INSERT INTO unit_history (unit_id, action, user_id, notes)
       VALUES ($1,'Передано на общий склад',$2,$3)`,
      [req.params.id, req.user.id, comment || null]
    )
    res.json({ ok: true })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Server error' })
  }
})

// POST /project-units/:id/return-to-project — director/deputy sends a warehouse unit
// back into a project inventory (used when the project temporarily wants it on hand).
router.post('/:id/return-to-project', verifyJWT, async (req, res) => {
  if (!WAREHOUSE_DIRECTOR_ROLES.has(req.user.role)) return res.status(403).json({ error: 'Forbidden' })
  const { project_id } = req.body || {}
  if (!project_id) return res.status(400).json({ error: 'project_id required' })
  try {
    const { rows } = await db.query(`SELECT * FROM units WHERE id = $1`, [req.params.id])
    if (!rows.length) return res.status(404).json({ error: 'Not found' })
    await db.query(
      `UPDATE units SET is_project_kept=true, project_id=$2,
                         warehouse_id=NULL, cell_id=NULL, pavilion_id=NULL
       WHERE id=$1`,
      [req.params.id, project_id]
    )
    await db.query(
      `INSERT INTO unit_history (unit_id, action, user_id) VALUES ($1,'Возвращено на склад проекта',$2)`,
      [req.params.id, req.user.id]
    )
    res.json({ ok: true })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Server error' })
  }
})

// GET /project-units/pending-transfers — list units awaiting director acceptance.
// Only warehouse directors / deputies see this.
router.get('/pending-transfers', verifyJWT, async (req, res) => {
  if (!WAREHOUSE_DIRECTOR_ROLES.has(req.user.role)) return res.status(403).json({ error: 'Forbidden' })
  try {
    const { rows } = await db.query(
      `SELECT u.*, p.name AS project_name, uc.name AS created_by_name,
              (SELECT url FROM unit_photos WHERE unit_id = u.id
               ORDER BY CASE WHEN url ~* '\\.(mp4|webm|mov)$' THEN 1 ELSE 0 END, created_at LIMIT 1) AS photo_url
       FROM units u
       LEFT JOIN projects p ON p.id = u.project_id
       LEFT JOIN users uc ON uc.id = u.created_by
       WHERE u.pending_transfer = true AND u.is_project_kept = true
       ORDER BY u.created_at DESC`
    )
    res.json({ units: rows.map(({ search_vector, search_tags, ...r }) => r) })
  } catch (err) {
    console.error(err)
    res.json({ units: [] })
  }
})

// ──────────────────────────────────────────────────────────────────────────
// Двухэтапный запрос возврата единицы со склада проекта на общий склад.
// ──────────────────────────────────────────────────────────────────────────

// POST /project-units/:id/request-return — директор склада/зам/сотрудник склада/
// продюсер инициирует возврат. Создаётся запрос с дедлайном +3 дня и уведомление
// ответственным из проекта-владельца.
router.post('/:id/request-return', verifyJWT, async (req, res) => {
  if (!RETURN_REQUESTER_ROLES.has(req.user.role)) {
    return res.status(403).json({ error: 'Forbidden' })
  }
  try {
    const { rows } = await db.query(
      `SELECT * FROM units WHERE id = $1 AND is_project_kept = true AND status = 'on_stock'`,
      [req.params.id]
    )
    if (!rows.length) return res.status(404).json({ error: 'Единица не найдена или не на проекте' })
    const unit = rows[0]

    // Проверка уже существующего pending-запроса, чтобы не плодить дубли.
    const { rows: dup } = await db.query(
      `SELECT id FROM warehouse_return_requests WHERE unit_id = $1 AND status = 'pending'`,
      [req.params.id]
    )
    if (dup.length) return res.status(400).json({ error: 'Запрос возврата уже отправлен' })

    const comment = (req.body?.comment || '').toString().slice(0, 500) || null
    const { rows: created } = await db.query(
      `INSERT INTO warehouse_return_requests
         (unit_id, from_project_id, requested_by, deadline, comment)
       VALUES ($1, $2, $3, (CURRENT_DATE + INTERVAL '3 days')::date, $4)
       RETURNING *`,
      [unit.id, unit.project_id, req.user.id, comment]
    )
    const reqRow = created[0]

    // Уведомление ответственным по категории + директору проекта.
    const roles = responderRoles(unit.category)
    const { rows: targets } = await db.query(
      `SELECT id FROM users WHERE project_id = $1 AND role = ANY($2)`,
      [unit.project_id, roles]
    )
    const dl = reqRow.deadline ? new Date(reqRow.deadline).toLocaleDateString('ru-RU') : ''
    const text = `Нужно вернуть «${unit.name}» на основной склад до ${dl}`
    for (const t of targets) {
      await createNotification({
        user_id: t.id,
        type: 'warehouse_return_request',
        text,
        entity_id: reqRow.id,
        entity_type: 'warehouse_return_request',
      }).catch(() => {})
    }

    await db.query(
      `INSERT INTO unit_history (unit_id, action, user_id, notes)
       VALUES ($1,'Запрос возврата на основной склад',$2,$3)`,
      [unit.id, req.user.id, comment]
    )

    res.status(201).json({ request: reqRow })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Server error' })
  }
})

// GET /project-units/return-requests?direction=incoming|outgoing
// - outgoing (по умолчанию для warehouse/producer) — запросы, где я их инициировал
//   или я из роли warehouse/producer (вижу все pending).
// - incoming — для сотрудников проекта, где их проект является проектом-владельцем.
router.get('/return-requests', verifyJWT, async (req, res) => {
  const direction = req.query.direction || 'outgoing'
  try {
    let where, params
    if (direction === 'incoming') {
      if (!req.user.project_id) return res.json({ requests: [] })
      where = `r.from_project_id = $1`
      params = [req.user.project_id]
    } else {
      // outgoing: для warehouse-ролей и продюсера показываем все pending; для остальных — только свои.
      if (RETURN_REQUESTER_ROLES.has(req.user.role)) {
        where = `1=1`
        params = []
      } else {
        where = `r.requested_by = $1`
        params = [req.user.id]
      }
    }
    const statusFilter = req.query.status
    if (statusFilter) {
      params.push(statusFilter)
      where += ` AND r.status = $${params.length}`
    }

    const { rows } = await db.query(
      `SELECT r.*,
              u.name AS unit_name, u.category AS unit_category,
              (SELECT url FROM unit_photos WHERE unit_id = u.id
               ORDER BY CASE WHEN url ~* '\\.(mp4|webm|mov)$' THEN 1 ELSE 0 END, created_at LIMIT 1) AS unit_photo,
              p.name AS from_project_name,
              ru.name AS requested_by_name, ru.role AS requested_by_role,
              cb.name AS confirmed_by_name
       FROM warehouse_return_requests r
       JOIN units u    ON u.id = r.unit_id
       JOIN projects p ON p.id = r.from_project_id
       JOIN users ru   ON ru.id = r.requested_by
       LEFT JOIN users cb ON cb.id = r.confirmed_by
       WHERE ${where}
       ORDER BY r.created_at DESC`,
      params
    )
    res.json({ requests: rows })
  } catch (err) {
    console.error(err)
    res.json({ requests: [] })
  }
})

// POST /project-units/return-requests/:id/confirm — warehouse/producer подтверждает
// фактический возврат: единица переходит на общий склад, запрос закрывается.
router.post('/return-requests/:id/confirm', verifyJWT, async (req, res) => {
  if (!RETURN_REQUESTER_ROLES.has(req.user.role)) {
    return res.status(403).json({ error: 'Forbidden' })
  }
  try {
    const { rows } = await db.query(
      `SELECT * FROM warehouse_return_requests WHERE id = $1 AND status = 'pending'`,
      [req.params.id]
    )
    if (!rows.length) return res.status(404).json({ error: 'Запрос не найден' })
    const r = rows[0]

    await db.query(
      `UPDATE units
         SET is_project_kept = false,
             project_id = NULL,
             on_loan_to_project_id = NULL,
             pending_transfer = false
       WHERE id = $1`,
      [r.unit_id]
    )
    await db.query(
      `UPDATE warehouse_return_requests
         SET status='confirmed', confirmed_by=$2, confirmed_at=NOW()
       WHERE id=$1`,
      [r.id, req.user.id]
    )
    await db.query(
      `INSERT INTO unit_history (unit_id, action, user_id)
       VALUES ($1,'Возврат на основной склад подтверждён',$2)`,
      [r.unit_id, req.user.id]
    )
    // Уведомление инициатору и ответственным, что возврат закрыт.
    await createNotification({
      user_id: r.requested_by,
      type: 'warehouse_return_confirmed',
      text: 'Возврат единицы на основной склад подтверждён',
      entity_id: r.id,
      entity_type: 'warehouse_return_request',
    }).catch(() => {})
    res.json({ ok: true })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Server error' })
  }
})

// POST /project-units/return-requests/:id/cancel — инициатор (или warehouse) отменяет.
router.post('/return-requests/:id/cancel', verifyJWT, async (req, res) => {
  try {
    const { rows } = await db.query(
      `SELECT * FROM warehouse_return_requests WHERE id = $1 AND status = 'pending'`,
      [req.params.id]
    )
    if (!rows.length) return res.status(404).json({ error: 'Запрос не найден' })
    const r = rows[0]
    const isAuthor = String(r.requested_by) === String(req.user.id)
    const isWarehouse = RETURN_REQUESTER_ROLES.has(req.user.role)
    if (!isAuthor && !isWarehouse) return res.status(403).json({ error: 'Forbidden' })

    await db.query(
      `UPDATE warehouse_return_requests SET status='cancelled' WHERE id=$1`,
      [r.id]
    )
    res.json({ ok: true })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Server error' })
  }
})

// POST /project-units/:id/accept-transfer  — director accepts the transfer.
// Body: { warehouse_id, cell_id }  (cell validated against matrix on the units route separately).
router.post('/:id/accept-transfer', verifyJWT, async (req, res) => {
  if (!WAREHOUSE_DIRECTOR_ROLES.has(req.user.role)) return res.status(403).json({ error: 'Forbidden' })
  const { warehouse_id, cell_id } = req.body
  if (!warehouse_id || !cell_id) return res.status(400).json({ error: 'warehouse_id and cell_id required' })
  try {
    const { rows } = await db.query(
      `SELECT * FROM units WHERE id = $1 AND pending_transfer = true`, [req.params.id]
    )
    if (!rows.length) return res.status(404).json({ error: 'Not found' })

    // Валидация существования ячейки. Матрица «категория ↔ тип секции»
    // отключена — места безлимитные, любая единица кладётся в любую ячейку.
    const { rows: secRows } = await db.query(
      `SELECT c.id FROM cells c WHERE c.id = $1`,
      [cell_id]
    )
    if (!secRows.length) return res.status(400).json({ error: 'Ячейка не найдена' })

    // Accept: unit becomes regular warehouse unit, bound to cell, project badge removed.
    await db.query(
      `UPDATE units
         SET status='on_stock', is_project_kept=false, project_id=NULL, pending_transfer=false,
             warehouse_id=$2, cell_id=$3
       WHERE id=$1`,
      [req.params.id, warehouse_id, cell_id]
    )
    await db.query(
      `INSERT INTO unit_history (unit_id, action, user_id)
       VALUES ($1,'Принято на общий склад из проекта',$2)`,
      [req.params.id, req.user.id]
    )
    res.json({ ok: true })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Server error' })
  }
})

// POST /project-units/:id/reject-transfer — director returns the unit back to the project.
router.post('/:id/reject-transfer', verifyJWT, async (req, res) => {
  if (!WAREHOUSE_DIRECTOR_ROLES.has(req.user.role)) return res.status(403).json({ error: 'Forbidden' })
  try {
    const { rows } = await db.query(
      `SELECT * FROM units WHERE id = $1 AND pending_transfer = true`, [req.params.id]
    )
    if (!rows.length) return res.status(404).json({ error: 'Not found' })
    await db.query(`UPDATE units SET pending_transfer=false WHERE id=$1`, [req.params.id])
    await db.query(
      `INSERT INTO unit_history (unit_id, action, user_id, notes)
       VALUES ($1,'Отклонено при передаче на общий склад',$2,$3)`,
      [req.params.id, req.user.id, (req.body?.reason || '').toString().slice(0, 500) || null]
    )
    res.json({ ok: true })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Server error' })
  }
})

module.exports = router
