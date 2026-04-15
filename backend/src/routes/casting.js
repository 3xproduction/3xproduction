const router = require('express').Router()
const multer = require('multer')
const db = require('../db')
const { verifyJWT, checkRole } = require('../middleware/auth')
const { uploadFile } = require('../services/r2')

const ALLOWED_ROLES = ['producer', 'project_director', 'ams_assistant']

const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp']
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    cb(null, ALLOWED_IMAGE_TYPES.includes(file.mimetype))
  },
})

// GET /casting
router.get('/', verifyJWT, checkRole(...ALLOWED_ROLES), async (req, res) => {
  const { status, gender, search } = req.query
  try {
    let q = `
      SELECT c.*,
        (SELECT url FROM casting_photos cp WHERE cp.card_id = c.id ORDER BY cp.created_at LIMIT 1) AS photo_url
      FROM casting_cards c WHERE 1=1`
    const params = []
    if (status) { params.push(status); q += ` AND c.status = $${params.length}` }
    if (gender) { params.push(gender); q += ` AND c.gender = $${params.length}` }
    if (search) {
      const { buildSearchQuery } = require('../services/searchService')
      const { tsqueryStr, originalQuery } = await buildSearchQuery(search)
      params.push(tsqueryStr); const tsqIdx = params.length
      params.push(originalQuery); const rawIdx = params.length
      q += ` AND (c.search_vector @@ to_tsquery('ru_search', $${tsqIdx})
             OR similarity(c.name, $${rawIdx}) > 0.2)`
    }
    if (search) {
      q += ` ORDER BY ts_rank_cd(c.search_vector, to_tsquery('ru_search', $${params.length - 1})) DESC, c.created_at DESC`
    } else {
      q += ` ORDER BY c.created_at DESC`
    }
    const { rows } = await db.query(q, params)
    res.json(rows)
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Server error' })
  }
})

// GET /casting/:id
router.get('/:id', verifyJWT, checkRole(...ALLOWED_ROLES), async (req, res) => {
  try {
    const { rows: [card] } = await db.query(`SELECT * FROM casting_cards WHERE id = $1`, [req.params.id])
    if (!card) return res.status(404).json({ error: 'Not found' })
    const { rows: photos } = await db.query(`SELECT * FROM casting_photos WHERE card_id = $1 ORDER BY created_at`, [req.params.id])
    res.json({ ...card, photos })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Server error' })
  }
})

// POST /casting
router.post('/', verifyJWT, checkRole(...ALLOWED_ROLES), async (req, res) => {
  const { name, role_name, gender, age_range, height, weight, hair_color, eye_color, body_type, ethnicity, phone, email, agency, experience, notes, status, project_id } = req.body
  if (!name) return res.status(400).json({ error: 'Name required' })
  try {
    const { rows } = await db.query(
      `INSERT INTO casting_cards (name, role_name, gender, age_range, height, weight, hair_color, eye_color, body_type, ethnicity, phone, email, agency, experience, notes, status, project_id, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18) RETURNING *`,
      [name, role_name, gender, age_range, height, weight, hair_color, eye_color, body_type, ethnicity, phone, email, agency, experience, notes, status || 'considering', project_id, req.user.id]
    )
    res.json(rows[0])
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Server error' })
  }
})

// PUT /casting/:id
router.put('/:id', verifyJWT, checkRole(...ALLOWED_ROLES), async (req, res) => {
  const { name, role_name, gender, age_range, height, weight, hair_color, eye_color, body_type, ethnicity, phone, email, agency, experience, notes, status } = req.body
  try {
    const { rows } = await db.query(
      `UPDATE casting_cards SET name=$1, role_name=$2, gender=$3, age_range=$4, height=$5, weight=$6, hair_color=$7, eye_color=$8, body_type=$9, ethnicity=$10, phone=$11, email=$12, agency=$13, experience=$14, notes=$15, status=$16
       WHERE id=$17 RETURNING *`,
      [name, role_name, gender, age_range, height, weight, hair_color, eye_color, body_type, ethnicity, phone, email, agency, experience, notes, status, req.params.id]
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
    await db.query(`DELETE FROM casting_cards WHERE id = $1`, [req.params.id])
    res.json({ ok: true })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Server error' })
  }
})

// POST /casting/:id/photos
router.post('/:id/photos', verifyJWT, checkRole(...ALLOWED_ROLES), upload.array('photos', 10), async (req, res) => {
  try {
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
    await db.query(`DELETE FROM casting_photos WHERE id = $1 AND card_id = $2`, [req.params.photoId, req.params.id])
    res.json({ ok: true })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Server error' })
  }
})

module.exports = router
