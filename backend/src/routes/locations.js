const router = require('express').Router()
const multer = require('multer')
const db = require('../db')
const { verifyJWT } = require('../middleware/auth')
const { uploadFile } = require('../services/r2')

const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp']
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    cb(null, ALLOWED_IMAGE_TYPES.includes(file.mimetype))
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
    if (search) { params.push(`%${search}%`); q += ` AND (l.name ILIKE $${params.length} OR l.address ILIKE $${params.length} OR l.description ILIKE $${params.length})` }
    q += ` ORDER BY l.created_at DESC`
    const { rows } = await db.query(q, params)
    res.json(rows)
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Server error' })
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
