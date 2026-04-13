const db = require('../db')

/**
 * Normalize scene ID to canonical format: "{series}-{sceneNumber}" with no leading zeros.
 * Examples:
 *   normalizeSceneId("022", 46) → "46-22"
 *   normalizeSceneId("46-022") → "46-22"
 *   normalizeSceneId("5", 46) → "46-5"
 *   normalizeSceneId("46-5") → "46-5"
 */
function normalizeSceneId(rawId, series) {
  if (!rawId) return null
  const raw = String(rawId).trim()
  // Already has series prefix: "46-022"
  const hyphenMatch = raw.match(/^(\d+)-0*(\d+)$/)
  if (hyphenMatch) {
    return `${parseInt(hyphenMatch[1])}-${parseInt(hyphenMatch[2])}`
  }
  // Just scene number: "022"
  const sceneNum = parseInt(raw.replace(/^0+/, '') || '0')
  if (!sceneNum) return null
  if (series) {
    return `${parseInt(series)}-${sceneNum}`
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
 * Replaces inline sceneDateMap/sceneTimeMap/kppSlotMap construction.
 */
async function getSceneLookupMaps(projectId) {
  const { rows } = await db.query(
    `SELECT canonical_id, date, day_number, time_slot, scenario_text
     FROM scenes WHERE project_id = $1`,
    [projectId]
  )

  const dateMap = {}   // canonical_id → date string
  const timeMap = {}   // canonical_id → "СД X" label
  const slotMap = {}   // canonical_id → time_slot
  const textMap = {}   // canonical_id → scenario_text

  for (const r of rows) {
    const cid = r.canonical_id
    if (r.date) dateMap[cid] = r.date
    if (r.day_number) timeMap[cid] = `СД ${r.day_number}`
    if (r.time_slot) slotMap[cid] = r.time_slot
    if (r.scenario_text) textMap[cid] = r.scenario_text
  }

  return { dateMap, timeMap, slotMap, textMap }
}

/**
 * Get series number for a project from existing scenes.
 * Fallback when filename doesn't contain series info.
 */
async function getProjectSeries(projectId) {
  const { rows } = await db.query(
    `SELECT DISTINCT series FROM scenes WHERE project_id = $1 AND series IS NOT NULL LIMIT 1`,
    [projectId]
  )
  return rows.length ? String(rows[0].series).padStart(2, '0') : ''
}

module.exports = {
  normalizeSceneId,
  extractSeriesFromFilename,
  upsertScenesFromKpp,
  upsertScenesFromScenario,
  getSceneLookupMaps,
  getProjectSeries,
}
