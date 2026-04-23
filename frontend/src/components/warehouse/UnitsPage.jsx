import { useState, useEffect, useRef } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Search as SearchIcon, Package, Star, Camera, Film, Link as LinkIcon } from 'lucide-react'
import WarehouseLayout from './WarehouseLayout'
import ProductionLayout from '../production/ProductionLayout'
import { ROLES } from '../../constants/roles'
import UnitCardModal from '../shared/UnitCardModal'
import ConfirmModal from '../shared/ConfirmModal'
import Badge from '../shared/Badge'
import Button from '../shared/Button'
import { STATUS_LABEL, STATUS_COLOR } from '../../constants/statuses'
import { ALL_CATEGORIES, CATEGORY_MAP, categoryLabel } from '../../constants/categories'
import { unitFund, FUND_VALUABLE, FUND_CONSUMABLE } from '../../constants/funds'
import { units as unitsApi, warehouses as warehousesApi, rent as rentApi } from '../../services/api'
import { useAuth } from '../../hooks/useAuth'
import { useToast } from '../shared/Toast'

const CATEGORIES = ['all', ...ALL_CATEGORIES]
const STATUSES = ['Фильтр', 'На складе', 'Выдано', 'Просрочено', 'На утверждении', 'Списано']
const STATUS_KEY = {
  'На складе': 'on_stock', 'Выдано': 'issued', 'Просрочено': 'overdue',
  'На утверждении': 'pending', 'Списано': 'written_off',
}

const EMPTY_FORM = { name: '', category: ALL_CATEGORIES[0], dimensions: '', description: '', source: 'покупка', qty: 1, warehouse_id: '', cell_id: '', period: '', valuation: '' }
const CLOTHING_SIZES = ['XS', 'S', 'M', 'L', 'XL', 'XXL', 'XXXL']
const SHOE_SIZES = ['35', '36', '37', '38', '39', '40', '41', '42', '43', '44', '45', '46', '47']
const IS_CLOTHING_CAT = (cat) => ['costumes', 'clothing'].includes(cat)
const catOption = (key) => key === 'all' ? 'Выбрать категорию' : categoryLabel(key)

export default function UnitsPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const { user } = useAuth()
  const toast = useToast()
  const Layout = ROLES[user?.role]?.world === 'production' ? ProductionLayout : WarehouseLayout
  const [viewMode, setViewMode] = useState(() => localStorage.getItem('unitsViewMode') || 'grid')
  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const searchTimer = useRef(null)
  const [category, setCategory] = useState('all')
  const [statusFilter, setStatusFilter] = useState('Все статусы')
  const [allUnits, setAllUnits] = useState([])
  const [loading, setLoading] = useState(true)

  const [showAdd, setShowAdd] = useState(false)
  const [addStep, setAddStep] = useState(1) // 1=photos, 2=details, 3=source+warehouse, 4=preview
  const [sizeType, setSizeType] = useState('clothing') // 'clothing' or 'shoe'
  const [form, setForm] = useState(EMPTY_FORM)
  const [photos, setPhotos] = useState([])
  const [adding, setAdding] = useState(false)
  const [addError, setAddError] = useState('')
  const [cardId, setCardId] = useState(null)
  const [recognizing, setRecognizing] = useState(false)
  // Индексы фото (в массиве photos), которые AI счёл «другим предметом».
  // Сбрасывается при любом изменении photos.
  const [outliers, setOutliers] = useState(new Set())
  const [selectionMode, setSelectionMode] = useState(false)
  const [selectedIds, setSelectedIds] = useState(new Set())
  const [showBulkConfirm, setShowBulkConfirm] = useState(false)
  const fileRef = useRef()
  const camRef = useRef()
  const videoRef = useRef()

  const canSeeSource = ['warehouse_director', 'warehouse_deputy', 'producer'].includes(user?.role)

  const [warehouses, setWarehouses] = useState([])
  const [cells, setCells] = useState([])

  useEffect(() => {
    clearTimeout(searchTimer.current)
    searchTimer.current = setTimeout(() => setDebouncedSearch(search), 300)
    return () => clearTimeout(searchTimer.current)
  }, [search])

  useEffect(() => {
    const params = {}
    if (debouncedSearch.trim()) params.search = debouncedSearch.trim()
    // Don't setLoading(true) on search — keeps current results visible while fetching
    unitsApi.list(params).then(data => setAllUnits(data.units || [])).catch(() => {}).finally(() => setLoading(false))
  }, [debouncedSearch])

  useEffect(() => {
    warehousesApi.list().then(d => setWarehouses(d.warehouses || [])).catch(() => {})
    if (searchParams.get('add') === '1') {
      // Префилл склада/ячейки, если пришли с карты «Добавить единицу сюда».
      // В этом случае прыгаем сразу на шаг «Детали» (шаг 2) — фото юзер
      // добавит потом перед сохранением.
      const prefillCellId = searchParams.get('cellId') || ''
      const prefillWhId   = searchParams.get('warehouseId') || ''
      const nextForm = { ...EMPTY_FORM }
      if (prefillWhId)   nextForm.warehouse_id = prefillWhId
      if (prefillCellId) nextForm.cell_id = prefillCellId
      setForm(nextForm)
      setPhotos([]); setOutliers(new Set()); setAddError('')
      setAddStep(prefillCellId ? 2 : 1)
      setSizeType('clothing')
      setShowAdd(true)
      setSearchParams({}, { replace: true })
    }
  }, [])

  useEffect(() => {
    if (!form.warehouse_id) { setCells([]); setForm(f => ({ ...f, cell_id: '' })); return }
    warehousesApi.cells(form.warehouse_id).then(d => {
      const allCells = (d.sections || []).flatMap(s => s.cells || [])
      setCells(allCells)
    }).catch(() => setCells([]))
  }, [form.warehouse_id])

  const filtered = allUnits.filter(u => {
    const matchCat = category === 'all' || u.category === category
    const matchStatus = statusFilter === 'Все статусы' || u.status === STATUS_KEY[statusFilter]
    return matchCat && matchStatus
  })

  // Split into 3 tiers: direct → similar (close synonyms) → related (category siblings)
  const directUnits = filtered.filter(u => !u._match || u._match === 'direct')
  const similarUnits = filtered.filter(u => u._match === 'similar')
  const relatedUnits = filtered.filter(u => u._match === 'related')
  const isSearching = debouncedSearch.trim().length > 0

  function isVideoFile(file) {
    return file.type?.startsWith('video/')
  }

  async function onFilesSelected(e) {
    const files = Array.from(e.target.files)
    const processed = await Promise.all(files.map(f => isVideoFile(f) ? f : compressImage(f)))
    setPhotos(prev => [...prev, ...processed].slice(0, 5))
    setOutliers(new Set()) // новые фото — сбрасываем предыдущую подсветку
  }

  async function handlePhotosReady() {
    // Индексы фото-файлов (не видео) в массиве photos. Backend возвращает
    // outlier_indices в пространстве картинок (0..N-1), мапим обратно.
    const imagePhotoIdx = photos.map((p, i) => isVideoFile(p) ? -1 : i).filter(i => i !== -1)
    const images = imagePhotoIdx.map(i => photos[i])
    if (images.length < 2) {
      toast?.('Загрузите минимум 2 фото одного предмета', 'error')
      return
    }
    setRecognizing(true)
    setOutliers(new Set())
    try {
      const fd = new FormData()
      for (const img of images) fd.append('photos', img)
      const result = await unitsApi.recognize(fd)
      if (result?.same_item === false) {
        const outlierImageIdxs = Array.isArray(result.outlier_indices) ? result.outlier_indices : []
        const outlierPhotoIdxs = outlierImageIdxs
          .map(i => imagePhotoIdx[i])
          .filter(i => typeof i === 'number')
        setOutliers(new Set(outlierPhotoIdxs))
        toast?.(result.message || 'Загруженные фото относятся к разным предметам. Пожалуйста, перезагрузите фотографии одного предмета', 'error')
        return
      }
      if (result?.name || result?.category || result?.description) {
        setForm(f => ({
          ...f,
          name: result.name || f.name,
          category: ALL_CATEGORIES.includes(result.category) ? result.category : f.category,
          period: result.period || f.period,
          description: result.description || f.description,
        }))
        toast?.('AI заполнил поля — проверьте и отредактируйте', 'success')
      } else {
        toast?.('AI нужна ещё попытка или заполните вручную', 'error')
      }
    } catch (err) {
      console.error('Recognize error:', err)
      toast?.(err.message || 'AI нужна ещё попытка или заполните вручную', 'error')
    } finally {
      setRecognizing(false)
      setAddStep(2)
    }
  }

  const isDirector = ['warehouse_director', 'warehouse_deputy'].includes(user?.role)

  function toggleSelection(id) {
    setSelectedIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }

  function toggleAll() {
    const allVisible = filtered.map(u => u.id)
    const allSelected = allVisible.every(id => selectedIds.has(id))
    setSelectedIds(allSelected ? new Set() : new Set(allVisible))
  }

  async function handleBulkDelete() {
    const count = selectedIds.size
    try {
      await unitsApi.bulkDelete([...selectedIds])
      setSelectionMode(false)
      setSelectedIds(new Set())
      setShowBulkConfirm(false)
      const d = await unitsApi.list()
      setAllUnits(d.units || [])
      toast?.(`Удалено ${count} ед.`, 'success')
    } catch (err) {
      toast?.(err.message || 'Ошибка удаления', 'error')
    }
  }

  function compressImage(file, maxSize = 1024, quality = 0.5) {
    return new Promise((resolve) => {
      const img = new Image()
      img.onload = () => {
        const canvas = document.createElement('canvas')
        let { width, height } = img
        if (width > maxSize || height > maxSize) {
          if (width > height) { height = Math.round(height * maxSize / width); width = maxSize }
          else { width = Math.round(width * maxSize / height); height = maxSize }
        }
        canvas.width = width
        canvas.height = height
        canvas.getContext('2d').drawImage(img, 0, 0, width, height)
        canvas.toBlob(blob => resolve(new File([blob], file.name, { type: 'image/jpeg' })), 'image/jpeg', quality)
      }
      img.src = URL.createObjectURL(file)
    })
  }

  async function handleAdd() {
    if (!form.name.trim()) return
    if (isDirector && !form.valuation) { setAddError('Укажите стоимость единицы'); return }
    setAdding(true)
    setAddError('')
    try {
      // retry once on network failure (cold start)
      const createUnit = async () => unitsApi.create({
        name: form.name,
        category: form.category,
        dimensions: form.dimensions || null,
        description: form.description || null,
        source: canSeeSource ? form.source : null,
        qty: Number(form.qty) || 1,
        valuation: form.valuation ? Number(form.valuation) : null,
        warehouse_id: form.warehouse_id || null,
        cell_id: form.cell_id || null,
        period: form.period || null,
      })
      let data
      try { data = await createUnit() }
      catch { data = await createUnit() }
      const unitId = data.unit?.id
      let photoErrors = 0
      if (unitId && photos.length > 0) {
        for (const file of photos) {
          const fd = new FormData()
          fd.append('photos', file)
          try { await unitsApi.uploadPhoto(unitId, fd) }
          catch { photoErrors++ }
        }
      }
      setShowAdd(false)
      setForm(EMPTY_FORM)
      setPhotos([])
      const d = await unitsApi.list()
      setAllUnits(d.units || [])
      if (photoErrors > 0) {
        toast?.(`Единица создана, но ${photoErrors} фото не загрузилось`, 'error')
      } else {
        toast?.(isDirector ? 'Позиция добавлена на склад' : 'Позиция отправлена на утверждение', 'success')
      }
    } catch (err) {
      setAddError(err.message || 'Ошибка')
    } finally {
      setAdding(false)
    }
  }

  return (
    <Layout>
      <style>{`
        /* На мобильной скрываем верхние действия (Экспорт / + Новое)
           и статусный фильтр — создание/экспорт/фильтры идут через FAB и категории. */
        @media (max-width: 768px) {
          .units-top-actions { display: none !important; }
          .units-filter-status { display: none !important; }
        }
      `}</style>
      <div style={{ padding: '24px 32px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20, gap: 12, flexWrap: 'wrap' }}>
          <h1 style={{ fontSize: 20, fontWeight: 600 }}>Каталог</h1>
          <div className="units-top-actions" style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            {ROLES[user?.role]?.canPublicLink && (
              <Button onClick={async () => {
                try {
                  const data = await rentApi.generateLink()
                  const url = data.url || data.link
                  if (url) {
                    const full = `${window.location.origin}${url}`
                    await navigator.clipboard.writeText(full)
                    toast?.('Ссылка скопирована', 'success')
                  }
                } catch (e) {
                  toast?.(e.message || 'Не удалось создать ссылку', 'error')
                }
              }}><LinkIcon size={14} /> Поделиться ссылкой</Button>
            )}
          </div>
        </div>

        <div style={{ position: 'relative', marginBottom: 14 }}>
          <SearchIcon size={14} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--muted)' }} />
          <input value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Найдите по названию или серийному номеру..."
            style={{ width: '100%', height: 40, padding: '0 12px 0 36px', border: '1px solid var(--border)', borderRadius: 'var(--radius-btn)', fontSize: 14, background: 'var(--white)', outline: 'none' }}
          />
        </div>

        <div style={{ display: 'flex', gap: 8, marginBottom: 20, flexWrap: 'wrap' }}>
          <div className="units-filter-status"><Select value={statusFilter} onChange={setStatusFilter} options={STATUSES} /></div>
          <select value={category} onChange={e => setCategory(e.target.value)} style={{
            height: 36, padding: '0 10px', border: '1px solid var(--border)',
            borderRadius: 'var(--radius-btn)', fontSize: 13, background: 'var(--white)', cursor: 'pointer', color: 'var(--text)',
          }}>
            {CATEGORIES.map(k => <option key={k} value={k}>{catOption(k)}</option>)}
          </select>
          {isDirector && (
            <button onClick={() => { setSelectionMode(m => !m); setSelectedIds(new Set()) }}
              style={{
                marginLeft: 'auto', height: 36, padding: '0 14px', border: '1px solid var(--border)',
                borderRadius: 'var(--radius-btn)', fontSize: 13, cursor: 'pointer',
                background: selectionMode ? 'var(--accent)' : 'var(--white)',
                color: selectionMode ? '#fff' : 'var(--text)',
              }}>{selectionMode ? 'Отмена' : 'Выбрать'}</button>
          )}
          <span style={{ fontSize: 13, color: 'var(--muted)', alignSelf: 'center', ...(!isDirector && { marginLeft: 'auto' }) }}>{filtered.length} ед.</span>
          <div style={{ display: 'flex', gap: 2, alignSelf: 'center' }}>
            {[
              { mode: 'grid', icon: '▦', title: 'Карточки' },
              { mode: 'rows', icon: '☰', title: 'Строки' },
              { mode: 'list', icon: '≡', title: 'Список' },
            ].map(v => (
              <button key={v.mode} title={v.title} onClick={() => { setViewMode(v.mode); localStorage.setItem('unitsViewMode', v.mode) }}
                style={{
                  width: 32, height: 32, border: '1px solid var(--border)', borderRadius: 'var(--radius-btn)',
                  background: viewMode === v.mode ? 'var(--accent)' : 'var(--white)',
                  color: viewMode === v.mode ? '#fff' : 'var(--muted)',
                  fontSize: 16, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
                }} >{v.icon}</button>
            ))}
          </div>
        </div>

        {loading && <div style={{ textAlign: 'center', padding: '60px 0', color: 'var(--muted)', fontSize: 14 }}>Загрузка...</div>}

        {!loading && filtered.length === 0 && (
          <div style={{ textAlign: 'center', padding: '60px 0', color: 'var(--muted)', fontSize: 14 }}>Ничего не найдено</div>
        )}

        {/* Grid — карточки-сетка */}
        {viewMode === 'grid' && (
          <div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(170px, 1fr))', gap: 12 }}>
            {(isSearching ? directUnits : filtered).map(u => {
              const isWrittenOff = u.status === 'written_off' || u.misplaced
              const isSelected = selectedIds.has(u.id)
              return (
                <div key={u.id} onClick={() => selectionMode ? toggleSelection(u.id) : setCardId(u.id)} style={{
                  background: isWrittenOff ? 'var(--bg-secondary)' : 'var(--card)',
                  borderRadius: 'var(--radius-card)', border: isSelected ? '2px solid var(--accent)' : '1px solid var(--border)',
                  filter: isWrittenOff ? 'grayscale(1)' : 'none', opacity: isWrittenOff ? 0.6 : 1,
                  cursor: 'pointer', overflow: 'hidden', position: 'relative',
                }}>
                  {selectionMode && (
                    <div onClick={e => { e.stopPropagation(); toggleSelection(u.id) }} style={{
                      position: 'absolute', top: 8, left: 8, zIndex: 2, width: 22, height: 22,
                      borderRadius: '50%', border: isSelected ? 'none' : '2px solid #ccc',
                      background: isSelected ? 'var(--accent)' : '#fff',
                      display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer',
                      boxShadow: '0 1px 3px rgba(0,0,0,0.15)',
                    }}>{isSelected && <span style={{ color: '#fff', fontSize: 13, fontWeight: 700, lineHeight: 1 }}>✓</span>}</div>
                  )}
                  <div style={{
                    aspectRatio: '1', background: 'var(--bg)', display: 'flex',
                    alignItems: 'center', justifyContent: 'center', fontSize: 40, overflow: 'hidden',
                  }}>
                    {u.photo_url
                      ? /\.(mp4|webm|mov)$/i.test(u.photo_url)
                        ? <video src={u.photo_url} muted preload="metadata" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                        : <img src={u.photo_url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                      : <Package size={22} color="var(--subtle)" strokeWidth={1.4} />}
                  </div>
                  <div style={{ padding: '10px 12px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                      {unitFund(u) === FUND_VALUABLE && (
                        <Star size={12} fill="var(--gold-500)" color="var(--gold-500)" style={{ flexShrink: 0 }} />
                      )}
                      <div style={{ fontWeight: 500, fontSize: 13, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', color: isWrittenOff ? 'var(--muted)' : 'var(--text)', textDecoration: isWrittenOff ? 'line-through' : 'none' }}>{u.name}</div>
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>{categoryLabel(u.category)}</div>
                    <div style={{ marginTop: 6, display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                      <Badge color={STATUS_COLOR[u.status]}>{STATUS_LABEL[u.status]}</Badge>
                      {u.status === 'on_stock' && (u.warehouse_address || u.warehouse_name) && (
                        <span style={{
                          fontSize: 10, fontWeight: 500, color: 'var(--muted)',
                          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                        }} title={u.warehouse_address || u.warehouse_name}>
                          {u.warehouse_address || u.warehouse_name}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
          {isSearching && [
            { items: similarUnits, label: 'Похожее', opacity: 0.85 },
            { items: relatedUnits, label: 'Из категории', opacity: 0.65 },
          ].map(({ items, label, opacity }) => items.length > 0 && (
            <div key={label}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, margin: '20px 0 12px', color: 'var(--muted)' }}>
                <div style={{ flex: 1, height: 1, background: 'var(--border)' }} />
                <span style={{ fontSize: 13, fontWeight: 500, whiteSpace: 'nowrap' }}>{label}</span>
                <div style={{ flex: 1, height: 1, background: 'var(--border)' }} />
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(170px, 1fr))', gap: 12 }}>
                {items.map(u => {
                  const isWrittenOff = u.status === 'written_off' || u.misplaced
                  return (
                    <div key={u.id} onClick={() => setCardId(u.id)} style={{
                      background: isWrittenOff ? 'var(--bg-secondary)' : 'var(--card)',
                      borderRadius: 'var(--radius-card)', border: '1px solid var(--border)',
                      filter: isWrittenOff ? 'grayscale(1)' : 'none', opacity,
                      cursor: 'pointer', overflow: 'hidden',
                    }}>
                      <div style={{ aspectRatio: '1', background: 'var(--bg)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 40, overflow: 'hidden' }}>
                        {u.photo_url
                          ? /\.(mp4|webm|mov)$/i.test(u.photo_url)
                            ? <video src={u.photo_url} muted preload="metadata" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                            : <img src={u.photo_url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                          : <Package size={22} color="var(--subtle)" strokeWidth={1.4} />}
                      </div>
                      <div style={{ padding: '10px 12px' }}>
                        <div style={{ fontWeight: 500, fontSize: 13, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{u.name}</div>
                        <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>{categoryLabel(u.category)}</div>
                        <div style={{ marginTop: 6 }}><Badge color={STATUS_COLOR[u.status]}>{STATUS_LABEL[u.status]}</Badge></div>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          ))}
          </div>
        )}

        {/* Rows — строки с иконкой (текущий вид) */}
        {viewMode === 'rows' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {filtered.map(u => {
              const isWrittenOff = u.status === 'written_off' || u.misplaced
              const photo = u.photo_url
              const isSelected = selectedIds.has(u.id)
              return (
                <div key={u.id} style={{
                  display: 'flex', alignItems: 'center', gap: 14, padding: '14px 16px',
                  background: isWrittenOff ? 'var(--bg-secondary)' : 'var(--card)',
                  borderRadius: 'var(--radius-card)', border: isSelected ? '2px solid var(--accent)' : '1px solid var(--border)',
                  filter: isWrittenOff ? 'grayscale(1)' : 'none', opacity: isWrittenOff ? 0.6 : 1,
                  cursor: 'pointer', position: 'relative',
                }} onClick={() => selectionMode ? toggleSelection(u.id) : setCardId(u.id)}>
                  {selectionMode && (
                    <div onClick={e => { e.stopPropagation(); toggleSelection(u.id) }} style={{
                      width: 22, height: 22, borderRadius: '50%', flexShrink: 0,
                      border: isSelected ? 'none' : '2px solid #ccc',
                      background: isSelected ? 'var(--accent)' : '#fff',
                      display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer',
                    }}>{isSelected && <span style={{ color: '#fff', fontSize: 13, fontWeight: 700, lineHeight: 1 }}>✓</span>}</div>
                  )}
                  <div style={{
                    width: 48, height: 48, borderRadius: 8, flexShrink: 0,
                    background: 'var(--bg)', border: '1px solid var(--border)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 20, overflow: 'hidden',
                  }}>
                    {photo
                      ? /\.(mp4|webm|mov)$/i.test(photo)
                        ? <video src={photo} muted preload="metadata" style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
                        : <img src={photo} alt="" style={{ width: '100%', height: '100%', objectFit: 'contain', filter: isWrittenOff ? 'blur(2px)' : 'none' }} />
                      : <Package size={22} color="var(--subtle)" strokeWidth={1.4} />}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      {unitFund(u) === FUND_VALUABLE && <Star size={13} fill="var(--gold-500)" color="var(--gold-500)" />}
                      <div style={{ fontWeight: 500, fontSize: 14, textDecoration: isWrittenOff ? 'line-through' : 'none', color: isWrittenOff ? 'var(--muted)' : 'var(--text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{u.name}</div>
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>{u.serial ? `${u.serial} · ` : ''}{categoryLabel(u.category)}</div>
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--muted)', textAlign: 'right', flexShrink: 0 }}>
                    {(u.warehouse_address || u.warehouse_name) && <div>{u.warehouse_address || u.warehouse_name}</div>}
                  </div>
                  <div style={{ flexShrink: 0 }}>
                    <Badge color={STATUS_COLOR[u.status]}>{STATUS_LABEL[u.status]}</Badge>
                  </div>
                  <span style={{ color: 'var(--muted)', fontSize: 16, flexShrink: 0 }}>›</span>
                </div>
              )
            })}
          </div>
        )}

        {/* List — компактный список без фото */}
        {viewMode === 'list' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            {filtered.map(u => {
              const isWrittenOff = u.status === 'written_off' || u.misplaced
              const isSelected = selectedIds.has(u.id)
              return (
                <div key={u.id} onClick={() => selectionMode ? toggleSelection(u.id) : setCardId(u.id)} style={{
                  display: 'flex', alignItems: 'center', gap: 12, padding: '8px 12px',
                  background: isWrittenOff ? 'var(--bg-secondary)' : isSelected ? 'rgba(59,130,246,0.06)' : 'var(--card)',
                  borderRadius: 'var(--radius-btn)', cursor: 'pointer',
                  filter: isWrittenOff ? 'grayscale(1)' : 'none', opacity: isWrittenOff ? 0.6 : 1,
                }}>
                  {selectionMode && (
                    <div onClick={e => { e.stopPropagation(); toggleSelection(u.id) }} style={{
                      width: 20, height: 20, borderRadius: '50%', flexShrink: 0,
                      border: isSelected ? 'none' : '2px solid #ccc',
                      background: isSelected ? 'var(--accent)' : '#fff',
                      display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer',
                    }}>{isSelected && <span style={{ color: '#fff', fontSize: 12, fontWeight: 700, lineHeight: 1 }}>✓</span>}</div>
                  )}
                  {unitFund(u) === FUND_VALUABLE && <Star size={12} fill="var(--gold-500)" color="var(--gold-500)" style={{ flexShrink: 0 }} />}
                  <div style={{ flex: 1, minWidth: 0, fontSize: 13, fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', color: isWrittenOff ? 'var(--muted)' : 'var(--text)', textDecoration: isWrittenOff ? 'line-through' : 'none' }}>{u.name}</div>
                  {u.serial && <span style={{ fontSize: 12, color: 'var(--muted)', flexShrink: 0 }}>{u.serial}</span>}
                  <span style={{ fontSize: 12, color: 'var(--muted)', flexShrink: 0 }}>{categoryLabel(u.category)}</span>
                  {u.status === 'on_stock' && (u.warehouse_address || u.warehouse_name) && (
                    <span style={{ fontSize: 11, color: 'var(--muted)', flexShrink: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 180 }}>
                      {u.warehouse_address || u.warehouse_name}
                    </span>
                  )}
                  <Badge color={STATUS_COLOR[u.status]}>{STATUS_LABEL[u.status]}</Badge>
                </div>
              )
            })}
          </div>
        )}
        {/* Floating action bar */}
        {selectionMode && selectedIds.size > 0 && (
          <div style={{
            position: 'fixed', bottom: 24, left: '50%', transform: 'translateX(-50%)', zIndex: 100,
            background: '#fff', borderRadius: 16, padding: '12px 20px',
            boxShadow: '0 4px 24px rgba(0,0,0,0.15)', display: 'flex', alignItems: 'center', gap: 14,
            border: '1px solid var(--border)',
          }}>
            <span style={{ fontSize: 14, fontWeight: 500, whiteSpace: 'nowrap' }}>Выбрано: {selectedIds.size}</span>
            <button onClick={toggleAll} style={{
              height: 34, padding: '0 14px', border: '1px solid var(--border)',
              borderRadius: 'var(--radius-btn)', fontSize: 13, cursor: 'pointer',
              background: 'var(--white)', color: 'var(--text)',
            }}>{filtered.length === selectedIds.size ? 'Снять все' : 'Выбрать все'}</button>
            <button onClick={() => setShowBulkConfirm(true)} style={{
              height: 34, padding: '0 14px', border: 'none',
              borderRadius: 'var(--radius-btn)', fontSize: 13, cursor: 'pointer',
              background: 'var(--red)', color: '#fff', fontWeight: 500,
            }}>Удалить</button>
          </div>
        )}
      </div>

      {/* Bulk delete confirm modal */}
      <ConfirmModal
        open={showBulkConfirm}
        message={`Удалить ${selectedIds.size} единиц?`}
        onConfirm={handleBulkDelete}
        onCancel={() => setShowBulkConfirm(false)}
      />

      {/* Add unit modal — 4-step wizard */}
      {showAdd && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 400, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}
          onClick={() => setShowAdd(false)}>
          <div style={{ background: 'var(--white)', borderRadius: 'var(--radius-card)', padding: 24, maxWidth: 480, width: '100%', maxHeight: '92vh', overflowY: 'auto' }}
            onClick={e => e.stopPropagation()}>

            {/* Step indicator */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 20 }}>
              {[1,2,3].map(s => (
                <div key={s} style={{ display: 'flex', alignItems: 'center', flex: s < 3 ? 1 : 'none', gap: 6 }}>
                  <div style={{ width: 24, height: 24, borderRadius: '50%', background: addStep >= s ? 'var(--accent)' : 'var(--border)', color: addStep >= s ? '#fff' : 'var(--muted)', fontSize: 11, fontWeight: 600, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>{s}</div>
                  {s < 3 && <div style={{ flex: 1, height: 2, background: addStep > s ? 'var(--accent)' : 'var(--border)', borderRadius: 1 }} />}
                </div>
              ))}
            </div>

            {/* STEP 1 — Photos */}
            {addStep === 1 && (
              <>
                {recognizing ? (
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '48px 0', gap: 16 }}>
                    <div style={{ width: 48, height: 48, border: '3px solid var(--border)', borderTopColor: 'var(--accent)', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
                    <div style={{ fontSize: 14, fontWeight: 500, color: 'var(--text)' }}>AI анализирует фото...</div>
                    <div style={{ fontSize: 13, color: 'var(--muted)' }}>Заполняем данные автоматически</div>
                    <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
                  </div>
                ) : (
                  <>
                    <div style={{ fontWeight: 600, fontSize: 16, marginBottom: 6 }}>Загрузите фото</div>
                    <div style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 20 }}>От 2 до 5 фото одного предмета (разные ракурсы). Видео — опционально.</div>

                    {outliers.size > 0 && (
                      <div style={{
                        background: 'var(--red-dim)', color: 'var(--red)',
                        border: '1px solid var(--red)', borderRadius: 'var(--radius-btn)',
                        padding: '10px 12px', marginBottom: 16, fontSize: 13, lineHeight: 1.4,
                      }}>
                        Загруженные фото относятся к разным предметам. Удалите лишние (подсвечены красным) и загрузите фотографии одного предмета.
                      </div>
                    )}

                    <div style={{ display: 'flex', gap: 10, marginBottom: 20, flexWrap: 'wrap' }}>
                      {photos.map((f, i) => {
                        const isOutlier = outliers.has(i)
                        const border = isOutlier ? '2px solid var(--red)' : '1px solid var(--border)'
                        return (
                        <div key={i} style={{ position: 'relative', width: 100, height: 100 }}>
                          {isVideoFile(f) ? (
                            <video src={URL.createObjectURL(f)} muted preload="metadata" style={{ width: 100, height: 100, objectFit: 'cover', borderRadius: 'var(--radius-btn)', border }} />
                          ) : (
                            <img src={URL.createObjectURL(f)} alt="" style={{ width: 100, height: 100, objectFit: 'cover', borderRadius: 'var(--radius-btn)', border }} />
                          )}
                          {isOutlier && (
                            <div style={{ position: 'absolute', bottom: 4, left: 4, right: 4, background: 'var(--red)', color: '#fff', fontSize: 10, fontWeight: 600, textAlign: 'center', borderRadius: 4, padding: '1px 0' }}>
                              Другой предмет
                            </div>
                          )}
                          <button onClick={() => { setPhotos(p => p.filter((_, j) => j !== i)); setOutliers(new Set()) }}
                            style={{ position: 'absolute', top: -6, right: -6, background: 'var(--red)', border: 'none', borderRadius: '50%', width: 20, height: 20, color: '#fff', fontSize: 12, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>×</button>
                        </div>
                      )})}
                      {photos.length < 5 && (
                        <>
                          <button onClick={() => fileRef.current?.click()}
                            style={{ width: 100, height: 100, borderRadius: 'var(--radius-btn)', border: '2px dashed var(--border)', background: 'var(--bg)', cursor: 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 4, color: 'var(--muted)', fontSize: 12 }}>
                            <span style={{ fontSize: 24 }}>+</span>
                            Файл
                          </button>
                          <button onClick={() => camRef.current?.click()}
                            style={{ width: 100, height: 100, borderRadius: 'var(--radius-btn)', border: '2px dashed var(--border)', background: 'var(--bg)', cursor: 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 4, color: 'var(--muted)', fontSize: 12 }}>
                            <Camera size={22} color="var(--muted)" strokeWidth={1.4} />
                            Камера
                          </button>
                          <button onClick={() => videoRef.current?.click()}
                            style={{ width: 100, height: 100, borderRadius: 'var(--radius-btn)', border: '2px dashed var(--accent)', background: 'var(--bg)', cursor: 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 4, color: 'var(--accent)', fontSize: 12 }}>
                            <Film size={22} color="var(--muted)" strokeWidth={1.4} />
                            Видео
                          </button>
                        </>
                      )}
                    </div>
                    <input ref={fileRef} type="file" accept="image/*,video/mp4,video/webm,video/quicktime" multiple style={{ display: 'none' }} onChange={onFilesSelected} />
                    <input ref={camRef} type="file" accept="image/*,video/mp4,video/webm,video/quicktime" capture style={{ display: 'none' }} onChange={onFilesSelected} />
                    <input ref={videoRef} type="file" accept="video/mp4,video/webm,video/quicktime" style={{ display: 'none' }} onChange={onFilesSelected} />

                    <div style={{ display: 'flex', gap: 8 }}>
                      <Button variant="secondary" fullWidth onClick={() => setShowAdd(false)}>Отмена</Button>
                      <Button fullWidth disabled={photos.filter(f => !isVideoFile(f)).length < 2} onClick={handlePhotosReady}>
                        {photos.filter(f => !isVideoFile(f)).length < 2 ? `Нужно ещё ${2 - photos.filter(f => !isVideoFile(f)).length} фото` : 'Готово'}
                      </Button>
                    </div>
                  </>
                )}
              </>
            )}

            {/* STEP 2 — Description: photos, category, name, description, size (if clothing), qty */}
            {addStep === 2 && (
              <>
                <div style={{ fontWeight: 600, fontSize: 16, marginBottom: 6 }}>Описание единицы</div>
                <div style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 16 }}>Проверьте и отредактируйте</div>

                <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
                  {photos.map((f, i) => (
                    isVideoFile(f) ? (
                      <video key={i} src={URL.createObjectURL(f)} muted style={{ width: 56, height: 56, objectFit: 'cover', borderRadius: 'var(--radius-btn)', border: '1px solid var(--border)' }} />
                    ) : (
                      <img key={i} src={URL.createObjectURL(f)} alt="" style={{ width: 56, height: 56, objectFit: 'cover', borderRadius: 'var(--radius-btn)', border: '1px solid var(--border)' }} />
                    )
                  ))}
                </div>

                <FL>Категория *</FL>
                <select value={form.category} onChange={e => setForm(f => ({ ...f, category: e.target.value, dimensions: '' }))}
                  style={{ width: '100%', height: 38, padding: '0 10px', border: '1px solid var(--border)', borderRadius: 'var(--radius-btn)', fontSize: 13, marginBottom: 12, background: 'var(--white)' }}>
                  {ALL_CATEGORIES.map(c => <option key={c} value={c}>{categoryLabel(c)}</option>)}
                </select>

                <FL>Название *</FL>
                <FI value={form.name} onChange={v => setForm(f => ({ ...f, name: v }))} placeholder="Кресло Честерфилд" />

                <FL>Комментарий</FL>
                <textarea value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} placeholder="Цвет, состояние, материал, особенности..."
                  style={{ width: '100%', height: 72, padding: '8px 10px', border: '1px solid var(--border)', borderRadius: 'var(--radius-btn)', fontSize: 13, resize: 'vertical', marginBottom: 12, fontFamily: 'inherit' }} />

                {IS_CLOTHING_CAT(form.category) && (
                  <>
                    <FL>Размер</FL>
                    <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
                      <button onClick={() => setSizeType('clothing')}
                        style={{ padding: '4px 12px', fontSize: 12, borderRadius: 'var(--radius-btn)', border: '1px solid var(--border)', background: sizeType === 'clothing' ? 'var(--accent)' : 'var(--white)', color: sizeType === 'clothing' ? '#fff' : 'var(--text)', cursor: 'pointer' }}>Одежда</button>
                      <button onClick={() => setSizeType('shoe')}
                        style={{ padding: '4px 12px', fontSize: 12, borderRadius: 'var(--radius-btn)', border: '1px solid var(--border)', background: sizeType === 'shoe' ? 'var(--accent)' : 'var(--white)', color: sizeType === 'shoe' ? '#fff' : 'var(--text)', cursor: 'pointer' }}>Обувь</button>
                    </div>
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 12 }}>
                      {(sizeType === 'shoe' ? SHOE_SIZES : CLOTHING_SIZES).map(s => (
                        <button key={s} onClick={() => setForm(f => ({ ...f, dimensions: s }))}
                          style={{ padding: '6px 12px', fontSize: 12, borderRadius: 'var(--radius-btn)', border: '1px solid var(--border)', background: form.dimensions === s ? 'var(--accent)' : 'var(--white)', color: form.dimensions === s ? '#fff' : 'var(--text)', cursor: 'pointer', fontWeight: form.dimensions === s ? 600 : 400 }}>{s}</button>
                      ))}
                    </div>
                  </>
                )}

                <FL>Количество</FL>
                <FI type="number" value={form.qty} onChange={v => setForm(f => ({ ...f, qty: v }))} placeholder="1" />

                <div style={{ display: 'flex', gap: 8 }}>
                  <Button variant="secondary" fullWidth onClick={() => setAddStep(1)}>Назад</Button>
                  <Button fullWidth disabled={!form.name.trim() || !form.category} onClick={() => setAddStep(3)}>Готово</Button>
                </div>
              </>
            )}

            {/* STEP 3 — Source, cost, warehouse */}
            {addStep === 3 && (
              <>
                <div style={{ fontWeight: 600, fontSize: 16, marginBottom: 6 }}>Размещение</div>
                <div style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 16 }}>Источник и место хранения</div>

                {canSeeSource && (
                  <>
                    <FL>Источник</FL>
                    <select value={form.source} onChange={e => setForm(f => ({ ...f, source: e.target.value }))}
                      style={{ width: '100%', height: 38, padding: '0 10px', border: '1px solid var(--border)', borderRadius: 'var(--radius-btn)', fontSize: 13, marginBottom: 12, background: 'var(--white)' }}>
                      <option value="покупка">Покупка</option>
                      <option value="дарение">Дарение</option>
                      <option value="аренда">Аренда</option>
                    </select>
                  </>
                )}

                {(isDirector || user?.role === 'producer') && (
                  <>
                    <FL>Стоимость единицы, руб {isDirector ? '*' : ''}</FL>
                    <FI type="number" value={form.valuation} onChange={v => setForm(f => ({ ...f, valuation: v }))} placeholder="0.00" />
                  </>
                )}

                <FL>Временное понятие</FL>
                <FI value={form.period} onChange={v => setForm(f => ({ ...f, period: v }))} placeholder="Советское, XVIII век, современное..." />

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 12 }}>
                  <div>
                    <FL>Склад</FL>
                    <select value={form.warehouse_id} onChange={e => setForm(f => ({ ...f, warehouse_id: e.target.value, cell_id: '' }))}
                      style={{ width: '100%', height: 38, padding: '0 10px', border: '1px solid var(--border)', borderRadius: 'var(--radius-btn)', fontSize: 13, background: 'var(--white)' }}>
                      <option value="">-- не выбран --</option>
                      {warehouses.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
                    </select>
                  </div>
                  <div>
                    <FL>Полка</FL>
                    <select value={form.cell_id} onChange={e => setForm(f => ({ ...f, cell_id: e.target.value }))}
                      disabled={!form.warehouse_id || cells.length === 0}
                      style={{ width: '100%', height: 38, padding: '0 10px', border: '1px solid var(--border)', borderRadius: 'var(--radius-btn)', fontSize: 13, background: 'var(--white)' }}>
                      <option value="">-- не выбрана --</option>
                      {cells.map(c => <option key={c.id} value={c.id}>{c.custom_name || c.code}</option>)}
                    </select>
                  </div>
                </div>

                {addError && <div style={{ color: 'var(--red)', fontSize: 13, marginBottom: 12 }}>{addError}</div>}

                <div style={{ display: 'flex', gap: 8 }}>
                  <Button variant="secondary" fullWidth onClick={() => setAddStep(2)}>Назад</Button>
                  <Button fullWidth disabled={(isDirector && !form.valuation) || adding} onClick={handleAdd}>
                    {adding ? 'Сохранение...' : 'Добавить'}
                  </Button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
      {cardId && <UnitCardModal unitId={cardId} onClose={() => setCardId(null)} onChanged={() => {
        unitsApi.list().then(d => setAllUnits(d.units || [])).catch(() => {})
      }} />}
    </Layout>
  )
}

function FL({ children }) {
  return <div style={{ fontSize: 12, fontWeight: 500, marginBottom: 4, color: 'var(--muted)' }}>{children}</div>
}
function FI({ value, onChange, placeholder, type = 'text' }) {
  return (
    <input type={type} value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder}
      style={{ width: '100%', height: 38, padding: '0 10px', border: '1px solid var(--border)', borderRadius: 'var(--radius-btn)', fontSize: 13, marginBottom: 12, background: 'var(--white)', outline: 'none', boxSizing: 'border-box' }} />
  )
}

function Select({ value, onChange, options }) {
  return (
    <select value={value} onChange={e => onChange(e.target.value)} style={{
      height: 36, padding: '0 10px', border: '1px solid var(--border)',
      borderRadius: 'var(--radius-btn)', fontSize: 13, background: 'var(--white)', cursor: 'pointer', color: 'var(--text)',
    }}>
      {options.map(o => <option key={o}>{o}</option>)}
    </select>
  )
}
