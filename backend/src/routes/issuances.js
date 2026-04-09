const router  = require('express').Router()
const multer  = require('multer')
const db      = require('../db')
const { verifyJWT, checkRole } = require('../middleware/auth')
const { uploadFile } = require('../services/r2')
const { createIssuancePDF, createReturnPDF, createExtensionPDF } = require('../services/pdf')
const { createNotification, notifyWarehouse } = require('../services/notifications')
const { sendEmail } = require('../services/resend')

const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp']
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    cb(null, ALLOWED_IMAGE_TYPES.includes(file.mimetype))
  },
})
const WAREHOUSE_ROLES = ['warehouse_director', 'warehouse_deputy', 'warehouse_staff']

// POST /issuances — issue units with signature
router.post('/', verifyJWT, checkRole(...WAREHOUSE_ROLES), upload.fields([
  { name: 'photos', maxCount: 30 },
  { name: 'signature', maxCount: 1 },
]), async (req, res) => {
  const { request_id, received_by, deadline } = req.body
  if (!received_by || !deadline) return res.status(400).json({ error: 'Missing fields' })

  const client = await db.getClient()
  try {
    await client.query('BEGIN')

    // Upload signature
    let signature_url = null
    if (req.files?.signature?.[0]) {
      signature_url = await uploadFile(req.files.signature[0].buffer, 'signature.png', 'signatures')
    }

    // Get request + units
    let unit_ids = []
    if (request_id) {
      const { rows } = await client.query(`SELECT unit_ids FROM requests WHERE id=$1`, [request_id])
      if (rows.length) unit_ids = rows[0].unit_ids
    }

    // Get unit + user details for PDF
    const { rows: units } = await client.query(
      `SELECT u.*, up.url AS photo_url
       FROM units u
       LEFT JOIN LATERAL (SELECT url FROM unit_photos WHERE unit_id = u.id AND type='stock' ORDER BY created_at LIMIT 1) up ON true
       WHERE u.id = ANY($1)`, [unit_ids]
    )
    const { rows: receiver } = await client.query(
      `SELECT u.name, u.role, u.email, u.phone, p.name AS project_name
       FROM users u LEFT JOIN projects p ON p.id = u.project_id
       WHERE u.id=$1`, [received_by]
    )
    const { rows: issuer } = await client.query(
      `SELECT name, role FROM users WHERE id=$1`, [req.user.id]
    )

    // Generate PDF
    const rcv = receiver[0] || {}
    const pdfBytes = await createIssuancePDF({
      items: units,
      issuedTo: rcv.name || received_by,
      issuedBy: issuer[0]?.name || 'Склад',
      deadline,
      signatureDataUrl: req.body.signature_data,
      receiverRole: rcv.role,
      receiverContact: rcv.phone || rcv.email || '',
      projectName: rcv.project_name,
      issuerRole: issuer[0]?.role,
    })
    const pdfBuffer = Buffer.from(pdfBytes)
    const act_pdf_url = await uploadFile(pdfBuffer, 'act_issue.pdf', 'acts')

    // Create issuance
    const { rows } = await client.query(
      `INSERT INTO issuances (request_id, issued_by, received_by, signature_url, act_pdf_url, deadline)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [request_id || null, req.user.id, received_by, signature_url, act_pdf_url, deadline]
    )
    const issuance = rows[0]

    // Upload issue photos + update unit status
    for (const unit_id of unit_ids) {
      await client.query(`UPDATE units SET status='issued' WHERE id=$1`, [unit_id])
      await client.query(
        `INSERT INTO unit_history (unit_id, action, user_id, project_id)
         VALUES ($1,'Выдано',$2,(SELECT project_id FROM users WHERE id=$3))`,
        [unit_id, req.user.id, received_by]
      )
    }

    // Upload photos
    if (req.files?.photos) {
      for (const file of req.files.photos) {
        const url = await uploadFile(file.buffer, file.originalname, 'units')
        // Attach to first unit for now; in real app unit_id comes from form fields
        if (unit_ids[0]) {
          await client.query(
            `INSERT INTO unit_photos (unit_id, url, type) VALUES ($1,$2,'issue')`,
            [unit_ids[0], url]
          )
        }
      }
    }

    // Mark request as issued
    if (request_id) {
      await client.query(`UPDATE requests SET status='issued' WHERE id=$1`, [request_id])
    }

    await client.query('COMMIT')
    res.status(201).json({ issuance, act_pdf_url })
  } catch (err) {
    await client.query('ROLLBACK')
    console.error(err)
    res.status(500).json({ error: 'Server error' })
  } finally {
    client.release()
  }
})

// POST /returns
router.post('/returns', verifyJWT, checkRole(...WAREHOUSE_ROLES), upload.fields([
  { name: 'photos', maxCount: 30 },
  { name: 'signature', maxCount: 1 },
]), async (req, res) => {
  const { issuance_id, condition_notes, items_condition, signature_data } = req.body
  if (!issuance_id) return res.status(400).json({ error: 'Missing issuance_id' })

  const client = await db.getClient()
  try {
    await client.query('BEGIN')

    const { rows: issuances } = await client.query(
      `SELECT i.*, r.unit_ids FROM issuances i LEFT JOIN requests r ON r.id = i.request_id WHERE i.id=$1`,
      [issuance_id]
    )
    if (!issuances.length) return res.status(404).json({ error: 'Issuance not found' })
    const issuance = issuances[0]
    const unitIds = issuance.unit_ids || []

    const { rows: returnerRow } = await client.query(
      `SELECT u.name, u.role, u.phone, u.email, p.name AS project_name
       FROM users u LEFT JOIN projects p ON p.id = u.project_id
       WHERE u.id=$1`, [issuance.received_by]
    )
    const { rows: acceptorRow } = await client.query(
      `SELECT name, role FROM users WHERE id=$1`, [req.user.id]
    )
    const { rows: units } = unitIds.length
      ? await client.query(`SELECT * FROM units WHERE id = ANY($1)`, [unitIds])
      : { rows: [] }

    // Parse conditions per unit
    let condMap = {}
    try { condMap = JSON.parse(items_condition || '{}') } catch {}

    const ret = returnerRow[0] || {}
    // Generate PDF
    const pdfBytes = await createReturnPDF({
      items: units.map(u => ({ ...u, condition: condMap[u.id] })),
      returnedBy: ret.name || '',
      acceptedBy: acceptorRow[0]?.name || '',
      conditionNotes: condition_notes,
      signatureDataUrl: signature_data,
      returnerRole: ret.role,
      returnerContact: ret.phone || ret.email || '',
      projectName: ret.project_name,
      acceptorRole: acceptorRow[0]?.role,
    })
    const act_pdf_url = await uploadFile(Buffer.from(pdfBytes), 'act_return.pdf', 'acts')

    let sig_url = null
    if (req.files?.signature?.[0]) {
      sig_url = await uploadFile(req.files.signature[0].buffer, 'sig.png', 'signatures')
    }

    await client.query(
      `INSERT INTO returns (issuance_id, returned_by, accepted_by, condition_notes, signature_url, act_pdf_url)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [issuance_id, issuance.received_by, req.user.id, condition_notes || null, sig_url, act_pdf_url]
    )

    // Update unit statuses + history
    for (const unit of units) {
      const cond = condMap[unit.id]
      const newStatus = 'on_stock'
      await client.query(`UPDATE units SET status=$1 WHERE id=$2`, [newStatus, unit.id])
      await client.query(
        `INSERT INTO unit_history (unit_id, action, user_id, notes) VALUES ($1,'Возврат',$2,$3)`,
        [unit.id, req.user.id, cond === 'damaged' ? `Повреждено: ${condition_notes}` : null]
      )

      // Notify if damaged
      if (cond === 'damaged') {
        await notifyWarehouse({
          type: 'damage',
          text: `Повреждение при возврате: ${unit.name}`,
          entity_id: unit.id,
          entity_type: 'unit',
        })
      }
    }

    await client.query('COMMIT')
    res.status(201).json({ ok: true, act_pdf_url })
  } catch (err) {
    await client.query('ROLLBACK')
    console.error(err)
    res.status(500).json({ error: 'Server error' })
  } finally {
    client.release()
  }
})

// POST /extensions
router.post('/extensions', verifyJWT, checkRole(...WAREHOUSE_ROLES), async (req, res) => {
  const { issuance_id, new_deadline, initiator_signature, acceptor_signature, photos } = req.body
  if (!issuance_id || !new_deadline) return res.status(400).json({ error: 'Missing fields' })
  if (!initiator_signature || !acceptor_signature) {
    return res.status(400).json({ error: 'Both signatures required for extension' })
  }

  const client = await db.getClient()
  try {
    await client.query('BEGIN')

    const { rows: issuances } = await client.query(
      `SELECT i.*, r.unit_ids FROM issuances i LEFT JOIN requests r ON r.id=i.request_id WHERE i.id=$1`,
      [issuance_id]
    )
    if (!issuances.length) return res.status(404).json({ error: 'Issuance not found' })
    const issuance = issuances[0]

    const { rows: units } = await client.query(`SELECT * FROM units WHERE id = ANY($1)`, [issuance.unit_ids])
    const { rows: initiator } = await client.query(`SELECT name FROM users WHERE id=$1`, [issuance.received_by])
    const { rows: acceptor }  = await client.query(`SELECT name FROM users WHERE id=$1`, [req.user.id])

    const pdfBytes = await createExtensionPDF({
      items: units,
      newDeadline: new_deadline,
      initiatorName: initiator[0]?.name || '',
      acceptorName: acceptor[0]?.name || '',
      initiatorSig: initiator_signature,
      acceptorSig: acceptor_signature,
    })
    const act_pdf_url = await uploadFile(Buffer.from(pdfBytes), 'act_ext.pdf', 'acts')

    await client.query(
      `INSERT INTO extensions (issuance_id, new_deadline, initiator_signature, acceptor_signature, photos)
       VALUES ($1,$2,$3,$4,$5)`,
      [issuance_id, new_deadline, initiator_signature, acceptor_signature, photos || []]
    )
    await client.query(`UPDATE issuances SET deadline=$1 WHERE id=$2`, [new_deadline, issuance_id])

    for (const unit of units) {
      await client.query(
        `INSERT INTO unit_history (unit_id, action, user_id, notes) VALUES ($1,'Продление',$2,$3)`,
        [unit.id, req.user.id, `Новый дедлайн: ${new_deadline}`]
      )
    }

    await client.query('COMMIT')
    res.status(201).json({ ok: true, act_pdf_url })
  } catch (err) {
    await client.query('ROLLBACK')
    console.error(err)
    res.status(500).json({ error: 'Server error' })
  } finally {
    client.release()
  }
})

// GET /issuances/acts — all issuances + returns for acts page
router.get('/acts', verifyJWT, async (req, res) => {
  try {
    const { rows: issuances } = await db.query(`
      SELECT i.id, i.issued_at, i.deadline, i.act_pdf_url,
             ub.name AS issued_by_name,
             ur.name AS received_by_name,
             r.unit_ids,
             EXISTS (SELECT 1 FROM returns rt WHERE rt.issuance_id = i.id) AS returned
      FROM issuances i
      JOIN users ub ON ub.id = i.issued_by
      JOIN users ur ON ur.id = i.received_by
      LEFT JOIN requests r ON r.id = i.request_id
      ORDER BY i.issued_at DESC
    `)

    const { rows: returns } = await db.query(`
      SELECT rt.id, rt.returned_at, rt.condition_notes, rt.act_pdf_url,
             ur.name AS returned_by_name,
             ua.name AS accepted_by_name,
             i.issued_at, r.unit_ids
      FROM returns rt
      JOIN issuances i ON i.id = rt.issuance_id
      JOIN users ur ON ur.id = rt.returned_by
      JOIN users ua ON ua.id = rt.accepted_by
      LEFT JOIN requests r ON r.id = i.request_id
      ORDER BY rt.returned_at DESC
    `)

    res.json({ issuances, returns })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Server error' })
  }
})

// GET /issuances/active
router.get('/active', verifyJWT, checkRole('warehouse_director', 'warehouse_deputy', 'warehouse_staff'), async (req, res) => {
  try {
    const { rows } = await db.query(`
      SELECT i.*, u.name AS receiver_name, r.unit_ids,
             p.name AS project_name,
             CASE WHEN i.deadline < NOW() THEN true ELSE false END AS is_overdue,
             i.return_requested_at
      FROM issuances i
      JOIN users u ON u.id = i.received_by
      LEFT JOIN requests r ON r.id = i.request_id
      LEFT JOIN projects p ON p.id = r.project_id
      WHERE NOT EXISTS (SELECT 1 FROM returns rt WHERE rt.issuance_id = i.id)
      ORDER BY i.deadline ASC
    `)
    res.json({ issuances: rows })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Server error' })
  }
})

// POST /issuances/:id/request-return — project director requests return
router.post('/:id/request-return', verifyJWT, async (req, res) => {
  try {
    const { rows } = await db.query(
      `SELECT i.id, i.received_by, u.name AS receiver_name, r.unit_ids,
              EXISTS (SELECT 1 FROM returns rt WHERE rt.issuance_id = i.id) AS already_returned
       FROM issuances i
       JOIN users u ON u.id = i.received_by
       LEFT JOIN requests r ON r.id = i.request_id
       WHERE i.id = $1
         AND (i.received_by = $2 OR r.requester_id = $2 OR r.project_id = $3)`,
      [req.params.id, req.user.id, req.user.project_id || null]
    )
    if (!rows.length) return res.status(404).json({ error: 'Issuance not found' })
    if (rows[0].already_returned) return res.status(400).json({ error: 'Already returned' })

    await db.query(
      `UPDATE issuances SET return_requested_at = NOW() WHERE id = $1`,
      [req.params.id]
    )

    const unitCount = (rows[0].unit_ids || []).length
    await notifyWarehouse({
      type: 'return_request',
      text: `${rows[0].receiver_name} запросил возврат (${unitCount} ед.)`,
      entity_id: rows[0].id,
      entity_type: 'issuance',
    })

    res.json({ ok: true })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Server error' })
  }
})

module.exports = router
