const db = require('../db')

/**
 * Match items from parsed document against warehouse units.
 * Uses direct word matching + synonym expansion from AI.
 * Returns array of { text, unit_id, unit_name, unit_status, category, photo_url }
 */
async function matchUnits(parsedContent, projectId) {
  if (!parsedContent || !parsedContent.scenes) return []

  // Collect all unique item strings from ALL categories (not just props/costumes)
  const allItems = new Set()
  const fields = ['props', 'costumes', 'makeup', 'vehicles', 'stunts', 'decoration', 'pyrotechnics', 'consultant', 'locations']
  for (const scene of parsedContent.scenes) {
    for (const field of fields) {
      for (const item of (scene[field] || [])) {
        const t = (typeof item === 'string' ? item : '').toLowerCase().trim()
        if (t.length > 2) allItems.add(t)
      }
    }
  }

  if (allItems.size === 0) return []

  // Fetch all units from warehouse
  const { rows: units } = await db.query(
    `SELECT u.id, u.name, u.status, u.category, u.qty,
            (SELECT url FROM unit_photos WHERE unit_id = u.id ORDER BY created_at LIMIT 1) AS photo_url
     FROM units u
     WHERE u.status != 'written_off'`
  )

  if (!units.length) return []

  // Load synonym map from latest document (if available)
  let synonymMap = {}
  if (projectId) {
    const { rows: docs } = await db.query(
      `SELECT parsed_data FROM documents WHERE project_id = $1 AND parsed_data IS NOT NULL ORDER BY version DESC LIMIT 5`,
      [projectId]
    )
    for (const d of docs) {
      const pd = typeof d.parsed_data === 'string' ? JSON.parse(d.parsed_data) : d.parsed_data
      if (pd?.synonyms && Object.keys(pd.synonyms).length) {
        synonymMap = pd.synonyms
        break
      }
    }
  }

  const matched = []
  const seen = new Set()

  for (const itemText of allItems) {
    // Build expanded word set: item words + synonym words
    const expandedWords = new Set()
    for (const w of itemText.split(/\s+/)) {
      if (w.length > 2) expandedWords.add(w)
    }
    // Add synonyms
    const syns = synonymMap[itemText] || []
    for (const syn of syns) {
      for (const w of syn.toLowerCase().split(/\s+/)) {
        if (w.length > 2) expandedWords.add(w)
      }
    }

    for (const unit of units) {
      const unitName = unit.name.toLowerCase()
      const unitWords = unitName.split(/\s+/).filter(w => w.length > 2)

      // Match strategies (any one = match):
      // 1. Direct substring
      const directMatch = unitName.includes(itemText) || itemText.includes(unitName)
      // 2. Fuzzy word overlap
      const fuzzy = fuzzyMatch(itemText, unitName)
      // 3. Synonym match: any expanded word appears in unit name (or unit word in expanded set)
      const synonymMatch = !directMatch && !fuzzy && (
        [...expandedWords].some(ew => unitWords.some(uw => uw === ew || uw.startsWith(ew) || ew.startsWith(uw))) ||
        unitWords.some(uw => expandedWords.has(uw))
      )

      if (directMatch || fuzzy || synonymMatch) {
        const key = `${itemText}::${unit.id}`
        if (seen.has(key)) continue
        seen.add(key)

        matched.push({
          text: itemText,
          unit_id: unit.id,
          unit_name: unit.name,
          unit_status: unit.status,
          unit_category: unit.category,
          unit_qty: unit.qty,
          photo_url: unit.photo_url,
        })
      }
    }
  }

  return matched
}

/**
 * Fuzzy match: split both strings into words and check overlap
 */
function fuzzyMatch(a, b) {
  const wordsA = a.split(/\s+/).filter(w => w.length > 2)
  const wordsB = b.split(/\s+/).filter(w => w.length > 2)
  if (wordsA.length === 0 || wordsB.length === 0) return false

  let matches = 0
  for (const wa of wordsA) {
    for (const wb of wordsB) {
      if (wa === wb || wa.startsWith(wb) || wb.startsWith(wa)) {
        matches++
        break
      }
    }
  }
  return matches > 0 && matches >= Math.min(wordsA.length, wordsB.length) * 0.5
}

module.exports = { matchUnits }
