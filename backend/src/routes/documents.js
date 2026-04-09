const router   = require('express').Router()
const multer   = require('multer')
const db       = require('../db')
const { verifyJWT } = require('../middleware/auth')
const { parseDocumentFile } = require('../services/docParser')
const { matchUnits } = require('../services/unitMatcher')
const { parseDocument, computeDelta } = require('../services/groq')

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

// Roles that can upload
const UPLOAD_KPP_ROLES = [
  'project_director', 'project_deputy_upload', 'director', 'assistant_director',
  'production_designer', 'art_director_assistant',
  'props_master', 'props_assistant', 'decorator', 'costumer', 'costume_assistant',
  'makeup_artist', 'stunt_coordinator', 'pyrotechnician',
]
const UPLOAD_CALLSHEET_ROLES = [
  ...UPLOAD_KPP_ROLES, 'set_admin',
]

// Roles that get notified on new version (everyone except drivers, camera mechanics, playback)
const NO_NOTIFY_ROLES = ['driver', 'camera_mechanic', 'playback']

// POST /documents/upload
router.post('/upload', verifyJWT, upload.single('file'), async (req, res) => {
  const { project_id, type } = req.body
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
    // Get latest version for this project+type
    const { rows: latest } = await db.query(
      `SELECT * FROM documents WHERE project_id=$1 AND type=$2 ORDER BY version DESC LIMIT 1`,
      [project_id, type]
    )
    const version = latest.length ? latest[0].version + 1 : 1

    // Parse document (xlsx/docx → JSON)
    let parsed_content = null
    try {
      parsed_content = await parseDocumentFile(req.file.buffer, req.file.originalname, type)
    } catch (err) {
      console.error('Document parse error:', err.message)
      return res.status(400).json({ error: `Ошибка парсинга: ${err.message}` })
    }

    // Match props/costumes against warehouse units (kpp and scenario only)
    let matched_units = null
    if (type !== 'callsheet' && parsed_content) {
      try {
        matched_units = await matchUnits(parsed_content, project_id)
      } catch (err) {
        console.error('Unit matching error:', err.message)
      }
    }

    // Compute deltas and AI parsing (kpp and scenario only)
    let delta = null
    let parsed_data = null
    if (type !== 'callsheet' && parsed_content) {
      // Build rich text for Groq AI analysis
      try {
        const allText = parsed_content.scenes.map(s => {
          let t = `Сцена ${s.id}. ${s.int_nat || ''} ${s.object}. ${s.mode || ''}. СД ${s.day}`
          if (s.synopsis) t += `\nСинопсис: ${s.synopsis}`
          if (s.text) t += `\n${s.text.substring(0, 300)}`
          if (s.characters?.length) t += `\nПерсонажи: ${s.characters.join(', ')}`
          if (s.props?.length) t += `\nРеквизит: ${s.props.join(', ')}`
          if (s.costumes?.length) t += `\nКостюм: ${s.costumes.join(', ')}`
          if (s.makeup?.length) t += `\nГрим: ${s.makeup.join(', ')}`
          if (s.vehicles?.length) t += `\nИгровой транспорт: ${s.vehicles.join(', ')}`
          if (s.extras) t += `\nМассовка: ${s.extras}`
          return t
        }).join('\n\n')

        parsed_data = await parseDocument(allText.slice(0, 12000))

        // Groq-level delta (for production lists categories)
        if (latest.length && latest[0].parsed_data) {
          delta = computeDelta(latest[0].parsed_data, parsed_data)
        }
      } catch (err) {
        console.error('Groq parse error:', err.message)
      }

      // Scene-level delta (for document viewer) — merge with Groq delta
      if (latest.length && latest[0].parsed_content?.scenes) {
        const sceneDelta = computeSceneDelta(latest[0].parsed_content.scenes, parsed_content.scenes)
        if (delta) {
          delta.scene_changes = sceneDelta
        } else {
          delta = { scene_changes: sceneDelta }
        }
      }
    }

    const { rows } = await db.query(
      `INSERT INTO documents (project_id, type, version, file_url, parsed_data, parsed_content, matched_units, delta, uploaded_by, original_name, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
      [project_id, type, version, null,
       parsed_data ? JSON.stringify(parsed_data) : null,
       parsed_content ? JSON.stringify(parsed_content) : null,
       matched_units ? JSON.stringify(matched_units) : null,
       delta ? JSON.stringify(delta) : null,
       req.user.id, req.file.originalname,
       parsed_content ? 'parsed' : 'uploaded']
    )
    const doc = rows[0]

    // Notify all project users (except no-notify roles)
    const { rows: projectUsers } = await db.query(
      `SELECT id, role FROM users WHERE project_id=$1`, [project_id]
    )
    for (const u of projectUsers) {
      if (NO_NOTIFY_ROLES.includes(u.role)) continue
      await db.query(
        `INSERT INTO notifications (user_id, type, text, entity_id, entity_type)
         VALUES ($1,'new_version',$2,$3,'document')`,
        [u.id, `Новая версия ${type.toUpperCase()} (v${version}) — загружено ${new Date().toLocaleDateString('ru-RU')}`, doc.id]
      )
    }

    res.status(201).json({ document: doc })
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
      SELECT d.*, u.name AS uploaded_by_name
      FROM documents d
      LEFT JOIN users u ON u.id = d.uploaded_by
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
    res.json({ document: rows[0] })
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

  const ROLE_CATEGORIES = {
    props_master:           ['props', 'auto', 'costumes'],
    props_assistant:        ['props', 'auto', 'costumes'],
    decorator:              ['decoration', 'props'],
    costumer:               ['costumes'],
    costume_assistant:      ['costumes'],
    makeup_artist:          ['makeup'],
    stunt_coordinator:      ['stunts'],
    pyrotechnician:         ['pyrotechnics'],
    production_designer:    ['props', 'costumes', 'decoration', 'makeup', 'stunts', 'pyrotechnics', 'auto'],
    art_director_assistant: ['props', 'costumes', 'decoration', 'makeup', 'stunts', 'pyrotechnics', 'auto'],
  }

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
const ROLE_OWN_LISTS = {
  production_designer:    ['props','art_fill','dummy','auto','decoration','costumes','makeup','stunts','pyrotechnics'],
  art_director_assistant: ['props','art_fill','dummy','auto','decoration','costumes','makeup','stunts','pyrotechnics'],
  props_master:           ['props','art_fill','dummy','auto','costumes'],
  props_assistant:        ['props','art_fill','dummy','auto','costumes'],
  decorator:              ['decoration','props','art_fill','dummy'],
  costumer:               ['costumes'],
  costume_assistant:      ['costumes'],
  makeup_artist:          ['makeup'],
  stunt_coordinator:      ['stunts'],
  pyrotechnician:         ['pyrotechnics'],
}

router.post('/:id/import', verifyJWT, async (req, res) => {
  const ownTypes = ROLE_OWN_LISTS[req.user.role]
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

module.exports = router
