const router = require('express').Router()
const multer = require('multer')
const db = require('../db')
const { verifyJWT } = require('../middleware/auth')
const { uploadFile } = require('../services/r2')

const ALLOWED_MEDIA_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'video/mp4', 'video/webm', 'video/quicktime']
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 100 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    cb(null, ALLOWED_MEDIA_TYPES.includes(file.mimetype))
  },
})

// GET /decorations
router.get('/', verifyJWT, async (req, res) => {
  const { type, status, search } = req.query
  try {
    let q = `
      SELECT d.*,
        l.name AS location_name,
        (SELECT url FROM decoration_photos dp WHERE dp.decoration_id = d.id ORDER BY dp.created_at LIMIT 1) AS photo_url
      FROM decorations d
      LEFT JOIN locations l ON l.id = d.location_id
      WHERE 1=1`
    const params = []
    if (type) { params.push(type); q += ` AND d.type = $${params.length}` }
    if (status) { params.push(status); q += ` AND d.status = $${params.length}` }
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
          q += ` AND (d.search_vector @@ to_tsquery('ru_search', $${tsqIdx})
                 OR similarity(d.name, $${rawIdx}) > 0.2)`
        } else {
          q += ` AND (d.search_vector @@ to_tsquery('ru_search', $${tsqIdx})
                 OR d.name ILIKE '%' || $${rawIdx} || '%')`
        }
        searchApplied = true
      }
    }
    if (searchApplied) {
      const tsqIdx = params.length - 1
      q += ` ORDER BY ts_rank_cd(d.search_vector, to_tsquery('ru_search', $${tsqIdx})) DESC, d.created_at DESC`
    } else {
      q += ` ORDER BY d.created_at DESC`
    }
    const { rows } = await db.query(q, params)
    res.json(rows)
  } catch (err) {
    console.error('Decorations search error:', err)
    res.json([])
  }
})

// GET /decorations/pavilions — short list of pavilions for move picker
router.get('/pavilions', verifyJWT, async (req, res) => {
  try {
    const { rows } = await db.query(
      `SELECT id, name, status FROM decorations WHERE type = 'pavilion' ORDER BY name`
    )
    res.json({ pavilions: rows })
  } catch (err) {
    console.error(err)
    res.json({ pavilions: [] })
  }
})

// GET /decorations/:id
router.get('/:id', verifyJWT, async (req, res) => {
  try {
    const { rows: [decoration] } = await db.query(
      `SELECT d.*, l.name AS location_name FROM decorations d LEFT JOIN locations l ON l.id = d.location_id WHERE d.id = $1`,
      [req.params.id]
    )
    if (!decoration) return res.status(404).json({ error: 'Not found' })
    const { rows: photos } = await db.query(`SELECT * FROM decoration_photos WHERE decoration_id = $1 ORDER BY created_at`, [req.params.id])
    const { rows: units } = await db.query(
      `SELECT u.id, u.name, u.category, u.status,
        (SELECT url FROM unit_photos up WHERE up.unit_id = u.id LIMIT 1) AS photo_url
       FROM decoration_units du JOIN units u ON u.id = du.unit_id WHERE du.decoration_id = $1`,
      [req.params.id]
    )
    // Units currently physically moved to this pavilion (via units.pavilion_id).
    // Only meaningful when decoration.type = 'pavilion'.
    let unitsInPavilion = []
    if (decoration.type === 'pavilion') {
      const { rows } = await db.query(
        `SELECT u.id, u.name, u.category, u.status, u.serial, u.valuation,
          (SELECT url FROM unit_photos up WHERE up.unit_id = u.id LIMIT 1) AS photo_url
         FROM units u WHERE u.pavilion_id = $1 ORDER BY u.name`,
        [req.params.id]
      )
      unitsInPavilion = rows
    }
    res.json({ ...decoration, photos, units, units_in_pavilion: unitsInPavilion })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Server error' })
  }
})

// POST /decorations/recognize — AI photo recognition for decorations
router.post('/recognize', verifyJWT, upload.single('photo'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No photo provided' })
  if (!process.env.ANTHROPIC_API_KEY) return res.status(500).json({ error: 'AI not configured' })
  try {
    const sharp = require('sharp')
    const Anthropic = require('@anthropic-ai/sdk')
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, baseURL: 'https://anthropic-proxy.pavelbelov590.workers.dev' })
    const resized = await sharp(req.file.buffer).resize(800, 800, { fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 70 }).toBuffer()
    const response = await client.messages.create({
      model: 'claude-haiku-4-5', max_tokens: 1024,
      messages: [{ role: 'user', content: [
        { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: resized.toString('base64') } },
        { type: 'text', text: `Ты — система распознавания декораций для кинопроизводства.
Проанализируй фото и верни JSON:
- name: название декорации (кратко, по-русски, например "Кабинет следователя", "Средневековый замок")
- type: "decoration" или "pavilion"
- description: описание декорации (стиль, эпоха, материалы, состояние, размер)

Отвечай ТОЛЬКО JSON, без markdown.` }
      ]}],
    })
    const text = response.content.find(b => b.type === 'text')?.text || ''
    const clean = text.replace(/^```(?:json)?/m, '').replace(/```$/m, '').trim()
    res.json(JSON.parse(clean))
  } catch (err) {
    console.error('Decoration recognition error:', { status: err?.status, name: err?.name })
    res.status(500).json({ error: 'Не удалось распознать фото' })
  }
})

// POST /decorations — create
router.post('/', verifyJWT, async (req, res) => {
  const { name, type, description, location_id, area_sqm, status, project_id } = req.body
  if (!name) return res.status(400).json({ error: 'Name required' })
  try {
    const { rows } = await db.query(
      `INSERT INTO decorations (name, type, description, location_id, area_sqm, status, project_id, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [name, type || 'decoration', description, location_id || null, area_sqm, status || 'available', project_id, req.user.id]
    )
    res.json(rows[0])
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Server error' })
  }
})

// PUT /decorations/:id
router.put('/:id', verifyJWT, async (req, res) => {
  const { name, type, description, location_id, area_sqm, status } = req.body
  try {
    const { rows } = await db.query(
      `UPDATE decorations SET name=$1, type=$2, description=$3, location_id=$4, area_sqm=$5, status=$6
       WHERE id=$7 RETURNING *`,
      [name, type, description, location_id || null, area_sqm, status, req.params.id]
    )
    if (!rows.length) return res.status(404).json({ error: 'Not found' })
    res.json(rows[0])
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Server error' })
  }
})

// DELETE /decorations/:id
router.delete('/:id', verifyJWT, async (req, res) => {
  try {
    await db.query(`DELETE FROM decorations WHERE id = $1`, [req.params.id])
    res.json({ ok: true })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Server error' })
  }
})

// POST /decorations/:id/photos
router.post('/:id/photos', verifyJWT, upload.array('photos', 10), async (req, res) => {
  try {
    const urls = []
    for (const file of req.files || []) {
      const url = await uploadFile(file.buffer, file.originalname, 'decorations')
      await db.query(`INSERT INTO decoration_photos (decoration_id, url) VALUES ($1, $2)`, [req.params.id, url])
      urls.push(url)
    }
    res.json({ urls })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Upload failed' })
  }
})

// POST /decorations/:id/units — link units to decoration
router.post('/:id/units', verifyJWT, async (req, res) => {
  const { unit_ids } = req.body
  if (!unit_ids?.length) return res.status(400).json({ error: 'unit_ids required' })
  try {
    for (const uid of unit_ids) {
      await db.query(
        `INSERT INTO decoration_units (decoration_id, unit_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
        [req.params.id, uid]
      )
    }
    res.json({ ok: true })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Server error' })
  }
})

// DELETE /decorations/:id/units/:unitId — unlink unit from decoration
router.delete('/:id/units/:unitId', verifyJWT, async (req, res) => {
  try {
    await db.query(`DELETE FROM decoration_units WHERE decoration_id = $1 AND unit_id = $2`, [req.params.id, req.params.unitId])
    res.json({ ok: true })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Server error' })
  }
})

module.exports = router
