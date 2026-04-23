const db = require('../db')

const SEARCH_CONFIG = 'ru_search'

const WAREHOUSE_ROLES = ['warehouse_director', 'warehouse_deputy', 'warehouse_staff']

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
    if (t.includes(' ')) {
      for (const word of t.split(/\s+/)) {
        if (word.length > 1) result.add(word)
      }
    } else {
      result.add(t)
    }
  }
  return [...result]
}

// ── Build tsquery with synonym expansion ───────────────────────────
async function buildSearchQuery(rawQuery) {
  const tokens = rawQuery.trim().split(/\s+/).filter(t => t.length > 1)
  if (!tokens.length) return { tsqueryStr: null, originalQuery: rawQuery.trim(), tokens: [], closeSynonyms: [] }

  const groups = []
  let allCloseSynonyms = []

  for (const token of tokens) {
    const { close, all } = await expandWithSynonyms(token)
    allCloseSynonyms = [...allCloseSynonyms, ...close]

    const allTerms = sanitizeTerms(all)
    const lowerToken = token.toLowerCase()
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
    originalQuery: rawQuery.trim(),
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
  return {
    where: `(
      ts_rank_cd(${alias}.search_vector, to_tsquery('${SEARCH_CONFIG}', $${tsqIdx})) > ${RANK_THRESHOLD}
      OR ${nameField} ILIKE '%' || $${rawIdx} || '%'
    )`,
    order: `ts_rank_cd(${alias}.search_vector, to_tsquery('${SEARCH_CONFIG}', $${tsqIdx})) DESC`,
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

module.exports = { expandWithSynonyms, buildSearchQuery, searchAll, checkTrgm, SEARCH_CONFIG }
