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

// Role → list types mapping for auto-import
const ROLE_LIST_TYPES = {
  production_designer:      ['props','art_fill','dummy','auto','decoration','costumes','makeup','stunts','pyrotechnics'],
  art_director_assistant:   ['props','art_fill','dummy','auto','decoration','costumes','makeup','stunts','pyrotechnics'],
  first_assistant_director: ['props','art_fill','dummy','auto','decoration','costumes','makeup','stunts','pyrotechnics'],
  props_master:             ['props','art_fill','dummy','auto','costumes'],
  props_assistant:        ['props','art_fill','dummy','auto','costumes'],
  decorator:              ['decoration','props','art_fill','dummy'],
  costumer:               ['costumes'],
  costume_assistant:      ['costumes'],
  makeup_artist:          ['makeup'],
  stunt_coordinator:      ['stunts'],
  pyrotechnician:         ['pyrotechnics'],
}

// Roles that can upload
const UPLOAD_KPP_ROLES = [
  'producer', 'project_director', 'project_deputy_upload', 'director', 'assistant_director',
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

    // Auto-import from parsed_content (direct from Excel/DOCX — no AI needed)
    // This is fast because data is already extracted by the parser
    const ALL_LIST_TYPES = ['props','art_fill','dummy','auto','decoration','costumes','makeup','stunts','pyrotechnics']
    const CATEGORY_MAP_IMPORT = {
      props: 'props', costumes: 'costumes', makeup: 'makeup',
      vehicles: 'auto', stunts: 'stunts',
    }

    // Build parsed_data from scenes (no AI call — direct extraction)
    let parsed_data = null
    if (type !== 'callsheet' && parsed_content?.scenes) {
      // Map scene → shoot date from shoot_days
      const sceneDateMap = {}
      for (const sd of (parsed_content.shoot_days || [])) {
        for (const sid of (sd.scenes || [])) {
          sceneDateMap[sid] = sd.date || ''
        }
      }

      parsed_data = { props: [], costumes: [], makeup: [], auto: [], stunts: [], decoration: [], pyrotechnics: [], art_fill: [], dummy: [] }
      const seen = {}
      for (const s of parsed_content.scenes) {
        const shootDate = sceneDateMap[s.id] || ''
        const sceneText = s.object || s.synopsis || ''
        for (const [field, cat] of Object.entries(CATEGORY_MAP_IMPORT)) {
          for (const item of (s[field] || [])) {
            const name = (item || '').replace(/\s+/g, ' ').trim()
            if (!name || seen[cat + ':' + name.toLowerCase()]) continue
            seen[cat + ':' + name.toLowerCase()] = true
            parsed_data[cat].push({
              name, scene: s.id, day: shootDate, source: type,
              time: `СД ${s.day || '?'}`,
              location: s.location || '',
              note: sceneText,
            })
          }
        }
      }
      console.log(`[UPLOAD] Extracted items: ${Object.entries(parsed_data).map(([k,v]) => `${k}:${v.length}`).join(', ')}`)
    }

    // Save document with extracted data
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
    console.log(`[UPLOAD] Saved doc ${doc.id}`)

    // When scenario uploaded — attach scene texts to existing list items
    if (type === 'scenario' && parsed_content?.scenes) {
      // Extract series number: 1) from filename, 2) from KPP scene IDs in DB
      const fnLower = (req.file.originalname || '').toLowerCase()
      const seriesMatch = fnLower.match(/(\d{1,2})\s*сер/) || fnLower.match(/сер[а-я]*\s*(\d{1,2})/) || fnLower.match(/^(\d{1,2})[._\s-]/)
      let seriesNum = seriesMatch ? seriesMatch[1].padStart(2, '0') : ''

      // Fallback: get series number from existing KPP list items (e.g. scene "46-38" → series "46")
      if (!seriesNum) {
        const { rows: kppItems } = await db.query(
          `SELECT DISTINCT pli.scene FROM production_list_items pli
           JOIN production_lists pl ON pl.id = pli.list_id
           WHERE pl.project_id = $1 AND pli.scene IS NOT NULL AND pli.scene LIKE '%-%'
           LIMIT 1`,
          [project_id]
        )
        if (kppItems.length) {
          const m = kppItems[0].scene.match(/^(\d+)-/)
          if (m) seriesNum = m[1].padStart(2, '0')
        }
      }
      console.log(`[UPLOAD] Scenario series: "${seriesNum}" from "${req.file.originalname}"`)

      // Build map: multiple key formats for reliable matching
      const sceneTextMap = {}
      for (const s of parsed_content.scenes) {
        const rawId = (s.id || s.scene || '').replace(/^0+/, '')
        const text = s.text || s.synopsis || s.object || ''
        if (!rawId || !text) continue
        // Key formats: "46-38", "46-038", "38" (raw)
        if (seriesNum) {
          sceneTextMap[`${seriesNum}-${rawId}`] = text
          sceneTextMap[`${parseInt(seriesNum)}-${rawId}`] = text
          sceneTextMap[`${seriesNum}-${String(rawId).padStart(2, '0')}`] = text
        }
        sceneTextMap[rawId] = text
      }
      console.log(`[UPLOAD] Scene text map: ${Object.keys(sceneTextMap).length} entries`)

      // Update existing list items that have matching scene IDs
      const { rows: allItems } = await db.query(
        `SELECT pli.id, pli.scene, pli.note FROM production_list_items pli
         JOIN production_lists pl ON pl.id = pli.list_id
         WHERE pl.project_id = $1 AND pli.scene IS NOT NULL`,
        [project_id]
      )
      let updated = 0
      for (const item of allItems) {
        if ((item.note || '').includes('\n---\n')) continue // already has scenario text
        const scenarioText = sceneTextMap[item.scene] || sceneTextMap[item.scene.replace(/^0+/, '')]
        if (!scenarioText) continue
        const existingNote = (item.note || '').trim()
        const separator = existingNote ? '\n---\n' : ''
        const newNote = existingNote + separator + '📝 ' + scenarioText.substring(0, 500)
        await db.query(`UPDATE production_list_items SET note = $1 WHERE id = $2`, [newNote, item.id])
        updated++
      }
      console.log(`[UPLOAD] Updated ${updated} list items with scenario text`)

      // AI analysis: synchronous with 60s timeout (serverless freezes after response)
      if (process.env.ANTHROPIC_API_KEY) {
        try {
          console.log(`[AI] Starting scenario analysis`)
          const sceneTexts = parsed_content.scenes.map(s => {
            const id = s.id || s.scene || ''
            const text = s.text || s.synopsis || s.object || ''
            const props = (s.props || []).join(', ')
            const costumes = (s.costumes || []).join(', ')
            const makeup = (s.makeup || []).join(', ')
            return `Сцена ${id}: ${text.substring(0, 200)} | Реквизит: ${props} | Костюмы: ${costumes} | Грим: ${makeup}`
          }).join('\n')

          const aiPromise = require('../services/groq').parseDocument(sceneTexts)
          const timeout = new Promise((_, reject) => setTimeout(() => reject(new Error('AI timeout 60s')), 60000))
          const aiResult = await Promise.race([aiPromise, timeout])

          if (aiResult) {
            const { rows: members } = await db.query(`SELECT id, role FROM users WHERE project_id=$1`, [project_id])
            let aiImported = 0
            for (const cat of ALL_LIST_TYPES) {
              for (const ai of (aiResult[cat] || [])) {
                const aiName = (ai.name || ai.item || '').replace(/\s+/g, ' ').trim()
                if (!aiName) continue
                for (const m of members) {
                  const own = ['producer','project_director'].includes(m.role) ? ALL_LIST_TYPES : (ROLE_LIST_TYPES[m.role] || [])
                  if (!own.includes(cat)) continue
                  await db.query(`INSERT INTO production_lists (project_id, user_id, type) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING`, [project_id, m.id, cat])
                  const { rows: lr } = await db.query(`SELECT id FROM production_lists WHERE project_id=$1 AND user_id=$2 AND type=$3`, [project_id, m.id, cat])
                  const { rows: ex } = await db.query(`SELECT id FROM production_list_items WHERE list_id=$1 AND LOWER(TRIM(name))=LOWER($2)`, [lr[0].id, aiName.toLowerCase()])
                  if (ex.length) continue
                  const sceneId = seriesNum ? `${parseInt(seriesNum)}-${(ai.scene||'').replace(/^0+/,'')}` : (ai.scene || null)
                  await db.query(`INSERT INTO production_list_items (list_id, name, scene, day, time, location, qty, source, note) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
                    [lr[0].id, aiName, sceneId, ai.day||null, ai.time||null, ai.location||null, 1, 'ai', ai.note||null])
                  aiImported++
                }
              }
            }
            for (const sug of (aiResult.ai_suggestions || [])) {
              const sugName = (sug.item || '').replace(/\s+/g, ' ').trim()
              const sugCat = sug.category || 'props'
              if (!sugName) continue
              for (const m of members) {
                const own = ['producer','project_director'].includes(m.role) ? ALL_LIST_TYPES : (ROLE_LIST_TYPES[m.role] || [])
                if (!own.includes(sugCat)) continue
                await db.query(`INSERT INTO production_lists (project_id, user_id, type) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING`, [project_id, m.id, sugCat])
                const { rows: lr } = await db.query(`SELECT id FROM production_lists WHERE project_id=$1 AND user_id=$2 AND type=$3`, [project_id, m.id, sugCat])
                const { rows: ex } = await db.query(`SELECT id FROM production_list_items WHERE list_id=$1 AND LOWER(TRIM(name))=LOWER($2)`, [lr[0].id, sugName.toLowerCase()])
                if (ex.length) continue
                await db.query(`INSERT INTO production_list_items (list_id, name, scene, qty, source, note) VALUES ($1,$2,$3,$4,$5,$6)`,
                  [lr[0].id, sugName, null, 1, 'ai', sug.reason||null])
                aiImported++
              }
            }
            console.log(`[AI] Imported ${aiImported} new items from scenario`)
          }
        } catch (aiErr) {
          console.error('[AI] Scenario analysis error:', aiErr.message)
        }
      }
    }

    // Auto-import into production lists for all project users
    if (parsed_data && (type === 'kpp' || type === 'scenario')) {
      const { rows: projectMembers } = await db.query(
        `SELECT id, role FROM users WHERE project_id=$1`, [project_id]
      )
      for (const member of projectMembers) {
        const isFullAccess = ['producer', 'project_director'].includes(member.role)
        const ownTypes = isFullAccess ? ALL_LIST_TYPES : (ROLE_LIST_TYPES[member.role] || [])
        if (!ownTypes.length) continue
        for (const listType of ownTypes) {
          const items = parsed_data[listType] || []
          if (!items.length) continue
          await db.query(
            `INSERT INTO production_lists (project_id, user_id, type) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING`,
            [project_id, member.id, listType]
          )
          const { rows: lr } = await db.query(
            `SELECT id FROM production_lists WHERE project_id=$1 AND user_id=$2 AND type=$3`,
            [project_id, member.id, listType]
          )
          for (const item of items) {
            const normalizedName = (item.name || '').replace(/\s+/g, ' ').trim()
            if (!normalizedName) continue
            const { rows: ex } = await db.query(
              `SELECT id FROM production_list_items WHERE list_id=$1 AND LOWER(TRIM(name))=LOWER($2) AND COALESCE(scene,'')=$3`,
              [lr[0].id, normalizedName.toLowerCase(), item.scene || '']
            )
            if (ex.length) continue
            await db.query(
              `INSERT INTO production_list_items (list_id, name, scene, day, time, location, qty, source, note)
               VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
              [lr[0].id, normalizedName, item.scene||null, item.day||null, item.time||null,
               item.location||null, 1, item.source||type, item.note||null]
            )
          }
        }
      }
      console.log(`[UPLOAD] Auto-import done`)
    }

    // Notify project users
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
