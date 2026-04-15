const router = require('express').Router()
const multer = require('multer')
const Anthropic = require('@anthropic-ai/sdk')
const sharp = require('sharp')
const db     = require('../db')
const { verifyJWT, checkRole } = require('../middleware/auth')
const { uploadFile, deleteFile } = require('../services/r2')

const ALLOWED_MEDIA_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'video/mp4', 'video/webm', 'video/quicktime']
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 100 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    cb(null, ALLOWED_MEDIA_TYPES.includes(file.mimetype))
  },
})

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
  baseURL: 'https://anthropic-proxy.pavelbelov590.workers.dev',
})

const DIRECTOR_ROLES = ['warehouse_director', 'warehouse_deputy']

// GET /units
router.get('/', verifyJWT, async (req, res) => {
  const { warehouse, status, category, search, cell_id } = req.query
  try {
    let q = `
      SELECT u.*, w.name AS warehouse_name, c.code AS cell_code,
             (SELECT url FROM unit_photos WHERE unit_id = u.id ORDER BY created_at LIMIT 1) AS photo_url
      FROM units u
      LEFT JOIN warehouses w ON w.id = u.warehouse_id
      LEFT JOIN cells c ON c.id = u.cell_id
      WHERE 1=1
    `
    const params = []
    if (warehouse) { params.push(warehouse); q += ` AND u.warehouse_id = $${params.length}` }
    if (status)    { params.push(status);    q += ` AND u.status = $${params.length}` }
    if (category)  { params.push(category);  q += ` AND u.category = $${params.length}` }
    if (cell_id)   { params.push(cell_id);   q += ` AND u.cell_id = $${params.length}` }
    if (search) {
      const { buildSearchQuery } = require('../services/searchService')
      const { tsqueryStr, originalQuery } = await buildSearchQuery(search)
      params.push(tsqueryStr)
      const tsqIdx = params.length
      params.push(originalQuery)
      const rawIdx = params.length
      q += ` AND (u.search_vector @@ to_tsquery('ru_search', $${tsqIdx})
             OR similarity(u.name, $${rawIdx}) > 0.2)`
    }
    if (search) {
      const tsqIdx = params.length - 1
      const rawIdx = params.length
      q += ` ORDER BY ts_rank_cd(u.search_vector, to_tsquery('ru_search', $${tsqIdx})) DESC,
                       similarity(u.name, $${rawIdx}) DESC, u.created_at DESC`
    } else {
      q += ` ORDER BY u.created_at DESC`
    }

    const { rows } = await db.query(q, params)
    const canSeeValuation = ['warehouse_director', 'warehouse_deputy', 'producer'].includes(req.user.role)
    const units = canSeeValuation ? rows : rows.map(({ valuation, ...rest }) => rest)
    res.json({ units })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Server error' })
  }
})

// GET /units/ai-test — test Anthropic API connectivity (public for debugging)
router.get('/ai-test', async (req, res) => {
  const start = Date.now()
  try {
    console.log('ai-test: starting, API key present:', !!process.env.ANTHROPIC_API_KEY)
    const response = await anthropic.messages.create({
      model: 'claude-haiku-4-5',
      max_tokens: 20,
      messages: [{ role: 'user', content: 'say ok' }],
    })
    console.log('ai-test: success in', Date.now() - start, 'ms')
    res.json({ ok: true, text: response.content[0]?.text, ms: Date.now() - start })
  } catch (err) {
    console.error('ai-test: error in', Date.now() - start, 'ms:', err.message)
    res.status(500).json({ error: err.message, code: err.status, ms: Date.now() - start })
  }
})

// POST /units/recognize — AI photo recognition to auto-fill unit fields
router.post('/recognize', verifyJWT, upload.single('photo'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No photo provided' })
  if (!process.env.ANTHROPIC_API_KEY) return res.status(500).json({ error: 'AI not configured' })

  const resized = await sharp(req.file.buffer)
    .resize(800, 800, { fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 70 })
    .toBuffer()
  const base64 = resized.toString('base64')
  const mediaType = 'image/jpeg'

  try {
    const response = await anthropic.messages.create({
      model: 'claude-haiku-4-5',
      max_tokens: 1024,
      messages: [{
        role: 'user',
        content: [
          {
            type: 'image',
            source: { type: 'base64', media_type: mediaType, data: base64 },
          },
          {
            type: 'text',
            text: `Ты — система распознавания предметов для склада кинопроизводства.
Проанализируй фото и верни JSON с полями:
- name: название предмета (кратко, по-русски)
- category: одна из категорий: costumes, props, art_fill, dummy, auto, furniture, decor, scenery, tech, lighting, sound, camera, makeup, clothing, jewelry, other
- period: временная эпоха/стиль — ОБЯЗАТЕЛЬНО заполни это поле. Примеры: "Современное", "Советское (1970-е)", "XVIII век", "Средневековье", "1960-е", "Античность". Если предмет современный — напиши "Современное"
- description: краткое описание (цвет, состояние, материал, особенности)

Все 4 поля обязательны, ни одно не может быть пустым. Отвечай ТОЛЬКО JSON, без markdown, без пояснений.`,
          },
        ],
      }],
    })

    const text = response.content.find(b => b.type === 'text')?.text || ''
    console.log('recognize: Claude response:', text.substring(0, 300))
    const clean = text.replace(/^```(?:json)?/m, '').replace(/```$/m, '').trim()
    const result = JSON.parse(clean)
    res.json(result)
  } catch (err) {
    console.error('Photo recognition error:', err.message, err.status, err.error)
    res.status(500).json({ error: err.message || 'Recognition failed' })
  }
})

// POST /units — add unit (goes to pending, waits for director approval)
router.post('/', verifyJWT, async (req, res) => {
  const { name, category, serial, warehouse_id, cell_id, description, qty, condition, valuation, source, dimensions, period } = req.body
  if (!name || !category) return res.status(400).json({ error: 'Missing required fields' })

  const isDirector = ['warehouse_director', 'warehouse_deputy'].includes(req.user.role)
  const finalStatus = isDirector ? 'on_stock' : 'pending'

  try {
    // Auto-generate inventory number if not provided
    let inventorySerial = serial
    if (!inventorySerial) {
      const catPrefix = (category || 'XX').slice(0, 3).toUpperCase()
      const { rows: countRows } = await db.query(`SELECT COUNT(*)::int AS cnt FROM units`)
      const nextNum = (countRows[0]?.cnt || 0) + 1
      inventorySerial = `${catPrefix}-${String(nextNum).padStart(5, '0')}`
    }

    const { rows } = await db.query(
      `INSERT INTO units (name, category, serial, warehouse_id, cell_id, description, qty, condition, valuation, source, dimensions, status, period)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *`,
      [name, category, inventorySerial, warehouse_id || null, cell_id || null,
       description || null, qty || 1, condition || null, valuation || null,
       source || null, dimensions || null, finalStatus, period || null]
    )
    const unit = rows[0]

    // Create approval record only for non-directors
    if (!isDirector) {
      await db.query(
        `INSERT INTO approvals (unit_id, proposed_by, action, new_data)
         VALUES ($1, $2, 'add', $3)`,
        [unit.id, req.user.id, JSON.stringify(req.body)]
      )
    }

    // Log
    await db.query(
      `INSERT INTO unit_history (unit_id, action, user_id) VALUES ($1, $2, $3)`,
      [unit.id, isDirector ? 'Добавлено' : 'Добавлено (ожидает подписи)', req.user.id]
    )

    res.status(201).json({ unit })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Server error' })
  }
})

// GET /units/approvals — pending approvals list
router.get('/approvals', verifyJWT, checkRole('warehouse_director', 'warehouse_deputy', 'warehouse_staff'), async (req, res) => {
  try {
    const isStaff = req.user.role === 'warehouse_staff'
    let q = `
      SELECT a.id AS approval_id, a.unit_id, a.action, a.new_data, a.created_at,
             u.name AS unit_name, u.category, u.status AS unit_status,
             usr.name AS proposed_by_name, usr.role AS proposed_by_role
      FROM approvals a
      JOIN units u ON u.id = a.unit_id
      JOIN users usr ON usr.id = a.proposed_by
      WHERE a.status = 'pending'
    `
    // Staff only sees their own proposals
    const params = []
    if (isStaff) { params.push(req.user.id); q += ` AND a.proposed_by = $${params.length}` }
    q += ` ORDER BY a.created_at DESC`

    const { rows } = await db.query(q, params)
    res.json({ approvals: rows })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Server error' })
  }
})

// GET /units/:id
router.get('/:id', verifyJWT, async (req, res) => {
  try {
    const { rows } = await db.query(
      `SELECT u.*, w.name AS warehouse_name, c.code AS cell_code, c.custom_name AS cell_custom
       FROM units u
       LEFT JOIN warehouses w ON w.id = u.warehouse_id
       LEFT JOIN cells c ON c.id = u.cell_id
       WHERE u.id = $1`,
      [req.params.id]
    )
    if (!rows.length) return res.status(404).json({ error: 'Unit not found' })

    const unit = rows[0]

    // Photos
    const { rows: photos } = await db.query(
      `SELECT * FROM unit_photos WHERE unit_id = $1 ORDER BY created_at`, [unit.id]
    )
    unit.photos = photos

    // History — only director/deputy
    if (DIRECTOR_ROLES.includes(req.user.role)) {
      const { rows: history } = await db.query(
        `SELECT h.*, u.name AS user_name
         FROM unit_history h
         LEFT JOIN users u ON u.id = h.user_id
         WHERE h.unit_id = $1 ORDER BY h.created_at DESC`,
        [unit.id]
      )
      unit.history = history
    }

    res.json({ unit })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Server error' })
  }
})

// PUT /units/:id — propose edit (goes to pending approval)
router.put('/:id', verifyJWT, async (req, res) => {
  try {
    const { rows } = await db.query(`SELECT * FROM units WHERE id = $1`, [req.params.id])
    if (!rows.length) return res.status(404).json({ error: 'Unit not found' })

    // Director can edit directly
    if (DIRECTOR_ROLES.includes(req.user.role)) {
      const { name, category, serial, warehouse_id, cell_id, description, qty, condition, valuation, materials, period } = req.body
      const { rows: updated } = await db.query(
        `UPDATE units SET name=$1,category=$2,serial=$3,warehouse_id=$4,cell_id=$5,
         description=$6,qty=$7,condition=$8,valuation=$9,materials=$10,period=$11 WHERE id=$12 RETURNING *`,
        [name, category, serial, warehouse_id, cell_id, description, qty, condition, valuation, materials || null, period || null, req.params.id]
      )
      await db.query(
        `INSERT INTO unit_history (unit_id, action, user_id) VALUES ($1,'Изменено',$2)`,
        [req.params.id, req.user.id]
      )
      return res.json({ unit: updated[0] })
    }

    // Others create approval
    await db.query(
      `INSERT INTO approvals (unit_id, proposed_by, action, new_data) VALUES ($1,$2,'edit',$3)`,
      [req.params.id, req.user.id, JSON.stringify(req.body)]
    )
    res.json({ ok: true, pending: true })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Server error' })
  }
})

// POST /units/:id/approve
router.post('/:id/approve', verifyJWT, checkRole('warehouse_director', 'warehouse_deputy'), async (req, res) => {
  const { approval_id, valuation } = req.body
  try {
    const { rows } = await db.query(
      `SELECT * FROM approvals WHERE id = $1 AND unit_id = $2 AND status = 'pending'`,
      [approval_id, req.params.id]
    )
    if (!rows.length) return res.status(404).json({ error: 'Approval not found' })
    const approval = rows[0]

    if (approval.action === 'add') {
      if (valuation == null || valuation === '') return res.status(400).json({ error: 'Укажите стоимость единицы' })
      await db.query(`UPDATE units SET status = 'on_stock', valuation = $2 WHERE id = $1`, [req.params.id, valuation])
      await db.query(
        `INSERT INTO unit_history (unit_id, action, user_id) VALUES ($1,'Принято на склад',$2)`,
        [req.params.id, req.user.id]
      )
    } else if (approval.action === 'writeoff') {
      const data = approval.new_data
      await db.query(`UPDATE units SET status='written_off' WHERE id=$1`, [req.params.id])
      await db.query(
        `INSERT INTO unit_history (unit_id, action, user_id, notes) VALUES ($1,'Списано (по заявке зама)',$2,$3)`,
        [req.params.id, req.user.id, data.reason || null]
      )
    } else if (approval.action === 'edit') {
      const data = approval.new_data
      await db.query(
        `UPDATE units SET name=$1,category=$2,serial=$3,description=$4,qty=$5,condition=$6,valuation=$7 WHERE id=$8`,
        [data.name, data.category, data.serial, data.description, data.qty, data.condition, data.valuation, req.params.id]
      )
      await db.query(
        `INSERT INTO unit_history (unit_id, action, user_id) VALUES ($1,'Изменение подписано',$2)`,
        [req.params.id, req.user.id]
      )
    }

    await db.query(`UPDATE approvals SET status='approved' WHERE id=$1`, [approval_id])
    res.json({ ok: true })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Server error' })
  }
})

// POST /units/:id/reject
router.post('/:id/reject', verifyJWT, checkRole('warehouse_director', 'warehouse_deputy'), async (req, res) => {
  const { approval_id } = req.body
  try {
    await db.query(`UPDATE approvals SET status='rejected' WHERE id=$1`, [approval_id])
    await db.query(
      `INSERT INTO unit_history (unit_id, action, user_id) VALUES ($1,'Отклонено директором',$2)`,
      [req.params.id, req.user.id]
    )
    res.json({ ok: true })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Server error' })
  }
})

// POST /units/:id/writeoff
router.post('/:id/writeoff', verifyJWT, checkRole('warehouse_director', 'warehouse_deputy'), async (req, res) => {
  const { reason } = req.body
  try {
    await db.query(`UPDATE units SET status='written_off' WHERE id=$1`, [req.params.id])
    await db.query(
      `INSERT INTO unit_history (unit_id, action, user_id, notes) VALUES ($1,'Списано',$2,$3)`,
      [req.params.id, req.user.id, reason || null]
    )
    res.json({ ok: true })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Server error' })
  }
})

// POST /units/:id/photos
router.post('/:id/photos', verifyJWT, upload.array('photos', 10), async (req, res) => {
  const { type = 'stock' } = req.body
  try {
    const urls = []
    for (const file of req.files) {
      const url = await uploadFile(file.buffer, file.originalname, 'units')
      const { rows } = await db.query(
        `INSERT INTO unit_photos (unit_id, url, type) VALUES ($1,$2,$3) RETURNING *`,
        [req.params.id, url, type]
      )
      urls.push(rows[0])
    }
    res.json({ photos: urls })
  } catch (err) {
    console.error('Photo upload error:', err)
    res.status(500).json({ error: err.message || 'Server error' })
  }
})

// POST /units/:id/request-writeoff — deputy requests writeoff from director
router.post('/:id/request-writeoff', verifyJWT, checkRole('warehouse_deputy', 'warehouse_staff'), async (req, res) => {
  const { reason } = req.body
  try {
    const { rows } = await db.query(`SELECT * FROM units WHERE id = $1`, [req.params.id])
    if (!rows.length) return res.status(404).json({ error: 'Unit not found' })

    await db.query(
      `INSERT INTO approvals (unit_id, proposed_by, action, new_data)
       VALUES ($1, $2, 'writeoff', $3)`,
      [req.params.id, req.user.id, JSON.stringify({ reason: reason || '' })]
    )

    await db.query(
      `INSERT INTO unit_history (unit_id, action, user_id, notes) VALUES ($1, 'Запрос на списание', $2, $3)`,
      [req.params.id, req.user.id, reason || null]
    )

    // Notify director
    const { rows: directors } = await db.query(
      `SELECT id FROM users WHERE role = 'warehouse_director'`
    )
    for (const d of directors) {
      await db.query(
        `INSERT INTO notifications (user_id, type, text, entity_id, entity_type)
         VALUES ($1, 'writeoff_request', $2, $3, 'unit')`,
        [d.id, `Запрос на списание: ${rows[0].name}`, req.params.id]
      )
    }

    res.json({ ok: true })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Server error' })
  }
})

// POST /units/bulk-delete — delete multiple units at once
router.post('/bulk-delete', verifyJWT, checkRole('warehouse_director', 'warehouse_deputy'), async (req, res) => {
  const { ids } = req.body
  if (!Array.isArray(ids) || !ids.length) return res.status(400).json({ error: 'ids array required' })

  const client = await db.getClient()
  try {
    await client.query('BEGIN')

    // Delete photos from R2 for all units
    const { rows: photos } = await client.query(
      `SELECT url FROM unit_photos WHERE unit_id = ANY($1)`, [ids]
    )
    for (const p of photos) {
      await deleteFile(p.url).catch(() => {})
    }

    // Clean up related records
    await client.query(`DELETE FROM debts WHERE unit_id = ANY($1)`, [ids])
    await client.query(`DELETE FROM approvals WHERE unit_id = ANY($1)`, [ids])
    await client.query(`DELETE FROM unit_history WHERE unit_id = ANY($1)`, [ids])
    await client.query(`DELETE FROM unit_photos WHERE unit_id = ANY($1)`, [ids])
    const { rowCount } = await client.query(`DELETE FROM units WHERE id = ANY($1)`, [ids])

    await client.query('COMMIT')
    res.json({ ok: true, deleted: rowCount })
  } catch (err) {
    await client.query('ROLLBACK')
    console.error(err)
    res.status(500).json({ error: 'Server error' })
  } finally {
    client.release()
  }
})

// DELETE /units/:id — delete unit (director/deputy)
router.delete('/:id', verifyJWT, checkRole('warehouse_director', 'warehouse_deputy'), async (req, res) => {
  try {
    const { rows } = await db.query(`SELECT * FROM units WHERE id = $1`, [req.params.id])
    if (!rows.length) return res.status(404).json({ error: 'Unit not found' })

    // Delete photos from R2
    const { rows: photos } = await db.query(`SELECT url FROM unit_photos WHERE unit_id = $1`, [req.params.id])
    for (const p of photos) {
      await deleteFile(p.url).catch(() => {})
    }

    // Clean up related records before delete
    await db.query(`DELETE FROM debts WHERE unit_id = $1`, [req.params.id])
    await db.query(`DELETE FROM approvals WHERE unit_id = $1`, [req.params.id])
    await db.query(`DELETE FROM unit_history WHERE unit_id = $1`, [req.params.id])
    await db.query(`DELETE FROM unit_photos WHERE unit_id = $1`, [req.params.id])

    await db.query(`DELETE FROM units WHERE id = $1`, [req.params.id])
    res.json({ ok: true })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Server error' })
  }
})

// DELETE /units/:id/photos/:photoId
router.delete('/:id/photos/:photoId', verifyJWT, async (req, res) => {
  try {
    const { rows } = await db.query(
      `SELECT * FROM unit_photos WHERE id = $1 AND unit_id = $2`,
      [req.params.photoId, req.params.id]
    )
    if (!rows.length) return res.status(404).json({ error: 'Photo not found' })

    const photo = rows[0]
    await deleteFile(photo.url)
    await db.query(`DELETE FROM unit_photos WHERE id = $1`, [photo.id])

    res.json({ ok: true })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Server error' })
  }
})

module.exports = router
