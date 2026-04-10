require('dotenv').config()
const express     = require('express')
const cors        = require('cors')
const helmet      = require('helmet')
const rateLimit   = require('express-rate-limit')
const fs          = require('fs')
const path        = require('path')
const { pool } = require('./db')

// Run pending migrations on startup
async function runMigrations() {
  const client = await pool.connect()
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS _migrations (
        id SERIAL PRIMARY KEY, filename TEXT NOT NULL UNIQUE,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `)
    const dir = path.join(__dirname, 'db/migrations')
    const files = fs.readdirSync(dir).filter(f => f.endsWith('.sql')).sort()
    for (const file of files) {
      const { rows } = await client.query('SELECT id FROM _migrations WHERE filename=$1', [file])
      if (rows.length) continue
      const sql = fs.readFileSync(path.join(dir, file), 'utf8')
      await client.query('BEGIN')
      try {
        await client.query(sql)
        await client.query('INSERT INTO _migrations (filename) VALUES ($1)', [file])
        await client.query('COMMIT')
        console.log(`migration applied: ${file}`)
      } catch (err) {
        await client.query('ROLLBACK')
        console.error(`migration failed: ${file}`, err.message)
      }
    }
  } finally {
    client.release()
  }
}

const app = express()

// Security headers
app.use(helmet({ contentSecurityPolicy: false }))

// CORS — explicit origins, no wildcard
app.use(cors({
  origin: process.env.FRONTEND_URL
    ? [process.env.FRONTEND_URL, 'http://localhost:5173']
    : ['http://localhost:5173', 'http://localhost:3000'],
  credentials: true,
}))

// Body size limit
app.use(express.json({ limit: '1mb' }))

// Global rate limit: 100 requests per minute per IP
app.use(rateLimit({
  windowMs: 60_000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
}))

// Strict rate limit for auth endpoints
const authLimiter = rateLimit({ windowMs: 15 * 60_000, max: 10, standardHeaders: true, legacyHeaders: false })
app.use('/auth/login', authLimiter)
app.use('/auth/register', authLimiter)
app.use('/auth/recover', authLimiter)

// Serve frontend SPA for browser navigation (before API routes)
const frontendDist = path.join(__dirname, '../../frontend/dist')
if (fs.existsSync(frontendDist)) {
  app.use(express.static(frontendDist))
  app.use((req, res, next) => {
    if (req.method === 'GET' && req.headers.accept && req.headers.accept.includes('text/html')) {
      return res.sendFile(path.join(frontendDist, 'index.html'))
    }
    next()
  })
}

// Routes
app.use('/auth',       require('./routes/auth'))
app.use('/invites',    require('./routes/invites'))
app.use('/units',      require('./routes/units'))
app.use('/warehouses', require('./routes/warehouses'))
app.use('/requests',   require('./routes/requests'))
app.use('/issuances',  require('./routes/issuances'))
app.use('/documents',  require('./routes/documents'))
app.use('/rent',       require('./routes/rent'))
app.use('/public',     require('./routes/publicRent')) // only public endpoints, no JWT
app.use('/analytics',  require('./routes/analytics'))
app.use('/team',       require('./routes/team'))
app.use('/lists',      require('./routes/lists'))
app.use('/debts',        require('./routes/debts'))
app.use('/locations',    require('./routes/locations'))
app.use('/decorations',  require('./routes/decorations'))
app.use('/vehicles',     require('./routes/vehicles'))
app.use('/casting',      require('./routes/casting'))

// POST /admin/reset-docs — clear documents and lists for fresh re-import
app.post('/admin/reset-docs', require('./middleware/auth').verifyJWT, async (req, res) => {
  if (req.user.role !== 'producer') return res.status(403).json({ error: 'Producer only' })
  try {
    await db.query('DELETE FROM production_list_items')
    await db.query('DELETE FROM production_lists')
    await db.query('DELETE FROM documents')
    res.json({ ok: true, message: 'Cleared documents and lists' })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Server error' })
  }
})

// POST /admin/cleanup-dupes — remove duplicate items from production lists (keep oldest)
app.post('/admin/cleanup-dupes', require('./middleware/auth').verifyJWT, async (req, res) => {
  if (req.user.role !== 'producer') return res.status(403).json({ error: 'Producer only' })
  try {
    const { rows } = await db.query(`
      DELETE FROM production_list_items
      WHERE id IN (
        SELECT id FROM (
          SELECT id,
            ROW_NUMBER() OVER (
              PARTITION BY list_id, LOWER(TRIM(name)), COALESCE(scene, '')
              ORDER BY created_at ASC
            ) AS rn
          FROM production_list_items
        ) dupes
        WHERE rn > 1
      )
      RETURNING id
    `)
    res.json({ ok: true, deleted: rows.length })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Server error' })
  }
})

// GET /projects — list all projects
app.get('/projects', require('./middleware/auth').verifyJWT, async (req, res) => {
  try {
    const { rows } = await db.query(`SELECT id, name, created_at FROM projects ORDER BY name`)
    res.json({ projects: rows })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Server error' })
  }
})

// POST /projects — create new project (producer only)
const { checkRole } = require('./middleware/auth')
app.post('/projects', require('./middleware/auth').verifyJWT, checkRole('producer'), async (req, res) => {
  const { name } = req.body
  if (!name?.trim()) return res.status(400).json({ error: 'Missing project name' })
  try {
    const { rows } = await db.query(
      `INSERT INTO projects (name) VALUES ($1) RETURNING *`,
      [name.trim()]
    )
    res.status(201).json({ project: rows[0] })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Server error' })
  }
})

// Notifications polling endpoint
const { verifyJWT } = require('./middleware/auth')
const db = require('./db')
const { sendPush, vapidPublicKey } = require('./services/push')

// Push subscription endpoints
app.get('/push/vapid-key', (req, res) => res.json({ key: vapidPublicKey || null }))

app.post('/push/subscribe', verifyJWT, async (req, res) => {
  const { endpoint, keys } = req.body
  if (!endpoint || !keys?.p256dh || !keys?.auth) return res.status(400).json({ error: 'Invalid subscription' })
  try {
    await db.query(
      `INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth)
       VALUES ($1,$2,$3,$4)
       ON CONFLICT (user_id, endpoint) DO UPDATE SET p256dh=$3, auth=$4`,
      [req.user.id, endpoint, keys.p256dh, keys.auth]
    )
    res.json({ ok: true })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Server error' })
  }
})

app.delete('/push/subscribe', verifyJWT, async (req, res) => {
  const { endpoint } = req.body
  try {
    await db.query(`DELETE FROM push_subscriptions WHERE user_id=$1 AND endpoint=$2`, [req.user.id, endpoint])
    res.json({ ok: true })
  } catch (err) {
    res.status(500).json({ error: 'Server error' })
  }
})

app.get('/notifications', verifyJWT, async (req, res) => {
  const { unread_only } = req.query
  try {
    let q = `SELECT * FROM notifications WHERE user_id=$1`
    if (unread_only === 'true') q += ` AND read=FALSE`
    q += ` ORDER BY created_at DESC LIMIT 50`
    const { rows } = await db.query(q, [req.user.id])
    res.json({ notifications: rows })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Server error' })
  }
})

app.post('/notifications/:id/read', verifyJWT, async (req, res) => {
  try {
    await db.query(`UPDATE notifications SET read=TRUE WHERE id=$1 AND user_id=$2`, [req.params.id, req.user.id])
    res.json({ ok: true })
  } catch (err) {
    res.status(500).json({ error: 'Server error' })
  }
})

app.post('/notifications/read-all', verifyJWT, async (req, res) => {
  try {
    await db.query(`UPDATE notifications SET read=TRUE WHERE user_id=$1`, [req.user.id])
    res.json({ ok: true })
  } catch (err) {
    res.status(500).json({ error: 'Server error' })
  }
})

// Overdue check — every 30 min
const { checkOverdue } = require('./services/notifications')
setInterval(checkOverdue, 30 * 60 * 1000)

// Health check
app.get('/health', (_, res) => res.json({ ok: true }))

// 404 for unmatched API routes
app.use((req, res) => res.status(404).json({ error: 'Not found' }))

// Error handler
app.use((err, req, res, next) => {
  console.error(err)
  res.status(500).json({ error: 'Internal server error' })
})

// Validate required secrets at startup
if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32) {
  console.error('FATAL: JWT_SECRET must be set and at least 32 characters long')
  process.exit(1)
}

const PORT = process.env.PORT || 3000
runMigrations()
  .then(() => app.listen(PORT, () => console.log(`Server running on port ${PORT}`)))
  .catch(err => { console.error('Migration error:', err); process.exit(1) })
