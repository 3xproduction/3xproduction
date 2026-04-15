const router   = require('express').Router()
const multer   = require('multer')
const db       = require('../db')
const { verifyJWT } = require('../middleware/auth')
const { parseDocumentFile } = require('../services/docParser')
const { matchUnits } = require('../services/unitMatcher')
const { parseDocument, computeDelta } = require('../services/groq')
const { normalizeSceneId, extractSeriesFromFilename, upsertScenesFromKpp, upsertScenesFromScenario, getSceneLookupMaps, getProjectSeries } = require('../services/sceneService')
const pipeline = require('../services/importPipeline')

const ALLOWED_DOC_TYPES = [
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',       // .xlsx
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document', // .docx
  'application/vnd.ms-excel',                                                // .xls
  'application/pdf',
]
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    cb(null, ALLOWED_DOC_TYPES.includes(file.mimetype))
  },
})

const { ALL_CATEGORIES, ROLE_CATEGORIES, SEE_ALL_ROLES } = require('../constants/roleConfig')

// Roles that can upload
const UPLOAD_KPP_ROLES = [
  'producer', 'project_director', 'project_deputy_upload', 'director', 'assistant_director',
  'production_designer', 'art_director_assistant',
  'props_master', 'props_assistant', 'decorator', 'costumer', 'costume_assistant',
  'makeup_artist', 'stunt_coordinator', 'pyrotechnician', 'location_manager',
]
const UPLOAD_CALLSHEET_ROLES = [
  ...UPLOAD_KPP_ROLES, 'set_admin',
]

// Roles that get notified on new version (everyone except drivers, camera mechanics, playback)
const NO_NOTIFY_ROLES = ['driver', 'camera_mechanic', 'playback']

// POST /documents/upload
router.post('/upload', verifyJWT, upload.single('file'), async (req, res) => {
  const { project_id, type, group_id } = req.body
  if (!project_id || !type) return res.status(400).json({ error: 'Missing project_id or type' })
  if (!['kpp', 'scenario', 'callsheet'].includes(type)) return res.status(400).json({ error: 'Invalid type' })
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' })

  // Validate file extension
  // Fix Cyrillic filename encoding from multer
  try { req.file.originalname = Buffer.from(req.file.originalname, 'latin1').toString('utf8') } catch {}
  const ext = (req.file.originalname || '').split('.').pop().toLowerCase()
  if (type === 'scenario' && ext !== 'docx') return res.status(400).json({ error: 'Сценарий должен быть .docx' })
  if ((type === 'kpp' || type === 'callsheet') && ext !== 'xlsx') return res.status(400).json({ error: `${type.toUpperCase()} должен быть .xlsx` })

  // Check upload permission
  const canUpload = type === 'callsheet'
    ? UPLOAD_CALLSHEET_ROLES.includes(req.user.role)
    : UPLOAD_KPP_ROLES.includes(req.user.role)
  if (!canUpload) return res.status(403).json({ error: 'No upload permission' })

  try {
    console.log(`[UPLOAD] Start: type=${type}, project=${project_id}, user=${req.user.role}`)

    // Get latest version for this project+type
    const { rows: latest } = await db.query(
      `SELECT * FROM documents WHERE project_id=$1 AND type=$2 ORDER BY version DESC LIMIT 1`,
      [project_id, type]
    )
    const version = latest.length ? latest[0].version + 1 : 1
    console.log(`[UPLOAD] Version: ${version}`)

    // Parse document (xlsx/docx → JSON)
    let parsed_content = null
    try {
      parsed_content = await parseDocumentFile(req.file.buffer, req.file.originalname, type)
      console.log(`[UPLOAD] Parsed: ${parsed_content?.scenes?.length || 0} scenes`)
    } catch (err) {
      console.error('[UPLOAD] Document parse error:', err.message)
      return res.status(400).json({ error: `Ошибка парсинга: ${err.message}` })
    }

    // Quick: match units (fast DB query)
    let matched_units = null
    if (type !== 'callsheet' && parsed_content) {
      try {
        matched_units = await matchUnits(parsed_content, project_id)
        console.log(`[UPLOAD] Matched units: ${matched_units?.length || 0}`)
      } catch (err) {
        console.error('[UPLOAD] Unit matching error:', err.message)
      }
    }

    // Scene-level delta (fast, no AI)
    let delta = null
    if (type !== 'callsheet' && latest.length && latest[0].parsed_content?.scenes && parsed_content?.scenes) {
      const sceneDelta = computeSceneDelta(latest[0].parsed_content.scenes, parsed_content.scenes)
      delta = { scene_changes: sceneDelta }
    }

    // === BEGIN TRANSACTION: scenes + document + import ===
    const client = await db.getClient()
    let doc
    let parsed_data = null
    let dataSeries = ''
    let extractedItems = []
    try {
      await client.query('BEGIN')

      // Upsert scenes + extract items via pipeline (inside transaction)
      if (type !== 'callsheet' && parsed_content?.scenes) {
        if (type === 'kpp') {
          const upserted = await upsertScenesFromKpp(project_id, parsed_content, null)
          console.log(`[UPLOAD] Upserted ${upserted} KPP scenes`)
        } else if (type === 'scenario') {
          dataSeries = extractSeriesFromFilename(req.file.originalname)
          if (!dataSeries) dataSeries = await getProjectSeries(project_id)
          const upserted = await upsertScenesFromScenario(project_id, parsed_content, null, dataSeries)
          console.log(`[UPLOAD] Upserted ${upserted} scenario scenes, series="${dataSeries}"`)
        }

        // Pipeline: extract → normalize → deduplicate → validate
        const lookupMaps = await getSceneLookupMaps(project_id, client)
        const rawItems = pipeline.extractItems(parsed_content, type)
        pipeline.normalizeItems(rawItems, lookupMaps, type, dataSeries)
        const dedupedItems = pipeline.deduplicateItems(rawItems)
        const { valid } = pipeline.validateItems(dedupedItems)
        extractedItems = valid

        // Build parsed_data object (for storage in documents table)
        parsed_data = { props: [], costumes: [], makeup: [], auto: [], stunts: [], decoration: [], pyrotechnics: [], art_fill: [], dummy: [], consultant: [], locations: [] }
        for (const item of extractedItems) {
          if (parsed_data[item.category]) {
            parsed_data[item.category].push({
              name: item.name, scene: item.scene, day: item.day, source: item.source,
              time: item.time, location: item.location, note: item.note,
            })
          }
        }
        console.log(`[UPLOAD] Extracted items: ${Object.entries(parsed_data).map(([k,v]) => `${k}:${v.length}`).join(', ')}`)
      }

      // Save document
      const { rows } = await client.query(
        `INSERT INTO documents (project_id, type, version, file_url, parsed_data, parsed_content, matched_units, delta, uploaded_by, original_name, status, group_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
        [project_id, type, version, null,
         parsed_data ? JSON.stringify(parsed_data) : null,
         parsed_content ? JSON.stringify(parsed_content) : null,
         matched_units ? JSON.stringify(matched_units) : null,
         delta ? JSON.stringify(delta) : null,
         req.user.id, req.file.originalname,
         parsed_content ? 'parsed' : 'uploaded',
         group_id || null]
      )
      doc = rows[0]

      // Update scenes table with document ID
      if (type === 'kpp' && parsed_content?.scenes) {
        await client.query(
          `UPDATE scenes SET kpp_document_id = $1 WHERE project_id = $2 AND kpp_document_id IS NULL AND updated_at >= NOW() - INTERVAL '5 minutes'`,
          [doc.id, project_id]
        )
        // Auto-update dates for existing items without dates
        const { dateMap, timeMap, slotMap } = await getSceneLookupMaps(project_id, client)
        const { rows: datelessItems } = await client.query(
          `SELECT pli.id, pli.scene FROM production_list_items pli
           JOIN production_lists pl ON pl.id = pli.list_id
           WHERE pl.project_id = $1 AND pli.scene IS NOT NULL AND (pli.day IS NULL OR pli.day = '')`,
          [project_id]
        )
        let dateFixed = 0
        for (const item of datelessItems) {
          const nScene = normalizeSceneId(item.scene) || item.scene
          const day = dateMap[nScene] || dateMap[item.scene]
          if (!day) continue
          const dayLabel = timeMap[nScene] || timeMap[item.scene] || null
          const slot = slotMap[nScene] || slotMap[item.scene] || ''
          const time = dayLabel && slot ? `${dayLabel} · ${slot}` : dayLabel
          await client.query(`UPDATE production_list_items SET day=$1, time=COALESCE($2, time) WHERE id=$3`, [day, time, item.id])
          dateFixed++
        }
        if (dateFixed) console.log(`[UPLOAD] Auto-fixed dates for ${dateFixed} existing items`)
      }
      if (type === 'scenario' && parsed_content?.scenes) {
        await client.query(
          `UPDATE scenes SET scenario_document_id = $1 WHERE project_id = $2 AND scenario_document_id IS NULL AND updated_at >= NOW() - INTERVAL '5 minutes'`,
          [doc.id, project_id]
        )
      }

    // When scenario uploaded — attach scene texts to existing list items
    if (type === 'scenario' && parsed_content?.scenes) {
      const { textMap: sceneTextMap } = await getSceneLookupMaps(project_id, client)
      console.log(`[UPLOAD] Scene text map: ${Object.keys(sceneTextMap).length} entries`)

      const { rows: allItems } = await client.query(
        `SELECT pli.id, pli.scene, pli.note FROM production_list_items pli
         JOIN production_lists pl ON pl.id = pli.list_id
         WHERE pl.project_id = $1 AND pli.scene IS NOT NULL`,
        [project_id]
      )
      let updated = 0
      for (const item of allItems) {
        if ((item.note || '').includes('\n---\n📝 ')) continue
        const normalizedScene = normalizeSceneId(item.scene) || item.scene
        const scenarioText = sceneTextMap[normalizedScene] || sceneTextMap[item.scene]
        if (!scenarioText) continue
        const existingNote = (item.note || '').trim()
        const separator = existingNote ? '\n---\n' : ''
        const newNote = existingNote + separator + '📝 ' + scenarioText
        await client.query(`UPDATE production_list_items SET note = $1 WHERE id = $2`, [newNote, item.id])
        updated++
      }
      console.log(`[UPLOAD] Updated ${updated} list items with scenario text`)

      // Enqueue AI analysis (always async — no 60s blocking)
      if (process.env.ANTHROPIC_API_KEY) {
        const sceneTexts = parsed_content.scenes.map(s => {
          const id = s.id || s.scene || ''
          const text = s.text || s.synopsis || s.object || ''
          return `Сцена ${id}: ${text.substring(0, 300)}`
        }).join('\n')
        const fullSceneTexts = parsed_content.scenes.map(s => {
          const id = s.id || s.scene || ''
          const text = s.text || s.synopsis || s.object || ''
          return `Сцена ${id}:\n${text.substring(0, 600)}`
        }).join('\n\n')
        const { rows: ei } = await client.query(
          `SELECT DISTINCT LOWER(TRIM(pli.name)) AS name FROM production_list_items pli
           JOIN production_lists pl ON pl.id=pli.list_id WHERE pl.project_id=$1`, [project_id]
        )
        await client.query(`INSERT INTO ai_tasks (project_id, document_id, task_type, params) VALUES ($1,$2,'analyze_scenario',$3)`,
          [project_id, doc.id, JSON.stringify({ seriesNum: dataSeries, sceneTexts: sceneTexts.substring(0, 14000), existingNames: ei.map(r => r.name) })])
        await client.query(`INSERT INTO ai_tasks (project_id, document_id, task_type, params) VALUES ($1,$2,'cross_scenes',$3)`,
          [project_id, doc.id, JSON.stringify({ seriesNum: dataSeries, fullSceneTexts: fullSceneTexts.substring(0, 17000) })])
        console.log(`[AI] Enqueued 2 tasks for async processing`)
      }
    }

    // Auto-import into production lists via pipeline (within transaction)
    if (extractedItems.length && (type === 'kpp' || type === 'scenario')) {
      // Clear old items of same source before re-import (keeps manual items)
      await pipeline.clearOldItems(project_id, type, client)
      const result = await pipeline.importToLists(extractedItems, project_id, client)
      console.log(`[UPLOAD] Auto-import: ${result.imported} imported, ${result.skipped} skipped`)
    }

    // Enqueue synonym expansion (after import, items are in DB)
    if (extractedItems.length && process.env.ANTHROPIC_API_KEY) {
      await client.query(
        `INSERT INTO ai_tasks (project_id, document_id, task_type, params) VALUES ($1,$2,'expand_synonyms',$3)`,
        [project_id, doc.id, JSON.stringify({})]
      )
      console.log(`[AI] Enqueued expand_synonyms task`)
    }

      await client.query('COMMIT')
      console.log(`[UPLOAD] Transaction committed, doc ${doc.id}`)
    } catch (txErr) {
      await client.query('ROLLBACK')
      console.error('[UPLOAD] Transaction rolled back:', txErr.message)
      throw txErr
    } finally {
      client.release()
    }
    // === END TRANSACTION ===

    // Notify project users (fire-and-forget, outside transaction)
    const { rows: projectUsers } = await db.query(
      `SELECT id, role FROM users WHERE project_id=$1`, [project_id]
    )
    const deltaText = delta?.scene_changes
      ? ` — ${(delta.scene_changes.added||[]).length} сцен добавлено, ${(delta.scene_changes.changed||[]).length} изменено`
      : ''
    for (const u of projectUsers) {
      if (NO_NOTIFY_ROLES.includes(u.role)) continue
      await db.query(
        `INSERT INTO notifications (user_id, type, text, entity_id, entity_type)
         VALUES ($1,'new_version',$2,$3,'document')`,
        [u.id, `Новая версия ${type.toUpperCase()} (v${version})${deltaText}`, doc.id]
      )
    }

    res.status(201).json({ document: doc })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Server error' })
  }
})

// GET /documents/all — list docs across all projects (producer only)
router.get('/all', verifyJWT, async (req, res) => {
  if (req.user.role !== 'producer') return res.status(403).json({ error: 'Producer only' })
  const { type } = req.query
  try {
    let q = `
      SELECT d.*, u.name AS uploaded_by_name, p.name AS project_name
      FROM documents d
      LEFT JOIN users u ON u.id = d.uploaded_by
      LEFT JOIN projects p ON p.id = d.project_id
      WHERE 1=1
    `
    const params = []
    if (type) { params.push(type); q += ` AND d.type = $${params.length}` }
    q += ` ORDER BY d.created_at DESC`
    const { rows } = await db.query(q, params)
    res.json({ documents: rows })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Server error' })
  }
})

// GET /documents/:projectId
router.get('/:projectId', verifyJWT, async (req, res) => {
  const { type } = req.query
  const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
  if (!uuidRe.test(req.params.projectId)) return res.status(400).json({ error: 'Invalid project ID' })
  try {
    let q = `
      SELECT d.*, u.name AS uploaded_by_name, g.name AS group_name
      FROM documents d
      LEFT JOIN users u ON u.id = d.uploaded_by
      LEFT JOIN document_groups g ON g.id = d.group_id
      WHERE d.project_id = $1
    `
    const params = [req.params.projectId]
    if (type) { params.push(type); q += ` AND d.type = $${params.length}` }
    q += ` ORDER BY d.type, d.version DESC`

    const { rows } = await db.query(q, params)
    res.json({ documents: rows })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Server error' })
  }
})

// GET /documents/:projectId/view/:id — get full document content for viewer
router.get('/:projectId/view/:id', verifyJWT, async (req, res) => {
  try {
    const { rows } = await db.query(
      `SELECT d.*, u.name AS uploaded_by_name
       FROM documents d
       LEFT JOIN users u ON u.id = d.uploaded_by
       WHERE d.id = $1 AND d.project_id = $2`,
      [req.params.id, req.params.projectId]
    )
    if (!rows.length) return res.status(404).json({ error: 'Document not found' })

    // Fetch all project item names for cross-source highlighting
    const { rows: allItems } = await db.query(
      `SELECT DISTINCT LOWER(TRIM(pli.name)) AS name, pli.scene
       FROM production_list_items pli
       JOIN production_lists pl ON pl.id = pli.list_id
       WHERE pl.project_id = $1`,
      [req.params.projectId]
    )

    // Fetch AI task statuses for this document
    const { rows: aiTasks } = await db.query(
      `SELECT task_type, status, attempts, max_attempts, error FROM ai_tasks
       WHERE document_id = $1 ORDER BY created_at DESC`,
      [req.params.id]
    )

    res.json({ document: rows[0], allProjectItems: allItems, aiTasks })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Server error' })
  }
})

// POST /documents/:id/parse — re-parse existing document
router.post('/:id/parse', verifyJWT, async (req, res) => {
  try {
    const { rows } = await db.query(`SELECT * FROM documents WHERE id=$1`, [req.params.id])
    if (!rows.length) return res.status(404).json({ error: 'Document not found' })
    const doc = rows[0]

    if (!['kpp', 'scenario'].includes(doc.type)) {
      return res.status(400).json({ error: 'Only kpp/scenario can be parsed' })
    }

    const parsed_data = await parseDocument(req.body.text || '')
    await db.query(`UPDATE documents SET parsed_data=$1 WHERE id=$2`, [JSON.stringify(parsed_data), doc.id])

    res.json({ parsed_data })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Server error' })
  }
})

// GET /documents/:id/delta
router.get('/:id/delta', verifyJWT, async (req, res) => {
  try {
    const { rows } = await db.query(`SELECT delta FROM documents WHERE id=$1`, [req.params.id])
    if (!rows.length) return res.status(404).json({ error: 'Document not found' })
    res.json({ delta: rows[0].delta })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Server error' })
  }
})

// GET /lists/:projectId/:role — unit list for a role
router.get('/lists/:projectId/:role', verifyJWT, async (req, res) => {
  const { projectId, role } = req.params

  // ROLE_CATEGORIES imported from roleConfig.js
  const categories = ROLE_CATEGORIES[role] || []

  try {
    const { rows: docs } = await db.query(
      `SELECT parsed_data FROM documents WHERE project_id=$1 AND type IN ('kpp','scenario') ORDER BY version DESC LIMIT 2`,
      [projectId]
    )

    const items = []
    for (const doc of docs) {
      if (!doc.parsed_data) continue
      for (const cat of categories) {
        const catItems = doc.parsed_data[cat] || []
        items.push(...catItems.map(i => ({ ...i, category: cat })))
      }
    }

    const aiSuggestions = []
    for (const doc of docs) {
      if (!doc.parsed_data?.ai_suggestions) continue
      for (const s of doc.parsed_data.ai_suggestions) {
        if (!categories.length || categories.includes(s.category)) {
          aiSuggestions.push(s)
        }
      }
    }

    res.json({ items, ai_suggestions: aiSuggestions })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Server error' })
  }
})

// PUT /lists/:projectId/item — accept/reject AI suggestion, add to list
router.put('/lists/:projectId/item', verifyJWT, async (req, res) => {
  const { item_name, ai_status, list_type, scene, day, qty, note } = req.body
  if (!item_name || !ai_status) return res.status(400).json({ error: 'Missing item_name or ai_status' })

  const projectId = req.params.projectId

  try {
    if (ai_status === 'accepted' && list_type) {
      await db.query(
        `INSERT INTO production_lists (project_id, user_id, type)
         VALUES ($1, $2, $3)
         ON CONFLICT (project_id, user_id, type) DO NOTHING`,
        [projectId, req.user.id, list_type]
      )

      const { rows: listRows } = await db.query(
        `SELECT id FROM production_lists WHERE project_id=$1 AND user_id=$2 AND type=$3`,
        [projectId, req.user.id, list_type]
      )

      if (listRows.length) {
        await db.query(
          `INSERT INTO production_list_items (list_id, name, scene, day, qty, source, note)
           VALUES ($1, $2, $3, $4, $5, 'ai', $6)`,
          [listRows[0].id, item_name, scene || null, day || null, qty || 1, note || null]
        )
      }
    }

    res.json({ ok: true, ai_status })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Server error' })
  }
})

// GET /documents/:projectId/parsed — latest parsed_data
router.get('/:projectId/parsed', verifyJWT, async (req, res) => {
  try {
    const { rows } = await db.query(
      `SELECT parsed_data FROM documents
       WHERE project_id=$1 AND type IN ('kpp','scenario') AND parsed_data IS NOT NULL
       ORDER BY version DESC LIMIT 1`,
      [req.params.projectId]
    )
    if (!rows.length) return res.json({ parsed_data: null })
    res.json({ parsed_data: rows[0].parsed_data })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Server error' })
  }
})

// POST /documents/:id/import — import parsed items into user's production lists
router.post('/:id/import', verifyJWT, async (req, res) => {
  const ownTypes = ROLE_CATEGORIES[req.user.role]
  if (!ownTypes) return res.status(403).json({ error: 'No list access for this role' })

  try {
    const { rows: docRows } = await db.query(`SELECT * FROM documents WHERE id=$1`, [req.params.id])
    if (!docRows.length) return res.status(404).json({ error: 'Document not found' })
    const doc = docRows[0]
    if (!doc.parsed_data) return res.status(400).json({ error: 'Document not parsed yet' })

    const projectId = doc.project_id
    let imported = 0

    for (const type of ownTypes) {
      const items = doc.parsed_data[type] || []
      if (!items.length) continue

      await db.query(
        `INSERT INTO production_lists (project_id, user_id, type)
         VALUES ($1,$2,$3) ON CONFLICT (project_id,user_id,type) DO NOTHING`,
        [projectId, req.user.id, type]
      )
      const { rows: listRows } = await db.query(
        `SELECT id FROM production_lists WHERE project_id=$1 AND user_id=$2 AND type=$3`,
        [projectId, req.user.id, type]
      )
      const listId = listRows[0].id

      for (const item of items) {
        const { rows: exists } = await db.query(
          `SELECT id FROM production_list_items WHERE list_id=$1 AND name=$2`,
          [listId, item.name]
        )
        if (exists.length) continue

        await db.query(
          `INSERT INTO production_list_items (list_id, name, scene, day, time, location, qty, source, note, ai_status)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
          [listId, item.name, item.scene||null, item.day||null, item.time||null,
           item.location||null, item.qty||1, item.source||'kpp', item.note||null,
           item.source==='ai' ? 'pending' : null]
        )
        imported++
      }
    }

    res.json({ ok: true, imported })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Server error' })
  }
})

// Compute scene-level delta between two versions
function computeSceneDelta(oldScenes, newScenes) {
  const delta = { added: [], changed: [], removed: [] }
  const oldMap = {}
  for (const s of (oldScenes || [])) oldMap[s.id] = s
  const newMap = {}
  for (const s of (newScenes || [])) newMap[s.id] = s

  for (const id of Object.keys(newMap)) {
    if (!oldMap[id]) {
      delta.added.push({ id, object: newMap[id].object, props: newMap[id].props, costumes: newMap[id].costumes })
    } else {
      const changes = []
      const o = oldMap[id], n = newMap[id]
      if (JSON.stringify(o.props) !== JSON.stringify(n.props)) changes.push({ field: 'props', old: o.props, new: n.props })
      if (JSON.stringify(o.costumes) !== JSON.stringify(n.costumes)) changes.push({ field: 'costumes', old: o.costumes, new: n.costumes })
      if (JSON.stringify(o.characters) !== JSON.stringify(n.characters)) changes.push({ field: 'characters', old: o.characters, new: n.characters })
      if (o.object !== n.object) changes.push({ field: 'object', old: o.object, new: n.object })
      if (changes.length) delta.changed.push({ id, object: n.object, changes })
    }
  }

  for (const id of Object.keys(oldMap)) {
    if (!newMap[id]) delta.removed.push({ id, object: oldMap[id].object })
  }

  return delta
}

// DELETE /documents/:id — delete a single document and its list items
router.delete('/:id', verifyJWT, async (req, res) => {
  if (req.user.role !== 'producer') return res.status(403).json({ error: 'Producer only' })
  try {
    const { rows } = await db.query(`SELECT id, project_id, type FROM documents WHERE id = $1`, [req.params.id])
    if (!rows.length) return res.status(404).json({ error: 'Not found' })
    const doc = rows[0]

    // Delete list items that came from this document (by matching source and project)
    await db.query(
      `DELETE FROM production_list_items WHERE list_id IN (
        SELECT id FROM production_lists WHERE project_id = $1
      ) AND source = $2`,
      [doc.project_id, doc.type === 'kpp' ? 'kpp' : doc.type === 'scenario' ? 'scenario' : 'manual']
    )

    // Also delete AI items if scenario
    if (doc.type === 'scenario') {
      await db.query(
        `DELETE FROM production_list_items WHERE list_id IN (
          SELECT id FROM production_lists WHERE project_id = $1
        ) AND source = 'ai'`,
        [doc.project_id]
      )
    }

    await db.query(`DELETE FROM documents WHERE id = $1`, [req.params.id])
    res.json({ ok: true })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Server error' })
  }
})

// ============================================================
// Document Groups (Blocks) CRUD
// ============================================================

// GET /documents/groups/:projectId — list groups for a project
router.get('/groups/:projectId', verifyJWT, async (req, res) => {
  try {
    const { rows } = await db.query(
      `SELECT g.*,
              (SELECT COUNT(*) FROM documents d WHERE d.group_id = g.id) AS doc_count
       FROM document_groups g
       WHERE g.project_id = $1
       ORDER BY g.sort_order, g.created_at`,
      [req.params.projectId]
    )
    res.json({ groups: rows })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Server error' })
  }
})

// POST /documents/groups — create a group
router.post('/groups', verifyJWT, async (req, res) => {
  if (!['producer', 'project_director'].includes(req.user.role))
    return res.status(403).json({ error: 'Only producer/project_director' })
  const { project_id, name } = req.body
  if (!project_id || !name?.trim()) return res.status(400).json({ error: 'Missing project_id or name' })
  try {
    const { rows: maxSort } = await db.query(
      `SELECT COALESCE(MAX(sort_order), 0) + 1 AS next FROM document_groups WHERE project_id = $1`, [project_id])
    const { rows } = await db.query(
      `INSERT INTO document_groups (project_id, name, sort_order) VALUES ($1, $2, $3) RETURNING *`,
      [project_id, name.trim(), maxSort[0].next]
    )
    res.status(201).json({ group: rows[0] })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Server error' })
  }
})

// PATCH /documents/groups/:id — update a group
router.patch('/groups/:id', verifyJWT, async (req, res) => {
  if (!['producer', 'project_director'].includes(req.user.role))
    return res.status(403).json({ error: 'Only producer/project_director' })
  const { name, sort_order } = req.body
  try {
    const { rows } = await db.query(
      `UPDATE document_groups SET name = COALESCE($1, name), sort_order = COALESCE($2, sort_order) WHERE id = $3 RETURNING *`,
      [name || null, sort_order ?? null, req.params.id]
    )
    if (!rows.length) return res.status(404).json({ error: 'Not found' })
    res.json({ group: rows[0] })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Server error' })
  }
})

// DELETE /documents/groups/:id — delete a group (unlinks documents, doesn't delete them)
router.delete('/groups/:id', verifyJWT, async (req, res) => {
  if (!['producer', 'project_director'].includes(req.user.role))
    return res.status(403).json({ error: 'Only producer/project_director' })
  try {
    await db.query(`UPDATE documents SET group_id = NULL WHERE group_id = $1`, [req.params.id])
    await db.query(`DELETE FROM document_groups WHERE id = $1`, [req.params.id])
    res.json({ ok: true })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Server error' })
  }
})

// PATCH /documents/:id/group — assign document to a group
router.patch('/:id/group', verifyJWT, async (req, res) => {
  if (!['producer', 'project_director'].includes(req.user.role))
    return res.status(403).json({ error: 'Only producer/project_director' })
  const { group_id } = req.body
  try {
    const { rows } = await db.query(
      `UPDATE documents SET group_id = $1 WHERE id = $2 RETURNING id, group_id`,
      [group_id || null, req.params.id]
    )
    if (!rows.length) return res.status(404).json({ error: 'Not found' })
    res.json({ ok: true, document: rows[0] })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Server error' })
  }
})

module.exports = router
