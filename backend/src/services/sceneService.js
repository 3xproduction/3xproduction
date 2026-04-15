const db = require('../db')

/**
 * Normalize scene ID to canonical format: "{series}-{sceneNumber}" with no leading zeros.
 * This is the SINGLE normalization function — all scene ID normalization MUST go through here.
 * Do NOT use inline regex replacements elsewhere.
 *
 * Examples:
 *   normalizeSceneId("022", 46)     → "46-22"
 *   normalizeSceneId("46-022")      → "46-22"
 *   normalizeSceneId("46-0022")     → "46-22"
 *   normalizeSceneId("5", 46)       → "46-5"
 *   normalizeSceneId("46-5")        → "46-5"
 *   normalizeSceneId("022")         → "22"
 *   normalizeSceneId("01-15")       → "1-15"
 *   normalizeSceneId(null)          → null
 *   normalizeSceneId("abc")         → null
 *   normalizeSceneId("46-22.", 46)  → "46-22" (trailing dot stripped)
 */
function normalizeSceneId(rawId, series) {
  if (!rawId && rawId !== 0) return null
  const raw = String(rawId).trim().replace(/\.$/, '') // strip trailing dot from KPP
  if (!raw) return null

  // Format: "46-022", "46-0022", "1-15"
  const hyphenMatch = raw.match(/^(\d+)\s*-\s*0*(\d+)$/)
  if (hyphenMatch) {
    const s = parseInt(hyphenMatch[1])
    const n = parseInt(hyphenMatch[2])
    return n ? `${s}-${n}` : null
  }

  // Just scene number: "022", "5", "0022"
  const sceneNum = parseInt(raw.replace(/^0+/, '') || '0')
  if (!sceneNum) return null

  if (series) {
    const s = parseInt(series)
    return s ? `${s}-${sceneNum}` : String(sceneNum)
  }
  return String(sceneNum)
}

/**
 * Extract series number from filename.
 * Looks for patterns like "46 серия", "сер 46", "46_сер", or leading "46." / "46-"
 */
function extractSeriesFromFilename(filename) {
  if (!filename) return ''
  const fn = filename.toLowerCase()
  const m = fn.match(/(\d{1,2})\s*сер/) || fn.match(/сер[а-я]*\s*(\d{1,2})/) || fn.match(/^(\d{1,2})[._\s-]/)
  return m ? m[1].padStart(2, '0') : ''
}

/**
 * Upsert scenes from КПП document into the canonical scenes table.
 * Only updates КПП-related fields; scenario_text is left untouched.
 */
async function upsertScenesFromKpp(projectId, parsedContent, documentId) {
  if (!parsedContent?.scenes) return 0

  // Build shoot_day → date/day_number map
  const dayMap = {}
  for (const sd of (parsedContent.shoot_days || [])) {
    for (const sid of (sd.scenes || [])) {
      dayMap[sid] = { date: sd.date || null, day_number: sd.day_number || null, shift: sd.shift || '' }
    }
  }

  let count = 0
  for (const s of parsedContent.scenes) {
    const canonicalId = normalizeSceneId(s.id)
    if (!canonicalId) continue

    const parts = canonicalId.split('-')
    const series = parts.length > 1 ? parseInt(parts[0]) : null
    const sceneNumber = parseInt(parts[parts.length - 1])

    const dayInfo = dayMap[s.id] || {}

    await db.query(`
      INSERT INTO scenes (project_id, series, scene_number, canonical_id,
        date, day_number, time_slot, duration, mode, int_nat,
        object, synopsis, location, platform, characters, extras, notes,
        kpp_document_id, updated_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,NOW())
      ON CONFLICT (project_id, canonical_id) DO UPDATE SET
        date = COALESCE(EXCLUDED.date, scenes.date),
        day_number = COALESCE(EXCLUDED.day_number, scenes.day_number),
        time_slot = COALESCE(EXCLUDED.time_slot, scenes.time_slot),
        duration = COALESCE(EXCLUDED.duration, scenes.duration),
        mode = COALESCE(EXCLUDED.mode, scenes.mode),
        int_nat = COALESCE(EXCLUDED.int_nat, scenes.int_nat),
        object = COALESCE(EXCLUDED.object, scenes.object),
        synopsis = COALESCE(EXCLUDED.synopsis, scenes.synopsis),
        location = COALESCE(EXCLUDED.location, scenes.location),
        platform = COALESCE(EXCLUDED.platform, scenes.platform),
        characters = COALESCE(EXCLUDED.characters, scenes.characters),
        extras = COALESCE(EXCLUDED.extras, scenes.extras),
        notes = COALESCE(EXCLUDED.notes, scenes.notes),
        kpp_document_id = EXCLUDED.kpp_document_id,
        updated_at = NOW()
    `, [
      projectId, series, sceneNumber, canonicalId,
      dayInfo.date || null, dayInfo.day_number || null,
      s.time_slot || null, s.duration || null,
      s.mode || null, s.int_nat || null,
      s.object || null, s.synopsis || null,
      s.location || null, s.platform || null,
      s.characters?.length ? s.characters : null,
      s.extras || null, s.notes || null,
      documentId,
    ])
    count++
  }
  return count
}

/**
 * Upsert scenes from Сценарий document into the canonical scenes table.
 * Only updates scenario_text; КПП fields are left untouched.
 */
async function upsertScenesFromScenario(projectId, parsedContent, documentId, seriesNum) {
  if (!parsedContent?.scenes) return 0

  const series = seriesNum ? parseInt(seriesNum) : null
  let count = 0

  for (const s of parsedContent.scenes) {
    const rawId = (s.id || s.scene || '').replace(/^0+/, '')
    const canonicalId = normalizeSceneId(rawId, series)
    if (!canonicalId) continue

    const parts = canonicalId.split('-')
    const seriesVal = parts.length > 1 ? parseInt(parts[0]) : series
    const sceneNumber = parseInt(parts[parts.length - 1])
    const text = s.text || s.synopsis || s.object || ''

    // Also upsert КПП-like fields from scenario if they exist and scenes table doesn't have them yet
    await db.query(`
      INSERT INTO scenes (project_id, series, scene_number, canonical_id,
        scenario_text, scenario_document_id,
        mode, int_nat, object, location, characters, extras,
        updated_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,NOW())
      ON CONFLICT (project_id, canonical_id) DO UPDATE SET
        scenario_text = EXCLUDED.scenario_text,
        scenario_document_id = EXCLUDED.scenario_document_id,
        mode = COALESCE(scenes.mode, EXCLUDED.mode),
        int_nat = COALESCE(scenes.int_nat, EXCLUDED.int_nat),
        object = COALESCE(scenes.object, EXCLUDED.object),
        location = COALESCE(scenes.location, EXCLUDED.location),
        characters = COALESCE(scenes.characters, EXCLUDED.characters),
        extras = COALESCE(scenes.extras, EXCLUDED.extras),
        updated_at = NOW()
    `, [
      projectId, seriesVal, sceneNumber, canonicalId,
      text || null, documentId,
      s.mode || null, s.int_nat || null,
      s.object || null, s.location || null,
      s.characters?.length ? s.characters : null,
      s.extras || null,
    ])
    count++
  }
  return count
}

/**
 * Get lookup maps from the scenes table for a project.
 * Falls back to reading from KPP parsed_content if scenes table is empty.
 */
async function getSceneLookupMaps(projectId, client) {
  const q = client || db
  const { rows } = await q.query(
    `SELECT canonical_id, date, day_number, time_slot, scenario_text
     FROM scenes WHERE project_id = $1`,
    [projectId]
  )

  const dateMap = {}
  const timeMap = {}
  const slotMap = {}
  const textMap = {}

  for (const r of rows) {
    const cid = r.canonical_id
    if (r.date) dateMap[cid] = r.date
    if (r.day_number) timeMap[cid] = `СД ${r.day_number}`
    if (r.time_slot) slotMap[cid] = r.time_slot
    if (r.scenario_text) textMap[cid] = r.scenario_text
  }

  // FALLBACK: if scenes table is empty, read directly from latest KPP parsed_content
  if (!Object.keys(dateMap).length) {
    const { rows: kd } = await q.query(
      `SELECT parsed_content FROM documents WHERE project_id=$1 AND type='kpp' AND parsed_content IS NOT NULL ORDER BY version DESC LIMIT 1`,
      [projectId]
    )
    if (kd.length) {
      const pc = typeof kd[0].parsed_content === 'string' ? JSON.parse(kd[0].parsed_content) : kd[0].parsed_content
      if (pc?.shoot_days) {
        for (const sd of pc.shoot_days) {
          for (const sid of (sd.scenes || [])) {
            dateMap[sid] = sd.date || ''
            if (sd.day_number) timeMap[sid] = `СД ${sd.day_number}`
          }
        }
      }
      if (pc?.scenes) {
        for (const sc of pc.scenes) {
          if (sc.id && sc.time_slot) slotMap[sc.id] = sc.time_slot
        }
      }
    }
    // Also read scenario texts from latest scenario document
    const { rows: sd } = await q.query(
      `SELECT parsed_content, original_name FROM documents WHERE project_id=$1 AND type='scenario' AND parsed_content IS NOT NULL ORDER BY version DESC LIMIT 1`,
      [projectId]
    )
    if (sd.length) {
      const spc = typeof sd[0].parsed_content === 'string' ? JSON.parse(sd[0].parsed_content) : sd[0].parsed_content
      const seriesNum = extractSeriesFromFilename(sd[0].original_name)
      for (const s of (spc?.scenes || [])) {
        const rawId = (s.id || s.scene || '').replace(/^0+/, '')
        const text = s.text || s.synopsis || s.object || ''
        if (!rawId || !text) continue
        if (seriesNum) {
          const sn = parseInt(seriesNum)
          textMap[`${sn}-${rawId}`] = text
        }
        textMap[rawId] = text
      }
    }
  }

  return { dateMap, timeMap, slotMap, textMap }
}

/**
 * Get series number for a project.
 * Checks: 1) scenes table, 2) production_list_items, 3) KPP parsed_content
 */
async function getProjectSeries(projectId) {
  // Try scenes table first
  const { rows } = await db.query(
    `SELECT DISTINCT series FROM scenes WHERE project_id = $1 AND series IS NOT NULL LIMIT 1`,
    [projectId]
  )
  if (rows.length) return String(rows[0].series).padStart(2, '0')

  // Fallback: extract from existing production_list_items scene IDs (e.g. "46-22" → 46)
  const { rows: items } = await db.query(
    `SELECT DISTINCT pli.scene FROM production_list_items pli
     JOIN production_lists pl ON pl.id = pli.list_id
     WHERE pl.project_id = $1 AND pli.scene IS NOT NULL AND pli.scene LIKE '%-%'
     LIMIT 1`,
    [projectId]
  )
  if (items.length) {
    const m = items[0].scene.match(/^(\d+)-/)
    if (m) return m[1].padStart(2, '0')
  }

  // Fallback: extract from KPP parsed_content scene IDs
  const { rows: kd } = await db.query(
    `SELECT parsed_content FROM documents WHERE project_id=$1 AND type='kpp' AND parsed_content IS NOT NULL ORDER BY version DESC LIMIT 1`,
    [projectId]
  )
  if (kd.length) {
    const pc = typeof kd[0].parsed_content === 'string' ? JSON.parse(kd[0].parsed_content) : kd[0].parsed_content
    if (pc?.scenes?.length) {
      const m = (pc.scenes[0].id || '').match(/^(\d+)-/)
      if (m) return m[1].padStart(2, '0')
    }
  }

  return ''
}

module.exports = {
  normalizeSceneId,
  extractSeriesFromFilename,
  upsertScenesFromKpp,
  upsertScenesFromScenario,
  getSceneLookupMaps,
  getProjectSeries,
}
