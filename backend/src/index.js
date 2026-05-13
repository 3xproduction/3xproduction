require('dotenv').config()
const express     = require('express')
const cors        = require('cors')
const helmet      = require('helmet')
const rateLimit   = require('express-rate-limit')
const ipKeyGenerator = rateLimit.ipKeyGenerator || ((ip) => ip)
const pinoHttp    = require('pino-http')
const jwt         = require('jsonwebtoken')
const fs          = require('fs')
const path        = require('path')
const { pool } = require('./db')
const logger   = require('./logger')

// Run pending migrations on startup (with retry for DNS resolution on cold start)
async function runMigrations() {
  let client
  for (let attempt = 1; attempt <= 5; attempt++) {
    try {
      client = await pool.connect()
      break
    } catch (err) {
      logger.warn({ attempt, code: err.code, msg: err.message }, 'DB connect attempt failed')
      if (attempt === 5) throw err
      await new Promise(r => setTimeout(r, 2000 * attempt))
    }
  }
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS _migrations (
        id SERIAL PRIMARY KEY, filename TEXT NOT NULL UNIQUE,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `)
    const dir = path.join(__dirname, 'db/migrations')
    const files = fs.readdirSync(dir).filter(f => f.endsWith('.sql')).sort()
    // Один запрос вместо N: SELECT'ить все применённые миграции один раз и
    // дальше сверять в JS. Раньше для 56 миграций было 56 round-trip'ов до
    // БД на холодный старт — это секунды задержки до первого ответа сервера
    // (плюс cold-start serverless container). Теперь — один SELECT.
    const { rows: appliedRows } = await client.query('SELECT filename FROM _migrations')
    const applied = new Set(appliedRows.map(r => r.filename))
    for (const file of files) {
      if (applied.has(file)) continue
      const sql = fs.readFileSync(path.join(dir, file), 'utf8')
      await client.query('BEGIN')
      try {
        await client.query(sql)
        await client.query('INSERT INTO _migrations (filename) VALUES ($1)', [file])
        await client.query('COMMIT')
        logger.info({ file }, 'migration applied')
      } catch (err) {
        await client.query('ROLLBACK')
        logger.error({ file, err: err.message }, 'migration failed')
      }
    }
  } finally {
    client.release()
  }
}

const app = express()

// Trust proxy (required for express-rate-limit behind Yandex Cloud load balancer)
app.set('trust proxy', 1)

// HTTP request logging (auto-generates logs for every request with request id,
// method, url, status, response time — все чувствительные заголовки и поля
// редактируются в logger.js через redact).
app.use(pinoHttp({ logger }))

// Security headers
// COEP/COOP/CORP отключены: @imgly/background-removal грузит ONNX-модель
// (~80MB) с external CDN (staticimgly.com), которому helmet по умолчанию
// блокирует доступ через `Cross-Origin-Embedder-Policy: require-corp`.
// Без COEP `SharedArrayBuffer` недоступен — ONNX падает на single-thread
// (медленнее, но работает в любом браузере). См. utils/removeBg.js.
app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginEmbedderPolicy: false,
  crossOriginOpenerPolicy: false,
  crossOriginResourcePolicy: { policy: 'cross-origin' },
}))

// Кэш-политика:
//   • Статика (JS/CSS/картинки) — не трогаем, пусть её обрабатывает Express static.
//   • Не-GET (POST/PUT/PATCH/DELETE) — всегда no-store.
//   • Workflow-эндпоинты, где важна свежесть между ролями (заявки, выдачи,
//     уведомления, согласования, поиск, auth) — no-store.
//   • Остальные GET (справочники: склады, проекты, команда, каталоги) —
//     30 сек клиентский кэш. Это убирает лишние fetch-ы при навигации
//     Назад/Вперёд и между вкладками SectionTabs, не создавая stale данных
//     дольше полуминуты.
// ETag оставлен выключенным — кэш работает через max-age, без conditional-запросов.
app.set('etag', false)
const NO_CACHE_PREFIXES = [
  '/auth', '/notifications', '/requests', '/issuances', '/rent',
  '/debts', '/search', '/push', '/admin', '/approvals',
  // /warehouses: каталог-интерфейс создаёт ячейку + размещает юнит
  // двумя последовательными запросами. 30-секундный кэш после reload()
  // скрывал свежее размещение → UX «ничего не произошло».
  '/warehouses',
  // /walkin: autocomplete юзеров/проектов должен видеть только что
  // созданных людей сразу после walk-in выдачи.
  '/walkin',
  // /issued: список выданного должен быть свежим — после mass-return
  // или новой выдачи устаревший кэш скрывает изменения.
  '/issued',
]
app.use((req, res, next) => {
  if (req.path.match(/\.(js|css|png|jpg|svg|ico|woff2?)$/)) return next()
  if (req.method !== 'GET'
      || req.path.startsWith('/units/approvals')
      || NO_CACHE_PREFIXES.some(p => req.path.startsWith(p))) {
    res.set('Cache-Control', 'no-store')
  } else {
    res.set('Cache-Control', 'private, max-age=30')
    // Без Vary браузер хранит ответ только по URL. Тогда XHR-ответ
    // (`Accept: */*`, `Sec-Fetch-Dest: empty`) реюзается при page-navigation
    // на тот же URL — пользователь видит raw JSON вместо UI, и SPA-fallback
    // ниже не успевает сработать (запрос не доходит до сервера).
    res.vary('Sec-Fetch-Dest')
    res.vary('Accept')
  }
  next()
})

// CORS — explicit origins (prod) + LAN dev (localhost/192.168/10.x/172.x on 5173/4173)
const LAN_DEV_ORIGIN_RE = /^https?:\/\/(localhost|127\.0\.0\.1|192\.168\.\d+\.\d+|10\.\d+\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+):(5173|4173)$/
app.use(cors({
  origin: (origin, cb) => {
    if (!origin) return cb(null, true)
    if (process.env.FRONTEND_URL && origin === process.env.FRONTEND_URL) return cb(null, true)
    if (LAN_DEV_ORIGIN_RE.test(origin)) return cb(null, true)
    cb(new Error('CORS: origin not allowed'), false)
  },
  credentials: true,
}))

// Body size limit
app.use(express.json({ limit: '1mb' }))

const UNIT_BULK_FLOW_HEADER = 'unit-bulk-upload'
function readAuthToken(req) {
  const header = req.get('x-auth-token') || req.get('authorization') || ''
  return header.startsWith('Bearer ') ? header.slice(7) : header
}

function verifiedBulkPayload(req) {
  if (Object.prototype.hasOwnProperty.call(req, '_unitBulkPayload')) return req._unitBulkPayload
  const token = readAuthToken(req)
  if (!token || !process.env.JWT_SECRET) {
    req._unitBulkPayload = null
    return null
  }
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET)
    req._unitBulkPayload = payload?.id ? payload : null
  } catch {
    req._unitBulkPayload = null
  }
  return req._unitBulkPayload
}

function isUnitBulkFlowRequest(req) {
  if (req.get('x-bulk-flow') !== UNIT_BULK_FLOW_HEADER) return false
  if (!verifiedBulkPayload(req)) return false

  if (req.path.startsWith('/project-units')) {
    const subpath = req.path.slice('/project-units'.length) || '/'
    return req.method === 'POST'
      && (subpath === '/move-to-project' || subpath === '/create-for-project-photo')
  }

  if (!req.path.startsWith('/units')) return false
  const subpath = req.path.slice('/units'.length) || '/'
  if (req.method === 'POST' && (subpath === '/' || subpath === '/recognize' || subpath === '/remove-bg')) return true
  if (req.method === 'GET' && subpath === '/remove-bg/warm') return true
  if (req.method === 'POST' && /^\/[^/]+\/photos$/.test(subpath)) return true
  return req.method === 'GET'
    && subpath === '/'
    && req.query.photo_match_available === '1'
    && typeof req.query.search === 'string'
    && req.query.search.trim().length > 0
}

const unitBulkFlowLimiter = rateLimit({
  windowMs: 15 * 60_000,
  max: 3000,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => {
    const payload = verifiedBulkPayload(req)
    return payload?.id ? `unit-bulk-user:${payload.id}` : `unit-bulk-ip:${ipKeyGenerator(req.ip)}`
  },
  message: { error: 'Слишком много операций пакетного пополнения. Подождите немного, очередь продолжится.' },
})
app.use((req, res, next) => {
  if (isUnitBulkFlowRequest(req)) return unitBulkFlowLimiter(req, res, next)
  return next()
})

// Global rate limit: 100 requests per minute per IP. Unit bulk upload has a
// separate authenticated-flow limiter above, so a 300-photo batch does not
// consume the normal catalog/navigation budget.
app.use(rateLimit({
  windowMs: 60_000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  skip: isUnitBulkFlowRequest,
}))

// Strict rate limit for auth endpoints
const authLimiter = rateLimit({ windowMs: 15 * 60_000, max: 10, standardHeaders: true, legacyHeaders: false })
app.use('/auth/login', authLimiter)
app.use('/auth/register', authLimiter)
app.use('/auth/recover', authLimiter)
app.use('/auth/claim', authLimiter)

// Serve frontend SPA for browser navigation (before API routes)
const frontendDist = path.join(__dirname, '../../frontend/dist')
if (fs.existsSync(frontendDist)) {
  // Vite кладёт хешированные ассеты в /assets (`index-Bux9rVzL.js` и т.п.).
  // Имя меняется при каждом изменении контента → можно безопасно отдавать
  // immutable + max-age=1y. Раньше было `public, max-age=0` — браузер на каждый
  // refresh переспрашивал сервер conditional GET'ом, и на cold-start serverless
  // контейнера (~30-60с до первого ответа) это давало пустой экран минутами,
  // даже если бандл уже лежал в кэше браузера.
  // index.html НЕ хеширован → должен ревалидироваться каждый раз (no-store
  // выставит express по умолчанию через res.sendFile ниже).
  app.use(express.static(frontendDist, {
    setHeaders: (res, filePath) => {
      if (/[/\\]assets[/\\]/.test(filePath)) {
        res.set('Cache-Control', 'public, max-age=31536000, immutable')
      } else if (filePath.endsWith('index.html')) {
        res.set('Cache-Control', 'no-store')
      }
    },
  }))
  app.use((req, res, next) => {
    // SPA fallback на page navigation. Условие срабатывает если:
    //   - Accept включает text/html (классический браузерный GET);
    //   - ИЛИ Sec-Fetch-Dest: document (всегда выставляется при page-navigation
    //     в современных браузерах: open URL, F5, ссылка, закладка). XHR/fetch
    //     присылают `empty`, prefetch — `script`/`image` и т.п.
    //
    // Двойная проверка нужна для случаев, когда Chrome PWA при холодном старте
    // делает запрос с Accept: */* (без text/html) — раньше такие запросы попадали
    // прямо на API endpoint, и юзер видел raw JSON ответа в адресной строке.
    if (req.method !== 'GET') return next()
    const accept = req.headers.accept || ''
    const fetchDest = req.headers['sec-fetch-dest']
    const isPageNav = accept.includes('text/html') || fetchDest === 'document'
    if (isPageNav) {
      res.set('Cache-Control', 'no-store')
      return res.sendFile(path.join(frontendDist, 'index.html'))
    }
    next()
  })
}

// Routes
app.use('/auth',       require('./routes/auth'))
app.use('/invites',    require('./routes/invites'))
app.use('/units',      require('./routes/units'))
app.use('/project-units', require('./routes/projectUnits'))
app.use('/admin-units', require('./routes/adminUnits'))
app.use('/handovers',  require('./routes/handovers'))
app.use('/colleagues', require('./routes/colleagues'))
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
app.use('/writeoffs',    require('./routes/writeoffs'))
app.use('/locations',    require('./routes/locations'))
app.use('/decorations',  require('./routes/decorations'))
app.use('/vehicles',     require('./routes/vehicles'))
app.use('/casting',      require('./routes/casting'))
app.use('/scenes',       require('./routes/scenes'))
app.use('/search',       require('./routes/search'))
app.use('/walkin',       require('./routes/walkin'))
app.use('/issued',       require('./routes/issued'))

// POST /admin/reset-docs — clear documents and lists for fresh re-import
app.post('/admin/reset-docs', require('./middleware/auth').verifyJWT, async (req, res) => {
  if (req.user.role !== 'producer') return res.status(403).json({ error: 'Producer only' })
  try {
    await db.query('DELETE FROM production_list_items')
    await db.query('DELETE FROM production_lists')
    await db.query('DELETE FROM documents')
    res.json({ ok: true, message: 'Cleared documents and lists' })
  } catch (err) {
    logger.error({ err }, 'admin reset docs failed')
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
    logger.error({ err }, 'admin cleanup dupes failed')
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
    logger.info({ deleted: deleted.length }, 'rebuild positions deleted auto-imported items')

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
      decoration: 'decoration',
    }
    const ALL_TYPES = ALL_CATEGORIES

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
        const fullSceneId = (doc.type === 'scenario' && seriesNum)
          ? normalizeSceneId(s.id, seriesNum)
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
        const ownTypes = isFullAccess ? ALL_TYPES : (ROLE_CATEGORIES[member.role] || [])
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
      logger.info({ tasks: scenarioDocs.length * 2 }, 'rebuild positions enqueued AI tasks')
    }

    res.json({ ok: true, deleted: deleted.length, imported: totalImported, documents: docs.length })
  } catch (err) {
    logger.error({ err }, 'rebuild positions failed')
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
    logger.error({ err }, 'backfill scenes failed')
    res.status(500).json({ error: 'Server error' })
  }
})

// GET /projects — list all projects
app.get('/projects', require('./middleware/auth').verifyJWT, async (req, res) => {
  try {
    const { rows } = await db.query(`SELECT id, name, created_at FROM projects ORDER BY name`)
    res.json({ projects: rows })
  } catch (err) {
    logger.error({ err }, 'projects list failed')
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
    logger.error({ err }, 'project create failed')
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
    logger.error({ err }, 'project rename failed')
    res.status(500).json({ error: 'Server error' })
  }
})

// DELETE /projects/:id — delete project (producer only, moves docs to another project)
app.delete('/projects/:id', require('./middleware/auth').verifyJWT, checkRole('producer'), async (req, res) => {
  const { move_docs_to } = req.body || {}
  try {
    const { rows: historyRows } = await db.query(
      `SELECT 1 FROM unit_history WHERE project_id = $1 LIMIT 1`,
      [req.params.id]
    )
    if (historyRows.length) {
      return res.status(409).json({
        error: 'Project has unit movement history and cannot be deleted',
      })
    }
    if (move_docs_to) {
      await db.query(`UPDATE documents SET project_id = $1 WHERE project_id = $2`, [move_docs_to, req.params.id])
      await db.query(`UPDATE production_lists SET project_id = $1 WHERE project_id = $2`, [move_docs_to, req.params.id])
    }
    await db.query(`DELETE FROM document_groups WHERE project_id = $1`, [req.params.id])
    await db.query(`UPDATE users SET project_id = NULL WHERE project_id = $1`, [req.params.id])
    await db.query(`DELETE FROM projects WHERE id = $1`, [req.params.id])
    res.json({ ok: true })
  } catch (err) {
    logger.error({ err }, 'project delete failed')
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

    // ROLE_CATEGORIES and ALL_CATEGORIES imported from roleConfig.js
    const { rows: members } = await db.query(`SELECT id, role FROM users WHERE project_id=$1`, [doc.project_id])
    let imported = 0
    for (const m of members) {
      const own = ['producer','project_director'].includes(m.role) ? ALL_CATEGORIES : (ROLE_CATEGORIES[m.role] || [])
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
    logger.error({ err }, 'document reimport failed')
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
    logger.error({ err }, 'project reimport failed')
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

    logger.info({ entries: Object.keys(sceneTextMap).length }, 'reattach scenarios loaded scene text map')

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
    logger.info({ updated }, 'reattach scenarios updated items')
    res.json({ ok: true, updated, total_items: allItems.length, scene_keys: Object.keys(sceneTextMap).length })
  } catch (err) {
    logger.error({ err }, 'reattach scenarios failed')
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
    logger.error({ err }, 'push subscribe failed')
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
    logger.error({ err }, 'notifications list failed')
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

const { ALL_CATEGORIES, ROLE_CATEGORIES } = require('./constants/roleConfig')

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
      } else if (task.task_type === 'expand_synonyms') {
        await processExpandSynonyms(task)
      } else if (task.task_type === 'generate_unit_tags') {
        await processGenerateUnitTags(task, params)
      }
      await db.query(
        `UPDATE ai_tasks SET status = 'completed', completed_at = NOW() WHERE id = $1`,
        [task.id]
      )
      logger.info({ taskId: task.id, taskType: task.task_type }, 'AI worker completed task')
    } catch (err) {
      await db.query(
        `UPDATE ai_tasks SET status = 'failed', error = $1 WHERE id = $2`,
        [err.message, task.id]
      )
      logger.error({ err, taskId: task.id, taskType: task.task_type }, 'AI worker failed task')
    }
  } catch (err) {
    logger.error({ err }, 'AI worker error')
  }
}

async function processAnalyzeScenario(task, params) {
  const { seriesNum, sceneTexts, existingNames } = params
  const existingList = (existingNames || []).join(', ')
  const aiPrompt = `Ты — опытный реквизитор на съёмочной площадке. Твоя задача — прочитать текст сцен и составить список ВСЕГО что нужно ФИЗИЧЕСКИ подготовить для съёмки.

ВАЖНО — думай как человек который ГОТОВИТ площадку:
- "перестрелка" → нужно оружие (пистолеты, автоматы, холостые патроны, гильзы)
- "едет на машине" → нужен конкретный автомобиль
- "накрытый стол" → посуда, еда, скатерть, столовые приборы
- "звонит" → телефон/мобильный
- "пишет" → ручка, бумага/блокнот
- "рана", "кровь" → грим (искусственная кровь, накладки)
- "взрыв" → пиротехника (взрывпакет, дым-машина)
- "драка" → постановка трюков, защита

Выводи КОНКРЕТНЫЕ предметы, а не абстрактные. Не "оружие", а "пистолет", "автомат" — то что реально нужно реквизитору.

Вот текст сценария:
${sceneTexts}

Вот предметы которые УЖЕ ЕСТЬ в списке (НЕ дублируй их, даже если написаны иначе — "рация" и "радиостанция" это одно и то же, "авто" и "машина" это одно и то же):
${existingList}

Верни ТОЛЬКО НОВЫЕ позиции которых НЕТ в списке выше. ОБЯЗАТЕЛЬНО укажи scene (номер сцены) и reason (почему нужен + цитата из сценария).`

  const aiResult = await aiParseDocument(aiPrompt)
  if (!aiResult) return

  // Save raw result
  await db.query(`UPDATE ai_tasks SET result = $1 WHERE id = $2`, [JSON.stringify(aiResult), task.id])

  // Get lookup maps from scenes table
  const { dateMap, timeMap, slotMap, textMap } = await getSceneLookupMaps(task.project_id)

  // Get project members
  const { rows: members } = await db.query(`SELECT id, role FROM users WHERE project_id=$1`, [task.project_id])
  // Build dedup set — exact names AND stems for fuzzy matching
  const { rows: allProjectItems } = await db.query(
    `SELECT DISTINCT LOWER(TRIM(pli.name)) AS name FROM production_list_items pli
     JOIN production_lists pl ON pl.id = pli.list_id
     WHERE pl.project_id = $1`, [task.project_id]
  )
  const projectNamesSet = new Set(allProjectItems.map(r => r.name))
  // Build stem set for fuzzy dedup: "рация" and "Рация Motorola" share stem "рац"
  const projectStemsSet = new Set()
  for (const r of allProjectItems) {
    for (const w of r.name.split(/\s+/)) {
      if (w.length >= 4) projectStemsSet.add(w.substring(0, Math.ceil(w.length * 0.6)))
    }
  }
  let aiImported = 0

  // Process main categories
  for (const cat of ALL_CATEGORIES) {
    for (const ai of (aiResult[cat] || [])) {
      const aiName = (ai.name || ai.item || '').replace(/\s+/g, ' ').trim()
      if (!aiName) continue
      const aiNameLower = aiName.toLowerCase()
      // Check exact match
      if (projectNamesSet.has(aiNameLower)) continue
      // Check fuzzy: if ALL significant words of AI item already have stem matches in project
      const aiWords = aiNameLower.split(/\s+/).filter(w => w.length >= 4)
      const allStemsMatch = aiWords.length > 0 && aiWords.every(w => {
        const stem = w.substring(0, Math.ceil(w.length * 0.6))
        return projectStemsSet.has(stem)
      })
      if (allStemsMatch) continue

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
        const own = ['producer','project_director'].includes(m.role) ? ALL_CATEGORIES : (ROLE_CATEGORIES[m.role] || [])
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
      for (const w of aiNameLower.split(/\s+/)) {
        if (w.length >= 4) projectStemsSet.add(w.substring(0, Math.ceil(w.length * 0.6)))
      }
    }
  }

  // Process AI suggestions
  for (const sug of (aiResult.ai_suggestions || [])) {
    const sugName = (sug.item || '').replace(/\s+/g, ' ').trim()
    const sugCat = sug.category || 'props'
    if (!sugName) continue
    const sugNameLower = sugName.toLowerCase()
    const sugIsDupe = projectNamesSet.has(sugNameLower)
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
      const own = ['producer','project_director'].includes(m.role) ? ALL_CATEGORIES : (ROLE_CATEGORIES[m.role] || [])
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

  logger.info({ imported: aiImported, projectId: task.project_id }, 'AI worker imported project items')
}

async function processCrossScenes(task, params) {
  const { seriesNum, fullSceneTexts } = params
  const crossResult = await analyzeCrossScenes(fullSceneTexts)
  if (!crossResult?.cross_scenes?.length) return

  const crossScenes = crossResult.cross_scenes.map(cs => ({
    ...cs,
    scenes: (cs.scenes || []).map(sc => normalizeSceneId(sc, seriesNum) || String(sc).trim())
  }))

  await db.query(
    `UPDATE documents SET parsed_data = jsonb_set(COALESCE(parsed_data,'{}')::jsonb, '{cross_scenes}', $1::jsonb) WHERE id = $2`,
    [JSON.stringify(crossScenes), task.document_id]
  )
  await db.query(`UPDATE ai_tasks SET result = $1 WHERE id = $2`, [JSON.stringify(crossScenes), task.id])
  logger.info({ count: crossScenes.length }, 'AI worker found cross-scene items')
}

async function processExpandSynonyms(task) {
  // Get all unique item names from project
  const { rows } = await db.query(
    `SELECT DISTINCT LOWER(TRIM(pli.name)) AS name
     FROM production_list_items pli
     JOIN production_lists pl ON pl.id = pli.list_id
     WHERE pl.project_id = $1 AND LENGTH(TRIM(pli.name)) > 2`,
    [task.project_id]
  )
  if (!rows.length) return

  const itemNames = rows.map(r => r.name)
  const prompt = `Ты — опытный реквизитор на киностудии. Для каждого предмета из списка дай 3-6 слов которые СВЯЗАНЫ с этим предметом и могут встретиться в тексте сценария.

Правила:
- Включай СИНОНИМЫ: оружие → пистолет, автомат, ружьё, винтовка, револьвер
- Включай РАЗГОВОРНЫЕ: автомобиль → машина, авто, тачка
- Включай КОНКРЕТНЫЕ ВИДЫ: телефон → мобильный, смартфон, сотовый, трубка
- Включай КОНТЕКСТНЫЕ СЛОВА — действия которые подразумевают этот предмет:
  оружие → стрельба, перестрелка, выстрел
  автомобиль → едет, за рулём, припаркован
  нож → режет, порезал
  грим/кровь → рана, ранение, окровавленный
- НЕ включай общие слова (делает, идёт, стоит)
- Если для предмета нет осмысленных синонимов — пропусти его
- Верни строго JSON без markdown

Список предметов:
${itemNames.join(', ')}

Формат ответа:
{"предмет1": ["синоним1", "действие1", "вид1"], "предмет2": ["синоним1"]}`

  const result = await aiParseDocument(prompt)
  if (!result || typeof result !== 'object') return

  // Clean: keep only string arrays
  const synonyms = {}
  for (const [key, val] of Object.entries(result)) {
    if (Array.isArray(val) && val.length && val.every(v => typeof v === 'string')) {
      synonyms[key.toLowerCase().trim()] = val.map(v => v.toLowerCase().trim())
    }
  }

  // Save to document's parsed_data.synonyms
  await db.query(
    `UPDATE documents SET parsed_data = jsonb_set(COALESCE(parsed_data,'{}')::jsonb, '{synonyms}', $1::jsonb) WHERE id = $2`,
    [JSON.stringify(synonyms), task.document_id]
  )
  await db.query(`UPDATE ai_tasks SET result = $1 WHERE id = $2`, [JSON.stringify(synonyms), task.id])
  logger.info({ count: Object.keys(synonyms).length }, 'AI worker generated synonyms')
}

async function processGenerateUnitTags(task, params) {
  const { generateUnitTags } = require('./services/groq')
  const unitId = task.unit_id
  if (!unitId) throw new Error('No unit_id in task')

  const { rows } = await db.query(`SELECT name, category, description, period FROM units WHERE id = $1`, [unitId])
  if (!rows.length) throw new Error(`Unit ${unitId} not found`)

  const unit = rows[0]
  logger.info({ unitId, unitName: unit.name }, 'AI worker generating unit tags')
  const tags = await generateUnitTags({
    name: unit.name,
    category: unit.category,
    description: unit.description || '',
    period: unit.period || '',
  })
  logger.info({ unitId, unitName: unit.name, tags: tags.length }, 'AI worker generated unit tags')

  await db.query(`UPDATE units SET search_tags = $1 WHERE id = $2`, [tags, unitId])
  await db.query(`UPDATE ai_tasks SET result = $1 WHERE id = $2`, [JSON.stringify(tags), task.id])
}

// Run AI worker every 30 seconds
setInterval(processAiTask, 30000)
// Run once on startup after short delay
setTimeout(processAiTask, 5000)

// Keep rembg-sidecar warm. YC SC засыпает после ~5 мин простоя, после чего
// первое фото ловит cold-start ~15с — пользователю кажется, что фича висит.
// Пингуем /warm каждые 4 мин — стоимость пренебрежимая (одна реквест-сек на
// каждые 240 сек, sidecar отвечает за <50мс).
async function pingRembgWarm() {
  const url = process.env.REMBG_URL
  if (!url) return
  try {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), 10_000)
    await fetch(url.replace(/\/+$/, '') + '/warm', { signal: ctrl.signal })
    clearTimeout(timer)
  } catch {
    // Молча — sidecar мог быть занят/уснуть, следующий тик попробует снова.
  }
}
setInterval(pingRembgWarm, 4 * 60 * 1000)
// Один сразу — иначе первый юзер после рестарта контейнера ждёт 4 мин до прогрева.
setTimeout(pingRembgWarm, 10_000)

// Health check
app.get('/health', (_, res) => res.json({ ok: true }))

// 404 for unmatched API routes
app.use((req, res) => res.status(404).json({ error: 'Not found' }))

// Error handler
app.use((err, req, res, next) => {
  ;(req.log || logger).error({ err, url: req.originalUrl, method: req.method }, 'unhandled error')
  res.status(500).json({ error: 'Internal server error' })
})

// Validate required secrets at startup
if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32) {
  logger.fatal('JWT_SECRET must be set and at least 32 characters long')
  process.exit(1)
}

const PORT = process.env.PORT || 3000
runMigrations()
  .then(() => app.listen(PORT, () => logger.info({ port: PORT, env: process.env.NODE_ENV }, 'server started')))
  .catch(err => { logger.fatal({ err }, 'migration error'); process.exit(1) })
