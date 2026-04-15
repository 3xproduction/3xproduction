const router    = require('express').Router()
const crypto    = require('crypto')
const rateLimit = require('express-rate-limit')
const db        = require('../db')
const { uploadFile } = require('../services/r2')

// Rate limit for all public endpoints: 20 requests per minute per IP
const publicLimiter = rateLimit({ windowMs: 60_000, max: 20, standardHeaders: true, legacyHeaders: false })
router.use(publicLimiter)

// GET /public/warehouse/:token — public catalog
router.get('/warehouse/:token', async (req, res) => {
  try {
    const { rows: tkn } = await db.query(
      `SELECT id FROM public_tokens WHERE token=$1 AND expires_at > NOW()`,
      [req.params.token]
    )
    if (!tkn.length) return res.status(404).json({ error: 'Invalid or expired link' })
    const { rows } = await db.query(
      `SELECT u.id, u.name, u.category, u.description, u.status, u.serial,
              array_agg(p.url) FILTER (WHERE p.url IS NOT NULL) AS photos
       FROM units u
       LEFT JOIN unit_photos p ON p.unit_id = u.id AND p.type='stock'
       WHERE u.status != 'written_off'
       GROUP BY u.id
       ORDER BY u.category, u.name`
    )
    res.json({ units: rows })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Server error' })
  }
})

// POST /public/warehouse/:token/request — external rent request
router.post('/warehouse/:token/request', async (req, res) => {
  const { name, phone, unit_id, message, dates, project_name } = req.body
  if (!name || !phone || !unit_id) return res.status(400).json({ error: 'Missing fields' })

  try {
    const projectLabel = project_name ? `Проект: ${project_name}` : 'Проект: гость'
    const { rows: directors } = await db.query(
      `SELECT id FROM users WHERE role IN ('warehouse_director','warehouse_deputy')`
    )
    for (const u of directors) {
      await db.query(
        `INSERT INTO notifications (user_id, type, text, entity_id, entity_type)
         VALUES ($1,'new_request',$2,$3,'unit')`,
        [u.id, `Внешний запрос от ${name} (${phone}) · ${projectLabel}${message ? ': ' + message : ''}`, unit_id]
      )
    }

    res.json({ ok: true })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Server error' })
  }
})

// POST /public/warehouse/:token/cart-request — external cart-based rental request
router.post('/warehouse/:token/cart-request', async (req, res) => {
  const { name, phone, project_name, unit_ids, message } = req.body
  if (!name || !phone || !unit_ids?.length) {
    return res.status(400).json({ error: 'Укажите имя, телефон и выберите хотя бы одну единицу' })
  }

  try {
    const { rows: tkn } = await db.query(
      `SELECT id FROM public_tokens WHERE token=$1 AND expires_at > NOW()`,
      [req.params.token]
    )
    if (!tkn.length) return res.status(404).json({ error: 'Invalid or expired link' })

    // Create rent deal with pending_review status
    const { rows } = await db.query(
      `INSERT INTO rent_deals
         (type, counterparty_name, counterparty_type, counterparty_contact,
          unit_ids, status, requester_name, requester_phone, requester_project, requester_message)
       VALUES ('out', $1, 'person', $2, $3, 'pending_review', $1, $2, $4, $5)
       RETURNING id`,
      [name, phone, unit_ids, project_name || null, message || null]
    )
    const dealId = rows[0].id

    // Notify warehouse directors
    const { rows: directors } = await db.query(
      `SELECT id FROM users WHERE role IN ('warehouse_director','warehouse_deputy')`
    )
    const unitCount = unit_ids.length
    const projectLabel = project_name ? ` · Проект: ${project_name}` : ''
    const text = `Новая заявка на аренду от ${name} (${phone})${projectLabel} — ${unitCount} ед.`
    for (const u of directors) {
      await db.query(
        `INSERT INTO notifications (user_id, type, text, entity_id, entity_type)
         VALUES ($1, 'new_request', $2, $3, 'unit')`,
        [u.id, text, dealId]
      )
    }

    res.json({ ok: true, deal_id: dealId })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Server error' })
  }
})

// GET /public/sign/:token — public, get deal info for signing
router.get('/sign/:token', async (req, res) => {
  try {
    const { rows } = await db.query(
      `SELECT r.id, r.counterparty_name, r.counterparty_type, r.period_start, r.period_end,
              r.price_total, r.unit_ids, r.sign_status, r.contract_pdf_url,
              array_agg(u.name) FILTER (WHERE u.name IS NOT NULL) AS unit_names
       FROM rent_deals r
       LEFT JOIN units u ON u.id = ANY(r.unit_ids)
       WHERE r.sign_token = $1
       GROUP BY r.id`,
      [req.params.token]
    )
    if (!rows.length) return res.status(404).json({ error: 'Ссылка не найдена' })
    res.json({ deal: rows[0] })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Server error' })
  }
})

// POST /public/sign/:token — public, submit signature
router.post('/sign/:token', async (req, res) => {
  const { signature_data } = req.body
  try {
    const { rows } = await db.query(
      `SELECT * FROM rent_deals WHERE sign_token = $1 AND sign_status = 'pending'`,
      [req.params.token]
    )
    if (!rows.length) return res.status(404).json({ error: 'Ссылка не найдена или уже подписана' })
    const deal = rows[0]

    let sig_url = null
    if (signature_data) {
      try {
        const base64 = signature_data.replace(/^data:image\/\w+;base64,/, '')
        const imgBytes = Buffer.from(base64, 'base64')
        sig_url = await uploadFile(imgBytes, 'signature.png', 'signatures')
      } catch {}
    }

    await db.query(
      `UPDATE rent_deals SET sign_status = 'signed', signature_url = $1 WHERE id = $2`,
      [sig_url, deal.id]
    )

    // Notify warehouse about successful signing
    const { rows: directors } = await db.query(
      `SELECT id FROM users WHERE role IN ('warehouse_director','warehouse_deputy')`
    )
    for (const u of directors) {
      await db.query(
        `INSERT INTO notifications (user_id, type, text, entity_id, entity_type)
         VALUES ($1,'rent_signed',$2,$3,'rent')`,
        [u.id, `Договор аренды подписан: ${deal.counterparty_name || 'контрагент'}`, deal.id]
      )
    }

    res.json({ ok: true, message: 'Подписано успешно' })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Server error' })
  }
})

module.exports = router
