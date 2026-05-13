// Cross-project inventory visibility and loan requests.
// - Видимость складов чужих проектов.
// - Заявки на заём единицы между проектами: "прошу у владельца — владелец выдаёт — я возвращаю".
// Логика повторяет обычные заявки на склад (requests.js), но между двумя проектами.

const router = require('express').Router()
const db = require('../db')
const { verifyJWT } = require('../middleware/auth')
const { createNotification } = require('../services/notifications')
const { unitMissingFields, canSeeMissingUnitData } = require('../utils/unitMissingFields')

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
const PENDING_REQUEST_DETAIL_ROLES = new Set(['warehouse_director', 'warehouse_deputy', 'warehouse_staff', 'producer'])

function responderRolesForCategory(category) {
  return COSTUME_CATEGORIES.has(category) ? COSTUMES_RESPONDER_ROLES : PROPS_RESPONDER_ROLES
}

// 409-ответ когда заявка уже не в нужном статусе. Раньше отдавали 404 и
// это путало пользователя — он видел кнопку «Принять и выдать» из закешированного
// списка, кликал, получал «Заявка не найдена», хотя на деле другой ответственный
// уже принял её. currentStatus в теле даёт фронту повод перерисовать список.
const STATUS_VERB = {
  pending: 'ожидает ответа',
  accepted: 'уже принята',
  rejected: 'уже отклонена',
  cancelled: 'уже отменена',
  returned: 'уже возвращена',
}
function alreadyHandled(status) {
  return {
    error: `Заявка ${STATUS_VERB[status] || `в статусе ${status}`}`,
    currentStatus: status,
  }
}

function canRespondToLoanRequest(user, request) {
  if (String(request.from_project_id) !== String(user.project_id)) return false
  if (request.responder_id && String(request.responder_id) === String(user.id)) return true
  return responderRolesForCategory(request.unit_category || request.category).includes(user.role)
}

// GET /colleagues/projects — все существующие проекты, кроме своего.
// available_count = own + from_warehouse + from_project. Считаем тремя
// независимыми запросами с GROUP BY, чтобы избежать PG-плановых ловушек
// в LATERAL+UNION_ALL (раньше счётчик бывал 0 у проектов с реальной выдачей).
// Возвращаем breakdown — удобно для дебага в DevTools.
router.get('/projects', verifyJWT, async (req, res) => {
  try {
    const myPid = req.user.project_id
    const [{ rows: projects }, { rows: ownC }, { rows: whC }, { rows: loanC }] = await Promise.all([
      db.query(
        `SELECT id, name FROM projects
         WHERE ($1::uuid IS NULL OR id != $1::uuid)
         ORDER BY name`, [myPid]),
      db.query(
        // Когда myPid = NULL (warehouse_director/deputy/staff/producer без
        // своего проекта) — фильтр должен быть no-op. Старый COALESCE-вариант
        // инвертировал условие и обнулял счётчик own у проектов с единицами
        // не на займе (NULL != ZERO давал false для NULL on_loan_to_project_id).
        `SELECT project_id AS pid, COUNT(*)::int AS cnt
         FROM units
         WHERE is_project_kept = true
           AND status = 'on_stock'
           AND project_id IS NOT NULL
           AND ($1::uuid IS NULL OR on_loan_to_project_id IS DISTINCT FROM $1::uuid)
         GROUP BY project_id`, [myPid]),
      db.query(
        // u.on_loan_to_project_id IS NULL — единицы, переданные другому проекту
        // через colleagues-loan, не должны числиться у issuance-проекта (они
        // физически у другого проекта и считаются там как from_project).
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
    }).sort((a, b) => b.available_count - a.available_count || a.name.localeCompare(b.name))
    res.json({ projects: out })
  } catch (err) {
    console.error(err)
    res.json({ projects: [] })
  }
})

// GET /colleagues/projects/:id/units?source=&category=
// Каталог чужого проекта — те же 3 источника что и в /project-units:
//   own / from_warehouse / from_project
// Каждая строка имеет поле `source`. «Запросить» во фронте доступно только
// для own (см. ColleaguesPage).
router.get('/projects/:id/units', verifyJWT, async (req, res) => {
  try {
    const myPid = req.user.project_id
    if (String(myPid) === String(req.params.id)) {
      return res.status(400).json({ error: 'Use /project-units for own project' })
    }
    const canSeePendingRequestDetails = PENDING_REQUEST_DETAIL_ROLES.has(req.user.role)
    const params = [req.params.id, myPid || null, canSeePendingRequestDetails]
    let q = `
      WITH sources AS (
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
          AND u.status = 'on_stock'

        UNION ALL

        SELECT u.id, 'from_warehouse',
               NULL, NULL, NULL,
               iss.id, iss.issued_at, iss.deadline,
               iss.issued_at
        FROM units u
        JOIN issuances iss ON true
        JOIN users rcv     ON rcv.id = iss.received_by AND rcv.project_id = $1
        JOIN requests req  ON req.id = iss.request_id
        WHERE u.id = ANY(req.unit_ids)
          AND u.status IN ('issued','overdue')
          AND u.on_loan_to_project_id IS NULL
          AND NOT EXISTS (SELECT 1 FROM returns r WHERE r.issuance_id = iss.id)

        UNION ALL

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
             u.id, u.name, u.category, u.description, u.qty, u.status,
             u.dimensions, u.serial,
             u.purchased, u.purchase_price, u.on_loan_to_project_id,
             u.source AS unit_source_for_missing,
             u.valuation AS unit_valuation_for_missing,
             p.name AS project_name,
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
    q += ` ORDER BY s.sort_at DESC NULLS LAST`
    const { rows } = await db.query(q, params)
    const units = rows.map(({ unit_source_for_missing, unit_valuation_for_missing, ...rest }) => {
      if (canSeeMissingUnitData(req.user.role)) {
        rest.missing_fields = unitMissingFields({
          ...rest,
          source: unit_source_for_missing,
          valuation: unit_valuation_for_missing,
        })
      }
      return rest
    })
    res.json({ units })
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
  if (!req.user.project_id) return res.status(400).json({ error: 'project context required' })
  const roles = responderRolesForCategory(category || 'props')
  try {
    const { rows } = await db.query(
      `SELECT id, name, role
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
//
// Поддерживаемые источники единицы:
//   • own            — собственность проекта-держателя (is_project_kept, on_stock).
//   • from_warehouse — выдана складом сотруднику проекта-держателя (status=issued/overdue).
// from_project (sub-loan) пока не поддерживается — возвратная цепочка неоднозначна.
//
// Текущего держателя определяем из состояния единицы. В обоих случаях
// from_project_id заявки = проект-держатель: его responder одобряет передачу.
// Уведомления уходят: responder(ы) проекта-держателя + warehouse_director(s)
// (склад фиксирует факт, что физическая единица меняет ответственного).
router.post('/requests', verifyJWT, async (req, res) => {
  const { unit_id, responder_id, deadline, comment } = req.body
  if (!unit_id) return res.status(400).json({ error: 'unit_id required' })
  if (!req.user.project_id) return res.status(400).json({ error: 'Вы не привязаны к проекту' })

  try {
    const { rows: unitRows } = await db.query(`SELECT * FROM units WHERE id = $1`, [unit_id])
    if (!unitRows.length) return res.status(404).json({ error: 'Единица не найдена' })
    const unit = unitRows[0]

    if (unit.on_loan_to_project_id) {
      if (String(unit.on_loan_to_project_id) === String(req.user.project_id)) {
        return res.status(400).json({ error: 'Эта единица уже передана вашему проекту' })
      }
      return res.status(400).json({ error: 'Единица уже передана другому проекту' })
    }

    // Определяем текущего держателя.
    let holderProjectId = null
    let sourceLabel = ''
    if (unit.is_project_kept && unit.project_id && unit.status === 'on_stock') {
      holderProjectId = unit.project_id
      sourceLabel = 'own'
    } else if (unit.status === 'issued' || unit.status === 'overdue') {
      // Активная выдача со склада → проект держателя через issuance.received_by.
      const { rows: issRows } = await db.query(
        `SELECT rcv.project_id
         FROM issuances iss
         JOIN users rcv     ON rcv.id = iss.received_by
         JOIN requests req  ON req.id = iss.request_id
         WHERE $1::uuid = ANY(req.unit_ids)
           AND rcv.project_id IS NOT NULL
           AND NOT EXISTS (SELECT 1 FROM returns r WHERE r.issuance_id = iss.id)
         ORDER BY iss.issued_at DESC LIMIT 1`,
        [unit_id]
      )
      if (issRows.length) {
        holderProjectId = issRows[0].project_id
        sourceLabel = 'from_warehouse'
      }
    }
    if (!holderProjectId) {
      return res.status(400).json({ error: 'Не удалось определить, у какого проекта сейчас единица' })
    }
    if (String(holderProjectId) === String(req.user.project_id)) {
      return res.status(400).json({ error: 'Эта единица уже у вашего проекта' })
    }

    // Проверка, что запрос к этой единице ещё не висит в pending.
    const { rows: dup } = await db.query(
      `SELECT id FROM project_loan_requests
       WHERE unit_id = $1 AND to_project_id = $2 AND status = 'pending'`,
      [unit_id, req.user.project_id]
    )
    if (dup.length) return res.status(400).json({ error: 'Запрос уже отправлен, ожидает ответа' })

    if (responder_id) {
      const roles = responderRolesForCategory(unit.category)
      const { rows: responders } = await db.query(
        `SELECT id FROM users WHERE id = $1 AND project_id = $2 AND role = ANY($3)`,
        [responder_id, holderProjectId, roles]
      )
      if (!responders.length) {
        return res.status(400).json({ error: 'Недопустимый ответственный для этой категории' })
      }
    }

    const { rows } = await db.query(
      `INSERT INTO project_loan_requests
         (unit_id, from_project_id, to_project_id, requested_by, responder_id, deadline, comment)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [unit_id, holderProjectId, req.user.project_id, req.user.id,
       responder_id || null, deadline || null, (comment || '').slice(0, 500) || null]
    )
    const request = rows[0]

    // Подпись для текста уведомления.
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

    // Уведомляем держателя: либо конкретного responder, либо всех подходящих по роли.
    if (responder_id) {
      await createNotification({ user_id: responder_id, ...notifyPayload }).catch(() => {})
    } else {
      const roles = responderRolesForCategory(unit.category)
      const { rows: targets } = await db.query(
        `SELECT id FROM users WHERE project_id = $1 AND role = ANY($2)`,
        [holderProjectId, roles]
      )
      for (const t of targets) {
        await createNotification({ user_id: t.id, ...notifyPayload }).catch(() => {})
      }
    }

    // Уведомляем склад — для from_warehouse это критично (единица уйдёт под
    // ответственность другого проекта, а issuance со склада остаётся прежний).
    // Для own тоже шлём — склад полезно знать про межпроектные передачи.
    const whText = sourceLabel === 'from_warehouse'
      ? `Запрос на передачу выданной единицы «${unit.name}»${fromLabel ? ` к ${fromLabel}` : ''}`
      : notifyText
    const { rows: whAdmins } = await db.query(
      `SELECT id FROM users WHERE role IN ('warehouse_director','warehouse_deputy')`
    )
    for (const w of whAdmins) {
      await createNotification({
        user_id: w.id,
        type: 'loan_request',
        text: whText,
        entity_id: request.id,
        entity_type: 'project_loan_request',
      }).catch(() => {})
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
      `SELECT r.*, u.category AS unit_category
       FROM project_loan_requests r
       JOIN units u ON u.id = r.unit_id
       WHERE r.id = $1`,
      [req.params.id]
    )
    if (!rows.length) return res.status(404).json({ error: 'Заявка не найдена' })
    const r = rows[0]
    if (r.status !== 'pending') return res.status(409).json(alreadyHandled(r.status))
    if (!canRespondToLoanRequest(req.user, r)) {
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
      `INSERT INTO unit_history (unit_id, action, user_id, project_id, notes)
       VALUES ($1, 'Выдано по заявке другого проекта', $2, $3, $4)`,
      [r.unit_id, req.user.id, r.to_project_id, r.comment || null]
    )

    await createNotification({
      user_id: r.requested_by,
      type: 'loan_accepted',
      text: 'Заявка одобрена — единица передана вам во временное пользование',
      entity_id: r.id,
      entity_type: 'project_loan_request',
    }).catch(() => {})

    // Уведомление складу о фактической смене ответственного проекта.
    // Для from_warehouse-единиц issuance в БД остаётся, но физически вещь
    // теперь у другого проекта — склад должен это знать для контроля возврата.
    const { rows: ctx } = await db.query(
      `SELECT u.name AS unit_name,
              fp.name AS from_name, tp.name AS to_name
       FROM units u
       LEFT JOIN projects fp ON fp.id = $2::uuid
       LEFT JOIN projects tp ON tp.id = $3::uuid
       WHERE u.id = $1`,
      [r.unit_id, r.from_project_id, r.to_project_id]
    )
    const c = ctx[0] || {}
    const whText = `Передача единицы «${c.unit_name || ''}»: ${c.from_name || ''} → ${c.to_name || ''}`
    const { rows: whAdmins } = await db.query(
      `SELECT id FROM users WHERE role IN ('warehouse_director','warehouse_deputy')`
    )
    for (const w of whAdmins) {
      await createNotification({
        user_id: w.id,
        type: 'loan_accepted',
        text: whText,
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

// POST /colleagues/requests/:id/reject
router.post('/requests/:id/reject', verifyJWT, async (req, res) => {
  try {
    const { rows } = await db.query(
      `SELECT r.*, u.category AS unit_category
       FROM project_loan_requests r
       JOIN units u ON u.id = r.unit_id
       WHERE r.id = $1`,
      [req.params.id]
    )
    if (!rows.length) return res.status(404).json({ error: 'Заявка не найдена' })
    const r = rows[0]
    if (r.status !== 'pending') return res.status(409).json(alreadyHandled(r.status))
    if (!canRespondToLoanRequest(req.user, r)) {
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
      `SELECT * FROM project_loan_requests WHERE id = $1`,
      [req.params.id]
    )
    if (!rows.length) return res.status(404).json({ error: 'Заявка не найдена' })
    const r = rows[0]
    if (r.status !== 'pending') return res.status(409).json(alreadyHandled(r.status))
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
      `SELECT * FROM project_loan_requests WHERE id = $1`,
      [req.params.id]
    )
    if (!rows.length) return res.status(404).json({ error: 'Заявка не найдена' })
    const r = rows[0]
    if (r.status !== 'accepted') return res.status(409).json(alreadyHandled(r.status))
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
      `INSERT INTO unit_history (unit_id, action, user_id, project_id)
       VALUES ($1, 'Возвращено на склад проекта-владельца', $2, $3)`,
      [r.unit_id, req.user.id, r.from_project_id]
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
      `SELECT * FROM project_loan_requests WHERE id = $1`,
      [req.params.id]
    )
    if (!rows.length) return res.status(404).json({ error: 'Заявка не найдена' })
    const r = rows[0]
    if (r.status !== 'accepted') return res.status(409).json(alreadyHandled(r.status))
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
      `SELECT r.*, u.category AS unit_category
       FROM project_loan_requests r
       JOIN units u ON u.id = r.unit_id
       WHERE r.id = $1`,
      [req.params.id]
    )
    if (!rows.length) return res.status(404).json({ error: 'Заявка не найдена' })
    const r = rows[0]
    if (r.status !== 'accepted') return res.status(409).json(alreadyHandled(r.status))
    if (!r.extension_requested) {
      return res.status(409).json({ error: 'Запрос продления уже обработан', currentStatus: r.status })
    }
    if (!canRespondToLoanRequest(req.user, r)) {
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
