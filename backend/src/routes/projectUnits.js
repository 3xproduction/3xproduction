// Project-kept units: items owned by a specific project, never physically placed
// on a warehouse shelf/hanger/place. They exist only in the project inventory.
// Other projects cannot see them by default; the public catalog never lists them.

const router = require('express').Router()
const multer = require('multer')
const crypto = require('crypto')
const db = require('../db')
const { verifyJWT } = require('../middleware/auth')
const { uploadFile, uploadImageWithThumb } = require('../services/r2')
const { createNotification } = require('../services/notifications')
const { unitMissingFields, canSeeMissingUnitData } = require('../utils/unitMissingFields')

// Р РѕР»Рё, РєРѕС‚РѕСЂС‹Рµ РјРѕРіСѓС‚ РРќРР¦РРР РћР’РђРўР¬ Рё РџРћР”РўР’Р•Р Р–Р”РђРўР¬ РІРѕР·РІСЂР°С‚ СЃ Р»СЋР±РѕРіРѕ СЃРєР»Р°РґР° РїСЂРѕРµРєС‚Р°.
// РџРѕ С‚СЂРµР±РѕРІР°РЅРёСЋ Р·Р°РєР°Р·С‡РёРєР°: warehouse_director, warehouse_deputy, warehouse_staff, producer.
const RETURN_REQUESTER_ROLES = new Set([
  'warehouse_director', 'warehouse_deputy', 'warehouse_staff', 'producer',
])
// Р РѕР»Рё РїСЂРѕРµРєС‚Р°, РєРѕС‚РѕСЂС‹Рј РёРґС‘С‚ СѓРІРµРґРѕРјР»РµРЅРёРµ Рѕ РЅРµРѕР±С…РѕРґРёРјРѕСЃС‚Рё РІРµСЂРЅСѓС‚СЊ РµРґРёРЅРёС†Сѓ.
// РќР°Р±РѕСЂ РїРѕРІС‚РѕСЂСЏРµС‚ Р»РѕРіРёРєСѓ responderRolesForCategory РёР· colleagues.js.
const PROPS_RESPONDER_ROLES = [
  'project_director', 'production_designer', 'art_director_assistant',
  'props_master', 'props_assistant',
]
const COSTUMES_RESPONDER_ROLES = [
  'project_director', 'production_designer', 'costumer', 'costume_assistant',
]
const COSTUME_CATEGORIES = new Set(['costumes', 'shoes', 'jewelry', 'accessories', 'clothing'])
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
function responderRoles(category) {
  return COSTUME_CATEGORIES.has(category) ? COSTUMES_RESPONDER_ROLES : PROPS_RESPONDER_ROLES
}

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 100 * 1024 * 1024 },
})

// Roles allowed to add items to their project warehouse.
const PROJECT_WRITER_ROLES = new Set([
  'producer', 'project_director', 'director',
  'production_designer', 'art_director_assistant',
  'first_assistant_director', 'assistant_director',
  'props_master', 'props_assistant',
  'costumer', 'costume_assistant',
  'decorator', 'makeup_artist', 'extra_worker',
])

const WAREHOUSE_DIRECTOR_ROLES = new Set(['warehouse_director', 'warehouse_deputy'])
const PROJECT_INTAKE_ROLES = new Set(['warehouse_director', 'warehouse_deputy'])

async function createCellInSection(client, sectionId) {
  const { rows: countRows } = await client.query(
    `SELECT COUNT(*)::int AS n FROM cells WHERE section_id = $1`,
    [sectionId]
  )
  let next = (countRows[0].n || 0) + 1
  for (let attempt = 0; attempt < 10; attempt++) {
    try {
      const { rows } = await client.query(
        `INSERT INTO cells (section_id, code) VALUES ($1, $2) RETURNING id`,
        [sectionId, String(next)]
      )
      return rows[0].id
    } catch (err) {
      if (err.code === '23505') {
        next += 1
        continue
      }
      throw err
    }
  }
  throw new Error('Could not allocate cell code')
}
// Р РѕР»Рё, РєРѕС‚РѕСЂС‹Рј СЂР°Р·СЂРµС€РµРЅРѕ РїРµСЂРµРјРµС‰Р°С‚СЊ РµРґРёРЅРёС†С‹ СЃ С†РµРЅС‚СЂР°Р»СЊРЅРѕРіРѕ СЃРєР»Р°РґР° РЅР° СЃРєР»Р°Рґ РїСЂРѕРµРєС‚Р°.
// Р’РєР»СЋС‡Р°РµС‚ РєР»Р°РґРѕРІС‰РёРєРѕРІ (staff) вЂ” РїРѕ С‚СЂРµР±РѕРІР°РЅРёСЋ Р·Р°РєР°Р·С‡РёРєР°.
const MOVE_TO_PROJECT_ROLES = new Set([
  'warehouse_director', 'warehouse_deputy', 'warehouse_staff',
])
// Р РѕР»Рё, РєРѕС‚РѕСЂС‹Рµ РјРѕРіСѓС‚ Р·Р°Р±СЂР°С‚СЊ РµРґРёРЅРёС†Сѓ СЃ Р»СЋР±РѕРіРѕ СЃРєР»Р°РґР° РїСЂРѕРµРєС‚Р° РЅР° РѕР±С‰РёР№ СЃРєР»Р°Рґ
// РЅРµР·Р°РІРёСЃРёРјРѕ РѕС‚ СЃРІРѕРµР№ project_id (РґРёСЂРµРєС‚РѕСЂСЃРєРёР№ СѓСЂРѕРІРµРЅСЊ РєРѕРЅС‚СЂРѕР»СЏ РЅР°Рґ СЃРєР»Р°РґРѕРј).
const CROSS_PROJECT_TRANSFER_ROLES = new Set([
  'warehouse_director', 'warehouse_deputy', 'producer',
])
// Р РѕР»Рё, РєРѕС‚РѕСЂС‹Рј СЂР°Р·СЂРµС€РµРЅРѕ СЃРјРѕС‚СЂРµС‚СЊ СЃРєР»Р°Рґ Р»СЋР±РѕРіРѕ РїСЂРѕРµРєС‚Р° (selector РІ ProjectWarehousePage).
// Р”РёСЂРµРєС‚РѕСЂ/Р·Р°Рј СЃРєР»Р°РґР° + РїСЂРѕРґСЋСЃРµСЂ.
const ANY_PROJECT_VIEWER_ROLES = new Set([
  'warehouse_director', 'warehouse_deputy', 'producer',
])

function canWriteToProject(user) {
  return PROJECT_WRITER_ROLES.has(user.role)
}

// GET /project-units?project_id=&category=&source=
// РљР°С‚Р°Р»РѕРі СЃРєР»Р°РґР° РїСЂРѕРµРєС‚Р° вЂ” РѕР±СЉРµРґРёРЅСЏРµС‚ С‚СЂРё РёСЃС‚РѕС‡РЅРёРєР°:
//   1. own            вЂ” СЃРѕР±СЃС‚РІРµРЅРЅС‹Рµ (is_project_kept=true, project_id=me)
//   2. from_warehouse вЂ” РІР·СЏС‚С‹Рµ СЃ РѕР±С‰РµРіРѕ СЃРєР»Р°РґР° РїРѕ Р°РєС‚РёРІРЅРѕР№ РІС‹РґР°С‡Рµ РЅР° РїСЂРѕРµРєС‚
//   3. from_project   вЂ” РѕРґРѕР»Р¶РµРЅРЅС‹Рµ Сѓ РґСЂСѓРіРѕРіРѕ РїСЂРѕРµРєС‚Р° (on_loan_to_project_id=me)
// РљР°Р¶РґР°СЏ СЃС‚СЂРѕРєР° РёРјРµРµС‚ РїРѕР»Рµ `source` Рё РјРµС‚Р°РґР°РЅРЅС‹Рµ (issuance_id/loan_request_id Рё С‚.Рґ.).
// РџР°СЂР°РјРµС‚СЂ source (РѕРїС†.) вЂ” С„РёР»СЊС‚СЂ: 'own' | 'from_warehouse' | 'from_project'.
// Warehouse-РґРёСЂРµРєС‚РѕСЂР° РјРѕРіСѓС‚ СЃРјРѕС‚СЂРµС‚СЊ Р»СЋР±РѕР№ РїСЂРѕРµРєС‚ С‡РµСЂРµР· ?project_id=.
router.get('/', verifyJWT, async (req, res) => {
  try {
    const requestedProject = req.query.project_id
    const canViewAny = ANY_PROJECT_VIEWER_ROLES.has(req.user.role)
    const projectId = requestedProject || req.user.project_id
    if (!projectId) return res.json({ units: [] })
    if (!canViewAny && String(projectId) !== String(req.user.project_id)) {
      return res.status(403).json({ error: 'Forbidden' })
    }

    const canSeePendingRequestDetails =
      RETURN_REQUESTER_ROLES.has(req.user.role) ||
      (req.user.project_id && String(projectId) === String(req.user.project_id))
    const params = [projectId, req.user.project_id || null, canSeePendingRequestDetails]
    let q = `
      WITH sources AS (
        -- 1. РЎРІРѕРё РµРґРёРЅРёС†С‹ РїСЂРѕРµРєС‚Р°
        SELECT u.id AS unit_id,
               'own'::text AS source,
               NULL::text AS loan_from_project_name,
               NULL::uuid AS loan_request_id,
               NULL::date AS loan_deadline,
               NULL::uuid AS issuance_id,
               NULL::timestamptz AS issued_at,
               NULL::date AS issued_deadline,
               u.created_at AS sort_at
        FROM units u
        WHERE u.is_project_kept = true
          AND u.project_id = $1
          AND u.status != 'written_off'

        UNION ALL

        -- 2. Р’С‹РґР°РЅРѕ СЃ РѕР±С‰РµРіРѕ СЃРєР»Р°РґР° РЅР° СЌС‚РѕС‚ РїСЂРѕРµРєС‚ (С„РёР·РёС‡РµСЃРєРё РЅР° СЂСѓРєР°С…).
        -- РСЃС‚РѕС‡РЅРёРє СЃРІСЏР·Рё РїСЂРѕРµРєС‚Р° вЂ” receiver.project_id (Р° РЅРµ requests.project_id),
        -- С‚.Рє. walk-in РІС‹РґР°С‡Рё Рё С‡Р°СЃС‚СЊ legacy-Р·Р°СЏРІРѕРє РЅРµ РёРјРµСЋС‚ project_id РІ requests.
        SELECT fw.unit_id, 'from_warehouse',
               NULL, NULL, NULL,
               fw.issuance_id, fw.issued_at, fw.deadline,
               fw.issued_at
        FROM (
          SELECT DISTINCT ON (u.id)
                 u.id AS unit_id, iss.id AS issuance_id, iss.issued_at, iss.deadline
          FROM units u
          JOIN requests req  ON u.id = ANY(req.unit_ids)
          JOIN issuances iss ON iss.request_id = req.id
          JOIN users rcv     ON rcv.id = iss.received_by AND rcv.project_id = $1
          WHERE u.status IN ('issued','overdue')
            AND u.on_loan_to_project_id IS NULL
            AND NOT EXISTS (SELECT 1 FROM returns r WHERE r.issuance_id = iss.id)
          ORDER BY u.id, iss.issued_at DESC NULLS LAST
        ) fw

        UNION ALL

        -- 3. РћРґРѕР»Р¶РµРЅРѕ Сѓ РґСЂСѓРіРѕРіРѕ РїСЂРѕРµРєС‚Р°
        SELECT u.id, 'from_project',
               fp.name, lr.id, lr.deadline,
               NULL, NULL, NULL,
               lr.decided_at
        FROM units u
        JOIN project_loan_requests lr ON lr.unit_id = u.id AND lr.status = 'accepted'
        JOIN projects fp ON fp.id = lr.from_project_id
        WHERE u.on_loan_to_project_id = $1
      )
      SELECT s.source, s.loan_from_project_name, s.loan_request_id, s.loan_deadline,
             s.issuance_id, s.issued_at, s.issued_deadline,
             u.*, p.name AS project_name,
             u.source AS unit_source_for_missing,
             uc.name AS created_by_name,
             (SELECT url FROM unit_photos WHERE unit_id = u.id
              ORDER BY CASE WHEN url ~* '\\.(mp4|webm|mov)$' THEN 1 ELSE 0 END, created_at LIMIT 1) AS photo_url,
             (SELECT thumb_url FROM unit_photos WHERE unit_id = u.id
              ORDER BY CASE WHEN url ~* '\\.(mp4|webm|mov)$' THEN 1 ELSE 0 END, created_at LIMIT 1) AS photo_thumb_url,
             (SELECT json_build_object(
                'id', plr.id,
                'to_project_id', CASE WHEN $3::boolean OR plr.to_project_id = $2::uuid THEN plr.to_project_id ELSE NULL END,
                'to_project_name', CASE WHEN $3::boolean OR plr.to_project_id = $2::uuid THEN tp.name ELSE NULL END,
                'requested_by_name', CASE WHEN $3::boolean OR plr.to_project_id = $2::uuid THEN ru.name ELSE NULL END,
                'created_at', CASE WHEN $3::boolean OR plr.to_project_id = $2::uuid THEN plr.created_at ELSE NULL END,
                'deadline', CASE WHEN $3::boolean OR plr.to_project_id = $2::uuid THEN plr.deadline ELSE NULL END
              )
              FROM project_loan_requests plr
              JOIN projects tp ON tp.id = plr.to_project_id
              JOIN users ru ON ru.id = plr.requested_by
              WHERE plr.unit_id = u.id AND plr.status = 'pending'
              ORDER BY plr.created_at DESC LIMIT 1) AS pending_loan_request
      FROM sources s
      JOIN units u ON u.id = s.unit_id
      LEFT JOIN projects p ON p.id = u.project_id
      LEFT JOIN users uc ON uc.id = u.created_by
      WHERE 1=1
    `
    if (req.query.category) {
      params.push(req.query.category)
      q += ` AND u.category = $${params.length}`
    }
    if (req.query.source) {
      params.push(req.query.source)
      q += ` AND s.source = $${params.length}`
    }
    if (req.query.created_by_me === '1') {
      params.push(req.user.id)
      q += ` AND u.created_by = $${params.length}`
    }
    q += ` ORDER BY s.sort_at DESC NULLS LAST, u.created_at DESC`
    const { rows } = await db.query(q, params)
    const units = rows.map(({ search_vector, search_tags, unit_source_for_missing, ...rest }) => {
      if (canSeeMissingUnitData(req.user.role)) {
        rest.missing_fields = unitMissingFields({ ...rest, source: unit_source_for_missing })
      }
      return rest
    })
    res.json({ units })
  } catch (err) {
    console.error('project-units list:', err)
    res.json({ units: [] })
  }
})

// POST /project-units вЂ” create a project-kept unit (no approval).
router.post('/', verifyJWT, async (req, res) => {
  if (!canWriteToProject(req.user)) return res.status(403).json({ error: 'Forbidden' })
  if (!req.user.project_id) return res.status(400).json({ error: 'User has no project' })

  const { name, category, description, qty, condition, period,
          purchased, purchase_price, purchase_date, vendor, receipt_url,
          valuation, serial } = req.body

  if (!name || !category) return res.status(400).json({ error: 'Name and category required' })
  if (purchased && (!receipt_url || !purchase_price)) {
    return res.status(400).json({ error: 'For purchased items receipt and price are required' })
  }

  try {
    // Project-kept units use status='on_stock' conceptually (owned and in-use)
    // but carry is_project_kept=true and no cell/warehouse.
    const { rows } = await db.query(
      `INSERT INTO units
         (name, category, serial, description, qty, condition, period,
          valuation, status, is_project_kept, project_id, created_by,
          purchased, purchase_price, purchase_date, vendor, receipt_url)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'on_stock',true,$9,$10,$11,$12,$13,$14,$15) RETURNING *`,
      [
        name, category, serial || null, description || null,
        qty || 1, condition || null, period || null,
        purchased ? (purchase_price || valuation || null) : (valuation || null),
        req.user.project_id, req.user.id,
        Boolean(purchased),
        purchase_price || null,
        purchase_date || null,
        vendor || null,
        receipt_url || null,
      ]
    )
    await db.query(
      `INSERT INTO unit_history (unit_id, action, user_id) VALUES ($1,'РЎРѕР·РґР°РЅРѕ РЅР° СЃРєР»Р°РґРµ РїСЂРѕРµРєС‚Р°',$2)`,
      [rows[0].id, req.user.id]
    )
    res.json({ unit: rows[0] })
  } catch (err) {
    console.error('project-unit create:', err)
    res.status(500).json({ error: 'Server error' })
  }
})

// POST /project-units/upload-receipt вЂ” upload receipt image, returns URL.
router.post('/upload-receipt', verifyJWT, upload.single('receipt'), async (req, res) => {
  if (!canWriteToProject(req.user)) return res.status(403).json({ error: 'Forbidden' })
  if (!req.file) return res.status(400).json({ error: 'No file' })
  try {
    const url = await uploadFile(req.file.buffer, req.file.originalname, 'receipts')
    res.json({ url })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Upload failed' })
  }
})

// POST /project-units/create-for-project-photo вЂ” warehouse creates a project-kept unit
// from an AI-recognized photo when the central warehouse search found no match.
router.post('/create-for-project-photo', verifyJWT, upload.fields([
  { name: 'photo', maxCount: 1 },
  { name: 'photos', maxCount: 10 },
]), async (req, res) => {
  if (!MOVE_TO_PROJECT_ROLES.has(req.user.role)) return res.status(403).json({ error: 'Forbidden' })
  const { project_id, name, category, description, qty, condition, period, dimensions, valuation, source } = req.body || {}
  if (!project_id) return res.status(400).json({ error: 'project_id required' })
  if (!name || !category) return res.status(400).json({ error: 'Name and category required' })
  const photoFiles = [
    ...((req.files && req.files.photo) || []),
    ...((req.files && req.files.photos) || []),
  ]
  if (!photoFiles.length) return res.status(400).json({ error: 'Photo required' })

  const { rows: proj } = await db.query(`SELECT id, name FROM projects WHERE id = $1`, [project_id])
  if (!proj.length) return res.status(404).json({ error: 'РџСЂРѕРµРєС‚ РЅРµ РЅР°Р№РґРµРЅ' })

  const client = await db.getClient()
  try {
    await client.query('BEGIN')

    const catPrefix = String(category || 'XX').slice(0, 3).toUpperCase()
    const serial = `${catPrefix}-${crypto.randomUUID().slice(0, 8).toUpperCase()}`
    const safeQty = Number.isFinite(Number(qty)) && Number(qty) > 0 ? Number(qty) : 1

    const { rows: ins } = await client.query(
      `INSERT INTO units (name, category, serial, qty, description, condition, period, dimensions, valuation, source,
                          status, is_project_kept, project_id, created_by, created_via)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'on_stock',true,$11,$12,'photo_project_transfer')
       RETURNING *`,
      [
        String(name).trim().slice(0, 200),
        String(category).trim(),
        serial,
        safeQty,
        description ? String(description).slice(0, 1000) : null,
        condition ? String(condition).slice(0, 120) : null,
        period ? String(period).slice(0, 80) : null,
        dimensions ? String(dimensions).slice(0, 200) : null,
        valuation ? Number(valuation) : null,
        source ? String(source).slice(0, 120) : null,
        project_id,
        req.user.id,
      ]
    )
    const unit = ins[0]

    const photos = []
    for (const file of photoFiles) {
      const { url, thumbUrl } = await uploadImageWithThumb(file.buffer, file.originalname || 'photo.jpg', 'units')
      photos.push({ url, thumbUrl })
      await client.query(
        `INSERT INTO unit_photos (unit_id, url, thumb_url, type) VALUES ($1,$2,$3,'stock')`,
        [unit.id, url, thumbUrl]
      )
    }
    await client.query(
      `INSERT INTO unit_history (unit_id, action, user_id, project_id)
       VALUES ($1,'РЎРѕР·РґР°РЅРѕ РЅР° СЃРєР»Р°РґРµ РїСЂРѕРµРєС‚Р° РїРѕ С„РѕС‚Рѕ',$2,$3)`,
      [unit.id, req.user.id, project_id]
    )

    await client.query('COMMIT')
    res.json({
      ok: true,
      unit: {
        ...unit,
        photo_url: photos[0]?.url || null,
        photo_thumb_url: photos[0]?.thumbUrl || null,
      },
      project: proj[0],
    })
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {})
    console.error('project-unit create-for-project-photo:', err)
    res.status(500).json({ error: 'Server error' })
  } finally {
    client.release()
  }
})

// POST /project-units/intake-to-warehouse-photo
// Director/deputy creates a regular warehouse unit from a project handoff
// when there was no previous issuance in the database.
router.post('/intake-to-warehouse-photo', verifyJWT, upload.fields([
  { name: 'photo', maxCount: 1 },
  { name: 'photos', maxCount: 10 },
]), async (req, res) => {
  if (!PROJECT_INTAKE_ROLES.has(req.user.role)) return res.status(403).json({ error: 'Forbidden' })
  const {
    project_id, name, category, description, qty, condition, period, dimensions,
    valuation, source, comment, warehouse_id, section_id, cell_id,
  } = req.body || {}
  if (!project_id) return res.status(400).json({ error: 'project_id required' })
  if (!name || !category) return res.status(400).json({ error: 'Name and category required' })
  for (const [field, value] of Object.entries({ warehouse_id, section_id, cell_id })) {
    if (value && !UUID_RE.test(String(value))) return res.status(400).json({ error: `${field} is invalid` })
  }
  const photoFiles = [
    ...((req.files && req.files.photo) || []),
    ...((req.files && req.files.photos) || []),
  ]
  if (!photoFiles.length) return res.status(400).json({ error: 'Photo required' })

  const { rows: proj } = await db.query(`SELECT id, name FROM projects WHERE id = $1`, [project_id])
  if (!proj.length) return res.status(404).json({ error: 'Project not found' })

  const client = await db.getClient()
  try {
    await client.query('BEGIN')

    let targetWarehouseId = warehouse_id || null
    let targetCellId = cell_id || null

    if (targetWarehouseId) {
      const { rows: whRows } = await client.query(
        `SELECT id FROM warehouses WHERE id = $1`,
        [targetWarehouseId]
      )
      if (!whRows.length) {
        await client.query('ROLLBACK')
        return res.status(400).json({ error: 'Warehouse not found' })
      }
    }

    if (section_id) {
      const { rows: secRows } = await client.query(
        `SELECT id, warehouse_id, type FROM warehouse_sections WHERE id = $1`,
        [section_id]
      )
      if (!secRows.length) {
        await client.query('ROLLBACK')
        return res.status(400).json({ error: 'Section not found' })
      }
      const section = secRows[0]
      if (section.type === 'hall') {
        await client.query('ROLLBACK')
        return res.status(400).json({ error: 'Cannot place a unit directly into a hall' })
      }
      if (targetWarehouseId && String(section.warehouse_id) !== String(targetWarehouseId)) {
        await client.query('ROLLBACK')
        return res.status(400).json({ error: 'Section does not belong to warehouse' })
      }
      targetWarehouseId = section.warehouse_id
      if (!targetCellId) targetCellId = await createCellInSection(client, section.id)
    }

    if (targetCellId) {
      const { rows: cellRows } = await client.query(
        `SELECT c.id, c.section_id, sec.warehouse_id
           FROM cells c
           JOIN warehouse_sections sec ON sec.id = c.section_id
          WHERE c.id = $1`,
        [targetCellId]
      )
      if (!cellRows.length) {
        await client.query('ROLLBACK')
        return res.status(400).json({ error: 'Cell not found' })
      }
      const targetCell = cellRows[0]
      if (section_id && String(targetCell.section_id) !== String(section_id)) {
        await client.query('ROLLBACK')
        return res.status(400).json({ error: 'Cell does not belong to section' })
      }
      if (targetWarehouseId && String(targetCell.warehouse_id) !== String(targetWarehouseId)) {
        await client.query('ROLLBACK')
        return res.status(400).json({ error: 'Cell does not belong to warehouse' })
      }
      targetWarehouseId = targetCell.warehouse_id
    }

    const catPrefix = String(category || 'XX').slice(0, 3).toUpperCase()
    const serial = `${catPrefix}-${crypto.randomUUID().slice(0, 8).toUpperCase()}`
    const safeQty = Number.isFinite(Number(qty)) && Number(qty) > 0 ? Number(qty) : 1
    const projectSource = source
      ? String(source).slice(0, 120)
      : `Project intake: ${proj[0].name}`.slice(0, 120)

    const { rows: ins } = await client.query(
      `INSERT INTO units (name, category, serial, qty, description, condition, period, dimensions, valuation, source,
                          warehouse_id, cell_id, status, is_project_kept, project_id, created_by, created_via)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'on_stock',false,NULL,$13,'project_intake')
       RETURNING *`,
      [
        String(name).trim().slice(0, 200),
        String(category).trim(),
        serial,
        safeQty,
        description ? String(description).slice(0, 1000) : null,
        condition ? String(condition).slice(0, 120) : null,
        period ? String(period).slice(0, 80) : null,
        dimensions ? String(dimensions).slice(0, 200) : null,
        valuation ? Number(valuation) : null,
        projectSource,
        targetWarehouseId,
        targetCellId,
        req.user.id,
      ]
    )
    const unit = ins[0]

    const photos = []
    for (const file of photoFiles) {
      const { url, thumbUrl } = await uploadImageWithThumb(file.buffer, file.originalname || 'photo.jpg', 'units')
      photos.push({ url, thumbUrl })
      await client.query(
        `INSERT INTO unit_photos (unit_id, url, thumb_url, type) VALUES ($1,$2,$3,'stock')`,
        [unit.id, url, thumbUrl]
      )
    }

    await client.query(
      `INSERT INTO unit_history (unit_id, action, user_id, project_id, notes)
       VALUES ($1,$2,$3,$4,$5)`,
      [
        unit.id,
        '\u041f\u0440\u0438\u043d\u044f\u0442\u043e \u043e\u0442 \u043f\u0440\u043e\u0435\u043a\u0442\u0430',
        req.user.id,
        project_id,
        comment ? String(comment).slice(0, 500) : null,
      ]
    )

    await client.query('COMMIT')
    res.json({
      ok: true,
      unit: {
        ...unit,
        photo_url: photos[0]?.url || null,
        photo_thumb_url: photos[0]?.thumbUrl || null,
      },
      project: proj[0],
    })
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {})
    console.error('project-unit intake-to-warehouse-photo:', err)
    res.status(500).json({ error: 'Server error' })
  } finally {
    client.release()
  }
})

// POST /project-units/:id/record-intake
// Adds an audit entry when a project handoff is matched to an existing unit.
router.post('/:id/record-intake', verifyJWT, async (req, res) => {
  if (!PROJECT_INTAKE_ROLES.has(req.user.role)) return res.status(403).json({ error: 'Forbidden' })
  const { project_id, comment } = req.body || {}
  if (!project_id) return res.status(400).json({ error: 'project_id required' })
  try {
    const { rows: proj } = await db.query(`SELECT id, name FROM projects WHERE id = $1`, [project_id])
    if (!proj.length) return res.status(404).json({ error: 'Project not found' })
    const { rows } = await db.query(
      `SELECT id, status, is_project_kept, is_admin_stock FROM units WHERE id = $1`,
      [req.params.id]
    )
    if (!rows.length) return res.status(404).json({ error: 'Unit not found' })
    const unit = rows[0]
    if (unit.is_admin_stock) return res.status(400).json({ error: 'Admin stock is not supported here' })
    if (unit.is_project_kept || unit.status !== 'on_stock') {
      return res.status(400).json({ error: 'Only common on-stock units can be matched' })
    }
    await db.query(
      `INSERT INTO unit_history (unit_id, action, user_id, project_id, notes)
       VALUES ($1,$2,$3,$4,$5)`,
      [
        req.params.id,
        '\u041f\u0440\u0438\u043d\u044f\u0442\u043e \u043e\u0442 \u043f\u0440\u043e\u0435\u043a\u0442\u0430',
        req.user.id,
        project_id,
        comment ? String(comment).slice(0, 500) : null,
      ]
    )
    res.json({ ok: true, project: proj[0] })
  } catch (err) {
    console.error('project-unit record-intake:', err)
    res.status(500).json({ error: 'Server error' })
  }
})

// PUT /project-units/:id вЂ” edit a project-kept unit.
router.put('/:id', verifyJWT, async (req, res) => {
  if (!canWriteToProject(req.user) && !WAREHOUSE_DIRECTOR_ROLES.has(req.user.role)) {
    return res.status(403).json({ error: 'Forbidden' })
  }
  try {
    const { rows: existing } = await db.query(
      `SELECT * FROM units WHERE id = $1 AND is_project_kept = true`, [req.params.id]
    )
    if (!existing.length) return res.status(404).json({ error: 'Not found' })
    if (!WAREHOUSE_DIRECTOR_ROLES.has(req.user.role)
        && String(existing[0].project_id) !== String(req.user.project_id)) {
      return res.status(403).json({ error: 'Forbidden' })
    }
    const { name, category, serial, description, qty, condition, period,
            valuation, purchased, purchase_price, purchase_date, vendor, receipt_url } = req.body
    const { rows } = await db.query(
      `UPDATE units SET name=$1, category=$2, serial=$3, description=$4, qty=$5,
        condition=$6, period=$7, valuation=$8, purchased=$9,
        purchase_price=$10, purchase_date=$11, vendor=$12, receipt_url=$13
       WHERE id=$14 RETURNING *`,
      [name, category, serial || null, description || null, qty || 1,
       condition || null, period || null, valuation || null,
       Boolean(purchased), purchase_price || null, purchase_date || null,
       vendor || null, receipt_url || null, req.params.id]
    )
    res.json({ unit: rows[0] })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Server error' })
  }
})

// DELETE /project-units/:id вЂ” soft delete = write-off.
router.delete('/:id', verifyJWT, async (req, res) => {
  if (!canWriteToProject(req.user)) return res.status(403).json({ error: 'Forbidden' })
  try {
    const { rows } = await db.query(
      `SELECT * FROM units WHERE id = $1 AND is_project_kept = true`, [req.params.id]
    )
    if (!rows.length) return res.status(404).json({ error: 'Not found' })
    if (String(rows[0].project_id) !== String(req.user.project_id)) {
      return res.status(403).json({ error: 'Forbidden' })
    }
    await db.query(`UPDATE units SET status='written_off' WHERE id=$1`, [req.params.id])
    await db.query(
      `INSERT INTO unit_history (unit_id, action, user_id, notes) VALUES ($1,'РЎРїРёСЃР°РЅРѕ СЃРѕ СЃРєР»Р°РґР° РїСЂРѕРµРєС‚Р°',$2,$3)`,
      [req.params.id, req.user.id, req.body?.reason || null]
    )
    res.json({ ok: true })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Server error' })
  }
})

// POST /project-units/:id/transfer-to-warehouse вЂ” immediate transfer (approvals removed).
// Р•РґРёРЅРёС†Р° СЃСЂР°Р·Сѓ СѓС…РѕРґРёС‚ РёР· СЃРєР»Р°РґР° РїСЂРѕРµРєС‚Р° РІ РѕР±С‰РёР№ СЃРєР»Р°Рґ Р±РµР· pending-СЌС‚Р°РїР°. Р•СЃР»Рё
// СѓРєР°Р·Р°РЅС‹ warehouse_id Рё cell_id вЂ” СЃСЂР°Р·Сѓ СЂР°СЃРєР»Р°РґС‹РІР°РµС‚СЃСЏ РЅР° РїРѕР»РєСѓ; РёРЅР°С‡Рµ Р»РµР¶РёС‚
// Р±РµР· РјРµСЃС‚Р° Рё РґРёСЂРµРєС‚РѕСЂ/Р·Р°Рј СЃРєР»Р°РґР° СЂР°СЃСЃС‚Р°РІР»СЏСЋС‚ РІСЂСѓС‡РЅСѓСЋ РёР· UnitsPage.
router.post('/:id/transfer-to-warehouse', verifyJWT, async (req, res) => {
  if (!canWriteToProject(req.user) && !CROSS_PROJECT_TRANSFER_ROLES.has(req.user.role)) {
    return res.status(403).json({ error: 'Forbidden' })
  }
  try {
    const { rows } = await db.query(
      `SELECT * FROM units WHERE id = $1 AND is_project_kept = true`, [req.params.id]
    )
    if (!rows.length) return res.status(404).json({ error: 'Not found' })
    if (!CROSS_PROJECT_TRANSFER_ROLES.has(req.user.role)
        && String(rows[0].project_id) !== String(req.user.project_id)) {
      return res.status(403).json({ error: 'Forbidden' })
    }
    const { warehouse_id, cell_id } = req.body || {}
    const comment = (req.body?.comment || '').toString().slice(0, 500)

    // Р’Р°Р»РёРґР°С†РёСЏ РєР°С‚РµРіРѕСЂРёРё/С‚РёРїР° СЃРµРєС†РёРё РѕС‚РєР»СЋС‡РµРЅР° вЂ” РјРµСЃС‚Р° Р±РµР·Р»РёРјРёС‚РЅС‹Рµ.
    if (cell_id) {
      const { rows: secRows } = await db.query(
        `SELECT c.id FROM cells c WHERE c.id = $1`,
        [cell_id]
      )
      if (!secRows.length) return res.status(400).json({ error: 'РЇС‡РµР№РєР° РЅРµ РЅР°Р№РґРµРЅР°' })
    }

    await db.query(
      `UPDATE units
         SET is_project_kept=false, project_id=NULL, pending_transfer=false,
             warehouse_id=COALESCE($2, warehouse_id),
             cell_id=COALESCE($3, cell_id)
       WHERE id=$1`,
      [req.params.id, warehouse_id || null, cell_id || null]
    )
    await db.query(
      `INSERT INTO unit_history (unit_id, action, user_id, project_id, notes)
       VALUES ($1,'РџРµСЂРµРґР°РЅРѕ РЅР° РѕР±С‰РёР№ СЃРєР»Р°Рґ',$2,$3,$4)`,
      [req.params.id, req.user.id, rows[0].project_id || null, comment || null]
    )
    res.json({ ok: true })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Server error' })
  }
})

// POST /project-units/:id/return-to-project вЂ” warehouse staff sends a warehouse unit
// into a project inventory (used when the project temporarily wants it on hand).
router.post('/:id/return-to-project', verifyJWT, async (req, res) => {
  if (!MOVE_TO_PROJECT_ROLES.has(req.user.role)) return res.status(403).json({ error: 'Forbidden' })
  const { project_id } = req.body || {}
  if (!project_id) return res.status(400).json({ error: 'project_id required' })
  try {
    const { rows: proj } = await db.query(`SELECT id FROM projects WHERE id = $1`, [project_id])
    if (!proj.length) return res.status(404).json({ error: 'РџСЂРѕРµРєС‚ РЅРµ РЅР°Р№РґРµРЅ' })
    const { rows } = await db.query(`SELECT * FROM units WHERE id = $1`, [req.params.id])
    if (!rows.length) return res.status(404).json({ error: 'Not found' })
    const u = rows[0]
    if (u.is_project_kept) return res.status(400).json({ error: 'Р•РґРёРЅРёС†Р° СѓР¶Рµ РЅР° СЃРєР»Р°РґРµ РїСЂРѕРµРєС‚Р°' })
    if (u.status !== 'on_stock') {
      return res.status(400).json({ error: 'РџРµСЂРµРјРµС‰Р°С‚СЊ РјРѕР¶РЅРѕ С‚РѕР»СЊРєРѕ РµРґРёРЅРёС†С‹ СЃРѕ СЃС‚Р°С‚СѓСЃРѕРј В«РЅР° СЃРєР»Р°РґРµВ»' })
    }
    await db.query(
      `UPDATE units SET is_project_kept=true, project_id=$2, pending_transfer=false,
                         warehouse_id=NULL, cell_id=NULL, pavilion_id=NULL
       WHERE id=$1`,
      [req.params.id, project_id]
    )
    await db.query(
      `INSERT INTO unit_history (unit_id, action, user_id, project_id) VALUES ($1,'РџРµСЂРµРјРµС‰РµРЅРѕ РЅР° СЃРєР»Р°Рґ РїСЂРѕРµРєС‚Р°',$2,$3)`,
      [req.params.id, req.user.id, project_id]
    )
    res.json({ ok: true })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Server error' })
  }
})

// POST /project-units/move-to-project вЂ” batch-РїРµСЂРµРјРµС‰РµРЅРёРµ РЅРµСЃРєРѕР»СЊРєРёС… РµРґРёРЅРёС†
// СЃ С†РµРЅС‚СЂР°Р»СЊРЅРѕРіРѕ СЃРєР»Р°РґР° РЅР° СЃРєР»Р°Рґ РїСЂРѕРµРєС‚Р°. РўРµР»Рѕ: { unit_ids: [], project_id }.
// РџРѕРґС…РѕРґСЏС‰РёРµ РµРґРёРЅРёС†С‹ (status='on_stock', РЅРµ РЅР° СЃРєР»Р°РґРµ РїСЂРѕРµРєС‚Р°) РїРµСЂРµРјРµС‰Р°СЋС‚СЃСЏ;
// РѕСЃС‚Р°Р»СЊРЅС‹Рµ РІРѕР·РІСЂР°С‰Р°СЋС‚СЃСЏ РІ errors[] СЃ РїРѕРЅСЏС‚РЅРѕР№ РїСЂРёС‡РёРЅРѕР№ вЂ” UI РїРѕРєР°Р¶РµС‚ С‚РѕСЃС‚С‹.
router.post('/move-to-project', verifyJWT, async (req, res) => {
  if (!MOVE_TO_PROJECT_ROLES.has(req.user.role)) return res.status(403).json({ error: 'Forbidden' })
  const { unit_ids, project_id } = req.body || {}
  if (!project_id) return res.status(400).json({ error: 'project_id required' })
  if (!Array.isArray(unit_ids) || unit_ids.length === 0) {
    return res.status(400).json({ error: 'unit_ids required' })
  }
  const errors = []
  const ids = []
  for (const rawId of unit_ids) {
    if (typeof rawId !== 'string' || !UUID_RE.test(rawId)) {
      errors.push({ id: String(rawId || ''), reason: 'РЅРµРєРѕСЂСЂРµРєС‚РЅС‹Р№ id' })
      continue
    }
    ids.push(rawId)
  }
  if (ids.length === 0) return res.status(400).json({ error: 'unit_ids empty' })

  // РџСЂРѕРІРµСЂСЏРµРј СЃСѓС‰РµСЃС‚РІРѕРІР°РЅРёРµ РїСЂРѕРµРєС‚Р° вЂ” РёРЅР°С‡Рµ СЃР»РѕРІРёРј FK violation РІ РјР°СЃСЃРѕРІРѕРј UPDATE.
  const { rows: proj } = await db.query(`SELECT id, name FROM projects WHERE id = $1`, [project_id])
  if (!proj.length) return res.status(404).json({ error: 'РџСЂРѕРµРєС‚ РЅРµ РЅР°Р№РґРµРЅ' })

  const client = await db.getClient()
  const moved = []
  try {
    await client.query('BEGIN')
    const { rows: units } = await client.query(
      `SELECT id, name, status, is_project_kept FROM units WHERE id = ANY($1::uuid[]) FOR UPDATE`,
      [ids]
    )
    const seen = new Map(units.map(u => [u.id, u]))

    const reasonByStatus = {
      issued: 'РІС‹РґР°РЅР°', overdue: 'РїСЂРѕСЃСЂРѕС‡РµРЅР°', debt: 'РІ РґРѕР»РіРµ',
      written_off: 'СЃРїРёСЃР°РЅР°', pending: 'Р¶РґС‘С‚ СЃРѕРіР»Р°СЃРѕРІР°РЅРёСЏ',
    }

    for (const id of ids) {
      const u = seen.get(id)
      if (!u) { errors.push({ id, reason: 'РЅРµ РЅР°Р№РґРµРЅР°' }); continue }
      if (u.is_project_kept) { errors.push({ id, name: u.name, reason: 'СѓР¶Рµ РЅР° СЃРєР»Р°РґРµ РїСЂРѕРµРєС‚Р°' }); continue }
      if (u.status !== 'on_stock') {
        errors.push({ id, name: u.name, reason: reasonByStatus[u.status] || `СЃС‚Р°С‚СѓСЃ ${u.status}` })
        continue
      }
      moved.push(u)
    }

    if (moved.length) {
      const movedIds = moved.map(u => u.id)
      await client.query(
        `UPDATE units SET is_project_kept=true, project_id=$2, pending_transfer=false,
                          warehouse_id=NULL, cell_id=NULL, pavilion_id=NULL
         WHERE id = ANY($1::uuid[])`,
        [movedIds, project_id]
      )
      // Р’СЃС‚Р°РІР»СЏРµРј РёСЃС‚РѕСЂРёСЋ РѕРґРЅРѕР№ РјСѓР»СЊС‚Рё-VALUES вЂ” Р±РµР· С†РёРєР»Р° РѕС‚РґРµР»СЊРЅС‹С… INSERT'РѕРІ.
      const userParamIdx = movedIds.length + 1
      const projectParamIdx = movedIds.length + 2
      const valuesSql = movedIds.map((_, i) => `($${i + 1},'РџРµСЂРµРјРµС‰РµРЅРѕ РЅР° СЃРєР»Р°Рґ РїСЂРѕРµРєС‚Р°',$${userParamIdx},$${projectParamIdx})`).join(',')
      await client.query(
        `INSERT INTO unit_history (unit_id, action, user_id, project_id) VALUES ${valuesSql}`,
        [...movedIds, req.user.id, project_id]
      )
    }

    await client.query('COMMIT')
    res.json({
      ok: true,
      moved_count: moved.length,
      errors,
      project: proj[0],
    })
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {})
    console.error('move-to-project batch error:', err)
    res.status(500).json({ error: 'Server error' })
  } finally {
    client.release()
  }
})

// GET /project-units/projects вЂ” СЃРїРёСЃРѕРє РІСЃРµС… РїСЂРѕРµРєС‚РѕРІ РґР»СЏ СЃРµР»РµРєС‚РѕСЂР° РІ ProjectWarehousePage
// Рё РґР»СЏ РјРѕРґР°Р»РєРё В«РџРµСЂРµРјРµСЃС‚РёС‚СЊ РЅР° СЃРєР»Р°Рґ РїСЂРѕРµРєС‚Р°В» РІ РєР°С‚Р°Р»РѕРіРµ СЃРєР»Р°РґР°.
// Р”РѕСЃС‚СѓРїРЅРѕ warehouse_director / warehouse_deputy / producer / warehouse_staff
// (staff РЅСѓР¶РµРЅ СЃРїРёСЃРѕРє РґР»СЏ batch-РїРµСЂРµРјРµС‰РµРЅРёСЏ, РёРЅР°С‡Рµ СЃРµР»РµРєС‚РѕСЂ РїСѓСЃС‚).
// available_count СЃС‡РёС‚Р°РµС‚СЃСЏ С‚СЂРµРјСЏ РЅРµР·Р°РІРёСЃРёРјС‹РјРё Р·Р°РїСЂРѕСЃР°РјРё Рё СЃСѓРјРјРёСЂСѓРµС‚СЃСЏ РІ JS
// (РЅР°РґС‘Р¶РЅРµРµ С‡РµРј PG-LATERAL, СЃРј. РєРѕРјРјРµРЅС‚Р°СЂРёР№ РІ /colleagues/projects).
router.get('/projects', verifyJWT, async (req, res) => {
  const allowed = ANY_PROJECT_VIEWER_ROLES.has(req.user.role) || MOVE_TO_PROJECT_ROLES.has(req.user.role)
  if (!allowed) {
    return res.status(403).json({ error: 'Forbidden' })
  }
  try {
    const [{ rows: projects }, { rows: ownC }, { rows: whC }, { rows: loanC }] = await Promise.all([
      db.query(`SELECT id, name FROM projects ORDER BY name`),
      db.query(
        `SELECT project_id AS pid, COUNT(*)::int AS cnt
         FROM units
         WHERE is_project_kept = true AND status != 'written_off' AND project_id IS NOT NULL
         GROUP BY project_id`),
      db.query(
        `SELECT rcv.project_id AS pid, COUNT(DISTINCT u.id)::int AS cnt
         FROM issuances iss
         JOIN users rcv     ON rcv.id = iss.received_by AND rcv.project_id IS NOT NULL
         JOIN requests req  ON req.id = iss.request_id
         JOIN units u       ON u.id = ANY(req.unit_ids)
         WHERE u.status IN ('issued','overdue')
           AND u.on_loan_to_project_id IS NULL
           AND NOT EXISTS (SELECT 1 FROM returns r WHERE r.issuance_id = iss.id)
         GROUP BY rcv.project_id`),
      db.query(
        `SELECT on_loan_to_project_id AS pid, COUNT(*)::int AS cnt
         FROM units WHERE on_loan_to_project_id IS NOT NULL
         GROUP BY on_loan_to_project_id`),
    ])
    const ownMap  = new Map(ownC.map(r => [String(r.pid), r.cnt]))
    const whMap   = new Map(whC.map(r => [String(r.pid), r.cnt]))
    const loanMap = new Map(loanC.map(r => [String(r.pid), r.cnt]))
    const out = projects.map(p => {
      const own = ownMap.get(String(p.id)) || 0
      const wh  = whMap.get(String(p.id))  || 0
      const ln  = loanMap.get(String(p.id)) || 0
      return {
        id: p.id, name: p.name,
        available_count: own + wh + ln,
        breakdown: { own, from_warehouse: wh, from_project: ln },
      }
    })
    res.json({ projects: out })
  } catch (err) {
    console.error(err)
    res.json({ projects: [] })
  }
})

// GET /project-units/pending-transfers вЂ” list units awaiting director acceptance.
// Only warehouse directors / deputies see this.
router.get('/pending-transfers', verifyJWT, async (req, res) => {
  if (!WAREHOUSE_DIRECTOR_ROLES.has(req.user.role)) return res.status(403).json({ error: 'Forbidden' })
  try {
    const { rows } = await db.query(
      `SELECT u.*, p.name AS project_name, uc.name AS created_by_name,
              (SELECT url FROM unit_photos WHERE unit_id = u.id
               ORDER BY CASE WHEN url ~* '\\.(mp4|webm|mov)$' THEN 1 ELSE 0 END, created_at LIMIT 1) AS photo_url
       FROM units u
       LEFT JOIN projects p ON p.id = u.project_id
       LEFT JOIN users uc ON uc.id = u.created_by
       WHERE u.pending_transfer = true AND u.is_project_kept = true
       ORDER BY u.created_at DESC`
    )
    res.json({ units: rows.map(({ search_vector, search_tags, ...r }) => r) })
  } catch (err) {
    console.error(err)
    res.json({ units: [] })
  }
})

// в”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђ
// Р”РІСѓС…СЌС‚Р°РїРЅС‹Р№ Р·Р°РїСЂРѕСЃ РІРѕР·РІСЂР°С‚Р° РµРґРёРЅРёС†С‹ СЃРѕ СЃРєР»Р°РґР° РїСЂРѕРµРєС‚Р° РЅР° РѕР±С‰РёР№ СЃРєР»Р°Рґ.
// в”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђ

// POST /project-units/:id/request-return вЂ” РґРёСЂРµРєС‚РѕСЂ СЃРєР»Р°РґР°/Р·Р°Рј/СЃРѕС‚СЂСѓРґРЅРёРє СЃРєР»Р°РґР°/
// РїСЂРѕРґСЋСЃРµСЂ РёРЅРёС†РёРёСЂСѓРµС‚ РІРѕР·РІСЂР°С‚. РЎРѕР·РґР°С‘С‚СЃСЏ Р·Р°РїСЂРѕСЃ СЃ РґРµРґР»Р°Р№РЅРѕРј +3 РґРЅСЏ Рё СѓРІРµРґРѕРјР»РµРЅРёРµ
// РѕС‚РІРµС‚СЃС‚РІРµРЅРЅС‹Рј РёР· РїСЂРѕРµРєС‚Р°-РІР»Р°РґРµР»СЊС†Р°.
router.post('/:id/request-return', verifyJWT, async (req, res) => {
  if (!RETURN_REQUESTER_ROLES.has(req.user.role)) {
    return res.status(403).json({ error: 'Forbidden' })
  }
  try {
    const { rows } = await db.query(
      `SELECT * FROM units WHERE id = $1 AND is_project_kept = true AND status = 'on_stock'`,
      [req.params.id]
    )
    if (!rows.length) return res.status(404).json({ error: 'Р•РґРёРЅРёС†Р° РЅРµ РЅР°Р№РґРµРЅР° РёР»Рё РЅРµ РЅР° РїСЂРѕРµРєС‚Рµ' })
    const unit = rows[0]

    // РџСЂРѕРІРµСЂРєР° СѓР¶Рµ СЃСѓС‰РµСЃС‚РІСѓСЋС‰РµРіРѕ pending-Р·Р°РїСЂРѕСЃР°, С‡С‚РѕР±С‹ РЅРµ РїР»РѕРґРёС‚СЊ РґСѓР±Р»Рё.
    const { rows: dup } = await db.query(
      `SELECT id FROM warehouse_return_requests WHERE unit_id = $1 AND status = 'pending'`,
      [req.params.id]
    )
    if (dup.length) return res.status(400).json({ error: 'Р—Р°РїСЂРѕСЃ РІРѕР·РІСЂР°С‚Р° СѓР¶Рµ РѕС‚РїСЂР°РІР»РµРЅ' })

    const comment = (req.body?.comment || '').toString().slice(0, 500) || null
    const { rows: created } = await db.query(
      `INSERT INTO warehouse_return_requests
         (unit_id, from_project_id, requested_by, deadline, comment)
       VALUES ($1, $2, $3, (CURRENT_DATE + INTERVAL '3 days')::date, $4)
       RETURNING *`,
      [unit.id, unit.project_id, req.user.id, comment]
    )
    const reqRow = created[0]

    // РЈРІРµРґРѕРјР»РµРЅРёРµ РѕС‚РІРµС‚СЃС‚РІРµРЅРЅС‹Рј РїРѕ РєР°С‚РµРіРѕСЂРёРё + РґРёСЂРµРєС‚РѕСЂСѓ РїСЂРѕРµРєС‚Р°.
    const roles = responderRoles(unit.category)
    const { rows: targets } = await db.query(
      `SELECT id FROM users WHERE project_id = $1 AND role = ANY($2)`,
      [unit.project_id, roles]
    )
    const dl = reqRow.deadline ? new Date(reqRow.deadline).toLocaleDateString('ru-RU') : ''
    const text = `РќСѓР¶РЅРѕ РІРµСЂРЅСѓС‚СЊ В«${unit.name}В» РЅР° РѕСЃРЅРѕРІРЅРѕР№ СЃРєР»Р°Рґ РґРѕ ${dl}`
    for (const t of targets) {
      await createNotification({
        user_id: t.id,
        type: 'warehouse_return_request',
        text,
        entity_id: reqRow.id,
        entity_type: 'warehouse_return_request',
      }).catch(() => {})
    }

    await db.query(
      `INSERT INTO unit_history (unit_id, action, user_id, project_id, notes)
       VALUES ($1,'Р—Р°РїСЂРѕСЃ РІРѕР·РІСЂР°С‚Р° РЅР° РѕСЃРЅРѕРІРЅРѕР№ СЃРєР»Р°Рґ',$2,$3,$4)`,
      [unit.id, req.user.id, unit.project_id, comment]
    )

    res.status(201).json({ request: reqRow })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Server error' })
  }
})

// GET /project-units/return-requests?direction=incoming|outgoing
// - outgoing (РїРѕ СѓРјРѕР»С‡Р°РЅРёСЋ РґР»СЏ warehouse/producer) вЂ” Р·Р°РїСЂРѕСЃС‹, РіРґРµ СЏ РёС… РёРЅРёС†РёРёСЂРѕРІР°Р»
//   РёР»Рё СЏ РёР· СЂРѕР»Рё warehouse/producer (РІРёР¶Сѓ РІСЃРµ pending).
// - incoming вЂ” РґР»СЏ СЃРѕС‚СЂСѓРґРЅРёРєРѕРІ РїСЂРѕРµРєС‚Р°, РіРґРµ РёС… РїСЂРѕРµРєС‚ СЏРІР»СЏРµС‚СЃСЏ РїСЂРѕРµРєС‚РѕРј-РІР»Р°РґРµР»СЊС†РµРј.
router.get('/return-requests', verifyJWT, async (req, res) => {
  const direction = req.query.direction || 'outgoing'
  try {
    let where, params
    if (direction === 'incoming') {
      if (!req.user.project_id) return res.json({ requests: [] })
      where = `r.from_project_id = $1`
      params = [req.user.project_id]
    } else {
      // outgoing: РґР»СЏ warehouse-СЂРѕР»РµР№ Рё РїСЂРѕРґСЋСЃРµСЂР° РїРѕРєР°Р·С‹РІР°РµРј РІСЃРµ pending; РґР»СЏ РѕСЃС‚Р°Р»СЊРЅС‹С… вЂ” С‚РѕР»СЊРєРѕ СЃРІРѕРё.
      if (RETURN_REQUESTER_ROLES.has(req.user.role)) {
        where = `1=1`
        params = []
      } else {
        where = `r.requested_by = $1`
        params = [req.user.id]
      }
    }
    const statusFilter = req.query.status
    if (statusFilter) {
      params.push(statusFilter)
      where += ` AND r.status = $${params.length}`
    }

    const { rows } = await db.query(
      `SELECT r.*,
              u.name AS unit_name, u.category AS unit_category,
              (SELECT url FROM unit_photos WHERE unit_id = u.id
               ORDER BY CASE WHEN url ~* '\\.(mp4|webm|mov)$' THEN 1 ELSE 0 END, created_at LIMIT 1) AS unit_photo,
              p.name AS from_project_name,
              ru.name AS requested_by_name, ru.role AS requested_by_role,
              cb.name AS confirmed_by_name
       FROM warehouse_return_requests r
       JOIN units u    ON u.id = r.unit_id
       JOIN projects p ON p.id = r.from_project_id
       JOIN users ru   ON ru.id = r.requested_by
       LEFT JOIN users cb ON cb.id = r.confirmed_by
       WHERE ${where}
       ORDER BY r.created_at DESC`,
      params
    )
    res.json({ requests: rows })
  } catch (err) {
    console.error(err)
    res.json({ requests: [] })
  }
})

// POST /project-units/return-requests/:id/confirm вЂ” warehouse/producer closes
// the return only after the item is physically accepted back to the main stock.
router.post('/return-requests/:id/confirm', verifyJWT, async (req, res) => {
  const client = await db.getClient()
  try {
    await client.query('BEGIN')
    const { rows } = await client.query(
      `SELECT * FROM warehouse_return_requests WHERE id = $1 FOR UPDATE`,
      [req.params.id]
    )
    if (!rows.length) {
      await client.query('ROLLBACK')
      return res.status(404).json({ error: 'Р—Р°РїСЂРѕСЃ РЅРµ РЅР°Р№РґРµРЅ' })
    }
    const r = rows[0]
    if (r.status !== 'pending') {
      await client.query('ROLLBACK')
      return res.status(409).json({ error: 'Р—Р°РїСЂРѕСЃ СѓР¶Рµ РѕР±СЂР°Р±РѕС‚Р°РЅ', currentStatus: r.status })
    }
    const isRequesterRole = RETURN_REQUESTER_ROLES.has(req.user.role)
    if (!isRequesterRole) {
      await client.query('ROLLBACK')
      return res.status(403).json({ error: 'Forbidden' })
    }

    await client.query(
      `UPDATE units
         SET is_project_kept = false,
             project_id = NULL,
             on_loan_to_project_id = NULL,
             pending_transfer = false
       WHERE id = $1`,
      [r.unit_id]
    )
    const done = await client.query(
      `UPDATE warehouse_return_requests
         SET status='confirmed', confirmed_by=$2, confirmed_at=NOW()
       WHERE id=$1 AND status='pending'`,
      [r.id, req.user.id]
    )
    if (done.rowCount !== 1) {
      await client.query('ROLLBACK')
      return res.status(409).json({ error: 'Р—Р°РїСЂРѕСЃ СѓР¶Рµ РѕР±СЂР°Р±РѕС‚Р°РЅ' })
    }
    await client.query(
      `INSERT INTO unit_history (unit_id, action, user_id, project_id)
       VALUES ($1,'Р’РѕР·РІСЂР°С‚ РЅР° РѕСЃРЅРѕРІРЅРѕР№ СЃРєР»Р°Рґ РїРѕРґС‚РІРµСЂР¶РґС‘РЅ',$2,$3)`,
      [r.unit_id, req.user.id, r.from_project_id]
    )
    await client.query('COMMIT')
    // РЈРІРµРґРѕРјР»РµРЅРёРµ РёРЅРёС†РёР°С‚РѕСЂСѓ Рё РѕС‚РІРµС‚СЃС‚РІРµРЅРЅС‹Рј, С‡С‚Рѕ РІРѕР·РІСЂР°С‚ Р·Р°РєСЂС‹С‚.
    await createNotification({
      user_id: r.requested_by,
      type: 'warehouse_return_confirmed',
      text: 'Р’РѕР·РІСЂР°С‚ РµРґРёРЅРёС†С‹ РЅР° РѕСЃРЅРѕРІРЅРѕР№ СЃРєР»Р°Рґ РїРѕРґС‚РІРµСЂР¶РґС‘РЅ',
      entity_id: r.id,
      entity_type: 'warehouse_return_request',
    }).catch(() => {})
    res.json({ ok: true })
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {})
    console.error(err)
    res.status(500).json({ error: 'Server error' })
  } finally {
    client.release()
  }
})

// POST /project-units/return-requests/:id/cancel вЂ” РёРЅРёС†РёР°С‚РѕСЂ (РёР»Рё warehouse) РѕС‚РјРµРЅСЏРµС‚.
router.post('/return-requests/:id/cancel', verifyJWT, async (req, res) => {
  try {
    const { rows } = await db.query(
      `SELECT * FROM warehouse_return_requests WHERE id = $1 AND status = 'pending'`,
      [req.params.id]
    )
    if (!rows.length) return res.status(404).json({ error: 'Р—Р°РїСЂРѕСЃ РЅРµ РЅР°Р№РґРµРЅ' })
    const r = rows[0]
    const isAuthor = String(r.requested_by) === String(req.user.id)
    const isWarehouse = RETURN_REQUESTER_ROLES.has(req.user.role)
    if (!isAuthor && !isWarehouse) return res.status(403).json({ error: 'Forbidden' })

    await db.query(
      `UPDATE warehouse_return_requests SET status='cancelled' WHERE id=$1`,
      [r.id]
    )
    res.json({ ok: true })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Server error' })
  }
})

// POST /project-units/:id/accept-transfer  вЂ” director accepts the transfer.
// Body: { warehouse_id, cell_id }  (cell validated against matrix on the units route separately).
router.post('/:id/accept-transfer', verifyJWT, async (req, res) => {
  if (!WAREHOUSE_DIRECTOR_ROLES.has(req.user.role)) return res.status(403).json({ error: 'Forbidden' })
  const { warehouse_id, cell_id } = req.body
  if (!warehouse_id || !cell_id) return res.status(400).json({ error: 'warehouse_id and cell_id required' })
  try {
    const { rows } = await db.query(
      `SELECT * FROM units WHERE id = $1 AND pending_transfer = true`, [req.params.id]
    )
    if (!rows.length) return res.status(404).json({ error: 'Not found' })

    // Р’Р°Р»РёРґР°С†РёСЏ СЃСѓС‰РµСЃС‚РІРѕРІР°РЅРёСЏ СЏС‡РµР№РєРё. РњР°С‚СЂРёС†Р° В«РєР°С‚РµРіРѕСЂРёСЏ в†” С‚РёРї СЃРµРєС†РёРёВ»
    // РѕС‚РєР»СЋС‡РµРЅР° вЂ” РјРµСЃС‚Р° Р±РµР·Р»РёРјРёС‚РЅС‹Рµ, Р»СЋР±Р°СЏ РµРґРёРЅРёС†Р° РєР»Р°РґС‘С‚СЃСЏ РІ Р»СЋР±СѓСЋ СЏС‡РµР№РєСѓ.
    const { rows: secRows } = await db.query(
      `SELECT c.id FROM cells c WHERE c.id = $1`,
      [cell_id]
    )
    if (!secRows.length) return res.status(400).json({ error: 'РЇС‡РµР№РєР° РЅРµ РЅР°Р№РґРµРЅР°' })

    // Accept: unit becomes regular warehouse unit, bound to cell, project badge removed.
    await db.query(
      `UPDATE units
         SET status='on_stock', is_project_kept=false, project_id=NULL, pending_transfer=false,
             warehouse_id=$2, cell_id=$3
       WHERE id=$1`,
      [req.params.id, warehouse_id, cell_id]
    )
    await db.query(
      `INSERT INTO unit_history (unit_id, action, user_id)
       VALUES ($1,'РџСЂРёРЅСЏС‚Рѕ РЅР° РѕР±С‰РёР№ СЃРєР»Р°Рґ РёР· РїСЂРѕРµРєС‚Р°',$2)`,
      [req.params.id, req.user.id]
    )
    res.json({ ok: true })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Server error' })
  }
})

// POST /project-units/:id/reject-transfer вЂ” director returns the unit back to the project.
router.post('/:id/reject-transfer', verifyJWT, async (req, res) => {
  if (!WAREHOUSE_DIRECTOR_ROLES.has(req.user.role)) return res.status(403).json({ error: 'Forbidden' })
  try {
    const { rows } = await db.query(
      `SELECT * FROM units WHERE id = $1 AND pending_transfer = true`, [req.params.id]
    )
    if (!rows.length) return res.status(404).json({ error: 'Not found' })
    await db.query(`UPDATE units SET pending_transfer=false WHERE id=$1`, [req.params.id])
    await db.query(
      `INSERT INTO unit_history (unit_id, action, user_id, notes)
       VALUES ($1,'РћС‚РєР»РѕРЅРµРЅРѕ РїСЂРё РїРµСЂРµРґР°С‡Рµ РЅР° РѕР±С‰РёР№ СЃРєР»Р°Рґ',$2,$3)`,
      [req.params.id, req.user.id, (req.body?.reason || '').toString().slice(0, 500) || null]
    )
    res.json({ ok: true })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Server error' })
  }
})

module.exports = router
