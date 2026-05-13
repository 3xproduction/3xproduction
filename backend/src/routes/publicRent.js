const router    = require('express').Router()
const crypto    = require('crypto')
const bcrypt    = require('bcrypt')
const rateLimit = require('express-rate-limit')
const db        = require('../db')
const { uploadFile } = require('../services/r2')
const { sendEmail } = require('../services/resend')

const PUBLIC_SALT_ROUNDS = 10
const RECOVER_CODE_TTL_MIN = 15
const MAX_CODES_PER_HOUR = 5

// Rate limit for all public endpoints: 20 requests per minute per IP
const publicLimiter = rateLimit({ windowMs: 60_000, max: 20, standardHeaders: true, legacyHeaders: false })
router.use(publicLimiter)

// Валидация токена публичной ссылки — используется в register/login, чтобы
// аккаунт мог быть создан только через действительную публичную ссылку.
async function validateToken(token) {
  const { rows } = await db.query(
    `SELECT id FROM public_tokens WHERE token=$1 AND expires_at > NOW()`,
    [token]
  )
  return rows.length > 0
}

// POST /public/warehouse/:token/register — регистрация внешнего пользователя.
router.post('/warehouse/:token/register', async (req, res) => {
  const { email, password, name, phone, counterparty_type, inn, legal_address, project_name, extra_contact } = req.body
  if (!email || !password || !name) {
    return res.status(400).json({ error: 'Email, пароль и имя обязательны' })
  }
  if (password.length < 6) {
    return res.status(400).json({ error: 'Пароль — минимум 6 символов' })
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ error: 'Некорректный email' })
  }
  try {
    if (!await validateToken(req.params.token)) {
      return res.status(404).json({ error: 'Invalid or expired link' })
    }
    const { rows: existing } = await db.query(`SELECT id FROM public_users WHERE email=$1`, [email.toLowerCase()])
    if (existing.length) {
      return res.status(409).json({ error: 'Пользователь с таким email уже зарегистрирован' })
    }
    const password_hash = await bcrypt.hash(password, PUBLIC_SALT_ROUNDS)
    const { rows } = await db.query(
      `INSERT INTO public_users (email, password_hash, name, phone, counterparty_type, inn, legal_address, project_name, extra_contact)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       RETURNING id, email, name, phone, counterparty_type, inn, legal_address, project_name, extra_contact`,
      [email.toLowerCase(), password_hash, name, phone || null, counterparty_type || 'person',
       inn || null, legal_address || null, project_name || null, extra_contact || null]
    )
    res.json({ user: rows[0] })
  } catch (err) {
    console.error('public register:', err)
    res.status(500).json({ error: 'Server error' })
  }
})

// POST /public/warehouse/:token/login — вход по email + паролю.
router.post('/warehouse/:token/login', async (req, res) => {
  const { email, password } = req.body
  if (!email || !password) return res.status(400).json({ error: 'Email и пароль обязательны' })
  try {
    if (!await validateToken(req.params.token)) {
      return res.status(404).json({ error: 'Invalid or expired link' })
    }
    const { rows } = await db.query(
      `SELECT id, email, password_hash, name, phone, counterparty_type, inn, legal_address, project_name, extra_contact
       FROM public_users WHERE email=$1`,
      [email.toLowerCase()]
    )
    if (!rows.length) return res.status(401).json({ error: 'Неверный email или пароль' })
    const user = rows[0]
    const ok = await bcrypt.compare(password, user.password_hash)
    if (!ok) return res.status(401).json({ error: 'Неверный email или пароль' })
    delete user.password_hash
    res.json({ user })
  } catch (err) {
    console.error('public login:', err)
    res.status(500).json({ error: 'Server error' })
  }
})

// POST /public/warehouse/:token/recover/request — отправка кода на email.
router.post('/warehouse/:token/recover/request', async (req, res) => {
  const { email } = req.body
  if (!email) return res.status(400).json({ error: 'Email обязателен' })
  try {
    if (!await validateToken(req.params.token)) {
      return res.status(404).json({ error: 'Invalid or expired link' })
    }
    const normEmail = email.toLowerCase()
    const { rows } = await db.query(`SELECT id FROM public_users WHERE email=$1`, [normEmail])
    // Всегда 200 — чтобы не утечь существование пользователя.
    if (!rows.length) return res.json({ ok: true })

    const { rows: recent } = await db.query(
      `SELECT COUNT(*)::int AS cnt FROM public_recover_codes WHERE email=$1 AND created_at > NOW() - INTERVAL '1 hour'`,
      [normEmail]
    )
    if (Number(recent[0].cnt) >= MAX_CODES_PER_HOUR) return res.json({ ok: true })

    const code = String(Math.floor(100000 + Math.random() * 900000))
    const expires_at = new Date(Date.now() + RECOVER_CODE_TTL_MIN * 60 * 1000)
    await db.query(
      `INSERT INTO public_recover_codes (email, code, expires_at) VALUES ($1,$2,$3)`,
      [normEmail, code, expires_at]
    )
    await sendEmail({
      to: normEmail,
      subject: 'Код восстановления пароля — 3XMedia Production',
      html: `
        <p>Ваш код восстановления пароля:</p>
        <h2 style="letter-spacing:8px;font-size:32px;">${code}</h2>
        <p>Код действителен ${RECOVER_CODE_TTL_MIN} минут.</p>
        <p>Если вы не запрашивали восстановление — проигнорируйте это письмо.</p>
      `,
    }).catch(e => console.error('sendEmail failed:', e.message))
    res.json({ ok: true })
  } catch (err) {
    console.error('public recover request:', err)
    res.status(500).json({ error: 'Server error' })
  }
})

// POST /public/warehouse/:token/recover/reset — сброс пароля по коду.
router.post('/warehouse/:token/recover/reset', async (req, res) => {
  const { email, code, password } = req.body
  if (!email || !code || !password) return res.status(400).json({ error: 'Недостаточно данных' })
  if (password.length < 6) return res.status(400).json({ error: 'Пароль — минимум 6 символов' })
  try {
    if (!await validateToken(req.params.token)) {
      return res.status(404).json({ error: 'Invalid or expired link' })
    }
    const normEmail = email.toLowerCase()
    const { rows } = await db.query(
      `SELECT * FROM public_recover_codes
       WHERE email=$1 AND code=$2 AND used=FALSE AND expires_at > NOW()
       ORDER BY created_at DESC LIMIT 1`,
      [normEmail, code]
    )
    if (!rows.length) return res.status(400).json({ error: 'Неверный или просроченный код' })

    const password_hash = await bcrypt.hash(password, PUBLIC_SALT_ROUNDS)
    await db.query(`UPDATE public_users SET password_hash=$1 WHERE email=$2`, [password_hash, normEmail])
    await db.query(`UPDATE public_recover_codes SET used=TRUE WHERE email=$1 AND used=FALSE`, [normEmail])
    res.json({ ok: true })
  } catch (err) {
    console.error('public recover reset:', err)
    res.status(500).json({ error: 'Server error' })
  }
})

// PATCH /public/warehouse/:token/profile — редактирование данных публичного
// пользователя из кабинета. Авторизация по email (клиент хранит его в сессии).
router.patch('/warehouse/:token/profile', async (req, res) => {
  try {
    if (!await validateToken(req.params.token)) {
      return res.status(404).json({ error: 'Invalid warehouse link' })
    }
    const { email, name, phone, counterparty_type, project_name, inn, legal_address, extra_contact } = req.body || {}
    if (!email) return res.status(400).json({ error: 'Email обязателен' })

    const { rows } = await db.query(
      `UPDATE public_users
         SET name = COALESCE($2, name),
             phone = COALESCE($3, phone),
             counterparty_type = COALESCE($4, counterparty_type),
             project_name = $5,
             inn = $6,
             legal_address = $7,
             extra_contact = $8
       WHERE email = $1
       RETURNING id, email, name, phone, counterparty_type, project_name, inn, legal_address, extra_contact`,
      [
        email.toLowerCase().trim(),
        name || null,
        phone || null,
        (counterparty_type === 'company' || counterparty_type === 'person') ? counterparty_type : null,
        project_name || null,
        inn || null,
        legal_address || null,
        extra_contact || null,
      ]
    )
    if (!rows.length) return res.status(404).json({ error: 'Пользователь не найден' })
    res.json({ user: rows[0] })
  } catch (err) {
    console.error('public profile update:', err)
    res.status(500).json({ error: 'Server error' })
  }
})

// GET /public/inn/:inn — proxy to FNS EGRUL for company lookup by INN
router.get('/inn/:inn', async (req, res) => {
  const inn = req.params.inn.replace(/\D/g, '')
  if (inn.length !== 10 && inn.length !== 12) {
    return res.status(400).json({ error: 'ИНН должен быть 10 или 12 цифр' })
  }
  try {
    // Step 1: get search token from FNS
    const searchRes = await fetch('https://egrul.nalog.ru/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: inn }),
    })
    const searchData = await searchRes.json()
    const token = searchData.t
    if (!token) return res.json({ found: false })

    // Step 2: wait and fetch result
    await new Promise(r => setTimeout(r, 1500))
    const resultRes = await fetch(`https://egrul.nalog.ru/search-result/${token}`)
    const resultData = await resultRes.json()
    const row = resultData.rows?.[0]

    if (!row) return res.json({ found: false })

    res.json({
      found: true,
      name: row.c || row.n || '',         // short or full name
      fullName: row.n || '',               // full name
      director: (row.g || '').replace(/^[^:]+:\s*/, ''), // strip role prefix
      inn: row.i || inn,
      kpp: row.p || '',
      ogrn: row.o || '',
      region: row.rn || '',
    })
  } catch (err) {
    console.error('FNS lookup error:', err.message)
    res.status(502).json({ error: 'Ошибка запроса к ФНС' })
  }
})

// GET /public/warehouse/:token/my-deals — external user's deals (by phone).
// Возвращаем структурированные позиции (unit_items) с фото/категорией/статусом,
// чтобы партнёрский кабинет мог отрисовать карточку раскрытия 1-в-1 как у
// директора площадки (с миниатюрами и бейджами статуса).
router.get('/warehouse/:token/my-deals', async (req, res) => {
  const { phone } = req.query
  if (!phone) return res.status(400).json({ error: 'Phone required' })

  try {
    const { rows: tkn } = await db.query(
      `SELECT id FROM public_tokens WHERE token=$1 AND expires_at > NOW()`,
      [req.params.token]
    )
    if (!tkn.length) return res.status(404).json({ error: 'Invalid or expired link' })

    const { rows } = await db.query(
      `SELECT r.id, r.status, r.workflow_stage, r.unit_ids,
              r.period_start, r.period_end, r.price_total,
              r.requester_message, r.counterparty_name, r.created_at, r.deposit,
              r.contract_pdf_url, r.sign_token, r.sign_status,
              r.return_requested_at,
              (
                SELECT COALESCE(jsonb_agg(jsonb_build_object(
                  'id', x.id,
                  'name', x.name,
                  'category', x.category,
                  'serial', x.serial,
                  'status', x.status,
                  'photo', x.photo
                ) ORDER BY x.name), '[]'::jsonb)
                FROM (
                  SELECT u.id, u.name, u.category, u.serial, u.status,
                         (SELECT url FROM unit_photos
                          WHERE unit_id = u.id AND type='stock'
                          ORDER BY created_at LIMIT 1) AS photo
                  FROM units u
                  WHERE u.id = ANY(r.unit_ids)
                ) x
              ) AS unit_items,
              (
                SELECT array_agg(u.name ORDER BY u.name)
                FROM units u
                WHERE u.id = ANY(r.unit_ids)
              ) AS unit_names
       FROM rent_deals r
       WHERE r.requester_phone = $1
       ORDER BY r.created_at DESC`,
      [phone]
    )
    res.json({ deals: rows })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Server error' })
  }
})

// POST /public/warehouse/:token/deals/:id/request-return — партнёр запрашивает
// возврат по своей активной сделке. Идентификация по телефону (сессия в
// sessionStorage хранит его). Ставит return_requested_at и шлёт уведомление
// директорам склада — у них появится кнопка «Принять».
router.post('/warehouse/:token/deals/:id/request-return', async (req, res) => {
  const { phone } = req.body || {}
  if (!phone) return res.status(400).json({ error: 'Phone required' })
  try {
    if (!await validateToken(req.params.token)) {
      return res.status(404).json({ error: 'Invalid or expired link' })
    }
    const { rows } = await db.query(
      `UPDATE rent_deals
         SET return_requested_at = NOW()
       WHERE id = $1 AND requester_phone = $2
         AND status = 'active' AND return_requested_at IS NULL
       RETURNING id, counterparty_name, requester_name`,
      [req.params.id, phone]
    )
    if (!rows.length) return res.status(404).json({ error: 'Сделка не найдена или возврат уже запрошен' })
    const deal = rows[0]

    const { rows: directors } = await db.query(
      `SELECT id FROM users WHERE role IN ('warehouse_director','warehouse_deputy')`
    )
    for (const u of directors) {
      await db.query(
        `INSERT INTO notifications (user_id, type, text, entity_id, entity_type)
         VALUES ($1, 'status_change', $2, $3, 'rent')`,
        [u.id, `Партнёр готов вернуть: ${deal.counterparty_name || deal.requester_name || 'клиент'}`, deal.id]
      )
    }
    res.json({ ok: true })
  } catch (err) {
    console.error('public request-return:', err)
    res.status(500).json({ error: 'Server error' })
  }
})

// GET /public/warehouse/:token — public catalog
router.get('/warehouse/:token', async (req, res) => {
  try {
    const { rows: tkn } = await db.query(
      `SELECT id FROM public_tokens WHERE token=$1 AND expires_at > NOW()`,
      [req.params.token]
    )
    if (!tkn.length) return res.status(404).json({ error: 'Invalid or expired link' })

    const { search, category } = req.query
    const params = []
    let q = `
      SELECT u.id, u.name, u.category, u.description, u.status, u.serial,
             u.qty, u.dimensions,
             array_agg(p.url ORDER BY CASE WHEN p.url ~* '\.(mp4|webm|mov)$' THEN 1 ELSE 0 END, p.created_at) FILTER (WHERE p.url IS NOT NULL) AS photos
      FROM units u
      LEFT JOIN unit_photos p ON p.unit_id = u.id AND p.type = 'stock'
      WHERE u.status != 'written_off'
        AND COALESCE(u.is_project_kept, false) = false
        AND COALESCE(u.is_admin_stock, false) = false
    `
    if (category) {
      params.push(category)
      q += ` AND u.category = $${params.length}`
    }

    let tsqIdx, rawIdx
    if (search && search.trim()) {
      try {
        const { buildSearchQuery } = require('../services/searchService')
        const { tsqueryStr, originalQuery } = await buildSearchQuery(search)
        if (tsqueryStr) {
          params.push(tsqueryStr)
          tsqIdx = params.length
          params.push(originalQuery)
          rawIdx = params.length
          q += ` AND (
            ts_rank_cd(u.search_vector, to_tsquery('ru_search', $${tsqIdx})) > 0.5
            OR u.name ILIKE '%' || $${rawIdx} || '%'
          )`
        }
      } catch (searchErr) {
        console.error('Public search error:', searchErr.message)
        params.push(`%${search.trim()}%`)
        q += ` AND u.name ILIKE $${params.length}`
      }
    }

    q += ` GROUP BY u.id`
    if (tsqIdx) {
      q += ` ORDER BY ts_rank_cd(u.search_vector, to_tsquery('ru_search', $${tsqIdx})) DESC`
    } else {
      q += ` ORDER BY u.category, u.name`
    }

    const { rows } = await db.query(q, params)
    res.json({ units: rows })
  } catch (err) {
    console.error(err)
    res.json({ units: [] })
  }
})

// GET /public/warehouse/:token/units/:id/history — история движения единицы
// для партнёра. Возвращает проект/контрагент + фото выдачи/возврата; user_name
// намеренно не раскрываем.
router.get('/warehouse/:token/units/:id/history', async (req, res) => {
  try {
    if (!await validateToken(req.params.token)) {
      return res.status(404).json({ error: 'Invalid or expired link' })
    }
    const { rows } = await db.query(
      `SELECT h.id, h.action, h.notes, h.created_at,
              h.issuance_id, h.return_id, h.rent_deal_id,
              COALESCE(p.name, rd.counterparty_name) AS project_name,
              COALESCE(
                (SELECT json_agg(json_build_object('id', ph.id, 'url', ph.url, 'type', ph.type) ORDER BY ph.created_at)
                 FROM unit_photos ph
                 WHERE ph.unit_id = h.unit_id
                   AND (
                     (h.issuance_id IS NOT NULL AND ph.issuance_id = h.issuance_id AND ph.type = 'issue') OR
                     (h.return_id IS NOT NULL AND ph.return_id = h.return_id AND ph.type = 'return') OR
                     (h.rent_deal_id IS NOT NULL AND ph.rent_deal_id = h.rent_deal_id)
                   )
                ),
                '[]'::json
              ) AS photos
       FROM unit_history h
       LEFT JOIN projects p ON p.id = h.project_id
       LEFT JOIN rent_deals rd ON rd.id = h.rent_deal_id
       WHERE h.unit_id = $1
       ORDER BY h.created_at DESC`,
      [req.params.id]
    )
    res.json({ history: rows })
  } catch (err) {
    console.error('public history:', err)
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
  const {
    name, phone, project_name, unit_ids, message,
    counterparty_type, email, inn, legal_address, extra_contact,
    period_start, period_end,
  } = req.body
  if (!name || !phone || !unit_ids?.length) {
    return res.status(400).json({ error: 'Укажите имя, телефон и выберите хотя бы одну единицу' })
  }

  try {
    const { rows: tkn } = await db.query(
      `SELECT id FROM public_tokens WHERE token=$1 AND expires_at > NOW()`,
      [req.params.token]
    )
    if (!tkn.length) return res.status(404).json({ error: 'Invalid or expired link' })

    const cpType = counterparty_type === 'company' ? 'company' : 'person'

    // Create rent deal with pending_review status
    const { rows } = await db.query(
      `INSERT INTO rent_deals
         (type, counterparty_name, counterparty_type, counterparty_contact, counterparty_email,
          unit_ids, status, period_start, period_end,
          inn, legal_address, extra_contact,
          requester_name, requester_phone, requester_project, requester_message)
       VALUES ('out', $1, $2, $3, $4, $5, 'pending_review', $6, $7, $8, $9, $10, $1, $3, $11, $12)
       RETURNING id`,
      [name, cpType, phone, email || null, unit_ids,
       period_start || null, period_end || null,
       inn || null, legal_address || null, extra_contact || null,
       project_name || null, message || null]
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
