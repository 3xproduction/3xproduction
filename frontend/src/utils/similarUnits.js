// Поиск похожих единиц по распознанному названию — для предупреждения о дубле.
// Логика идентична той, что используется в пакетном пополнении (BulkUploadPage):
// несколько поисковых запросов по названию + скоринг по совпадению слов/категории/
// типу матча, возвращаем топ-кандидатов с фото.

import { units as unitsApi } from '../services/api'

const STOP_WORDS = new Set([
  'для', 'или', 'под', 'над', 'без', 'при', 'как', 'это', 'тот', 'эта', 'его', 'ее',
  'чёрный', 'черный', 'белый', 'белая', 'серый', 'серая', 'красный', 'синий',
  'малый', 'малая', 'большой', 'большая', 'новый', 'новая', 'старый', 'старая',
])

function normalizeSearchText(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[^a-zа-я0-9]+/gi, ' ')
    .trim()
}

function wordsOf(value) {
  return normalizeSearchText(value)
    .split(/\s+/)
    .filter(w => w.length >= 3 && !STOP_WORDS.has(w))
}

function uniqueById(items) {
  const seen = new Set()
  const out = []
  for (const item of items) {
    if (!item?.id || seen.has(item.id)) continue
    seen.add(item.id)
    out.push(item)
  }
  return out
}

function buildQueries(name) {
  const words = wordsOf(name)
  return [
    normalizeSearchText(name),
    words.slice(0, 2).join(' '),
    ...words.slice(0, 4),
  ].filter(Boolean).filter((q, idx, arr) => arr.indexOf(q) === idx)
}

function candidateScore(unit, recognized, queryIndex) {
  const unitName = normalizeSearchText(unit.name)
  const recWords = wordsOf(recognized.name)
  const overlap = recWords.filter(w => unitName.includes(w)).length
  let score = 42 - queryIndex * 6
  if (unit._match === 'direct') score += 42
  else if (unit._match === 'similar') score += 28
  else if (unit._match === 'related') score += 8
  if (recognized.category && unit.category === recognized.category) score += 14
  score += overlap * 9
  return score
}

function matchLabel(score, match) {
  if (score >= 86 || match === 'direct') return 'точное'
  if (score >= 66 || match === 'similar') return 'похожее'
  return 'проверить'
}

// Возвращает до 3 кандидатов-дублей с общего склада (status=on_stock).
// recognized: { name, category }
export async function findSimilarUnits(recognized) {
  if (!recognized?.name) return []
  const queries = buildQueries(recognized.name).slice(0, 4)
  if (!queries.length) return []
  const responses = await Promise.all(
    queries.map((query, index) =>
      unitsApi.listBulkMatch({ search: query, status: 'on_stock', scope: 'common', photo_match_available: '1' })
        .then(response => ({ response, index }))
        .catch(() => ({ response: { units: [] }, index }))
    )
  )
  const collected = []
  for (const { response, index } of responses) {
    for (const unit of response.units || []) {
      if (unit.misplaced || unit.is_project_kept || unit.project_id || unit.on_loan_to_project_id || unit.pending_transfer || unit.status !== 'on_stock') continue
      const score = candidateScore(unit, recognized, index)
      if (score < 58) continue
      collected.push({
        ...unit,
        _photo_match_score: score,
        _photo_match_label: matchLabel(score, unit._match),
      })
    }
  }
  return uniqueById(collected)
    .sort((a, b) => b._photo_match_score - a._photo_match_score)
    .slice(0, 3)
}
