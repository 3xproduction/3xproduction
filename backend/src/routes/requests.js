const router = require('express').Router()
const multer = require('multer')
const db     = require('../db')
const { verifyJWT, checkRole } = require('../middleware/auth')
const { uploadFile } = require('../services/r2')
const { createNotification, notifyWarehouse } = require('../services/notifications')

const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp']
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    cb(null, ALLOWED_IMAGE_TYPES.includes(file.mimetype))
  },
})

// Статусы заявки, у которых ещё можно менять состав. После issued/cancelled —
// уже поздно: либо по выдаче расписался получатель, либо заявка закрыта.
const EDITABLE_REQUEST_STATUSES = new Set(['new', 'collecting', 'ready'])
const WAREHOUSE_EDIT_ROLES = new Set([
  'warehouse_director', 'warehouse_deputy', 'warehouse_staff',
])

// POST /requests
router.post('/', verifyJWT, async (req, res) => {
  const { unit_ids, warehouse_id, deadline, project_id, notes } = req.body
  if (!unit_ids) return res.status(400).json({ error: 'unit_ids required' })

  try {
    const { rows } = await db.query(
      `INSERT INTO requests (unit_ids, requester_id, warehouse_id, deadline, project_id, notes)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [unit_ids, req.user.id, warehouse_id || null, deadline || null, project_id || null, notes || null]
    )
    const request = rows[0]

    // Get unit names + requester info for notification
    const { rows: units } = await db.query(
      `SELECT name FROM units WHERE id = ANY($1)`, [unit_ids]
    )
    const names = units.map(u => u.name).join(', ')
    const { rows: reqUser } = await db.query(
      `SELECT u.name, p.name AS project_name FROM users u LEFT JOIN projects p ON p.id = u.project_id WHERE u.id = $1`, [req.user.id]
    )
    const from = reqUser[0] ? [reqUser[0].project_name, reqUser[0].name].filter(Boolean).join(' · ') : ''

    await notifyWarehouse({
      type: 'new_request',
      text: `Новый запрос${from ? ` от ${from}` : ''}: ${names}`,
      entity_id: request.id,
      entity_type: 'request',
    })

    res.status(201).json({ request })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Server error' })
  }
})

// POST /requests/:id/items — пересинхронизация состава активной заявки.
//
// Принимает multipart:
//   • existing_unit_ids   JSON-массив UUID — финальный список существующих единиц
//   • new_units           JSON-массив [{ temp_id, name, category, qty?, description?, period?, dimensions? }]
//                         — карточки новых единиц (после фото→AI на фронте).
//   • photos_<temp_id>    file — фото для каждой новой единицы.
//
// Доступ: requester заявки ИЛИ warehouse_director/deputy/staff.
// Статус заявки должен быть new / collecting / ready.
//
// Логика: создаём новые units (status='on_stock', is_walkin=false,
// created_via='request_edit'), кладём фото, обновляем requests.unit_ids на
// объединённый список. unit_history фиксирует diff (добавлено/убрано).
router.post('/:id/items', verifyJWT, upload.any(), async (req, res) => {
  let parsedExisting = []
  let parsedNew = []
  try {
    parsedExisting = JSON.parse(req.body.existing_unit_ids || '[]')
    parsedNew = JSON.parse(req.body.new_units || '[]')
  } catch (_e) {
    return res.status(400).json({ error: 'existing_unit_ids / new_units must be JSON' })
  }
  if (!Array.isArray(parsedExisting) || !Array.isArray(parsedNew)) {
    return res.status(400).json({ error: 'existing_unit_ids / new_units must be arrays' })
  }

  // Соберём фото по temp_id (поле photos_<temp_id> может содержать одно или несколько фото).
  const filesByField = {}
  for (const f of req.files || []) {
    (filesByField[f.fieldname] ||= []).push(f)
  }

  const client = await db.pool.connect()
  try {
    await client.query('BEGIN')

    const { rows: reqRows } = await client.query(
      `SELECT * FROM requests WHERE id = $1 FOR UPDATE`, [req.params.id]
    )
    if (!reqRows.length) {
      await client.query('ROLLBACK')
      return res.status(404).json({ error: 'Request not found' })
    }
    const reqRow = reqRows[0]

    // Право редактирования: автор заявки или склад.
    const isRequester = String(reqRow.requester_id) === String(req.user.id)
    const isWarehouse = WAREHOUSE_EDIT_ROLES.has(req.user.role)
    if (!isRequester && !isWarehouse) {
      await client.query('ROLLBACK')
      return res.status(403).json({ error: 'Forbidden' })
    }
    if (!EDITABLE_REQUEST_STATUSES.has(reqRow.status)) {
      await client.query('ROLLBACK')
      return res.status(400).json({
        error: `Состав заявки нельзя менять в статусе «${reqRow.status}»`,
      })
    }

    // Валидация существующих unit_ids.
    const existingIds = parsedExisting.map(String)
    const uniqueExisting = [...new Set(existingIds)]
    if (uniqueExisting.length) {
      const { rows: validUnits } = await client.query(
        `SELECT id, name, status, misplaced, is_project_kept
         FROM units WHERE id = ANY($1::uuid[])`,
        [uniqueExisting]
      )
      if (validUnits.length !== uniqueExisting.length) {
        await client.query('ROLLBACK')
        return res.status(400).json({ error: 'Some unit_ids not found' })
      }
      // Если единица добавляется впервые (не была в заявке) — она должна быть
      // доступна. Уже-в-заявке оставляем как есть, даже если статус сменился.
      const oldIdSet = new Set((reqRow.unit_ids || []).map(String))
      for (const u of validUnits) {
        if (oldIdSet.has(String(u.id))) continue
        let why = null
        if (u.status === 'issued') why = 'уже выдана'
        else if (u.status === 'written_off') why = 'списана'
        else if (u.status === 'debt') why = 'в долге'
        else if (u.misplaced) why = 'помечена как пересорт'
        else if (u.is_project_kept) why = 'хранится у проекта, не на общем складе'
        else if (u.status !== 'on_stock') why = `недоступна (${u.status})`
        if (why) {
          await client.query('ROLLBACK')
          return res.status(400).json({ error: `Единица «${u.name}» ${why}` })
        }
      }
    }

    // Создание новых единиц из распознанных AI-карточек.
    // Подход тот же что в walkin.js: один SELECT count + in-memory increment для serial.
    const createdIds = []
    if (parsedNew.length) {
      const { rows: cntRows } = await client.query(`SELECT COUNT(*)::int AS cnt FROM units`)
      let runningCount = cntRows[0]?.cnt || 0
      for (const u of parsedNew) {
        if (!u || !u.name || !u.category) {
          await client.query('ROLLBACK')
          return res.status(400).json({ error: 'new_units: name/category required' })
        }
        runningCount += 1
        const catPrefix = String(u.category || 'XX').slice(0, 3).toUpperCase()
        const serial = `${catPrefix}-${String(runningCount).padStart(5, '0')}`
        const qty = Number.isFinite(Number(u.qty)) && Number(u.qty) > 0 ? Number(u.qty) : 1

        const { rows: ins } = await client.query(
          `INSERT INTO units (name, category, serial, qty, description, period, dimensions,
                              status, is_walkin, created_via, created_by)
           VALUES ($1,$2,$3,$4,$5,$6,$7,'on_stock',false,'request_edit',$8)
           RETURNING id`,
          [
            String(u.name).trim().slice(0, 200),
            String(u.category).trim(),
            serial,
            qty,
            u.description ? String(u.description).slice(0, 1000) : null,
            u.period ? String(u.period).slice(0, 80) : null,
            u.dimensions ? String(u.dimensions).slice(0, 200) : null,
            req.user.id,
          ]
        )
        const newId = ins[0].id
        createdIds.push(newId)

        const photoFiles = filesByField[`photos_${u.temp_id}`] || []
        for (const f of photoFiles) {
          const url = await uploadFile(f.buffer, f.originalname || 'photo.jpg', 'units')
          await client.query(
            `INSERT INTO unit_photos (unit_id, url, type) VALUES ($1, $2, 'stock')`,
            [newId, url]
          )
        }

        await client.query(
          `INSERT INTO unit_history (unit_id, action, user_id, notes)
           VALUES ($1, 'Добавлено через правку заявки', $2, $3)`,
          [newId, req.user.id, `Заявка ${reqRow.id}`]
        )
      }
    }

    // Финальный список + diff для unit_history.
    const finalIds = [...uniqueExisting, ...createdIds]
    const oldSet = new Set((reqRow.unit_ids || []).map(String))
    const newSet = new Set(finalIds.map(String))
    const added = finalIds.filter(id => !oldSet.has(String(id)))
    const removed = (reqRow.unit_ids || []).filter(id => !newSet.has(String(id)))

    await client.query(
      `UPDATE requests SET unit_ids = $1::uuid[] WHERE id = $2`,
      [finalIds, reqRow.id]
    )

    // unit_history по diff'у. Новые единицы (createdIds) уже получили запись
    // 'Добавлено через правку заявки' выше — здесь только уже-существующие.
    const createdSet = new Set(createdIds.map(String))
    for (const uid of added) {
      if (createdSet.has(String(uid))) continue
      await client.query(
        `INSERT INTO unit_history (unit_id, action, user_id, notes)
         VALUES ($1, 'Включено в заявку', $2, $3)`,
        [uid, req.user.id, `Заявка ${reqRow.id}`]
      )
    }
    for (const uid of removed) {
      await client.query(
        `INSERT INTO unit_history (unit_id, action, user_id, notes)
         VALUES ($1, 'Исключено из заявки', $2, $3)`,
        [uid, req.user.id, `Заявка ${reqRow.id}`]
      )
    }

    await client.query('COMMIT')

    // Уведомления — после COMMIT, вне транзакции.
    if (added.length || removed.length) {
      const summary = [
        added.length ? `+${added.length}` : null,
        removed.length ? `−${removed.length}` : null,
      ].filter(Boolean).join(' / ')
      if (isRequester) {
        // Юзер изменил свою заявку → уведомить склад.
        await notifyWarehouse({
          type: 'request_changed',
          text: `Состав заявки изменён клиентом: ${summary}`,
          entity_id: reqRow.id,
          entity_type: 'request',
        }).catch(() => {})
      } else if (isWarehouse && reqRow.requester_id) {
        // Склад изменил → уведомить автора заявки.
        await createNotification({
          user_id: reqRow.requester_id,
          type: 'request_changed',
          text: `Состав вашей заявки изменён складом: ${summary}`,
          entity_id: reqRow.id,
          entity_type: 'request',
        }).catch(() => {})
      }
    }

    const { rows: out } = await db.query(
      `SELECT * FROM requests WHERE id = $1`, [reqRow.id]
    )
    res.json({ request: out[0], added: added.length, removed: removed.length })
  } catch (err) {
    try { await client.query('ROLLBACK') } catch (_e) { /* ignore */ }
    console.error('PATCH /requests/:id/items', err)
    res.status(500).json({ error: 'Server error' })
  } finally {
    client.release()
  }
})

// PUT /requests/:id/status
router.put('/:id/status', verifyJWT, checkRole('warehouse_director', 'warehouse_deputy', 'warehouse_staff'), async (req, res) => {
  const { status } = req.body
  const allowed = ['collecting', 'ready', 'cancelled']
  if (!allowed.includes(status)) return res.status(400).json({ error: 'Invalid status' })

  try {
    const { rows } = await db.query(
      `UPDATE requests SET status=$1 WHERE id=$2 RETURNING *`,
      [status, req.params.id]
    )
    if (!rows.length) return res.status(404).json({ error: 'Request not found' })
    res.json({ request: rows[0] })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Server error' })
  }
})

// GET /requests
router.get('/', verifyJWT, async (req, res) => {
  const { status, warehouse_id, project_id, requester_id } = req.query
  try {
    // Check visibility setting for warehouse staff/deputy
    if (['warehouse_staff', 'warehouse_deputy'].includes(req.user.role)) {
      const { rows: vis } = await db.query(
        `SELECT can_see_requests FROM request_visibility WHERE user_id = $1`,
        [req.user.id]
      )
      if (vis.length && !vis[0].can_see_requests) {
        return res.json({ requests: [] })
      }
    }
    let q = `
      SELECT r.*, u.name AS requester_name, u.role AS requester_role, u.email AS requester_email,
             p.name AS project_name,
             i.id AS issuance_id, i.return_requested_at,
             ret.returned_at
      FROM requests r
      JOIN users u ON u.id = r.requester_id
      LEFT JOIN projects p ON p.id = r.project_id
      LEFT JOIN issuances i ON i.request_id = r.id
      LEFT JOIN LATERAL (
        SELECT returned_at FROM returns WHERE issuance_id = i.id
        ORDER BY returned_at DESC LIMIT 1
      ) ret ON TRUE
      WHERE 1=1
    `
    const params = []
    if (status)       { params.push(status);       q += ` AND r.status = $${params.length}` }
    if (warehouse_id) { params.push(warehouse_id); q += ` AND r.warehouse_id = $${params.length}` }
    if (project_id)   { params.push(project_id);   q += ` AND r.project_id = $${params.length}` }
    if (requester_id) { params.push(requester_id); q += ` AND r.requester_id = $${params.length}` }
    q += ` ORDER BY r.created_at DESC`

    const { rows } = await db.query(q, params)
    res.json({ requests: rows })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Server error' })
  }
})

module.exports = router
