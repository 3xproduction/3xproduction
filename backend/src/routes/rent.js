const router = require('express').Router()
const crypto = require('crypto')
const multer = require('multer')
const db     = require('../db')
const { verifyJWT, checkRole } = require('../middleware/auth')
const { createIssuancePDF, createReturnPDF } = require('../services/pdf')
const { uploadFile } = require('../services/r2')
const { sendEmail } = require('../services/resend')

const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp']
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    cb(null, ALLOWED_IMAGE_TYPES.includes(file.mimetype))
  },
})

const RENT_ROLES = ['warehouse_director', 'warehouse_deputy']
const ISSUE_ROLES = ['warehouse_director', 'warehouse_deputy', 'warehouse_staff']

// POST /rent — new deal
router.post('/', verifyJWT, checkRole(...RENT_ROLES), async (req, res) => {
  const {
    type, counterparty_name, counterparty_type, counterparty_contact, counterparty_email,
    unit_ids, period_start, period_end, price_total, signature_data,
    inn, legal_address, extra_contact, deposit,
  } = req.body

  if (!type || !counterparty_name || !unit_ids?.length || !period_start || !period_end) {
    return res.status(400).json({ error: 'Missing required fields' })
  }

  const client = await db.getClient()
  try {
    await client.query('BEGIN')

    // Generate contract PDF
    const { rows: units } = await client.query(`SELECT * FROM units WHERE id = ANY($1)`, [unit_ids])
    const { rows: issuer } = await client.query(`SELECT name FROM users WHERE id=$1`, [req.user.id])

    const pdfBytes = await createIssuancePDF({
      items: units,
      issuedTo: counterparty_name,
      issuedBy: issuer[0]?.name || 'Склад',
      deadline: period_end,
      signatureDataUrl: signature_data,
      issuerStamp: true,
      deposit: deposit || null,
    })
    const contract_pdf_url = await uploadFile(Buffer.from(pdfBytes), 'contract.pdf', 'contracts')

    const signToken = type === 'out' ? crypto.randomBytes(20).toString('hex') : null

    // Save deal
    const { rows } = await client.query(
      `INSERT INTO rent_deals
         (type, counterparty_name, counterparty_type, counterparty_contact, counterparty_email,
          unit_ids, period_start, period_end, price_total, signature_url, contract_pdf_url,
          sign_token, sign_status, inn, legal_address, extra_contact, deposit)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17) RETURNING *`,
      [type, counterparty_name, counterparty_type || 'person', counterparty_contact || null,
       counterparty_email || null, unit_ids, period_start, period_end,
       price_total || null, null, contract_pdf_url,
       signToken, signToken ? 'pending' : null,
       inn || null, legal_address || null, extra_contact || null, deposit || null]
    )
    const deal = rows[0]

    // If we're renting OUT — update unit statuses
    if (type === 'out') {
      for (const uid of unit_ids) {
        await client.query(`UPDATE units SET status='issued' WHERE id=$1`, [uid])
      }
    }

    await client.query('COMMIT')

    // Send email to counterparty
    if (counterparty_email) {
      const frontendUrl = process.env.FRONTEND_URL || ''
      const signUrl = signToken ? `${frontendUrl}/sign/${signToken}` : null
      sendEmail({
        to: counterparty_email,
        subject: type === 'out'
          ? 'Договор аренды — 3XMedia Production'
          : 'Уведомление об аренде — 3XMedia Production',
        html: `
          <p>Здравствуйте, ${counterparty_name}!</p>
          ${type === 'out'
            ? `<p>Договор аренды оформлен. Период: ${period_start} — ${period_end}.</p>
               <p>Сумма: ${price_total ? Number(price_total).toLocaleString('ru-RU') + ' ₽' : 'по договорённости'}.</p>
               <p>PDF договора: <a href="${contract_pdf_url}">Скачать</a></p>
               ${signUrl ? `<p><strong>Для подписания договора перейдите по ссылке:</strong><br><a href="${signUrl}">${signUrl}</a></p>` : ''}`
            : `<p>Компания 3XMedia Production берёт в аренду ваше имущество.</p>
               <p>Период: ${period_start} — ${period_end}.</p>`
          }
        `,
      }).catch(err => console.error('Email send error:', err.message))
    }

    res.status(201).json({ deal, contract_pdf_url })
  } catch (err) {
    await client.query('ROLLBACK')
    console.error(err)
    res.status(500).json({ error: 'Server error' })
  } finally {
    client.release()
  }
})

// GET /rent
router.get('/', verifyJWT, checkRole(...RENT_ROLES, 'producer'), async (req, res) => {
  const { type, status, search } = req.query
  try {
    let q = `SELECT * FROM rent_deals WHERE 1=1`
    const params = []
    if (type)   { params.push(type);   q += ` AND type=$${params.length}` }
    if (status) { params.push(status); q += ` AND status=$${params.length}` }
    let searchApplied = false
    if (search && search.trim()) {
      const { buildSearchQuery, checkTrgm } = require('../services/searchService')
      const { tsqueryStr, originalQuery } = await buildSearchQuery(search)
      if (tsqueryStr) {
        const useTrgm = await checkTrgm()
        params.push(tsqueryStr)
        const tsqIdx = params.length
        params.push(originalQuery)
        const rawIdx = params.length
        if (useTrgm) {
          q += ` AND (search_vector @@ to_tsquery('ru_search', $${tsqIdx})
                 OR similarity(counterparty_name, $${rawIdx}) > 0.2)`
        } else {
          q += ` AND (search_vector @@ to_tsquery('ru_search', $${tsqIdx})
                 OR counterparty_name ILIKE '%' || $${rawIdx} || '%')`
        }
        searchApplied = true
      }
    }
    if (searchApplied) {
      const tsqIdx = params.length - 1
      q += ` ORDER BY ts_rank_cd(search_vector, to_tsquery('ru_search', $${tsqIdx})) DESC, created_at DESC`
    } else {
      q += ` ORDER BY created_at DESC`
    }
    const { rows } = await db.query(q, params)
    res.json({ deals: rows })
  } catch (err) {
    console.error('Rent search error:', err)
    res.json({ deals: [] })
  }
})

// GET /rent/:id
router.get('/:id', verifyJWT, checkRole(...RENT_ROLES, 'warehouse_staff', 'producer'), async (req, res) => {
  try {
    const { rows } = await db.query(`SELECT * FROM rent_deals WHERE id=$1`, [req.params.id])
    if (!rows.length) return res.status(404).json({ error: 'Deal not found' })
    res.json({ deal: rows[0] })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Server error' })
  }
})

// PUT /rent/:id/review — process a pending_review deal (approve with dates/price)
router.put('/:id/review', verifyJWT, checkRole(...RENT_ROLES), async (req, res) => {
  const {
    period_start, period_end, price_total, deposit,
    counterparty_email, counterparty_type, inn, legal_address, extra_contact,
  } = req.body

  if (!period_start || !period_end) {
    return res.status(400).json({ error: 'Укажите даты аренды' })
  }

  const client = await db.getClient()
  try {
    await client.query('BEGIN')

    const { rows } = await client.query(`SELECT * FROM rent_deals WHERE id=$1`, [req.params.id])
    if (!rows.length) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Deal not found' }) }
    const deal = rows[0]
    if (deal.status !== 'pending_review') {
      await client.query('ROLLBACK')
      return res.status(400).json({ error: 'Сделка уже обработана' })
    }

    // Generate contract PDF
    const { rows: units } = await client.query(`SELECT * FROM units WHERE id = ANY($1)`, [deal.unit_ids])
    const { rows: issuer } = await client.query(`SELECT name FROM users WHERE id=$1`, [req.user.id])

    const pdfBytes = await createIssuancePDF({
      items: units,
      issuedTo: deal.counterparty_name,
      issuedBy: issuer[0]?.name || 'Склад',
      deadline: period_end,
      issuerStamp: true,
      deposit: deposit || null,
    })
    const contract_pdf_url = await uploadFile(Buffer.from(pdfBytes), 'contract.pdf', 'contracts')

    const signToken = crypto.randomBytes(20).toString('hex')

    // Update deal
    await client.query(
      `UPDATE rent_deals SET
         period_start=$1, period_end=$2, price_total=$3, deposit=$4,
         counterparty_email=$5, counterparty_type=COALESCE($6, counterparty_type),
         inn=$7, legal_address=$8, extra_contact=$9,
         contract_pdf_url=$10, sign_token=$11, sign_status='pending', status='active'
       WHERE id=$12`,
      [period_start, period_end, price_total || null, deposit || null,
       counterparty_email || null, counterparty_type || null,
       inn || null, legal_address || null, extra_contact || null,
       contract_pdf_url, signToken, req.params.id]
    )

    // Lock units
    for (const uid of deal.unit_ids) {
      await client.query(`UPDATE units SET status='issued' WHERE id=$1`, [uid])
    }

    await client.query('COMMIT')

    // Send email
    if (counterparty_email) {
      const frontendUrl = process.env.FRONTEND_URL || ''
      const signUrl = `${frontendUrl}/sign/${signToken}`
      sendEmail({
        to: counterparty_email,
        subject: 'Договор аренды — 3XMedia Production',
        html: `
          <p>Здравствуйте, ${deal.counterparty_name}!</p>
          <p>Договор аренды оформлен. Период: ${period_start} — ${period_end}.</p>
          <p>Сумма: ${price_total ? Number(price_total).toLocaleString('ru-RU') + ' ₽' : 'по договорённости'}.</p>
          <p>PDF договора: <a href="${contract_pdf_url}">Скачать</a></p>
          <p><strong>Для подписания договора перейдите по ссылке:</strong><br><a href="${signUrl}">${signUrl}</a></p>
        `,
      }).catch(err => console.error('Email send error:', err.message))
    }

    const { rows: updated } = await db.query(`SELECT * FROM rent_deals WHERE id=$1`, [req.params.id])
    res.json({ deal: updated[0], contract_pdf_url })
  } catch (err) {
    await client.query('ROLLBACK')
    console.error(err)
    res.status(500).json({ error: 'Server error' })
  } finally {
    client.release()
  }
})

// PUT /rent/:id/workflow-stage — продвижение публичной заявки по воркфлоу
// pending_review: null → 'collecting' (Принять) → 'ready' (Готово).
// Выдача из 'ready' происходит через PUT /rent/:id/review (ReviewModal).
router.put('/:id/workflow-stage', verifyJWT, checkRole(...RENT_ROLES, 'warehouse_staff'), async (req, res) => {
  const { stage } = req.body
  const allowed = [null, 'collecting', 'ready']
  if (!allowed.includes(stage)) return res.status(400).json({ error: 'Invalid stage' })
  try {
    const { rows } = await db.query(
      `UPDATE rent_deals SET workflow_stage=$1
       WHERE id=$2 AND status='pending_review'
       RETURNING *`,
      [stage, req.params.id]
    )
    if (!rows.length) return res.status(404).json({ error: 'Deal not found or already processed' })
    res.json({ deal: rows[0] })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Server error' })
  }
})

// POST /rent/:id/issue-public — финальная выдача по публичной заявке.
// Эквивалент POST /issuances, но для rent_deal: принимает фото и подпись,
// создаёт PDF, переводит сделку в status='active' (+ sign_token), ставит units
// в issued. Работает только в workflow_stage='ready'. Структура multipart
// (photos, signature) совпадает с /issuances — фронт переиспользует IssuePage.
router.post('/:id/issue-public', verifyJWT, checkRole(...ISSUE_ROLES), upload.any(), async (req, res) => {
  const { deadline, issue_date, signature_data, issuer_signature_data, deposit } = req.body
  if (!deadline) return res.status(400).json({ error: 'Укажите срок возврата' })

  const filesByField = {}
  for (const f of (req.files || [])) {
    (filesByField[f.fieldname] ||= []).push(f)
  }

  const client = await db.getClient()
  try {
    await client.query('BEGIN')
    const { rows } = await client.query(`SELECT * FROM rent_deals WHERE id=$1`, [req.params.id])
    if (!rows.length) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Deal not found' }) }
    const deal = rows[0]
    if (deal.status !== 'pending_review' || deal.workflow_stage !== 'ready') {
      await client.query('ROLLBACK')
      return res.status(400).json({ error: 'Сделка не в статусе готовности к выдаче' })
    }

    // Без пересорта: misplaced=true выдавать нельзя.
    const { rows: filtered } = await client.query(
      `SELECT id FROM units WHERE id = ANY($1) AND COALESCE(misplaced, false) = false`,
      [deal.unit_ids]
    )
    const unitIds = filtered.map(r => r.id)

    const { rows: units } = await client.query(
      `SELECT u.*, up.url AS photo_url
       FROM units u
       LEFT JOIN LATERAL (SELECT url FROM unit_photos WHERE unit_id = u.id AND type='stock' ORDER BY created_at LIMIT 1) up ON true
       WHERE u.id = ANY($1)`, [unitIds]
    )
    const { rows: issuer } = await client.query(
      `SELECT name, role FROM users WHERE id=$1`, [req.user.id]
    )

    const periodStart = issue_date || deal.period_start || new Date().toISOString().split('T')[0]
    const periodEnd = deadline

    // Загружаем подпись получателя
    let signature_url = null
    if (filesByField.signature?.[0]) {
      signature_url = await uploadFile(filesByField.signature[0].buffer, 'signature.png', 'signatures')
    }

    // Используем переданный залог (с экрана выдачи), иначе сохранённый в сделке.
    const depositValue = deposit != null && deposit !== '' ? Number(deposit) : (deal.deposit != null ? Number(deal.deposit) : null)

    const pdfBytes = await createIssuancePDF({
      items: units,
      issuedTo: deal.counterparty_name,
      issuedBy: issuer[0]?.name || 'Склад',
      deadline: periodEnd,
      signatureDataUrl: signature_data,
      issuerSignatureDataUrl: issuer_signature_data === 'stamp' ? null : issuer_signature_data,
      issuerStamp: issuer_signature_data === 'stamp',
      issuerRole: issuer[0]?.role,
      deposit: depositValue,
    })
    const contract_pdf_url = await uploadFile(Buffer.from(pdfBytes), 'contract.pdf', 'contracts')
    const signToken = crypto.randomBytes(20).toString('hex')

    await client.query(
      `UPDATE rent_deals SET
         status='active', workflow_stage=NULL,
         period_start=$1, period_end=$2,
         signature_url=COALESCE($3, signature_url),
         contract_pdf_url=$4, sign_token=$5, sign_status='pending',
         deposit=COALESCE($7, deposit)
       WHERE id=$6`,
      [periodStart, periodEnd, signature_url, contract_pdf_url, signToken, req.params.id, depositValue]
    )

    for (const uid of unitIds) {
      await client.query(`UPDATE units SET status='issued' WHERE id=$1`, [uid])
      await client.query(
        `INSERT INTO unit_history (unit_id, action, user_id, project_id, rent_deal_id, notes)
         VALUES ($1,'Выдано (аренда)',$2,NULL,$3,$4)`,
        [uid, req.user.id, req.params.id, deal.counterparty_name || null]
      )
    }

    // Фото выдачи — поле `photos_<unit_id>` привязывает к конкретной единице,
    // `photos` (легаси) — к первой.
    for (const fieldName of Object.keys(filesByField)) {
      let targetUnitId = null
      if (fieldName === 'photos') {
        targetUnitId = unitIds[0] || null
      } else if (fieldName.startsWith('photos_')) {
        const candidate = fieldName.slice('photos_'.length)
        if (unitIds.includes(candidate)) targetUnitId = candidate
      } else {
        continue
      }
      if (!targetUnitId) continue
      for (const file of filesByField[fieldName]) {
        const url = await uploadFile(file.buffer, file.originalname, 'units')
        await client.query(
          `INSERT INTO unit_photos (unit_id, url, type, rent_deal_id)
           VALUES ($1,$2,'issue',$3)`,
          [targetUnitId, url, req.params.id]
        )
      }
    }

    await client.query('COMMIT')

    // Email с ссылкой на подпись
    if (deal.counterparty_email) {
      const frontendUrl = process.env.FRONTEND_URL || ''
      const signUrl = `${frontendUrl}/sign/${signToken}`
      sendEmail({
        to: deal.counterparty_email,
        subject: 'Договор аренды — 3XMedia Production',
        html: `
          <p>Здравствуйте, ${deal.counterparty_name}!</p>
          <p>Имущество выдано. Период: ${periodStart} — ${periodEnd}.</p>
          <p>PDF договора: <a href="${contract_pdf_url}">Скачать</a></p>
          <p><strong>Для подписания перейдите по ссылке:</strong><br><a href="${signUrl}">${signUrl}</a></p>
        `,
      }).catch(err => console.error('Email send error:', err.message))
    }

    const { rows: updated } = await db.query(`SELECT * FROM rent_deals WHERE id=$1`, [req.params.id])
    res.status(201).json({ deal: updated[0], contract_pdf_url })
  } catch (err) {
    await client.query('ROLLBACK')
    console.error(err)
    res.status(500).json({ error: 'Server error' })
  } finally {
    client.release()
  }
})

// PUT /rent/:id/status
router.put('/:id/status', verifyJWT, checkRole(...RENT_ROLES), async (req, res) => {
  const { status } = req.body
  const allowed = ['done', 'cancelled']
  if (!allowed.includes(status)) return res.status(400).json({ error: 'Invalid status' })

  const client = await db.getClient()
  try {
    await client.query('BEGIN')
    const { rows } = await client.query(`SELECT * FROM rent_deals WHERE id=$1`, [req.params.id])
    if (!rows.length) return res.status(404).json({ error: 'Deal not found' })
    const deal = rows[0]

    await client.query(`UPDATE rent_deals SET status=$1 WHERE id=$2`, [status, req.params.id])

    // If done/cancelled and we were renting out — return units to stock
    if ((status === 'done' || status === 'cancelled') && deal.type === 'out' && deal.status === 'active') {
      for (const uid of deal.unit_ids) {
        await client.query(`UPDATE units SET status='on_stock' WHERE id=$1`, [uid])
      }
    }

    await client.query('COMMIT')
    res.json({ ok: true })
  } catch (err) {
    await client.query('ROLLBACK')
    console.error(err)
    res.status(500).json({ error: 'Server error' })
  } finally {
    client.release()
  }
})

// POST /rent/:id/request-return — склад инициирует возврат по активной
// партнёрской сделке. Ставит return_requested_at, шлёт уведомление —
// симметрично endpoint'у для партнёра. Без эффекта на units/status: это
// только флажок «готовы вернуть», сам возврат — через POST /rent/:id/return.
router.post('/:id/request-return', verifyJWT, checkRole(...RENT_ROLES, 'warehouse_staff'), async (req, res) => {
  try {
    const { rows } = await db.query(
      `UPDATE rent_deals
         SET return_requested_at = NOW()
       WHERE id = $1 AND status = 'active' AND return_requested_at IS NULL
       RETURNING id, counterparty_name`,
      [req.params.id]
    )
    if (!rows.length) return res.status(404).json({ error: 'Сделка не найдена или возврат уже запрошен' })
    res.json({ ok: true, deal: rows[0] })
  } catch (err) {
    console.error('rent request-return:', err)
    res.status(500).json({ error: 'Server error' })
  }
})

// POST /rent/:id/cancel-return-request — отменить запрос возврата по
// активной партнёрской сделке. Симметрично /issued/cancel-return-request-by-issuance.
router.post('/:id/cancel-return-request', verifyJWT, checkRole(...RENT_ROLES, 'warehouse_staff'), async (req, res) => {
  try {
    const { rows } = await db.query(
      `UPDATE rent_deals
         SET return_requested_at = NULL
       WHERE id = $1 AND return_requested_at IS NOT NULL
       RETURNING id`,
      [req.params.id]
    )
    if (!rows.length) return res.status(404).json({ error: 'Запрос возврата не найден' })
    res.json({ ok: true })
  } catch (err) {
    console.error('rent cancel-return-request:', err)
    res.status(500).json({ error: 'Server error' })
  }
})

// POST /rent/:id/finalize-return — полный возврат по партнёрской сделке.
// Мультипартный endpoint, зеркалит /issuances/returns: фото/подписи сдающего+
// принимающего, states-map (items_condition) → на единицах «Возврат» / «Долг» /
// «Списание». Завершает сделку (status='done', очищает return_requested_at,
// сохраняет return_pdf_url), возвращает единицы на склад.
router.post('/:id/finalize-return', verifyJWT, checkRole(...ISSUE_ROLES), upload.any(), async (req, res) => {
  const { condition_notes, items_condition, signature_data } = req.body
  const filesByField = {}
  for (const f of (req.files || [])) {
    (filesByField[f.fieldname] ||= []).push(f)
  }
  const client = await db.getClient()
  try {
    await client.query('BEGIN')
    const { rows } = await client.query(`SELECT * FROM rent_deals WHERE id=$1`, [req.params.id])
    if (!rows.length) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Deal not found' }) }
    const deal = rows[0]
    if (deal.status !== 'active' && deal.status !== 'overdue') {
      await client.query('ROLLBACK')
      return res.status(400).json({ error: 'Сделка не в активном статусе' })
    }

    const unitIds = deal.unit_ids || []
    const { rows: units } = unitIds.length
      ? await client.query(`SELECT * FROM units WHERE id = ANY($1)`, [unitIds])
      : { rows: [] }
    const { rows: acceptor } = await client.query(
      `SELECT name, role FROM users WHERE id=$1`, [req.user.id]
    )

    let condMap = {}
    try { condMap = JSON.parse(items_condition || '{}') } catch {}

    // PDF акт возврата с обеими подписями
    const pdfBytes = await createReturnPDF({
      items: units.map(u => ({ ...u, condition: condMap[u.id] })),
      returnedBy: deal.counterparty_name || 'Контрагент',
      acceptedBy: acceptor[0]?.name || 'Склад',
      conditionNotes: condition_notes,
      signatureDataUrl: req.body.acceptor_signature_data || signature_data,
      returnerSignatureDataUrl: req.body.returner_signature_data || signature_data,
      returnerRole: deal.counterparty_type === 'company' ? 'company' : 'person',
      returnerContact: deal.counterparty_contact || deal.counterparty_email || '',
      acceptorRole: acceptor[0]?.role,
      deposit: deal.deposit || null,
    })
    const return_pdf_url = await uploadFile(Buffer.from(pdfBytes), 'act_rent_return.pdf', 'acts')

    // Финализация сделки
    await client.query(
      `UPDATE rent_deals SET status='done', return_pdf_url=$1, return_requested_at=NULL WHERE id=$2`,
      [return_pdf_url, req.params.id]
    )

    // Фото возврата — `photos_<unit_id>` к конкретной единице, `photos` — к первой.
    for (const fieldName of Object.keys(filesByField)) {
      let targetUnitId = null
      if (fieldName === 'photos') {
        targetUnitId = unitIds[0] || null
      } else if (fieldName.startsWith('photos_')) {
        const candidate = fieldName.slice('photos_'.length)
        if (unitIds.includes(candidate)) targetUnitId = candidate
      } else {
        continue
      }
      if (!targetUnitId) continue
      for (const file of filesByField[fieldName]) {
        const url = await uploadFile(file.buffer, file.originalname, 'units')
        await client.query(
          `INSERT INTO unit_photos (unit_id, url, type, rent_deal_id)
           VALUES ($1,$2,'return',$3)`,
          [targetUnitId, url, req.params.id]
        )
      }
    }

    // Обновление статусов единиц + история.
    // У партнёра нет user_id → в `debts` не пишем (NOT NULL), используем
    // writeoffs kind='debt' (legacy-путь, отмечен в wiki как «страховка»).
    for (const unit of units) {
      const cond = condMap[unit.id]
      if (cond === 'writeoff') {
        await client.query(`UPDATE units SET status='written_off' WHERE id=$1`, [unit.id])
        await client.query(
          `INSERT INTO writeoffs (unit_id, created_by, project_id, reason, kind, source, source_ref)
           VALUES ($1,$2,NULL,$3,'writeoff','rent',$4)`,
          [unit.id, req.user.id, condition_notes || null, req.params.id]
        )
        await client.query(
          `INSERT INTO unit_history (unit_id, action, user_id, notes, rent_deal_id) VALUES ($1,'Списано (аренда)',$2,$3,$4)`,
          [unit.id, req.user.id, condition_notes || null, req.params.id]
        )
      } else if (cond === 'debt') {
        // Фиксируем «долг» партнёра через writeoffs kind='debt'. Статус единицы
        // оставляем on_stock: 'debt' в unit_status enum нет (урок 043 — не
        // расширяем), да и в regular flow ReturnPage работает так же.
        await client.query(`UPDATE units SET status='on_stock' WHERE id=$1`, [unit.id])
        await client.query(
          `INSERT INTO writeoffs (unit_id, created_by, project_id, reason, kind, source, source_ref)
           VALUES ($1,$2,NULL,$3,'debt','rent',$4)`,
          [unit.id, req.user.id, condition_notes || `Партнёр: ${deal.counterparty_name}`, req.params.id]
        )
        await client.query(
          `INSERT INTO unit_history (unit_id, action, user_id, notes, rent_deal_id) VALUES ($1,'Долг (аренда)',$2,$3,$4)`,
          [unit.id, req.user.id, condition_notes || null, req.params.id]
        )
      } else {
        await client.query(`UPDATE units SET status='on_stock' WHERE id=$1`, [unit.id])
        await client.query(
          `INSERT INTO unit_history (unit_id, action, user_id, notes, rent_deal_id) VALUES ($1,'Возврат (аренда)',$2,$3,$4)`,
          [unit.id, req.user.id, cond === 'damaged' ? `Повреждено: ${condition_notes}` : null, req.params.id]
        )
      }
    }

    await client.query('COMMIT')
    res.status(201).json({ ok: true, return_pdf_url })
  } catch (err) {
    await client.query('ROLLBACK')
    console.error('rent finalize-return:', err)
    res.status(500).json({ error: 'Server error' })
  } finally {
    client.release()
  }
})

// POST /rent/:id/return — return act for rent
router.post('/:id/return', verifyJWT, checkRole(...RENT_ROLES), async (req, res) => {
  const { condition_notes } = req.body
  try {
    const { rows } = await db.query(`SELECT * FROM rent_deals WHERE id=$1`, [req.params.id])
    if (!rows.length) return res.status(404).json({ error: 'Deal not found' })
    const deal = rows[0]

    // Get units and user for PDF
    const { rows: units } = await db.query(`SELECT * FROM units WHERE id = ANY($1)`, [deal.unit_ids])
    const { rows: acceptor } = await db.query(`SELECT name FROM users WHERE id=$1`, [req.user.id])

    // Generate return PDF
    const pdfBytes = await createReturnPDF({
      items: units,
      returnedBy: deal.counterparty_name || 'Контрагент',
      acceptedBy: acceptor[0]?.name || 'Склад',
      conditionNotes: condition_notes,
      deposit: deal.deposit || null,
    })
    const return_pdf_url = await uploadFile(Buffer.from(pdfBytes), 'act_rent_return.pdf', 'acts')

    await db.query(`UPDATE rent_deals SET status='done', return_pdf_url=$1 WHERE id=$2`, [return_pdf_url, req.params.id])
    for (const uid of deal.unit_ids) {
      await db.query(`UPDATE units SET status='on_stock' WHERE id=$1`, [uid])
    }

    res.json({ ok: true, return_pdf_url })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Server error' })
  }
})

// ─── Public sign routes (no JWT) ────────────────────────────────────────────

// GET /rent/sign/:token — public, get deal info for signing
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

// POST /rent/sign/:token — public, submit signature
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
    res.json({ ok: true })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Server error' })
  }
})

// ─── Public routes (no JWT) ─────────────────────────────────────────────────

// Generate public token for warehouse (warehouse staff can share)
router.post('/public/generate-link', verifyJWT,
  checkRole('warehouse_director', 'warehouse_deputy', 'warehouse_staff', 'producer'),
  async (req, res) => {
    const token = crypto.randomBytes(20).toString('hex')
    await db.query(
      `INSERT INTO public_tokens (token, created_by) VALUES ($1, $2)`,
      [token, req.user.id]
    )
    res.json({ token, url: `/public/warehouse/${token}` })
  }
)

// GET /public/warehouse/:token — public catalog
router.get('/public/warehouse/:token', async (req, res) => {
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
         AND COALESCE(u.is_project_kept, false) = false
         AND COALESCE(u.is_admin_stock, false) = false
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
router.post('/public/warehouse/:token/request', async (req, res) => {
  const { name, phone, unit_id, message, dates } = req.body
  if (!name || !phone || !unit_id) return res.status(400).json({ error: 'Missing fields' })

  try {
    // Notify warehouse directors
    const { rows: directors } = await db.query(
      `SELECT id FROM users WHERE role IN ('warehouse_director','warehouse_deputy')`
    )
    for (const u of directors) {
      await db.query(
        `INSERT INTO notifications (user_id, type, text, entity_id, entity_type)
         VALUES ($1,'new_request',$2,$3,'unit')`,
        [u.id, `Внешний запрос аренды от ${name} (${phone}): ${message || ''}`, unit_id]
      )
    }

    res.json({ ok: true })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Server error' })
  }
})

module.exports = router
