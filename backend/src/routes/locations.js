const router = require('express').Router()
const multer = require('multer')
const db = require('../db')
const { verifyJWT } = require('../middleware/auth')
const { uploadFile } = require('../services/r2')
const { createAnthropicClient } = require('../services/anthropicClient')

const ALLOWED_MEDIA_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'video/mp4', 'video/webm', 'video/quicktime']
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 100 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    cb(null, ALLOWED_MEDIA_TYPES.includes(file.mimetype))
  },
})

// GET /locations
router.get('/', verifyJWT, async (req, res) => {
  const { type, search } = req.query
  try {
    let q = `
      SELECT l.*,
        (SELECT url FROM location_photos lp WHERE lp.location_id = l.id ORDER BY lp.created_at LIMIT 1) AS photo_url
      FROM locations l WHERE 1=1`
    const params = []
    if (type) { params.push(type); q += ` AND l.type = $${params.length}` }
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
          q += ` AND (l.search_vector @@ to_tsquery('ru_search', $${tsqIdx})
                 OR similarity(l.name, $${rawIdx}) > 0.2)`
        } else {
          q += ` AND (l.search_vector @@ to_tsquery('ru_search', $${tsqIdx})
                 OR l.name ILIKE '%' || $${rawIdx} || '%')`
        }
        searchApplied = true
      }
    }
    if (searchApplied) {
      const tsqIdx = params.length - 1
      q += ` ORDER BY ts_rank_cd(l.search_vector, to_tsquery('ru_search', $${tsqIdx})) DESC, l.created_at DESC`
    } else {
      q += ` ORDER BY l.created_at DESC`
    }
    const { rows } = await db.query(q, params)
    res.json(rows)
  } catch (err) {
    console.error('Locations search error:', err)
    res.json([])
  }
})

// GET /locations/:id
router.get('/:id', verifyJWT, async (req, res) => {
  try {
    const { rows: [location] } = await db.query(`SELECT * FROM locations WHERE id = $1`, [req.params.id])
    if (!location) return res.status(404).json({ error: 'Not found' })
    const { rows: photos } = await db.query(`SELECT * FROM location_photos WHERE location_id = $1 ORDER BY created_at`, [req.params.id])
    res.json({ ...location, photos })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Server error' })
  }
})

// POST /locations/recognize — AI photo recognition for locations
router.post('/recognize', verifyJWT, upload.single('photo'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No photo provided' })
  if (!process.env.ANTHROPIC_API_KEY) return res.status(500).json({ error: 'AI not configured' })
  try {
    const sharp = require('sharp')
    const client = createAnthropicClient()
    const resized = await sharp(req.file.buffer).resize(800, 800, { fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 70 }).toBuffer()
    const response = await client.messages.create({
      model: 'claude-haiku-4-5', max_tokens: 1024,
      messages: [{ role: 'user', content: [
        { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: resized.toString('base64') } },
        { type: 'text', text: `Ты — система распознавания локаций для кинопроизводства.
Проанализируй фото и верни JSON:
- name: название локации (кратко, по-русски, например "Заброшенный цех", "Загородный дом")
- type: "interior" или "exterior"
- description: описание пространства (размер, освещение, состояние, атмосфера)
- features: массив особенностей из списка: ["парковка","электричество","вода","туалет","гримёрная","кухня","лифт","кондиционер","отопление","интернет","звукоизоляция","высокие_потолки","панорамные_окна","чёрный_зал"]

Отвечай ТОЛЬКО JSON, без markdown.` }
      ]}],
    })
    const text = response.content.find(b => b.type === 'text')?.text || ''
    const clean = text.replace(/^```(?:json)?/m, '').replace(/```$/m, '').trim()
    res.json(JSON.parse(clean))
  } catch (err) {
    console.error('Location recognition error:', { status: err?.status, name: err?.name })
    res.status(500).json({ error: 'Не удалось распознать фото' })
  }
})

// POST /locations
router.post('/', verifyJWT, async (req, res) => {
  const { name, type, address, description, contact_name, contact_phone, price_per_day, area_sqm, features, notes, project_id } = req.body
  if (!name) return res.status(400).json({ error: 'Name required' })
  try {
    const { rows } = await db.query(
      `INSERT INTO locations (name, type, address, description, contact_name, contact_phone, price_per_day, area_sqm, features, notes, project_id, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
      [name, type || 'interior', address, description, contact_name, contact_phone, price_per_day, area_sqm, features || [], notes, project_id, req.user.id]
    )
    res.json(rows[0])
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Server error' })
  }
})

// PUT /locations/:id
router.put('/:id', verifyJWT, async (req, res) => {
  const { name, type, address, description, contact_name, contact_phone, price_per_day, area_sqm, features, notes } = req.body
  try {
    const { rows } = await db.query(
      `UPDATE locations SET name=$1, type=$2, address=$3, description=$4, contact_name=$5, contact_phone=$6, price_per_day=$7, area_sqm=$8, features=$9, notes=$10
       WHERE id=$11 RETURNING *`,
      [name, type, address, description, contact_name, contact_phone, price_per_day, area_sqm, features || [], notes, req.params.id]
    )
    if (!rows.length) return res.status(404).json({ error: 'Not found' })
    res.json(rows[0])
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Server error' })
  }
})

// DELETE /locations/:id
router.delete('/:id', verifyJWT, async (req, res) => {
  try {
    await db.query(`DELETE FROM locations WHERE id = $1`, [req.params.id])
    res.json({ ok: true })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Server error' })
  }
})

// POST /locations/:id/photos
router.post('/:id/photos', verifyJWT, upload.array('photos', 10), async (req, res) => {
  try {
    const urls = []
    for (const file of req.files || []) {
      const url = await uploadFile(file.buffer, file.originalname, 'locations')
      await db.query(`INSERT INTO location_photos (location_id, url) VALUES ($1, $2)`, [req.params.id, url])
      urls.push(url)
    }
    res.json({ urls })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Upload failed' })
  }
})

module.exports = router
