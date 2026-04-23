const router = require('express').Router()
const { verifyJWT } = require('../middleware/auth')
const { searchAll } = require('../services/searchService')

// GET /search?q=...&limit=30&category=unit,location
router.get('/', verifyJWT, async (req, res) => {
  const { q, limit, category } = req.query
  if (!q || !q.trim()) return res.json({ query: '', totalCount: 0, results: [], categories: {} })

  try {
    const cats = category ? category.split(',').map(c => c.trim()) : null
    const results = await searchAll(q, req.user, {
      limit: Math.min(Number(limit) || 30, 100),
      categories: cats,
    })
    res.json(results)
  } catch (err) {
    console.error('Search error:', err)
    // Return empty results instead of 500 to prevent frontend from breaking
    res.json({ query: q, totalCount: 0, results: [], categories: {} })
  }
})

// GET /search/recent — last 10 searches for the current user
router.get('/recent', verifyJWT, async (req, res) => {
  try {
    const db = require('../db')
    const { rows } = await db.query(
      `SELECT DISTINCT ON (query) query, created_at
       FROM search_history WHERE user_id = $1
       ORDER BY query, created_at DESC
       LIMIT 10`,
      [req.user.id]
    )
    res.json({ recent: rows.map(r => r.query) })
  } catch (err) {
    console.error(err)
    res.json({ recent: [] })
  }
})

// GET /search/debug?q=... — diagnostic endpoint (no auth for debugging)
router.get('/debug', async (req, res) => {
  const db = require('../db')
  const { buildSearchQuery, checkTrgm } = require('../services/searchService')
  const q = req.query.q || 'халат'
  try {
    const useTrgm = await checkTrgm()
    const { tsqueryStr, originalQuery } = await buildSearchQuery(q)

    // Check extensions
    const exts = await db.query("SELECT extname FROM pg_extension WHERE extname IN ('pg_trgm','unaccent')")

    // Check ru_search config
    const cfg = await db.query("SELECT cfgname FROM pg_ts_config WHERE cfgname = 'ru_search'")

    // Sample units search_vector
    const sample = await db.query(
      "SELECT id, name, search_vector::text AS sv, search_tags FROM units LIMIT 5"
    )

    // Check how many units have search_vector
    const counts = await db.query(`
      SELECT count(*) AS total,
             count(search_vector) AS with_sv,
             count(CASE WHEN search_vector = ''::tsvector THEN 1 END) AS empty_sv
      FROM units
    `)

    // Test the actual search query
    let matchCount = null
    if (tsqueryStr) {
      try {
        const test = await db.query(`
          SELECT count(*) AS cnt FROM units u
          WHERE ts_rank_cd(u.search_vector, to_tsquery('ru_search', $1)) > 0.5
        `, [tsqueryStr])
        matchCount = { fts_above_threshold: test.rows[0].cnt }

        const testAll = await db.query(`
          SELECT count(*) AS cnt FROM units u
          WHERE u.search_vector @@ to_tsquery('ru_search', $1)
        `, [tsqueryStr])
        matchCount.fts_all = testAll.rows[0].cnt

        const test2 = await db.query(`
          SELECT count(*) AS cnt FROM units u
          WHERE u.name ILIKE '%' || $1 || '%'
        `, [originalQuery])
        matchCount.ilike = test2.rows[0].cnt

        // Show actual matches with scores
        const ranked = await db.query(`
          SELECT u.name, u.category,
                 ts_rank_cd(u.search_vector, to_tsquery('ru_search', $1)) AS rank
          FROM units u
          WHERE u.search_vector @@ to_tsquery('ru_search', $1)
          ORDER BY rank DESC LIMIT 10
        `, [tsqueryStr])
        matchCount.details = ranked.rows

        if (useTrgm) {
          const test3 = await db.query(`
            SELECT count(*) AS cnt FROM units u
            WHERE similarity(u.name, $1) > 0.2
          `, [originalQuery])
          matchCount.similarity = test3.rows[0].cnt
        }
      } catch (e) {
        matchCount = { error: e.message }
      }
    }

    // Check _migrations for search-related
    const migs = await db.query(
      "SELECT filename FROM _migrations WHERE filename LIKE '%03%' ORDER BY filename"
    )

    res.json({
      query: q,
      tsqueryStr,
      useTrgm,
      extensions: exts.rows.map(r => r.extname),
      ruSearchExists: cfg.rows.length > 0,
      unitCounts: counts.rows[0],
      sampleUnits: sample.rows.map(r => ({
        name: r.name,
        sv: r.sv ? r.sv.substring(0, 200) : 'NULL',
        tags: r.search_tags,
      })),
      matchCount,
      migrations: migs.rows.map(r => r.filename),
    })
  } catch (err) {
    res.json({ error: err.message, stack: err.stack })
  }
})

module.exports = router
