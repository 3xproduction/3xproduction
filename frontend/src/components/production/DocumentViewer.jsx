import { useState, useEffect, useMemo } from 'react'
import { useParams, useNavigate, useSearchParams } from 'react-router-dom'
import { newStemmer } from 'snowball-stemmers'
import ProductionLayout from './ProductionLayout'
import Badge from '../shared/Badge'
import UnitCardModal from '../shared/UnitCardModal'
import { documents as docsApi } from '../../services/api'

const TYPE_LABELS = { kpp: 'КПП', scenario: 'Сценарий', callsheet: 'Вызывной' }

const MODE_COLORS = {
  'день': { bg: '#fff7ed', border: '#f59e0b', text: '#b45309', label: 'день' },
  'утро': { bg: '#fefce8', border: '#eab308', text: '#a16207', label: 'утро' },
  'вечер': { bg: '#f5f3ff', border: '#8b5cf6', text: '#6d28d9', label: 'вечер' },
  'ночь': { bg: '#eff6ff', border: '#1e40af', text: '#1e3a8a', label: 'ночь' },
  'день/ночь': { bg: '#fef3c7', border: '#d97706', text: '#92400e', label: 'день/ночь' },
}
const DEFAULT_MODE = { bg: 'var(--bg)', border: 'var(--border)', text: 'var(--muted)', label: '—' }

const DETAIL_SECTIONS = [
  { key: 'props', icon: '🎭', label: 'Реквизит', isList: true },
  { key: 'costumes', icon: '👗', label: 'Костюм', isList: true },
  { key: 'makeup', icon: '💄', label: 'Грим', isList: true },
  { key: 'vehicles', icon: '🚗', label: 'Транспорт', isList: true },
  { key: 'extras', icon: '👥', label: 'Массовка', isList: false },
  { key: 'location', icon: '📍', label: 'Локация', isList: false },
  { key: 'notes', icon: '📝', label: 'Примечания', isList: false },
  { key: 'platform', icon: '🏗', label: 'Площадка', isList: false },
]

const DEPT_GROUPS = {
  'Режиссёрская': { icon: '🎬', keywords: ['режиссёр', 'режиссер', 'реж.', 'постановщик'] },
  'Операторская': { icon: '📷', keywords: ['оператор', 'опер.', 'камер', 'dop', 'фокус'] },
  'Свет': { icon: '💡', keywords: ['свет', 'осветит', 'гафер', 'электр'] },
  'Звук': { icon: '🎤', keywords: ['звук', 'микрофон', 'бум'] },
  'Грим и Костюм': { icon: '💄', keywords: ['грим', 'костюм', 'стилист', 'визаж'] },
  'Транспорт': { icon: '🚛', keywords: ['транспорт', 'водитель', 'логист'] },
  'Художественный': { icon: '🏗️', keywords: ['худож', 'декор', 'реквизит', 'бутафор'] },
  'Продюсерская': { icon: '📋', keywords: ['продюсер', 'администр', 'директор', 'координат'] },
  'Другие': { icon: '👤', keywords: [] },
}

/* ============================================================
   Main component
   ============================================================ */
export default function DocumentViewer() {
  const { projectId, docId } = useParams()
  const [searchParams] = useSearchParams()
  const sceneFromUrl = searchParams.get('scene')
  const navigate = useNavigate()
  const [doc, setDoc] = useState(null)
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [dayFilter, setDayFilter] = useState('')
  const [charFilter, setCharFilter] = useState('')
  const [platformFilter, setPlatformFilter] = useState('')
  const [modeFilter, setModeFilter] = useState('')
  const [intNatFilter, setIntNatFilter] = useState('')
  const [selectedUnit, setSelectedUnit] = useState(null)
  const [expandedScene, setExpandedScene] = useState(sceneFromUrl || null)

  const [allProjectItems, setAllProjectItems] = useState([])

  useEffect(() => {
    docsApi.view(projectId, docId)
      .then(d => {
        setDoc(d.document)
        if (d.allProjectItems) setAllProjectItems(d.allProjectItems)
        if (sceneFromUrl) {
          setTimeout(() => {
            const el = document.getElementById(`scene-${sceneFromUrl}`)
            if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' })
          }, 300)
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [projectId, docId])

  const content = doc?.parsed_content

  // Map: canonical scene ID → array of item names from ALL sources (KPP + Scenario + AI)
  const sceneItemsMap = useMemo(() => {
    if (!allProjectItems?.length) return {}
    const map = {}
    for (const item of allProjectItems) {
      const sid = item.scene || ''
      if (!map[sid]) map[sid] = []
      map[sid].push(item.name)
    }
    return map
  }, [allProjectItems])

  const matched = useMemo(() => {
    if (!doc?.matched_units) return {}
    const map = {}
    const units = typeof doc.matched_units === 'string' ? JSON.parse(doc.matched_units) : doc.matched_units
    for (const m of (units || [])) map[m.text.toLowerCase()] = m
    return map
  }, [doc?.matched_units])

  const delta = useMemo(() => {
    if (!doc?.delta) return null
    const d = typeof doc.delta === 'string' ? JSON.parse(doc.delta) : doc.delta
    return d.scene_changes || d
  }, [doc?.delta])

  const { characters, platforms, modes, intNats } = useMemo(() => {
    if (!content?.scenes) return { days: [], characters: [], platforms: [], modes: [], intNats: [] }
    const d = new Set(), c = new Set(), p = new Set(), m = new Set(), n = new Set()
    for (const s of content.scenes) {
      if (s.day) d.add(s.day)
      for (const ch of (s.characters || [])) c.add(ch)
      if (s.platform) p.add(s.platform)
      if (s.mode) m.add(s.mode.toLowerCase())
      if (s.int_nat) n.add(s.int_nat.toLowerCase())
    }
    return {
      days: [...d].sort((a, b) => Number(a) - Number(b)),
      characters: [...c].sort(),
      platforms: [...p].sort(),
      modes: [...m],
      intNats: [...n],
    }
  }, [content])

  const filteredScenes = useMemo(() => {
    if (!content?.scenes) return []
    return content.scenes.filter(s => {
      if (dayFilter && s.day !== dayFilter) return false
      if (charFilter && !(s.characters || []).includes(charFilter)) return false
      if (platformFilter && s.platform !== platformFilter) return false
      if (modeFilter && (s.mode || '').toLowerCase() !== modeFilter) return false
      if (intNatFilter && (s.int_nat || '').toLowerCase() !== intNatFilter) return false
      if (search) {
        const q = search.toLowerCase()
        const text = `${s.id} ${s.object} ${s.synopsis} ${(s.props||[]).join(' ')} ${(s.costumes||[]).join(' ')} ${(s.characters||[]).join(' ')} ${s.platform || ''}`.toLowerCase()
        if (!text.includes(q)) return false
      }
      return true
    })
  }, [content, dayFilter, charFilter, platformFilter, modeFilter, intNatFilter, search])

  // Group scenes by platform for KPP display
  const groupedByPlatform = useMemo(() => {
    const groups = []
    let current = null
    for (const s of filteredScenes) {
      const plat = s.platform || ''
      if (!current || current.platform !== plat) {
        current = { platform: plat, scenes: [] }
        groups.push(current)
      }
      current.scenes.push(s)
    }
    return groups
  }, [filteredScenes])

  if (loading) return <ProductionLayout><div style={{ padding: 32, color: 'var(--muted)' }}>Загрузка...</div></ProductionLayout>
  if (!doc) return <ProductionLayout><div style={{ padding: 32, color: 'var(--muted)' }}>Документ не найден</div></ProductionLayout>

  if (content?.type === 'callsheet') return (
    <ProductionLayout>
      <style>{RESPONSIVE_CSS}</style>
      <div className="dv-page" style={{ padding: '24px 32px', maxWidth: 960 }}>
        <BackHeader doc={doc} navigate={navigate} />
        <CallsheetTabs content={content} matched={matched} onUnitClick={setSelectedUnit} />
      </div>
      {selectedUnit && <UnitCardModal unitId={selectedUnit} onClose={() => setSelectedUnit(null)} />}
    </ProductionLayout>
  )

  // KPP or Scenario
  const clearFilters = () => { setSearch(''); setDayFilter(''); setCharFilter(''); setPlatformFilter(''); setModeFilter(''); setIntNatFilter('') }
  const hasFilters = search || dayFilter || charFilter || platformFilter || modeFilter || intNatFilter

  return (
    <ProductionLayout>
      <style>{RESPONSIVE_CSS}</style>
      <div className="dv-page" style={{ padding: '24px 32px', maxWidth: 960 }}>
        <BackHeader doc={doc} navigate={navigate} />

        {doc?.type === 'kpp' && delta && (delta.added?.length > 0 || delta.changed?.length > 0 || delta.removed?.length > 0) && (
          <DeltaBanner delta={delta} />
        )}

        {/* Shoot day chips */}
        {content?.shoot_days?.length > 0 && (
          <div style={{ display: 'flex', gap: 6, marginBottom: 16, flexWrap: 'wrap' }}>
            <Chip active={!dayFilter} onClick={() => setDayFilter('')}>Все дни</Chip>
            {content.shoot_days.map(sd => (
              <Chip key={sd.day_number} active={dayFilter === String(sd.day_number) || dayFilter === sd.date}
                onClick={() => {
                  const val = String(sd.day_number)
                  setDayFilter(dayFilter === val ? '' : val)
                }}>
                С/Д {sd.day_number} · {sd.date} · {sd.scenes.length} сц.
              </Chip>
            ))}
          </div>
        )}

        {/* Filters */}
        <div className="dv-filters" style={{ display: 'flex', gap: 8, marginBottom: 20, flexWrap: 'wrap', alignItems: 'center' }}>
          <div style={{ position: 'relative', flex: 1, minWidth: 160 }}>
            <span style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', fontSize: 14, opacity: 0.5 }}>🔍</span>
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Найдите..."
              style={{ width: '100%', height: 36, padding: '0 12px 0 32px', border: '1px solid var(--border)', borderRadius: 'var(--radius-btn)', fontSize: 13, boxSizing: 'border-box' }} />
          </div>
          <FilterSelect value={charFilter} onChange={setCharFilter} placeholder="Все персонажи" options={characters.map(c => ({ value: c, label: c }))} />
          {platforms.length > 0 && (
            <FilterSelect value={platformFilter} onChange={setPlatformFilter} placeholder="Все площадки" options={platforms.map(p => ({ value: p, label: p }))} />
          )}
          {modes.length > 1 && (
            <FilterSelect value={modeFilter} onChange={setModeFilter} placeholder="Режим"
              options={modes.map(m => ({ value: m, label: m.charAt(0).toUpperCase() + m.slice(1) }))} />
          )}
          {intNats.length > 1 && (
            <FilterSelect value={intNatFilter} onChange={setIntNatFilter} placeholder="Инт/Нат"
              options={intNats.map(n => ({ value: n, label: n.toUpperCase() }))} />
          )}
          {hasFilters && (
            <button onClick={clearFilters} style={{ height: 36, padding: '0 12px', border: '1px solid var(--border)', borderRadius: 'var(--radius-btn)', background: 'var(--white)', cursor: 'pointer', fontSize: 12, color: 'var(--muted)' }}>
              Сбросить
            </button>
          )}
        </div>

        {/* Scenes grouped by platform */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {groupedByPlatform.map((group, gi) => (
            <div key={gi}>
              {group.platform && (
                <div style={{
                  display: 'flex', alignItems: 'center', gap: 8, padding: '12px 0 8px',
                  marginTop: gi > 0 ? 12 : 0,
                }}>
                  <span style={{ fontSize: 16 }}>📍</span>
                  <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)', textTransform: 'uppercase', letterSpacing: 0.5 }}>
                    {group.platform}
                  </span>
                  <div style={{ flex: 1, height: 1, background: 'var(--border)' }} />
                  <span style={{ fontSize: 11, color: 'var(--muted)' }}>{group.scenes.length} сц.</span>
                </div>
              )}
              {group.scenes.map(scene => (
                <SceneCard
                  key={scene.id}
                  scene={scene}
                  delta={doc?.type === 'kpp' ? delta : null}
                  expanded={expandedScene === scene.id}
                  onToggle={() => setExpandedScene(expandedScene === scene.id ? null : scene.id)}
                  matched={matched}
                  onUnitClick={setSelectedUnit}
                  onCharClick={c => setCharFilter(charFilter === c ? '' : c)}
                  allItemsForScene={sceneItemsMap[scene.id] || []}
                />
              ))}
            </div>
          ))}
        </div>

        {filteredScenes.length === 0 && (
          <div style={{ textAlign: 'center', padding: '60px 0', color: 'var(--muted)' }}>
            Ничего не найдено
            {hasFilters && <div style={{ marginTop: 8 }}><button onClick={clearFilters} style={{ border: 'none', background: 'none', color: 'var(--blue)', cursor: 'pointer', fontSize: 13 }}>Сбросить фильтры</button></div>}
          </div>
        )}
      </div>

      {selectedUnit && <UnitCardModal unitId={selectedUnit} onClose={() => setSelectedUnit(null)} />}
    </ProductionLayout>
  )
}

/* ============================================================
   Highlight helper — wraps matched item names in yellow <mark>
   Uses Snowball Russian stemmer for morphology matching
   ============================================================ */
const _ruStemmer = newStemmer('russian')
const _STOP_WORDS = new Set(['на','от','из','за','по','для','при','без','над','под','про','как','что','это','или','так','все','вот','его','они','она','уже','еще','тут','там','мне','мой','наш','ваш','где','кто','чем','чей','той','тех','эти','тем','нас','вас','них','нем','ней','ним','вам','нам','всё'])

function highlightItems(text, scene, allItemsForScene) {
  const items = []
  for (const key of ['props', 'costumes', 'makeup', 'vehicles', 'stunts', 'decoration', 'pyrotechnics']) {
    for (const v of (scene[key] || [])) {
      const t = v.trim()
      if (t.length > 2) items.push(t)
    }
  }
  for (const name of (allItemsForScene || [])) {
    const t = (name || '').trim()
    if (t.length > 2 && !items.some(i => i.toLowerCase() === t.toLowerCase())) items.push(t)
  }
  if (!items.length) return text

  // Build set of stems from all item names
  const allStems = new Set()
  for (const item of items) {
    for (const w of item.split(/\s+/)) {
      if (w.length >= 3 && !_STOP_WORDS.has(w.toLowerCase())) {
        allStems.add(_ruStemmer.stem(w.toLowerCase()))
      }
    }
  }
  if (!allStems.size) return text

  // Split text into word/non-word tokens and highlight matching stems
  const cleanText = text.replace(/<[^>]+>/g, '')
  const parts = cleanText.split(/([а-яёА-ЯЁa-zA-Z0-9-]+)/g)
  let hasMatch = false
  const rendered = parts.map((p, i) => {
    if (/^[а-яёА-ЯЁa-zA-Z0-9-]+$/.test(p) && p.length >= 3) {
      const stem = _ruStemmer.stem(p.toLowerCase())
      if (allStems.has(stem)) {
        hasMatch = true
        return <mark key={i} style={{ background: '#fef08a', borderRadius: 2, padding: '0 2px' }}>{p}</mark>
      }
    }
    return p
  })
  return hasMatch ? rendered : text
}

/* ============================================================
   Scene Card
   ============================================================ */
function SceneCard({ scene, delta, expanded, onToggle, matched, onUnitClick, onCharClick, allItemsForScene }) {
  const sceneChange = delta?.changed?.find(c => c.id === scene.id)
  const isNew = delta?.added?.some(a => a.id === scene.id)
  const mode = MODE_COLORS[(scene.mode || '').toLowerCase()] || DEFAULT_MODE

  const hasDetails = DETAIL_SECTIONS.some(s => {
    const val = scene[s.key]
    return s.isList ? val?.length > 0 : !!val
  }) || scene.text

  return (
    <div id={`scene-${scene.id}`} style={{
      background: isNew ? 'rgba(34,197,94,0.04)' : sceneChange ? 'rgba(234,179,8,0.04)' : 'var(--white)',
      border: '1px solid var(--border)',
      borderRadius: 'var(--radius-card)',
      borderLeft: `4px solid ${isNew ? 'var(--green)' : sceneChange ? 'var(--amber)' : mode.border}`,
      overflow: 'hidden',
      marginBottom: 6,
    }}>
      {/* Header */}
      <div onClick={onToggle} style={{ padding: '14px 18px', cursor: hasDetails ? 'pointer' : 'default' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
          <span style={{ fontWeight: 700, fontSize: 15, fontFamily: 'monospace', color: 'var(--text)' }}>{scene.id}.</span>
          <span style={{ fontWeight: 600, fontSize: 14 }}>{scene.object}</span>
          {isNew && <Badge color="green">НОВАЯ</Badge>}
          {sceneChange && <Badge color="amber">ИЗМЕНЕНА</Badge>}
          {hasDetails && (
            <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--muted)', userSelect: 'none' }}>
              {expanded ? '▲' : '▼'}
            </span>
          )}
        </div>

        {/* Tags row */}
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 8 }}>
          <Tag icon="💡" color={mode.text} bg={mode.bg}>{mode.label}</Tag>
          {scene.int_nat && <Tag icon="🏠">{scene.int_nat.toUpperCase()}</Tag>}
          {scene.day && <Tag icon="📅">СД {scene.day}</Tag>}
          {scene.duration && <Tag icon="⏱">{scene.duration}</Tag>}
          {scene.time_slot && <Tag icon="🕐">{scene.time_slot}</Tag>}
        </div>

        {/* Characters chips */}
        {scene.characters?.length > 0 && (
          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
            {scene.characters.map(c => (
              <span key={c} onClick={e => { e.stopPropagation(); onCharClick(c) }}
                style={{
                  padding: '3px 10px', borderRadius: 20,
                  background: 'var(--blue-dim)', color: 'var(--blue)',
                  fontSize: 11, fontWeight: 500, cursor: 'pointer',
                  transition: 'all 0.15s',
                }}>
                {c}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Expanded details */}
      {expanded && (
        <div style={{ padding: '0 18px 16px', borderTop: '1px solid var(--border)' }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 10, paddingTop: 14 }}>
            {DETAIL_SECTIONS.map(sec => {
              const val = scene[sec.key]
              const hasValue = sec.isList ? val?.length > 0 : !!val
              if (!hasValue) return null
              const display = sec.isList ? val.join(', ') : val
              return (
                <div key={sec.key} style={{ padding: '10px 14px', background: 'var(--bg)', borderRadius: 'var(--radius-btn)' }}>
                  <div style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 600, marginBottom: 4, display: 'flex', alignItems: 'center', gap: 4 }}>
                    <span>{sec.icon}</span> {sec.label}
                  </div>
                  {sec.key === 'props' || sec.key === 'costumes' ? (
                    <div style={{ fontSize: 13 }}>
                      {val.map((item, i) => (
                        <MatchedItem key={i} text={item} matched={matched} onUnitClick={onUnitClick} />
                      ))}
                    </div>
                  ) : (
                    <div style={{ fontSize: 13, lineHeight: 1.5 }}>{display}</div>
                  )}
                </div>
              )
            })}
          </div>

          {/* Scenario text */}
          {scene.text && (
            <div style={{
              marginTop: 12, padding: '14px 16px', background: 'var(--bg)',
              borderRadius: 'var(--radius-btn)', fontSize: 13, lineHeight: 1.7,
              whiteSpace: 'pre-wrap', maxHeight: 400, overflowY: 'auto',
            }}>
              {highlightItems(scene.text, scene, allItemsForScene)}
            </div>
          )}

          {/* Scene changes detail */}
          {sceneChange && (
            <div style={{ marginTop: 10, padding: '10px 14px', background: 'rgba(234,179,8,0.08)', borderRadius: 'var(--radius-btn)', fontSize: 12 }}>
              <div style={{ fontWeight: 600, marginBottom: 6, color: 'var(--amber)', display: 'flex', alignItems: 'center', gap: 4 }}>
                <span>⚡</span> Изменения
              </div>
              {sceneChange.changes.map((ch, i) => (
                <div key={i} style={{ marginBottom: 3 }}>
                  <strong>{ch.field}:</strong>{' '}
                  <span style={{ textDecoration: 'line-through', opacity: 0.5 }}>{JSON.stringify(ch.old)}</span>
                  {' → '}
                  <span>{JSON.stringify(ch.new)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

/* ============================================================
   Callsheet Tabs
   ============================================================ */
function CallsheetTabs({ content, matched, onUnitClick }) {
  const [tab, setTab] = useState('callsheet')
  const hasPlan = content.plan_day?.scenes?.length > 0

  return (
    <div>
      {hasPlan && (
        <div style={{ display: 'flex', gap: 0, marginBottom: 24, borderBottom: '2px solid var(--border)' }}>
          {[['callsheet', '📣 ВЫЗЫВНОЙ'], ['plan', '📋 ПЛАН С.ДНЯ']].map(([key, label]) => (
            <button key={key} onClick={() => setTab(key)} style={{
              padding: '12px 24px', border: 'none', background: 'none',
              fontWeight: 600, fontSize: 14, cursor: 'pointer',
              color: tab === key ? 'var(--blue)' : 'var(--muted)',
              borderBottom: `3px solid ${tab === key ? 'var(--blue)' : 'transparent'}`,
              marginBottom: -2, transition: 'all 0.15s',
            }}>{label}</button>
          ))}
        </div>
      )}
      {tab === 'callsheet' && <CallsheetView content={content} />}
      {tab === 'plan' && hasPlan && <PlanDayView planDay={content.plan_day} matched={matched} onUnitClick={onUnitClick} />}
    </div>
  )
}

/* ============================================================
   Callsheet View — redesigned
   ============================================================ */
function CallsheetView({ content }) {
  const [openDepts, setOpenDepts] = useState({})

  const toggleDept = name => setOpenDepts(prev => ({ ...prev, [name]: !prev[name] }))

  // Group departments
  const deptGrouped = useMemo(() => {
    if (!content.departments?.length) return []
    const groups = {}
    for (const d of content.departments) {
      const nameL = d.name.toLowerCase()
      let assigned = false
      for (const [groupName, cfg] of Object.entries(DEPT_GROUPS)) {
        if (groupName === 'Другие') continue
        if (cfg.keywords.some(kw => nameL.includes(kw))) {
          if (!groups[groupName]) groups[groupName] = { ...cfg, name: groupName, members: [] }
          groups[groupName].members.push(d)
          assigned = true
          break
        }
      }
      if (!assigned) {
        if (!groups['Другие']) groups['Другие'] = { ...DEPT_GROUPS['Другие'], name: 'Другие', members: [] }
        groups['Другие'].members.push(d)
      }
    }
    return Object.values(groups)
  }, [content.departments])

  // Sort cast by call time
  const sortedCast = useMemo(() => {
    if (!content.cast?.length) return []
    return [...content.cast].sort((a, b) => (a.call || '').localeCompare(b.call || ''))
  }, [content.cast])

  return (
    <div>
      {/* Header */}
      <div style={{
        background: 'linear-gradient(135deg, #1e293b 0%, #334155 100%)',
        borderRadius: 'var(--radius-card)', padding: '24px 28px', marginBottom: 20, color: '#fff',
      }}>
        <div style={{ fontSize: 22, fontWeight: 700, marginBottom: 8 }}>{content.title || 'Вызывной лист'}</div>
        <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap', fontSize: 14, opacity: 0.9 }}>
          {content.date && <span>📅 {content.date}</span>}
          {content.shift && <span>🕐 Смена: {content.shift}</span>}
          {content.caravan && <span>🚐 Караван: {content.caravan}</span>}
        </div>
        {content.locations?.length > 0 && (
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 12 }}>
            {content.locations.map((l, i) => (
              <span key={i} style={{
                padding: '5px 14px', borderRadius: 20,
                background: 'rgba(255,255,255,0.15)', fontSize: 13, display: 'flex', alignItems: 'center', gap: 4,
              }}>
                📍 {l}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Cast */}
      {sortedCast.length > 0 && (
        <div style={{ marginBottom: 24 }}>
          <SectionHeader icon="🎬" title="Актёры" count={sortedCast.length} />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {sortedCast.map((c, i) => (
              <div key={i} style={{
                display: 'grid', gridTemplateColumns: '2fr 2fr 1fr 1.5fr 1fr',
                gap: 8, padding: '12px 16px', background: 'var(--white)',
                border: '1px solid var(--border)', borderRadius: 'var(--radius-btn)',
                fontSize: 13, alignItems: 'center',
              }} className="dv-cast-row">
                <div><span style={{ fontWeight: 600 }}>{c.role}</span></div>
                <div style={{ color: 'var(--muted)' }}>{c.actor}</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  <span style={{ fontSize: 11 }}>🕐</span>
                  <span style={{ fontWeight: 600, color: 'var(--blue)' }}>{c.call}</span>
                </div>
                <div style={{ fontSize: 12, color: 'var(--muted)' }}>{c.makeup_costume}</div>
                <div style={{ fontSize: 12 }}>{c.ready}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Departments accordion */}
      {deptGrouped.length > 0 && (
        <div style={{ marginBottom: 24 }}>
          <SectionHeader icon="📞" title="Вызов группы" count={content.departments?.length} />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {deptGrouped.map(group => (
              <div key={group.name} style={{
                border: '1px solid var(--border)', borderRadius: 'var(--radius-btn)',
                overflow: 'hidden', background: 'var(--white)',
              }}>
                <div onClick={() => toggleDept(group.name)} style={{
                  display: 'flex', alignItems: 'center', gap: 10, padding: '12px 16px',
                  cursor: 'pointer', userSelect: 'none',
                }}>
                  <span style={{ fontSize: 16 }}>{group.icon}</span>
                  <span style={{ fontWeight: 600, fontSize: 14, flex: 1 }}>{group.name}</span>
                  <span style={{
                    padding: '2px 8px', borderRadius: 10, background: 'var(--bg)',
                    fontSize: 11, color: 'var(--muted)', fontWeight: 500,
                  }}>{group.members.length}</span>
                  <span style={{ fontSize: 11, color: 'var(--muted)' }}>{openDepts[group.name] ? '▲' : '▼'}</span>
                </div>
                {openDepts[group.name] && (
                  <div style={{ borderTop: '1px solid var(--border)' }}>
                    {group.members.map((m, i) => (
                      <div key={i} style={{
                        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                        padding: '8px 16px 8px 44px', fontSize: 13,
                        borderBottom: i < group.members.length - 1 ? '1px solid var(--border)' : 'none',
                      }}>
                        <span>{m.name}</span>
                        <span style={{ fontWeight: 600, color: 'var(--blue)', fontSize: 13 }}>{m.call}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Vehicles */}
      {content.vehicles?.length > 0 && (
        <div>
          <SectionHeader icon="🚗" title="Транспорт" count={content.vehicles.length} />
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {content.vehicles.map((v, i) => (
              <span key={i} style={{
                padding: '8px 16px', background: 'var(--white)', border: '1px solid var(--border)',
                borderRadius: 'var(--radius-btn)', fontSize: 13, display: 'flex', alignItems: 'center', gap: 6,
              }}>
                🚗 {v}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

/* ============================================================
   Plan Day View — same card structure as KPP
   ============================================================ */
function PlanDayView({ planDay, matched, onUnitClick }) {
  const [expandedScene, setExpandedScene] = useState(null)
  const [charFilter, setCharFilter] = useState('')
  const [search, setSearch] = useState('')
  const scenes = planDay?.scenes || []

  const characters = useMemo(() => {
    const c = new Set()
    for (const s of scenes) for (const ch of (s.characters || [])) c.add(ch)
    return [...c].sort()
  }, [scenes])

  const filtered = useMemo(() => {
    return scenes.filter(s => {
      if (charFilter && !(s.characters || []).includes(charFilter)) return false
      if (search) {
        const q = search.toLowerCase()
        const text = `${s.id} ${s.object} ${(s.characters||[]).join(' ')}`.toLowerCase()
        if (!text.includes(q)) return false
      }
      return true
    })
  }, [scenes, charFilter, search])

  return (
    <div>
      {planDay.shoot_days?.length > 0 && (
        <div style={{ display: 'flex', gap: 6, marginBottom: 16, flexWrap: 'wrap' }}>
          {planDay.shoot_days.map(sd => (
            <Chip key={sd.day_number} active={false}>
              С/Д {sd.day_number} · {sd.date} · {sd.scenes.length} сц.
            </Chip>
          ))}
        </div>
      )}

      <div className="dv-filters" style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
        <div style={{ position: 'relative', flex: 1, minWidth: 140 }}>
          <span style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', fontSize: 14, opacity: 0.5 }}>🔍</span>
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Найдите..."
            style={{ width: '100%', height: 36, padding: '0 12px 0 32px', border: '1px solid var(--border)', borderRadius: 'var(--radius-btn)', fontSize: 13, boxSizing: 'border-box' }} />
        </div>
        {characters.length > 0 && (
          <FilterSelect value={charFilter} onChange={setCharFilter} placeholder="Все персонажи" options={characters.map(c => ({ value: c, label: c }))} />
        )}
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {filtered.map(scene => (
          <SceneCard
            key={scene.id}
            scene={scene}
            delta={null}
            expanded={expandedScene === scene.id}
            onToggle={() => setExpandedScene(expandedScene === scene.id ? null : scene.id)}
            matched={matched || {}}
            onUnitClick={onUnitClick || (() => {})}
            onCharClick={c => setCharFilter(charFilter === c ? '' : c)}
          />
        ))}
        {filtered.length === 0 && <div style={{ textAlign: 'center', padding: '40px 0', color: 'var(--muted)', fontSize: 13 }}>Нет сцен</div>}
      </div>
    </div>
  )
}

/* ============================================================
   Shared UI components
   ============================================================ */
function Tag({ icon, children, color, bg }) {
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 4,
      padding: '3px 10px', borderRadius: 20, fontSize: 11, fontWeight: 500,
      background: bg || 'var(--bg)', color: color || 'var(--muted)',
    }}>
      {icon && <span style={{ fontSize: 12 }}>{icon}</span>}
      {children}
    </span>
  )
}

function Chip({ active, onClick, children }) {
  return (
    <button onClick={onClick} style={{
      padding: '6px 14px', borderRadius: 20,
      border: active ? '2px solid var(--blue)' : '1px solid var(--border)',
      background: active ? 'var(--blue-dim)' : 'var(--white)',
      color: active ? 'var(--blue)' : 'var(--text)',
      fontWeight: active ? 600 : 400,
      fontSize: 12, cursor: 'pointer', transition: 'all 0.15s',
    }}>
      {children}
    </button>
  )
}

function FilterSelect({ value, onChange, placeholder, options }) {
  return (
    <select value={value} onChange={e => onChange(e.target.value)}
      style={{
        height: 36, padding: '0 10px', border: '1px solid var(--border)',
        borderRadius: 'var(--radius-btn)', fontSize: 13,
        color: value ? 'var(--text)' : 'var(--muted)',
        background: 'var(--white)',
      }}>
      <option value="">{placeholder}</option>
      {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  )
}

function SectionHeader({ icon, title, count }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10,
      paddingBottom: 6, borderBottom: '1px solid var(--border)',
    }}>
      <span style={{ fontSize: 16 }}>{icon}</span>
      <span style={{ fontSize: 14, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5 }}>{title}</span>
      {count != null && (
        <span style={{ padding: '2px 8px', borderRadius: 10, background: 'var(--bg)', fontSize: 11, color: 'var(--muted)' }}>{count}</span>
      )}
    </div>
  )
}

function MatchedItem({ text, matched, onUnitClick }) {
  const key = text.toLowerCase().trim()
  const match = matched[key]
  if (match) {
    const isOnStock = match.unit_status === 'on_stock'
    return (
      <span onClick={() => onUnitClick(match.unit_id)}
        style={{
          display: 'inline-block', padding: '3px 10px', margin: '2px 4px 2px 0',
          borderRadius: 20, cursor: 'pointer',
          background: isOnStock ? 'rgba(34,197,94,0.12)' : 'rgba(234,179,8,0.12)',
          color: isOnStock ? 'var(--green)' : 'var(--amber)',
          fontSize: 12, fontWeight: 500, transition: 'all 0.15s',
        }}
        title={`${match.unit_name} — ${isOnStock ? 'на складе' : match.unit_status}`}>
        {text} {isOnStock ? '✓' : '⏳'}
      </span>
    )
  }
  return <span style={{ fontSize: 13, margin: '0 4px 0 0' }}>{text}, </span>
}

function DeltaBanner({ delta }) {
  const [expanded, setExpanded] = useState(false)
  return (
    <div style={{
      marginBottom: 16, padding: '14px 18px', borderRadius: 'var(--radius-card)',
      border: '1px solid var(--amber)', background: 'rgba(234,179,8,0.06)',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, cursor: 'pointer' }} onClick={() => setExpanded(!expanded)}>
        <span style={{ fontSize: 16 }}>⚡</span>
        <span style={{ fontSize: 14, fontWeight: 600 }}>Изменения с предыдущей версии</span>
        <div style={{ display: 'flex', gap: 8 }}>
          {delta.added?.length > 0 && <Badge color="green">+{delta.added.length}</Badge>}
          {delta.changed?.length > 0 && <Badge color="amber">~{delta.changed.length}</Badge>}
          {delta.removed?.length > 0 && <Badge color="red">-{delta.removed.length}</Badge>}
        </div>
        <span style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--muted)' }}>{expanded ? '▲' : '▼'}</span>
      </div>
      {expanded && (
        <div style={{ marginTop: 12, fontSize: 12, display: 'flex', flexDirection: 'column', gap: 3 }}>
          {delta.added?.map(a => <div key={a.id} style={{ color: 'var(--green)' }}>+ Сцена {a.id}: {a.object}</div>)}
          {delta.changed?.map(c => <div key={c.id} style={{ color: 'var(--amber)' }}>~ Сцена {c.id}: {c.object}</div>)}
          {delta.removed?.map(r => <div key={r.id} style={{ color: 'var(--red)', textDecoration: 'line-through' }}>- Сцена {r.id}: {r.object}</div>)}
        </div>
      )}
    </div>
  )
}

function BackHeader({ doc, navigate }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 24 }}>
      <button onClick={() => navigate('/production/documents')}
        style={{
          border: '1px solid var(--border)', background: 'var(--white)',
          cursor: 'pointer', fontSize: 16, padding: '6px 10px',
          borderRadius: 'var(--radius-btn)', display: 'flex', alignItems: 'center',
        }}>←</button>
      <div style={{ flex: 1 }}>
        <h1 style={{ fontSize: 20, fontWeight: 700, margin: 0 }}>
          {TYPE_LABELS[doc.type] || doc.type} <span style={{ fontWeight: 400, color: 'var(--muted)' }}>v{doc.version}</span>
        </h1>
        <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>
          {doc.original_name || ''} · {doc.uploaded_by_name || ''} · {new Date(doc.created_at).toLocaleDateString('ru-RU')}
        </div>
      </div>
      <Badge color={doc.status === 'parsed' ? 'green' : 'muted'}>{{ parsed: 'Проверено', uploaded: 'Загружено' }[doc.status] || doc.status}</Badge>
    </div>
  )
}

const RESPONSIVE_CSS = `
  @media (max-width: 768px) {
    .dv-page { padding: 12px 16px !important; }
    .dv-filters { flex-direction: column !important; }
    .dv-cast-row { grid-template-columns: 1fr 1fr !important; gap: 4px !important; }
  }
`
