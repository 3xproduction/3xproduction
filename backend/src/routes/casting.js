const router = require('express').Router()
const multer = require('multer')
const sharp = require('sharp')
const db = require('../db')
const { verifyJWT, checkRole } = require('../middleware/auth')
const { uploadFile } = require('../services/r2')
const { createAnthropicClient } = require('../services/anthropicClient')

const ALLOWED_ROLES = ['producer', 'project_director', 'ams_assistant']

const ALLOWED_MEDIA_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'video/mp4', 'video/webm', 'video/quicktime']
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 100 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    cb(null, ALLOWED_MEDIA_TYPES.includes(file.mimetype))
  },
})

const ALLOWED_KINDS = ['adult', 'child', 'animal']
const ALLOWED_STATUSES = ['considering', 'approved', 'rejected']

const anthropic = createAnthropicClient()

function applyCastingProjectScope(req, alias, params) {
  if (req.user.role === 'producer') return ''
  const projectId = req.user.project_id || null
  if (!projectId) return ' AND 1=0'
  params.push(projectId)
  return ` AND ${alias}.project_id = $${params.length}`
}

// GET /casting
router.get('/', verifyJWT, checkRole(...ALLOWED_ROLES), async (req, res) => {
  const { status, gender, kind, search } = req.query
  try {
    let q = `
      SELECT c.*,
        (SELECT url FROM casting_photos cp WHERE cp.card_id = c.id ORDER BY cp.created_at LIMIT 1) AS photo_url
      FROM casting_cards c WHERE 1=1`
    const params = []
    q += applyCastingProjectScope(req, 'c', params)
    if (status) { params.push(status); q += ` AND c.status = $${params.length}` }
    if (gender) { params.push(gender); q += ` AND c.gender = $${params.length}` }
    if (kind && ALLOWED_KINDS.includes(kind)) { params.push(kind); q += ` AND c.kind = $${params.length}` }
    let searchApplied = false
    if (search) {
      const { buildSearchQuery, checkTrgm } = require('../services/searchService')
      const { tsqueryStr, originalQuery } = await buildSearchQuery(search)
      if (tsqueryStr) {
        const useTrgm = await checkTrgm()
        params.push(tsqueryStr)
        const tsqIdx = params.length
        params.push(originalQuery)
        const rawIdx = params.length
        if (useTrgm) {
          q += ` AND (c.search_vector @@ to_tsquery('ru_search', $${tsqIdx})
                 OR similarity(c.name, $${rawIdx}) > 0.2)`
        } else {
          q += ` AND (c.search_vector @@ to_tsquery('ru_search', $${tsqIdx})
                 OR c.name ILIKE '%' || $${rawIdx} || '%')`
        }
        searchApplied = true
      }
    }
    if (searchApplied) {
      const tsqIdx = params.length - 1
      q += ` ORDER BY ts_rank_cd(c.search_vector, to_tsquery('ru_search', $${tsqIdx})) DESC, c.created_at DESC`
    } else {
      q += ` ORDER BY c.created_at DESC`
    }
    const { rows } = await db.query(q, params)
    res.json(rows)
  } catch (err) {
    console.error('Casting search error:', err)
    res.json([])
  }
})

// GET /casting/:id
router.get('/:id', verifyJWT, checkRole(...ALLOWED_ROLES), async (req, res) => {
  try {
    const params = [req.params.id]
    let q = `SELECT c.* FROM casting_cards c WHERE c.id = $1`
    q += applyCastingProjectScope(req, 'c', params)
    const { rows: [card] } = await db.query(q, params)
    if (!card) return res.status(404).json({ error: 'Not found' })
    const { rows: photos } = await db.query(`SELECT * FROM casting_photos WHERE card_id = $1 ORDER BY created_at`, [req.params.id])
    res.json({ ...card, photos })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Server error' })
  }
})

// Список text/number-полей карточки (без kind/status/project_id/created_by — они обрабатываются отдельно).
const CARD_TEXT_FIELDS = [
  'name', 'role_name', 'gender', 'age_range', 'height', 'weight',
  'hair_color', 'eye_color', 'body_type', 'ethnicity',
  'phone', 'email', 'agency', 'experience', 'notes',
  'description', 'search_tags',
  'languages', 'driver_license', 'skills', 'music_skills', 'dance_skills',
  'clothing_size', 'shoe_size', 'tattoos', 'city', 'social_links', 'rate',
]
const CARD_BOOL_FIELDS = ['has_car', 'accepts_nudity', 'accepts_stunts', 'accepts_travel', 'has_passport']

function pickFieldsForInsert(body) {
  const cols = []
  const params = []
  const placeholders = []
  for (const f of CARD_TEXT_FIELDS) {
    if (body[f] === undefined) continue
    cols.push(f)
    const v = body[f]
    params.push(v === '' || v === null ? null : v)
    placeholders.push(`$${params.length}`)
  }
  for (const f of CARD_BOOL_FIELDS) {
    if (body[f] === undefined) continue
    cols.push(f)
    params.push(body[f] === true || body[f] === 'true' ? true : (body[f] === false || body[f] === 'false' ? false : null))
    placeholders.push(`$${params.length}`)
  }
  return { cols, params, placeholders }
}

// POST /casting
router.post('/', verifyJWT, checkRole(...ALLOWED_ROLES), async (req, res) => {
  if (!req.body?.name) return res.status(400).json({ error: 'Name required' })
  const safeKind = ALLOWED_KINDS.includes(req.body.kind) ? req.body.kind : 'adult'
  const safeStatus = ALLOWED_STATUSES.includes(req.body.status) ? req.body.status : 'considering'
  const safeProjectId = req.user.role === 'producer'
    ? (req.body.project_id || req.user.project_id || null)
    : (req.user.project_id || null)
  if (req.user.role !== 'producer' && !safeProjectId) {
    return res.status(400).json({ error: 'Project required' })
  }
  const { cols, params, placeholders } = pickFieldsForInsert(req.body)
  // фиксированные поля: kind, status, project_id, created_by
  cols.push('kind'); params.push(safeKind); placeholders.push(`$${params.length}`)
  cols.push('status'); params.push(safeStatus); placeholders.push(`$${params.length}`)
  cols.push('project_id'); params.push(safeProjectId); placeholders.push(`$${params.length}`)
  cols.push('created_by'); params.push(req.user.id); placeholders.push(`$${params.length}`)
  try {
    const { rows } = await db.query(
      `INSERT INTO casting_cards (${cols.join(', ')}) VALUES (${placeholders.join(', ')}) RETURNING *`,
      params
    )
    res.json(rows[0])
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Server error' })
  }
})

// PUT /casting/:id
router.put('/:id', verifyJWT, checkRole(...ALLOWED_ROLES), async (req, res) => {
  const sets = []
  const params = []
  for (const f of CARD_TEXT_FIELDS) {
    if (req.body[f] === undefined) continue
    const v = req.body[f]
    params.push(v === '' || v === null ? null : v)
    sets.push(`${f} = $${params.length}`)
  }
  for (const f of CARD_BOOL_FIELDS) {
    if (req.body[f] === undefined) continue
    const v = req.body[f]
    params.push(v === true || v === 'true' ? true : (v === false || v === 'false' ? false : null))
    sets.push(`${f} = $${params.length}`)
  }
  if (req.body.kind !== undefined && ALLOWED_KINDS.includes(req.body.kind)) {
    params.push(req.body.kind); sets.push(`kind = $${params.length}`)
  }
  if (req.body.status !== undefined) {
    if (!ALLOWED_STATUSES.includes(req.body.status)) return res.status(400).json({ error: 'Invalid status' })
    params.push(req.body.status); sets.push(`status = $${params.length}`)
  }
  if (!sets.length) return res.status(400).json({ error: 'No fields' })
  params.push(req.params.id)
  try {
    let where = `id = $${params.length}`
    if (req.user.role !== 'producer') {
      if (!req.user.project_id) return res.status(400).json({ error: 'Project required' })
      params.push(req.user.project_id)
      where += ` AND project_id = $${params.length}`
    }
    const { rows } = await db.query(
      `UPDATE casting_cards SET ${sets.join(', ')} WHERE ${where} RETURNING *`,
      params
    )
    if (!rows.length) return res.status(404).json({ error: 'Not found' })
    res.json(rows[0])
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Server error' })
  }
})

// DELETE /casting/:id
router.delete('/:id', verifyJWT, checkRole(...ALLOWED_ROLES), async (req, res) => {
  try {
    const params = [req.params.id]
    let q = `DELETE FROM casting_cards c WHERE c.id = $1`
    q += applyCastingProjectScope(req, 'c', params)
    await db.query(q, params)
    res.json({ ok: true })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Server error' })
  }
})

// POST /casting/:id/photos
router.post('/:id/photos', verifyJWT, checkRole(...ALLOWED_ROLES), upload.array('photos', 10), async (req, res) => {
  try {
    const params = [req.params.id]
    let q = `SELECT c.id FROM casting_cards c WHERE c.id = $1`
    q += applyCastingProjectScope(req, 'c', params)
    const { rows: cards } = await db.query(q, params)
    if (!cards.length) return res.status(404).json({ error: 'Not found' })
    const urls = []
    for (const file of req.files || []) {
      const url = await uploadFile(file.buffer, file.originalname, 'casting')
      await db.query(`INSERT INTO casting_photos (card_id, url) VALUES ($1, $2)`, [req.params.id, url])
      urls.push(url)
    }
    res.json({ urls })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Upload failed' })
  }
})

// DELETE /casting/:id/photos/:photoId
router.delete('/:id/photos/:photoId', verifyJWT, checkRole(...ALLOWED_ROLES), async (req, res) => {
  try {
    const params = [req.params.photoId, req.params.id]
    let q = `
      DELETE FROM casting_photos cp
      USING casting_cards c
      WHERE cp.id = $1
        AND cp.card_id = $2
        AND c.id = cp.card_id`
    q += applyCastingProjectScope(req, 'c', params)
    await db.query(q, params)
    res.json({ ok: true })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Server error' })
  }
})

// POST /casting/recognize — мульти-фото AI-распознавание актёра.
// Принимает 1..5 фото. Возвращает структурированный JSON с типом (adult/child/animal),
// полом, оценкой возраста, описанием внешности и тегами для ассоциативного поиска.
// Видео не поддерживается (Claude Vision не работает с видео).
router.post('/recognize', verifyJWT, checkRole(...ALLOWED_ROLES), upload.array('photos', 5), async (req, res) => {
  const files = (req.files || []).filter(f => f.mimetype.startsWith('image/'))
  if (!files.length) return res.status(400).json({ error: 'No images provided' })
  if (!process.env.ANTHROPIC_API_KEY) return res.status(500).json({ error: 'AI not configured' })

  const redact = (s) => {
    let str = String(s || '')
    const key = process.env.ANTHROPIC_API_KEY
    if (key && key.length > 8) str = str.split(key).join('[redacted]')
    return str.slice(0, 300)
  }

  try {
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
      text: `Ты — ассистент кастинг-директора. По переданным ${images.length} фото одного человека (или животного) заполни карточку для базы кастинга.

ВАЖНО:
— ФИО, телефон, email, рост, вес — НЕ угадывай, оставь пустыми. Эти поля заполнит человек вручную.
— Тип (kind): adult — взрослый человек, child — ребёнок (≤17 лет визуально), animal — животное.
— Возраст (age_range) — диапазон вроде "25-35". Для детей — например "8-12". Для животных пропусти.
— Пол: male/female для людей. Для животных пиши пустую строку.
— Цвет глаз — только если действительно видно крупным планом, иначе пропусти.
— Этничность/типаж — пиши осторожно описательно (славянский, азиатский, кавказский, африканский, смешанный). Для животных — порода/вид.
— description — 2-4 предложения, фактологически: внешность, телосложение, заметные детали (очки, борода, татуировки, шрамы). Без оценочных суждений.
— tattoos — если на фото видны татуировки/шрамы/пирсинг — кратко опиши (например "татуировка на левом предплечье", "шрам над бровью"). Иначе пустая строка.
— search_tags — ОБЯЗАТЕЛЬНО **50–100 ключевых слов** через пробел для ассоциативного поиска. Включай: внешность (волосы/глаза/телосложение/рост ассоциативно), тип/возрастную группу, амплуа, потенциальные роли (учитель/банкир/врач/гангстер/учёный/спортсмен/и т.д.), эмоциональный типаж (харизматичный/задумчивый/строгий/добрый), эпохи которым подходит (современное/советское/девяностые), стили (деловой/casual/гламурный/милитари), профессиональные окружения которым визуально подходит. Для животных — порода/вид/окрас/размер/характер/амплуа (домашний/служебный/дикий/цирковой). ОЧЕНЬ ВАЖНО: мини-50 слов, целься в 70-80. Все строчными, через пробел, без запятых, без повторов.

Категорически нельзя:
— угадывать имена / фамилии / профессии в реальной жизни;
— выдумывать данные которых не видно на фото.

Вызови инструмент fill_casting_card.`,
    })

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 2048,
      temperature: 0,
      tools: [{
        name: 'fill_casting_card',
        description: 'Заполнить карточку актёра по фото',
        input_schema: {
          type: 'object',
          properties: {
            kind: { type: 'string', enum: ALLOWED_KINDS, description: 'adult — взрослый, child — ребёнок (≤17), animal — животное' },
            gender: { type: 'string', description: 'male, female или пустая строка (для животных)' },
            age_range: { type: 'string', description: 'Диапазон лет, например "25-35" или "8-12". Для животных — пустая строка.' },
            hair_color: { type: 'string', description: 'Цвет волос/шерсти. Для людей: тёмные, русые, блондин, рыжие, седые, каштановые. Пустая если не видно.' },
            eye_color: { type: 'string', description: 'Цвет глаз — только если видно крупным планом. Иначе пустая строка.' },
            body_type: { type: 'string', description: 'Телосложение: худощавое, среднее, плотное, атлетическое, полное. Пустая если не видно.' },
            ethnicity: { type: 'string', description: 'Типаж/этнос или порода. Пустая если не очевидно.' },
            tattoos: { type: 'string', description: 'Видимые татуировки/шрамы/пирсинг кратко. Пустая если ничего не видно.' },
            description: { type: 'string', description: '2-4 предложения, фактологически по внешности' },
            search_tags: { type: 'string', description: '50-100 ключевых слов строчными через пробел: внешность, амплуа, потенциальные роли, типажи, эпохи, стили, профессиональные ассоциации. Минимум 50 слов.' },
          },
          required: ['kind', 'description', 'search_tags'],
        },
      }],
      tool_choice: { type: 'tool', name: 'fill_casting_card' },
      messages: [{ role: 'user', content }],
    })

    const toolUse = response.content.find(b => b.type === 'tool_use')
    if (!toolUse?.input) {
      return res.status(500).json({ error: 'AI вернул некорректный ответ, повторите попытку' })
    }
    const raw = toolUse.input
    const result = {
      kind: ALLOWED_KINDS.includes(raw.kind) ? raw.kind : 'adult',
      gender: typeof raw.gender === 'string' ? raw.gender.trim().slice(0, 20) : '',
      age_range: typeof raw.age_range === 'string' ? raw.age_range.trim().slice(0, 20) : '',
      hair_color: typeof raw.hair_color === 'string' ? raw.hair_color.trim().slice(0, 80) : '',
      eye_color: typeof raw.eye_color === 'string' ? raw.eye_color.trim().slice(0, 80) : '',
      body_type: typeof raw.body_type === 'string' ? raw.body_type.trim().slice(0, 80) : '',
      ethnicity: typeof raw.ethnicity === 'string' ? raw.ethnicity.trim().slice(0, 120) : '',
      tattoos: typeof raw.tattoos === 'string' ? raw.tattoos.trim().slice(0, 300) : '',
      description: typeof raw.description === 'string' ? raw.description.trim().slice(0, 1000) : '',
      search_tags: typeof raw.search_tags === 'string' ? raw.search_tags.trim().slice(0, 3000) : '',
    }
    res.json(result)
  } catch (err) {
    console.error('Casting recognition error:', { status: err?.status, name: err?.name, message: redact(err?.message) })
    res.status(500).json({ error: 'Не удалось распознать фото' })
  }
})

module.exports = router
