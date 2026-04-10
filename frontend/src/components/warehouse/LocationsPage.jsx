import { useState, useEffect, useRef } from 'react'
import { MapPin, Plus, X, Camera, Phone, DollarSign, Ruler, Search } from 'lucide-react'
import WarehouseLayout from './WarehouseLayout'
import ProductionLayout from '../production/ProductionLayout'
import Button from '../shared/Button'
import { locations as locationsApi } from '../../services/api'
import { useAuth } from '../../hooks/useAuth'
import { ROLES } from '../../constants/roles'

const TYPE_LABELS = { interior: 'Интерьер', exterior: 'Натура' }
const TYPE_COLORS = { interior: 'var(--blue)', exterior: 'var(--green)' }
const ALL_FEATURES = ['Парковка', 'Электричество', 'Вода', 'Туалет', 'Грим-комната', 'Кухня', 'Wi-Fi']

const EMPTY_FORM = {
  name: '', type: 'interior', address: '', description: '',
  contact_name: '', contact_phone: '', price_per_day: '',
  area_sqm: '', features: [], notes: '',
}

export default function LocationsPage() {
  const { user } = useAuth()
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [typeFilter, setTypeFilter] = useState('all')

  const [showAdd, setShowAdd] = useState(false)
  const [form, setForm] = useState(EMPTY_FORM)
  const [photos, setPhotos] = useState([])
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState('')
  const fileRef = useRef()

  const [detailId, setDetailId] = useState(null)
  const [detail, setDetail] = useState(null)
  const [detailLoading, setDetailLoading] = useState(false)

  useEffect(() => {
    locationsApi.list().then(data => {
      setItems(Array.isArray(data) ? data : data.locations || [])
    }).catch(() => {}).finally(() => setLoading(false))
  }, [])

  const filtered = items.filter(loc => {
    const matchType = typeFilter === 'all' || loc.type === typeFilter
    const q = search.toLowerCase()
    const matchSearch = !q ||
      (loc.name || '').toLowerCase().includes(q) ||
      (loc.address || '').toLowerCase().includes(q)
    return matchType && matchSearch
  })

  function openAdd() {
    setForm(EMPTY_FORM)
    setPhotos([])
    setSaveError('')
    setShowAdd(true)
  }

  function onFiles(e) {
    const files = Array.from(e.target.files)
    const compressed = files.map(f => compressImage(f))
    Promise.all(compressed).then(results => {
      setPhotos(prev => [...prev, ...results].slice(0, 5))
    })
    e.target.value = ''
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

  function toggleFeature(feat) {
    setForm(f => ({
      ...f,
      features: f.features.includes(feat)
        ? f.features.filter(x => x !== feat)
        : [...f.features, feat],
    }))
  }

  async function handleSave() {
    if (!form.name.trim()) { setSaveError('Укажите название'); return }
    setSaving(true)
    setSaveError('')
    try {
      const body = {
        name: form.name,
        type: form.type,
        address: form.address || null,
        description: form.description || null,
        contact_name: form.contact_name || null,
        contact_phone: form.contact_phone || null,
        price_per_day: form.price_per_day ? Number(form.price_per_day) : null,
        area_sqm: form.area_sqm ? Number(form.area_sqm) : null,
        features: form.features.length > 0 ? form.features : null,
        notes: form.notes || null,
      }
      const data = await locationsApi.create(body)
      const locId = data.location?.id || data.id
      if (locId && photos.length > 0) {
        for (const file of photos) {
          const fd = new FormData()
          fd.append('photos', file)
          try { await locationsApi.uploadPhoto(locId, fd) } catch { /* skip */ }
        }
      }
      setShowAdd(false)
      const refreshed = await locationsApi.list()
      setItems(Array.isArray(refreshed) ? refreshed : refreshed.locations || [])
    } catch (err) {
      setSaveError(err.message || 'Ошибка сохранения')
    } finally {
      setSaving(false)
    }
  }

  async function openDetail(id) {
    setDetailId(id)
    setDetail(null)
    setDetailLoading(true)
    try {
      const data = await locationsApi.get(id)
      setDetail(data.location || data)
    } catch {
      setDetail(null)
    } finally {
      setDetailLoading(false)
    }
  }

  function closeDetail() {
    setDetailId(null)
    setDetail(null)
  }

  async function handleDelete(id) {
    try {
      await locationsApi.delete(id)
      setItems(prev => prev.filter(l => l.id !== id))
      closeDetail()
    } catch { /* ignore */ }
  }

  const Layout = ROLES[user?.role]?.world === 'production' ? ProductionLayout : WarehouseLayout

  return (
    <Layout>
      <div style={{ padding: '24px 32px', maxWidth: 960 }}>
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20, gap: 12, flexWrap: 'wrap' }}>
          <h1 style={{ fontSize: 20, fontWeight: 600 }}>Локации</h1>
          <Button onClick={openAdd}><Plus size={15} style={{ marginRight: 2 }} />Добавить</Button>
        </div>

        {/* Filters */}
        <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
          <div style={{ position: 'relative', flex: 1, minWidth: 200 }}>
            <Search size={16} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--muted)', pointerEvents: 'none' }} />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Поиск по названию или адресу..."
              style={{ width: '100%', height: 38, padding: '0 12px 0 36px', border: '1px solid var(--border)', borderRadius: 'var(--radius-btn)', fontSize: 13, background: 'var(--white)', outline: 'none', boxSizing: 'border-box' }}
            />
          </div>
          <select
            value={typeFilter}
            onChange={e => setTypeFilter(e.target.value)}
            style={{ height: 38, padding: '0 12px', border: '1px solid var(--border)', borderRadius: 'var(--radius-btn)', fontSize: 13, background: 'var(--white)', cursor: 'pointer', color: 'var(--text)' }}
          >
            <option value="all">Все</option>
            <option value="interior">Интерьер</option>
            <option value="exterior">Натура</option>
          </select>
          <span style={{ fontSize: 13, color: 'var(--muted)', alignSelf: 'center' }}>{filtered.length} лок.</span>
        </div>

        {/* Loading */}
        {loading && (
          <div style={{ textAlign: 'center', padding: '60px 0', color: 'var(--muted)', fontSize: 14 }}>Загрузка...</div>
        )}

        {/* Empty */}
        {!loading && filtered.length === 0 && (
          <div style={{ textAlign: 'center', padding: '60px 0', color: 'var(--muted)', fontSize: 14 }}>
            {search || typeFilter !== 'all' ? 'Ничего не найдено' : 'Нет локаций. Добавьте первую!'}
          </div>
        )}

        {/* Grid */}
        {!loading && filtered.length > 0 && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 14 }}>
            {filtered.map(loc => (
              <div
                key={loc.id}
                onClick={() => openDetail(loc.id)}
                style={{
                  background: 'var(--white)', border: '1px solid var(--border)',
                  borderRadius: 'var(--radius-card)', cursor: 'pointer',
                  overflow: 'hidden', transition: 'box-shadow 0.15s',
                }}
                onMouseEnter={e => e.currentTarget.style.boxShadow = '0 2px 8px rgba(0,0,0,0.08)'}
                onMouseLeave={e => e.currentTarget.style.boxShadow = 'none'}
              >
                {/* Photo */}
                <div style={{ aspectRatio: '1', background: 'var(--bg)', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
                  {loc.photo_url
                    ? <img src={loc.photo_url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                    : <MapPin size={40} style={{ color: 'var(--muted)', opacity: 0.4 }} />
                  }
                </div>
                {/* Info */}
                <div style={{ padding: '12px 14px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                    <div style={{ fontWeight: 500, fontSize: 14, flex: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', color: 'var(--text)' }}>
                      {loc.name}
                    </div>
                    <span style={{
                      padding: '2px 8px', borderRadius: 10, fontSize: 11, fontWeight: 500,
                      background: loc.type === 'interior' ? 'rgba(59,130,246,0.1)' : 'rgba(34,197,94,0.1)',
                      color: TYPE_COLORS[loc.type] || 'var(--muted)',
                      flexShrink: 0,
                    }}>
                      {TYPE_LABELS[loc.type] || loc.type}
                    </span>
                  </div>
                  {loc.address && (
                    <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 4, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      <MapPin size={11} style={{ verticalAlign: '-1px', marginRight: 4 }} />
                      {loc.address}
                    </div>
                  )}
                  <div style={{ display: 'flex', gap: 12, fontSize: 12, color: 'var(--muted)', marginTop: 6 }}>
                    {loc.area_sqm && (
                      <span><Ruler size={11} style={{ verticalAlign: '-1px', marginRight: 3 }} />{loc.area_sqm} m²</span>
                    )}
                    {loc.price_per_day && (
                      <span><DollarSign size={11} style={{ verticalAlign: '-1px', marginRight: 2 }} />{Number(loc.price_per_day).toLocaleString()} / день</span>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Responsive grid overrides */}
        <style>{`
          @media (max-width: 900px) {
            div[style*="grid-template-columns: repeat(3"] { grid-template-columns: repeat(2, 1fr) !important; }
          }
          @media (max-width: 560px) {
            div[style*="grid-template-columns: repeat(3"],
            div[style*="grid-template-columns: repeat(2"] { grid-template-columns: 1fr !important; }
          }
        `}</style>
      </div>

      {/* Add modal */}
      {showAdd && (
        <div
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 400, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}
          onClick={() => setShowAdd(false)}
        >
          <div
            style={{ background: 'var(--white)', borderRadius: 'var(--radius-card)', padding: 24, maxWidth: 520, width: '100%', maxHeight: '92vh', overflowY: 'auto' }}
            onClick={e => e.stopPropagation()}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
              <div style={{ fontWeight: 600, fontSize: 16 }}>Новая локация</div>
              <button onClick={() => setShowAdd(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--muted)', padding: 4 }}>
                <X size={18} />
              </button>
            </div>

            {/* Photos */}
            <FL>Фотографии</FL>
            <div style={{ display: 'flex', gap: 10, marginBottom: 16, flexWrap: 'wrap' }}>
              {photos.map((f, i) => (
                <div key={i} style={{ position: 'relative', width: 80, height: 80 }}>
                  <img src={URL.createObjectURL(f)} alt="" style={{ width: 80, height: 80, objectFit: 'cover', borderRadius: 'var(--radius-btn)', border: '1px solid var(--border)' }} />
                  <button
                    onClick={() => setPhotos(p => p.filter((_, j) => j !== i))}
                    style={{ position: 'absolute', top: -6, right: -6, background: 'var(--red, #ef4444)', border: 'none', borderRadius: '50%', width: 20, height: 20, color: '#fff', fontSize: 12, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                  >
                    <X size={12} />
                  </button>
                </div>
              ))}
              {photos.length < 5 && (
                <button
                  onClick={() => fileRef.current?.click()}
                  style={{ width: 80, height: 80, borderRadius: 'var(--radius-btn)', border: '2px dashed var(--border)', background: 'var(--bg)', cursor: 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 4, color: 'var(--muted)', fontSize: 11 }}
                >
                  <Camera size={20} />
                  Фото
                </button>
              )}
            </div>
            <input ref={fileRef} type="file" accept="image/*" multiple style={{ display: 'none' }} onChange={onFiles} />

            {/* Name */}
            <FL>Название *</FL>
            <FI value={form.name} onChange={v => setForm(f => ({ ...f, name: v }))} placeholder="Лофт на Красной Пресне" />

            {/* Type */}
            <FL>Тип</FL>
            <select
              value={form.type}
              onChange={e => setForm(f => ({ ...f, type: e.target.value }))}
              style={{ width: '100%', height: 38, padding: '0 10px', border: '1px solid var(--border)', borderRadius: 'var(--radius-btn)', fontSize: 13, marginBottom: 12, background: 'var(--white)' }}
            >
              <option value="interior">Интерьер</option>
              <option value="exterior">Натура</option>
            </select>

            {/* Address */}
            <FL>Адрес</FL>
            <FI value={form.address} onChange={v => setForm(f => ({ ...f, address: v }))} placeholder="г. Москва, ул. ..." />

            {/* Area and Price row */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 0 }}>
              <div>
                <FL>Площадь (м²)</FL>
                <FI type="number" value={form.area_sqm} onChange={v => setForm(f => ({ ...f, area_sqm: v }))} placeholder="150" />
              </div>
              <div>
                <FL>Цена / день (руб)</FL>
                <FI type="number" value={form.price_per_day} onChange={v => setForm(f => ({ ...f, price_per_day: v }))} placeholder="25000" />
              </div>
            </div>

            {/* Contact */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 0 }}>
              <div>
                <FL>Контактное лицо</FL>
                <FI value={form.contact_name} onChange={v => setForm(f => ({ ...f, contact_name: v }))} placeholder="Иван Иванов" />
              </div>
              <div>
                <FL>Телефон</FL>
                <FI value={form.contact_phone} onChange={v => setForm(f => ({ ...f, contact_phone: v }))} placeholder="+7 999 123-45-67" />
              </div>
            </div>

            {/* Description */}
            <FL>Описание</FL>
            <textarea
              value={form.description}
              onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
              placeholder="Просторный лофт с высокими потолками..."
              style={{ width: '100%', height: 72, padding: '8px 10px', border: '1px solid var(--border)', borderRadius: 'var(--radius-btn)', fontSize: 13, resize: 'vertical', marginBottom: 12, fontFamily: 'inherit', boxSizing: 'border-box' }}
            />

            {/* Features */}
            <FL>Удобства</FL>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 12 }}>
              {ALL_FEATURES.map(feat => {
                const active = form.features.includes(feat)
                return (
                  <button
                    key={feat}
                    type="button"
                    onClick={() => toggleFeature(feat)}
                    style={{
                      padding: '5px 12px', fontSize: 12, borderRadius: 'var(--radius-btn)',
                      border: '1px solid var(--border)',
                      background: active ? 'var(--accent)' : 'var(--white)',
                      color: active ? '#fff' : 'var(--text)',
                      cursor: 'pointer', fontWeight: active ? 600 : 400,
                    }}
                  >
                    {feat}
                  </button>
                )
              })}
            </div>

            {/* Notes */}
            <FL>Заметки</FL>
            <textarea
              value={form.notes}
              onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
              placeholder="Доп. информация для команды..."
              style={{ width: '100%', height: 56, padding: '8px 10px', border: '1px solid var(--border)', borderRadius: 'var(--radius-btn)', fontSize: 13, resize: 'vertical', marginBottom: 16, fontFamily: 'inherit', boxSizing: 'border-box' }}
            />

            {saveError && <div style={{ color: 'var(--red, #ef4444)', fontSize: 13, marginBottom: 12 }}>{saveError}</div>}

            <div style={{ display: 'flex', gap: 8 }}>
              <Button variant="secondary" fullWidth onClick={() => setShowAdd(false)}>Отмена</Button>
              <Button fullWidth loading={saving} onClick={handleSave}>Сохранить</Button>
            </div>
          </div>
        </div>
      )}

      {/* Detail modal */}
      {detailId && (
        <div
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 400, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}
          onClick={closeDetail}
        >
          <div
            style={{ background: 'var(--white)', borderRadius: 'var(--radius-card)', padding: 24, maxWidth: 560, width: '100%', maxHeight: '92vh', overflowY: 'auto' }}
            onClick={e => e.stopPropagation()}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
              <div style={{ fontWeight: 600, fontSize: 16 }}>Детали локации</div>
              <button onClick={closeDetail} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--muted)', padding: 4 }}>
                <X size={18} />
              </button>
            </div>

            {detailLoading && (
              <div style={{ textAlign: 'center', padding: '40px 0', color: 'var(--muted)', fontSize: 14 }}>Загрузка...</div>
            )}

            {!detailLoading && detail && (
              <>
                {/* Photo gallery */}
                {detail.photos && detail.photos.length > 0 ? (
                  <div style={{ display: 'flex', gap: 8, marginBottom: 16, overflowX: 'auto', paddingBottom: 4 }}>
                    {detail.photos.map((url, i) => (
                      <img
                        key={i}
                        src={typeof url === 'string' ? url : url.url}
                        alt=""
                        style={{ width: 140, height: 140, objectFit: 'cover', borderRadius: 'var(--radius-btn)', border: '1px solid var(--border)', flexShrink: 0 }}
                      />
                    ))}
                  </div>
                ) : detail.photo_url ? (
                  <div style={{ marginBottom: 16 }}>
                    <img src={detail.photo_url} alt="" style={{ width: '100%', maxHeight: 280, objectFit: 'cover', borderRadius: 'var(--radius-btn)', border: '1px solid var(--border)' }} />
                  </div>
                ) : (
                  <div style={{ height: 140, background: 'var(--bg)', borderRadius: 'var(--radius-btn)', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 16 }}>
                    <MapPin size={48} style={{ color: 'var(--muted)', opacity: 0.3 }} />
                  </div>
                )}

                {/* Name + type */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
                  <div style={{ fontWeight: 600, fontSize: 18, flex: 1 }}>{detail.name}</div>
                  <span style={{
                    padding: '2px 8px', borderRadius: 10, fontSize: 11, fontWeight: 500,
                    background: detail.type === 'interior' ? 'rgba(59,130,246,0.1)' : 'rgba(34,197,94,0.1)',
                    color: TYPE_COLORS[detail.type] || 'var(--muted)',
                  }}>
                    {TYPE_LABELS[detail.type] || detail.type}
                  </span>
                </div>

                {/* Details grid */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 16 }}>
                  {detail.address && (
                    <DetailRow icon={<MapPin size={14} />} label="Адрес" value={detail.address} />
                  )}
                  {detail.area_sqm && (
                    <DetailRow icon={<Ruler size={14} />} label="Площадь" value={`${detail.area_sqm} м²`} />
                  )}
                  {detail.price_per_day && (
                    <DetailRow icon={<DollarSign size={14} />} label="Цена / день" value={`${Number(detail.price_per_day).toLocaleString()} руб`} />
                  )}
                  {detail.contact_name && (
                    <DetailRow icon={<Phone size={14} />} label="Контакт" value={`${detail.contact_name}${detail.contact_phone ? ' · ' + detail.contact_phone : ''}`} />
                  )}
                  {!detail.contact_name && detail.contact_phone && (
                    <DetailRow icon={<Phone size={14} />} label="Телефон" value={detail.contact_phone} />
                  )}
                </div>

                {/* Description */}
                {detail.description && (
                  <div style={{ marginBottom: 14 }}>
                    <div style={{ fontSize: 12, fontWeight: 500, color: 'var(--muted)', marginBottom: 4 }}>Описание</div>
                    <div style={{ fontSize: 13, color: 'var(--text)', lineHeight: 1.5 }}>{detail.description}</div>
                  </div>
                )}

                {/* Features */}
                {detail.features && detail.features.length > 0 && (
                  <div style={{ marginBottom: 14 }}>
                    <div style={{ fontSize: 12, fontWeight: 500, color: 'var(--muted)', marginBottom: 6 }}>Удобства</div>
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                      {detail.features.map(feat => (
                        <span key={feat} style={{ padding: '3px 10px', borderRadius: 10, fontSize: 11, fontWeight: 500, background: 'var(--bg)', color: 'var(--text)' }}>
                          {feat}
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                {/* Notes */}
                {detail.notes && (
                  <div style={{ marginBottom: 14 }}>
                    <div style={{ fontSize: 12, fontWeight: 500, color: 'var(--muted)', marginBottom: 4 }}>Заметки</div>
                    <div style={{ fontSize: 13, color: 'var(--text)', lineHeight: 1.5 }}>{detail.notes}</div>
                  </div>
                )}

                {/* Actions */}
                <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                  <Button variant="secondary" fullWidth onClick={closeDetail}>Закрыть</Button>
                  <Button variant="danger" fullWidth onClick={() => handleDelete(detail.id)}>Удалить</Button>
                </div>
              </>
            )}

            {!detailLoading && !detail && (
              <div style={{ textAlign: 'center', padding: '40px 0', color: 'var(--muted)', fontSize: 14 }}>Не удалось загрузить данные</div>
            )}
          </div>
        </div>
      )}
    </Layout>
  )
}

/* ── Helper components ──────────────────────────────────────────────────── */

function FL({ children }) {
  return <div style={{ fontSize: 12, fontWeight: 500, marginBottom: 4, color: 'var(--muted)' }}>{children}</div>
}

function FI({ value, onChange, placeholder, type = 'text' }) {
  return (
    <input
      type={type}
      value={value}
      onChange={e => onChange(e.target.value)}
      placeholder={placeholder}
      style={{ width: '100%', height: 38, padding: '0 10px', border: '1px solid var(--border)', borderRadius: 'var(--radius-btn)', fontSize: 13, marginBottom: 12, background: 'var(--white)', outline: 'none', boxSizing: 'border-box' }}
    />
  )
}

function DetailRow({ icon, label, value }) {
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, fontSize: 13 }}>
      <span style={{ color: 'var(--muted)', flexShrink: 0, marginTop: 1 }}>{icon}</span>
      <span style={{ color: 'var(--muted)', flexShrink: 0, minWidth: 80 }}>{label}</span>
      <span style={{ color: 'var(--text)' }}>{value}</span>
    </div>
  )
}
