const router = require('express').Router()
const multer = require('multer')
const crypto = require('crypto')
const db     = require('../db')
const { verifyJWT, checkRole } = require('../middleware/auth')
const { uploadFile } = require('../services/r2')
const { createIssuancePDF } = require('../services/pdf')
const { sendEmail } = require('../services/resend')

const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp']
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    cb(null, ALLOWED_IMAGE_TYPES.includes(file.mimetype))
  },
})

const WALKIN_ISSUER_ROLES = ['warehouse_director', 'warehouse_deputy']

// Роли, которые может получить walk-in получатель. Соответствует списку в
// dropdown'е WalkinIssuePage экрана 2 (UI и backend держим в синхроне).
const WALKIN_RECEIVER_ROLES = new Set([
  'production_designer',
  'art_director_assistant',
  'props_master',
  'props_assistant',
  'costumer',
  'costume_assistant',
  'decorator',
  'extra_worker',
])

const CLAIM_TTL_DAYS = 30
const FRONTEND_URL = process.env.FRONTEND_URL || ''

function isEmail(s) {
  return typeof s === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)
}

function makeClaimToken() {
  return crypto.randomBytes(24).toString('hex')
}

function claimUrl(token) {
  // FRONTEND_URL не имеет trailing slash — clip на всякий
  const base = FRONTEND_URL.replace(/\/$/, '')
  return `${base}/claim/${token}`
}

function escHtml(s) {
  return String(s || '').replace(/[&<>"']/g, c => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ))
}

// Найти юнит по photos_<temp_id> (frontend генерит temp UUID на каждое фото).
function buildFilesByField(files) {
  const out = {}
  for (const f of files || []) {
    (out[f.fieldname] ||= []).push(f)
  }
  return out
}

// POST /walkin/issue
//
// Walk-in выдача: один транзакционный flow, который создаёт всё нужное за
// одну операцию — проект (если новый), project_director'а (provisional, если
// проект новый), получателя (provisional если новый), N юнитов с минимальным
// заполнением (status=issued, is_walkin=true) и issuance с PDF.
//
// Multipart-поля:
//   • project_id          UUID существующего проекта   ─┐ одно из двух
//   • project_name        TEXT для нового проекта      ─┘
//   • director_name       TEXT  только для нового проекта
//   • director_phone      TEXT  обязателен если новый проект
//   • director_email      TEXT  опционально
//   • recipient_role      TEXT enum WALKIN_RECEIVER_ROLES
//   • recipient_name      TEXT
//   • recipient_phone     TEXT
//   • recipient_email     TEXT  опционально
//   • recipient_user_id   UUID  если выбран existing user через autocomplete
//                                (тогда recipient_name/phone/email игнорируются)
//   • units               JSON-массив [{ temp_id, name, category, qty, description?, period?, dimensions? }]
//   • deadline            YYYY-MM-DD
//   • signature           file PNG/JPG (подпись получателя; либо signature_data base64)
//   • signature_data      base64 string (альтернатива файлу)
//   • issuer_signature_data  base64 ИЛИ строка 'stamp'
//   • photos_<temp_id>    file (по одному фото на каждый temp_id из units[])
router.post('/issue', verifyJWT, checkRole(...WALKIN_ISSUER_ROLES), upload.any(), async (req, res) => {
  const {
    project_id, project_name,
    director_name, director_phone, director_email,
    recipient_role, recipient_name, recipient_phone, recipient_email,
    recipient_user_id,
    deadline,
  } = req.body

  // ── Валидация ──
  if (!deadline) return res.status(400).json({ error: 'deadline обязателен' })
  if (!project_id && !project_name) {
    return res.status(400).json({ error: 'Укажите проект (existing или новый)' })
  }
  if (!project_id && (!director_name || !director_phone)) {
    return res.status(400).json({ error: 'Для нового проекта нужны ФИО и телефон директора проекта' })
  }
  if (!recipient_user_id) {
    if (!recipient_role || !WALKIN_RECEIVER_ROLES.has(recipient_role)) {
      return res.status(400).json({ error: 'Недопустимая роль получателя' })
    }
    if (!recipient_name || !recipient_phone) {
      return res.status(400).json({ error: 'ФИО и телефон получателя обязательны' })
    }
  }
  if (director_email && !isEmail(director_email)) {
    return res.status(400).json({ error: 'Некорректный email директора проекта' })
  }
  if (recipient_email && !isEmail(recipient_email)) {
    return res.status(400).json({ error: 'Некорректный email получателя' })
  }

  let units
  try {
    units = JSON.parse(req.body.units || '[]')
  } catch {
    return res.status(400).json({ error: 'units должен быть валидным JSON-массивом' })
  }
  if (!Array.isArray(units) || !units.length) {
    return res.status(400).json({ error: 'Нужна хотя бы одна единица' })
  }
  for (const u of units) {
    if (u.existing_id) {
      if (typeof u.existing_id !== 'string') {
        return res.status(400).json({ error: 'Некорректный existing_id' })
      }
    } else if (!u.temp_id || !u.name || !u.category) {
      return res.status(400).json({ error: 'У каждой новой единицы нужны temp_id, name, category' })
    }
  }

  const filesByField = buildFilesByField(req.files)

  const client = await db.getClient()
  // Коллекторы для side-effects ПОСЛЕ commit'а (email-уведомления). Если
  // транзакция упадёт — письма не уйдут; если письма упадут — данные уже в БД.
  const emailsToSend = []

  try {
    await client.query('BEGIN')

    // ── 1. Проект ──
    let projectIdResolved = project_id
    let projectNameResolved = ''
    if (project_id) {
      const { rows } = await client.query(`SELECT id, name FROM projects WHERE id=$1`, [project_id])
      if (!rows.length) {
        await client.query('ROLLBACK')
        return res.status(404).json({ error: 'Проект не найден' })
      }
      projectNameResolved = rows[0].name
    } else {
      const trimmed = String(project_name).trim()
      if (!trimmed) {
        await client.query('ROLLBACK')
        return res.status(400).json({ error: 'Название проекта пустое' })
      }
      const { rows } = await client.query(
        `INSERT INTO projects (name) VALUES ($1) RETURNING id, name`,
        [trimmed]
      )
      projectIdResolved = rows[0].id
      projectNameResolved = rows[0].name
    }

    // ── 2. Director проекта (только если проект новый) ──
    if (!project_id) {
      // Если email указан — проверяем, не занят ли. При занятости — 409,
      // директор склада уберёт email и попробует снова (или передаст вручную).
      if (director_email) {
        const { rows: dup } = await client.query(
          `SELECT id FROM users WHERE LOWER(email) = LOWER($1)`, [director_email]
        )
        if (dup.length) {
          await client.query('ROLLBACK')
          return res.status(409).json({ error: 'Email директора проекта уже зарегистрирован — уберите email или используйте существующий аккаунт' })
        }
      }
      const directorClaimToken = makeClaimToken()
      const claimExpires = new Date(Date.now() + CLAIM_TTL_DAYS * 24 * 60 * 60 * 1000)
      await client.query(
        `INSERT INTO users (name, email, phone, role, project_id, is_provisional, claim_token, claim_token_expires)
         VALUES ($1, $2, $3, 'project_director', $4, true, $5, $6)`,
        [
          String(director_name).trim(),
          director_email || null,
          String(director_phone).trim(),
          projectIdResolved,
          directorClaimToken,
          claimExpires,
        ]
      )
      if (director_email) {
        emailsToSend.push({
          to: director_email,
          subject: `Ваш проект «${projectNameResolved}» зарегистрирован складом — 3XMedia Production`,
          html: `
            <p>Здравствуйте, ${escHtml(director_name)}.</p>
            <p>Склад 3XMedia Production зарегистрировал ваш проект <b>«${escHtml(projectNameResolved)}»</b> и оформил выдачу реквизита.</p>
            <p>Активируйте управление проектом, установив пароль:</p>
            <p><a href="${claimUrl(directorClaimToken)}" style="display:inline-block;background:#1f2937;color:#fff;padding:10px 20px;border-radius:6px;text-decoration:none;">Активировать аккаунт</a></p>
            <p style="color:#6b7280;font-size:13px;">Ссылка действительна ${CLAIM_TTL_DAYS} дней. После активации вы сможете приглашать команду проекта в систему.</p>
          `,
        })
      }
    }

    // ── 3. Получатель ──
    let receivedById
    let receiverName, receiverRole, receiverContact
    if (recipient_user_id) {
      const { rows } = await client.query(
        `SELECT id, name, role, email, phone, project_id FROM users WHERE id=$1`, [recipient_user_id]
      )
      if (!rows.length) {
        await client.query('ROLLBACK')
        return res.status(404).json({ error: 'Получатель не найден' })
      }
      const ex = rows[0]
      if (ex.project_id !== projectIdResolved) {
        await client.query('ROLLBACK')
        return res.status(400).json({ error: 'Получатель привязан к другому проекту' })
      }
      if (!WALKIN_RECEIVER_ROLES.has(ex.role)) {
        await client.query('ROLLBACK')
        return res.status(400).json({ error: 'Недопустимая роль получателя' })
      }
      receivedById = ex.id
      receiverName = ex.name
      receiverRole = ex.role
      receiverContact = ex.phone || ex.email || ''
    } else {
      if (recipient_email) {
        const { rows: dup } = await client.query(
          `SELECT id FROM users WHERE LOWER(email) = LOWER($1)`, [recipient_email]
        )
        if (dup.length) {
          await client.query('ROLLBACK')
          return res.status(409).json({ error: 'Email получателя уже зарегистрирован — уберите email или выберите существующего пользователя' })
        }
      }
      const recipientClaimToken = makeClaimToken()
      const claimExpires = new Date(Date.now() + CLAIM_TTL_DAYS * 24 * 60 * 60 * 1000)
      const { rows } = await client.query(
        `INSERT INTO users (name, email, phone, role, project_id, is_provisional, claim_token, claim_token_expires)
         VALUES ($1, $2, $3, $4, $5, true, $6, $7) RETURNING id, name, role, phone, email`,
        [
          String(recipient_name).trim(),
          recipient_email || null,
          String(recipient_phone).trim(),
          recipient_role,
          projectIdResolved,
          recipientClaimToken,
          claimExpires,
        ]
      )
      const r = rows[0]
      receivedById = r.id
      receiverName = r.name
      receiverRole = r.role
      receiverContact = r.phone || r.email || ''
      // Email получателю отправим в самом конце вместе с PDF — храним токен в closure.
      if (recipient_email) {
        emailsToSend.push({
          to: recipient_email,
          subject: `Акт выдачи реквизита — проект «${projectNameResolved}» — 3XMedia Production`,
          // PDF-ссылка дозаписывается ниже после генерации.
          html: null,
          _claimToken: recipientClaimToken,
          _isReceiverPdf: true,
        })
      }
    }

    // ── 4. Юниты ──
    // Каждый item — либо новый (создаём), либо existing_id (берём с полки).
    // Для serial новых — один SELECT count + in-memory инкремент.
    const { rows: cntRows } = await client.query(`SELECT COUNT(*)::int AS cnt FROM units`)
    let runningCount = cntRows[0]?.cnt || 0
    const createdUnitIds = []
    const createdUnitsForPdf = []

    for (const u of units) {
      if (u.existing_id) {
        // Existing — лежит на полке, переводим в issued. Photo берём stock.
        const { rows: ex } = await client.query(
          `SELECT u.*,
                  (SELECT url FROM unit_photos WHERE unit_id = u.id AND type='stock'
                   ORDER BY created_at LIMIT 1) AS photo_url
           FROM units u WHERE u.id = $1`,
          [u.existing_id]
        )
        if (!ex.length) {
          await client.query('ROLLBACK')
          return res.status(404).json({ error: 'Единица не найдена в базе' })
        }
        const exu = ex[0]
        if (exu.status !== 'on_stock' || exu.misplaced || exu.is_project_kept) {
          await client.query('ROLLBACK')
          let why
          if (exu.status === 'issued') why = 'уже выдана'
          else if (exu.status === 'written_off') why = 'списана'
          else if (exu.status === 'debt') why = 'в долге'
          else if (exu.misplaced) why = 'помечена как пересорт — найдите её на /misplaced'
          else if (exu.is_project_kept) why = 'хранится у проекта, не на общем складе'
          else why = `недоступна (${exu.status})`
          return res.status(400).json({ error: `Единица «${exu.name}» ${why}` })
        }
        createdUnitIds.push(exu.id)
        createdUnitsForPdf.push({ ...exu, _existing: true, _photoUrls: [] })
      } else {
        // Новая — AI-распознанная, создаём с минимумом полей.
        runningCount += 1
        const catPrefix = String(u.category || 'XX').slice(0, 3).toUpperCase()
        const serial = `${catPrefix}-${String(runningCount).padStart(5, '0')}`
        const qty = Number.isFinite(Number(u.qty)) && Number(u.qty) > 0 ? Number(u.qty) : 1

        const { rows: ins } = await client.query(
          `INSERT INTO units (name, category, serial, qty, description, period, dimensions,
                              status, is_walkin, created_via)
           VALUES ($1,$2,$3,$4,$5,$6,$7,'issued',true,'walkin_issue')
           RETURNING *`,
          [
            String(u.name).trim().slice(0, 200),
            String(u.category).trim(),
            serial,
            qty,
            u.description ? String(u.description).slice(0, 1000) : null,
            u.period ? String(u.period).slice(0, 80) : null,
            u.dimensions ? String(u.dimensions).slice(0, 200) : null,
          ]
        )
        const unit = ins[0]
        createdUnitIds.push(unit.id)

        // Фото — поле photos_<temp_id>. stock (для карточки) + дубль issue
        // ниже после issuance.id.
        const photoFiles = filesByField[`photos_${u.temp_id}`] || []
        const uploadedPhotoUrls = []
        for (const f of photoFiles) {
          const url = await uploadFile(f.buffer, f.originalname || 'photo.jpg', 'units')
          uploadedPhotoUrls.push(url)
          await client.query(
            `INSERT INTO unit_photos (unit_id, url, type) VALUES ($1, $2, 'stock')`,
            [unit.id, url]
          )
        }

        await client.query(
          `INSERT INTO unit_history (unit_id, action, user_id) VALUES ($1, 'Добавлено', $2)`,
          [unit.id, req.user.id]
        )

        createdUnitsForPdf.push({ ...unit, photo_url: uploadedPhotoUrls[0] || null, _photoUrls: uploadedPhotoUrls })
      }
    }

    // Existing-юниты переводим в issued одним апдейтом (новые уже issued при INSERT'е).
    const existingIds = createdUnitsForPdf.filter(x => x._existing).map(x => x.id)
    if (existingIds.length) {
      await client.query(
        `UPDATE units SET status='issued' WHERE id = ANY($1)`,
        [existingIds]
      )
    }

    // ── 5. Synthetic request (status=issued) — чтобы issuance имел request_id
    // и существующие join'ы issuances → requests → unit_ids работали для walk-in. ──
    const { rows: reqRows } = await client.query(
      `INSERT INTO requests (unit_ids, requester_id, status, deadline)
       VALUES ($1, $2, 'issued', $3) RETURNING id`,
      [createdUnitIds, receivedById, deadline]
    )
    const synthRequestId = reqRows[0].id

    // ── 6. Подпись получателя — файл или base64 ──
    let signature_url = null
    if (filesByField.signature?.[0]) {
      signature_url = await uploadFile(filesByField.signature[0].buffer, 'signature.png', 'signatures')
    } else if (req.body.signature_data) {
      // base64 → буфер → S3
      const m = String(req.body.signature_data).match(/^data:image\/(png|jpeg|jpg);base64,(.+)$/)
      if (m) {
        const buf = Buffer.from(m[2], 'base64')
        signature_url = await uploadFile(buf, `signature.${m[1] === 'jpeg' ? 'jpg' : m[1]}`, 'signatures')
      }
    }

    // ── 7. PDF ──
    const { rows: issuerRows } = await client.query(
      `SELECT name, role FROM users WHERE id=$1`, [req.user.id]
    )
    const issuer = issuerRows[0] || {}
    const pdfBytes = await createIssuancePDF({
      items: createdUnitsForPdf,
      issuedTo: receiverName,
      issuedBy: issuer.name || 'Склад',
      deadline,
      signatureDataUrl: req.body.signature_data,
      issuerSignatureDataUrl: req.body.issuer_signature_data === 'stamp' ? null : req.body.issuer_signature_data,
      issuerStamp: req.body.issuer_signature_data === 'stamp',
      receiverRole: receiverRole,
      receiverContact: receiverContact,
      projectName: projectNameResolved,
      issuerRole: issuer.role,
    })
    const pdfBuffer = Buffer.from(pdfBytes)
    const act_pdf_url = await uploadFile(pdfBuffer, 'act_issue.pdf', 'acts')

    // ── 8. Issuance ──
    const { rows: issRows } = await client.query(
      `INSERT INTO issuances (request_id, issued_by, received_by, signature_url, act_pdf_url, deadline)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [synthRequestId, req.user.id, receivedById, signature_url, act_pdf_url, deadline]
    )
    const issuance = issRows[0]

    // ── 9. История + дубль фото как issue ──
    for (const u of createdUnitsForPdf) {
      await client.query(
        `INSERT INTO unit_history (unit_id, action, user_id, project_id, issuance_id)
         VALUES ($1, 'Выдано', $2, $3, $4)`,
        [u.id, req.user.id, projectIdResolved, issuance.id]
      )
      for (const url of u._photoUrls) {
        await client.query(
          `INSERT INTO unit_photos (unit_id, url, type, issuance_id)
           VALUES ($1, $2, 'issue', $3)`,
          [u.id, url, issuance.id]
        )
      }
    }

    await client.query('COMMIT')

    // ── 10. Email-уведомления (после commit'а) ──
    for (const e of emailsToSend) {
      try {
        if (e._isReceiverPdf) {
          // получатель — PDF + claim-link в одном письме
          const html = `
            <p>Здравствуйте, ${escHtml(receiverName)}.</p>
            <p>Вам выдан реквизит со склада 3XMedia Production по проекту <b>«${escHtml(projectNameResolved)}»</b>.</p>
            <p><a href="${escHtml(act_pdf_url)}" style="display:inline-block;background:#0f766e;color:#fff;padding:10px 20px;border-radius:6px;text-decoration:none;">Открыть акт выдачи (PDF)</a></p>
            <p>Чтобы видеть свои выдачи и оформлять возвраты, активируйте аккаунт:</p>
            <p><a href="${claimUrl(e._claimToken)}" style="display:inline-block;background:#1f2937;color:#fff;padding:10px 20px;border-radius:6px;text-decoration:none;">Активировать аккаунт</a></p>
            <p style="color:#6b7280;font-size:13px;">Ссылка активации действительна ${CLAIM_TTL_DAYS} дней.</p>
          `
          await sendEmail({ to: e.to, subject: e.subject, html })
        } else {
          await sendEmail({ to: e.to, subject: e.subject, html: e.html })
        }
      } catch (mailErr) {
        // Email-сбой не должен ломать ответ — лог и едем дальше.
        console.error('walkin: email send failed:', mailErr?.message || mailErr)
      }
    }

    res.status(201).json({
      issuance,
      project_id: projectIdResolved,
      received_by: receivedById,
      unit_ids: createdUnitIds,
      act_pdf_url,
    })
  } catch (err) {
    try { await client.query('ROLLBACK') } catch { /* noop */ }
    console.error('walkin/issue error:', err)
    res.status(500).json({ error: 'Server error' })
  } finally {
    client.release()
  }
})

// GET /walkin/projects?q=  — autocomplete по названию проектов (для экрана 1).
// Возвращает 10 совпадений по ILIKE.
router.get('/projects', verifyJWT, checkRole(...WALKIN_ISSUER_ROLES), async (req, res) => {
  const q = String(req.query.q || '').trim()
  if (q.length < 2) return res.json({ projects: [] })
  try {
    const { rows } = await db.query(
      `SELECT id, name FROM projects WHERE name ILIKE $1 ORDER BY name LIMIT 10`,
      [`%${q}%`]
    )
    res.json({ projects: rows })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Server error' })
  }
})

// GET /walkin/users?project_id=&q=  — autocomplete по людям проекта (экран 2,
// чтобы при совпадении ФИО предложить existing'а вместо дубля).
router.get('/users', verifyJWT, checkRole(...WALKIN_ISSUER_ROLES), async (req, res) => {
  const project_id = String(req.query.project_id || '').trim()
  const q = String(req.query.q || '').trim()
  if (!project_id || q.length < 2) return res.json({ users: [] })
  try {
    const { rows } = await db.query(
      `SELECT id, name, role, phone, email, is_provisional
       FROM users WHERE project_id=$1 AND name ILIKE $2 ORDER BY name LIMIT 10`,
      [project_id, `%${q}%`]
    )
    res.json({ users: rows })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Server error' })
  }
})

module.exports = router
