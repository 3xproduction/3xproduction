// Cross-project inventory visibility and loan requests.
// - Видимость складов чужих проектов.
// - Заявки на заём единицы между проектами: "прошу у владельца — владелец выдаёт — я возвращаю".
// Логика повторяет обычные заявки на склад (requests.js), но между двумя проектами.

const router = require('express').Router()
const db = require('../db')
const { verifyJWT } = require('../middleware/auth')
const { createNotification } = require('../services/notifications')

// Роли, которые могут ВЫДАВАТЬ единицы чужому проекту (responder в заявке).
// Делим по категориям: реквизит vs костюмы.
const PROPS_RESPONDER_ROLES = [
  'project_director',
  'production_designer',
  'art_director_assistant',
  'props_master',
  'props_assistant',
]
const COSTUMES_RESPONDER_ROLES = [
  'project_director',
  'production_designer',
  'costumer',
  'costume_assistant',
]
const COSTUME_CATEGORIES = new Set(['costumes', 'shoes', 'jewelry', 'accessories', 'clothing'])

function responderRolesForCategory(category) {
  return COSTUME_CATEGORIES.has(category) ? COSTUMES_RESPONDER_ROLES : PROPS_RESPONDER_ROLES
}

// GET /colleagues/projects — other projects with at least one available item.
router.get('/projects', verifyJWT, async (req, res) => {
  try {
    const myPid = req.user.project_id
    const { rows } = await db.query(
      `SELECT p.id, p.name,
              COUNT(u.id) FILTER (WHERE u.status='on_stock' AND u.is_project_kept=true
                                   AND COALESCE(u.on_loan_to_project_id, '00000000-0000-0000-0000-000000000000'::uuid) != $1::uuid
                                  ) AS available_count
       FROM projects p
       LEFT JOIN units u ON u.project_id = p.id
       WHERE ($1::uuid IS NULL OR p.id != $1::uuid)
       GROUP BY p.id, p.name
       HAVING COUNT(u.id) FILTER (WHERE u.status='on_stock' AND u.is_project_kept=true) > 0
       ORDER BY available_count DESC, p.name`,
      [myPid]
    )
    res.json({ projects: rows })
  } catch (err) {
    console.error(err)
    res.json({ projects: [] })
  }
})

// GET /colleagues/projects/:id/units — items owned by another project.
router.get('/projects/:id/units', verifyJWT, async (req, res) => {
  try {
    const myPid = req.user.project_id
    if (String(myPid) === String(req.params.id)) {
      return res.status(400).json({ error: 'Use /project-units for own project' })
    }
    const { rows } = await db.query(
      `SELECT u.id, u.name, u.category, u.description, u.qty, u.status,
              u.purchased, u.purchase_price, u.on_loan_to_project_id,
              p.name AS project_name,
              (SELECT url FROM unit_photos WHERE unit_id = u.id
               ORDER BY CASE WHEN url ~* '\\.(mp4|webm|mov)$' THEN 1 ELSE 0 END, created_at LIMIT 1) AS photo_url
       FROM units u
       LEFT JOIN projects p ON p.id = u.project_id
       WHERE u.project_id = $1
         AND u.is_project_kept = true
         AND u.status = 'on_stock'
       ORDER BY u.created_at DESC`,
      [req.params.id]
    )
    res.json({ units: rows })
  } catch (err) {
    console.error(err)
    res.json({ units: [] })
  }
})

// GET /colleagues/responders?project_id=...&category=...
// Кандидаты-выдающие в проекте-владельце для данной категории единицы.
router.get('/responders', verifyJWT, async (req, res) => {
  const { project_id, category } = req.query
  if (!project_id) return res.status(400).json({ error: 'project_id required' })
  const roles = responderRolesForCategory(category || 'props')
  try {
    const { rows } = await db.query(
      `SELECT id, name, email, role
       FROM users
       WHERE project_id = $1 AND role = ANY($2)
       ORDER BY role, name`,
      [project_id, roles]
    )
    res.json({ responders: rows })
  } catch (err) {
    console.error(err)
    res.json({ responders: [] })
  }
})

// POST /colleagues/requests — запросить единицу у чужого проекта.
// body: { unit_id, responder_id, deadline, comment }
router.post('/requests', verifyJWT, async (req, res) => {
  const { unit_id, responder_id, deadline, comment } = req.body
  if (!unit_id) return res.status(400).json({ error: 'unit_id required' })
  if (!req.user.project_id) return res.status(400).json({ error: 'Вы не привязаны к проекту' })

  try {
    const { rows: unitRows } = await db.query(
      `SELECT * FROM units WHERE id = $1 AND is_project_kept = true AND status = 'on_stock'`,
      [unit_id]
    )
    if (!unitRows.length) return res.status(404).json({ error: 'Единица не найдена или недоступна' })
    const unit = unitRows[0]
    if (String(unit.project_id) === String(req.user.project_id)) {
      return res.status(400).json({ error: 'Это единица вашего проекта' })
    }
    if (unit.on_loan_to_project_id) {
      return res.status(400).json({ error: 'Единица уже передана другому проекту' })
    }

    // Проверка, что запрос к этой единице ещё не висит в pending.
    const { rows: dup } = await db.query(
      `SELECT id FROM project_loan_requests
       WHERE unit_id = $1 AND to_project_id = $2 AND status = 'pending'`,
      [unit_id, req.user.project_id]
    )
    if (dup.length) return res.status(400).json({ error: 'Запрос уже отправлен, ожидает ответа' })

    const { rows } = await db.query(
      `INSERT INTO project_loan_requests
         (unit_id, from_project_id, to_project_id, requested_by, responder_id, deadline, comment)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [unit_id, unit.project_id, req.user.project_id, req.user.id,
       responder_id || null, deadline || null, (comment || '').slice(0, 500) || null]
    )
    const request = rows[0]

    // Уведомление выдающему (или всем подходящим по ролям, если adresat не указан).
    const { rows: requester } = await db.query(
      `SELECT u.name, p.name AS project_name FROM users u
       LEFT JOIN projects p ON p.id = u.project_id WHERE u.id = $1`,
      [req.user.id]
    )
    const fromLabel = requester[0]
      ? [requester[0].project_name, requester[0].name].filter(Boolean).join(' · ')
      : ''

    const notifyText = `Запрос единицы «${unit.name}»${fromLabel ? ` от ${fromLabel}` : ''}`
    const notifyPayload = {
      type: 'loan_request',
      text: notifyText,
      entity_id: request.id,
      entity_type: 'project_loan_request',
    }
    if (responder_id) {
      await createNotification({ user_id: responder_id, ...notifyPayload }).catch(() => {})
    } else {
      const roles = responderRolesForCategory(unit.category)
      const { rows: targets } = await db.query(
        `SELECT id FROM users WHERE project_id = $1 AND role = ANY($2)`,
        [unit.project_id, roles]
      )
      for (const t of targets) {
        await createNotification({ user_id: t.id, ...notifyPayload }).catch(() => {})
      }
    }

    res.status(201).json({ request })
  } catch (err) {
    console.error('loan request create:', err)
    res.status(500).json({ error: 'Server error' })
  }
})

// GET /colleagues/requests?direction=incoming|outgoing
router.get('/requests', verifyJWT, async (req, res) => {
  const direction = req.query.direction || 'incoming'
  const status = req.query.status
  const myProject = req.user.project_id
  if (!myProject) return res.json({ requests: [] })

  try {
    const params = [myProject]
    let where
    if (direction === 'outgoing') {
      where = `r.to_project_id = $1`
    } else {
      where = `r.from_project_id = $1`
    }
    if (status) { params.push(status); where += ` AND r.status = $${params.length}` }

    const { rows } = await db.query(
      `SELECT r.*,
              u.name   AS unit_name, u.category AS unit_category,
              u.description AS unit_description,
              (SELECT url FROM unit_photos WHERE unit_id = u.id
               ORDER BY created_at LIMIT 1) AS unit_photo,
              fp.name  AS from_project_name,
              tp.name  AS to_project_name,
              ru.name  AS requested_by_name, ru.role AS requested_by_role,
              rs.name  AS responder_name,    rs.role AS responder_role
       FROM project_loan_requests r
       JOIN units u        ON u.id  = r.unit_id
       JOIN projects fp    ON fp.id = r.from_project_id
       JOIN projects tp    ON tp.id = r.to_project_id
       JOIN users ru       ON ru.id = r.requested_by
       LEFT JOIN users rs  ON rs.id = r.responder_id
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

// POST /colleagues/requests/:id/accept — выдающий соглашается.
router.post('/requests/:id/accept', verifyJWT, async (req, res) => {
  try {
    const { rows } = await db.query(
      `SELECT * FROM project_loan_requests WHERE id = $1 AND status = 'pending'`,
      [req.params.id]
    )
    if (!rows.length) return res.status(404).json({ error: 'Заявка не найдена' })
    const r = rows[0]
    if (String(r.from_project_id) !== String(req.user.project_id)) {
      return res.status(403).json({ error: 'Forbidden' })
    }

    // Единица переходит во временное пользование другого проекта.
    await db.query(
      `UPDATE units SET on_loan_to_project_id = $2 WHERE id = $1`,
      [r.unit_id, r.to_project_id]
    )
    await db.query(
      `UPDATE project_loan_requests
         SET status='accepted', decided_at=NOW(), responder_id=$2,
             response_comment=$3
       WHERE id=$1`,
      [req.params.id, req.user.id, (req.body?.comment || '').slice(0, 500) || null]
    )
    await db.query(
      `INSERT INTO unit_history (unit_id, action, user_id, notes)
       VALUES ($1, 'Выдано по заявке другого проекта', $2, $3)`,
      [r.unit_id, req.user.id, r.comment || null]
    )

    await createNotification({
      user_id: r.requested_by,
      type: 'loan_accepted',
      text: 'Заявка одобрена — единица передана вам во временное пользование',
      entity_id: r.id,
      entity_type: 'project_loan_request',
    }).catch(() => {})

    res.json({ ok: true })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Server error' })
  }
})

// POST /colleagues/requests/:id/reject
router.post('/requests/:id/reject', verifyJWT, async (req, res) => {
  try {
    const { rows } = await db.query(
      `SELECT * FROM project_loan_requests WHERE id = $1 AND status = 'pending'`,
      [req.params.id]
    )
    if (!rows.length) return res.status(404).json({ error: 'Заявка не найдена' })
    const r = rows[0]
    if (String(r.from_project_id) !== String(req.user.project_id)) {
      return res.status(403).json({ error: 'Forbidden' })
    }
    await db.query(
      `UPDATE project_loan_requests
         SET status='rejected', decided_at=NOW(), responder_id=$2,
             response_comment=$3
       WHERE id=$1`,
      [req.params.id, req.user.id, (req.body?.comment || '').slice(0, 500) || null]
    )
    await createNotification({
      user_id: r.requested_by,
      type: 'loan_rejected',
      text: 'Заявка отклонена',
      entity_id: r.id,
      entity_type: 'project_loan_request',
    }).catch(() => {})
    res.json({ ok: true })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Server error' })
  }
})

// POST /colleagues/requests/:id/cancel — запросчик отменяет свою заявку (pending).
router.post('/requests/:id/cancel', verifyJWT, async (req, res) => {
  try {
    const { rows } = await db.query(
      `SELECT * FROM project_loan_requests WHERE id = $1 AND status = 'pending'`,
      [req.params.id]
    )
    if (!rows.length) return res.status(404).json({ error: 'Заявка не найдена' })
    const r = rows[0]
    if (String(r.requested_by) !== String(req.user.id)) {
      return res.status(403).json({ error: 'Forbidden' })
    }
    await db.query(
      `UPDATE project_loan_requests SET status='cancelled', decided_at=NOW() WHERE id=$1`,
      [req.params.id]
    )
    res.json({ ok: true })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Server error' })
  }
})

// POST /colleagues/requests/:id/return — запросчик возвращает единицу владельцу.
router.post('/requests/:id/return', verifyJWT, async (req, res) => {
  try {
    const { rows } = await db.query(
      `SELECT * FROM project_loan_requests WHERE id = $1 AND status = 'accepted'`,
      [req.params.id]
    )
    if (!rows.length) return res.status(404).json({ error: 'Заявка не найдена' })
    const r = rows[0]
    // Возвращать может запросчик или владелец.
    const isRequester = String(r.requested_by) === String(req.user.id)
      || String(r.to_project_id) === String(req.user.project_id)
    const isOwner = String(r.from_project_id) === String(req.user.project_id)
    if (!isRequester && !isOwner) return res.status(403).json({ error: 'Forbidden' })

    await db.query(`UPDATE units SET on_loan_to_project_id = NULL WHERE id = $1`, [r.unit_id])
    await db.query(
      `UPDATE project_loan_requests
         SET status='returned', returned_at=NOW()
       WHERE id=$1`,
      [req.params.id]
    )
    await db.query(
      `INSERT INTO unit_history (unit_id, action, user_id)
       VALUES ($1, 'Возвращено на склад проекта-владельца', $2)`,
      [r.unit_id, req.user.id]
    )
    // Уведомить вторую сторону.
    const notifyUserId = isRequester ? r.responder_id : r.requested_by
    if (notifyUserId) {
      await createNotification({
        user_id: notifyUserId,
        type: 'loan_returned',
        text: 'Единица возвращена по заявке',
        entity_id: r.id,
        entity_type: 'project_loan_request',
      }).catch(() => {})
    }
    res.json({ ok: true })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Server error' })
  }
})

// POST /colleagues/requests/:id/extend — запросчик просит продлить срок.
router.post('/requests/:id/extend', verifyJWT, async (req, res) => {
  const { new_deadline } = req.body
  if (!new_deadline) return res.status(400).json({ error: 'new_deadline required' })
  try {
    const { rows } = await db.query(
      `SELECT * FROM project_loan_requests WHERE id = $1 AND status = 'accepted'`,
      [req.params.id]
    )
    if (!rows.length) return res.status(404).json({ error: 'Заявка не найдена' })
    const r = rows[0]
    if (String(r.requested_by) !== String(req.user.id)) {
      return res.status(403).json({ error: 'Forbidden' })
    }
    await db.query(
      `UPDATE project_loan_requests
         SET extension_requested=true, extension_new_deadline=$2
       WHERE id=$1`,
      [req.params.id, new_deadline]
    )
    if (r.responder_id) {
      await createNotification({
        user_id: r.responder_id,
        type: 'loan_extension',
        text: `Запрос продления до ${new_deadline}`,
        entity_id: r.id,
        entity_type: 'project_loan_request',
      }).catch(() => {})
    }
    res.json({ ok: true })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Server error' })
  }
})

// POST /colleagues/requests/:id/approve-extension — владелец одобряет новый дедлайн.
router.post('/requests/:id/approve-extension', verifyJWT, async (req, res) => {
  try {
    const { rows } = await db.query(
      `SELECT * FROM project_loan_requests
       WHERE id = $1 AND status = 'accepted' AND extension_requested = true`,
      [req.params.id]
    )
    if (!rows.length) return res.status(404).json({ error: 'Заявка не найдена' })
    const r = rows[0]
    if (String(r.from_project_id) !== String(req.user.project_id)) {
      return res.status(403).json({ error: 'Forbidden' })
    }
    await db.query(
      `UPDATE project_loan_requests
         SET deadline = COALESCE(extension_new_deadline, deadline),
             extension_requested = false,
             extension_new_deadline = NULL
       WHERE id=$1`,
      [req.params.id]
    )
    await createNotification({
      user_id: r.requested_by,
      type: 'loan_extended',
      text: 'Продление срока одобрено',
      entity_id: r.id,
      entity_type: 'project_loan_request',
    }).catch(() => {})
    res.json({ ok: true })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Server error' })
  }
})

module.exports = router
