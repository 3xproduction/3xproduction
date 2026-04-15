const db = require('../db')
const { ALL_CATEGORIES, ROLE_CATEGORIES } = require('../constants/roleConfig')
const { normalizeSceneId } = require('./sceneService')

// Maps parsed_content scene fields → category names
const CATEGORY_MAP = {
  props: 'props', costumes: 'costumes', makeup: 'makeup',
  vehicles: 'auto', stunts: 'stunts', pyrotechnics: 'pyrotechnics',
  consultant: 'consultant', locations: 'locations',
  decoration: 'decoration',
}

/**
 * Extract a flat array of items from parsed_content scenes.
 * No DB calls — pure data transformation.
 */
function extractItems(parsedContent, type) {
  if (!parsedContent?.scenes) return []
  const items = []
  for (const s of parsedContent.scenes) {
    for (const [field, cat] of Object.entries(CATEGORY_MAP)) {
      for (const raw of (s[field] || [])) {
        const name = (raw || '').replace(/\s+/g, ' ').trim()
        if (!name) continue
        items.push({
          name,
          category: cat,
          rawScene: s.id || null,
          rawDay: s.day || null,
          timeSlot: s.time_slot || null,
          location: s.location || '',
          object: s.object || s.synopsis || '',
          text: s.text || '',
          source: type,
        })
      }
    }
  }
  return items
}

/**
 * Normalize scene IDs and enrich items with dates/times from lookup maps.
 * Mutates items in place for performance.
 */
function normalizeItems(items, lookupMaps, type, series) {
  const { dateMap, timeMap, slotMap } = lookupMaps
  for (const item of items) {
    const sceneId = (type === 'scenario' && series)
      ? normalizeSceneId(item.rawScene, series)
      : normalizeSceneId(item.rawScene) || item.rawScene
    item.scene = sceneId || null
    const shootDate = (sceneId && dateMap[sceneId]) || ''
    const dayLabel = (sceneId && timeMap[sceneId]) || `СД ${item.rawDay || '?'}`
    const slot = item.timeSlot || (sceneId && slotMap[sceneId]) || ''
    item.day = shootDate || null
    item.time = slot ? `${dayLabel} · ${slot}` : dayLabel
    // Build note
    if (type === 'scenario') {
      item.note = item.text ? '📝 ' + item.text : ''
    } else {
      item.note = item.object || ''
    }
  }
  return items
}

/**
 * Deduplicate items by category + lowercase name + scene.
 * Returns new array without duplicates.
 */
function deduplicateItems(items) {
  const seen = new Set()
  const result = []
  for (const item of items) {
    const key = `${item.category}:${item.name.toLowerCase().trim()}:${item.scene || ''}`
    if (seen.has(key)) continue
    seen.add(key)
    result.push(item)
  }
  return result
}

/**
 * Validate items. Returns { valid, invalid }.
 * Invalid items are logged but not imported.
 */
function validateItems(items) {
  const valid = []
  const invalid = []
  const validDay = /^\d{1,2}[.\-/]\d{1,2}$/
  for (const item of items) {
    const errors = []
    if (!item.name || typeof item.name !== 'string') errors.push('empty name')
    if (item.name && item.name.length > 200) errors.push('name too long')
    if (item.category && !ALL_CATEGORIES.includes(item.category)) errors.push(`invalid category: ${item.category}`)
    if (item.day && typeof item.day === 'string' && !validDay.test(item.day)) {
      item.day = null // auto-fix: clear invalid day instead of rejecting
    }
    if (errors.length) {
      invalid.push({ item, errors })
    } else {
      valid.push(item)
    }
  }
  if (invalid.length) {
    console.warn(`[PIPELINE] Rejected ${invalid.length} items:`, invalid.map(i => `${i.item.name}: ${i.errors.join(', ')}`).join('; '))
  }
  return { valid, invalid }
}

/**
 * Delete old auto-imported items before re-import.
 * Only deletes items with the specified source (kpp/scenario/ai).
 * Manual items (source='manual') are NEVER deleted.
 */
async function clearOldItems(projectId, source, client) {
  const q = client || db
  const { rowCount } = await q.query(
    `DELETE FROM production_list_items
     WHERE list_id IN (SELECT id FROM production_lists WHERE project_id = $1)
       AND source = $2`,
    [projectId, source]
  )
  if (rowCount) console.log(`[PIPELINE] Cleared ${rowCount} old "${source}" items`)
  return rowCount
}

/**
 * Import validated items into production_lists for all project members.
 * Uses provided DB client for transaction support.
 * @param {Array} items - validated items with { name, category, scene, day, time, location, source, note }
 * @param {string} projectId
 * @param {object} client - pg client (from db.getClient()) or db itself
 * @returns {{ imported: number, skipped: number }}
 */
async function importToLists(items, projectId, client) {
  const q = client || db
  const { rows: members } = await q.query(
    `SELECT id, role FROM users WHERE project_id=$1`, [projectId]
  )
  let imported = 0
  let skipped = 0
  for (const member of members) {
    const isFullAccess = ['producer', 'project_director'].includes(member.role)
    const ownTypes = isFullAccess ? ALL_CATEGORIES : (ROLE_CATEGORIES[member.role] || [])
    if (!ownTypes.length) continue

    for (const listType of ownTypes) {
      const typeItems = items.filter(i => i.category === listType)
      if (!typeItems.length) continue

      await q.query(
        `INSERT INTO production_lists (project_id, user_id, type) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING`,
        [projectId, member.id, listType]
      )
      const { rows: lr } = await q.query(
        `SELECT id FROM production_lists WHERE project_id=$1 AND user_id=$2 AND type=$3`,
        [projectId, member.id, listType]
      )
      const listId = lr[0].id

      for (const item of typeItems) {
        const normalizedName = item.name.replace(/\s+/g, ' ').trim()
        if (!normalizedName) continue
        // Dedup: NULL and '' scene are equivalent
        const { rows: ex } = await q.query(
          `SELECT id FROM production_list_items WHERE list_id=$1
           AND LOWER(TRIM(name))=LOWER($2)
           AND COALESCE(NULLIF(scene,''), '') = COALESCE(NULLIF($3,''), '')`,
          [listId, normalizedName.toLowerCase(), item.scene || '']
        )
        if (ex.length) { skipped++; continue }
        await q.query(
          `INSERT INTO production_list_items (list_id, name, scene, day, time, location, qty, source, note)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
          [listId, normalizedName, item.scene || null, item.day || null, item.time || null,
           item.location || null, 1, item.source || 'manual', item.note || null]
        )
        imported++
      }
    }
  }
  return { imported, skipped }
}

module.exports = {
  CATEGORY_MAP,
  extractItems,
  normalizeItems,
  deduplicateItems,
  validateItems,
  clearOldItems,
  importToLists,
}
