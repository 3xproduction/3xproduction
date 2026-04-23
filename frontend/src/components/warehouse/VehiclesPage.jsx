import { useState, useEffect, useRef } from 'react'
import WarehouseLayout from './WarehouseLayout'
import ProductionLayout from '../production/ProductionLayout'
import { vehicles as vehiclesApi } from '../../services/api'
import { useAuth } from '../../hooks/useAuth'
import { ROLES } from '../../constants/roles'
import Button from '../shared/Button'
import Input from '../shared/Input'
import { Car, Plus, X, Camera, Search, Phone, DollarSign, Palette } from 'lucide-react'

const TYPE_LABELS = {
  car: 'Легковой',
  truck: 'Грузовой',
  bus: 'Автобус',
  motorcycle: 'Мотоцикл',
  special: 'Спецтехника',
}

const STATUS_MAP = {
  available: { label: 'Свободен', color: 'var(--green)', bg: 'var(--green-dim)' },
  in_use:    { label: 'На съёмке', color: 'var(--blue)', bg: 'var(--blue-dim)' },
  rented:    { label: 'Арендован', color: 'var(--amber)', bg: 'var(--amber-dim)' },
  repair:    { label: 'В ремонте', color: 'var(--red)', bg: 'var(--red-dim)' },
}

const TYPES = [
  { value: '', label: 'Все типы' },
  { value: 'car', label: 'Легковой' },
  { value: 'truck', label: 'Грузовой' },
  { value: 'bus', label: 'Автобус' },
  { value: 'motorcycle', label: 'Мотоцикл' },
  { value: 'special', label: 'Спецтехника' },
]

const STATUSES = [
  { value: '', label: 'Все статусы' },
  { value: 'available', label: 'Свободен' },
  { value: 'in_use', label: 'На съёмке' },
  { value: 'rented', label: 'Арендован' },
  { value: 'repair', label: 'В ремонте' },
]

const EMPTY_FORM = {
  name: '', type: 'car', brand: '', model: '', year: '',
  color: '', license_plate: '', vin: '', description: '',
  condition: '', daily_rate: '', owner_name: '', owner_contact: '',
}

const selectStyle = {
  height: 38, padding: '0 10px', border: '1px solid var(--border)',
  borderRadius: 'var(--radius-btn)', fontSize: 13, cursor: 'pointer',
  background: 'var(--white)', outline: 'none',
}

const badgeStyle = (color, bg) => ({
  padding: '2px 8px', borderRadius: 10, fontSize: 11, fontWeight: 500,
  background: bg, color,
})

function isVideoUrl(url) {
  if (!url) return false
  const lower = url.toLowerCase()
  return lower.includes('.mp4') || lower.includes('.webm') || lower.includes('.mov')
}

function vehicleTitle(v) {
  if (v.brand || v.model) {
    return [v.brand, v.model, v.year].filter(Boolean).join(' ')
  }
  return v.name || 'Без названия'
}

export default function VehiclesPage() {
  const { user } = useAuth()
  const [vehicles, setVehicles] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [typeFilter, setTypeFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [showAdd, setShowAdd] = useState(false)
  const [detail, setDetail] = useState(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [form, setForm] = useState(EMPTY_FORM)
  const [saving, setSaving] = useState(false)
  const [photos, setPhotos] = useState([])
  const [aiLoading, setAiLoading] = useState(false)
  const fileRef = useRef(null)
  const camRef = useRef(null)
  const videoRef = useRef(null)

  const load = () => {
    setLoading(true)
    const params = {}
    if (typeFilter) params.type = typeFilter
    if (statusFilter) params.status = statusFilter
    if (search) params.search = search
    vehiclesApi.list(params)
      .then(data => setVehicles(data.vehicles || data || []))
      .finally(() => setLoading(false))
  }

  useEffect(() => { load() }, [typeFilter, statusFilter]) // eslint-disable-line react-hooks/exhaustive-deps

  const handleSearch = e => {
    e.preventDefault()
    load()
  }

  const openDetail = async (v) => {
    setDetailLoading(true)
    setDetail(v)
    try {
      const full = await vehiclesApi.get(v.id)
      setDetail(full.vehicle || full)
    } catch {
      /* keep partial data */
    } finally {
      setDetailLoading(false)
    }
  }

  function isVideoFile(file) {
    return file.type?.startsWith('video/')
  }

  function compressImage(file, maxSize = 1200, quality = 0.6) {
    return new Promise(resolve => {
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

  async function onFiles(e) {
    const files = Array.from(e.target.files)
    const processed = files.map(f => isVideoFile(f) ? Promise.resolve(f) : compressImage(f))
    const results = await Promise.all(processed)
    const isFirst = photos.length === 0
    setPhotos(prev => [...prev, ...results].slice(0, 5))
    e.target.value = ''

    // AI recognition on first image
    if (isFirst && results.length > 0 && results[0].type?.startsWith('image/')) {
      setAiLoading(true)
      const fd = new FormData()
      fd.append('photo', results[0])
      try {
        const result = await vehiclesApi.recognize(fd)
        if (result.name || result.type || result.brand || result.model || result.color || result.description) {
          setForm(prev => ({
            ...prev,
            name: result.name || prev.name,
            type: result.type || prev.type,
            brand: result.brand || prev.brand,
            model: result.model || prev.model,
            color: result.color || prev.color,
            year: result.year || prev.year,
            description: result.description || prev.description,
          }))
        }
      } catch (e) { console.error('AI recognition failed:', e) }
      setAiLoading(false)
    }
  }

  const handleAdd = async e => {
    e.preventDefault()
    setSaving(true)
    try {
      const body = { ...form }
      if (body.year) body.year = Number(body.year)
      if (body.daily_rate) body.daily_rate = Number(body.daily_rate)
      const created = await vehiclesApi.create(body)
      const newVehicle = created.vehicle || created

      if (newVehicle.id && photos.length > 0) {
        for (const file of photos) {
          const fd = new FormData()
          fd.append('photo', file)
          try { await vehiclesApi.uploadPhoto(newVehicle.id, fd) } catch { /* skip */ }
        }
      }

      setShowAdd(false)
      setForm(EMPTY_FORM)
      setPhotos([])
      load()
    } catch {
      /* silent */
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (id) => {
    if (!confirm('Удалить транспорт?')) return
    try {
      await vehiclesApi.delete(id)
      setDetail(null)
      load()
    } catch {
      /* silent */
    }
  }

  const filtered = vehicles.filter(v => {
    if (search) {
      const q = search.toLowerCase()
      const title = vehicleTitle(v).toLowerCase()
      const plate = (v.license_plate || '').toLowerCase()
      if (!title.includes(q) && !plate.includes(q) && !(v.name || '').toLowerCase().includes(q)) return false
    }
    return true
  })

  const Layout = ROLES[user?.role]?.world === 'production' ? ProductionLayout : WarehouseLayout

  return (
    <Layout>
      <div style={{ padding: '24px 32px', maxWidth: 960 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
          <h1 style={{ fontSize: 20, fontWeight: 600 }}>Транспорт</h1>
          <Button onClick={() => setShowAdd(true)} style={{ gap: 6 }}>
            <Plus size={15} /> Добавить
          </Button>
        </div>
        <p style={{ color: 'var(--muted)', fontSize: 13, marginBottom: 20 }}>
          Каталог транспорта для съёмок
        </p>

        {/* Filters */}
        <form onSubmit={handleSearch} style={{ display: 'flex', gap: 10, marginBottom: 24, flexWrap: 'wrap' }}>
          <div style={{ flex: 1, minWidth: 200, position: 'relative' }}>
            <Search size={15} style={{ position: 'absolute', left: 12, top: 12, color: 'var(--muted)' }} />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Поиск по марке, модели, номеру..."
              style={{
                width: '100%', height: 38, padding: '0 12px 0 34px',
                border: '1px solid var(--border)', borderRadius: 'var(--radius-btn)',
                fontSize: 13, outline: 'none', background: 'var(--white)',
              }}
            />
          </div>
          <select value={typeFilter} onChange={e => setTypeFilter(e.target.value)} style={selectStyle}>
            {TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
          </select>
          <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} style={selectStyle}>
            {STATUSES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
          </select>
        </form>

        {/* Grid */}
        {loading ? (
          <div style={{ color: 'var(--muted)', fontSize: 13, padding: '40px 0', textAlign: 'center' }}>Загрузка...</div>
        ) : filtered.length === 0 ? (
          <div style={{ color: 'var(--muted)', fontSize: 13, padding: '40px 0', textAlign: 'center' }}>Нет транспорта</div>
        ) : (
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(3, 1fr)',
            gap: 16,
          }}>
            <style>{`
              @media (max-width: 900px) {
                .vehicles-grid { grid-template-columns: repeat(2, 1fr) !important; }
              }
              @media (max-width: 560px) {
                .vehicles-grid { grid-template-columns: 1fr !important; }
              }
            `}</style>
            {filtered.map(v => {
              const st = STATUS_MAP[v.status] || STATUS_MAP.available
              return (
                <div
                  key={v.id}
                  className="vehicles-grid-item"
                  onClick={() => openDetail(v)}
                  style={{
                    background: 'var(--white)', border: '1px solid var(--border)',
                    borderRadius: 'var(--radius-card)', overflow: 'hidden',
                    cursor: 'pointer', transition: 'box-shadow 0.15s',
                  }}
                  onMouseEnter={e => e.currentTarget.style.boxShadow = '0 2px 8px rgba(0,0,0,0.08)'}
                  onMouseLeave={e => e.currentTarget.style.boxShadow = 'none'}
                >
                  {/* Photo */}
                  <div style={{
                    aspectRatio: '1', background: 'var(--bg)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    overflow: 'hidden',
                  }}>
                    {v.photo_url ? (
                      isVideoUrl(v.photo_url)
                        ? <video src={v.photo_url} muted preload="metadata" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                        : <img src={v.photo_url} alt={vehicleTitle(v)} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                    ) : (
                      <Car size={48} style={{ color: 'var(--border)' }} />
                    )}
                  </div>

                  {/* Info */}
                  <div style={{ padding: 14 }}>
                    <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 6, lineHeight: 1.3 }}>
                      {vehicleTitle(v)}
                    </div>
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 8 }}>
                      {v.type && (
                        <span style={badgeStyle('var(--text)', 'var(--bg)')}>
                          {TYPE_LABELS[v.type] || v.type}
                        </span>
                      )}
                      <span style={badgeStyle(st.color, st.bg)}>{st.label}</span>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: 12, color: 'var(--muted)' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                        {v.color && (
                          <>
                            <span style={{
                              width: 10, height: 10, borderRadius: '50%',
                              background: v.color, border: '1px solid var(--border)',
                              display: 'inline-block', flexShrink: 0,
                            }} />
                            <span>{v.color}</span>
                          </>
                        )}
                      </div>
                      {v.daily_rate != null && Number(v.daily_rate) > 0 && (
                        <span style={{ fontWeight: 600, color: 'var(--text)' }}>
                          {Number(v.daily_rate).toLocaleString('ru-RU')} ₽/день
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )}

        {/* Apply responsive class to grid */}
        <style>{`
          .vehicles-grid-item { /* marker for parent */ }
          div:has(> .vehicles-grid-item) {
            grid-template-columns: repeat(3, 1fr);
          }
          @media (max-width: 900px) {
            div:has(> .vehicles-grid-item) {
              grid-template-columns: repeat(2, 1fr) !important;
            }
          }
          @media (max-width: 560px) {
            div:has(> .vehicles-grid-item) {
              grid-template-columns: 1fr !important;
            }
          }
        `}</style>
      </div>

      {/* Add Modal */}
      {showAdd && (
        <div style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          zIndex: 1000, padding: 16,
        }} onClick={e => e.target === e.currentTarget && setShowAdd(false)}>
          <div style={{
            background: 'var(--white)', borderRadius: 'var(--radius-card)',
            width: '100%', maxWidth: 520, maxHeight: '90vh', overflow: 'auto',
            padding: 24,
          }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
              <h2 style={{ fontSize: 18, fontWeight: 600 }}>Добавить транспорт</h2>
              <button onClick={() => setShowAdd(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4 }}>
                <X size={18} style={{ color: 'var(--muted)' }} />
              </button>
            </div>

            <form onSubmit={handleAdd}>
              <Input label="Название" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="Например: Чёрный седан для погони" />

              <div style={{ marginBottom: 16 }}>
                <label style={{ display: 'block', fontWeight: 500, marginBottom: 6, fontSize: 13 }}>Тип</label>
                <select value={form.type} onChange={e => setForm(f => ({ ...f, type: e.target.value }))} style={{ ...selectStyle, width: '100%' }}>
                  {TYPES.filter(t => t.value).map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                </select>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <Input label="Марка" value={form.brand} onChange={e => setForm(f => ({ ...f, brand: e.target.value }))} placeholder="Toyota" />
                <Input label="Модель" value={form.model} onChange={e => setForm(f => ({ ...f, model: e.target.value }))} placeholder="Camry" />
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <Input label="Год" type="number" value={form.year} onChange={e => setForm(f => ({ ...f, year: e.target.value }))} placeholder="2023" />
                <Input label="Цвет" value={form.color} onChange={e => setForm(f => ({ ...f, color: e.target.value }))} placeholder="Чёрный" />
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <Input label="Гос. номер" value={form.license_plate} onChange={e => setForm(f => ({ ...f, license_plate: e.target.value }))} placeholder="А001АА77" />
                <Input label="VIN" value={form.vin} onChange={e => setForm(f => ({ ...f, vin: e.target.value }))} placeholder="VIN-код" />
              </div>

              <Input label="Состояние" value={form.condition} onChange={e => setForm(f => ({ ...f, condition: e.target.value }))} placeholder="Отличное / Хорошее / Требует ремонта" />

              <div style={{ marginBottom: 16 }}>
                <label style={{ display: 'block', fontWeight: 500, marginBottom: 6, fontSize: 13 }}>Описание</label>
                <textarea
                  value={form.description}
                  onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                  placeholder="Особенности, комплектация, примечания..."
                  rows={3}
                  style={{
                    width: '100%', padding: 12, border: '1px solid var(--border)',
                    borderRadius: 'var(--radius-btn)', fontSize: 14, outline: 'none',
                    background: 'var(--white)', resize: 'vertical', fontFamily: 'inherit',
                  }}
                />
              </div>

              <Input
                label="Стоимость аренды (₽/день)"
                type="number"
                value={form.daily_rate}
                onChange={e => setForm(f => ({ ...f, daily_rate: e.target.value }))}
                placeholder="0"
              />

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <Input label="Владелец" value={form.owner_name} onChange={e => setForm(f => ({ ...f, owner_name: e.target.value }))} placeholder="ФИО" />
                <Input label="Контакт владельца" value={form.owner_contact} onChange={e => setForm(f => ({ ...f, owner_contact: e.target.value }))} placeholder="+7 999 000-00-00" />
              </div>

              {/* Photo upload */}
              <div style={{ marginBottom: 20 }}>
                <label style={{ display: 'block', fontWeight: 500, marginBottom: 6, fontSize: 13 }}>
                  Фото {aiLoading && <span style={{ fontWeight: 400, color: 'var(--blue)' }}> — AI распознаёт...</span>}
                </label>
                <div style={{ display: 'flex', gap: 10, marginBottom: 10, flexWrap: 'wrap' }}>
                  {photos.map((f, i) => (
                    <div key={i} style={{ position: 'relative', width: 80, height: 80 }}>
                      {isVideoFile(f) ? (
                        <video src={URL.createObjectURL(f)} muted preload="metadata" style={{ width: 80, height: 80, objectFit: 'cover', borderRadius: 'var(--radius-btn)', border: '1px solid var(--border)' }} />
                      ) : (
                        <img src={URL.createObjectURL(f)} alt="" style={{ width: 80, height: 80, objectFit: 'cover', borderRadius: 'var(--radius-btn)', border: '1px solid var(--border)' }} />
                      )}
                      <button
                        type="button"
                        onClick={() => setPhotos(p => p.filter((_, j) => j !== i))}
                        style={{ position: 'absolute', top: -6, right: -6, background: 'var(--red)', border: 'none', borderRadius: '50%', width: 20, height: 20, color: '#fff', fontSize: 12, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                      >
                        <X size={12} />
                      </button>
                    </div>
                  ))}
                  {photos.length < 5 && (
                    <>
                      <button
                        type="button"
                        onClick={() => fileRef.current?.click()}
                        style={{ width: 80, height: 80, borderRadius: 'var(--radius-btn)', border: '2px dashed var(--border)', background: 'var(--bg)', cursor: 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 4, color: 'var(--muted)', fontSize: 11 }}
                      >
                        <Plus size={20} />
                        Файл
                      </button>
                      <button
                        type="button"
                        onClick={() => camRef.current?.click()}
                        style={{ width: 80, height: 80, borderRadius: 'var(--radius-btn)', border: '2px dashed var(--border)', background: 'var(--bg)', cursor: 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 4, color: 'var(--muted)', fontSize: 11 }}
                      >
                        <Camera size={20} />
                        Камера
                      </button>
                      <button
                        type="button"
                        onClick={() => videoRef.current?.click()}
                        style={{ width: 80, height: 80, borderRadius: 'var(--radius-btn)', border: '2px dashed var(--accent)', background: 'var(--bg)', cursor: 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 4, color: 'var(--accent)', fontSize: 11 }}
                      >
                        <span style={{ fontSize: 20 }}>🎬</span>
                        Видео
                      </button>
                    </>
                  )}
                </div>
                <input ref={fileRef} type="file" accept="image/*,video/mp4,video/webm,video/quicktime" multiple style={{ display: 'none' }} onChange={onFiles} />
                <input ref={camRef} type="file" accept="image/*,video/mp4,video/webm,video/quicktime" capture style={{ display: 'none' }} onChange={onFiles} />
                <input ref={videoRef} type="file" accept="video/mp4,video/webm,video/quicktime" style={{ display: 'none' }} onChange={onFiles} />
              </div>

              <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
                <Button variant="secondary" type="button" onClick={() => setShowAdd(false)}>Отмена</Button>
                <Button type="submit" loading={saving}>Сохранить</Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Detail Modal */}
      {detail && (
        <div style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          zIndex: 1000, padding: 16,
        }} onClick={e => e.target === e.currentTarget && setDetail(null)}>
          <div style={{
            background: 'var(--white)', borderRadius: 'var(--radius-card)',
            width: '100%', maxWidth: 600, maxHeight: '90vh', overflow: 'auto',
            padding: 24,
          }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
              <h2 style={{ fontSize: 18, fontWeight: 600 }}>{vehicleTitle(detail)}</h2>
              <button onClick={() => setDetail(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4 }}>
                <X size={18} style={{ color: 'var(--muted)' }} />
              </button>
            </div>

            {/* Photo gallery */}
            {(detail.photos?.length > 0 || detail.photo_url) && (
              <div style={{ marginBottom: 20 }}>
                {detail.photos?.length > 0 ? (
                  <div style={{ display: 'flex', gap: 8, overflowX: 'auto', paddingBottom: 4 }}>
                    {detail.photos.map((p, i) => {
                      const src = p.url || p
                      return isVideoUrl(src) ? (
                        <video key={i} src={src} controls preload="metadata" style={{ width: 180, height: 180, objectFit: 'cover', borderRadius: 'var(--radius-btn)', flexShrink: 0, border: '1px solid var(--border)' }} />
                      ) : (
                        <img key={i} src={src} alt={`Фото ${i + 1}`} style={{ width: 180, height: 180, objectFit: 'cover', borderRadius: 'var(--radius-btn)', flexShrink: 0, border: '1px solid var(--border)' }} />
                      )
                    })}
                  </div>
                ) : detail.photo_url ? (
                  isVideoUrl(detail.photo_url) ? (
                    <video src={detail.photo_url} controls preload="metadata" style={{ width: '100%', maxHeight: 300, objectFit: 'cover', borderRadius: 'var(--radius-btn)', border: '1px solid var(--border)' }} />
                  ) : (
                    <img src={detail.photo_url} alt={vehicleTitle(detail)} style={{ width: '100%', maxHeight: 300, objectFit: 'cover', borderRadius: 'var(--radius-btn)', border: '1px solid var(--border)' }} />
                  )
                ) : null}
              </div>
            )}

            {detailLoading && (
              <div style={{ color: 'var(--muted)', fontSize: 13, textAlign: 'center', padding: '12px 0' }}>Загрузка...</div>
            )}

            {/* Badges */}
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 16 }}>
              {detail.type && (
                <span style={badgeStyle('var(--text)', 'var(--bg)')}>
                  {TYPE_LABELS[detail.type] || detail.type}
                </span>
              )}
              {detail.status && (() => {
                const st = STATUS_MAP[detail.status] || STATUS_MAP.available
                return <span style={badgeStyle(st.color, st.bg)}>{st.label}</span>
              })()}
            </div>

            {/* Info grid */}
            <div style={{
              display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px 24px',
              fontSize: 13, marginBottom: 20,
            }}>
              {detail.brand && <InfoRow label="Марка" value={detail.brand} />}
              {detail.model && <InfoRow label="Модель" value={detail.model} />}
              {detail.year && <InfoRow label="Год" value={detail.year} />}
              {detail.color && (
                <div>
                  <div style={{ color: 'var(--muted)', marginBottom: 2 }}>Цвет</div>
                  <div style={{ fontWeight: 500, display: 'flex', alignItems: 'center', gap: 6 }}>
                    <Palette size={13} style={{ color: 'var(--muted)' }} />
                    <span style={{
                      width: 10, height: 10, borderRadius: '50%',
                      background: detail.color, border: '1px solid var(--border)',
                      display: 'inline-block',
                    }} />
                    {detail.color}
                  </div>
                </div>
              )}
              {detail.license_plate && <InfoRow label="Гос. номер" value={detail.license_plate} />}
              {detail.vin && <InfoRow label="VIN" value={detail.vin} />}
              {detail.condition && <InfoRow label="Состояние" value={detail.condition} />}
              {detail.daily_rate != null && Number(detail.daily_rate) > 0 && (
                <div>
                  <div style={{ color: 'var(--muted)', marginBottom: 2 }}>Аренда</div>
                  <div style={{ fontWeight: 500, display: 'flex', alignItems: 'center', gap: 4 }}>
                    <DollarSign size={13} style={{ color: 'var(--green)' }} />
                    {Number(detail.daily_rate).toLocaleString('ru-RU')} ₽/день
                  </div>
                </div>
              )}
            </div>

            {/* Description */}
            {detail.description && (
              <div style={{ marginBottom: 20 }}>
                <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 4 }}>Описание</div>
                <div style={{ fontSize: 13, lineHeight: 1.5, color: 'var(--text)' }}>{detail.description}</div>
              </div>
            )}

            {/* Owner */}
            {(detail.owner_name || detail.owner_contact) && (
              <div style={{
                padding: 14, background: 'var(--bg)', borderRadius: 'var(--radius-btn)',
                marginBottom: 20,
              }}>
                <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 6 }}>Владелец</div>
                {detail.owner_name && (
                  <div style={{ fontSize: 14, fontWeight: 500, marginBottom: 2 }}>{detail.owner_name}</div>
                )}
                {detail.owner_contact && (
                  <div style={{ fontSize: 13, color: 'var(--blue)', display: 'flex', alignItems: 'center', gap: 4 }}>
                    <Phone size={12} />
                    {detail.owner_contact}
                  </div>
                )}
              </div>
            )}

            {/* Actions */}
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
              <Button variant="danger" onClick={() => handleDelete(detail.id)}>Удалить</Button>
              <Button variant="secondary" onClick={() => setDetail(null)}>Закрыть</Button>
            </div>
          </div>
        </div>
      )}
    </Layout>
  )
}

function InfoRow({ label, value }) {
  return (
    <div>
      <div style={{ color: 'var(--muted)', marginBottom: 2 }}>{label}</div>
      <div style={{ fontWeight: 500 }}>{value}</div>
    </div>
  )
}
