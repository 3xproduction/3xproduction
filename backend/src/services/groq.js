const Anthropic = require('@anthropic-ai/sdk')

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

  try {
    return JSON.parse(clean)
  } catch (err) {
    console.error('Claude JSON parse failed, first 500 chars:', clean.substring(0, 500))
    console.error('Last 200 chars:', clean.substring(clean.length - 200))
    throw err
  }
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

module.exports = { parseDocument, computeDelta, analyzeCrossScenes }
