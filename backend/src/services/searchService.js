const db = require('../db')

const SEARCH_CONFIG = 'ru_search'

const WAREHOUSE_ROLES = ['warehouse_director', 'warehouse_deputy', 'warehouse_staff']

function normalizeSearchText(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[-\u2010-\u2015\u2212]+/g, ' ')
    .replace(/[^a-zа-я0-9]+/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function compactSearchText(value) {
  return normalizeSearchText(value).replace(/\s+/g, '')
}

function normalizedSqlText(expr) {
  return `trim(regexp_replace(replace(lower(coalesce((${expr})::text, '')), 'ё', 'е'), '[^a-zа-я0-9]+', ' ', 'g'))`
}

function compactSqlText(expr) {
  return `regexp_replace(replace(lower(coalesce((${expr})::text, '')), 'ё', 'е'), '[^a-zа-я0-9]+', '', 'g')`
}

// Check pg_trgm availability once at startup
let hasTrgm = null
async function checkTrgm() {
  if (hasTrgm !== null) return hasTrgm
  try {
    await db.query("SELECT similarity('a','b')")
    hasTrgm = true
  } catch {
    hasTrgm = false
  }
  return hasTrgm
}

// ── Synonym expansion (two-tier) ──────────────────────────────────
// Returns { close: [...], category: [...], all: [...] }
// close = direct synonym group (нож → кинжал, стилет)
// category = sibling terms from same category (нож → пистолет, автомат via weapons_*)
async function expandWithSynonyms(term) {
  // 1. Direct synonym lookup (close matches)
  const { rows } = await db.query(
    `SELECT term, synonyms, category FROM search_synonyms
     WHERE lower(term) = lower($1)
        OR (category != 'meta' AND lower($1) = ANY(SELECT lower(unnest(synonyms))))`,
    [term]
  )
  const close = new Set([term.toLowerCase()])
  const categories = new Set()
  for (const row of rows) {
    close.add(row.term.toLowerCase())
    row.synonyms.forEach(s => close.add(s.toLowerCase()))
    if (row.category && row.category !== 'meta') categories.add(row.category)
  }

  // 2. Category siblings (related matches from same category)
  const categoryTerms = new Set()
  if (categories.size > 0) {
    const { rows: catRows } = await db.query(
      `SELECT term, synonyms FROM search_synonyms
       WHERE category = ANY($1::text[]) AND lower(term) != lower($2)`,
      [[...categories], term]
    )
    for (const row of catRows) {
      if (!close.has(row.term.toLowerCase())) {
        categoryTerms.add(row.term.toLowerCase())
      }
    }
  }

  const all = new Set([...close, ...categoryTerms])
  return {
    close: [...close],
    category: [...categoryTerms],
    all: [...all],
  }
}

// ── Sanitize terms for tsquery ────────────────────────────────────
function sanitizeTerms(terms) {
  const result = new Set()
  for (const t of terms) {
    const normalized = normalizeSearchText(t)
    if (normalized.includes(' ')) {
      for (const word of normalized.split(/\s+/)) {
        if (word.length > 1) result.add(word)
      }
    } else if (normalized.length > 1) {
      result.add(normalized)
    }
  }
  return [...result]
}

// ── Build tsquery with synonym expansion ───────────────────────────
async function buildSearchQuery(rawQuery) {
  const originalQuery = normalizeSearchText(rawQuery)
  const compactQuery = compactSearchText(rawQuery)
  const tokens = originalQuery.split(/\s+/).filter(t => t.length > 1)
  if (!tokens.length) return { tsqueryStr: null, originalQuery, compactQuery, tokens: [], closeSynonyms: [] }

  const groups = []
  let allCloseSynonyms = []

  for (const token of tokens) {
    const { close, all } = await expandWithSynonyms(token)
    allCloseSynonyms = [...allCloseSynonyms, ...close]

    const allTerms = sanitizeTerms(all)
    const lowerToken = normalizeSearchText(token)
    const parts = allTerms.slice(0, 50).map(t => {
      const safe = t.replace(/'/g, "''")
      return t === lowerToken ? `'${safe}':*` : `'${safe}'`
    })
    groups.push(`(${parts.join(' | ')})`)
  }

  const tsqueryStr = groups.join(' & ')

  // closeSynonyms: sanitized list for frontend marking (direct synonym group only)
  const closeSanitized = sanitizeTerms(allCloseSynonyms)

  return {
    tsqueryStr,
    originalQuery,
    compactQuery,
    tokens,
    closeSynonyms: closeSanitized,
  }
}

// ── Per-table search query builder ─────────────────────────────────
function buildTableQuery(table, selectFields, nameField, extraJoins, extraWhere, params, tsqIdx, rawIdx, limit) {
  return `
    SELECT ${selectFields}
    FROM ${table} ${extraJoins}
    WHERE (${table.split(' ')[1] || table.split(' ')[0]}.search_vector @@ to_tsquery('${SEARCH_CONFIG}', $${tsqIdx})
           OR similarity(${nameField}, $${rawIdx}) > 0.2)
    ${extraWhere}
    ORDER BY ts_rank_cd(${(table.split(' ')[1] || table.split(' ')[0])}.search_vector,
             to_tsquery('${SEARCH_CONFIG}', $${tsqIdx})) DESC,
             similarity(${nameField}, $${rawIdx}) DESC
    LIMIT ${limit}
  `
}

// ── Helper: build WHERE + ORDER for one table ────────────────────
// Rank threshold: name/category matches score >0.5, tag-only noise scores <0.5
const RANK_THRESHOLD = 0.5

function ftsWhere(alias, nameField, tsqIdx, rawIdx) {
  const normalizedName = normalizedSqlText(nameField)
  const compactName = compactSqlText(nameField)
  return {
    where: `(
      ts_rank_cd(${alias}.search_vector, to_tsquery('${SEARCH_CONFIG}', $${tsqIdx})) > ${RANK_THRESHOLD}
      OR ${normalizedName} LIKE '%' || $${rawIdx} || '%'
      OR ${compactName} LIKE '%' || regexp_replace($${rawIdx}, '[^a-zа-я0-9]+', '', 'g') || '%'
    )`,
    order: `CASE
               WHEN ${normalizedName} LIKE '%' || $${rawIdx} || '%' THEN 2000
               WHEN ${compactName} LIKE '%' || regexp_replace($${rawIdx}, '[^a-zа-я0-9]+', '', 'g') || '%' THEN 1600
               ELSE 0
             END
             + ts_rank_cd(${alias}.search_vector, to_tsquery('${SEARCH_CONFIG}', $${tsqIdx})) DESC`,
  }
}

// ── Global search across all tables ────────────────────────────────
async function searchAll(rawQuery, user, { limit = 30, categories = null } = {}) {
  const { tsqueryStr, originalQuery, tokens } = await buildSearchQuery(rawQuery)
  if (!tsqueryStr) return { query: rawQuery, totalCount: 0, results: [], categories: {} }

  const role = user.role
  const projectId = user.project_id
  const isWarehouse = WAREHOUSE_ROLES.includes(role)
  const isProducer = role === 'producer'
  const promises = []
  const entityLimit = Math.min(Math.ceil(limit / 3), 15)

  const shouldSearch = (cat) => !categories || categories.includes(cat)

  // ── 1. UNITS ──
  if (shouldSearch('unit')) {
    promises.push((async () => {
      const { where, order } = ftsWhere('u', 'u.name', 1, 2)
      const { rows } = await db.query(`
        SELECT u.id, u.name AS title,
               left(coalesce(u.description, ''), 200) AS snippet,
               u.category AS subtitle, u.status,
               (SELECT url FROM unit_photos WHERE unit_id = u.id ORDER BY created_at LIMIT 1) AS photo_url,
               ts_rank_cd(u.search_vector, to_tsquery('${SEARCH_CONFIG}', $1)) AS rank
        FROM units u
        WHERE ${where} AND u.status != 'written_off'
          AND COALESCE(u.is_admin_stock, false) = false
        ORDER BY ${order}
        LIMIT $3
      `, [tsqueryStr, originalQuery, entityLimit])
      return rows.map(r => ({ ...r, entityType: 'unit', url: '/units' }))
    })())
  }

  // ── 2. SCENES ──
  if (shouldSearch('scene') && (!isWarehouse || isProducer)) {
    promises.push((async () => {
      const params = [tsqueryStr, originalQuery, entityLimit]
      const { where, order } = ftsWhere('s', "coalesce(s.object, s.canonical_id)", 1, 2)
      let extra = ''
      if (!isProducer && projectId) { params.push(projectId); extra = `AND s.project_id = $${params.length}` }
      const { rows } = await db.query(`
        SELECT s.id, s.canonical_id AS title,
               left(coalesce(s.synopsis, s.object, ''), 200) AS snippet,
               coalesce('Сцена ' || s.canonical_id || ' · ' || coalesce(s.object, ''), '') AS subtitle,
               s.project_id,
               ts_rank_cd(s.search_vector, to_tsquery('${SEARCH_CONFIG}', $1)) AS rank
        FROM scenes s WHERE ${where} ${extra} ORDER BY ${order} LIMIT $3
      `, params)
      return rows.map(r => ({ ...r, entityType: 'scene', url: '/production/documents' }))
    })())
  }

  // ── 3. DOCUMENTS ──
  if (shouldSearch('document') && (!isWarehouse || isProducer)) {
    promises.push((async () => {
      const params = [tsqueryStr, originalQuery, entityLimit]
      const { where, order } = ftsWhere('d', "coalesce(d.original_name, '')", 1, 2)
      let extra = ''
      if (!isProducer && projectId) { params.push(projectId); extra = `AND d.project_id = $${params.length}` }
      const { rows } = await db.query(`
        SELECT d.id, coalesce(d.original_name, 'Документ') AS title,
               d.type::text AS snippet, d.type::text AS subtitle, d.project_id,
               ts_rank_cd(d.search_vector, to_tsquery('${SEARCH_CONFIG}', $1)) AS rank
        FROM documents d WHERE ${where} ${extra} ORDER BY ${order} LIMIT $3
      `, params)
      return rows.map(r => ({ ...r, entityType: 'document', url: '/production/documents' }))
    })())
  }

  // ── 4. PRODUCTION LIST ITEMS ──
  if (shouldSearch('list_item') && (!isWarehouse || isProducer)) {
    promises.push((async () => {
      const params = [tsqueryStr, originalQuery, entityLimit]
      const { where, order } = ftsWhere('pli', 'pli.name', 1, 2)
      let extra = ''
      if (!isProducer && projectId) { params.push(projectId); extra = `AND pl.project_id = $${params.length}` }
      const { rows } = await db.query(`
        SELECT pli.id, pli.name AS title,
               left(coalesce(pli.note, ''), 200) AS snippet,
               coalesce('Сцена ' || pli.scene, pli.source) AS subtitle,
               ts_rank_cd(pli.search_vector, to_tsquery('${SEARCH_CONFIG}', $1)) AS rank
        FROM production_list_items pli
        JOIN production_lists pl ON pl.id = pli.list_id
        WHERE ${where} ${extra} ORDER BY ${order} LIMIT $3
      `, params)
      return rows.map(r => ({ ...r, entityType: 'list_item', url: '/production/documents' }))
    })())
  }

  // ── 5. LOCATIONS ──
  if (shouldSearch('location')) {
    promises.push((async () => {
      const { where, order } = ftsWhere('l', 'l.name', 1, 2)
      const { rows } = await db.query(`
        SELECT l.id, l.name AS title,
               left(coalesce(l.address, l.description, ''), 200) AS snippet,
               l.type AS subtitle,
               ts_rank_cd(l.search_vector, to_tsquery('${SEARCH_CONFIG}', $1)) AS rank
        FROM locations l WHERE ${where} ORDER BY ${order} LIMIT $3
      `, [tsqueryStr, originalQuery, entityLimit])
      return rows.map(r => ({ ...r, entityType: 'location', url: isWarehouse ? '/locations' : '/production/locations' }))
    })())
  }

  // ── 6. DECORATIONS ──
  if (shouldSearch('decoration')) {
    promises.push((async () => {
      const { where, order } = ftsWhere('d', 'd.name', 1, 2)
      const { rows } = await db.query(`
        SELECT d.id, d.name AS title,
               left(coalesce(d.description, ''), 200) AS snippet,
               d.type AS subtitle,
               ts_rank_cd(d.search_vector, to_tsquery('${SEARCH_CONFIG}', $1)) AS rank
        FROM decorations d WHERE ${where} ORDER BY ${order} LIMIT $3
      `, [tsqueryStr, originalQuery, entityLimit])
      return rows.map(r => ({ ...r, entityType: 'decoration', url: isWarehouse ? '/decorations' : '/production/decorations' }))
    })())
  }

  // ── 7. VEHICLES ──
  if (shouldSearch('vehicle')) {
    promises.push((async () => {
      const { where, order } = ftsWhere('v', 'v.name', 1, 2)
      const { rows } = await db.query(`
        SELECT v.id, v.name AS title,
               left(coalesce(v.brand || ' ' || v.model, v.description, ''), 200) AS snippet,
               v.type AS subtitle, v.license_plate,
               ts_rank_cd(v.search_vector, to_tsquery('${SEARCH_CONFIG}', $1)) AS rank
        FROM vehicles v WHERE ${where} ORDER BY ${order} LIMIT $3
      `, [tsqueryStr, originalQuery, entityLimit])
      return rows.map(r => ({ ...r, entityType: 'vehicle', url: isWarehouse ? '/vehicles' : '/production/vehicles' }))
    })())
  }

  // ── 8a. PROJECTS — поиск по названию проекта ──
  // Видны warehouse-ролям (всем) и production (только свой).
  if (shouldSearch('project')) {
    promises.push((async () => {
      const params = [`%${originalQuery}%`, entityLimit]
      let extra = ''
      if (!isWarehouse && !isProducer && projectId) {
        params.push(projectId); extra = `AND p.id = $${params.length}`
      }
      const { rows } = await db.query(`
        SELECT p.id, p.name AS title,
               COALESCE(
                 (SELECT count(*) FROM users WHERE project_id = p.id), 0
               )::text || ' человек' AS subtitle,
               '' AS snippet,
               1.0 AS rank
        FROM projects p
        WHERE p.name ILIKE $1 ${extra}
        ORDER BY p.name
        LIMIT $2
      `, params)
      return rows.map(r => ({
        ...r, entityType: 'project',
        url: isWarehouse ? `/issued?project=${r.id}` : '/production',
      }))
    })())
  }

  // ── 8b. USERS — поиск по ФИО ──
  // Warehouse-роли видят всех. Производство — только своих.
  if (shouldSearch('user')) {
    promises.push((async () => {
      const params = [`%${originalQuery}%`, entityLimit]
      let extra = ''
      if (!isWarehouse && projectId) {
        params.push(projectId); extra = `AND u.project_id = $${params.length}`
      }
      const { rows } = await db.query(`
        SELECT u.id, u.name AS title,
               COALESCE(p.name, '') AS subtitle,
               u.role || COALESCE(' · ' || u.phone, '') AS snippet,
               1.0 AS rank
        FROM users u LEFT JOIN projects p ON p.id = u.project_id
        WHERE u.name ILIKE $1 ${extra}
        ORDER BY u.name
        LIMIT $2
      `, params)
      return rows.map(r => ({ ...r, entityType: 'user', url: '/team' }))
    })())
  }

  // ── 8c. ISSUANCES — поиск по получателю + проекту ──
  // Только warehouse_director/deputy видят все.
  if (shouldSearch('issuance') && (role === 'warehouse_director' || role === 'warehouse_deputy')) {
    promises.push((async () => {
      const { rows } = await db.query(`
        SELECT iss.id,
               rcv.name || ' · ' || COALESCE(p.name, 'без проекта') AS title,
               'Выдача от ' || to_char(iss.issued_at, 'DD.MM.YYYY')
                 || ' · до ' || to_char(iss.deadline, 'DD.MM.YYYY')
                 || CASE WHEN iss.return_requested_at IS NOT NULL THEN ' · возврат запрошен' ELSE '' END
                 AS subtitle,
               '' AS snippet,
               1.0 AS rank
        FROM issuances iss
        JOIN users rcv ON rcv.id = iss.received_by
        LEFT JOIN projects p ON p.id = rcv.project_id
        WHERE rcv.name ILIKE $1 OR p.name ILIKE $1
        ORDER BY iss.issued_at DESC
        LIMIT $2
      `, [`%${originalQuery}%`, entityLimit])
      return rows.map(r => ({ ...r, entityType: 'issuance', url: '/issued' }))
    })())
  }

  // ── 8d. REQUESTS — поиск заявок: warehouse видят все, остальные — свои. ──
  if (shouldSearch('request') && (isWarehouse || isProducer || projectId)) {
    promises.push((async () => {
      const params = [`%${originalQuery}%`, entityLimit]
      let extra = ''
      if (!isWarehouse && !isProducer && projectId) {
        params.push(projectId); extra = `AND req_user.project_id = $${params.length}`
      }
      const { rows } = await db.query(`
        SELECT req.id,
               req_user.name || ' · ' || COALESCE(p.name, '') AS title,
               'Заявка · ' || req.status::text
                 || COALESCE(' · до ' || to_char(req.deadline, 'DD.MM.YYYY'), '') AS subtitle,
               array_length(req.unit_ids, 1)::text || ' единиц' AS snippet,
               CASE
                 WHEN req.status='new' THEN 1.5
                 WHEN req.status='collecting' THEN 1.3
                 WHEN req.status='ready' THEN 1.1
                 ELSE 0.5
               END AS rank
        FROM requests req
        JOIN users req_user ON req_user.id = req.requester_id
        LEFT JOIN projects p ON p.id = req_user.project_id
        WHERE (req_user.name ILIKE $1 OR p.name ILIKE $1) ${extra}
        ORDER BY req.created_at DESC
        LIMIT $2
      `, params)
      return rows.map(r => ({ ...r, entityType: 'request', url: '/requests' }))
    })())
  }

  // ── 9. CASTING — карточки актёров.
  // Доступ: только производственные роли с правом на /casting (producer,
  // project_director, ams_assistant). Склад НЕ должен видеть ФИО/телефоны
  // актёров через глобальный поиск.
  const CASTING_ALLOWED_ROLES = ['producer', 'project_director', 'ams_assistant']
  if (shouldSearch('casting') && CASTING_ALLOWED_ROLES.includes(role)) {
    promises.push((async () => {
      const { where, order } = ftsWhere('c', 'c.name', 1, 2)
      const KIND_LABEL = `CASE c.kind
          WHEN 'adult' THEN 'Взрослый'
          WHEN 'child' THEN 'Ребёнок'
          WHEN 'animal' THEN 'Животное'
          ELSE c.kind END`
      const { rows } = await db.query(`
        SELECT c.id, c.name AS title,
               ${KIND_LABEL} || COALESCE(' · ' || c.role_name, '') AS subtitle,
               left(coalesce(c.description, c.notes, c.search_tags, ''), 200) AS snippet,
               c.kind, c.status,
               (SELECT url FROM casting_photos cp WHERE cp.card_id = c.id ORDER BY cp.created_at LIMIT 1) AS photo_url,
               ts_rank_cd(c.search_vector, to_tsquery('${SEARCH_CONFIG}', $1)) AS rank
        FROM casting_cards c WHERE ${where} ORDER BY ${order} LIMIT $3
      `, [tsqueryStr, originalQuery, entityLimit])
      return rows.map(r => ({
        ...r, entityType: 'casting',
        url: `/production/casting?card=${r.id}`,
      }))
    })())
  }

  // ── 8. RENT DEALS ──
  if (shouldSearch('rent') && (role === 'warehouse_director' || role === 'warehouse_deputy' || isProducer)) {
    promises.push((async () => {
      const { where, order } = ftsWhere('r', 'r.counterparty_name', 1, 2)
      const { rows } = await db.query(`
        SELECT r.id, r.counterparty_name AS title,
               r.type::text || ' · ' || r.status::text AS snippet,
               r.type::text AS subtitle,
               ts_rank_cd(r.search_vector, to_tsquery('${SEARCH_CONFIG}', $1)) AS rank
        FROM rent_deals r WHERE ${where} ORDER BY ${order} LIMIT $3
      `, [tsqueryStr, originalQuery, entityLimit])
      return rows.map(r => ({ ...r, entityType: 'rent', url: isWarehouse ? '/rent' : '/production/rent' }))
    })())
  }

  // Execute all in parallel — use allSettled so one broken table doesn't kill everything
  const settled = await Promise.allSettled(promises)
  const results = settled
    .filter(r => r.status === 'fulfilled')
    .map(r => r.value)
  const flat = results.flat()

  // Sort by rank descending, take top N
  flat.sort((a, b) => (b.rank || 0) - (a.rank || 0) || (b.sim || 0) - (a.sim || 0))
  const top = flat.slice(0, limit)

  // Count by category
  const catCounts = {}
  for (const r of flat) {
    catCounts[r.entityType] = (catCounts[r.entityType] || 0) + 1
  }

  // Log search (fire-and-forget)
  db.query(
    'INSERT INTO search_history (user_id, query, result_count) VALUES ($1, $2, $3)',
    [user.id, rawQuery.trim(), flat.length]
  ).catch(() => {})

  return {
    query: rawQuery,
    totalCount: flat.length,
    results: top.map(({ rank, sim, ...rest }) => rest),
    categories: catCounts,
  }
}

module.exports = {
  expandWithSynonyms,
  buildSearchQuery,
  searchAll,
  checkTrgm,
  normalizeSearchText,
  compactSearchText,
  normalizedSqlText,
  compactSqlText,
  SEARCH_CONFIG,
}
