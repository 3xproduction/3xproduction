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
app.use('/scenes',       require('./routes/scenes'))

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

// POST /projects/:id/rebuild-positions — re-extract positions from all documents
const { upsertScenesFromKpp, upsertScenesFromScenario, extractSeriesFromFilename, getProjectSeries: getProjectSeriesForRebuild } = require('./services/sceneService')
const { parseDocumentFile } = require('./services/docParser')

app.post('/projects/:id/rebuild-positions', require('./middleware/auth').verifyJWT, async (req, res) => {
  if (!['producer', 'project_director'].includes(req.user.role)) return res.status(403).json({ error: 'Producer only' })
  const pid = req.params.id
  try {
    // 1. Delete auto-imported items (keep manual)
    const { rows: deleted } = await db.query(`
      DELETE FROM production_list_items WHERE id IN (
        SELECT pli.id FROM production_list_items pli
        JOIN production_lists pl ON pl.id = pli.list_id
        WHERE pl.project_id = $1 AND pli.source IN ('kpp', 'scenario', 'ai')
      ) RETURNING id
    `, [pid])
    console.log(`[REBUILD] Deleted ${deleted.length} auto-imported items`)

    // 2. Clear and rebuild scenes table for this project
    await db.query(`DELETE FROM scenes WHERE project_id = $1`, [pid])

    // 3. Process all documents: KPP first (for dates), then Scenario
    const { rows: docs } = await db.query(
      `SELECT id, type, parsed_content, original_name FROM documents
       WHERE project_id = $1 AND type IN ('kpp','scenario') AND parsed_content IS NOT NULL
       ORDER BY CASE WHEN type='kpp' THEN 0 ELSE 1 END, version ASC`,
      [pid]
    )

    const CATEGORY_MAP = {
      props: 'props', costumes: 'costumes', makeup: 'makeup',
      vehicles: 'auto', stunts: 'stunts', pyrotechnics: 'pyrotechnics',
      consultant: 'consultant', locations: 'locations',
    }
    const ALL_TYPES = ['props','art_fill','dummy','auto','decoration','costumes','makeup','stunts','pyrotechnics','consultant','locations']

    let totalImported = 0
    for (const doc of docs) {
      const pc = typeof doc.parsed_content === 'string' ? JSON.parse(doc.parsed_content) : doc.parsed_content
      if (!pc?.scenes) continue

      let seriesNum = ''
      if (doc.type === 'kpp') {
        await upsertScenesFromKpp(pid, pc, doc.id)
      } else {
        seriesNum = extractSeriesFromFilename(doc.original_name)
        if (!seriesNum) seriesNum = await getProjectSeriesForRebuild(pid)
        await upsertScenesFromScenario(pid, pc, doc.id, seriesNum)
      }

      // Re-extract parsed_data and import
      const { dateMap, timeMap, slotMap, textMap } = await getSceneLookupMaps(pid)
      const seen = {}
      const parsed_data = { props: [], costumes: [], makeup: [], auto: [], stunts: [], decoration: [], pyrotechnics: [], art_fill: [], dummy: [], consultant: [], locations: [] }

      for (const s of pc.scenes) {
        const rawId = (s.id || '').replace(/^0+/, '')
        const fullSceneId = (doc.type === 'scenario' && seriesNum)
          ? normalizeSceneId(rawId, seriesNum)
          : normalizeSceneId(s.id) || s.id
        const shootDate = dateMap[fullSceneId] || ''
        const shootDayLabel = timeMap[fullSceneId] || `СД ${s.day || '?'}`
        const slotTime = s.time_slot || slotMap[fullSceneId] || ''
        const shootTime = slotTime ? `${shootDayLabel} · ${slotTime}` : shootDayLabel
        const sceneLocation = s.object || s.synopsis || ''
        const sceneFullText = s.text || ''
        for (const [field, cat] of Object.entries(CATEGORY_MAP)) {
          for (const item of (s[field] || [])) {
            const name = (item || '').replace(/\s+/g, ' ').trim()
            const seenKey = cat + ':' + name.toLowerCase() + ':' + (fullSceneId || '')
            if (!name || seen[seenKey]) continue
            seen[seenKey] = true
            let itemNote = doc.type === 'scenario'
              ? (sceneFullText ? '📝 ' + sceneFullText : '')
              : sceneLocation
            parsed_data[cat].push({
              name, scene: fullSceneId, day: shootDate, source: doc.type,
              time: shootTime, location: s.location || '', note: itemNote,
            })
          }
        }
      }

      // Import to all project members
      const { rows: members } = await db.query(`SELECT id, role FROM users WHERE project_id=$1`, [pid])
      for (const member of members) {
        const isFullAccess = ['producer','project_director'].includes(member.role)
        const ownTypes = isFullAccess ? ALL_TYPES : (ROLE_LIST_TYPES_W[member.role] || [])
        if (!ownTypes.length) continue
        for (const listType of ownTypes) {
          const items = parsed_data[listType] || []
          if (!items.length) continue
          await db.query(`INSERT INTO production_lists (project_id, user_id, type) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING`, [pid, member.id, listType])
          const { rows: lr } = await db.query(`SELECT id FROM production_lists WHERE project_id=$1 AND user_id=$2 AND type=$3`, [pid, member.id, listType])
          for (const item of items) {
            const normalizedName = (item.name || '').replace(/\s+/g, ' ').trim()
            if (!normalizedName) continue
            const { rows: ex } = await db.query(
              `SELECT id FROM production_list_items WHERE list_id=$1 AND LOWER(TRIM(name))=LOWER($2) AND COALESCE(scene,'')=$3`,
              [lr[0].id, normalizedName.toLowerCase(), item.scene || '']
            )
            if (ex.length) continue
            await db.query(
              `INSERT INTO production_list_items (list_id, name, scene, day, time, location, qty, source, note) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
              [lr[0].id, normalizedName, item.scene||null, item.day||null, item.time||null, item.location||null, 1, item.source||doc.type, item.note||null]
            )
            totalImported++
          }
        }
      }
    }

    // 4. Re-enqueue AI tasks for scenario documents
    const scenarioDocs = docs.filter(d => d.type === 'scenario')
    if (process.env.ANTHROPIC_API_KEY && scenarioDocs.length) {
      // Delete old pending/failed AI tasks for this project
      await db.query(`DELETE FROM ai_tasks WHERE project_id = $1 AND status IN ('pending','failed')`, [pid])
      for (const sdoc of scenarioDocs) {
        const pc = typeof sdoc.parsed_content === 'string' ? JSON.parse(sdoc.parsed_content) : sdoc.parsed_content
        if (!pc?.scenes) continue
        const seriesNum = extractSeriesFromFilename(sdoc.original_name) || await getProjectSeriesForRebuild(pid)
        const { rows: existingItems } = await db.query(
          `SELECT DISTINCT LOWER(TRIM(pli.name)) AS name FROM production_list_items pli
           JOIN production_lists pl ON pl.id = pli.list_id WHERE pl.project_id = $1`, [pid])
        const sceneTexts = pc.scenes.map(s => `Сцена ${s.id || s.scene || ''}: ${(s.text || s.synopsis || '').substring(0, 300)}`).join('\n')
        const fullSceneTexts = pc.scenes.map(s => `Сцена ${s.id || s.scene || ''}:\n${(s.text || s.synopsis || '').substring(0, 600)}`).join('\n\n')
        await db.query(`INSERT INTO ai_tasks (project_id, document_id, task_type, params) VALUES ($1,$2,'analyze_scenario',$3)`,
          [pid, sdoc.id, JSON.stringify({ seriesNum, sceneTexts: sceneTexts.substring(0, 14000), existingNames: existingItems.map(r => r.name) })])
        await db.query(`INSERT INTO ai_tasks (project_id, document_id, task_type, params) VALUES ($1,$2,'cross_scenes',$3)`,
          [pid, sdoc.id, JSON.stringify({ seriesNum, fullSceneTexts: fullSceneTexts.substring(0, 17000) })])
      }
      console.log(`[REBUILD] Enqueued ${scenarioDocs.length * 2} AI tasks`)
    }

    res.json({ ok: true, deleted: deleted.length, imported: totalImported, documents: docs.length })
  } catch (err) {
    console.error('[REBUILD]', err)
    res.status(500).json({ error: 'Server error' })
  }
})

// POST /admin/backfill-scenes — populate scenes table from existing documents
app.post('/admin/backfill-scenes', require('./middleware/auth').verifyJWT, async (req, res) => {
  if (req.user.role !== 'producer') return res.status(403).json({ error: 'Producer only' })
  try {
    const { rows: docs } = await db.query(
      `SELECT id, project_id, type, parsed_content, original_name FROM documents
       WHERE type IN ('kpp','scenario') AND parsed_content IS NOT NULL
       ORDER BY CASE WHEN type='kpp' THEN 0 ELSE 1 END, version ASC`
    )
    let total = 0
    for (const doc of docs) {
      const pc = typeof doc.parsed_content === 'string' ? JSON.parse(doc.parsed_content) : doc.parsed_content
      if (!pc?.scenes) continue
      if (doc.type === 'kpp') {
        total += await upsertScenesFromKpp(doc.project_id, pc, doc.id)
      } else {
        const seriesNum = extractSeriesFromFilename(doc.original_name) || await getProjectSeriesForRebuild(doc.project_id)
        total += await upsertScenesFromScenario(doc.project_id, pc, doc.id, seriesNum)
      }
    }
    res.json({ ok: true, scenes_upserted: total, documents_processed: docs.length })
  } catch (err) {
    console.error('[BACKFILL]', err)
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

// PATCH /projects/:id — rename project (producer only)
app.patch('/projects/:id', require('./middleware/auth').verifyJWT, checkRole('producer'), async (req, res) => {
  const { name } = req.body
  if (!name?.trim()) return res.status(400).json({ error: 'Missing name' })
  try {
    const { rows } = await db.query(`UPDATE projects SET name = $1 WHERE id = $2 RETURNING *`, [name.trim(), req.params.id])
    if (!rows.length) return res.status(404).json({ error: 'Not found' })
    res.json({ project: rows[0] })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Server error' })
  }
})

// DELETE /projects/:id — delete project (producer only, moves docs to another project)
app.delete('/projects/:id', require('./middleware/auth').verifyJWT, checkRole('producer'), async (req, res) => {
  const { move_docs_to } = req.body || {}
  try {
    if (move_docs_to) {
      await db.query(`UPDATE documents SET project_id = $1 WHERE project_id = $2`, [move_docs_to, req.params.id])
      await db.query(`UPDATE production_lists SET project_id = $1 WHERE project_id = $2`, [move_docs_to, req.params.id])
    }
    await db.query(`DELETE FROM document_groups WHERE project_id = $1`, [req.params.id])
    await db.query(`UPDATE users SET project_id = NULL WHERE project_id = $1`, [req.params.id])
    await db.query(`DELETE FROM projects WHERE id = $1`, [req.params.id])
    res.json({ ok: true })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Server error' })
  }
})

// POST /documents/:id/reimport — re-run auto-import for a document (producer only)
app.post('/documents/:id/reimport', require('./middleware/auth').verifyJWT, checkRole('producer'), async (req, res) => {
  try {
    const { rows: docRows } = await db.query(`SELECT * FROM documents WHERE id=$1`, [req.params.id])
    if (!docRows.length) return res.status(404).json({ error: 'Not found' })
    const doc = docRows[0]
    const pd = typeof doc.parsed_data === 'string' ? JSON.parse(doc.parsed_data) : doc.parsed_data
    if (!pd) return res.status(400).json({ error: 'No parsed_data' })

    const ALL_LIST_TYPES = ['props','art_fill','dummy','auto','decoration','costumes','makeup','stunts','pyrotechnics','consultant','locations']
    const ROLE_LIST_TYPES = {
      production_designer:['props','art_fill','dummy','auto','decoration','costumes','makeup','stunts','pyrotechnics','consultant'],
      art_director_assistant:['props','art_fill','dummy','auto','decoration','costumes','makeup','stunts','pyrotechnics','consultant'],
      first_assistant_director:['props','art_fill','dummy','auto','decoration','costumes','makeup','stunts','pyrotechnics','consultant'],
      director:['auto','decoration','stunts','pyrotechnics','consultant','makeup'],
      assistant_director:['auto','decoration','stunts','pyrotechnics','consultant','makeup'],
      props_master:['props','art_fill','dummy','auto','decoration','pyrotechnics','consultant','costumes'],
      props_assistant:['props','art_fill','dummy','auto','decoration','pyrotechnics','costumes'],
      decorator:['decoration','props','art_fill','dummy','consultant'],
      costumer:['costumes'], costume_assistant:['costumes'], makeup_artist:['makeup'],
      stunt_coordinator:['stunts'], pyrotechnician:['pyrotechnics'], location_manager:['locations'],
    }
    const { rows: members } = await db.query(`SELECT id, role FROM users WHERE project_id=$1`, [doc.project_id])
    let imported = 0
    for (const m of members) {
      const own = ['producer','project_director'].includes(m.role) ? ALL_LIST_TYPES : (ROLE_LIST_TYPES[m.role] || [])
      for (const lt of own) {
        const items = pd[lt] || []
        if (!items.length) continue
        await db.query(`INSERT INTO production_lists (project_id, user_id, type) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING`, [doc.project_id, m.id, lt])
        const { rows: lr } = await db.query(`SELECT id FROM production_lists WHERE project_id=$1 AND user_id=$2 AND type=$3`, [doc.project_id, m.id, lt])
        for (const item of items) {
          const nm = (item.name||'').replace(/\s+/g,' ').trim()
          if (!nm) continue
          const { rows: ex } = await db.query(`SELECT id FROM production_list_items WHERE list_id=$1 AND LOWER(TRIM(name))=LOWER($2) AND COALESCE(scene,'')=$3`, [lr[0].id, nm.toLowerCase(), item.scene||''])
          if (ex.length) continue
          await db.query(`INSERT INTO production_list_items (list_id,name,scene,day,time,location,qty,source,note) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
            [lr[0].id, nm, item.scene||null, item.day||null, item.time||null, item.location||null, 1, item.source||doc.type, item.note||null])
          imported++
        }
      }
    }
    res.json({ ok: true, imported })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Server error' })
  }
})

// POST /projects/:id/fix-dates — assign dates from scenes table to items without dates
app.post('/projects/:id/fix-dates', require('./middleware/auth').verifyJWT, checkRole('producer'), async (req, res) => {
  const pid = req.params.id
  try {
    const { dateMap: sceneDateMap, timeMap: sceneTimeMap, slotMap: sceneSlotMap } = await getSceneLookupMaps(pid)
    if (!Object.keys(sceneDateMap).length) return res.json({ ok: true, updated: 0, message: 'No dates in scenes table' })

    const { rows: items } = await db.query(
      `SELECT pli.id, pli.scene, pli.day, pli.time FROM production_list_items pli
       JOIN production_lists pl ON pl.id = pli.list_id
       WHERE pl.project_id = $1 AND pli.scene IS NOT NULL AND (pli.day IS NULL OR pli.day = '')`, [pid])

    let updated = 0
    for (const item of items) {
      const normalizedScene = normalizeSceneId(item.scene) || item.scene
      const day = sceneDateMap[normalizedScene] || sceneDateMap[item.scene] || null
      const dayLabel = sceneTimeMap[normalizedScene] || sceneTimeMap[item.scene] || null
      const slot = sceneSlotMap[normalizedScene] || sceneSlotMap[item.scene] || ''
      const time = dayLabel && slot ? `${dayLabel} · ${slot}` : dayLabel
      if (day) {
        await db.query(`UPDATE production_list_items SET day=$1, time=COALESCE($2, time) WHERE id=$3`, [day, time, item.id])
        updated++
      }
    }
    res.json({ ok: true, updated, total_without_dates: items.length })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Server error' })
  }
})

// POST /projects/:id/reattach-scenarios — re-attach scenario text using scenes table
app.post('/projects/:id/reattach-scenarios', require('./middleware/auth').verifyJWT, checkRole('producer'), async (req, res) => {
  const pid = req.params.id
  try {
    // Use scenes table instead of parsing documents again
    const { textMap: sceneTextMap } = await getSceneLookupMaps(pid)
    if (!Object.keys(sceneTextMap).length) return res.json({ ok: true, updated: 0, message: 'No scenario text in scenes table' })

    console.log(`[REATTACH] Scene text map from scenes table: ${Object.keys(sceneTextMap).length} entries`)

    const { rows: allItems } = await db.query(
      `SELECT pli.id, pli.scene, pli.note FROM production_list_items pli
       JOIN production_lists pl ON pl.id = pli.list_id
       WHERE pl.project_id = $1 AND pli.scene IS NOT NULL`, [pid])

    let updated = 0
    for (const item of allItems) {
      if ((item.note || '').includes('\n---\n📝 ')) continue
      const normalizedScene = normalizeSceneId(item.scene) || item.scene
      const scenarioText = sceneTextMap[normalizedScene] || sceneTextMap[item.scene]
      if (!scenarioText) continue
      const existingNote = (item.note || '').trim()
      const separator = existingNote ? '\n---\n' : ''
      const newNote = existingNote + separator + '📝 ' + scenarioText
      await db.query(`UPDATE production_list_items SET note = $1 WHERE id = $2`, [newNote, item.id])
      updated++
    }
    console.log(`[REATTACH] Updated ${updated} items with scenario text`)
    res.json({ ok: true, updated, total_items: allItems.length, scene_keys: Object.keys(sceneTextMap).length })
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

// ============================================================
// AI Task Worker — processes ai_tasks queue with retry
// ============================================================
const { parseDocument: aiParseDocument, analyzeCrossScenes } = require('./services/groq')
const { normalizeSceneId, getSceneLookupMaps } = require('./services/sceneService')

// Role → list types (same as documents.js)
const ROLE_LIST_TYPES_W = {
  production_designer:      ['props','art_fill','dummy','auto','decoration','costumes','makeup','stunts','pyrotechnics','consultant'],
  art_director_assistant:   ['props','art_fill','dummy','auto','decoration','costumes','makeup','stunts','pyrotechnics','consultant'],
  first_assistant_director: ['props','art_fill','dummy','auto','decoration','costumes','makeup','stunts','pyrotechnics','consultant'],
  director:                 ['auto','decoration','stunts','pyrotechnics','consultant','makeup'],
  assistant_director:       ['auto','decoration','stunts','pyrotechnics','consultant','makeup'],
  props_master:             ['props','art_fill','dummy','auto','decoration','pyrotechnics','consultant','costumes'],
  props_assistant:          ['props','art_fill','dummy','auto','decoration','pyrotechnics','costumes'],
  decorator:                ['decoration','props','art_fill','dummy','consultant'],
  costumer:                 ['costumes'],
  costume_assistant:        ['costumes'],
  makeup_artist:            ['makeup'],
  stunt_coordinator:        ['stunts'],
  pyrotechnician:           ['pyrotechnics'],
  location_manager:         ['locations'],
}
const ALL_LIST_TYPES_W = ['props','art_fill','dummy','auto','decoration','costumes','makeup','stunts','pyrotechnics','consultant','locations']

async function processAiTask() {
  if (!process.env.ANTHROPIC_API_KEY) return
  try {
    // Atomically claim one pending/failed task
    const { rows } = await db.query(`
      UPDATE ai_tasks SET status = 'processing', attempts = attempts + 1
      WHERE id = (
        SELECT id FROM ai_tasks
        WHERE status IN ('pending', 'failed') AND attempts < max_attempts
        ORDER BY created_at LIMIT 1
        FOR UPDATE SKIP LOCKED
      ) RETURNING *
    `)
    if (!rows.length) return
    const task = rows[0]
    const params = typeof task.params === 'string' ? JSON.parse(task.params) : (task.params || {})

    try {
      if (task.task_type === 'analyze_scenario') {
        await processAnalyzeScenario(task, params)
      } else if (task.task_type === 'cross_scenes') {
        await processCrossScenes(task, params)
      }
      await db.query(
        `UPDATE ai_tasks SET status = 'completed', completed_at = NOW() WHERE id = $1`,
        [task.id]
      )
      console.log(`[AI-WORKER] Completed task ${task.task_type} (${task.id})`)
    } catch (err) {
      await db.query(
        `UPDATE ai_tasks SET status = 'failed', error = $1 WHERE id = $2`,
        [err.message, task.id]
      )
      console.error(`[AI-WORKER] Failed task ${task.task_type} (${task.id}): ${err.message}`)
    }
  } catch (err) {
    console.error('[AI-WORKER] Worker error:', err.message)
  }
}

async function processAnalyzeScenario(task, params) {
  const { seriesNum, sceneTexts, existingNames } = params
  const aiPrompt = `Вот текст сценария:\n${sceneTexts}\n\nВот предметы, которые УЖЕ ЕСТЬ в списке (не дублируй их):\n${(existingNames || []).join(', ')}\n\nНайди предметы реквизита, костюмы, грим, декорации, транспорт которые УПОМИНАЮТСЯ В ТЕКСТЕ СЦЕН, но ОТСУТСТВУЮТ в списке выше. Верни ТОЛЬКО НОВЫЕ позиции. ОБЯЗАТЕЛЬНО укажи номер сцены в поле scene.\n\nДля КАЖДОГО предмета ОБЯЗАТЕЛЬНО заполни поле "reason" — кратко объясни ПОЧЕМУ этот предмет нужен, процитируй фрагмент сценария где он упоминается.`

  const aiResult = await aiParseDocument(aiPrompt)
  if (!aiResult) return

  // Save raw result
  await db.query(`UPDATE ai_tasks SET result = $1 WHERE id = $2`, [JSON.stringify(aiResult), task.id])

  // Get lookup maps from scenes table
  const { dateMap, timeMap, slotMap, textMap } = await getSceneLookupMaps(task.project_id)

  // Get project members
  const { rows: members } = await db.query(`SELECT id, role FROM users WHERE project_id=$1`, [task.project_id])
  // Build dedup set
  const { rows: allProjectItems } = await db.query(
    `SELECT DISTINCT LOWER(TRIM(pli.name)) AS name FROM production_list_items pli
     JOIN production_lists pl ON pl.id = pli.list_id
     WHERE pl.project_id = $1`, [task.project_id]
  )
  const projectNamesSet = new Set(allProjectItems.map(r => r.name))
  let aiImported = 0

  // Process main categories
  for (const cat of ALL_LIST_TYPES_W) {
    for (const ai of (aiResult[cat] || [])) {
      const aiName = (ai.name || ai.item || '').replace(/\s+/g, ' ').trim()
      if (!aiName) continue
      const aiNameLower = aiName.toLowerCase()
      const isDupe = [...projectNamesSet].some(existing =>
        existing === aiNameLower || existing.includes(aiNameLower) || aiNameLower.includes(existing)
      )
      if (isDupe) continue

      const sceneId = normalizeSceneId(ai.scene, seriesNum)
      const aiDay = (sceneId && dateMap[sceneId]) || null
      const aiDayLabel = (sceneId && timeMap[sceneId]) || null
      const aiSlot = (sceneId && slotMap[sceneId]) || ''
      const aiTime = aiDayLabel && aiSlot ? `${aiDayLabel} · ${aiSlot}` : aiDayLabel
      const aiReason = ai.reason || ai.note || ''
      const scenarioSnippet = sceneId ? (textMap[sceneId] || '') : ''
      const noteParts = []
      if (aiReason) noteParts.push('🤖 ' + aiReason)
      if (scenarioSnippet) noteParts.push('📝 ' + scenarioSnippet)
      const aiNote = noteParts.join('\n---\n') || null

      for (const m of members) {
        const own = ['producer','project_director'].includes(m.role) ? ALL_LIST_TYPES_W : (ROLE_LIST_TYPES_W[m.role] || [])
        if (!own.includes(cat)) continue
        await db.query(`INSERT INTO production_lists (project_id, user_id, type) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING`, [task.project_id, m.id, cat])
        const { rows: lr } = await db.query(`SELECT id FROM production_lists WHERE project_id=$1 AND user_id=$2 AND type=$3`, [task.project_id, m.id, cat])
        await db.query(
          `INSERT INTO production_list_items (list_id, name, scene, day, time, location, qty, source, note) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
          [lr[0].id, aiName, sceneId, aiDay, aiTime, ai.location || null, 1, 'ai', aiNote]
        )
        aiImported++
      }
      projectNamesSet.add(aiNameLower)
    }
  }

  // Process AI suggestions
  for (const sug of (aiResult.ai_suggestions || [])) {
    const sugName = (sug.item || '').replace(/\s+/g, ' ').trim()
    const sugCat = sug.category || 'props'
    if (!sugName) continue
    const sugNameLower = sugName.toLowerCase()
    const sugIsDupe = [...projectNamesSet].some(existing =>
      existing === sugNameLower || existing.includes(sugNameLower) || sugNameLower.includes(existing)
    )
    if (sugIsDupe) continue

    const sugScene = normalizeSceneId(sug.scene, seriesNum)
    const sugDay = (sugScene && dateMap[sugScene]) || null
    const sugDayLabel = (sugScene && timeMap[sugScene]) || null
    const sugSlot = (sugScene && slotMap[sugScene]) || ''
    const sugTime = sugDayLabel && sugSlot ? `${sugDayLabel} · ${sugSlot}` : sugDayLabel
    const sugReason = sug.reason || ''
    const sugScenarioText = sugScene ? (textMap[sugScene] || '') : ''
    const sugNoteParts = []
    if (sugReason) sugNoteParts.push('🤖 ' + sugReason)
    if (sugScenarioText) sugNoteParts.push('📝 ' + sugScenarioText)
    const sugNote = sugNoteParts.join('\n---\n') || null

    for (const m of members) {
      const own = ['producer','project_director'].includes(m.role) ? ALL_LIST_TYPES_W : (ROLE_LIST_TYPES_W[m.role] || [])
      if (!own.includes(sugCat)) continue
      await db.query(`INSERT INTO production_lists (project_id, user_id, type) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING`, [task.project_id, m.id, sugCat])
      const { rows: lr } = await db.query(`SELECT id FROM production_lists WHERE project_id=$1 AND user_id=$2 AND type=$3`, [task.project_id, m.id, sugCat])
      await db.query(
        `INSERT INTO production_list_items (list_id, name, scene, day, time, qty, source, note) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [lr[0].id, sugName, sugScene, sugDay, sugTime, 1, 'ai', sugNote]
      )
      aiImported++
    }
    projectNamesSet.add(sugNameLower)
  }

  console.log(`[AI-WORKER] Imported ${aiImported} AI items for project ${task.project_id}`)
}

async function processCrossScenes(task, params) {
  const { seriesNum, fullSceneTexts } = params
  const crossResult = await analyzeCrossScenes(fullSceneTexts)
  if (!crossResult?.cross_scenes?.length) return

  const crossScenes = crossResult.cross_scenes.map(cs => ({
    ...cs,
    scenes: (cs.scenes || []).map(sc => normalizeSceneId(sc, seriesNum) || String(sc).replace(/^0+/, ''))
  }))

  await db.query(
    `UPDATE documents SET parsed_data = jsonb_set(COALESCE(parsed_data,'{}')::jsonb, '{cross_scenes}', $1::jsonb) WHERE id = $2`,
    [JSON.stringify(crossScenes), task.document_id]
  )
  await db.query(`UPDATE ai_tasks SET result = $1 WHERE id = $2`, [JSON.stringify(crossScenes), task.id])
  console.log(`[AI-WORKER] Found ${crossScenes.length} cross-scene items`)
}

// Run AI worker every 30 seconds
setInterval(processAiTask, 30000)
// Run once on startup after short delay
setTimeout(processAiTask, 5000)

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
