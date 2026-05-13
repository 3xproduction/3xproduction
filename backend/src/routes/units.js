const router = require('express').Router()
const multer = require('multer')
const sharp = require('sharp')
const db     = require('../db')
const { verifyJWT, checkRole } = require('../middleware/auth')
const { uploadFile, deleteFile, uploadImageWithThumb, makeThumbFromBuffer } = require('../services/r2')
const { CATEGORIES_BY_STORAGE } = require('../constants/storageRules')
const { notifyNewUnit, notifyNoCellIfThresholdCrossed } = require('../services/notifications')
const { unitMissingFields, canSeeMissingUnitData } = require('../utils/unitMissingFields')
const { buildSearchQuery, normalizeSearchText, compactSearchText, normalizedSqlText, compactSqlText } = require('../services/searchService')
const { createAnthropicClient } = require('../services/anthropicClient')
const logger = require('../logger')

// Validate that a unit move to target cell is allowed.
// Категорийные ограничения убраны — пользователь сам решает что куда класть.
// Остаётся только проверка существования ячейки.
async function validateCellMove(unitRow, targetCellId) {
  if (!targetCellId) return { ok: true }
  const { rows } = await db.query(
    `SELECT c.id AS cell_id FROM cells c WHERE c.id = $1`,
    [targetCellId]
  )
  if (!rows.length) return { ok: false, error: 'Ячейка не найдена' }
  return { ok: true }
}

const ALLOWED_MEDIA_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'video/mp4', 'video/webm', 'video/quicktime']
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 100 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    cb(null, ALLOWED_MEDIA_TYPES.includes(file.mimetype))
  },
})

const anthropic = createAnthropicClient()

const DIRECTOR_ROLES = ['warehouse_director', 'warehouse_deputy']
const PENDING_REQUEST_DETAIL_ROLES = new Set(['warehouse_director', 'warehouse_deputy', 'warehouse_staff'])
const ADMIN_STOCK_ROLES = new Set([
  'warehouse_director', 'warehouse_deputy', 'warehouse_staff',
  'project_director', 'set_admin',
])

function canAccessAdminStock(user) {
  return ADMIN_STOCK_ROLES.has(user?.role)
}

// GET /units/export — export warehouse to Excel
router.get('/export', verifyJWT, checkRole('warehouse_director', 'warehouse_deputy'), async (req, res) => {
  try {
    const ExcelJS = require('exceljs')
    const { rows } = await db.query(
      `SELECT u.name, u.category, u.serial, u.status, u.qty, u.valuation,
              u.description, u.source, u.period, u.dimensions, u.materials, u.condition,
              c.custom_name AS cell_name, c.code AS cell_code,
              ws.name AS section_name, w.name AS warehouse_name
       FROM units u
       LEFT JOIN cells c ON c.id = u.cell_id
       LEFT JOIN warehouse_sections ws ON ws.id = c.section_id
       LEFT JOIN warehouses w ON w.id = u.warehouse_id
       WHERE COALESCE(u.is_admin_stock, false) = false
       ORDER BY u.category, u.name`
    )

    const CATEGORY_MAP = {
      costumes: 'Костюмы', props: 'Реквизит', art_fill: 'Художественное наполнение',
      dummy: 'Бутафория', auto: 'Автомобили', furniture: 'Мебель', decor: 'Декор',
      scenery: 'Декорации', tech: 'Техника', lighting: 'Осветительное оборудование',
      sound: 'Звуковое оборудование', camera: 'Камерное оборудование',
      makeup: 'Грим и косметика', clothing: 'Одежда', jewelry: 'Украшения', other: 'Прочее',
    }
    const STATUS_MAP = { on_stock: 'На складе', issued: 'Выдано', overdue: 'Просрочено', pending: 'На согласовании', written_off: 'Списано' }

    const wb = new ExcelJS.Workbook()
    const ws = wb.addWorksheet('Склад')
    ws.columns = [
      { header: 'Название', key: 'name', width: 30 },
      { header: 'Категория', key: 'category', width: 20 },
      { header: 'Инв. номер', key: 'serial', width: 15 },
      { header: 'Статус', key: 'status', width: 15 },
      { header: 'Кол-во', key: 'qty', width: 8 },
      { header: 'Стоимость', key: 'valuation', width: 12 },
      { header: 'Описание', key: 'description', width: 35 },
      { header: 'Источник', key: 'source', width: 15 },
      { header: 'Период/эпоха', key: 'period', width: 15 },
      { header: 'Склад', key: 'warehouse_name', width: 20 },
      { header: 'Полка', key: 'cell_name', width: 15 },
    ]
    ws.getRow(1).font = { bold: true }

    for (const r of rows) {
      ws.addRow({
        ...r,
        category: CATEGORY_MAP[r.category] || r.category,
        status: STATUS_MAP[r.status] || r.status,
        valuation: r.valuation ? Number(r.valuation) : '',
        cell_name: r.cell_name || r.cell_code || '',
      })
    }

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
    res.setHeader('Content-Disposition', 'attachment; filename=warehouse_export.xlsx')
    await wb.xlsx.write(res)
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Server error' })
  }
})

// GET /units
router.get('/', verifyJWT, async (req, res) => {
  const { warehouse, status, category, search, cell_id, scope, misplaced, photo_match_available } = req.query
  // scope: 'common' (default) — only warehouse units, 'project' — only project-kept, 'all' — both
  try {
    // photo_url: было N+1 — коррелированный подзапрос на каждую единицу.
    // Теперь один проход по unit_photos через LATERAL JOIN с LIMIT 1.
    let q = `
      SELECT u.*, w.name AS warehouse_name, w.address AS warehouse_address,
             c.code AS cell_code, c.custom_name AS cell_custom,
             sec.name AS section_name, sec.type AS section_type,
             hall.name AS hall_name,
             pav.name AS pavilion_name,
             ph.url AS photo_url,
             ph.thumb_url AS photo_thumb_url
      FROM units u
      LEFT JOIN warehouses w ON w.id = u.warehouse_id
      LEFT JOIN cells c ON c.id = u.cell_id
      LEFT JOIN warehouse_sections sec ON sec.id = c.section_id
      LEFT JOIN warehouse_sections hall ON hall.id = sec.parent_section_id AND hall.type = 'hall'
      LEFT JOIN decorations pav ON pav.id = u.pavilion_id AND pav.type = 'pavilion'
      LEFT JOIN LATERAL (
        SELECT url, thumb_url FROM unit_photos
        WHERE unit_id = u.id
        ORDER BY CASE WHEN url ~* '\\.(mp4|webm|mov)$' THEN 1 ELSE 0 END, created_at
        LIMIT 1
      ) ph ON true
      WHERE 1=1
    `
    const params = []
    // Видимость writted_off и misplaced:
    //   - Списанные (written_off): producer + warehouse_director/deputy.
    //   - Пересорт (misplaced): те же + warehouse_staff — им нужно «находить» их на /misplaced.
    //   - Остальные (production-роли, публика) — не видят ни то, ни другое.
    const CAN_SEE_WRITTEN_OFF = ['producer', 'warehouse_director', 'warehouse_deputy']
    const CAN_SEE_MISPLACED   = [...CAN_SEE_WRITTEN_OFF, 'warehouse_staff']
    if (!CAN_SEE_WRITTEN_OFF.includes(req.user.role)) {
      q += ` AND u.status != 'written_off'`
    }
    if (!CAN_SEE_MISPLACED.includes(req.user.role)) {
      q += ` AND COALESCE(u.misplaced, false) = false`
    }
    // Default scope: only common warehouse units. Project-kept and admin-stock
    // units are requested explicitly by their own endpoints/scopes.
    if (scope === 'admin') {
      if (!canAccessAdminStock(req.user)) return res.status(403).json({ error: 'Forbidden' })
      q += ` AND COALESCE(u.is_admin_stock, false) = true`
    } else if (scope === 'project') {
      q += ` AND u.is_project_kept = true`
    } else if (scope === 'all') {
      q += ` AND COALESCE(u.is_admin_stock, false) = false`
    } else {
      q += ` AND COALESCE(u.is_project_kept, false) = false
             AND COALESCE(u.is_admin_stock, false) = false`
    }
    if (photo_match_available === '1') {
      q += ` AND u.status = 'on_stock'
        AND COALESCE(u.is_project_kept, false) = false
        AND u.project_id IS NULL
        AND u.on_loan_to_project_id IS NULL
        AND COALESCE(u.pending_transfer, false) = false
        AND NOT EXISTS (
          SELECT 1
          FROM requests req
          JOIN issuances iss ON iss.request_id = req.id
          WHERE u.id = ANY(req.unit_ids)
            AND NOT EXISTS (SELECT 1 FROM returns r WHERE r.issuance_id = iss.id)
        )`
    }
    if (warehouse) { params.push(warehouse); q += ` AND u.warehouse_id = $${params.length}` }
    if (status)    { params.push(status);    q += ` AND u.status = $${params.length}` }
    if (category)  { params.push(category);  q += ` AND u.category = $${params.length}` }
    if (cell_id)   { params.push(cell_id);   q += ` AND u.cell_id = $${params.length}` }
    if (misplaced === 'true')  q += ` AND u.misplaced = true`
    if (misplaced === 'false') q += ` AND u.misplaced = false`
    let searchApplied = false
    let tsqIdx, rawIdx
    let closeSynonyms = []
    if (search) {
      const result = await buildSearchQuery(search)
      if (result.tsqueryStr) {
        params.push(result.tsqueryStr)
        tsqIdx = params.length
        params.push(result.originalQuery)
        rawIdx = params.length
        closeSynonyms = result.closeSynonyms || []
        const searchableExpr = `concat_ws(' ', u.name, u.description, u.serial, u.period, u.source, u.dimensions)`
        const normalizedSearchable = normalizedSqlText(searchableExpr)
        const compactSearchable = compactSqlText(searchableExpr)
        q += ` AND (
          ts_rank_cd(u.search_vector, to_tsquery('ru_search', $${tsqIdx})) > 0.5
          OR ${normalizedSearchable} LIKE '%' || $${rawIdx} || '%'
          OR ${compactSearchable} LIKE '%' || regexp_replace($${rawIdx}, '[^a-zа-я0-9]+', '', 'g') || '%'
        )`
        searchApplied = true
      }
    }
    if (searchApplied) {
      const searchableExpr = `concat_ws(' ', u.name, u.description, u.serial, u.period, u.source, u.dimensions)`
      const normalizedSearchable = normalizedSqlText(searchableExpr)
      const compactSearchable = compactSqlText(searchableExpr)
      q += ` ORDER BY
        CASE
          WHEN ${normalizedSearchable} LIKE '%' || $${rawIdx} || '%' THEN 2000
          WHEN ${compactSearchable} LIKE '%' || regexp_replace($${rawIdx}, '[^a-zа-я0-9]+', '', 'g') || '%' THEN 1600
          ELSE 0
        END
        + ts_rank_cd(u.search_vector, to_tsquery('ru_search', $${tsqIdx})) DESC,
        u.created_at DESC`
    } else {
      q += ` ORDER BY u.created_at DESC`
    }

    const { rows } = await db.query(q, params)
    const canSeeValuation = ['warehouse_director', 'warehouse_deputy', 'producer'].includes(req.user.role)
    const searchLower = search ? normalizeSearchText(search) : ''
    const searchCompact = search ? compactSearchText(search) : ''
    const units = rows.map(({ search_tags, search_vector, ...rest }) => {
      if (canSeeMissingUnitData(req.user.role)) {
        rest.missing_fields = unitMissingFields(rest)
      }
      if (!canSeeValuation) { const { valuation, ...r } = rest; rest = r }
      // 3-tier marking: direct → similar → related
      if (searchApplied) {
        const nameLower = normalizeSearchText(rest.name)
        const nameCompact = compactSearchText(rest.name)
        if (nameLower.includes(searchLower) || (searchCompact && nameCompact.includes(searchCompact))) {
          rest._match = 'direct'
        } else if (closeSynonyms.some(s => nameLower.includes(s))) {
          rest._match = 'similar'
        } else {
          rest._match = 'related'
        }
      }
      return rest
    })
    res.json({ units })
  } catch (err) {
    console.error('Units search error:', err)
    // Return empty results instead of 500 to prevent frontend flicker
    res.json({ units: [] })
  }
})

// GET /units/ai-test — test Anthropic API connectivity for warehouse admins.
router.get('/ai-test', verifyJWT, checkRole('warehouse_director', 'warehouse_deputy'), async (req, res) => {
  const start = Date.now()
  try {
    logger.debug({ hasApiKey: !!process.env.ANTHROPIC_API_KEY }, 'ai-test starting')
    const response = await anthropic.messages.create({
      model: 'claude-haiku-4-5',
      max_tokens: 20,
      messages: [{ role: 'user', content: 'say ok' }],
    })
    logger.debug({ ms: Date.now() - start }, 'ai-test success')
    res.json({ ok: true, text: response.content[0]?.text, ms: Date.now() - start })
  } catch (err) {
    logger.warn({ err, ms: Date.now() - start }, 'ai-test failed')
    res.status(500).json({ error: 'AI test failed', code: err.status, ms: Date.now() - start })
  }
})

// POST /units/recognize — мультифото AI-распознавание.
// Принимает 1..5 фото одного предмета. Структурированный вывод через
// Anthropic tool_use — JSON гарантированно валиден, category — enum.
const RECOGNIZE_CATEGORIES = [
  'props', 'art_fill', 'dummy',
  'auto', 'furniture', 'decor', 'scenery', 'tech',
  'shoes', 'jewelry', 'accessories', 'costumes',
  'food', 'drinks',
  'other',
]

router.post('/recognize', verifyJWT, upload.array('photos', 5), async (req, res) => {
  const files = req.files || []
  if (!files.length) return res.status(400).json({ error: 'No photos provided' })
  if (!process.env.ANTHROPIC_API_KEY) return res.status(500).json({ error: 'AI not configured' })

  const redact = (s) => {
    let str = String(s || '')
    const key = process.env.ANTHROPIC_API_KEY
    if (key && key.length > 8) str = str.split(key).join('[redacted]')
    return str.slice(0, 300)
  }

  try {
    // Sharp: учитываем EXIF orientation (.rotate без аргумента),
    // сжимаем до 1568×1568 inside (sweet spot для Claude vision)
    // только если оригинал больше — withoutEnlargement предотвращает upscale.
    const images = await Promise.all(files.map(async (f) => {
      const resized = await sharp(f.buffer)
        .rotate()
        .resize(1568, 1568, { fit: 'inside', withoutEnlargement: true })
        .jpeg({ quality: 85 })
        .toBuffer()
      return resized.toString('base64')
    }))

    const content = []
    images.forEach((data, idx) => {
      content.push({ type: 'text', text: `Фото ${idx}:` })
      content.push({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data } })
    })
    content.push({
      type: 'text',
      text: `Ты — система распознавания для склада кинопроизводства. Передано ${images.length} фото одного предмета.

Если фото несколько — фото 0 основное (общее представление о предмете), последующие фото — источник ДОПОЛНИТЕЛЬНЫХ деталей. На них смотри только то, чего не видно на предыдущих кадрах: новые цвета/материалы/фактуру, ярлыки, серийники, маркировки, надписи, повреждения, скрытые ракурсы (низ, задник, замки, застёжки), комплектующие.

Категорически нельзя:
— писать «это тот же предмет», «другой ракурс», «не добавляет информации», «также виден»;
— добавлять фразы-наполнители.

При сомнении в эпохе — пиши «Современное».
Имя — короткое, 1-5 слов, без пояснений в скобках.
Описание — 2-4 предложения, фактологически: что это, цвет, материал, состояние, видимые детали.

Вызови инструмент fill_unit_card с заполненными полями.`,
    })

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 2048,
      temperature: 0,
      tools: [{
        name: 'fill_unit_card',
        description: 'Заполнить карточку складской единицы по фото',
        input_schema: {
          type: 'object',
          properties: {
            name: {
              type: 'string',
              description: 'Краткое название по-русски, 1-5 слов. Без пояснений в скобках.',
            },
            category: {
              type: 'string',
              enum: RECOGNIZE_CATEGORIES,
              description: 'Складская категория. Костюмы и одежда → costumes; обувь → shoes; ремни/сумки/часы/головные уборы → accessories; украшения → jewelry; крупная мебель → furniture; декорации сцены → scenery; малый декор → decor; бутафория (муляжи) → dummy; реквизит общего назначения → props; техника (электроника, инструменты) → tech; автомобили → auto; еда → food; напитки → drinks; художественное наполнение интерьера → art_fill; ничего не подходит → other.',
            },
            period: {
              type: 'string',
              description: 'Эпоха предмета. Используй один из вариантов: Современное | 2000-е | 1990-е | 1980-е | Советское (1970-е) | Советское (1960-е) | 1950-е | 1940-е | Военное время | Дореволюционное | XIX век | XVIII век | Средневековье | Античность. Если из фото не очевидно — Современное.',
            },
            description: {
              type: 'string',
              description: '2-4 предложения. Цвет, материал, состояние, видимые детали (надписи, ярлыки, серийники, повреждения, фурнитура, аксессуары). Без фраз-наполнителей.',
            },
          },
          required: ['name', 'category', 'period', 'description'],
        },
      }],
      tool_choice: { type: 'tool', name: 'fill_unit_card' },
      messages: [{ role: 'user', content }],
    })

    const toolUse = response.content.find(b => b.type === 'tool_use')
    if (!toolUse?.input) {
      return res.status(500).json({ error: 'AI вернул некорректный ответ, повторите попытку' })
    }
    const raw = toolUse.input

    // Серверная валидация. Schema enum уже отрабатывает на стороне модели,
    // но на бэке подстраховываемся: category из whitelist (иначе null —
    // фронт оставит дефолтную категорию формы), name/description обрезаются.
    const result = {
      name: typeof raw.name === 'string' ? raw.name.trim().slice(0, 200) : '',
      category: RECOGNIZE_CATEGORIES.includes(raw.category) ? raw.category : null,
      period: typeof raw.period === 'string' ? raw.period.trim().slice(0, 80) : '',
      description: typeof raw.description === 'string' ? raw.description.trim().slice(0, 1000) : '',
    }

    res.json({ ...result, same_item: true, outlier_indices: [] })
  } catch (err) {
    console.error('Photo recognition error:', {
      status: err?.status,
      name: err?.name,
      message: redact(err?.message),
    })
    res.status(500).json({ error: 'Не удалось распознать фото' })
  }
})

// POST /units — add unit (auto-accepted, status=on_stock immediately).
// Утверждение приёма отключено: ревизию и пополнение делают директор/зам склада
// напрямую, поэтому любая добавленная единица сразу числится на складе.
router.post('/', verifyJWT, async (req, res) => {
  const { name, category, serial, warehouse_id, cell_id, description, qty, condition, valuation, source, dimensions, period } = req.body
  if (!name || !category) return res.status(400).json({ error: 'Missing required fields' })
  if (req.body?.is_admin_stock) return res.status(400).json({ error: 'Use /admin-units for admin stock' })

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
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'on_stock',$12) RETURNING *`,
      [name, category, inventorySerial, warehouse_id || null, cell_id || null,
       description || null, qty || 1, condition || null, valuation || null,
       source || null, dimensions || null, period || null]
    )
    const unit = rows[0]

    // Log
    await db.query(
      `INSERT INTO unit_history (unit_id, action, user_id) VALUES ($1, 'Добавлено', $2)`,
      [unit.id, req.user.id]
    )

    // Enqueue AI tag generation (async, non-blocking)
    if (process.env.ANTHROPIC_API_KEY) {
      db.query(
        `INSERT INTO ai_tasks (unit_id, task_type, params) VALUES ($1, 'generate_unit_tags', $2)`,
        [unit.id, JSON.stringify({ name: unit.name, category: unit.category })]
      ).catch(e => console.error('[AI-TAGS] Failed to enqueue:', e.message))
    }

    // Пуши — директору и заму. Не блокируют ответ.
    notifyNewUnit(unit).catch(e => console.error('notifyNewUnit:', e.message))
    if (!unit.cell_id) {
      notifyNoCellIfThresholdCrossed().catch(e => console.error('notifyNoCellIfThresholdCrossed:', e.message))
    }

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
      `SELECT u.*, w.name AS warehouse_name, w.address AS warehouse_address,
              c.code AS cell_code, c.custom_name AS cell_custom,
              sec.id AS section_id, sec.name AS section_name, sec.type AS section_type,
              hall.id AS hall_id, hall.name AS hall_name,
              pav.name AS pavilion_name
       FROM units u
       LEFT JOIN warehouses w ON w.id = u.warehouse_id
       LEFT JOIN cells c ON c.id = u.cell_id
       LEFT JOIN warehouse_sections sec ON sec.id = c.section_id
       LEFT JOIN warehouse_sections hall ON hall.id = sec.parent_section_id AND hall.type = 'hall'
       LEFT JOIN decorations pav ON pav.id = u.pavilion_id AND pav.type = 'pavilion'
       WHERE u.id = $1`,
      [req.params.id]
    )
    if (!rows.length) return res.status(404).json({ error: 'Unit not found' })

    const unit = rows[0]
    if (unit.is_admin_stock && !canAccessAdminStock(req.user)) {
      return res.status(404).json({ error: 'Unit not found' })
    }
    // GET /units/:id отдаём всем — из списков единицы и так отфильтрованы;
    // прямой доступ нужен для открытия карточки из долгов/списаний, которые
    // привязаны к проекту пользователя.
    delete unit.search_tags
    delete unit.search_vector
    if (canSeeMissingUnitData(req.user.role)) {
      unit.missing_fields = unitMissingFields(unit)
    }

    // Photos — только исходные (stock). Фото выдачи/возврата показываются
    // в своих записях истории, а не в галерее карточки.
    const { rows: photos } = await db.query(
      `SELECT * FROM unit_photos WHERE unit_id = $1 AND type = 'stock' ORDER BY created_at`, [unit.id]
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

    // Активный pending-запрос на заём от другого проекта (если есть).
    // Факт нужен всем для «Запрошено», детали — только владельцу, запросчику и складу.
    const canSeePendingRequestDetails =
      PENDING_REQUEST_DETAIL_ROLES.has(req.user.role) ||
      (unit.project_id && req.user.project_id && String(unit.project_id) === String(req.user.project_id))
    const { rows: plr } = await db.query(
      `SELECT plr.id,
              CASE WHEN $3::boolean OR plr.to_project_id = $2::uuid THEN plr.to_project_id ELSE NULL END AS to_project_id,
              CASE WHEN $3::boolean OR plr.to_project_id = $2::uuid THEN plr.created_at ELSE NULL END AS created_at,
              CASE WHEN $3::boolean OR plr.to_project_id = $2::uuid THEN plr.deadline ELSE NULL END AS deadline,
              CASE WHEN $3::boolean OR plr.to_project_id = $2::uuid THEN tp.name ELSE NULL END AS to_project_name,
              CASE WHEN $3::boolean OR plr.to_project_id = $2::uuid THEN ru.name ELSE NULL END AS requested_by_name
       FROM project_loan_requests plr
       JOIN projects tp ON tp.id = plr.to_project_id
       JOIN users ru ON ru.id = plr.requested_by
       WHERE plr.unit_id = $1 AND plr.status = 'pending'
       ORDER BY plr.created_at DESC LIMIT 1`,
      [unit.id, req.user.project_id || null, canSeePendingRequestDetails]
    )
    unit.pending_loan_request = plr[0] || null

    res.json({ unit })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Server error' })
  }
})

// GET /units/:id/history — записи о движении единицы: добавление, выдачи, возвраты и т.д.
// Возвращает: user_name, project_name (кто взял/отдал), photos (фото выдачи/возврата).
router.get('/:id/history', verifyJWT, async (req, res) => {
  try {
    const { rows } = await db.query(
      `SELECT h.id, h.unit_id, h.action, h.notes, h.created_at,
              h.issuance_id, h.return_id, h.rent_deal_id,
              u.name AS user_name, u.role AS user_role,
              rcv.name AS receiver_name, rcv.role AS receiver_role,
              COALESCE(
                p.name,
                CASE
                  WHEN h.action LIKE 'Выдано по заявке другого проекта%' THEN loan_ctx.to_project_name
                  WHEN h.action LIKE 'Возвращено на склад проекта-владельца%' THEN loan_ctx.from_project_name
                  ELSE NULL
                END,
                ip.name,
                rd.counterparty_name
              ) AS project_name,
              COALESCE(
                (SELECT json_agg(json_build_object('id', ph.id, 'url', ph.url, 'type', ph.type) ORDER BY ph.created_at)
                 FROM unit_photos ph
                 WHERE ph.unit_id = h.unit_id
                   AND (
                     (h.issuance_id IS NOT NULL AND ph.issuance_id = h.issuance_id AND ph.type = 'issue') OR
                     (h.return_id IS NOT NULL AND ph.return_id = h.return_id AND ph.type = 'return') OR
                     (h.rent_deal_id IS NOT NULL AND ph.rent_deal_id = h.rent_deal_id)
                   )
                ),
                '[]'::json
              ) AS photos
       FROM unit_history h
       LEFT JOIN users u ON u.id = h.user_id
       LEFT JOIN projects p ON p.id = h.project_id
       LEFT JOIN returns ret ON ret.id = h.return_id
       LEFT JOIN issuances iss ON iss.id = COALESCE(h.issuance_id, ret.issuance_id)
       LEFT JOIN users rcv ON rcv.id = iss.received_by
       LEFT JOIN projects ip ON ip.id = rcv.project_id
       LEFT JOIN rent_deals rd ON rd.id = h.rent_deal_id
       LEFT JOIN LATERAL (
         SELECT fp.name AS from_project_name, tp.name AS to_project_name
         FROM project_loan_requests plr
         JOIN projects fp ON fp.id = plr.from_project_id
         JOIN projects tp ON tp.id = plr.to_project_id
         WHERE plr.unit_id = h.unit_id
           AND (
             (h.action LIKE 'Выдано по заявке другого проекта%' AND plr.decided_at IS NOT NULL)
             OR (h.action LIKE 'Возвращено на склад проекта-владельца%' AND plr.returned_at IS NOT NULL)
           )
         ORDER BY ABS(EXTRACT(EPOCH FROM (COALESCE(plr.returned_at, plr.decided_at, plr.created_at) - h.created_at))) ASC
         LIMIT 1
       ) loan_ctx ON true
       WHERE h.unit_id = $1
       ORDER BY h.created_at DESC`,
      [req.params.id]
    )
    res.json({ history: rows })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Server error' })
  }
})

// PUT /units/:id — edit unit immediately (approvals removed, see units POST comment).
router.put('/:id', verifyJWT, async (req, res) => {
  try {
    const { rows } = await db.query(`SELECT * FROM units WHERE id = $1`, [req.params.id])
    if (!rows.length) return res.status(404).json({ error: 'Unit not found' })

    const { name, category, serial, warehouse_id, cell_id, pavilion_id, description, qty, condition, valuation, materials, period, dimensions, source } = req.body
    const current = rows[0]
    if (current.is_admin_stock && !canAccessAdminStock(req.user)) {
      return res.status(403).json({ error: 'Forbidden' })
    }
    const has = (key) => Object.prototype.hasOwnProperty.call(req.body, key)
    const keep = (key, value) => has(key) ? (value === '' ? null : value) : current[key]

    // A unit is either on a warehouse cell OR inside a pavilion — never both.
    const movingToPavilion = has('pavilion_id') && pavilion_id !== null && pavilion_id !== ''
    const effectiveWarehouseId = movingToPavilion
      ? null
      : has('warehouse_id') ? (warehouse_id || null) : current.warehouse_id
    const effectiveCellId = movingToPavilion
      ? null
      : has('cell_id') ? (cell_id || null) : current.cell_id
    const effectivePavilionId = has('pavilion_id')
      ? (movingToPavilion ? pavilion_id : null)
      : ((has('warehouse_id') || has('cell_id')) ? null : current.pavilion_id)

    // Перемещения разрешены только для on_stock. Без проверки выданную единицу
    // (включая walk-in со status='issued') можно было «припарковать» в ячейке —
    // в карточке выдачи виден как «выдан», физически — на полке. Списанные/
    // долговые тоже не должны перемещаться.
    const locationChanged =
      effectiveCellId !== (current.cell_id || null) ||
      (effectiveWarehouseId !== (current.warehouse_id || null)) ||
      effectivePavilionId !== (current.pavilion_id || null)
    if (locationChanged && current.status !== 'on_stock') {
      const reasonMap = {
        issued:      'выдана',
        overdue:     'просрочена',
        debt:        'в долге',
        written_off: 'списана',
        pending:     'ждёт согласования',
      }
      const reason = reasonMap[current.status] || `в статусе ${current.status}`
      return res.status(400).json({ error: `Единицу нельзя перемещать — она ${reason}. Сначала верните на склад.` })
    }

    // Validate cell-move against matrix (only when actually moving to a cell, not to pavilion).
    if (effectiveCellId && effectiveCellId !== current.cell_id) {
      const check = await validateCellMove(current, effectiveCellId)
      if (!check.ok) return res.status(400).json({ error: check.error })
    }

    const params = [
      keep('name', name),
      keep('category', category),
      keep('serial', serial),
      effectiveWarehouseId,
      effectiveCellId,
      effectivePavilionId,
      keep('description', description),
      keep('qty', qty),
      keep('condition', condition),
      keep('valuation', valuation),
      keep('materials', materials),
      keep('period', period),
      keep('dimensions', dimensions),
      keep('source', source),
      req.params.id,
    ]
    const { rows: updated } = await db.query(
      `UPDATE units SET name=$1,category=$2,serial=$3,warehouse_id=$4,cell_id=$5,pavilion_id=$6,
       description=$7,qty=$8,condition=$9,valuation=$10,materials=$11,period=$12,
       dimensions=$13,source=$14
       WHERE id=$15 RETURNING *`,
      params
    )
    const action = movingToPavilion ? 'Перемещено в павильон'
                 : (current.pavilion_id && !movingToPavilion) ? 'Возвращено из павильона'
                 : 'Изменено'
    await db.query(
      `INSERT INTO unit_history (unit_id, action, user_id) VALUES ($1,$2,$3)`,
      [req.params.id, action, req.user.id]
    )

    // Если cell_id поменялся (освободилось или занято место) — проверить порог.
    if ((current.cell_id || null) !== (effectiveCellId || null)) {
      notifyNoCellIfThresholdCrossed().catch(e => console.error('notifyNoCellIfThresholdCrossed:', e.message))
    }

    res.json({ unit: updated[0] })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Server error' })
  }
})

// POST /units/:id/approve
router.post('/:id/approve', verifyJWT, checkRole('warehouse_director', 'warehouse_deputy'), async (req, res) => {
  const { approval_id, valuation, cell_id, warehouse_id } = req.body
  try {
    const { rows } = await db.query(
      `SELECT * FROM approvals WHERE id = $1 AND unit_id = $2 AND status = 'pending'`,
      [approval_id, req.params.id]
    )
    if (!rows.length) return res.status(404).json({ error: 'Approval not found' })
    const approval = rows[0]

    if (approval.action === 'add') {
      if (valuation == null || valuation === '') return res.status(400).json({ error: 'Укажите стоимость единицы' })
      if (cell_id) {
        const { rows: [unitRow] } = await db.query(`SELECT id, cell_id, pavilion_id, category FROM units WHERE id = $1`, [req.params.id])
        if (unitRow) {
          const check = await validateCellMove(unitRow, cell_id)
          if (!check.ok) return res.status(400).json({ error: check.error })
        }
      }
      await db.query(
        `UPDATE units
           SET status = 'on_stock',
               valuation = $2,
               cell_id = COALESCE($3, cell_id),
               warehouse_id = COALESCE($4, warehouse_id)
         WHERE id = $1`,
        [req.params.id, valuation, cell_id || null, warehouse_id || null]
      )
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

// POST /units/:id/mark-missing — отметить единицу как «нет в наличии» (пересорт).
// Флаг misplaced=true, статус unit не меняем. При выдаче запросе используется,
// когда единицы не нашлось на полке. Запись в unit_history для аудита.
router.post('/:id/mark-missing', verifyJWT, checkRole('warehouse_director', 'warehouse_deputy', 'warehouse_staff'), async (req, res) => {
  const { reason } = req.body
  try {
    const { rows } = await db.query(
      `UPDATE units SET misplaced=true WHERE id=$1 RETURNING *`,
      [req.params.id]
    )
    if (!rows.length) return res.status(404).json({ error: 'Unit not found' })
    await db.query(
      `INSERT INTO unit_history (unit_id, action, user_id, notes) VALUES ($1,'Пересорт — нет в наличии',$2,$3)`,
      [req.params.id, req.user.id, (reason || '').slice(0, 500) || null]
    )
    res.json({ unit: rows[0] })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Server error' })
  }
})

// POST /units/:id/resolve-missing — вернуть единицу из пересорта («нашли»).
router.post('/:id/resolve-missing', verifyJWT, checkRole('warehouse_director', 'warehouse_deputy', 'warehouse_staff'), async (req, res) => {
  try {
    const { rows } = await db.query(
      `UPDATE units SET misplaced=false WHERE id=$1 RETURNING *`,
      [req.params.id]
    )
    if (!rows.length) return res.status(404).json({ error: 'Unit not found' })
    await db.query(
      `INSERT INTO unit_history (unit_id, action, user_id) VALUES ($1,'Пересорт — нашли',$2)`,
      [req.params.id, req.user.id]
    )
    res.json({ unit: rows[0] })
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
    const { rows: targetRows } = await db.query(
      `SELECT id, is_admin_stock FROM units WHERE id = $1`,
      [req.params.id]
    )
    if (!targetRows.length) return res.status(404).json({ error: 'Unit not found' })
    if (targetRows[0].is_admin_stock && !canAccessAdminStock(req.user)) {
      return res.status(403).json({ error: 'Forbidden' })
    }

    const urls = []
    for (const file of req.files) {
      const isVideo = /^video\//.test(file.mimetype)
      let url, thumbUrl = null
      if (isVideo) {
        url = await uploadFile(file.buffer, file.originalname, 'units')
      } else {
        ({ url, thumbUrl } = await uploadImageWithThumb(file.buffer, file.originalname, 'units'))
      }
      const { rows } = await db.query(
        `INSERT INTO unit_photos (unit_id, url, thumb_url, type) VALUES ($1,$2,$3,$4) RETURNING *`,
        [req.params.id, url, thumbUrl, type]
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

// POST /units/backfill-tags — enqueue AI tag generation for all units without tags
router.post('/backfill-tags', verifyJWT, checkRole('warehouse_director', 'warehouse_deputy', 'producer'), async (req, res) => {
  try {
    const { rows } = await db.query(
      `SELECT id, name, category FROM units WHERE search_tags = '{}' OR search_tags IS NULL`
    )
    if (!rows.length) return res.json({ message: 'All units already have tags', count: 0 })

    let enqueued = 0
    for (const unit of rows) {
      await db.query(
        `INSERT INTO ai_tasks (unit_id, task_type, params) VALUES ($1, 'generate_unit_tags', $2)`,
        [unit.id, JSON.stringify({ name: unit.name, category: unit.category })]
      )
      enqueued++
    }
    res.json({ message: `Enqueued ${enqueued} units for tag generation`, count: enqueued })
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
    for (const id of ids) {
      await client.query(`UPDATE requests   SET unit_ids = array_remove(unit_ids, $1::uuid) WHERE $1::uuid = ANY(unit_ids)`, [id])
      await client.query(`UPDATE rent_deals SET unit_ids = array_remove(unit_ids, $1::uuid) WHERE $1::uuid = ANY(unit_ids)`, [id])
    }
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
// Большинство дочерних таблиц имеют ON DELETE CASCADE, но requests/issuances/
// rent_deals хранят unit_id внутри UUID[] arrays без FK — это не блокирует
// удаление, но и не чистится автоматически. Тут мы:
//   1) удаляем сам ряд (CASCADE убирает связанные)
//   2) чистим R2-фото по url'ам
//   3) убираем id из всех unit_ids массивов чтобы не висели stale ссылки
router.delete('/:id', verifyJWT, async (req, res) => {
  const id = req.params.id
  const client = await db.getClient()
  try {
    await client.query('BEGIN')
    const { rows } = await client.query(`SELECT * FROM units WHERE id = $1`, [id])
    if (!rows.length) {
      await client.query('ROLLBACK')
      return res.status(404).json({ error: 'Unit not found' })
    }
    const unit = rows[0]
    const canDeleteRegularUnit = DIRECTOR_ROLES.includes(req.user.role)
    const canDeleteAdminUnit = unit.is_admin_stock && canAccessAdminStock(req.user)
    if (!canDeleteRegularUnit && !canDeleteAdminUnit) {
      await client.query('ROLLBACK')
      return res.status(403).json({ error: 'Forbidden' })
    }

    // Собираем url-ы фото ДО удаления (CASCADE удалит unit_photos автоматически).
    const { rows: photos } = await client.query(
      `SELECT url FROM unit_photos WHERE unit_id = $1`, [id]
    )

    // Чистим stale-ссылки в UUID[] массивах. ARRAY_REMOVE безопасен (no-op
    // если id нет в массиве). Делаем это до DELETE FROM units чтобы не
    // оставлять призрачные UUIDs в актуальных запросах.
    await client.query(`UPDATE requests   SET unit_ids = array_remove(unit_ids, $1::uuid) WHERE $1::uuid = ANY(unit_ids)`, [id])
    await client.query(`UPDATE rent_deals SET unit_ids = array_remove(unit_ids, $1::uuid) WHERE $1::uuid = ANY(unit_ids)`, [id])

    // Сам ряд — CASCADE снимет debts/approvals/unit_history/unit_photos/
    // decoration_units/handovers(SET NULL)/ai_tasks/project_loan_requests/
    // warehouse_return_requests/writeoffs/issuances.
    const { rowCount } = await client.query(`DELETE FROM units WHERE id = $1`, [id])
    await client.query('COMMIT')

    // R2 чистим ПОСЛЕ commit — если файла нет, не должны откатывать БД.
    for (const p of photos) {
      try { await deleteFile(p.url) } catch { /* stale url, swallow */ }
    }

    res.json({ ok: true, deleted: rowCount })
  } catch (err) {
    try { await client.query('ROLLBACK') } catch { /* */ }
    console.error('DELETE /units/:id failed:', err.code, err.message, err.detail)
    res.status(500).json({ error: err.message || 'Server error', detail: err.detail })
  } finally {
    client.release()
  }
})

// DELETE /units/:id/photos/:photoId
router.delete('/:id/photos/:photoId', verifyJWT, async (req, res) => {
  try {
    const { rows } = await db.query(
      `SELECT p.*, u.is_admin_stock
       FROM unit_photos p
       JOIN units u ON u.id = p.unit_id
       WHERE p.id = $1 AND p.unit_id = $2`,
      [req.params.photoId, req.params.id]
    )
    if (!rows.length) return res.status(404).json({ error: 'Photo not found' })

    const photo = rows[0]
    if (photo.is_admin_stock && !canAccessAdminStock(req.user)) {
      return res.status(403).json({ error: 'Forbidden' })
    }
    // Сначала удаляем запись из БД — даже если в S3 файла нет (regen-bg
    // оставил мёртвую ссылку, или ручная чистка), запись не должна торчать
    // и портить галерею пустым thumbnail. S3-чистка best-effort.
    await db.query(`DELETE FROM unit_photos WHERE id = $1`, [photo.id])
    try {
      await deleteFile(photo.url)
    } catch (e) {
      console.warn(`S3 deleteFile failed for ${photo.url}:`, e?.message || e)
    }
    if (photo.thumb_url) {
      try {
        await deleteFile(photo.thumb_url)
      } catch (e) {
        console.warn(`S3 deleteFile failed for thumb ${photo.thumb_url}:`, e?.message || e)
      }
    }

    res.json({ ok: true })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Server error' })
  }
})

// GET /units/remove-bg/warm — будит rembg-sidecar (cold-start ~10-15с).
// Дёргается клиентом при открытии модалки добавления / тоггле «белый фон»,
// чтобы к моменту реального submit'а sidecar уже был warm. Не блокирующий:
// фронт его не ждёт. Возвращает {ok, ms} либо {ok:false} если sidecar лёг.
router.get('/remove-bg/warm', verifyJWT, async (_req, res) => {
  const url = process.env.REMBG_URL
  if (!url) return res.status(500).json({ error: 'sidecar_not_configured' })
  const t0 = Date.now()
  try {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), 30_000)
    const r = await fetch(url.replace(/\/+$/, '') + '/warm', { signal: ctrl.signal })
    clearTimeout(timer)
    res.json({ ok: r.ok, ms: Date.now() - t0 })
  } catch (err) {
    res.json({ ok: false, ms: Date.now() - t0, detail: String(err?.message || err).slice(0, 100) })
  }
})

// POST /units/remove-bg — проксирует фото в rembg-sidecar и возвращает JPEG
// с белым фоном. Использует env REMBG_URL и REMBG_SECRET. Любая роль —
// доступно всем кто авторизован (не только директор), потому что фича
// нужна и при добавлении единицы рядовому юзеру.
router.post('/remove-bg', verifyJWT, upload.single('photo'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'no_photo' })
  const url = process.env.REMBG_URL
  const secret = process.env.REMBG_SECRET
  if (!url || !secret) return res.status(500).json({ error: 'sidecar_not_configured' })
  try {
    const fd = new FormData()
    fd.append('photo', new Blob([req.file.buffer], { type: req.file.mimetype || 'image/jpeg' }), req.file.originalname || 'photo.jpg')
    // Секрет идёт form-полем, а не header'ом — Yandex SC ingress режет
    // кастомные X-*-headers. Form-field гарантированно доходит.
    fd.append('secret', secret)
    // Опциональный выбор модели: ?model=u2net|silueta|isnet-general-use.
    // Если фронт не передал — sidecar возьмёт дефолтную (isnet). Это даёт
    // обратную совместимость для prod (xproduction:v1.13 параметр не шлёт →
    // ровно текущее поведение).
    const requestedModel = String(req.query.model || '').trim()
    if (requestedModel) fd.append('model', requestedModel)
    // Cold-start sidecar до 15с (модель прогружается). 90с retry-bound.
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), 90_000)
    const r = await fetch(url, {
      method: 'POST',
      body: fd,
      signal: ctrl.signal,
    })
    clearTimeout(timer)
    if (!r.ok) {
      const errText = await r.text().catch(() => '')
      return res.status(502).json({ error: 'sidecar_failed', status: r.status, detail: errText.slice(0, 200) })
    }
    const buf = Buffer.from(await r.arrayBuffer())
    // Пробрасываем диагностику из sidecar (видно в DevTools при отладке):
    // - `X-Bg-Model-Used` (v1.8+) — фактически использованная модель
    // - `X-Bg-Skipped` / `X-Bg-Mean-Alpha` / `X-Bg-Matting-Used` — для совместимости
    //   с ранее задеплоенными версиями sidecar (фронт их сейчас не использует)
    res.set('Content-Type', 'image/jpeg').set('Cache-Control', 'no-store')
    const exposed = []
    for (const h of ['x-bg-model-used', 'x-bg-skipped', 'x-bg-mean-alpha', 'x-bg-matting-used']) {
      const v = r.headers.get(h)
      if (v) {
        res.set(h, v)
        exposed.push(h)
      }
    }
    if (exposed.length) res.set('Access-Control-Expose-Headers', exposed.join(', '))
    res.send(buf)
  } catch (err) {
    res.status(500).json({ error: 'remove_bg_error', detail: String(err?.message || err).slice(0, 200) })
  }
})

// POST /units/:unitId/photos/:photoId/regen-bg — обелить фон у одного
// существующего фото. Скачивает оригинал, прогоняет через rembg-sidecar
// (model=u2net), загружает результат под новым S3-ключом, UPDATE-ит url.
// Старый S3-файл остаётся (backup). Доступ — любая складская роль.
router.post('/:unitId/photos/:photoId/regen-bg', verifyJWT, checkRole('warehouse_director', 'warehouse_deputy', 'warehouse_staff'), async (req, res) => {
  const sidecarUrl = process.env.REMBG_URL
  const sidecarSecret = process.env.REMBG_SECRET
  if (!sidecarUrl || !sidecarSecret) return res.status(500).json({ error: 'sidecar_not_configured' })

  const model = typeof req.body?.model === 'string' && req.body.model.trim() ? req.body.model.trim() : 'u2net'

  const { rows } = await db.query(
    `SELECT p.id, p.url FROM unit_photos p
       JOIN units u ON u.id = p.unit_id
      WHERE p.id = $1 AND u.id = $2`,
    [req.params.photoId, req.params.unitId]
  )
  if (!rows.length) return res.status(404).json({ error: 'photo_not_found' })
  const photo = rows[0]

  try {
    const dl = await fetch(photo.url)
    if (!dl.ok) throw new Error(`download_${dl.status}`)
    const origBuf = Buffer.from(await dl.arrayBuffer())

    const fd = new FormData()
    fd.append('photo', new Blob([origBuf], { type: 'image/jpeg' }), 'photo.jpg')
    fd.append('secret', sidecarSecret)
    fd.append('model', model)
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), 90_000)
    let r
    try {
      r = await fetch(sidecarUrl, { method: 'POST', body: fd, signal: ctrl.signal })
    } finally {
      clearTimeout(timer)
    }
    if (!r.ok) {
      const t = await r.text().catch(() => '')
      return res.status(502).json({ error: 'sidecar_failed', status: r.status, detail: t.slice(0, 100) })
    }
    const newBuf = Buffer.from(await r.arrayBuffer())

    const newName = (photo.url.split('/').pop() || 'photo.jpg').replace(/\.[^.]+$/, '') + '_white.jpg'
    const newUrl = await uploadFile(newBuf, newName, 'units')
    const newThumbUrl = await makeThumbFromBuffer(newBuf, newName, 'units')
    await db.query('UPDATE unit_photos SET url = $1, thumb_url = $2 WHERE id = $3', [newUrl, newThumbUrl, photo.id])

    res.json({ ok: true, photo_id: photo.id, url: newUrl, thumb_url: newThumbUrl, model })
  } catch (err) {
    res.status(500).json({ error: 'regen_failed', detail: String(err?.message || err).slice(0, 200) })
  }
})

// POST /units/bulk-regen-bg — обелить фон у выбранных единиц (массово из
// каталога). Принимает `{ ids: string[], model?, force? }`. По умолчанию
// идёт по всем `unit_photos.type='stock'` указанных единиц, пропуская уже
// обработанные (URL содержит `_white`). force=true — переобрабатывать всё.
// Доступ: warehouse_director / warehouse_deputy.
router.post('/bulk-regen-bg', verifyJWT, checkRole('warehouse_director', 'warehouse_deputy'), async (req, res) => {
  const url = process.env.REMBG_URL
  const secret = process.env.REMBG_SECRET
  if (!url || !secret) return res.status(500).json({ error: 'sidecar_not_configured' })

  const ids = Array.isArray(req.body?.ids) ? req.body.ids.filter(x => typeof x === 'string' && x.length) : []
  if (!ids.length) return res.status(400).json({ error: 'ids_required' })
  const model = typeof req.body?.model === 'string' && req.body.model.trim() ? req.body.model.trim() : 'u2net'
  const force = req.body?.force === true

  const where = force
    ? `p.type = 'stock' AND p.unit_id = ANY($1)`
    : `p.type = 'stock' AND p.unit_id = ANY($1) AND p.url NOT LIKE '%_white%'`
  const { rows: photos } = await db.query(`
    SELECT p.id, p.url, p.unit_id, u.name AS unit_name
      FROM unit_photos p
      JOIN units u ON u.id = p.unit_id
     WHERE ${where}
     ORDER BY u.created_at, p.created_at
     LIMIT 200
  `, [ids])

  const failed = []
  let ok = 0
  for (const p of photos) {
    const t0 = Date.now()
    try {
      const dl = await fetch(p.url)
      if (!dl.ok) throw new Error(`download_${dl.status}`)
      const origBuf = Buffer.from(await dl.arrayBuffer())

      const fd = new FormData()
      fd.append('photo', new Blob([origBuf], { type: 'image/jpeg' }), 'photo.jpg')
      fd.append('secret', secret)
      fd.append('model', model)
      const ctrl = new AbortController()
      const timer = setTimeout(() => ctrl.abort(), 90_000)
      const r = await fetch(url, { method: 'POST', body: fd, signal: ctrl.signal })
      clearTimeout(timer)
      if (!r.ok) {
        const t = await r.text().catch(() => '')
        throw new Error(`sidecar_${r.status}: ${t.slice(0, 100)}`)
      }
      const newBuf = Buffer.from(await r.arrayBuffer())

      const newName = (p.url.split('/').pop() || 'photo.jpg').replace(/\.[^.]+$/, '') + '_white.jpg'
      const newUrl = await uploadFile(newBuf, newName, 'units')
      const newThumbUrl = await makeThumbFromBuffer(newBuf, newName, 'units')
      await db.query('UPDATE unit_photos SET url = $1, thumb_url = $2 WHERE id = $3', [newUrl, newThumbUrl, p.id])
      ok++
      console.log(`[bulk-regen-bg] ${p.id} unit="${p.unit_name}" → ${newUrl} (${Date.now() - t0}ms)`)
    } catch (err) {
      const msg = String(err?.message || err).slice(0, 200)
      failed.push({ id: p.id, unit: p.unit_name, url: p.url, error: msg })
      console.error(`[bulk-regen-bg] FAILED ${p.id}: ${msg}`)
    }
  }
  res.json({ total: photos.length, ok, failed: failed.length, model, errors: failed })
})

// POST /units/admin/regen-bg — backfill белого фона на всех существующих
// `unit_photos.type='stock'`. На каждое фото:
//   1) скачиваем оригинал из S3 (через fetch на public URL — он же в БД);
//   2) шлём в rembg-sidecar (REMBG_URL + form-field secret + опционально model);
//   3) загружаем результат под НОВЫМ ключом (suffix `_white`);
//   4) UPDATE unit_photos.url на новый URL.
//
// Старые S3-файлы НЕ удаляются — остаются как backup. Откат: ручной UPDATE
// на старый URL. По умолчанию пропускаем фото, у которых url содержит `_white`
// — повторный запуск идемпотентен. Параметры body:
//   { dry_run?: bool, limit?: number, model?: string, force?: bool }
// Доступ: warehouse_director.
router.post('/admin/regen-bg', verifyJWT, checkRole('warehouse_director'), async (req, res) => {
  const url = process.env.REMBG_URL
  const secret = process.env.REMBG_SECRET
  if (!url || !secret) return res.status(500).json({ error: 'sidecar_not_configured' })

  const dryRun = req.body?.dry_run === true
  const force = req.body?.force === true
  const limit = Number.isInteger(req.body?.limit) && req.body.limit > 0 ? req.body.limit : 200
  const model = typeof req.body?.model === 'string' && req.body.model.trim() ? req.body.model.trim() : 'u2net'

  const where = force ? `p.type = 'stock'` : `p.type = 'stock' AND p.url NOT LIKE '%_white%'`
  const { rows: photos } = await db.query(`
    SELECT p.id, p.url, p.unit_id, u.name AS unit_name
      FROM unit_photos p
      JOIN units u ON u.id = p.unit_id
     WHERE ${where}
     ORDER BY u.created_at, p.created_at
     LIMIT $1
  `, [limit])

  if (dryRun) {
    return res.json({
      dry_run: true,
      total: photos.length,
      model,
      photos: photos.map(p => ({ id: p.id, unit: p.unit_name, url: p.url })),
    })
  }

  const failed = []
  let ok = 0
  for (const p of photos) {
    const t0 = Date.now()
    try {
      // Скачиваем оригинал. Public S3 URL отдаётся напрямую — без auth.
      const dl = await fetch(p.url)
      if (!dl.ok) throw new Error(`download_${dl.status}`)
      const origBuf = Buffer.from(await dl.arrayBuffer())

      // Отправляем в sidecar
      const fd = new FormData()
      fd.append('photo', new Blob([origBuf], { type: 'image/jpeg' }), 'photo.jpg')
      fd.append('secret', secret)
      fd.append('model', model)
      const ctrl = new AbortController()
      const timer = setTimeout(() => ctrl.abort(), 90_000)
      const r = await fetch(url, { method: 'POST', body: fd, signal: ctrl.signal })
      clearTimeout(timer)
      if (!r.ok) {
        const t = await r.text().catch(() => '')
        throw new Error(`sidecar_${r.status}: ${t.slice(0, 100)}`)
      }
      const newBuf = Buffer.from(await r.arrayBuffer())

      // Загружаем под новым ключом — uploadFile сам сгенерит ключ. Старый
      // S3-файл по старому URL остаётся (можно использовать для отката).
      const newName = (p.url.split('/').pop() || 'photo.jpg').replace(/\.[^.]+$/, '') + '_white.jpg'
      const newUrl = await uploadFile(newBuf, newName, 'units')
      const newThumbUrl = await makeThumbFromBuffer(newBuf, newName, 'units')
      await db.query('UPDATE unit_photos SET url = $1, thumb_url = $2 WHERE id = $3', [newUrl, newThumbUrl, p.id])
      ok++
      console.log(`[regen-bg] ${p.id} unit="${p.unit_name}" → ${newUrl} (${Date.now() - t0}ms)`)
    } catch (err) {
      const msg = String(err?.message || err).slice(0, 200)
      failed.push({ id: p.id, unit: p.unit_name, url: p.url, error: msg })
      console.error(`[regen-bg] FAILED ${p.id}: ${msg}`)
    }
  }
  res.json({ total: photos.length, ok, failed: failed.length, model, errors: failed })
})

// POST /units/admin/regen-thumbs — backfill thumb_url у существующих unit_photos.
// Для каждого фото без thumb_url: скачивает оригинал, генерит 400px JPEG через
// sharp, кладёт в S3 рядом, UPDATE-ит thumb_url. Видео (mp4/webm/mov) пропускает.
// Безопасен по-умолчанию (skip если thumb_url уже есть). Доступ: warehouse_director.
// Body: { dry_run?: bool, limit?: number, force?: bool }.
router.post('/admin/regen-thumbs', verifyJWT, checkRole('warehouse_director'), async (req, res) => {
  const dryRun = req.body?.dry_run === true
  const force = req.body?.force === true
  const limit = Number.isInteger(req.body?.limit) && req.body.limit > 0 ? req.body.limit : 500

  const where = force
    ? `url !~* '\\.(mp4|webm|mov)$'`
    : `thumb_url IS NULL AND url !~* '\\.(mp4|webm|mov)$'`
  const { rows: photos } = await db.query(`
    SELECT id, url, unit_id FROM unit_photos
     WHERE ${where}
     ORDER BY created_at
     LIMIT $1
  `, [limit])

  if (dryRun) {
    return res.json({ dry_run: true, total: photos.length })
  }

  const failed = []
  let ok = 0
  for (const p of photos) {
    const t0 = Date.now()
    try {
      const dl = await fetch(p.url)
      if (!dl.ok) throw new Error(`download_${dl.status}`)
      const buf = Buffer.from(await dl.arrayBuffer())
      const name = p.url.split('/').pop() || 'photo.jpg'
      const thumbUrl = await makeThumbFromBuffer(buf, name, 'units')
      if (!thumbUrl) throw new Error('thumb_generation_failed')
      await db.query('UPDATE unit_photos SET thumb_url = $1 WHERE id = $2', [thumbUrl, p.id])
      ok++
      console.log(`[regen-thumbs] ${p.id} → ${thumbUrl} (${Date.now() - t0}ms)`)
    } catch (err) {
      const msg = String(err?.message || err).slice(0, 200)
      failed.push({ id: p.id, url: p.url, error: msg })
      console.error(`[regen-thumbs] FAILED ${p.id}: ${msg}`)
    }
  }
  res.json({ total: photos.length, ok, failed: failed.length, errors: failed })
})

// POST /units/admin/regen-descriptions — одноразовый backfill: переписывает
// `description` (плюс `period`/`name` если пустые) у всех юнитов с фото,
// прогоняя их через тот же AI-промпт что и /recognize. Параметр scope в body:
// 'all' (по умолчанию) — все юниты с фото; 'empty' — только без description.
// Опциональный limit ограничивает кол-во. Возвращает { total, updated, failed }.
router.post('/admin/regen-descriptions', verifyJWT, checkRole('warehouse_director'), async (req, res) => {
  if (!process.env.ANTHROPIC_API_KEY) return res.status(500).json({ error: 'AI not configured' })

  const scope = req.body?.scope === 'empty' ? 'empty' : 'all'
  const limit = Number.isInteger(req.body?.limit) && req.body.limit > 0 ? req.body.limit : 100
  const dryRun = req.body?.dry_run === true
  const concurrency = 3

  const where = scope === 'empty'
    ? `(u.description IS NULL OR length(trim(u.description)) = 0)`
    : `TRUE`

  const { rows: units } = await db.query(`
    SELECT u.id, u.name, u.category, u.period, u.description
    FROM units u
    WHERE EXISTS (SELECT 1 FROM unit_photos WHERE unit_id = u.id AND type = 'stock')
      AND ${where}
    ORDER BY u.created_at
    LIMIT $1
  `, [limit])

  const results = { total: units.length, updated: 0, failed: [], samples: [] }

  async function regenOne(u) {
    const { rows: photos } = await db.query(
      `SELECT url FROM unit_photos WHERE unit_id = $1 AND type = 'stock' ORDER BY created_at LIMIT 5`,
      [u.id]
    )
    if (!photos.length) throw new Error('no_photos')

    const buffers = await Promise.all(photos.map(async (p) => {
      const r = await fetch(p.url)
      if (!r.ok) throw new Error(`download_${r.status}`)
      return Buffer.from(await r.arrayBuffer())
    }))

    const images = await Promise.all(buffers.map(async (buf) => {
      const resized = await sharp(buf)
        .rotate()
        .resize(1568, 1568, { fit: 'inside', withoutEnlargement: true })
        .jpeg({ quality: 85 })
        .toBuffer()
      return resized.toString('base64')
    }))

    const content = []
    images.forEach((data, idx) => {
      content.push({ type: 'text', text: `Фото ${idx}:` })
      content.push({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data } })
    })
    content.push({
      type: 'text',
      text: `Ты — система распознавания для склада кинопроизводства. Передано ${images.length} фото одного предмета.

Если фото несколько — фото 0 основное, последующие — источник дополнительных деталей.

Категорически нельзя:
— писать «это тот же предмет», «другой ракурс», «не добавляет информации», «также виден»;
— добавлять фразы-наполнители.

При сомнении в эпохе — пиши «Современное».
Имя — короткое, 1-5 слов, без пояснений в скобках.
Описание — 2-4 предложения, фактологически: цвет, материал, состояние, видимые детали.

Вызови инструмент fill_unit_card с заполненными полями.`,
    })

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 2048,
      temperature: 0,
      tools: [{
        name: 'fill_unit_card',
        description: 'Заполнить карточку складской единицы по фото',
        input_schema: {
          type: 'object',
          properties: {
            name: { type: 'string', description: 'Краткое название по-русски, 1-5 слов.' },
            category: { type: 'string', enum: RECOGNIZE_CATEGORIES, description: 'Складская категория.' },
            period: { type: 'string', description: 'Эпоха предмета. Используй один из вариантов: Современное | 2000-е | 1990-е | 1980-е | Советское (1970-е) | Советское (1960-е) | 1950-е | 1940-е | Военное время | Дореволюционное | XIX век | XVIII век | Средневековье | Античность.' },
            description: { type: 'string', description: '2-4 предложения. Цвет, материал, состояние, видимые детали (надписи, ярлыки, серийники, повреждения, фурнитура, аксессуары). Без фраз-наполнителей.' },
          },
          required: ['name', 'category', 'period', 'description'],
        },
      }],
      tool_choice: { type: 'tool', name: 'fill_unit_card' },
      messages: [{ role: 'user', content }],
    })

    const toolUse = response.content.find(b => b.type === 'tool_use')
    if (!toolUse?.input) throw new Error('ai_invalid_response')
    const raw = toolUse.input

    const newDescription = typeof raw.description === 'string' ? raw.description.trim().slice(0, 1000) : ''
    const newPeriod = typeof raw.period === 'string' ? raw.period.trim().slice(0, 80) : ''
    if (!newDescription) throw new Error('ai_empty_description')

    if (!dryRun) {
      await db.query(
        `UPDATE units
            SET description = $1,
                period      = COALESCE(NULLIF($2, ''), period)
          WHERE id = $3`,
        [newDescription, newPeriod, u.id]
      )
    }

    return { id: u.id, name: u.name, old: u.description || '', new: newDescription, period: newPeriod }
  }

  // Параллельно по `concurrency` юнитов одновременно
  const queue = [...units]
  async function worker() {
    while (queue.length) {
      const u = queue.shift()
      try {
        const sample = await regenOne(u)
        results.updated += 1
        if (results.samples.length < 3) results.samples.push(sample)
      } catch (err) {
        results.failed.push({ id: u.id, name: u.name, error: err.message || String(err) })
      }
    }
  }
  await Promise.all(Array.from({ length: concurrency }, () => worker()))

  res.json(results)
})

module.exports = router
