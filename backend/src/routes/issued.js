const router = require('express').Router()
const multer = require('multer')
const db     = require('../db')
const { verifyJWT, checkRole } = require('../middleware/auth')
const { uploadFile } = require('../services/r2')
const { createReturnPDF } = require('../services/pdf')
const { notifyWarehouse, createNotification } = require('../services/notifications')

const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp']
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter: (req, file, cb) => cb(null, ALLOWED_IMAGE_TYPES.includes(file.mimetype)),
})

const ROLES = ['warehouse_director', 'warehouse_deputy']
// Продюсер тоже может смотреть «Движение», но в собственной проекции:
// только свой проект, без Партнёрской аренды (это операции склада).
// Действия выдачи/walkin-возврата фронт ему не показывает (см. IssuedByProjectsPage).
const ROLES_WITH_PRODUCER = [...ROLES, 'producer']

// Фильтруем результат view-функции под скоуп текущего юзера.
// Для producer — оставляем только его проект и убираем rent/no_project.
function applyScope(result, user) {
  if (user.role !== 'producer') return result
  const pid = user.project_id || null
  const projects = (result.projects || []).filter(p => p.kind === 'project' && p.id === pid)
  const totalPeople = projects.reduce((s, p) => s + p.people.length, 0)
  const totalQty    = projects.reduce((s, p) => s + p.qty, 0)
  const totalValue  = projects.reduce((s, p) => s + p.value, 0)
  return {
    totals: { qty: totalQty, value: totalValue, projects: projects.length, people: totalPeople },
    projects,
  }
}

// ── Helpers для группировки по проектам ───────────────────────────────────
//
// Все view возвращают одинаковую форму:
//   { totals, projects: [{ id, name, kind, qty, value, has_overdue,
//                         has_pending_return, people: [{ ...summary, items: [] }] }] }
// Это позволяет фронту использовать один общий ProjectsHierarchyView
// и подменять только renderer'ы для items / actions / stats.

function makeProj(meta) {
  return {
    id: meta.id || null,
    name: meta.name || 'Без проекта',
    kind: meta.kind || 'project',          // 'project' | 'rent' | 'no_project'
    qty: 0,
    value: 0,
    has_overdue: false,
    has_pending_return: false,
    has_late_return: false,
    _people: new Map(),
  }
}
function makePerson(meta) {
  return {
    user_id: meta.user_id || null,
    deal_id: meta.deal_id || null,
    request_id: meta.request_id || null,
    project_id: meta.project_id || null,
    name: meta.name,
    role: meta.role || null,
    contact: meta.contact || null,
    is_provisional: !!meta.is_provisional,
    source: meta.source || 'request',      // 'request' | 'rent'
    qty: 0,
    value: 0,
    has_overdue: false,
    has_pending_return: false,
    has_late_return: false,
    act_pdf_url: null,                     // ссылка на ближайший акт (для кнопки на person-уровне)
    items: [],
  }
}

function projKey(projectId, fallback = 'no_project') {
  return projectId || fallback
}

function finalizeHierarchy(byProj) {
  const projects = Array.from(byProj.values()).map(p => ({
    id: p.id,
    name: p.name,
    kind: p.kind,
    qty: p.qty,
    value: p.value,
    has_overdue: p.has_overdue,
    has_pending_return: p.has_pending_return,
    has_late_return: p.has_late_return,
    people: Array.from(p._people.values()),
  }))
  const totalPeople = projects.reduce((s, p) => s + p.people.length, 0)
  const totalQty    = projects.reduce((s, p) => s + p.qty, 0)
  const totalValue  = projects.reduce((s, p) => s + p.value, 0)
  // Кол-во уникальных заявок по всем проектам — для view=new label «Заявок».
  // Берём request_id (или deal_id для партнёрских) из items, набивая Set.
  const requestIds = new Set()
  for (const p of projects) {
    for (const person of p.people) {
      for (const it of person.items || []) {
        const id = it.request_id || it.deal_id
        if (id) requestIds.add(String(id))
      }
    }
  }
  return {
    totals: {
      qty: totalQty,
      value: totalValue,
      projects: projects.length,
      people: totalPeople,
      requests: requestIds.size,
    },
    projects,
  }
}

// «Сейчас минус N дней» в формате для PG. Default — 30 дней.
function dateRange(query) {
  const days = Number(query.days || 30)
  const safeDays = Number.isFinite(days) && days > 0 && days <= 3650 ? days : 30
  // Если days=0 или 'all' — без ограничений сверху-снизу.
  const all = String(query.days) === 'all'
  return { all, days: safeDays }
}

// ── Каждый view собирает свой массив строк и группирует через общий builder ──

async function getProjectStockRows({ onlyPending = false } = {}) {
  const { rows } = await db.query(`
    SELECT
      p.id                AS project_id,
      p.name              AS project_name,
      u.id                AS unit_id,
      u.name              AS unit_name,
      u.serial,
      u.qty,
      u.valuation,
      u.status,
      u.created_at,
      pending_return.id         AS return_request_id,
      pending_return.created_at AS return_requested_at,
      pending_return.deadline   AS return_deadline,
      (SELECT url FROM unit_photos
         WHERE unit_id = u.id AND type='stock'
         ORDER BY created_at LIMIT 1) AS photo_url
    FROM units u
    JOIN projects p ON p.id = u.project_id
    LEFT JOIN LATERAL (
      SELECT id, created_at, deadline
      FROM warehouse_return_requests
      WHERE unit_id = u.id AND status = 'pending'
      ORDER BY created_at DESC
      LIMIT 1
    ) pending_return ON true
    WHERE u.is_project_kept = true
      AND u.status = 'on_stock'
      AND u.project_id IS NOT NULL
      ${onlyPending ? 'AND pending_return.id IS NOT NULL' : ''}
    ORDER BY p.name, u.name
  `)
  return rows
}

async function viewIssued() {
  const { rows } = await db.query(`
    SELECT
      iss.id              AS issuance_id,
      iss.deadline,
      iss.return_requested_at,
      iss.act_pdf_url,
      iss.received_by,
      iss.issued_at,
      rcv.name            AS receiver_name,
      rcv.role            AS receiver_role,
      rcv.is_provisional  AS receiver_provisional,
      p.id                AS project_id,
      p.name              AS project_name,
      u.id                AS unit_id,
      u.name              AS unit_name,
      u.serial,
      u.qty,
      u.valuation,
      u.status,
      u.is_walkin,
      (SELECT url FROM unit_photos
         WHERE unit_id = u.id AND type='stock'
         ORDER BY created_at LIMIT 1) AS photo_url
    FROM issuances iss
    JOIN users rcv ON rcv.id = iss.received_by
    LEFT JOIN projects p ON p.id = rcv.project_id
    JOIN requests req ON req.id = iss.request_id
    JOIN units u ON u.id = ANY(req.unit_ids)
    WHERE u.status IN ('issued','overdue')
      AND NOT EXISTS (SELECT 1 FROM returns r WHERE r.issuance_id = iss.id)
    ORDER BY p.name NULLS LAST, rcv.name, u.name
  `)

  const { rows: rentRows } = await db.query(`
    SELECT
      d.id                  AS deal_id,
      d.counterparty_name,
      d.counterparty_contact,
      d.period_start,
      d.period_end,
      d.return_requested_at,
      d.unit_ids,
      d.created_at,
      d.contract_pdf_url,
      u.id                  AS unit_id,
      u.name                AS unit_name,
      u.serial,
      u.qty,
      u.valuation,
      u.status,
      (SELECT url FROM unit_photos
         WHERE unit_id = u.id AND type='stock'
         ORDER BY created_at LIMIT 1) AS photo_url
    FROM rent_deals d
    JOIN units u ON u.id = ANY(d.unit_ids)
    WHERE d.type = 'out'
      AND d.status IN ('active','overdue')
      AND u.status IN ('issued','overdue')
    ORDER BY d.counterparty_name, u.name
  `)

  const projectRows = await getProjectStockRows()
  return buildIssuedHierarchy({ rows, rentRows, projectRows, includeReturning: false, onlyReturning: false })
}

async function viewReturning() {
  const { rows } = await db.query(`
    SELECT
      iss.id              AS issuance_id,
      iss.deadline,
      iss.return_requested_at,
      iss.act_pdf_url,
      iss.received_by,
      iss.issued_at,
      rcv.name            AS receiver_name,
      rcv.role            AS receiver_role,
      rcv.is_provisional  AS receiver_provisional,
      p.id                AS project_id,
      p.name              AS project_name,
      u.id                AS unit_id,
      u.name              AS unit_name,
      u.serial,
      u.qty,
      u.valuation,
      u.status,
      u.is_walkin,
      (SELECT url FROM unit_photos
         WHERE unit_id = u.id AND type='stock'
         ORDER BY created_at LIMIT 1) AS photo_url
    FROM issuances iss
    JOIN users rcv ON rcv.id = iss.received_by
    LEFT JOIN projects p ON p.id = rcv.project_id
    JOIN requests req ON req.id = iss.request_id
    JOIN units u ON u.id = ANY(req.unit_ids)
    WHERE iss.return_requested_at IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM returns r WHERE r.issuance_id = iss.id)
    ORDER BY p.name NULLS LAST, rcv.name, u.name
  `)

  const { rows: rentRows } = await db.query(`
    SELECT
      d.id                  AS deal_id,
      d.counterparty_name,
      d.counterparty_contact,
      d.period_start,
      d.period_end,
      d.return_requested_at,
      d.unit_ids,
      d.created_at,
      d.contract_pdf_url,
      u.id                  AS unit_id,
      u.name                AS unit_name,
      u.serial,
      u.qty,
      u.valuation,
      u.status,
      (SELECT url FROM unit_photos
         WHERE unit_id = u.id AND type='stock'
         ORDER BY created_at LIMIT 1) AS photo_url
    FROM rent_deals d
    JOIN units u ON u.id = ANY(d.unit_ids)
    WHERE d.type = 'out'
      AND d.status IN ('active','overdue')
      AND d.return_requested_at IS NOT NULL
    ORDER BY d.counterparty_name, u.name
  `)

  const projectRows = await getProjectStockRows({ onlyPending: true })
  return buildIssuedHierarchy({ rows, rentRows, projectRows, includeReturning: true, onlyReturning: true })
}

async function viewAll() {
  // «Все» = issued + returning. Просто склеиваем без NULL-фильтра по
  // return_requested_at. Юниты которых уже вернули (есть returns) — не показываем.
  const { rows } = await db.query(`
    SELECT
      iss.id              AS issuance_id,
      iss.deadline,
      iss.return_requested_at,
      iss.act_pdf_url,
      iss.received_by,
      iss.issued_at,
      rcv.name            AS receiver_name,
      rcv.role            AS receiver_role,
      rcv.is_provisional  AS receiver_provisional,
      p.id                AS project_id,
      p.name              AS project_name,
      u.id                AS unit_id,
      u.name              AS unit_name,
      u.serial,
      u.qty,
      u.valuation,
      u.status,
      u.is_walkin,
      (SELECT url FROM unit_photos
         WHERE unit_id = u.id AND type='stock'
         ORDER BY created_at LIMIT 1) AS photo_url
    FROM issuances iss
    JOIN users rcv ON rcv.id = iss.received_by
    LEFT JOIN projects p ON p.id = rcv.project_id
    JOIN requests req ON req.id = iss.request_id
    JOIN units u ON u.id = ANY(req.unit_ids)
    WHERE u.status IN ('issued','overdue')
      AND NOT EXISTS (SELECT 1 FROM returns r WHERE r.issuance_id = iss.id)
    ORDER BY p.name NULLS LAST, rcv.name, u.name
  `)

  const { rows: rentRows } = await db.query(`
    SELECT
      d.id                  AS deal_id,
      d.counterparty_name,
      d.counterparty_contact,
      d.period_start,
      d.period_end,
      d.return_requested_at,
      d.unit_ids,
      d.created_at,
      d.contract_pdf_url,
      u.id                  AS unit_id,
      u.name                AS unit_name,
      u.serial,
      u.qty,
      u.valuation,
      u.status,
      (SELECT url FROM unit_photos
         WHERE unit_id = u.id AND type='stock'
         ORDER BY created_at LIMIT 1) AS photo_url
    FROM rent_deals d
    JOIN units u ON u.id = ANY(d.unit_ids)
    WHERE d.type = 'out'
      AND d.status IN ('active','overdue')
    ORDER BY d.counterparty_name, u.name
  `)

  const projectRows = await getProjectStockRows()
  return buildIssuedHierarchy({ rows, rentRows, projectRows, includeReturning: true, onlyReturning: false })
}

// Общий builder для issued/returning/all — структура rows одинаковая.
function buildIssuedHierarchy({ rows, rentRows, projectRows, onlyReturning }) {
  const byProj = new Map()
  for (const r of rows) {
    if (onlyReturning && !r.return_requested_at) continue
    const key = projKey(r.project_id)
    let proj = byProj.get(key)
    if (!proj) {
      proj = makeProj({
        id: r.project_id,
        name: r.project_name || 'Без проекта',
        kind: r.project_id ? 'project' : 'no_project',
      })
      byProj.set(key, proj)
    }
    let person = proj._people.get(r.received_by)
    if (!person) {
      person = makePerson({
        user_id: r.received_by,
        name: r.receiver_name,
        role: r.receiver_role,
        is_provisional: r.receiver_provisional,
        source: 'request',
      })
      proj._people.set(r.received_by, person)
    }
    // Акт выдачи — общий на всю issuance, дублируется в каждом item этой issuance
    // (фронт пробросит first-non-null в person-action, чтобы кнопка PDF висела
    // на уровне получателя).
    if (r.act_pdf_url && !person.act_pdf_url) person.act_pdf_url = r.act_pdf_url
    const isOverdue = r.status === 'overdue'
    const isPendingReturn = !!r.return_requested_at
    person.items.push({
      issuance_id: r.issuance_id,
      unit_id: r.unit_id,
      name: r.unit_name,
      serial: r.serial,
      qty: r.qty || 1,
      valuation: r.valuation,
      status: r.status,
      is_walkin: r.is_walkin,
      source: 'request',
      deadline: r.deadline,
      issued_at: r.issued_at,
      return_requested_at: r.return_requested_at,
      act_pdf_url: r.act_pdf_url,
      photo_url: r.photo_url,
    })
    const itemQty = r.qty || 1
    const itemValue = Number(r.valuation || 0) * itemQty
    person.qty += itemQty
    person.value += itemValue
    proj.qty += itemQty
    proj.value += itemValue
    if (isOverdue) { person.has_overdue = true; proj.has_overdue = true }
    if (isPendingReturn) { person.has_pending_return = true; proj.has_pending_return = true }
  }

  if (rentRows && rentRows.length) {
    let rentProj = byProj.get('rent')
    if (!rentProj) {
      rentProj = makeProj({ id: null, name: 'Партнёрская аренда', kind: 'rent' })
      byProj.set('rent', rentProj)
    }
    for (const r of rentRows) {
      if (onlyReturning && !r.return_requested_at) continue
      const personKey = `deal_${r.deal_id}`
      let person = rentProj._people.get(personKey)
      if (!person) {
        person = makePerson({
          deal_id: r.deal_id,
          name: r.counterparty_name,
          role: 'Партнёр',
          contact: r.counterparty_contact,
          source: 'rent',
        })
        rentProj._people.set(personKey, person)
      }
      // Акт-договор партнёрской выдачи — на уровне сделки (один на всю сделку).
      if (r.contract_pdf_url && !person.act_pdf_url) person.act_pdf_url = r.contract_pdf_url
      const isOverdue = r.status === 'overdue'
      const isPendingReturn = !!r.return_requested_at
      person.items.push({
        deal_id: r.deal_id,
        unit_id: r.unit_id,
        name: r.unit_name,
        serial: r.serial,
        qty: r.qty || 1,
        valuation: r.valuation,
        status: r.status,
        source: 'rent',
        deadline: r.period_end,
        issued_at: r.created_at,
        return_requested_at: r.return_requested_at,
        act_pdf_url: r.contract_pdf_url,
        photo_url: r.photo_url,
      })
      const itemQty = r.qty || 1
      const itemValue = Number(r.valuation || 0) * itemQty
      person.qty += itemQty
      person.value += itemValue
      rentProj.qty += itemQty
      rentProj.value += itemValue
      if (isOverdue) { person.has_overdue = true; rentProj.has_overdue = true }
      if (isPendingReturn) { person.has_pending_return = true; rentProj.has_pending_return = true }
    }
  }

  if (projectRows && projectRows.length) {
    for (const r of projectRows) {
      if (onlyReturning && !r.return_request_id) continue
      const key = projKey(r.project_id)
      let proj = byProj.get(key)
      if (!proj) {
        proj = makeProj({
          id: r.project_id,
          name: r.project_name || 'Без проекта',
          kind: 'project',
        })
        byProj.set(key, proj)
      }
      const personKey = `project_stock_${r.project_id}`
      let person = proj._people.get(personKey)
      if (!person) {
        person = makePerson({
          user_id: null,
          project_id: r.project_id,
          name: r.project_name || 'Без проекта',
          role: null,
          source: 'project_stock',
        })
        proj._people.set(personKey, person)
      }
      person.items.push({
        unit_id: r.unit_id,
        name: r.unit_name,
        serial: r.serial,
        qty: r.qty || 1,
        valuation: r.valuation,
        status: r.status,
        source: 'project_stock',
        project_id: r.project_id,
        project_name: r.project_name,
        return_request_id: r.return_request_id,
        return_requested_at: r.return_requested_at,
        deadline: r.return_deadline,
        issued_at: r.created_at,
        photo_url: r.photo_url,
      })
      const itemQty = r.qty || 1
      const itemValue = Number(r.valuation || 0) * itemQty
      person.qty += itemQty
      person.value += itemValue
      proj.qty += itemQty
      proj.value += itemValue
      if (r.return_request_id) { person.has_pending_return = true; proj.has_pending_return = true }
    }
  }

  return finalizeHierarchy(byProj)
}

// «Новые» — заявки в работе у склада (status в new/collecting/ready), без выдачи.
// Источник — requests + публичные rent_deals со status='pending_review' (или
// pending_review с workflow_stage='collecting'/'ready').
async function viewNew() {
  const { rows } = await db.query(`
    SELECT
      r.id                AS request_id,
      r.status            AS request_status,
      r.deadline,
      r.notes,
      r.created_at,
      r.requester_id,
      rcv.name            AS receiver_name,
      rcv.role            AS receiver_role,
      rcv.is_provisional  AS receiver_provisional,
      p.id                AS project_id,
      p.name              AS project_name,
      u.id                AS unit_id,
      u.name              AS unit_name,
      u.serial,
      u.qty,
      u.valuation,
      u.status,
      u.is_walkin,
      (SELECT url FROM unit_photos
         WHERE unit_id = u.id AND type='stock'
         ORDER BY created_at LIMIT 1) AS photo_url
    FROM requests r
    JOIN users rcv ON rcv.id = r.requester_id
    LEFT JOIN projects p ON p.id = COALESCE(r.project_id, rcv.project_id)
    JOIN units u ON u.id = ANY(r.unit_ids)
    WHERE r.status IN ('new','collecting','ready')
    ORDER BY p.name NULLS LAST, rcv.name, u.name
  `)

  const { rows: rentRows } = await db.query(`
    SELECT
      d.id                  AS deal_id,
      d.counterparty_name,
      d.counterparty_contact,
      d.workflow_stage,
      d.requester_message,
      d.period_start,
      d.period_end,
      d.unit_ids,
      d.created_at,
      d.requester_name,
      u.id                  AS unit_id,
      u.name                AS unit_name,
      u.serial,
      u.qty,
      u.valuation,
      u.status,
      (SELECT url FROM unit_photos
         WHERE unit_id = u.id AND type='stock'
         ORDER BY created_at LIMIT 1) AS photo_url
    FROM rent_deals d
    JOIN units u ON u.id = ANY(d.unit_ids)
    WHERE d.type = 'out' AND d.status = 'pending_review'
    ORDER BY d.counterparty_name, u.name
  `)

  const byProj = new Map()
  for (const r of rows) {
    const key = projKey(r.project_id)
    let proj = byProj.get(key)
    if (!proj) {
      proj = makeProj({
        id: r.project_id,
        name: r.project_name || 'Без проекта',
        kind: r.project_id ? 'project' : 'no_project',
      })
      byProj.set(key, proj)
    }
    // В view=new группируем по (requester_id, request_id), чтобы каждая
    // заявка была отдельной строкой — иначе несколько заявок одного человека
    // схлопываются в одну запись и теряются action-кнопки (Принять/Готово/Выдать)
    // и контекст «какая именно заявка». В UI это даёт N строк под одним
    // именем «Дмитрий», но с разными request_id, статусами и сроками.
    const personKey = `${r.requester_id}|${r.request_id}`
    let person = proj._people.get(personKey)
    if (!person) {
      person = makePerson({
        user_id: r.requester_id,
        request_id: r.request_id,
        name: r.receiver_name,
        role: r.receiver_role,
        is_provisional: r.receiver_provisional,
        source: 'request',
      })
      proj._people.set(personKey, person)
    }
    person.items.push({
      request_id: r.request_id,
      request_status: r.request_status,
      unit_id: r.unit_id,
      name: r.unit_name,
      serial: r.serial,
      qty: r.qty || 1,
      valuation: r.valuation,
      status: r.status,
      is_walkin: r.is_walkin,
      source: 'request',
      deadline: r.deadline,
      created_at: r.created_at,
      notes: r.notes,
      photo_url: r.photo_url,
    })
    const itemQty = r.qty || 1
    const itemValue = Number(r.valuation || 0) * itemQty
    person.qty += itemQty
    person.value += itemValue
    proj.qty += itemQty
    proj.value += itemValue
  }

  if (rentRows.length) {
    let rentProj = byProj.get('rent')
    if (!rentProj) {
      rentProj = makeProj({ id: null, name: 'Партнёрская аренда', kind: 'rent' })
      byProj.set('rent', rentProj)
    }
    for (const r of rentRows) {
      const personKey = `deal_${r.deal_id}`
      let person = rentProj._people.get(personKey)
      if (!person) {
        person = makePerson({
          deal_id: r.deal_id,
          name: r.counterparty_name,
          role: 'Партнёр',
          contact: r.counterparty_contact,
          source: 'rent',
        })
        rentProj._people.set(personKey, person)
      }
      person.items.push({
        deal_id: r.deal_id,
        request_status: r.workflow_stage || 'new',
        unit_id: r.unit_id,
        name: r.unit_name,
        serial: r.serial,
        qty: r.qty || 1,
        valuation: r.valuation,
        status: r.status,
        source: 'rent',
        deadline: r.period_end,
        created_at: r.created_at,
        notes: r.requester_message,
        photo_url: r.photo_url,
      })
      const itemQty = r.qty || 1
      const itemValue = Number(r.valuation || 0) * itemQty
      person.qty += itemQty
      person.value += itemValue
      rentProj.qty += itemQty
      rentProj.value += itemValue
    }
  }

  return finalizeHierarchy(byProj)
}

// «Вернули» — issuances с returns + завершённые партнёрские сделки.
// Опционально ограничено периодом (?days=30|90|all).
async function viewReturned(query) {
  const { all, days } = dateRange(query)
  const dateClause = all ? '' : `AND ret.returned_at >= NOW() - INTERVAL '${days} days'`
  const dateClauseRent = all ? '' : `AND COALESCE(d.period_end, d.created_at::date) >= (NOW() - INTERVAL '${days} days')::date`

  const { rows } = await db.query(`
    SELECT
      iss.id              AS issuance_id,
      iss.deadline,
      iss.received_by,
      iss.issued_at,
      ret.id              AS return_id,
      ret.returned_at,
      ret.condition_notes,
      ret.act_pdf_url,
      rcv.name            AS receiver_name,
      rcv.role            AS receiver_role,
      rcv.is_provisional  AS receiver_provisional,
      p.id                AS project_id,
      p.name              AS project_name,
      u.id                AS unit_id,
      u.name              AS unit_name,
      u.serial,
      u.qty,
      u.valuation,
      u.status,
      u.is_walkin,
      (SELECT url FROM unit_photos
         WHERE unit_id = u.id AND type='stock'
         ORDER BY created_at LIMIT 1) AS photo_url
    FROM issuances iss
    JOIN users rcv ON rcv.id = iss.received_by
    LEFT JOIN projects p ON p.id = rcv.project_id
    JOIN requests req ON req.id = iss.request_id
    JOIN units u ON u.id = ANY(req.unit_ids)
    JOIN returns ret ON ret.issuance_id = iss.id
    WHERE 1=1 ${dateClause}
    ORDER BY ret.returned_at DESC, p.name NULLS LAST, rcv.name, u.name
  `)

  const { rows: rentRows } = await db.query(`
    SELECT
      d.id                  AS deal_id,
      d.counterparty_name,
      d.counterparty_contact,
      d.period_start,
      d.period_end,
      d.unit_ids,
      d.created_at,
      d.return_pdf_url,
      d.status              AS deal_status,
      u.id                  AS unit_id,
      u.name                AS unit_name,
      u.serial,
      u.qty,
      u.valuation,
      u.status,
      (SELECT url FROM unit_photos
         WHERE unit_id = u.id AND type='stock'
         ORDER BY created_at LIMIT 1) AS photo_url
    FROM rent_deals d
    JOIN units u ON u.id = ANY(d.unit_ids)
    WHERE d.type = 'out' AND d.status = 'done' ${dateClauseRent}
    ORDER BY d.period_end DESC NULLS LAST, d.counterparty_name, u.name
  `)

  const byProj = new Map()
  for (const r of rows) {
    const key = projKey(r.project_id)
    let proj = byProj.get(key)
    if (!proj) {
      proj = makeProj({
        id: r.project_id,
        name: r.project_name || 'Без проекта',
        kind: r.project_id ? 'project' : 'no_project',
      })
      byProj.set(key, proj)
    }
    // Группируем по человеку — один пользователь может иметь несколько закрытых
    // выдач за период.
    let person = proj._people.get(r.received_by)
    if (!person) {
      person = makePerson({
        user_id: r.received_by,
        name: r.receiver_name,
        role: r.receiver_role,
        is_provisional: r.receiver_provisional,
        source: 'request',
      })
      proj._people.set(r.received_by, person)
    }
    const late = r.deadline && r.returned_at && new Date(r.returned_at) > new Date(r.deadline)
    person.items.push({
      issuance_id: r.issuance_id,
      return_id: r.return_id,
      unit_id: r.unit_id,
      name: r.unit_name,
      serial: r.serial,
      qty: r.qty || 1,
      valuation: r.valuation,
      status: r.status,
      is_walkin: r.is_walkin,
      source: 'request',
      deadline: r.deadline,
      issued_at: r.issued_at,
      returned_at: r.returned_at,
      condition_notes: r.condition_notes,
      act_pdf_url: r.act_pdf_url,
      late,
      photo_url: r.photo_url,
    })
    const itemQty = r.qty || 1
    const itemValue = Number(r.valuation || 0) * itemQty
    person.qty += itemQty
    person.value += itemValue
    proj.qty += itemQty
    proj.value += itemValue
    if (late) { person.has_late_return = true; proj.has_late_return = true }
  }

  if (rentRows.length) {
    let rentProj = byProj.get('rent')
    if (!rentProj) {
      rentProj = makeProj({ id: null, name: 'Партнёрская аренда', kind: 'rent' })
      byProj.set('rent', rentProj)
    }
    for (const r of rentRows) {
      const personKey = `deal_${r.deal_id}`
      let person = rentProj._people.get(personKey)
      if (!person) {
        person = makePerson({
          deal_id: r.deal_id,
          name: r.counterparty_name,
          role: 'Партнёр',
          contact: r.counterparty_contact,
          source: 'rent',
        })
        rentProj._people.set(personKey, person)
      }
      person.items.push({
        deal_id: r.deal_id,
        unit_id: r.unit_id,
        name: r.unit_name,
        serial: r.serial,
        qty: r.qty || 1,
        valuation: r.valuation,
        status: r.status,
        source: 'rent',
        deadline: r.period_end,
        issued_at: r.created_at,
        returned_at: r.period_end,         // для done-сделки фактическая дата близка к period_end
        act_pdf_url: r.return_pdf_url,
        photo_url: r.photo_url,
      })
      const itemQty = r.qty || 1
      const itemValue = Number(r.valuation || 0) * itemQty
      person.qty += itemQty
      person.value += itemValue
      rentProj.qty += itemQty
      rentProj.value += itemValue
    }
  }

  return finalizeHierarchy(byProj)
}

// «Акты» — список PDF-документов, сгруппированных по проекту/получателю.
// kind определяет иконку и подпись: issue / return / rent_issue / rent_return.
async function viewActs(query) {
  const { all, days } = dateRange(query)
  const dateClause = all ? '' : `AND iss.issued_at >= NOW() - INTERVAL '${days} days'`
  const dateClauseRet = all ? '' : `AND ret.returned_at >= NOW() - INTERVAL '${days} days'`
  const dateClauseRent = all ? '' : `AND d.created_at >= NOW() - INTERVAL '${days} days'`

  const { rows: issuanceActs } = await db.query(`
    SELECT
      iss.id              AS issuance_id,
      iss.act_pdf_url,
      iss.issued_at       AS act_date,
      iss.received_by,
      iss.deadline,
      rcv.name            AS receiver_name,
      rcv.role            AS receiver_role,
      rcv.is_provisional  AS receiver_provisional,
      p.id                AS project_id,
      p.name              AS project_name,
      r.unit_ids,
      array_length(r.unit_ids, 1) AS units_count
    FROM issuances iss
    JOIN users rcv ON rcv.id = iss.received_by
    LEFT JOIN projects p ON p.id = rcv.project_id
    LEFT JOIN requests r ON r.id = iss.request_id
    WHERE iss.act_pdf_url IS NOT NULL ${dateClause}
    ORDER BY iss.issued_at DESC
  `)

  const { rows: returnActs } = await db.query(`
    SELECT
      ret.id              AS return_id,
      ret.act_pdf_url,
      ret.returned_at     AS act_date,
      ret.condition_notes,
      iss.id              AS issuance_id,
      iss.received_by,
      rcv.name            AS receiver_name,
      rcv.role            AS receiver_role,
      rcv.is_provisional  AS receiver_provisional,
      p.id                AS project_id,
      p.name              AS project_name,
      r.unit_ids,
      array_length(r.unit_ids, 1) AS units_count
    FROM returns ret
    JOIN issuances iss ON iss.id = ret.issuance_id
    JOIN users rcv ON rcv.id = iss.received_by
    LEFT JOIN projects p ON p.id = rcv.project_id
    LEFT JOIN requests r ON r.id = iss.request_id
    WHERE ret.act_pdf_url IS NOT NULL ${dateClauseRet}
    ORDER BY ret.returned_at DESC
  `)

  const { rows: rentActs } = await db.query(`
    SELECT
      d.id                  AS deal_id,
      d.counterparty_name,
      d.counterparty_contact,
      d.contract_pdf_url,
      d.return_pdf_url,
      d.created_at,
      d.period_end,
      d.status              AS deal_status,
      d.unit_ids,
      array_length(d.unit_ids, 1) AS units_count
    FROM rent_deals d
    WHERE d.type = 'out'
      AND (d.contract_pdf_url IS NOT NULL OR d.return_pdf_url IS NOT NULL)
      ${dateClauseRent}
    ORDER BY d.created_at DESC
  `)

  const byProj = new Map()

  function pushActItem(person, kind, payload) {
    person.items.push({ kind, ...payload })
    person.qty += 1
  }

  for (const r of issuanceActs) {
    const key = projKey(r.project_id)
    let proj = byProj.get(key)
    if (!proj) {
      proj = makeProj({
        id: r.project_id,
        name: r.project_name || 'Без проекта',
        kind: r.project_id ? 'project' : 'no_project',
      })
      byProj.set(key, proj)
    }
    let person = proj._people.get(r.received_by)
    if (!person) {
      person = makePerson({
        user_id: r.received_by,
        name: r.receiver_name,
        role: r.receiver_role,
        is_provisional: r.receiver_provisional,
        source: 'request',
      })
      proj._people.set(r.received_by, person)
    }
    pushActItem(person, 'issue', {
      issuance_id: r.issuance_id,
      act_pdf_url: r.act_pdf_url,
      act_date: r.act_date,
      deadline: r.deadline,
      units_count: r.units_count || 0,
    })
    proj.qty += 1
  }

  for (const r of returnActs) {
    const key = projKey(r.project_id)
    let proj = byProj.get(key)
    if (!proj) {
      proj = makeProj({
        id: r.project_id,
        name: r.project_name || 'Без проекта',
        kind: r.project_id ? 'project' : 'no_project',
      })
      byProj.set(key, proj)
    }
    let person = proj._people.get(r.received_by)
    if (!person) {
      person = makePerson({
        user_id: r.received_by,
        name: r.receiver_name,
        role: r.receiver_role,
        is_provisional: r.receiver_provisional,
        source: 'request',
      })
      proj._people.set(r.received_by, person)
    }
    pushActItem(person, 'return', {
      issuance_id: r.issuance_id,
      return_id: r.return_id,
      act_pdf_url: r.act_pdf_url,
      act_date: r.act_date,
      condition_notes: r.condition_notes,
      units_count: r.units_count || 0,
    })
    proj.qty += 1
  }

  if (rentActs.length) {
    let rentProj = byProj.get('rent')
    if (!rentProj) {
      rentProj = makeProj({ id: null, name: 'Партнёрская аренда', kind: 'rent' })
      byProj.set('rent', rentProj)
    }
    for (const r of rentActs) {
      const personKey = `deal_${r.deal_id}`
      let person = rentProj._people.get(personKey)
      if (!person) {
        person = makePerson({
          deal_id: r.deal_id,
          name: r.counterparty_name,
          role: 'Партнёр',
          contact: r.counterparty_contact,
          source: 'rent',
        })
        rentProj._people.set(personKey, person)
      }
      if (r.contract_pdf_url) {
        pushActItem(person, 'rent_issue', {
          deal_id: r.deal_id,
          act_pdf_url: r.contract_pdf_url,
          act_date: r.created_at,
          units_count: r.units_count || 0,
        })
        rentProj.qty += 1
      }
      if (r.return_pdf_url) {
        pushActItem(person, 'rent_return', {
          deal_id: r.deal_id,
          act_pdf_url: r.return_pdf_url,
          act_date: r.period_end,
          units_count: r.units_count || 0,
        })
        rentProj.qty += 1
      }
    }
  }

  return finalizeHierarchy(byProj)
}

// GET /issued/by-projects?view=issued|all|new|returning|returned|acts&days=30|90|all
//
// Default view='issued' для обратной совместимости.
router.get('/by-projects', verifyJWT, checkRole(...ROLES_WITH_PRODUCER), async (req, res) => {
  const view = String(req.query.view || 'issued')
  try {
    let result
    switch (view) {
      case 'issued':    result = await viewIssued(); break
      case 'all':       result = await viewAll(); break
      case 'new':       result = await viewNew(); break
      case 'returning': result = await viewReturning(); break
      case 'returned':  result = await viewReturned(req.query); break
      case 'acts':      result = await viewActs(req.query); break
      default: return res.status(400).json({ error: 'Unknown view: ' + view })
    }
    result = applyScope(result, req.user)
    res.json({ view, ...result })
  } catch (err) {
    console.error(`issued/by-projects[${view}]:`, err)
    res.status(500).json({ error: 'Server error' })
  }
})

// Helper: запросить возврат по списку issuance_ids
async function requestReturnFor(issuanceIds, requesterId) {
  if (!issuanceIds.length) return { updated: 0, receiverIds: [] }
  // Защита от дублирования — обновляем только тех, у кого ещё нет return_requested_at.
  const { rows } = await db.query(
    `UPDATE issuances
       SET return_requested_at = NOW()
     WHERE id = ANY($1) AND return_requested_at IS NULL
     RETURNING id, received_by`,
    [issuanceIds]
  )
  const receiverIds = [...new Set(rows.map(r => r.received_by))]

  // Нотификация каждому получателю (если он зарегистрирован, не provisional).
  for (const userId of receiverIds) {
    try {
      await createNotification(userId, {
        type: 'status_change',
        text: 'Склад запросил возврат вашего реквизита',
        entity_type: 'request',
        entity_id: rows.find(r => r.received_by === userId)?.id || null,
      })
    } catch (e) {
      console.error('notify request-return:', e?.message || e)
    }
  }

  return { updated: rows.length, receiverIds }
}

// POST /issued/request-return-by-issuance — body {issuance_id}
router.post('/request-return-by-issuance', verifyJWT, checkRole(...ROLES), async (req, res) => {
  const { issuance_id } = req.body
  if (!issuance_id) return res.status(400).json({ error: 'Missing issuance_id' })
  try {
    const r = await requestReturnFor([issuance_id], req.user.id)
    res.json({ ok: true, ...r })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Server error' })
  }
})

// POST /issued/cancel-return-request-by-issuance — body {issuance_id}
// Снимает return_requested_at — возвращает выдачу из «Возвращают» обратно в «Выданы».
router.post('/cancel-return-request-by-issuance', verifyJWT, checkRole(...ROLES), async (req, res) => {
  const { issuance_id } = req.body
  if (!issuance_id) return res.status(400).json({ error: 'Missing issuance_id' })
  try {
    const { rows } = await db.query(
      `UPDATE issuances
         SET return_requested_at = NULL
       WHERE id = $1 AND return_requested_at IS NOT NULL
       RETURNING id, received_by`,
      [issuance_id]
    )
    if (!rows.length) return res.status(404).json({ error: 'Запрос возврата не найден' })
    res.json({ ok: true, updated: rows.length })
  } catch (err) {
    console.error('cancel-return-request:', err)
    res.status(500).json({ error: 'Server error' })
  }
})

// POST /issued/request-return-by-user — body {user_id}
// Ставит return_requested_at на ВСЕ невозвращённые выдачи юзера.
router.post('/request-return-by-user', verifyJWT, checkRole(...ROLES), async (req, res) => {
  const { user_id } = req.body
  if (!user_id) return res.status(400).json({ error: 'Missing user_id' })
  try {
    const { rows } = await db.query(
      `SELECT iss.id FROM issuances iss
       WHERE iss.received_by = $1
         AND iss.return_requested_at IS NULL
         AND NOT EXISTS (SELECT 1 FROM returns r WHERE r.issuance_id = iss.id)`,
      [user_id]
    )
    const r = await requestReturnFor(rows.map(x => x.id), req.user.id)
    res.json({ ok: true, ...r })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Server error' })
  }
})

// POST /issued/request-return-by-project — body {project_id}
// Ставит return_requested_at на ВСЕ невозвращённые выдачи всех людей проекта.
router.post('/request-return-by-project', verifyJWT, checkRole(...ROLES), async (req, res) => {
  const { project_id } = req.body
  if (!project_id) return res.status(400).json({ error: 'Missing project_id' })
  try {
    const { rows } = await db.query(
      `SELECT iss.id FROM issuances iss
       JOIN users u ON u.id = iss.received_by
       WHERE u.project_id = $1
         AND iss.return_requested_at IS NULL
         AND NOT EXISTS (SELECT 1 FROM returns r WHERE r.issuance_id = iss.id)`,
      [project_id]
    )
    const r = await requestReturnFor(rows.map(x => x.id), req.user.id)
    res.json({ ok: true, ...r })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Server error' })
  }
})

// GET /issued/user/:user_id  — снимок выдач конкретного юзера для walk-in возврата.
// Возвращает плоский список открытых items с issuance_id (в таком виде удобно
// фронту показывать чек-листом).
router.get('/user/:user_id', verifyJWT, checkRole(...ROLES), async (req, res) => {
  try {
    const { rows } = await db.query(`
      SELECT iss.id AS issuance_id, iss.deadline, iss.return_requested_at,
             u.id AS unit_id, u.name, u.serial, u.qty, u.valuation,
             (SELECT url FROM unit_photos WHERE unit_id = u.id AND type='stock'
                ORDER BY created_at LIMIT 1) AS photo_url,
             rcv.name AS receiver_name, rcv.role AS receiver_role,
             p.name AS project_name, p.id AS project_id
      FROM issuances iss
      JOIN users rcv ON rcv.id = iss.received_by
      LEFT JOIN projects p ON p.id = rcv.project_id
      JOIN requests req ON req.id = iss.request_id
      JOIN units u ON u.id = ANY(req.unit_ids)
      WHERE iss.received_by = $1
        AND u.status IN ('issued','overdue')
        AND NOT EXISTS (SELECT 1 FROM returns r WHERE r.issuance_id = iss.id)
      ORDER BY iss.issued_at DESC, u.name
    `, [req.params.user_id])
    if (!rows.length) return res.json({ items: [], receiver: null })
    res.json({
      items: rows.map(r => ({
        issuance_id: r.issuance_id,
        unit_id: r.unit_id,
        name: r.name, serial: r.serial, qty: r.qty, valuation: r.valuation,
        deadline: r.deadline,
        return_requested_at: r.return_requested_at,
        photo_url: r.photo_url,
      })),
      receiver: {
        id: req.params.user_id,
        name: rows[0].receiver_name, role: rows[0].receiver_role,
        project_name: rows[0].project_name, project_id: rows[0].project_id,
      },
    })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Server error' })
  }
})

// POST /issued/walkin-return — быстрый mass-return, единая подпись на все
// выдачи юзера/проекта.
//
// Multipart-поля:
//   • user_id            UUID получателя
//   • unit_ids           JSON-массив unit_id, которые принимаем
//   • items_condition    JSON-map { unit_id: 'good'|'damaged'|'writeoff'|'debt' }
//   • signature_data     base64 dataUrl (подпись сдающего, может быть пустой)
//   • acceptor_signature_data   base64 ИЛИ 'stamp' (штамп склада)
//   • condition_notes    TEXT, опц.
//
// Алгоритм: группируем unit_ids по issuance_id (один юнит может быть в одной
// выдаче), по каждой issuance создаём свою returns-запись (issuance_id NOT NULL
// требует), но PDF/подпись общие — одна на всю операцию.
router.post('/walkin-return', verifyJWT, checkRole(...ROLES), upload.any(), async (req, res) => {
  const { user_id, condition_notes } = req.body
  if (!user_id) return res.status(400).json({ error: 'Missing user_id' })

  let unitIds, conditions
  try {
    unitIds = JSON.parse(req.body.unit_ids || '[]')
    conditions = JSON.parse(req.body.items_condition || '{}')
  } catch {
    return res.status(400).json({ error: 'Bad JSON in unit_ids/items_condition' })
  }
  if (!Array.isArray(unitIds) || !unitIds.length) {
    return res.status(400).json({ error: 'unit_ids пустой' })
  }

  const filesByField = {}
  for (const f of (req.files || [])) (filesByField[f.fieldname] ||= []).push(f)

  const client = await db.getClient()
  try {
    await client.query('BEGIN')

    // 1. Какие issuance относятся к этим юнитам у данного юзера?
    const { rows: openRows } = await client.query(`
      SELECT iss.id AS issuance_id, u.id AS unit_id, u.name, u.serial, u.qty,
             req.project_id AS request_project_id,
             (SELECT url FROM unit_photos WHERE unit_id = u.id AND type='stock'
                ORDER BY created_at LIMIT 1) AS photo_url
      FROM issuances iss
      JOIN requests req ON req.id = iss.request_id
      JOIN units u ON u.id = ANY(req.unit_ids)
      WHERE iss.received_by = $1
        AND u.id = ANY($2)
        AND u.status IN ('issued','overdue')
        AND NOT EXISTS (SELECT 1 FROM returns r WHERE r.issuance_id = iss.id)
    `, [user_id, unitIds])

    if (!openRows.length) {
      await client.query('ROLLBACK')
      return res.status(400).json({ error: 'Не найдено открытых выдач для возврата' })
    }

    // Группируем по issuance.
    const byIssuance = new Map()
    for (const r of openRows) {
      if (!byIssuance.has(r.issuance_id)) byIssuance.set(r.issuance_id, [])
      byIssuance.get(r.issuance_id).push(r)
    }

    // 2. Подпись сдающего — base64 → S3.
    let signatureUrl = null
    const sigData = req.body.signature_data
    if (sigData) {
      const m = String(sigData).match(/^data:image\/(png|jpeg|jpg);base64,(.+)$/)
      if (m) {
        const buf = Buffer.from(m[2], 'base64')
        signatureUrl = await uploadFile(buf, `signature.${m[1] === 'jpeg' ? 'jpg' : m[1]}`, 'signatures')
      }
    }

    // 3. Получатель + проект (для PDF).
    const { rows: rcvRows } = await client.query(
      `SELECT u.name, u.role, u.phone, u.email, u.project_id, p.name AS project_name
       FROM users u LEFT JOIN projects p ON p.id = u.project_id WHERE u.id=$1`,
      [user_id]
    )
    const rcv = rcvRows[0] || {}

    // 4. Acceptor (warehouse).
    const { rows: accRows } = await client.query(
      `SELECT name, role FROM users WHERE id=$1`, [req.user.id]
    )
    const accUser = accRows[0] || {}

    // 5. PDF для всего возврата (один на операцию). Items — все юниты.
    const allItems = openRows.map(r => ({
      ...r,
      condition: conditions[r.unit_id] || 'good',
    }))
    // signatureDataUrl = acceptor (склад), returnerSignatureDataUrl = сдающий.
    // Если acceptor_signature_data='stamp' → null → createReturnPDF сам рисует штамп.
    const acceptorRaw = req.body.acceptor_signature_data
    const pdfBytes = await createReturnPDF({
      items: allItems,
      returnedBy: rcv.name || user_id,
      acceptedBy: accUser.name || 'Склад',
      conditionNotes: condition_notes || null,
      signatureDataUrl: (acceptorRaw && acceptorRaw !== 'stamp') ? acceptorRaw : null,
      returnerSignatureDataUrl: sigData || null,
      returnerRole: rcv.role,
      returnerContact: rcv.phone || rcv.email || '',
      projectName: rcv.project_name,
      acceptorRole: accUser.role,
    })
    const pdfUrl = await uploadFile(Buffer.from(pdfBytes), 'act_return.pdf', 'acts')

    // 6. По каждой issuance — создаём returns row (PDF общий), обновляем юниты.
    const createdReturnIds = []
    for (const [issuanceId, units] of byIssuance) {
      const { rows: retRows } = await client.query(
        `INSERT INTO returns (issuance_id, returned_by, accepted_by, condition_notes, signature_url, act_pdf_url)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
        [issuanceId, user_id, req.user.id, condition_notes || null, signatureUrl, pdfUrl]
      )
      const returnId = retRows[0].id
      createdReturnIds.push(returnId)

      for (const u of units) {
        const cond = conditions[u.unit_id] || 'good'
        if (cond === 'writeoff') {
          await client.query(`UPDATE units SET status='written_off' WHERE id=$1`, [u.unit_id])
          await client.query(
            `INSERT INTO unit_history (unit_id, action, user_id, return_id) VALUES ($1, 'Списано (возврат)', $2, $3)`,
            [u.unit_id, req.user.id, returnId]
          )
        } else if (cond === 'debt') {
          await client.query(`UPDATE units SET status='debt' WHERE id=$1`, [u.unit_id])
          await client.query(
            `INSERT INTO debts (user_id, unit_id, issuance_id, project_id, reason)
             VALUES ($1,$2,$3,$4,$5)`,
            [
              user_id,
              u.unit_id,
              issuanceId,
              u.request_project_id || rcv.project_id || null,
              condition_notes || 'Не возвращено при walk-in возврате',
            ]
          )
          await client.query(
            `INSERT INTO unit_history (unit_id, action, user_id, return_id) VALUES ($1, 'Долг', $2, $3)`,
            [u.unit_id, req.user.id, returnId]
          )
        } else {
          await client.query(`UPDATE units SET status='on_stock' WHERE id=$1`, [u.unit_id])
          await client.query(
            `INSERT INTO unit_history (unit_id, action, user_id, return_id) VALUES ($1, 'Возврат', $2, $3)`,
            [u.unit_id, req.user.id, returnId]
          )
        }
      }
    }

    await client.query('COMMIT')
    res.status(201).json({ ok: true, return_ids: createdReturnIds, act_pdf_url: pdfUrl })
  } catch (err) {
    try { await client.query('ROLLBACK') } catch { /* noop */ }
    console.error('walkin-return error:', err)
    res.status(500).json({ error: 'Server error' })
  } finally {
    client.release()
  }
})

module.exports = router
