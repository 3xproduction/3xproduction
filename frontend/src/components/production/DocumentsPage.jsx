import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { newStemmer } from 'snowball-stemmers'
import ProductionLayout from './ProductionLayout'
import Badge from '../shared/Badge'
import Button from '../shared/Button'
import { documents as docsApi, lists as listsApi, requests as requestsApi, projects as projectsApi, scenes as scenesApi, admin as adminApi } from '../../services/api'
import UnitCardModal from '../shared/UnitCardModal'
import ConfirmModal from '../shared/ConfirmModal'
import { useAuth } from '../../hooks/useAuth'
import { ROLES } from '../../constants/roles'

const ruStemmer = newStemmer('russian')

const DOC_TYPES = {
  kpp:       { label: 'КПП',      icon: '📋', color: 'blue' },
  scenario:  { label: 'Сценарий', icon: '📝', color: 'amber' },
  callsheet: { label: 'Вызывной', icon: '📅', color: 'green' },
}

const LIST_TYPES = {
  props:        { label: 'Реквизит',        icon: '🎭' },
  art_fill:     { label: 'Худ. наполнение', icon: '🖼️' },
  dummy:        { label: 'Бутафория',       icon: '🪆' },
  auto:         { label: 'Автомобили',      icon: '🚗' },
  decoration:   { label: 'Декорации',       icon: '🏗️' },
  costumes:     { label: 'Костюмы',         icon: '👗' },
  makeup:       { label: 'Грим',            icon: '💄' },
  stunts:       { label: 'Трюки',           icon: '🤸' },
  pyrotechnics: { label: 'Пиротехника',     icon: '🔥' },
  consultant:   { label: 'Консультант',     icon: '🎓' },
  locations:    { label: 'Локейшн',         icon: '📍' },
}

const SOURCE_BADGE = {
  kpp:      { label: 'КПП',      bg: 'var(--blue-dim)',  color: 'var(--blue)' },
  scenario: { label: 'Сценарий', bg: 'var(--amber-dim)', color: 'var(--amber)' },
  ai:       { label: 'ИИ',       bg: 'var(--green-dim)', color: 'var(--green)' },
  manual:   { label: 'Вручную',  bg: 'var(--bg)',        color: 'var(--muted)' },
}

// Синхронизировано с backend/src/constants/roleConfig.js SEE_ALL_ROLES
const SEE_ALL_ROLES = [
  'production_designer', 'art_director_assistant', 'first_assistant_director',
  'director', 'project_director', 'producer',
]
const HIDE_LIST_TYPES_ROLES = ['set_admin']

const UPLOAD_KPP_ROLES = [
  'producer', 'project_director', 'project_deputy_upload', 'director', 'assistant_director', 'first_assistant_director',
  'production_designer', 'art_director_assistant',
  'props_master', 'props_assistant', 'decorator', 'costumer', 'costume_designer', 'costume_assistant',
  'makeup_artist', 'stunt_coordinator', 'pyrotechnician',
]
const UPLOAD_CALLSHEET_ROLES = [...UPLOAD_KPP_ROLES, 'set_admin']

export default function DocumentsPage() {
  const navigate = useNavigate()
  const { user } = useAuth()
  const role = user?.role || ''
  const [tab, setTab] = useState('my_list')

  // Doc state
  const [docs, setDocs] = useState([])
  const [loading, setLoading] = useState(true)
  const [activeCallDate, setActiveCallDate] = useState(null)
  const [docSearch, setDocSearch] = useState('')
  const [blockFilter, setBlockFilter] = useState('')
  // seasonFilter removed — replaced by group-based filtering
  const [showUpload, setShowUpload] = useState(false)
  const [dragging, setDragging] = useState(false)
  const [uploadType, setUploadType] = useState('kpp')
  const [uploadFile, setUploadFile] = useState(null)
  const [uploading, setUploading] = useState(false)
  const [uploadMsg, setUploadMsg] = useState('')
  const fileRef = useRef()
  const uploadMsgTimer = useRef(null)

  // List state
  const roleDef = ROLES[role] || {}
  const ownListTypes = roleDef.ownLists === undefined ? [] :
    (roleDef.ownLists[0] === 'all' ? Object.keys(LIST_TYPES) : roleDef.ownLists)
  const canSeeAllLists = SEE_ALL_ROLES.includes(role)
  const hideListTypes = HIDE_LIST_TYPES_ROLES.includes(role)
  const visibleListTypes = hideListTypes ? [] : (canSeeAllLists ? Object.keys(LIST_TYPES) : ownListTypes)
  const [activeListType] = useState(visibleListTypes[0] || 'props')
  const [listItems, setListItems] = useState([])
  const [listLoading, setListLoading] = useState(false)
  const [listSearch, setListSearch] = useState('')
  const [matchedUnits, setMatchedUnits] = useState([])
  const [synonymMap, setSynonymMap] = useState({})
  const [cardId, setCardId] = useState(null)
  const [editingId, setEditingId] = useState(null)
  const [editForm, setEditForm] = useState({})
  const [showAddItem, setShowAddItem] = useState(false)
  const [addForm, setAddForm] = useState({ name: '', scene: '', day: '', qty: 1, note: '' })
  const [expandedItem, setExpandedItem] = useState(null)
  const [collapsedDays, setCollapsedDays] = useState({})
  const [daysInitialized, setDaysInitialized] = useState(false)
  const [cart, setCart] = useState([])
  const [showCart, setShowCart] = useState(false)
  const [cartSending, setCartSending] = useState(false)
  const [cartSuccess, setCartSuccess] = useState(false)
  const [showScrollTop, setShowScrollTop] = useState(false)
  const [confirmAction, setConfirmAction] = useState(null) // { title, message, onConfirm }
  const [projectScenes, setProjectScenes] = useState([])
  const [rebuilding, setRebuilding] = useState(false)

  // Groups (blocks) state
  const [groups, setGroups] = useState([])
  const [showGroupForm, setShowGroupForm] = useState(false)
  const [groupName, setGroupName] = useState('')
  const [uploadGroupId, setUploadGroupId] = useState('')
  const [collapsedGroups, setCollapsedGroups] = useState({})

  const canUpload = tab === 'callsheet'
    ? UPLOAD_CALLSHEET_ROLES.includes(role)
    : UPLOAD_KPP_ROLES.includes(role)

  const allowedDocs = ROLES[role]?.readDocs
  const visibleDocTypes = allowedDocs
    ? Object.fromEntries(Object.entries(DOC_TYPES).filter(([k]) => allowedDocs.includes(k)))
    : DOC_TYPES

  const [, setProjectsList] = useState([])
  const [selectedProjectId, setSelectedProjectId] = useState(user?.project_id || null)
  const isProducer = role === 'producer'
  const projectId = selectedProjectId

  useEffect(() => {
    if (isProducer) {
      projectsApi.list().then(d => {
        const list = d.projects || []
        setProjectsList(list)
        const savedName = localStorage.getItem('project')
        const match = list.find(p => p.name === savedName)
        if (match) setSelectedProjectId(match.id)
        else if (list.length) setSelectedProjectId(list[0].id)
      }).catch(() => {})
    }
  }, [])

  function loadDocs() {
    setLoading(true)
    const promise = isProducer
      ? docsApi.listAll()
      : projectId
        ? docsApi.list(projectId)
        : Promise.resolve({ documents: [] })
    promise.then(data => {
      setDocs(data.documents || [])
    }).finally(() => setLoading(false))
    // Load groups
    if (projectId) {
      docsApi.groups(projectId).then(d => setGroups(d.groups || [])).catch(() => {})
    }
  }

  useEffect(() => { loadDocs() }, [projectId])

  // Load project scenes for "Без даты" scene picker
  useEffect(() => {
    if (projectId) {
      scenesApi.list(projectId).then(d => setProjectScenes(d.scenes || [])).catch(() => {})
    }
  }, [projectId])

  async function handleCreateGroup() {
    if (!groupName.trim() || !projectId) return
    try {
      await docsApi.createGroup({ project_id: projectId, name: groupName.trim() })
      setGroupName('')
      setShowGroupForm(false)
      loadDocs()
    } catch (e) { alert(e.message || 'Ошибка') }
  }

  async function handleDeleteGroup(groupId, groupNameStr) {
    setConfirmAction({
      title: 'Удалить блок',
      message: `Удалить блок «${groupNameStr}»? Документы не будут удалены.`,
      onConfirm: async () => {
        setConfirmAction(null)
        try { await docsApi.deleteGroup(groupId); loadDocs() } catch (e) { alert(e.message || 'Ошибка') }
      },
    })
  }

  async function handleAssignGroup(docId, groupId) {
    try { await docsApi.assignGroup(docId, groupId || null); loadDocs() } catch (e) { alert(e.message || 'Ошибка') }
  }

  function loadListItems() {
    if (!activeListType || !projectId) return
    setListLoading(true)
    Promise.all([
      listsApi.items(activeListType, { project_id: projectId }),
      listsApi.matchedUnits(projectId),
    ]).then(([data, mu]) => {
      setListItems(data.items || [])
      setMatchedUnits(mu.matched_units || [])
    }).catch(() => setListItems([]))
      .finally(() => setListLoading(false))
    // Load synonyms from latest document's parsed_data (non-blocking)
    docsApi.list(projectId).then(resp => {
      const allDocs = resp.documents || []
      for (const d of allDocs) {
        const pd = typeof d.parsed_data === 'string' ? JSON.parse(d.parsed_data) : d.parsed_data
        if (pd?.synonyms && Object.keys(pd.synonyms).length) {
          setSynonymMap(pd.synonyms)
          break
        }
      }
    }).catch(() => {})
  }

  useEffect(() => {
    if (tab === 'my_list') loadListItems()
  }, [tab, activeListType, projectId])

  function getMatch(itemName) {
    if (!itemName || !matchedUnits.length) return null
    const lower = itemName.toLowerCase().trim()
    const words = lower.split(/\s+/).filter(w => w.length > 2)
    return matchedUnits.find(m => {
      const text = (m.text || '').toLowerCase()
      const unitName = (m.unit_name || '').toLowerCase()
      // Exact match
      if (text === lower || unitName === lower) return true
      // All significant words from item name must appear in unit name (or vice versa)
      const unitWords = unitName.split(/\s+/).filter(w => w.length > 2)
      const allItemWordsInUnit = words.length > 0 && words.every(w => unitName.includes(w))
      const allUnitWordsInItem = unitWords.length > 0 && unitWords.every(w => lower.includes(w))
      return allItemWordsInUnit || allUnitWordsInItem
    })
  }

  async function handleAddItem() {
    if (!addForm.name.trim()) return
    try {
      await listsApi.addItem(activeListType, { ...addForm, source: 'manual' })
      setShowAddItem(false)
      setAddForm({ name: '', scene: '', day: '', qty: 1, note: '' })
      loadListItems()
    } catch (e) { alert(e.message || 'Ошибка') }
  }

  async function handleEditSave(id) {
    try {
      await listsApi.updateItem(id, editForm)
      setEditingId(null)
      loadListItems()
    } catch (e) { alert(e.message || 'Ошибка') }
  }

  function handleDeleteItem(id, name) {
    setConfirmAction({
      title: 'Удалить позицию',
      message: name ? `Удалить «${name}» из списка?` : 'Удалить позицию из списка?',
      onConfirm: async () => {
        setConfirmAction(null)
        try { await listsApi.deleteItem(id); loadListItems() } catch (e) { alert(e.message || 'Ошибка') }
      },
    })
  }

  function addToCart(unitId) {
    if (!cart.includes(unitId)) setCart(c => [...c, unitId])
  }
  function removeFromCart(unitId) {
    setCart(c => c.filter(x => x !== unitId))
  }
  async function submitCart() {
    if (!cart.length) return
    setCartSending(true)
    try {
      await requestsApi.create({ unit_ids: cart, project_id: projectId })
      setCart([])
      setShowCart(false)
      setCartSuccess(true)
      setTimeout(() => setCartSuccess(false), 2500)
    } catch (e) { alert(e.message || 'Ошибка отправки заявки') }
    setCartSending(false)
  }

  useEffect(() => {
    function onScroll() { setShowScrollTop(window.scrollY > 400) }
    window.addEventListener('scroll', onScroll)
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  const tabDocs = docs.filter(d => d.type === tab)
  const callDates = [...new Set(docs.filter(d => d.type === 'callsheet').map(d =>
    new Date(d.created_at).toISOString().split('T')[0]
  ))].sort().reverse()
  const curDate = activeCallDate || callDates[0]
  const callsheetDoc = docs.find(d => d.type === 'callsheet' &&
    new Date(d.created_at).toISOString().split('T')[0] === curDate)

  const UPLOAD_MESSAGES = [
    'Расслабьтесь...',
    'Ищем реквизит...',
    'Ищем костюмы...',
    'Ищем грим...',
    'Ищем всё подряд...',
    'Мы — ищейки...',
    'Делаем вашу работу...',
    'Анализируем сцены...',
    'Раскладываем по полочкам...',
    'Почти готово...',
  ]

  function startUploadMessages() {
    let i = 0
    setUploadMsg(UPLOAD_MESSAGES[0])
    uploadMsgTimer.current = setInterval(() => {
      i = (i + 1) % UPLOAD_MESSAGES.length
      setUploadMsg(UPLOAD_MESSAGES[i])
    }, 2500)
  }

  function stopUploadMessages() {
    clearInterval(uploadMsgTimer.current)
    setUploadMsg('')
  }

  async function handleUpload() {
    if (!uploadFile) return
    const pid = projectId
    if (!pid) { alert('Выберите проект в боковом меню'); return }
    setUploading(true)
    startUploadMessages()
    try {
      const fd = new FormData()
      fd.append('file', uploadFile)
      fd.append('project_id', pid)
      fd.append('type', uploadType)
      if (uploadGroupId) fd.append('group_id', uploadGroupId)
      await docsApi.upload(fd)
      setShowUpload(false)
      setUploadFile(null)
      loadDocs()
    } catch (err) {
      alert(err.message || 'Ошибка загрузки')
    } finally {
      setUploading(false)
      stopUploadMessages()
    }
  }

  function onDrop(e) {
    e.preventDefault()
    setDragging(false)
    const file = e.dataTransfer.files[0]
    if (file) setUploadFile(file)
  }

  const allTabs = [
    ...Object.entries(visibleDocTypes).map(([key, t]) => ({ key, label: t.label, icon: t.icon })),
    { key: 'my_list', label: 'Мой список', icon: '📄' },
  ]

  return (
    <ProductionLayout>
      <style>{`
        .doc-mobile-filter { display: none; }
        @media (max-width: 768px) {
          .doc-page { padding: 16px !important; }
          .doc-header { flex-direction: column !important; align-items: flex-start !important; gap: 10px !important; }
          .doc-tabs { display: none !important; }
          .doc-mobile-filter { display: block !important; margin-bottom: 20px; }
          .doc-mobile-filter select { width: 100% !important; height: 40px; padding: 0 12px; border: 1px solid var(--border); border-radius: var(--radius-btn); font-size: 14px; font-weight: 500; background: var(--white); cursor: pointer; color: var(--text); }
          .doc-filters { flex-direction: column !important; align-items: stretch !important; }
          .doc-filters input { min-width: 0 !important; width: 100% !important; height: 40px !important; box-sizing: border-box !important; }
          .doc-filters select { width: 100% !important; }
          .doc-item-row { flex-wrap: wrap !important; gap: 10px !important; }
          .doc-item-actions { width: 100% !important; display: flex !important; }
          .doc-item-actions a, .doc-item-actions button { flex: 1 !important; text-align: center !important; }
          .doc-list-grid { display: flex !important; flex-direction: column !important; gap: 8px !important; }
          .doc-list-grid-header { display: none !important; }
          .doc-list-row { display: flex !important; flex-direction: column !important; gap: 4px !important; padding: 12px !important; }
          .doc-list-row > div { font-size: 13px !important; }
          .doc-list-search input { width: 100% !important; height: 40px !important; box-sizing: border-box !important; }
        }
      `}</style>
      <div className="doc-page" style={{ padding: '24px 32px', maxWidth: 860 }}>
        <div className="doc-header" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 }}>
          <div>
            <h1 style={{ fontSize: 20, fontWeight: 600 }}>Записи</h1>
            <p style={{ fontSize: 13, color: 'var(--muted)', marginTop: 2 }}>
              {isProducer ? 'Все проекты' : `Проект`}
            </p>
          </div>
          {canUpload && DOC_TYPES[tab] && (
            <Button onClick={() => { setUploadType(tab); setShowUpload(true) }}>+ Загрузить</Button>
          )}
        </div>

        {/* Mobile filter select */}
        <div className="doc-mobile-filter">
          <select value={tab} onChange={e => setTab(e.target.value)}>
            <option value="" disabled>Выбрать</option>
            {allTabs.map(t => <option key={t.key} value={t.key}>{t.label}</option>)}
          </select>
        </div>

        {/* Tab bar — desktop only */}
        <div className="doc-tabs" style={{ display: 'flex', gap: 0, marginBottom: 24, borderBottom: '1px solid var(--border)' }}>
          {allTabs.map(t => (
            <button key={t.key} className="doc-tab-btn" onClick={() => setTab(t.key)} style={{
              padding: '10px 20px', border: 'none', background: 'none',
              fontWeight: 500, fontSize: 14, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6,
              color: tab === t.key ? 'var(--blue)' : 'var(--muted)',
              borderBottom: `2px solid ${tab === t.key ? 'var(--blue)' : 'transparent'}`,
              marginBottom: -1, flexShrink: 0,
            }}>
              {t.icon} {t.label}
            </button>
          ))}
        </div>

        {loading && DOC_TYPES[tab] && <div style={{ color: 'var(--muted)', fontSize: 13 }}>Загрузка...</div>}

        {/* КПП / Сценарий */}
        {(tab === 'kpp' || tab === 'scenario') && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div className="doc-filters" style={{ display: 'flex', gap: 8, marginBottom: 4, flexWrap: 'wrap', alignItems: 'center' }}>
              <input value={docSearch} onChange={e => setDocSearch(e.target.value)}
                placeholder="Поиск по названию, серии, блоку..."
                style={{ flex: 1, minWidth: 140, height: 40, padding: '0 12px', border: '1px solid var(--border)', borderRadius: 'var(--radius-btn)', fontSize: 13, outline: 'none', boxSizing: 'border-box' }} />
              {groups.length > 0 && (
                <select value={blockFilter} onChange={e => setBlockFilter(e.target.value)}
                  style={{ height: 40, padding: '0 10px', border: '1px solid var(--border)', borderRadius: 'var(--radius-btn)', fontSize: 13, background: blockFilter ? 'var(--blue-dim)' : 'var(--white)', color: blockFilter ? 'var(--blue)' : 'var(--text)', cursor: 'pointer' }}>
                  <option value="">Все блоки</option>
                  {groups.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
                  <option value="_none">Без блока</option>
                </select>
              )}
              {(isProducer || role === 'project_director') && (
                showGroupForm ? (
                  <div style={{ display: 'flex', gap: 4 }}>
                    <input value={groupName} onChange={e => setGroupName(e.target.value)} placeholder="Название блока"
                      style={{ height: 40, padding: '0 10px', border: '1px solid var(--border)', borderRadius: 'var(--radius-btn)', fontSize: 13, width: 160 }}
                      onKeyDown={e => e.key === 'Enter' && handleCreateGroup()} />
                    <Button style={{ height: 40, fontSize: 13 }} onClick={handleCreateGroup}>OK</Button>
                    <Button variant="secondary" style={{ height: 40, fontSize: 13 }} onClick={() => { setShowGroupForm(false); setGroupName('') }}>X</Button>
                  </div>
                ) : (
                  <Button variant="secondary" style={{ height: 40, fontSize: 13 }} onClick={() => setShowGroupForm(true)}>+ Блок</Button>
                )
              )}
            </div>

            {/* Group headers and docs */}
            {(() => {
              const filteredDocs = tabDocs.filter(d => {
                if (docSearch) {
                  const words = docSearch.toLowerCase().split(/\s+/).filter(Boolean)
                  const haystack = [d.original_name, d.file_url, d.uploaded_by_name, `v${d.version}`, d.group_name].filter(Boolean).join(' ').toLowerCase()
                  if (!words.every(w => haystack.includes(w))) return false
                }
                if (blockFilter && blockFilter !== '_none' && d.group_id !== blockFilter) return false
                if (blockFilter === '_none' && d.group_id) return false
                return true
              })

              // Group docs by group_id
              const grouped = []
              const byGroup = {}
              for (const d of filteredDocs) {
                const gid = d.group_id || '_none'
                if (!byGroup[gid]) { byGroup[gid] = []; grouped.push(gid) }
                byGroup[gid].push(d)
              }
              // Sort: named groups first (by sort_order), then ungrouped
              const sortedGroupIds = grouped.sort((a, b) => {
                if (a === '_none') return 1
                if (b === '_none') return -1
                const ga = groups.find(g => g.id === a)
                const gb = groups.find(g => g.id === b)
                return (ga?.sort_order || 0) - (gb?.sort_order || 0)
              })

              return sortedGroupIds.map(gid => {
                const groupDocs = byGroup[gid]
                const group = groups.find(g => g.id === gid)
                const isGroupCollapsed = collapsedGroups[gid]

                return (
                  <div key={gid}>
                    {group && (
                      <div onClick={() => setCollapsedGroups(prev => ({ ...prev, [gid]: !prev[gid] }))}
                        style={{
                          padding: '10px 14px', marginBottom: 6,
                          background: 'var(--blue-dim)', borderRadius: 8, fontWeight: 600, fontSize: 13,
                          display: 'flex', alignItems: 'center', gap: 10,
                          borderLeft: '3px solid var(--blue)', cursor: 'pointer', userSelect: 'none',
                        }}>
                        <span style={{ fontSize: 12, transition: 'transform 0.15s', transform: isGroupCollapsed ? 'rotate(-90deg)' : 'rotate(0deg)' }}>▼</span>
                        <span>{group.name}</span>
                        <span style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 400, marginLeft: 'auto' }}>{groupDocs.length} док.</span>
                        {(isProducer || role === 'project_director') && (
                          <button onClick={e => { e.stopPropagation(); handleDeleteGroup(gid, group.name) }}
                            style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 13, color: 'var(--muted)', padding: '2px 4px' }}>🗑️</button>
                        )}
                      </div>
                    )}
                    {(!group || !isGroupCollapsed) && groupDocs.map((doc, i) => (
              <div key={doc.id} style={{
                background: 'var(--white)', border: '1px solid var(--border)',
                borderRadius: 'var(--radius-card)', padding: '16px',
              }}>
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 14, flexWrap: 'wrap' }}>
                  <div style={{
                    width: 44, height: 44, borderRadius: 10, flexShrink: 0,
                    background: DOC_TYPES[doc.type].color === 'blue' ? 'var(--blue-dim)' : 'var(--amber-dim)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20,
                  }}>
                    {DOC_TYPES[doc.type].icon}
                  </div>

                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                      <span style={{ fontWeight: 500, fontSize: 14 }}>v{doc.version}</span>
                      <Badge color={i === 0 ? 'blue' : 'muted'}>v{doc.version}</Badge>
                      {i === 0 && <Badge color="green">Актуальная</Badge>}
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 4 }}>
                      {new Date(doc.created_at).toLocaleDateString('ru-RU')} · {doc.uploaded_by_name || '—'}
                    </div>

                    {doc.delta && (() => {
                      let d = doc.delta
                      if (typeof d === 'string') try { d = JSON.parse(d) } catch {}
                      return (
                        <div style={{ marginTop: 10, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                          {d.added?.length > 0 && <DeltaBadge color="green" icon="+" label={`Добавлено ${d.added.length}`} />}
                          {d.changed?.length > 0 && <DeltaBadge color="amber" icon="~" label={`Изменено ${d.changed.length}`} />}
                          {d.removed?.length > 0 && <DeltaBadge color="red" icon="−" label={`Удалено ${d.removed.length}`} />}
                        </div>
                      )
                    })()}
                  </div>

                  <div className="doc-item-actions" style={{ display: 'flex', gap: 8, flexShrink: 0, alignItems: 'center' }}>
                    {doc.parsed_content && (
                      <Button variant="secondary" style={{ height: 34, fontSize: 13, padding: '0 12px' }}
                        onClick={() => navigate(`/production/documents/${projectId}/${doc.id}`)}>
                        Открыть
                      </Button>
                    )}
                    {!doc.parsed_content && doc.file_url && (
                      <a href={doc.file_url} target="_blank" rel="noreferrer">
                        <Button variant="secondary" style={{ height: 34, fontSize: 13, padding: '0 12px' }}>Скачать</Button>
                      </a>
                    )}
                    {(isProducer || role === 'project_director') && groups.length > 0 && (
                      <select value={doc.group_id || ''} onChange={e => handleAssignGroup(doc.id, e.target.value)}
                        onClick={e => e.stopPropagation()}
                        style={{ height: 30, fontSize: 11, padding: '0 6px', border: '1px solid var(--border)', borderRadius: 6, background: doc.group_id ? 'var(--blue-dim)' : 'var(--white)', color: doc.group_id ? 'var(--blue)' : 'var(--muted)', cursor: 'pointer' }}>
                        <option value="">Без блока</option>
                        {groups.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
                      </select>
                    )}
                    {isProducer && (
                      <button onClick={e => {
                        e.stopPropagation()
                        setConfirmAction({
                          title: `Удалить ${DOC_TYPES[doc.type]?.label || ''} v${doc.version}`,
                          message: 'Документ и связанные позиции списка будут удалены.',
                          onConfirm: () => {
                            setConfirmAction(null)
                            docsApi.remove(doc.id).then(() => { loadDocs(); loadListItems() }).catch(() => {})
                          },
                        })
                      }} title="Удалить" style={{
                        background: 'none', border: 'none', cursor: 'pointer', fontSize: 16,
                        color: 'var(--muted)', padding: '4px', display: 'flex', alignItems: 'center',
                      }}>🗑️</button>
                    )}
                  </div>
                </div>
              </div>
            ))}
                  </div>
                )
              })
            })()}
            {!loading && tabDocs.length === 0 && (
              <div style={{ textAlign: 'center', padding: '60px 0', color: 'var(--muted)', fontSize: 14 }}>
                Нет документов
              </div>
            )}
          </div>
        )}

        {/* Вызывной */}
        {tab === 'callsheet' && (
          <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap' }}>
            <div style={{ width: 160, flexShrink: 0 }}>
              <div style={{ fontSize: 12, color: 'var(--muted)', fontWeight: 500, marginBottom: 10, textTransform: 'uppercase', letterSpacing: '0.6px' }}>
                Даты
              </div>
              {callDates.map(d => {
                const isToday = d === new Date().toISOString().split('T')[0]
                return (
                  <button key={d} onClick={() => setActiveCallDate(d)} style={{
                    width: '100%', padding: '10px 12px', borderRadius: 8, marginBottom: 4,
                    border: `1px solid ${curDate === d ? 'var(--blue)' : 'var(--border)'}`,
                    background: curDate === d ? 'var(--blue-dim)' : 'var(--white)',
                    color: curDate === d ? 'var(--blue)' : 'var(--text)',
                    fontSize: 13, fontWeight: curDate === d ? 600 : 400,
                    cursor: 'pointer', textAlign: 'left', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  }}>
                    {new Date(d).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })}
                    {isToday && <span style={{ fontSize: 10, background: 'var(--blue)', color: '#fff', padding: '1px 6px', borderRadius: 8 }}>Сегодня</span>}
                  </button>
                )
              })}
            </div>

            <div style={{ flex: 1, minWidth: 0 }}>
              {callsheetDoc ? (
                <div style={{ background: 'var(--white)', border: '1px solid var(--border)', borderRadius: 'var(--radius-card)', overflow: 'hidden' }}>
                  <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
                    <div>
                      <div style={{ fontWeight: 600 }}>Вызывной</div>
                      <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>
                        {new Date(callsheetDoc.created_at).toLocaleDateString('ru-RU')} · {callsheetDoc.uploaded_by_name || '—'}
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: 8 }}>
                      {callsheetDoc.parsed_content && (
                        <Button variant="secondary" style={{ height: 34, fontSize: 13 }}
                          onClick={() => navigate(`/production/documents/${projectId}/${callsheetDoc.id}`)}>
                          Открыть
                        </Button>
                      )}
                      {callsheetDoc.file_url && (
                        <a href={callsheetDoc.file_url} target="_blank" rel="noreferrer">
                          <Button variant="secondary" style={{ height: 34, fontSize: 13 }}>Скачать</Button>
                        </a>
                      )}
                    </div>
                  </div>
                  {callsheetDoc.parsed_content ? (
                    <div style={{ padding: '16px 20px', fontSize: 13 }}>
                      {(() => {
                        const c = typeof callsheetDoc.parsed_content === 'string' ? JSON.parse(callsheetDoc.parsed_content) : callsheetDoc.parsed_content
                        return (
                          <div>
                            {c.cast?.length > 0 && c.cast.map((a, i) => (
                              <div key={i} style={{ display: 'flex', gap: 16, padding: '6px 0', borderBottom: '1px solid var(--border)', flexWrap: 'wrap' }}>
                                <span style={{ fontWeight: 500, minWidth: 120 }}>{a.role}</span>
                                <span>{a.actor}</span>
                                <span style={{ color: 'var(--muted)', marginLeft: 'auto' }}>{a.call}</span>
                              </div>
                            ))}
                            {(!c.cast || c.cast.length === 0) && <div style={{ color: 'var(--muted)', textAlign: 'center', padding: 40 }}>Нет данных</div>}
                          </div>
                        )
                      })()}
                    </div>
                  ) : (
                    <div style={{ height: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--bg)', color: 'var(--muted)', fontSize: 14 }}>
                      Загрузите вызывной (.xlsx)
                    </div>
                  )}
                </div>
              ) : (
                <div style={{ textAlign: 'center', padding: '80px 0', color: 'var(--muted)' }}>
                  Нет вызывного на эту дату
                </div>
              )}
            </div>
          </div>
        )}

        {/* Мой список */}
        {tab === 'my_list' && (
          <div>
            {listLoading ? (
              <div style={{ color: 'var(--muted)', fontSize: 13 }}>Загрузка...</div>
            ) : (
              <>
                <div style={{ display: 'flex', gap: 8, marginBottom: 14, alignItems: 'center', flexWrap: 'wrap' }}>
                  <div className="doc-list-search" style={{ position: 'relative', flex: 1, minWidth: 160 }}>
                    <span style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--muted)', fontSize: 14 }}>🔍</span>
                    <input value={listSearch} onChange={e => { setListSearch(e.target.value); if (e.target.value) setCollapsedDays({}) }} placeholder="Поиск по названию, сцене, содержанию..."
                      style={{ width: '100%', height: 40, padding: '0 10px 0 32px', border: '1px solid var(--border)', borderRadius: 'var(--radius-btn)', fontSize: 13, background: 'var(--white)', outline: 'none', boxSizing: 'border-box' }} />
                  </div>
                  <Button onClick={() => setShowAddItem(true)} style={{ height: 40, fontSize: 13 }}>+ Добавить</Button>
                  {isProducer && projectId && (
                    <Button variant="secondary" disabled={rebuilding}
                      style={{ height: 40, fontSize: 12 }}
                      onClick={async () => {
                        if (!confirm('Пересобрать все позиции проекта из документов? Ручные позиции сохранятся.')) return
                        setRebuilding(true)
                        try {
                          const r = await adminApi.rebuildPositions(projectId)
                          alert(`Готово! Удалено: ${r.deleted}, импортировано: ${r.imported}`)
                          loadListItems()
                          scenesApi.list(projectId).then(d => setProjectScenes(d.scenes || [])).catch(() => {})
                        } catch (err) { alert('Ошибка: ' + (err.message || 'unknown')) }
                        finally { setRebuilding(false) }
                      }}>
                      {rebuilding ? 'Пересборка...' : 'Пересобрать'}
                    </Button>
                  )}
                </div>

                <div className="doc-list-grid">
                  {(() => {
                    // Fuzzy search: split query into words, match if all words found in name+scene+note+location
                    function fuzzyMatch(item, query) {
                      if (!query) return true
                      const words = query.toLowerCase().split(/\s+/).filter(Boolean)
                      const haystack = [item.name, item.scene, item.note, item.location, item.day, item.time].filter(Boolean).join(' ').toLowerCase()
                      return words.every(w => haystack.includes(w))
                    }

                    function parseDateNum(day) {
                      if (!day) return 99999999
                      const m = day.match(/(\d{1,2})[.\-/](\d{1,2})/)
                      if (m) return parseInt(m[2]) * 100 + parseInt(m[1]) // month*100 + day for correct sort
                      const n = parseInt(day.replace(/\D/g, ''))
                      return isNaN(n) ? 99999999 : n
                    }

                    const filtered = listItems
                      .filter(i => i.ai_status !== 'rejected' && fuzzyMatch(i, listSearch))
                      .sort((a, b) => {
                        const dayA = parseDateNum(a.day)
                        const dayB = parseDateNum(b.day)
                        if (dayA !== dayB) return dayA - dayB
                        return (a.scene || '').localeCompare(b.scene || '')
                      })

                    // Build cross-scene map from AI analysis (latest scenario doc)
                    const crossSceneMap = {}
                    const latestScenario = docs.filter(d => d.type === 'scenario' && (!isProducer || d.project_id === projectId)).sort((a, b) => b.version - a.version)[0]
                    if (latestScenario) {
                      const pd = typeof latestScenario.parsed_data === 'string' ? JSON.parse(latestScenario.parsed_data) : latestScenario.parsed_data
                      if (pd?.cross_scenes) {
                        for (const cs of pd.cross_scenes) {
                          crossSceneMap[cs.name.toLowerCase().trim()] = { scenes: cs.scenes, reason: cs.reason, category: cs.category }
                        }
                      }
                    }

                    // Group by shoot date
                    const withDate = filtered.filter(i => i.day)
                    const withoutDate = filtered.filter(i => !i.day)
                    const groups = []
                    let lastDay = null
                    for (const item of withDate) {
                      if (item.day !== lastDay) {
                        groups.push({ day: item.day, time: item.time, items: [] })
                        lastDay = item.day
                      }
                      groups[groups.length - 1].items.push(item)
                    }
                    if (withoutDate.length) {
                      groups.push({ day: '_nodate', time: '', items: withoutDate })
                    }

                    // Initialize all days as collapsed on first render
                    if (!daysInitialized && groups.length > 0 && !listSearch) {
                      const init = {}
                      groups.forEach(g => { init[g.day] = true })
                      setTimeout(() => { setCollapsedDays(init); setDaysInitialized(true) }, 0)
                    }

                    return groups.map((group, gi) => {
                      const isCollapsed = !listSearch && collapsedDays[group.day]
                      return (
                      <div key={group.day}>
                        <div onClick={() => setCollapsedDays(prev => ({ ...prev, [group.day]: !prev[group.day] }))}
                          style={{
                          padding: '10px 14px', marginBottom: isCollapsed ? 2 : 6, marginTop: gi > 0 ? 10 : 0,
                          background: 'var(--blue-dim)', borderRadius: 8, fontWeight: 600, fontSize: 13,
                          display: 'flex', alignItems: 'center', gap: 10,
                          borderLeft: '3px solid var(--blue)', cursor: 'pointer', userSelect: 'none',
                        }}>
                          <span style={{ fontSize: 12, transition: 'transform 0.15s', transform: isCollapsed ? 'rotate(-90deg)' : 'rotate(0deg)' }}>▼</span>
                          <span>{group.day === '_nodate' ? '📎 Без даты' : `📅 ${group.day}`}</span>
                          {group.time && <span style={{ fontSize: 11, color: 'var(--blue)', fontWeight: 500 }}>{group.time}</span>}
                          <span style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 400, marginLeft: 'auto' }}>{group.items.length} позиций</span>
                        </div>
                        {!isCollapsed && group.items.map(item => {
                    const src = SOURCE_BADGE[item.source] || SOURCE_BADGE.manual
                    const match = getMatch(item.name)
                      const isEditing = editingId === item.id

                      if (isEditing) {
                        return (
                          <div key={item.id} style={{ background: 'var(--white)', border: '2px solid var(--blue)', borderRadius: 8, padding: 14, marginBottom: 4 }}>
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 8 }}>
                              <input placeholder="Название" value={editForm.name || ''} onChange={e => setEditForm(f => ({ ...f, name: e.target.value }))}
                                style={{ height: 34, padding: '0 10px', border: '1px solid var(--border)', borderRadius: 6, fontSize: 13 }} />
                              <input placeholder="Сцена" value={editForm.scene || ''} onChange={e => setEditForm(f => ({ ...f, scene: e.target.value }))}
                                style={{ height: 34, padding: '0 10px', border: '1px solid var(--border)', borderRadius: 6, fontSize: 13 }} />
                              <input placeholder="День" value={editForm.day || ''} onChange={e => setEditForm(f => ({ ...f, day: e.target.value }))}
                                style={{ height: 34, padding: '0 10px', border: '1px solid var(--border)', borderRadius: 6, fontSize: 13 }} />
                              <input placeholder="Кол-во" type="number" value={editForm.qty || 1} onChange={e => setEditForm(f => ({ ...f, qty: Number(e.target.value) }))}
                                style={{ height: 34, padding: '0 10px', border: '1px solid var(--border)', borderRadius: 6, fontSize: 13 }} />
                            </div>
                            <input placeholder="Заметка" value={editForm.note || ''} onChange={e => setEditForm(f => ({ ...f, note: e.target.value }))}
                              style={{ width: '100%', height: 34, padding: '0 10px', border: '1px solid var(--border)', borderRadius: 6, fontSize: 13, marginBottom: 8, boxSizing: 'border-box' }} />
                            <div style={{ display: 'flex', gap: 8 }}>
                              <Button style={{ height: 32, fontSize: 12 }} onClick={() => handleEditSave(item.id)}>Сохранить</Button>
                              <Button variant="secondary" style={{ height: 32, fontSize: 12 }} onClick={() => setEditingId(null)}>Отмена</Button>
                            </div>
                          </div>
                        )
                      }

                      return (
                        <div key={item.id} className="doc-list-row" style={{
                          background: 'var(--white)', borderRadius: 8,
                          border: '1px solid var(--border)',
                          padding: '11px 14px', marginBottom: 4,
                        }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: match ? 8 : 0, flexWrap: 'wrap' }}>
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <div style={{ fontWeight: 500, fontSize: 13, cursor: (item.note || item.source === 'ai' || item.scene) ? 'pointer' : 'default', color: (item.note || item.source === 'ai' || item.scene) ? 'var(--blue)' : 'var(--text)' }}
                                onClick={() => (item.note || item.source === 'ai' || item.scene) && setExpandedItem(expandedItem === item.id ? null : item.id)}>
                                {item.name}
                                {(item.note || item.source === 'ai' || item.scene) && <span style={{ fontSize: 10, marginLeft: 6, color: 'var(--muted)' }}>{expandedItem === item.id ? '▲' : '▼'}</span>}
                              </div>
                              <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>
                                {[item.scene && `Сц. ${item.scene}`, item.time, item.location].filter(Boolean).join(' · ') || ''}
                              </div>
                              {(() => {
                                const cross = crossSceneMap[item.name.toLowerCase().trim()]
                                if (!cross) return null
                                return (
                                  <div style={{ marginTop: 3 }}>
                                    <div style={{
                                      padding: '2px 8px', borderRadius: 12,
                                      background: 'rgba(139,92,246,0.08)', color: '#7c3aed',
                                      fontSize: 10, fontWeight: 500, display: 'inline-block',
                                    }}>
                                      Сквозная: сц. {cross.scenes.sort((a, b) => a.localeCompare(b, undefined, { numeric: true })).join(', ')}
                                    </div>
                                    {cross.reason && <div style={{ fontSize: 10, color: 'var(--muted)', marginTop: 2 }}>{cross.reason}</div>}
                                  </div>
                                )
                              })()}
                            </div>
                            <div style={{ fontSize: 13, fontWeight: 500, flexShrink: 0 }}>{item.qty} шт.</div>
                            <span style={{
                              padding: '2px 7px', borderRadius: 'var(--radius-badge)',
                              background: src.bg, color: src.color, fontSize: 10, fontWeight: 500,
                            }}>{src.label}</span>
                            <button onClick={() => { setEditingId(item.id); setEditForm({ name: item.name, scene: item.scene, day: item.day, qty: item.qty, note: item.note }) }}
                              style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 14, color: 'var(--muted)', padding: '2px 4px' }} title="Редактировать">✏️</button>
                            <button onClick={() => handleDeleteItem(item.id, item.name)}
                              style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 14, color: 'var(--muted)', padding: '2px 4px' }} title="Удалить">🗑️</button>
                          </div>

                          {/* Scene picker for "Без даты" items */}
                          {group.day === '_nodate' && projectScenes.length > 0 && (
                            <div style={{ marginTop: 6, marginBottom: 4 }}>
                              <select
                                style={{ height: 30, fontSize: 11, padding: '0 8px', border: '1px solid var(--border)', borderRadius: 6, color: 'var(--muted)', background: 'var(--white)', cursor: 'pointer' }}
                                defaultValue=""
                                onChange={async (e) => {
                                  if (!e.target.value) return
                                  try {
                                    await listsApi.assignScene(item.id, e.target.value)
                                    loadListItems()
                                  } catch (err) { console.error(err) }
                                }}
                              >
                                <option value="">Привязать к сцене...</option>
                                {projectScenes.map(s => (
                                  <option key={s.canonical_id} value={s.canonical_id}>
                                    {s.canonical_id} — {s.object || s.synopsis || '?'} {s.date ? `(${s.date})` : ''}
                                  </option>
                                ))}
                              </select>
                            </div>
                          )}

                          {match && (
                            <div style={{
                              display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px',
                              background: 'var(--bg)', borderRadius: 8, cursor: 'pointer',
                            }} onClick={() => setCardId(match.unit_id)}>
                              {match.photo_url
                                ? <img src={match.photo_url} alt="" style={{ width: 36, height: 36, borderRadius: 6, objectFit: 'cover', flexShrink: 0 }} />
                                : <div style={{ width: 36, height: 36, borderRadius: 6, background: 'var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, flexShrink: 0 }}>📦</div>
                              }
                              <div style={{ flex: 1, minWidth: 0 }}>
                                <div style={{ fontSize: 12, fontWeight: 500 }}>{match.unit_name}</div>
                                <div style={{ fontSize: 10, color: 'var(--green)' }}>На складе</div>
                              </div>
                              {cart.includes(match.unit_id) ? (
                                <button onClick={e => { e.stopPropagation(); removeFromCart(match.unit_id) }}
                                  style={{ padding: '4px 10px', borderRadius: 6, border: '1px solid var(--red)', background: 'var(--red-dim)', color: 'var(--red)', fontSize: 11, fontWeight: 500, cursor: 'pointer', flexShrink: 0 }}>
                                  Убрать
                                </button>
                              ) : (
                                <button onClick={e => { e.stopPropagation(); addToCart(match.unit_id) }}
                                  style={{ padding: '4px 10px', borderRadius: 6, border: '1px solid var(--blue)', background: 'var(--blue-dim)', color: 'var(--blue)', fontSize: 11, fontWeight: 500, cursor: 'pointer', flexShrink: 0 }}>
                                  В корзину
                                </button>
                              )}
                            </div>
                          )}
                          {expandedItem === item.id && (item.note || item.source === 'ai' || item.scene) && (() => {
                            const parts = (item.note || '').split('\n---\n')
                            const blocks = []
                            for (const part of parts) {
                              const trimmed = part.trim()
                              if (!trimmed) continue
                              if (trimmed.startsWith('🤖 ')) {
                                blocks.push({ type: 'ai', text: trimmed.replace(/^🤖\s*/, '') })
                              } else if (trimmed.startsWith('📝 ')) {
                                blocks.push({ type: 'scenario', text: trimmed.replace(/^📝\s*/, '') })
                              } else {
                                blocks.push({ type: 'kpp', text: trimmed })
                              }
                            }
                            if (item.source === 'ai' && !blocks.some(b => b.type === 'ai')) {
                              blocks.unshift({ type: 'ai', text: 'Добавлено ИИ на основе анализа сценария' })
                            }
                            if (blocks.length === 0 && item.scene) {
                              const infoText = [item.location, item.day && `День: ${item.day}`, item.time].filter(Boolean).join(' · ') || `Сцена ${item.scene}`
                              blocks.push({ type: 'kpp', text: infoText })
                            }
                            const BLOCK_STYLES = {
                              kpp: { border: 'var(--amber)', bg: 'var(--bg)', label: 'КПП' },
                              scenario: { border: 'var(--blue)', bg: 'rgba(99,102,241,0.04)', label: 'Сценарий' },
                              ai: { border: 'var(--green)', bg: 'rgba(34,197,94,0.04)', label: 'Пометка ИИ' },
                            }
                            return (
                              <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 6 }}>
                                {blocks.map((block, bi) => {
                                  const s = BLOCK_STYLES[block.type]
                                  return (
                                    <div key={bi} style={{
                                      padding: '10px 12px', background: s.bg, borderRadius: 8,
                                      borderLeft: `3px solid ${s.border}`, fontSize: 12, lineHeight: 1.6,
                                    }}>
                                      <div style={{ fontSize: 10, fontWeight: 600, color: s.border, marginBottom: 4 }}>
                                        {s.label} · Сцена {item.scene || '—'}
                                      </div>
                                      {(() => {
                                        // Highlight item name + synonyms in scenario text using Snowball stemmer
                                        if (block.type !== 'scenario') return block.text
                                        const itemName = (item.name || '').trim()
                                        if (itemName.length < 3) return block.text
                                        const STOP_WORDS = new Set(['на','от','из','за','по','для','при','без','над','под','про','как','что','это','или','так','все','вот','его','они','она','уже','еще','тут','там','мне','мой','наш','ваш','где','кто','чем','чей','той','тех','эти','тем','нас','вас','них','нем','ней','ним','вам','нам','всё'])
                                        // Collect stems from item name + synonyms from AI
                                        const allWords = itemName.split(/\s+/).filter(w => w.length >= 3 && !STOP_WORDS.has(w.toLowerCase()))
                                        const syns = synonymMap[itemName.toLowerCase()] || []
                                        for (const syn of syns) {
                                          for (const w of syn.split(/\s+/)) {
                                            if (w.length >= 3 && !STOP_WORDS.has(w.toLowerCase())) allWords.push(w)
                                          }
                                        }
                                        if (!allWords.length) return block.text
                                        const allStems = new Set(allWords.map(w => ruStemmer.stem(w.toLowerCase())))
                                        const textToHighlight = block.text.replace(/<[^>]+>/g, '')
                                        const parts = textToHighlight.split(/([а-яёА-ЯЁa-zA-Z0-9-]+)/g)
                                        let hasMatch = false
                                        const rendered = parts.map((p, pi) => {
                                          if (/^[а-яёА-ЯЁa-zA-Z0-9-]+$/.test(p) && p.length >= 3) {
                                            const wordStem = ruStemmer.stem(p.toLowerCase())
                                            if (allStems.has(wordStem)) {
                                              hasMatch = true
                                              return <mark key={pi} style={{ background: '#fef08a', borderRadius: 2, padding: '0 2px' }}>{p}</mark>
                                            }
                                          }
                                          return p
                                        })
                                        return hasMatch ? rendered : block.text
                                      })()}
                                    </div>
                                  )
                                })}
                              </div>
                            )
                          })()}
                        </div>
                      )
                    })}
                      </div>
                    )})
                  })()}
                </div>

                {listItems.length === 0 && (
                  <div style={{ textAlign: 'center', padding: '60px 0', color: 'var(--muted)', fontSize: 14 }}>
                    Список пуст — загрузите КПП или сценарий
                  </div>
                )}
              </>
            )}

            {/* Add item modal */}
            {showAddItem && (
              <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 400, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}
                onClick={() => setShowAddItem(false)}>
                <div style={{ background: 'var(--white)', borderRadius: 'var(--radius-card)', padding: 24, maxWidth: 420, width: '100%' }}
                  onClick={e => e.stopPropagation()}>
                  <div style={{ fontWeight: 600, fontSize: 16, marginBottom: 16 }}>Добавить позицию</div>
                  <input placeholder="Название *" value={addForm.name} onChange={e => setAddForm(f => ({ ...f, name: e.target.value }))}
                    style={{ width: '100%', height: 38, padding: '0 10px', border: '1px solid var(--border)', borderRadius: 'var(--radius-btn)', fontSize: 13, marginBottom: 8, boxSizing: 'border-box' }} />
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 80px', gap: 8, marginBottom: 8 }}>
                    <input placeholder="Сцена" value={addForm.scene} onChange={e => setAddForm(f => ({ ...f, scene: e.target.value }))}
                      style={{ height: 38, padding: '0 10px', border: '1px solid var(--border)', borderRadius: 'var(--radius-btn)', fontSize: 13 }} />
                    <input placeholder="День" value={addForm.day} onChange={e => setAddForm(f => ({ ...f, day: e.target.value }))}
                      style={{ height: 38, padding: '0 10px', border: '1px solid var(--border)', borderRadius: 'var(--radius-btn)', fontSize: 13 }} />
                    <input placeholder="Кол-во" type="number" value={addForm.qty} onChange={e => setAddForm(f => ({ ...f, qty: Number(e.target.value) }))}
                      style={{ height: 38, padding: '0 10px', border: '1px solid var(--border)', borderRadius: 'var(--radius-btn)', fontSize: 13 }} />
                  </div>
                  <input placeholder="Заметка" value={addForm.note} onChange={e => setAddForm(f => ({ ...f, note: e.target.value }))}
                    style={{ width: '100%', height: 38, padding: '0 10px', border: '1px solid var(--border)', borderRadius: 'var(--radius-btn)', fontSize: 13, marginBottom: 12, boxSizing: 'border-box' }} />
                  <div style={{ display: 'flex', gap: 8 }}>
                    <Button variant="secondary" fullWidth onClick={() => setShowAddItem(false)}>Отмена</Button>
                    <Button fullWidth disabled={!addForm.name.trim()} onClick={handleAddItem}>Добавить</Button>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {cardId && <UnitCardModal unitId={cardId} onClose={() => setCardId(null)} />}

        <ConfirmModal
          open={!!confirmAction}
          title={confirmAction?.title}
          message={confirmAction?.message}
          onConfirm={confirmAction?.onConfirm || (() => setConfirmAction(null))}
          onCancel={() => setConfirmAction(null)}
        />

        {/* Upload modal */}
        {showUpload && (
          <div style={{
            position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)',
            zIndex: 300, display: 'flex', alignItems: 'center', justifyContent: 'center',
            padding: 24,
          }} onClick={() => setShowUpload(false)}>
            <div style={{
              background: 'var(--white)', borderRadius: 'var(--radius-card)',
              padding: 28, maxWidth: 480, width: '100%',
            }} onClick={e => e.stopPropagation()}>
              <div style={{ fontWeight: 600, fontSize: 16, marginBottom: 20 }}>Загрузить документ</div>

              <div style={{ marginBottom: 16 }}>
                <div style={{ fontSize: 13, fontWeight: 500, marginBottom: 8 }}>Тип документа</div>
                <div style={{ display: 'flex', gap: 8 }}>
                  {Object.entries(DOC_TYPES).map(([key, t]) => (
                    <button key={key} style={{
                      flex: 1, height: 38, borderRadius: 'var(--radius-btn)',
                      border: `1px solid ${uploadType === key ? 'var(--blue)' : 'var(--border)'}`,
                      background: uploadType === key ? 'var(--blue-dim)' : 'var(--white)',
                      color: uploadType === key ? 'var(--blue)' : 'var(--muted)',
                      fontSize: 13, cursor: 'pointer',
                    }} onClick={() => setUploadType(key)}>
                      {t.icon} {t.label}
                    </button>
                  ))}
                </div>
              </div>

              {groups.length > 0 && (
                <div style={{ marginBottom: 16 }}>
                  <div style={{ fontSize: 13, fontWeight: 500, marginBottom: 8 }}>Блок (необязательно)</div>
                  <select value={uploadGroupId} onChange={e => setUploadGroupId(e.target.value)}
                    style={{ width: '100%', height: 38, padding: '0 10px', border: '1px solid var(--border)', borderRadius: 'var(--radius-btn)', fontSize: 13, cursor: 'pointer' }}>
                    <option value="">Без блока</option>
                    {groups.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
                  </select>
                </div>
              )}

              <div
                onDragOver={e => { e.preventDefault(); setDragging(true) }}
                onDragLeave={() => setDragging(false)}
                onDrop={onDrop}
                style={{
                  border: `2px dashed ${dragging ? 'var(--blue)' : uploadFile ? 'var(--green)' : 'var(--border)'}`,
                  borderRadius: 'var(--radius-card)',
                  padding: '40px 20px', textAlign: 'center',
                  background: dragging ? 'var(--blue-dim)' : uploadFile ? 'var(--green-dim)' : 'var(--bg)',
                  marginBottom: 20, cursor: 'pointer', transition: 'all 0.2s',
                }}
                onClick={() => fileRef.current?.click()}
              >
                <div style={{ fontSize: 32, marginBottom: 8 }}>📎</div>
                {uploadFile ? (
                  <>
                    <div style={{ fontSize: 14, fontWeight: 500 }}>{uploadFile.name}</div>
                    <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 4 }}>Нажмите чтобы заменить</div>
                  </>
                ) : (
                  <>
                    <div style={{ fontSize: 14, fontWeight: 500 }}>Перетащите файл или нажмите</div>
                    <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 4 }}>xlsx / docx, до 50 МБ</div>
                  </>
                )}
                <input ref={fileRef} type="file" accept=".xlsx,.docx" style={{ display: 'none' }}
                  onChange={e => setUploadFile(e.target.files[0] || null)} />
              </div>

              {uploading && (
                <div style={{ textAlign: 'center', padding: '20px 0', marginBottom: 12 }}>
                  <div style={{ fontSize: 28, marginBottom: 8, animation: 'spin 2s linear infinite' }}>🪄</div>
                  <div style={{ fontWeight: 600, fontSize: 14, color: 'var(--blue)', transition: 'opacity 0.3s' }}>{uploadMsg}</div>
                  <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
                </div>
              )}
              <div style={{ display: 'flex', gap: 8 }}>
                <Button variant="secondary" fullWidth onClick={() => { setShowUpload(false); setUploadFile(null); stopUploadMessages() }} disabled={uploading}>Отмена</Button>
                <Button fullWidth disabled={!uploadFile || uploading} onClick={handleUpload}>
                  {uploading ? 'Обработка...' : 'Загрузить'}
                </Button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Floating cart button */}
      {cart.length > 0 && !showCart && (
        <button onClick={() => setShowCart(true)} style={{
          position: 'fixed', bottom: 24, right: 24, zIndex: 300,
          height: 52, padding: '0 24px', borderRadius: 26,
          background: 'var(--blue)', color: '#fff', border: 'none',
          fontSize: 14, fontWeight: 600, cursor: 'pointer',
          boxShadow: '0 4px 16px rgba(0,0,0,0.18)',
          display: 'flex', alignItems: 'center', gap: 8,
        }}>
          🛒 Корзина ({cart.length})
        </button>
      )}

      {/* Cart modal */}
      {showCart && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 400, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}
          onClick={() => setShowCart(false)}>
          <div style={{ background: 'var(--white)', borderRadius: 'var(--radius-card)', padding: 24, maxWidth: 500, width: '100%', maxHeight: '80vh', overflowY: 'auto' }}
            onClick={e => e.stopPropagation()}>
            <div style={{ fontWeight: 600, fontSize: 16, marginBottom: 16 }}>Корзина ({cart.length})</div>
            {cart.length === 0 ? (
              <div style={{ color: 'var(--muted)', fontSize: 13, padding: '20px 0', textAlign: 'center' }}>Корзина пуста</div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 16 }}>
                {cart.map(uid => {
                  const mu = matchedUnits.find(m => m.unit_id === uid)
                  return (
                    <div key={uid} style={{
                      display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px',
                      borderRadius: 8, background: 'var(--bg)', border: '1px solid var(--border)',
                    }}>
                      <div style={{
                        width: 40, height: 40, borderRadius: 6, flexShrink: 0,
                        background: 'var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontSize: 16, overflow: 'hidden',
                      }}>
                        {mu?.photo_url
                          ? <img src={mu.photo_url} alt="" style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
                          : '📦'}
                      </div>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontWeight: 500, fontSize: 13 }}>{mu?.unit_name || 'Единица'}</div>
                      </div>
                      <button onClick={() => removeFromCart(uid)} style={{
                        fontSize: 18, color: 'var(--muted)', background: 'none', border: 'none', cursor: 'pointer', padding: '0 4px',
                      }}>×</button>
                    </div>
                  )
                })}
              </div>
            )}
            <div style={{ display: 'flex', gap: 8 }}>
              <Button variant="secondary" fullWidth onClick={() => setShowCart(false)}>Закрыть</Button>
              <Button fullWidth disabled={cart.length === 0 || cartSending} onClick={submitCart}>
                {cartSending ? 'Отправка...' : `Оформить заявку (${cart.length})`}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Success popup */}
      {cartSuccess && (
        <div style={{
          position: 'fixed', top: 24, left: '50%', transform: 'translateX(-50%)', zIndex: 500,
          background: 'var(--green)', color: '#fff', padding: '12px 24px', borderRadius: 12,
          fontWeight: 600, fontSize: 14, boxShadow: '0 4px 20px rgba(0,0,0,0.15)',
        }}>
          Заявка успешно оформлена
        </div>
      )}

      {/* Scroll to top */}
      {showScrollTop && (
        <button onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })} style={{
          position: 'fixed', top: 16, right: 60, zIndex: 250,
          width: 36, height: 36, borderRadius: '50%',
          background: 'var(--accent)', border: 'none',
          boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
          cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 16, color: '#fff', transition: 'all 0.2s',
        }}>
          ↑
        </button>
      )}
    </ProductionLayout>
  )
}

function DeltaBadge({ color, icon, label }) {
  const bg = { green: 'var(--green-dim)', amber: 'var(--amber-dim)', red: 'var(--red-dim)' }
  const cl = { green: 'var(--green)', amber: 'var(--amber)', red: 'var(--red)' }
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 4,
      padding: '3px 10px', borderRadius: 'var(--radius-badge)',
      background: bg[color], color: cl[color], fontSize: 12, fontWeight: 500,
    }}>
      <span>{icon}</span>{label}
    </span>
  )
}
