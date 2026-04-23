const router = require('express').Router()
const multer = require('multer')
const Anthropic = require('@anthropic-ai/sdk')
const sharp = require('sharp')
const db     = require('../db')
const { verifyJWT, checkRole } = require('../middleware/auth')
const { uploadFile, deleteFile } = require('../services/r2')
const { CATEGORIES_BY_STORAGE } = require('../constants/storageRules')

// Validate that a unit move to target cell is allowed.
// Места безлимитные, ограничение одно: на ВЕШАЛКАХ (hanger) разрешены только
// костюмы/обувь/аксессуары/украшения. На полках и местах — любая категория.
// Секции type='hall' (залы-контейнеры) не хранят единицы напрямую.
async function validateCellMove(unitRow, targetCellId) {
  if (!targetCellId) return { ok: true }
  const { rows } = await db.query(
    `SELECT c.id AS cell_id, sec.type AS target_type
     FROM cells c
     JOIN warehouse_sections sec ON sec.id = c.section_id
     WHERE c.id = $1`,
    [targetCellId]
  )
  if (!rows.length) return { ok: false, error: 'Ячейка не найдена' }
  const targetType = rows[0].target_type
  if (targetType === 'hanger') {
    const allowed = CATEGORIES_BY_STORAGE.hanger
    if (unitRow.category && !allowed.includes(unitRow.category)) {
      return {
        ok: false,
        error: 'На вешалке размещаются только костюмы, обувь, аксессуары и украшения',
      }
    }
  }
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

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
  baseURL: 'https://anthropic-proxy.pavelbelov590.workers.dev',
})

const DIRECTOR_ROLES = ['warehouse_director', 'warehouse_deputy']

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
  const { warehouse, status, category, search, cell_id, scope, misplaced } = req.query
  // scope: 'common' (default) — only warehouse units, 'project' — only project-kept, 'all' — both
  try {
    let q = `
      SELECT u.*, w.name AS warehouse_name, w.address AS warehouse_address,
             c.code AS cell_code, c.custom_name AS cell_custom,
             sec.name AS section_name, sec.type AS section_type,
             pav.name AS pavilion_name,
             (SELECT url FROM unit_photos WHERE unit_id = u.id ORDER BY CASE WHEN url ~* '\.(mp4|webm|mov)$' THEN 1 ELSE 0 END, created_at LIMIT 1) AS photo_url
      FROM units u
      LEFT JOIN warehouses w ON w.id = u.warehouse_id
      LEFT JOIN cells c ON c.id = u.cell_id
      LEFT JOIN warehouse_sections sec ON sec.id = c.section_id
      LEFT JOIN decorations pav ON pav.id = u.pavilion_id AND pav.type = 'pavilion'
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
    // Default scope: only common warehouse units. Project-kept units are requested explicitly
    // via scope=project (director UI) or scope=all. This keeps public/search paths clean.
    if (scope === 'project') {
      q += ` AND u.is_project_kept = true`
    } else if (scope === 'all') {
      // no extra filter
    } else {
      q += ` AND COALESCE(u.is_project_kept, false) = false`
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
      const { buildSearchQuery } = require('../services/searchService')
      const result = await buildSearchQuery(search)
      if (result.tsqueryStr) {
        params.push(result.tsqueryStr)
        tsqIdx = params.length
        params.push(result.originalQuery)
        rawIdx = params.length
        closeSynonyms = result.closeSynonyms || []
        q += ` AND (
          ts_rank_cd(u.search_vector, to_tsquery('ru_search', $${tsqIdx})) > 0.5
          OR u.name ILIKE '%' || $${rawIdx} || '%'
        )`
        searchApplied = true
      }
    }
    if (searchApplied) {
      q += ` ORDER BY
        CASE WHEN u.name ILIKE '%' || $${rawIdx} || '%' THEN 2000 ELSE 0 END
        + ts_rank_cd(u.search_vector, to_tsquery('ru_search', $${tsqIdx})) DESC,
        u.created_at DESC`
    } else {
      q += ` ORDER BY u.created_at DESC`
    }

    const { rows } = await db.query(q, params)
    const canSeeValuation = ['warehouse_director', 'warehouse_deputy', 'producer'].includes(req.user.role)
    const searchLower = search ? search.trim().toLowerCase() : ''
    const units = rows.map(({ search_tags, search_vector, ...rest }) => {
      if (!canSeeValuation) { const { valuation, ...r } = rest; rest = r }
      // 3-tier marking: direct → similar → related
      if (searchApplied) {
        const nameLower = rest.name.toLowerCase()
        if (nameLower.includes(searchLower)) {
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

// POST /units/recognize — мультифото AI-распознавание.
// Принимает 1..5 фото одного предмета. Claude проверяет, что все фото
// показывают ОДИН и тот же предмет с разных ракурсов. Если хотя бы одно
// фото о другом — возвращает outlier_indices (0-based) для подсветки на
// фронте и same_item=false. Если все фото — один предмет, заполняет поля.
router.post('/recognize', verifyJWT, upload.array('photos', 5), async (req, res) => {
  const files = req.files || []
  if (!files.length) return res.status(400).json({ error: 'No photos provided' })
  if (!process.env.ANTHROPIC_API_KEY) return res.status(500).json({ error: 'AI not configured' })

  // Redact-helper — не допускаем попадания API key или proxy URL в строки.
  const redact = (s) => {
    let str = String(s || '')
    const key = process.env.ANTHROPIC_API_KEY
    if (key && key.length > 8) str = str.split(key).join('[redacted]')
    return str.slice(0, 300)
  }

  try {
    // Resize each photo: 800×800 JPEG q70 → base64 (идентично прошлому флоу).
    const images = await Promise.all(files.map(async (f) => {
      const resized = await sharp(f.buffer)
        .resize(800, 800, { fit: 'inside', withoutEnlargement: true })
        .jpeg({ quality: 70 })
        .toBuffer()
      return resized.toString('base64')
    }))

    // Собираем content: для каждого фото — лейбл «Фото N:» + сам blob.
    // AI видит нумерацию 0-based (0..N-1), что совпадёт с индексами на фронте.
    const content = []
    images.forEach((data, idx) => {
      content.push({ type: 'text', text: `Фото ${idx}:` })
      content.push({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data } })
    })
    content.push({
      type: 'text',
      text: `Ты — система распознавания для склада кинопроизводства. Передано ${images.length} фото (0..${images.length - 1}) одного предмета.

ЗАДАЧА — прогрессивный сбор деталей:
— Фото 0 = основное: определи предмет, его тип, категорию, эпоху.
— Фото 1, 2, … = источники ДОПОЛНИТЕЛЬНЫХ деталей. На них смотри только то, чего НЕ ВИДНО на предыдущих фото:
  • новые цвета, оттенки, материалы, фактура;
  • серийные номера, ярлыки, бирки, маркировки, надписи;
  • повреждения, царапины, потёртости, следы ремонта;
  • детали конструкции со скрытых ракурсов (низ, задник, внутренности, замки, застёжки);
  • аксессуары/дополнения, которые шли в комплекте.
— Если на очередном фото ничего нового НЕТ — просто пропусти его, НЕ пиши «это тот же предмет», НЕ пиши «другой ракурс», НЕ добавляй пустых фраз.

НЕ НАДО:
— Обсуждать, что это один и тот же предмет или разные ракурсы.
— Писать «на фото 2 виден этот же предмет сбоку».
— Писать «фото 3 не добавляет информации».
— Добавлять общие фразы наполнителя.

Категории: costumes, props, art_fill, dummy, auto, furniture, decor, scenery, tech, lighting, sound, camera, makeup, clothing, jewelry, other
Период (обязательно): "Современное" | "Советское (1970-е)" | "XVIII век" | другая эпоха.

Формат ответа: РОВНО ОДИН JSON-объект без markdown, без комментариев до или после.

{"name": "...", "category": "...", "period": "...", "description": "..."}

— description: 2-4 предложения. Начинай с базового описания (из фото 0): что это, цвет, материал, состояние. Потом добавляй детали, найденные на последующих фото (только те, которые РЕАЛЬНО добавляют информацию). Если ничего не добавилось — оставляй описание коротким.

Пример (3 фото: сумка спереди, ярлык крупно, царапина снизу):
{"name": "Кожаная сумка", "category": "props", "period": "Современное", "description": "Коричневая кожаная сумка-хобо с длинным плечевым ремнём, состояние хорошее. На внутреннем ярлыке маркировка «MADE IN ITALY, 1978». На нижней части корпуса глубокая вертикальная царапина около 4 см."}

Пример (2 фото: кресло, задник кресла без новых деталей):
{"name": "Винтажное кресло", "category": "furniture", "period": "Советское (1970-е)", "description": "Деревянное кресло с тканевой обивкой охристого цвета, подлокотники и ножки из лакированного дуба, состояние удовлетворительное."}`,
    })

    const response = await anthropic.messages.create({
      model: 'claude-haiku-4-5',
      max_tokens: 1024,
      messages: [{ role: 'user', content }],
    })

    const text = response.content.find(b => b.type === 'text')?.text || ''

    // Извлекаем первый сбалансированный {...} блок — позволяет модели писать
    // размышления до JSON без поломки парсера. Раньше JSON.parse(clean) падал.
    let result
    try {
      const jsonMatch = text.match(/\{[\s\S]*\}/)
      if (!jsonMatch) throw new Error('No JSON in response')
      result = JSON.parse(jsonMatch[0])
    } catch {
      return res.status(500).json({ error: 'AI вернул некорректный ответ, повторите попытку' })
    }

    // Режим прогрессивного сбора деталей — AI больше не решает «один vs разные
    // предметы». Возвращаем поля как есть + same_item=true для совместимости
    // с фронтом (UnitsPage ветвился на outlier_indices; теперь ветка мёртвая).
    res.json({ ...result, same_item: true, outlier_indices: [] })
  } catch (err) {
    // Логируем ТОЛЬКО безопасные поля. err.error/err.response могут содержать
    // request config (включая заголовки с авторизацией) — не печатаем их.
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
              pav.name AS pavilion_name
       FROM units u
       LEFT JOIN warehouses w ON w.id = u.warehouse_id
       LEFT JOIN cells c ON c.id = u.cell_id
       LEFT JOIN warehouse_sections sec ON sec.id = c.section_id
       LEFT JOIN decorations pav ON pav.id = u.pavilion_id AND pav.type = 'pavilion'
       WHERE u.id = $1`,
      [req.params.id]
    )
    if (!rows.length) return res.status(404).json({ error: 'Unit not found' })

    const unit = rows[0]
    // GET /units/:id отдаём всем — из списков единицы и так отфильтрованы;
    // прямой доступ нужен для открытия карточки из долгов/списаний, которые
    // привязаны к проекту пользователя.
    delete unit.search_tags
    delete unit.search_vector

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
              COALESCE(p.name, rd.counterparty_name) AS project_name,
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
       LEFT JOIN rent_deals rd ON rd.id = h.rent_deal_id
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

    const { name, category, serial, warehouse_id, cell_id, pavilion_id, description, qty, condition, valuation, materials, period } = req.body
    const current = rows[0]

    // A unit is either on a warehouse cell OR inside a pavilion — never both.
    const movingToPavilion = pavilion_id !== undefined && pavilion_id !== null && pavilion_id !== ''
    const effectiveCellId = movingToPavilion ? null : (cell_id || null)
    const effectivePavilionId = movingToPavilion ? pavilion_id : null

    // Validate cell-move against matrix (only when actually moving to a cell, not to pavilion).
    if (effectiveCellId && effectiveCellId !== current.cell_id) {
      const check = await validateCellMove(current, effectiveCellId)
      if (!check.ok) return res.status(400).json({ error: check.error })
    }

    const params = [name, category, serial, warehouse_id, effectiveCellId, effectivePavilionId,
                    description, qty, condition, valuation, materials || null, period || null, req.params.id]
    const { rows: updated } = await db.query(
      `UPDATE units SET name=$1,category=$2,serial=$3,warehouse_id=$4,cell_id=$5,pavilion_id=$6,
       description=$7,qty=$8,condition=$9,valuation=$10,materials=$11,period=$12
       WHERE id=$13 RETURNING *`,
      params
    )
    const action = movingToPavilion ? 'Перемещено в павильон'
                 : (current.pavilion_id && !movingToPavilion) ? 'Возвращено из павильона'
                 : 'Изменено'
    await db.query(
      `INSERT INTO unit_history (unit_id, action, user_id) VALUES ($1,$2,$3)`,
      [req.params.id, action, req.user.id]
    )
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
