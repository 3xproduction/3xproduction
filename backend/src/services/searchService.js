const db = require('../db')

const SEARCH_CONFIG = 'ru_search'

const WAREHOUSE_ROLES = ['warehouse_director', 'warehouse_deputy', 'warehouse_staff']

// ── Synonym expansion ──────────────────────────────────────────────
async function expandWithSynonyms(term) {
  const { rows } = await db.query(
    `SELECT term, synonyms FROM search_synonyms
     WHERE lower(term) = lower($1)
        OR lower($1) = ANY(SELECT lower(unnest(synonyms)))`,
    [term]
  )
  const expanded = new Set([term.toLowerCase()])
  for (const row of rows) {
    expanded.add(row.term.toLowerCase())
    row.synonyms.forEach(s => expanded.add(s.toLowerCase()))
  }
  return [...expanded]
}

// ── Build tsquery with synonym expansion ───────────────────────────
// "красный стул" → ('красн' | ...) & ('стул' | 'кресло' | 'табурет' | ...)
async function buildSearchQuery(rawQuery) {
  const tokens = rawQuery.trim().split(/\s+/).filter(t => t.length > 1)
  if (!tokens.length) return { tsqueryStr: null, originalQuery: rawQuery.trim(), tokens: [] }

  const groups = []
  for (const token of tokens) {
    const expanded = await expandWithSynonyms(token)
    // Each synonym becomes a prefix-search lexeme via :*
    const parts = expanded.map(t => t.replace(/'/g, "''")).map(t => `'${t}':*`)
    groups.push(`(${parts.join(' | ')})`)
  }
  // AND between token groups
  const tsqueryStr = groups.join(' & ')

  return {
    tsqueryStr,
    originalQuery: rawQuery.trim(),
    tokens,
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

  // Helper: should search this category?
  const shouldSearch = (cat) => !categories || categories.includes(cat)

  // ── 1. UNITS ──
  if (shouldSearch('unit')) {
    promises.push((async () => {
      const { rows } = await db.query(`
        SELECT u.id, u.name AS title,
               left(coalesce(u.description, ''), 200) AS snippet,
               u.category AS subtitle, u.status,
               (SELECT url FROM unit_photos WHERE unit_id = u.id ORDER BY created_at LIMIT 1) AS photo_url,
               ts_rank_cd(u.search_vector, to_tsquery('${SEARCH_CONFIG}', $1)) AS rank,
               similarity(u.name, $2) AS sim
        FROM units u
        WHERE (u.search_vector @@ to_tsquery('${SEARCH_CONFIG}', $1) OR similarity(u.name, $2) > 0.2)
          AND u.status != 'written_off'
        ORDER BY rank DESC, sim DESC
        LIMIT $3
      `, [tsqueryStr, originalQuery, entityLimit])
      return rows.map(r => ({ ...r, entityType: 'unit', url: '/units' }))
    })())
  }

  // ── 2. SCENES ── (production roles + producer only)
  if (shouldSearch('scene') && (!isWarehouse || isProducer)) {
    promises.push((async () => {
      const params = [tsqueryStr, originalQuery, entityLimit]
      let where = ''
      if (!isProducer && projectId) {
        params.push(projectId)
        where = `AND s.project_id = $${params.length}`
      }
      const { rows } = await db.query(`
        SELECT s.id, s.canonical_id AS title,
               left(coalesce(s.synopsis, s.object, ''), 200) AS snippet,
               coalesce('Сцена ' || s.canonical_id || ' · ' || coalesce(s.object, ''), '') AS subtitle,
               s.project_id,
               ts_rank_cd(s.search_vector, to_tsquery('${SEARCH_CONFIG}', $1)) AS rank,
               similarity(coalesce(s.object, s.canonical_id), $2) AS sim
        FROM scenes s
        WHERE (s.search_vector @@ to_tsquery('${SEARCH_CONFIG}', $1)
               OR similarity(coalesce(s.object, ''), $2) > 0.2)
          ${where}
        ORDER BY rank DESC, sim DESC
        LIMIT $3
      `, params)
      return rows.map(r => ({ ...r, entityType: 'scene', url: '/production/documents' }))
    })())
  }

  // ── 3. DOCUMENTS ── (production roles + producer)
  if (shouldSearch('document') && (!isWarehouse || isProducer)) {
    promises.push((async () => {
      const params = [tsqueryStr, originalQuery, entityLimit]
      let where = ''
      if (!isProducer && projectId) {
        params.push(projectId)
        where = `AND d.project_id = $${params.length}`
      }
      const { rows } = await db.query(`
        SELECT d.id, coalesce(d.original_name, 'Документ') AS title,
               d.type::text AS snippet,
               d.type::text AS subtitle, d.project_id,
               ts_rank_cd(d.search_vector, to_tsquery('${SEARCH_CONFIG}', $1)) AS rank,
               similarity(coalesce(d.original_name, ''), $2) AS sim
        FROM documents d
        WHERE (d.search_vector @@ to_tsquery('${SEARCH_CONFIG}', $1)
               OR similarity(coalesce(d.original_name, ''), $2) > 0.2)
          ${where}
        ORDER BY rank DESC, sim DESC
        LIMIT $3
      `, params)
      return rows.map(r => ({ ...r, entityType: 'document', url: '/production/documents' }))
    })())
  }

  // ── 4. PRODUCTION LIST ITEMS ── (production roles + producer)
  if (shouldSearch('list_item') && (!isWarehouse || isProducer)) {
    promises.push((async () => {
      const params = [tsqueryStr, originalQuery, entityLimit]
      let where = ''
      if (!isProducer && projectId) {
        params.push(projectId)
        where = `AND pl.project_id = $${params.length}`
      }
      const { rows } = await db.query(`
        SELECT pli.id, pli.name AS title,
               left(coalesce(pli.note, ''), 200) AS snippet,
               coalesce('Сцена ' || pli.scene, pli.source) AS subtitle,
               ts_rank_cd(pli.search_vector, to_tsquery('${SEARCH_CONFIG}', $1)) AS rank,
               similarity(pli.name, $2) AS sim
        FROM production_list_items pli
        JOIN production_lists pl ON pl.id = pli.list_id
        WHERE (pli.search_vector @@ to_tsquery('${SEARCH_CONFIG}', $1)
               OR similarity(pli.name, $2) > 0.2)
          ${where}
        ORDER BY rank DESC, sim DESC
        LIMIT $3
      `, params)
      return rows.map(r => ({ ...r, entityType: 'list_item', url: '/production/documents' }))
    })())
  }

  // ── 5. LOCATIONS ──
  if (shouldSearch('location')) {
    promises.push((async () => {
      const { rows } = await db.query(`
        SELECT l.id, l.name AS title,
               left(coalesce(l.address, l.description, ''), 200) AS snippet,
               l.type AS subtitle,
               ts_rank_cd(l.search_vector, to_tsquery('${SEARCH_CONFIG}', $1)) AS rank,
               similarity(l.name, $2) AS sim
        FROM locations l
        WHERE l.search_vector @@ to_tsquery('${SEARCH_CONFIG}', $1)
           OR similarity(l.name, $2) > 0.2
        ORDER BY rank DESC, sim DESC
        LIMIT $3
      `, [tsqueryStr, originalQuery, entityLimit])
      return rows.map(r => ({
        ...r, entityType: 'location',
        url: isWarehouse ? '/locations' : '/production/locations',
      }))
    })())
  }

  // ── 6. DECORATIONS ──
  if (shouldSearch('decoration')) {
    promises.push((async () => {
      const { rows } = await db.query(`
        SELECT d.id, d.name AS title,
               left(coalesce(d.description, ''), 200) AS snippet,
               d.type AS subtitle,
               ts_rank_cd(d.search_vector, to_tsquery('${SEARCH_CONFIG}', $1)) AS rank,
               similarity(d.name, $2) AS sim
        FROM decorations d
        WHERE d.search_vector @@ to_tsquery('${SEARCH_CONFIG}', $1)
           OR similarity(d.name, $2) > 0.2
        ORDER BY rank DESC, sim DESC
        LIMIT $3
      `, [tsqueryStr, originalQuery, entityLimit])
      return rows.map(r => ({
        ...r, entityType: 'decoration',
        url: isWarehouse ? '/decorations' : '/production/decorations',
      }))
    })())
  }

  // ── 7. VEHICLES ──
  if (shouldSearch('vehicle')) {
    promises.push((async () => {
      const { rows } = await db.query(`
        SELECT v.id, v.name AS title,
               left(coalesce(v.brand || ' ' || v.model, v.description, ''), 200) AS snippet,
               v.type AS subtitle, v.license_plate,
               ts_rank_cd(v.search_vector, to_tsquery('${SEARCH_CONFIG}', $1)) AS rank,
               similarity(v.name, $2) AS sim
        FROM vehicles v
        WHERE v.search_vector @@ to_tsquery('${SEARCH_CONFIG}', $1)
           OR similarity(v.name, $2) > 0.2
        ORDER BY rank DESC, sim DESC
        LIMIT $3
      `, [tsqueryStr, originalQuery, entityLimit])
      return rows.map(r => ({
        ...r, entityType: 'vehicle',
        url: isWarehouse ? '/vehicles' : '/production/vehicles',
      }))
    })())
  }

  // ── 8. RENT DEALS ── (warehouse director/deputy + producer)
  if (shouldSearch('rent') && (role === 'warehouse_director' || role === 'warehouse_deputy' || isProducer)) {
    promises.push((async () => {
      const { rows } = await db.query(`
        SELECT r.id, r.counterparty_name AS title,
               r.type::text || ' · ' || r.status::text AS snippet,
               r.type::text AS subtitle,
               ts_rank_cd(r.search_vector, to_tsquery('${SEARCH_CONFIG}', $1)) AS rank,
               similarity(r.counterparty_name, $2) AS sim
        FROM rent_deals r
        WHERE r.search_vector @@ to_tsquery('${SEARCH_CONFIG}', $1)
           OR similarity(r.counterparty_name, $2) > 0.2
        ORDER BY rank DESC, sim DESC
        LIMIT $3
      `, [tsqueryStr, originalQuery, entityLimit])
      return rows.map(r => ({ ...r, entityType: 'rent', url: isWarehouse ? '/rent' : '/production/rent' }))
    })())
  }

  // Execute all in parallel
  const results = await Promise.all(promises)
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

module.exports = { expandWithSynonyms, buildSearchQuery, searchAll, SEARCH_CONFIG }
