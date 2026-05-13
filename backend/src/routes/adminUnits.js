const router = require('express').Router()
const multer = require('multer')
const crypto = require('crypto')
const db = require('../db')
const { verifyJWT } = require('../middleware/auth')
const { uploadFile } = require('../services/r2')
const { buildSearchQuery, normalizeSearchText, compactSearchText, normalizedSqlText, compactSqlText } = require('../services/searchService')

const ADMIN_STOCK_ROLES = new Set([
  'warehouse_director', 'warehouse_deputy', 'warehouse_staff',
  'project_director', 'set_admin',
])
const ADMIN_STOCK_CATEGORIES = new Set([
  'props', 'art_fill', 'dummy',
  'auto', 'furniture', 'decor', 'scenery', 'tech',
  'shoes', 'jewelry', 'accessories', 'costumes',
  'food', 'drinks',
  'other',
])
const RECEIPT_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'application/pdf'])

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    cb(null, RECEIPT_MIME_TYPES.has(file.mimetype))
  },
})

function canUseAdminStock(user) {
  return ADMIN_STOCK_ROLES.has(user?.role)
}

function isTrustedReceiptUrl(value) {
  const url = String(value || '').trim()
  if (!url) return true
  const base = String(process.env.S3_PUBLIC_URL || '').replace(/\/+$/, '')
  return Boolean(base) && url.startsWith(`${base}/receipts/`)
}

router.use(verifyJWT)
router.use((req, res, next) => {
  if (!canUseAdminStock(req.user)) return res.status(403).json({ error: 'Forbidden' })
  next()
})

// GET /admin-units — supplies of the administrative shop.
router.get('/', async (req, res) => {
  const { category, search } = req.query
  try {
    const cleanCategory = category ? String(category).trim() : ''
    if (cleanCategory && !ADMIN_STOCK_CATEGORIES.has(cleanCategory)) {
      return res.status(400).json({ error: 'Invalid category' })
    }

    const params = []
    let q = `
      SELECT u.*,
             uc.name AS created_by_name,
             ph.url AS photo_url,
             ph.thumb_url AS photo_thumb_url
      FROM units u
      LEFT JOIN users uc ON uc.id = u.created_by
      LEFT JOIN LATERAL (
        SELECT url, thumb_url FROM unit_photos
        WHERE unit_id = u.id AND type = 'stock'
        ORDER BY CASE WHEN url ~* '\\.(mp4|webm|mov)$' THEN 1 ELSE 0 END, created_at
        LIMIT 1
      ) ph ON true
      WHERE COALESCE(u.is_admin_stock, false) = true
        AND u.status = 'on_stock'
    `

    if (cleanCategory) {
      params.push(cleanCategory)
      q += ` AND u.category = $${params.length}`
    }

    let searchApplied = false
    let tsqIdx, rawIdx
    let closeSynonyms = []
    if (search && String(search).trim()) {
      const result = await buildSearchQuery(search)
      if (result.tsqueryStr) {
        params.push(result.tsqueryStr)
        tsqIdx = params.length
        params.push(result.originalQuery)
        rawIdx = params.length
        closeSynonyms = result.closeSynonyms || []
        const searchableExpr = `concat_ws(' ', u.name, u.description, u.serial, u.period, u.dimensions, u.vendor)`
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
      const searchableExpr = `concat_ws(' ', u.name, u.description, u.serial, u.period, u.dimensions, u.vendor)`
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
    const searchLower = search ? normalizeSearchText(search) : ''
    const searchCompact = search ? compactSearchText(search) : ''
    const units = rows.map(({ search_tags, search_vector, ...rest }) => {
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
    console.error('admin-units list:', err)
    res.json({ units: [] })
  }
})

// POST /admin-units — create an admin-stock unit.
router.post('/', async (req, res) => {
  const {
    name, category, description, qty, condition, period, dimensions,
    purchased, purchase_price, purchase_date, vendor, receipt_url, valuation,
  } = req.body || {}

  const cleanName = String(name || '').trim()
  const cleanCategory = String(category || '').trim()
  const cleanReceiptInput = String(receipt_url || '').trim()

  if (!cleanName || !cleanCategory) return res.status(400).json({ error: 'Name and category required' })
  if (!ADMIN_STOCK_CATEGORIES.has(cleanCategory)) return res.status(400).json({ error: 'Invalid category' })
  if (cleanReceiptInput && !isTrustedReceiptUrl(cleanReceiptInput)) return res.status(400).json({ error: 'Invalid receipt URL' })

  try {
    const catPrefix = cleanCategory.slice(0, 3).toUpperCase()
    const serial = `${catPrefix}-${crypto.randomUUID().slice(0, 8).toUpperCase()}`
    const qtyNum = Math.trunc(Number(qty))
    const safeQty = Number.isInteger(qtyNum) && qtyNum > 0 ? qtyNum : 1
    const rawPrice = purchase_price ?? valuation
    const normalizedPrice = rawPrice === undefined || rawPrice === null || rawPrice === '' ? null : Number(rawPrice)
    const price = Number.isFinite(normalizedPrice) && normalizedPrice > 0 ? normalizedPrice : null
    const cleanVendor = vendor ? String(vendor).trim().slice(0, 200) : null
    const cleanReceiptUrl = cleanReceiptInput || null
    const wantsPurchased = Boolean(purchased) || price != null || Boolean(cleanVendor) || Boolean(cleanReceiptUrl)
    const isPurchased = wantsPurchased

    const { rows } = await db.query(
      `INSERT INTO units
         (name, category, serial, description, qty, condition, period, dimensions,
          valuation, status, is_admin_stock, created_by, created_via,
          purchased, purchase_price, purchase_date, vendor, receipt_url)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'on_stock',true,$10,'admin_stock',
               $11,$12,$13,$14,$15)
       RETURNING *`,
      [
        cleanName.slice(0, 200),
        cleanCategory,
        serial,
        description ? String(description).slice(0, 1000) : null,
        safeQty,
        condition ? String(condition).slice(0, 120) : null,
        period ? String(period).slice(0, 80) : null,
        dimensions ? String(dimensions).slice(0, 200) : null,
        price,
        req.user.id,
        isPurchased,
        isPurchased ? price : null,
        isPurchased && purchase_date ? purchase_date : null,
        isPurchased ? cleanVendor : null,
        isPurchased ? cleanReceiptUrl : null,
      ]
    )

    await db.query(
      `INSERT INTO unit_history (unit_id, action, user_id)
       VALUES ($1,'Создано в Админке',$2)`,
      [rows[0].id, req.user.id]
    )
    res.status(201).json({ unit: rows[0] })
  } catch (err) {
    console.error('admin-units create:', err)
    res.status(500).json({ error: 'Server error' })
  }
})

// POST /admin-units/upload-receipt — optional receipt image.
router.post('/upload-receipt', upload.single('receipt'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file' })
  try {
    const url = await uploadFile(req.file.buffer, req.file.originalname, 'receipts')
    res.json({ url })
  } catch (err) {
    console.error('admin-units receipt upload:', err)
    res.status(500).json({ error: 'Upload failed' })
  }
})

module.exports = router
