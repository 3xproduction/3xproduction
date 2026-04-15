import { useState, useEffect, useRef } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import WarehouseLayout from './WarehouseLayout'
import ProductionLayout from '../production/ProductionLayout'
import { ROLES } from '../../constants/roles'
import UnitCardModal from '../shared/UnitCardModal'
import Badge from '../shared/Badge'
import Button from '../shared/Button'
import { STATUS_LABEL, STATUS_COLOR } from '../../constants/statuses'
import { ALL_CATEGORIES, CATEGORY_MAP, categoryLabel } from '../../constants/categories'
import { units as unitsApi, warehouses as warehousesApi } from '../../services/api'
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
  const navigate = useNavigate()
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
  const fileRef = useRef()
  const camRef = useRef()

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
    setLoading(true)
    unitsApi.list(params).then(data => setAllUnits(data.units || [])).catch(() => {}).finally(() => setLoading(false))
  }, [debouncedSearch])

  useEffect(() => {
    warehousesApi.list().then(d => setWarehouses(d.warehouses || [])).catch(() => {})
    if (searchParams.get('add') === '1') {
      setForm(EMPTY_FORM); setPhotos([]); setAddError(''); setAddStep(1); setSizeType('clothing'); setShowAdd(true)
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

  async function onFilesSelected(e) {
    const files = Array.from(e.target.files)
    const compressed = await Promise.all(files.map(f => compressImage(f)))
    setPhotos(prev => [...prev, ...compressed].slice(0, 3))
  }

  async function handlePhotosReady() {
    setRecognizing(true)
    try {
      const fd = new FormData()
      fd.append('photo', photos[0])
      const result = await unitsApi.recognize(fd)
      if (result.name || result.category || result.description) {
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
      <div style={{ padding: '24px 32px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20, gap: 12, flexWrap: 'wrap' }}>
          <h1 style={{ fontSize: 20, fontWeight: 600 }}>Склад</h1>
          <Button onClick={() => {
            setForm(EMPTY_FORM); setPhotos([]); setAddError(''); setAddStep(1); setSizeType('clothing'); setShowAdd(true)
            warehousesApi.list().then(d => setWarehouses(d.warehouses || [])).catch(() => {})
          }}>+ Новое</Button>
        </div>

        <div style={{ position: 'relative', marginBottom: 14 }}>
          <span style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--muted)', fontSize: 16 }}>🔍</span>
          <input value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Найдите по названию или серийному номеру..."
            style={{ width: '100%', height: 40, padding: '0 12px 0 36px', border: '1px solid var(--border)', borderRadius: 'var(--radius-btn)', fontSize: 14, background: 'var(--white)', outline: 'none' }}
          />
        </div>

        <div style={{ display: 'flex', gap: 8, marginBottom: 20, flexWrap: 'wrap' }}>
          <Select value={statusFilter} onChange={setStatusFilter} options={STATUSES} />
          <select value={category} onChange={e => setCategory(e.target.value)} style={{
            height: 36, padding: '0 10px', border: '1px solid var(--border)',
            borderRadius: 'var(--radius-btn)', fontSize: 13, background: 'var(--white)', cursor: 'pointer', color: 'var(--text)',
          }}>
            {CATEGORIES.map(k => <option key={k} value={k}>{catOption(k)}</option>)}
          </select>
          <span style={{ marginLeft: 'auto', fontSize: 13, color: 'var(--muted)', alignSelf: 'center' }}>{filtered.length} ед.</span>
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
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(170px, 1fr))', gap: 12 }}>
            {filtered.map(u => {
              const isWrittenOff = u.status === 'written_off'
              return (
                <div key={u.id} onClick={() => setCardId(u.id)} style={{
                  background: isWrittenOff ? 'var(--bg-secondary)' : 'var(--card)',
                  borderRadius: 'var(--radius-card)', border: '1px solid var(--border)',
                  filter: isWrittenOff ? 'grayscale(1)' : 'none', opacity: isWrittenOff ? 0.6 : 1,
                  cursor: 'pointer', overflow: 'hidden',
                }}>
                  <div style={{
                    aspectRatio: '1', background: 'var(--bg)', display: 'flex',
                    alignItems: 'center', justifyContent: 'center', fontSize: 40, overflow: 'hidden',
                  }}>
                    {u.photo_url
                      ? <img src={u.photo_url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                      : <span>📦</span>}
                  </div>
                  <div style={{ padding: '10px 12px' }}>
                    <div style={{ fontWeight: 500, fontSize: 13, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', color: isWrittenOff ? 'var(--muted)' : 'var(--text)', textDecoration: isWrittenOff ? 'line-through' : 'none' }}>{u.name}</div>
                    <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>{categoryLabel(u.category)}</div>
                    <div style={{ marginTop: 6 }}><Badge color={STATUS_COLOR[u.status]}>{STATUS_LABEL[u.status]}</Badge></div>
                  </div>
                </div>
              )
            })}
          </div>
        )}

        {/* Rows — строки с иконкой (текущий вид) */}
        {viewMode === 'rows' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {filtered.map(u => {
              const isWrittenOff = u.status === 'written_off'
              const photo = u.photo_url
              return (
                <div key={u.id} style={{
                  display: 'flex', alignItems: 'center', gap: 14, padding: '14px 16px',
                  background: isWrittenOff ? 'var(--bg-secondary)' : 'var(--card)',
                  borderRadius: 'var(--radius-card)', border: '1px solid var(--border)',
                  filter: isWrittenOff ? 'grayscale(1)' : 'none', opacity: isWrittenOff ? 0.6 : 1,
                  cursor: 'pointer', position: 'relative',
                }} onClick={() => setCardId(u.id)}>
                  <div style={{
                    width: 48, height: 48, borderRadius: 8, flexShrink: 0,
                    background: 'var(--bg)', border: '1px solid var(--border)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 20, overflow: 'hidden',
                  }}>
                    {photo
                      ? <img src={photo} alt="" style={{ width: '100%', height: '100%', objectFit: 'contain', filter: isWrittenOff ? 'blur(2px)' : 'none' }} />
                      : <span>📦</span>}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 500, fontSize: 14, textDecoration: isWrittenOff ? 'line-through' : 'none', color: isWrittenOff ? 'var(--muted)' : 'var(--text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{u.name}</div>
                    <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>{u.serial ? `${u.serial} · ` : ''}{categoryLabel(u.category)}</div>
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--muted)', textAlign: 'right', flexShrink: 0 }}>
                    {u.cell_name && <div>Полка {u.cell_name}</div>}
                    {u.warehouse_name && <div style={{ marginTop: 2 }}>{u.warehouse_name}</div>}
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
              const isWrittenOff = u.status === 'written_off'
              return (
                <div key={u.id} onClick={() => setCardId(u.id)} style={{
                  display: 'flex', alignItems: 'center', gap: 12, padding: '8px 12px',
                  background: isWrittenOff ? 'var(--bg-secondary)' : 'var(--card)',
                  borderRadius: 'var(--radius-btn)', cursor: 'pointer',
                  filter: isWrittenOff ? 'grayscale(1)' : 'none', opacity: isWrittenOff ? 0.6 : 1,
                }}>
                  <div style={{ flex: 1, minWidth: 0, fontSize: 13, fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', color: isWrittenOff ? 'var(--muted)' : 'var(--text)', textDecoration: isWrittenOff ? 'line-through' : 'none' }}>{u.name}</div>
                  {u.serial && <span style={{ fontSize: 12, color: 'var(--muted)', flexShrink: 0 }}>{u.serial}</span>}
                  <span style={{ fontSize: 12, color: 'var(--muted)', flexShrink: 0 }}>{categoryLabel(u.category)}</span>
                  <Badge color={STATUS_COLOR[u.status]}>{STATUS_LABEL[u.status]}</Badge>
                </div>
              )
            })}
          </div>
        )}
      </div>

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
                    <div style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 20 }}>От 2 до 3 фотографий единицы</div>

                    <div style={{ display: 'flex', gap: 10, marginBottom: 20, flexWrap: 'wrap' }}>
                      {photos.map((f, i) => (
                        <div key={i} style={{ position: 'relative', width: 100, height: 100 }}>
                          <img src={URL.createObjectURL(f)} alt="" style={{ width: 100, height: 100, objectFit: 'cover', borderRadius: 'var(--radius-btn)', border: '1px solid var(--border)' }} />
                          <button onClick={() => setPhotos(p => p.filter((_, j) => j !== i))}
                            style={{ position: 'absolute', top: -6, right: -6, background: 'var(--red)', border: 'none', borderRadius: '50%', width: 20, height: 20, color: '#fff', fontSize: 12, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>×</button>
                        </div>
                      ))}
                      {photos.length < 3 && (
                        <>
                          <button onClick={() => fileRef.current?.click()}
                            style={{ width: 100, height: 100, borderRadius: 'var(--radius-btn)', border: '2px dashed var(--border)', background: 'var(--bg)', cursor: 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 4, color: 'var(--muted)', fontSize: 12 }}>
                            <span style={{ fontSize: 24 }}>+</span>
                            Файл
                          </button>
                          <button onClick={() => camRef.current?.click()}
                            style={{ width: 100, height: 100, borderRadius: 'var(--radius-btn)', border: '2px dashed var(--border)', background: 'var(--bg)', cursor: 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 4, color: 'var(--muted)', fontSize: 12 }}>
                            <span style={{ fontSize: 24 }}>cam</span>
                            Камера
                          </button>
                        </>
                      )}
                    </div>
                    <input ref={fileRef} type="file" accept="image/*" multiple style={{ display: 'none' }} onChange={onFilesSelected} />
                    <input ref={camRef} type="file" accept="image/*" capture="environment" style={{ display: 'none' }} onChange={onFilesSelected} />

                    <div style={{ display: 'flex', gap: 8 }}>
                      <Button variant="secondary" fullWidth onClick={() => setShowAdd(false)}>Отмена</Button>
                      <Button fullWidth disabled={photos.length < 2} onClick={handlePhotosReady}>Готово</Button>
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
                    <img key={i} src={URL.createObjectURL(f)} alt="" style={{ width: 56, height: 56, objectFit: 'cover', borderRadius: 'var(--radius-btn)', border: '1px solid var(--border)' }} />
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

                {isDirector && (
                  <>
                    <FL>Стоимость единицы, руб *</FL>
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
