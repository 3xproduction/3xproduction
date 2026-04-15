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

// GET /vehicles
router.get('/', verifyJWT, async (req, res) => {
  const { type, status, brand, search } = req.query
  try {
    let q = `
      SELECT v.*,
        (SELECT url FROM vehicle_photos vp WHERE vp.vehicle_id = v.id ORDER BY vp.created_at LIMIT 1) AS photo_url
      FROM vehicles v WHERE 1=1`
    const params = []
    if (type) { params.push(type); q += ` AND v.type = $${params.length}` }
    if (status) { params.push(status); q += ` AND v.status = $${params.length}` }
    if (brand) { params.push(`%${brand}%`); q += ` AND v.brand ILIKE $${params.length}` }
    if (search) {
      const { buildSearchQuery } = require('../services/searchService')
      const { tsqueryStr, originalQuery } = await buildSearchQuery(search)
      params.push(tsqueryStr); const tsqIdx = params.length
      params.push(originalQuery); const rawIdx = params.length
      q += ` AND (v.search_vector @@ to_tsquery('ru_search', $${tsqIdx})
             OR similarity(v.name, $${rawIdx}) > 0.2)`
    }
    if (search) {
      q += ` ORDER BY ts_rank_cd(v.search_vector, to_tsquery('ru_search', $${params.length - 1})) DESC, v.created_at DESC`
    } else {
      q += ` ORDER BY v.created_at DESC`
    }
    const { rows } = await db.query(q, params)
    res.json(rows)
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Server error' })
  }
})

// GET /vehicles/:id
router.get('/:id', verifyJWT, async (req, res) => {
  try {
    const { rows: [vehicle] } = await db.query(`SELECT * FROM vehicles WHERE id = $1`, [req.params.id])
    if (!vehicle) return res.status(404).json({ error: 'Not found' })
    const { rows: photos } = await db.query(`SELECT * FROM vehicle_photos WHERE vehicle_id = $1 ORDER BY created_at`, [req.params.id])
    res.json({ ...vehicle, photos })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Server error' })
  }
})

// POST /vehicles
router.post('/', verifyJWT, async (req, res) => {
  const { name, type, brand, model, year, color, license_plate, vin, description, condition, status, daily_rate, owner_name, owner_contact, project_id } = req.body
  if (!name) return res.status(400).json({ error: 'Name required' })
  try {
    const { rows } = await db.query(
      `INSERT INTO vehicles (name, type, brand, model, year, color, license_plate, vin, description, condition, status, daily_rate, owner_name, owner_contact, project_id, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) RETURNING *`,
      [name, type || 'car', brand, model, year, color, license_plate, vin, description, condition, status || 'available', daily_rate, owner_name, owner_contact, project_id, req.user.id]
    )
    res.json(rows[0])
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Server error' })
  }
})

// PUT /vehicles/:id
router.put('/:id', verifyJWT, async (req, res) => {
  const { name, type, brand, model, year, color, license_plate, vin, description, condition, status, daily_rate, owner_name, owner_contact } = req.body
  try {
    const { rows } = await db.query(
      `UPDATE vehicles SET name=$1, type=$2, brand=$3, model=$4, year=$5, color=$6, license_plate=$7, vin=$8, description=$9, condition=$10, status=$11, daily_rate=$12, owner_name=$13, owner_contact=$14
       WHERE id=$15 RETURNING *`,
      [name, type, brand, model, year, color, license_plate, vin, description, condition, status, daily_rate, owner_name, owner_contact, req.params.id]
    )
    if (!rows.length) return res.status(404).json({ error: 'Not found' })
    res.json(rows[0])
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Server error' })
  }
})

// DELETE /vehicles/:id
router.delete('/:id', verifyJWT, async (req, res) => {
  try {
    await db.query(`DELETE FROM vehicles WHERE id = $1`, [req.params.id])
    res.json({ ok: true })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Server error' })
  }
})

// POST /vehicles/:id/photos
router.post('/:id/photos', verifyJWT, upload.array('photos', 10), async (req, res) => {
  try {
    const urls = []
    for (const file of req.files || []) {
      const url = await uploadFile(file.buffer, file.originalname, 'vehicles')
      await db.query(`INSERT INTO vehicle_photos (vehicle_id, url) VALUES ($1, $2)`, [req.params.id, url])
      urls.push(url)
    }
    res.json({ urls })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Upload failed' })
  }
})

module.exports = router
