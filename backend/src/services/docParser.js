const ExcelJS = require('exceljs')
const mammoth = require('mammoth')

// ============================================================
// КПП (xlsx) parser
// ============================================================
async function parseKpp(buffer) {
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.load(buffer)
  const ws = wb.worksheets[0]
  if (!ws) throw new Error('No worksheet found')

  const result = parseSheetAsKpp(ws)
  result.type = 'kpp'
  return result
}

// Shared parser for KPP sheet and ПЛАН С.ДНЯ sheet
function parseSheetAsKpp(ws) {
  const scenes = []
  const shootDays = []
  let currentDay = null
  let currentPlatform = ''

  ws.eachRow((row, rowNum) => {
    const vals = []
    row.eachCell({ includeEmpty: true }, (cell, colNum) => {
      vals[colNum - 1] = cellText(cell)
    })

    const col0 = (vals[0] || '').trim()
    const col5 = (vals[5] || '').trim()
    const col7 = (vals[7] || '').trim()

    // Detect shoot day header: "6.02.птн." style or contains "С/Д №"
    if (col5 && /С\/Д\s*№/i.test(col5)) {
      const dateMatch = col0.match(/^(\d{1,2}\.\d{2})/)
      const dayMatch = col5.match(/С\/Д\s*№\s*(\d+)/i)
      const shiftMatch = col7.match(/(\d{1,2}:\d{2})\s*-\s*(\d{1,2}:\d{2})/)
      currentDay = {
        date: dateMatch ? dateMatch[1] : col0,
        day_number: dayMatch ? parseInt(dayMatch[1]) : shootDays.length + 1,
        shift: shiftMatch ? `${shiftMatch[1]}-${shiftMatch[2]}` : '',
        scenes: [],
      }
      shootDays.push(currentDay)
      currentPlatform = ''
      return
    }

    // Detect platform header: "ПЛОЩАДКА №1 : ..."
    if (/^ПЛОЩАДКА\s*№?\d*/i.test(col0)) {
      const m = col0.match(/:\s*(.+)/)
      currentPlatform = m ? m[1].trim() : col0
      return
    }

    // Detect scene row: starts with "XX-XX." pattern (series-scene)
    const sceneMatch = col0.match(/^(\d+)-(\d+)\.?$/)
    if (!sceneMatch) return

    const series = sceneMatch[1]
    const sceneNum = sceneMatch[2]
    const id = `${series}-${sceneNum}`

    const synopsis = (vals[6] || '').trim()
    const propsCol = (vals[10] || '').trim()

    // Parse props/costumes/makeup from combined column
    const { props, costumes, makeup, notes } = parsePropsColumn(propsCol)

    // Parse column M: Каскадеры/Пиротехник/Консультант
    const colM = (vals[12] || '').trim()
    const { stunts: stuntsList, pyrotechnics, consultant } = parseStuntsColumn(colM)

    // Parse object as location name
    const objectName = synopsis.split('\n')[0] || ''

    const scene = {
      id,
      series,
      scene: sceneNum,
      time_slot: (vals[1] || '').trim(),
      mode: (vals[2] || '').trim(),
      duration: (vals[3] || '').trim(),
      int_nat: (vals[4] || '').trim(),
      day: col5,
      object: objectName,
      synopsis: synopsis.includes('Синопсис:')
        ? synopsis.split('Синопсис:')[1]?.trim() || ''
        : synopsis,
      location: (vals[7] || '').trim(),
      characters: parseList(vals[8]),
      extras: (vals[9] || '').trim(),
      props,
      costumes,
      makeup,
      vehicles: parseList(vals[11]),
      stunts: stuntsList,
      pyrotechnics,
      consultant,
      decoration: [],
      locations: objectName ? [objectName] : [],
      notes,
      platform: currentPlatform,
    }

    scenes.push(scene)
    if (currentDay) currentDay.scenes.push(id)
  })

  return { scenes, shoot_days: shootDays }
}

// ============================================================
// Сценарий (docx) parser — uses HTML table from mammoth
// ============================================================
async function parseScenario(buffer) {
  const htmlResult = await mammoth.convertToHtml({ buffer })
  const html = htmlResult.value

  const scenes = []
  // Split by <tr> to get rows
  const rows = html.split('<tr>').slice(1) // skip before first <tr>

  for (const rowHtml of rows) {
    // Extract all <th> cells (docx table uses <th> for both columns)
    const cells = []
    const cellRegex = /<th>([\s\S]*?)<\/th>/g
    let m
    while ((m = cellRegex.exec(rowHtml)) !== null) {
      cells.push(m[1])
    }
    if (cells.length < 1) continue

    const leftHtml = cells[0] || ''
    const rightHtml = cells[1] || ''

    // Strip HTML tags for text
    const leftText = stripHtml(leftHtml)
    const rightText = stripHtml(rightHtml)

    // Parse scene header from left column
    const headerMatch = leftText.match(/^(\d+)\.\s+(НАТ|ИНТ|НАТ\/ИНТ|ИНТ\/НАТ)\s+(.+?)\.\s+(ДЕНЬ|НОЧЬ|УТРО|ВЕЧЕР|ДЕНЬ\/НОЧЬ)[.\s]+СД\s*(\d+)\s*\((\d{2}:\d{2})\)/i)
    if (!headerMatch) continue

    // Extract scene body text (after the header line)
    const headerEnd = leftText.indexOf(')')
    const bodyText = headerEnd > 0 ? leftText.substring(headerEnd + 1).trim() : ''

    // Parse right column metadata
    const meta = parseRightColumn(rightText)

    scenes.push({
      id: headerMatch[1],
      scene: headerMatch[1],
      series: '',
      mode: headerMatch[4].toLowerCase(),
      duration: headerMatch[6],
      int_nat: headerMatch[2].toLowerCase(),
      day: headerMatch[5],
      object: headerMatch[3].trim(),
      synopsis: bodyText.split('\n')[0]?.substring(0, 200) || '',
      location: '',
      characters: meta.characters,
      extras: meta.extras,
      props: meta.props,
      costumes: meta.costumes,
      makeup: meta.makeup,
      vehicles: meta.vehicles,
      stunts: meta.stunts,
      pyrotechnics: meta.pyrotechnics,
      consultant: meta.consultant,
      decoration: [],
      locations: [headerMatch[3].trim()],
      notes: meta.notes,
      text: bodyText,
    })
  }

  return { type: 'scenario', scenes, shoot_days: [] }
}

function stripHtml(html) {
  return html
    .replace(/<br\s*\/?>/g, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<\/div>/gi, '\n')
    .replace(/<\/li>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&nbsp;/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function parseRightColumn(text) {
  const meta = { characters: [], extras: '', props: [], costumes: [], makeup: [], vehicles: [], stunts: [], pyrotechnics: [], consultant: [], decoration: [], notes: '' }
  if (!text) return meta

  // Split by known markers
  const parts = text.split(/(?=Персонажи:|Реквизит:|Костюм:|Грим:|Игровой транспорт:|Спецэффекты:|Массовка:)/i)

  for (const part of parts) {
    const t = part.trim()
    if (/^Персонажи:/i.test(t)) {
      meta.characters = t.replace(/^Персонажи:\s*/i, '').split(/[\n,]+/).map(s => s.trim()).filter(s => s && s.length > 1)
    } else if (/^Реквизит:/i.test(t)) {
      meta.props = t.replace(/^Реквизит:\s*/i, '').split(/,\s*/).map(s => s.trim()).filter(Boolean)
    } else if (/^Костюм:/i.test(t)) {
      meta.costumes = t.replace(/^Костюм:\s*/i, '').split(/,\s*/).map(s => s.trim()).filter(Boolean)
    } else if (/^Грим:/i.test(t)) {
      meta.makeup = [t.replace(/^Грим:\s*/i, '').trim()].filter(Boolean)
    } else if (/^Игровой транспорт:/i.test(t)) {
      meta.vehicles = t.replace(/^Игровой транспорт:\s*/i, '').split(/\s{2,}|\n/).map(s => s.trim()).filter(Boolean)
    } else if (/^Спецэффекты:/i.test(t)) {
      meta.notes = t.replace(/^Спецэффекты:\s*/i, '').trim()
    } else if (/^Массовка:/i.test(t)) {
      meta.extras = t.replace(/^Массовка:\s*/i, '').trim()
    }
  }

  return meta
}

// ============================================================
// Вызывной (xlsx) parser
// ============================================================
async function parseCallsheet(buffer) {
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.load(buffer)

  // Find sheets by name
  const callsheetSheet = wb.worksheets.find(ws => /ВЫЗЫВНОЙ/i.test(ws.name)) || wb.worksheets[0]
  const planSheet = wb.worksheets.find(ws => /ПЛАН\s*С\.?\s*ДНЯ/i.test(ws.name))

  if (!callsheetSheet) throw new Error('No worksheet found')

  const data = {
    type: 'callsheet',
    title: '',
    date: '',
    day_number: 0,
    shift: '',
    locations: [],
    caravan: '',
    cast: [],
    departments: [],
    vehicles: [],
    notes: '',
    extras: '',
    plan_day: null,
  }

  let section = 'header' // header | cast | departments

  callsheetSheet.eachRow((row, rowNum) => {
    const vals = []
    row.eachCell({ includeEmpty: true }, (cell, colNum) => {
      vals[colNum - 1] = cellText(cell)
    })

    const col0 = (vals[0] || '').trim()
    const col1 = (vals[1] || '').trim()
    const col2 = (vals[2] || '').trim()
    const col3 = (vals[3] || '').trim()
    const col4 = (vals[4] || '').trim()

    // Header parsing
    if (/ВЫЗЫВНОЙ ЛИСТ/i.test(col1 || col0)) {
      const numMatch = (col1 || col0).match(/№\s*(\d+)/)
      data.title = (col1 || col0).trim()
      data.day_number = numMatch ? parseInt(numMatch[1]) : 0
    }

    if (/ПЛОЩАДКА/i.test(col1 || col0)) {
      const text = col1 || col0
      const locs = text.match(/ПЛОЩАДКА\s*№?\d*\s*:\s*(.+)/gi) || []
      locs.forEach(l => {
        const m = l.match(/:\s*(.+)/)
        if (m) data.locations.push(m[1].trim())
      })
    }

    if (/КАРАВАН/i.test(col4 || col0)) {
      data.caravan = (col4 || col0).replace(/КАРАВАН\s*:\s*/i, '').trim()
    }

    // Date + shift
    const dateMatch = col0.match(/^(\d{1,2}\.\d{2})\.\w/)
    if (dateMatch) data.date = dateMatch[1]

    const shiftMatch = (col4 || '').match(/СМЕНА\s*[:\s]*(\d{1,2}:\d{2})\s*-\s*(\d{1,2}:\d{2})/i)
    if (shiftMatch) data.shift = `${shiftMatch[1]}-${shiftMatch[2]}`

    // Cast section: РОЛЬ - ИСПОЛНИТЕЛЬ header
    if (/РОЛЬ.*ИСПОЛНИТЕЛЬ/i.test(col0)) {
      section = 'cast'
      return
    }

    // Departments section
    if (/ВЫЗОВ ГРУППЫ|ДЕПАРТАМЕНТ/i.test(col0)) {
      section = 'departments'
      return
    }

    if (/Эпизоды|СЕКОНД|ПОСТ\.ТРЮКОВ|ПИРОТЕХНИК|УКАЗАНИЯ/i.test(col0)) {
      section = 'notes_section'
    }

    // Parse cast rows
    if (section === 'cast' && col0 && col3 && /\d{2}:\d{2}/.test(col3)) {
      const parts = col0.split(' - ')
      data.cast.push({
        role: (parts[0] || '').trim(),
        actor: (parts[1] || '').trim(),
        location: col2.trim(),
        call: col3.trim(),
        makeup_costume: col4.trim(),
        ready: (vals[5] || '').trim(),
      })
    }

    // Parse department rows
    if (section === 'departments') {
      if (col0 && col1 && /\d{2}:\d{2}/.test(String(col1))) {
        data.departments.push({ name: col0.trim(), call: String(col1).trim() })
      }
      if (col2 && col3 && /\d{2}:\d{2}/.test(String(col3))) {
        data.departments.push({ name: col2.trim(), call: String(col3).trim() })
      }
      if (col4 && /\d{2}:\d{2}/.test(String(vals[5] || ''))) {
        data.departments.push({ name: col4.trim(), call: String(vals[5] || '').trim() })
      }
    }

    // Vehicles
    if (/ИГРОВОЙ\s*ТРАНСПОРТ/i.test(col0)) {
      section = 'vehicles'
    }
    if (section === 'vehicles' && col2 && /А\/М/i.test(col2)) {
      data.vehicles.push(col2.trim())
    }
  })

  // Parse ПЛАН С.ДНЯ sheet as KPP-style scenes
  if (planSheet) {
    data.plan_day = parseSheetAsKpp(planSheet)
  }

  return data
}

// ============================================================
// Helpers
// ============================================================
function cellText(cell) {
  if (cell.value === null || cell.value === undefined) return ''
  if (typeof cell.value === 'object' && cell.value.richText) {
    return cell.value.richText.map(r => r.text || '').join('')
  }
  if (cell.value instanceof Date) {
    const h = cell.value.getHours().toString().padStart(2, '0')
    const m = cell.value.getMinutes().toString().padStart(2, '0')
    return `${h}:${m}`
  }
  return String(cell.value)
}

function parseList(val) {
  if (!val) return []
  return String(val).split(/[\n,]+/).map(s => s.trim()).filter(Boolean)
}

function parseStuntsColumn(text) {
  const stunts = []
  const pyrotechnics = []
  const consultant = []

  if (!text) return { stunts, pyrotechnics, consultant }

  // Try splitting by markers
  const hasMarkers = /Каскад[её]р|Пиротехни|Консультант/i.test(text)
  if (hasMarkers) {
    const parts = text.split(/(?=Каскад[её]р[ыа-я]*:|Пиротехни[ка-я]*:|Консультант[а-я]*:)/i)
    for (const part of parts) {
      const t = part.trim()
      if (/^Каскад[её]р/i.test(t)) {
        stunts.push(...t.replace(/^Каскад[её]р[ыа-я]*:\s*/i, '').split(/,\s*/).map(s => s.trim()).filter(Boolean))
      } else if (/^Пиротехни/i.test(t)) {
        pyrotechnics.push(...t.replace(/^Пиротехни[ка-я]*:\s*/i, '').split(/,\s*/).map(s => s.trim()).filter(Boolean))
      } else if (/^Консультант/i.test(t)) {
        consultant.push(...t.replace(/^Консультант[а-я]*:\s*/i, '').split(/,\s*/).map(s => s.trim()).filter(Boolean))
      } else if (t) {
        // Before first marker — put in all three
        const items = t.split(/,\s*/).map(s => s.trim()).filter(Boolean)
        stunts.push(...items)
      }
    }
  } else if (text) {
    // No markers — treat entire text as stunt description
    stunts.push(text)
  }

  return { stunts, pyrotechnics, consultant }
}

function parsePropsColumn(text) {
  const props = []
  const costumes = []
  const makeup = []
  const notes = []

  if (!text) return { props, costumes, makeup, notes: '' }

  // Split by known markers
  const parts = text.split(/(?=Реквизит:|Костюм:|Грим:|Примечание:)/i)

  for (const part of parts) {
    const trimmed = part.trim()
    if (/^Реквизит:/i.test(trimmed)) {
      props.push(...trimmed.replace(/^Реквизит:\s*/i, '').split(/,\s*/).map(s => s.trim()).filter(Boolean))
    } else if (/^Костюм:/i.test(trimmed)) {
      costumes.push(...trimmed.replace(/^Костюм:\s*/i, '').split(/,\s*/).map(s => s.trim()).filter(Boolean))
    } else if (/^Грим:/i.test(trimmed)) {
      makeup.push(trimmed.replace(/^Грим:\s*/i, '').trim())
    } else if (/^Примечание:/i.test(trimmed)) {
      notes.push(trimmed.replace(/^Примечание:\s*/i, '').trim())
    } else if (trimmed) {
      // If no marker, check if whole text is just items (likely props)
      props.push(...trimmed.split(/,\s*/).map(s => s.trim()).filter(Boolean))
    }
  }

  return { props, costumes, makeup, notes: notes.join('; ') }
}

// ============================================================
// Main entry: detect type and parse
// ============================================================
async function parseDocumentFile(buffer, originalName, docType) {
  const ext = (originalName || '').split('.').pop().toLowerCase()

  if (docType === 'callsheet') {
    if (ext !== 'xlsx' && ext !== 'xls') throw new Error('Вызывной должен быть в формате xlsx')
    return parseCallsheet(buffer)
  }

  if (docType === 'kpp') {
    if (ext !== 'xlsx' && ext !== 'xls') throw new Error('КПП должен быть в формате xlsx')
    return parseKpp(buffer)
  }

  if (docType === 'scenario') {
    if (ext !== 'docx') throw new Error('Сценарий должен быть в формате docx')
    return parseScenario(buffer)
  }

  throw new Error(`Unknown document type: ${docType}`)
}

module.exports = { parseDocumentFile, parseKpp, parseScenario, parseCallsheet }
