const Anthropic = require('@anthropic-ai/sdk')
const { ALL_CATEGORIES } = require('../constants/roleConfig')

const client = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
  baseURL: 'https://anthropic-proxy.pavelbelov590.workers.dev',
})
const MODEL = 'claude-haiku-4-5'

const SYSTEM_PROMPT = `Ты — система анализа кинопроизводственных документов.
Разбери КПП или сценарий и верни строго JSON по схеме ниже.
Для каждой позиции укажи: name, scene, day, time, location, qty, source (kpp|scenario|ai), note.
В cross_check укажи расхождения между КПП и сценарием, пропущенные позиции и сквозные единицы.
Отвечай ТОЛЬКО JSON, без markdown, без преамбулы, без объяснений.

Схема:
{
  "props": [{ "name": "string", "scene": "string", "day": "string", "time": "string", "location": "string", "qty": 1, "source": "kpp|scenario|ai", "note": "string" }],
  "costumes": [...same...],
  "decoration": [...same...],
  "makeup": [...same...],
  "stunts": [...same...],
  "pyrotechnics": [...same...],
  "auto": [...same...],
  "consultant": [...same...],
  "ai_suggestions": [{ "category": "string", "item": "string", "reason": "string" }],
  "cross_check": {
    "discrepancies": ["string"],
    "missing": ["string"],
    "cross_items": ["string"]
  }
}`

async function parseDocument(text) {
  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 16384,
    system: SYSTEM_PROMPT,
    messages: [
      { role: 'user', content: `Документ для анализа:\n\n${text.slice(0, 17000)}` },
    ],
  })

  const content = response.content.find(b => b.type === 'text')?.text || ''
  const stopReason = response.stop_reason

  if (!content) {
    console.error('Claude returned empty content, stop_reason:', stopReason)
    throw new Error('Claude returned empty response')
  }

  // Убрать случайные markdown-фенсы
  let clean = content.replace(/^```(?:json)?/m, '').replace(/```$/m, '').trim()

  // Если ответ обрезан по лимиту токенов — починить JSON
  if (stopReason === 'max_tokens') {
    console.warn('Claude response truncated, attempting JSON repair')
    let opens = 0, openArr = 0
    for (const ch of clean) {
      if (ch === '{') opens++
      if (ch === '}') opens--
      if (ch === '[') openArr++
      if (ch === ']') openArr--
    }
    while (openArr > 0) { clean += ']'; openArr-- }
    while (opens > 0) { clean += '}'; opens-- }
  }

  let parsed
  try {
    parsed = JSON.parse(clean)
  } catch (err) {
    console.error('Claude JSON parse failed, first 500 chars:', clean.substring(0, 500))
    console.error('Last 200 chars:', clean.substring(clean.length - 200))
    throw err
  }

  // Validate AI response: sanitize each category
  const validDay = /^\d{1,2}[.\-/]\d{1,2}$/
  for (const cat of ALL_CATEGORIES) {
    if (!Array.isArray(parsed[cat])) { parsed[cat] = []; continue }
    parsed[cat] = parsed[cat].filter(item => {
      if (!item || typeof item !== 'object') return false
      const name = item.name || item.item || ''
      if (!name || typeof name !== 'string' || name.length > 200) {
        console.warn(`[AI-VALIDATE] Rejected item in ${cat}: invalid name "${String(name).substring(0, 50)}"`)
        return false
      }
      // Fix name field
      item.name = (item.name || item.item || '').replace(/\s+/g, ' ').trim()
      // Sanitize day: only accept date format, reject "день", "ночь" etc
      if (item.day && typeof item.day === 'string' && !validDay.test(item.day)) {
        item.day = null
      }
      return true
    })
  }
  // Validate ai_suggestions if present
  if (Array.isArray(parsed.ai_suggestions)) {
    parsed.ai_suggestions = parsed.ai_suggestions.filter(s =>
      s && typeof s === 'object' && (s.name || s.item) &&
      (!s.category || ALL_CATEGORIES.includes(s.category))
    )
  }

  return parsed
}

// Вычислить дельту между двумя версиями parsed_data
function computeDelta(oldData, newData) {
  const delta = { added: [], changed: [], removed: [] }
  const categories = ['props', 'costumes', 'decoration', 'makeup', 'stunts', 'pyrotechnics', 'auto', 'consultant']

  for (const cat of categories) {
    const oldItems = (oldData?.[cat] || [])
    const newItems = (newData?.[cat] || [])

    const oldMap = Object.fromEntries(oldItems.map(i => [i.name, i]))
    const newMap = Object.fromEntries(newItems.map(i => [i.name, i]))

    for (const name of Object.keys(newMap)) {
      if (!oldMap[name]) {
        delta.added.push({ category: cat, item: name })
      } else if (JSON.stringify(oldMap[name]) !== JSON.stringify(newMap[name])) {
        delta.changed.push({ category: cat, item: name, old: oldMap[name], new: newMap[name] })
      }
    }
    for (const name of Object.keys(oldMap)) {
      if (!newMap[name]) delta.removed.push({ category: cat, item: name })
    }
  }

  return delta
}

const CROSS_SCENES_PROMPT = `Ты — система анализа сценариев кинопроизводства.
Определи СКВОЗНЫЕ предметы, костюмы и грим — те что по контексту сценария присутствуют
в НЕСКОЛЬКИХ сценах ОДНОЙ серии.

Сквозной предмет — реквизит/костюм/грим, который по логике повествования должен
присутствовать в нескольких сценах. Примеры:
- Персонаж в нескольких сценах подряд → его одежда сквозная
- Предмет используется персонажем на протяжении истории
- Грим (раны, синяки) остаётся между сценами по сюжету

Правила:
- Только внутри ОДНОЙ серии, не между сериями
- Минимум 2 сцены для сквозного предмета
- Определяй по контексту повествования, а не только по прямому упоминанию
- Указывай номера сцен из текста

Верни СТРОГО JSON без markdown:
{
  "cross_scenes": [
    {
      "name": "название предмета",
      "category": "props|costumes|makeup|decoration|auto|stunts",
      "scenes": ["1", "5", "12"],
      "reason": "краткое объяснение почему это сквозной предмет"
    }
  ]
}`

async function analyzeCrossScenes(sceneTexts) {
  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 8192,
    system: CROSS_SCENES_PROMPT,
    messages: [
      { role: 'user', content: `Текст сцен сценария:\n\n${sceneTexts.slice(0, 17000)}` },
    ],
  })

  const content = response.content.find(b => b.type === 'text')?.text || ''
  let clean = content.replace(/^```(?:json)?/m, '').replace(/```$/m, '').trim()

  if (response.stop_reason === 'max_tokens') {
    let opens = 0, openArr = 0
    for (const ch of clean) {
      if (ch === '{') opens++
      if (ch === '}') opens--
      if (ch === '[') openArr++
      if (ch === ']') openArr--
    }
    while (openArr > 0) { clean += ']'; openArr-- }
    while (opens > 0) { clean += '}'; opens-- }
  }

  return JSON.parse(clean)
}

const UNIT_TAGS_PROMPT = `Ты — система поисковой индексации для склада реквизита кинопроизводства.
Тебе дают название, категорию, описание и эпоху предмета.
Сгенерируй ровно 100 поисковых тегов на русском языке.

Теги должны покрывать ВСЕ аспекты предмета:
1. Синонимы (5-15): другие названия этого предмета, уменьшительные, разговорные
2. Родовые категории (5-10): к чему относится (мебель, оружие, одежда, посуда...)
3. Контексты использования (10-15): где в жизни встречается (кухня, офис, улица, больница, школа...)
4. Кино-сцены (15-20): типичные сцены в кино где нужен этот предмет (допрос, погоня, свадьба, похороны, ограбление, застолье...)
5. Эпохи и стили (5-10): временные периоды и стили (современное, советское, викторианское, средневековое, ретро, минимализм...)
6. Материалы и свойства (5-10): из чего сделано, характеристики (дерево, металл, пластик, кожа, тканевый, стеклянный...)
7. Визуальные признаки (5-10): цвет, форма, размер если применимо
8. Ассоциации (10-15): предметы которые обычно рядом, сопутствующие вещи
9. Профессии и роли (5-10): кто использует этот предмет (врач, полицейский, повар, солдат...)

Верни СТРОГО JSON массив из 100 строк, без markdown:
["тег1", "тег2", ..., "тег100"]

Каждый тег — 1-3 слова, на русском, в нижнем регистре. Без повторов.`

async function generateUnitTags({ name, category, description, period }) {
  const userText = [
    `Название: ${name}`,
    `Категория: ${category}`,
    description ? `Описание: ${description}` : null,
    period ? `Эпоха: ${period}` : null,
  ].filter(Boolean).join('\n')

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 4096,
    system: UNIT_TAGS_PROMPT,
    messages: [
      { role: 'user', content: userText },
    ],
  })

  const content = response.content.find(b => b.type === 'text')?.text || ''
  let clean = content.replace(/^```(?:json)?/m, '').replace(/```$/m, '').trim()

  // Repair truncated JSON
  if (response.stop_reason === 'max_tokens') {
    let openArr = 0
    for (const ch of clean) {
      if (ch === '[') openArr++
      if (ch === ']') openArr--
    }
    // Remove trailing incomplete string if any
    clean = clean.replace(/,\s*"[^"]*$/, '')
    while (openArr > 0) { clean += ']'; openArr-- }
  }

  const tags = JSON.parse(clean)
  if (!Array.isArray(tags)) throw new Error('Tags response is not an array')

  // Sanitize: only strings, lowercase, deduplicate, max 100
  const seen = new Set()
  const result = []
  for (const tag of tags) {
    if (typeof tag !== 'string') continue
    const t = tag.toLowerCase().trim().replace(/\s+/g, ' ')
    if (!t || t.length > 60 || seen.has(t)) continue
    seen.add(t)
    result.push(t)
    if (result.length >= 100) break
  }

  return result
}

module.exports = { parseDocument, computeDelta, analyzeCrossScenes, generateUnitTags }
