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
    res.status(500).json({ error: 'Search failed' })
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

module.exports = router
