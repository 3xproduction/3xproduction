import { useState, useEffect, useRef } from 'react'
import { UserCheck, Plus, X, Camera, Search, Phone, Mail } from 'lucide-react'
import ProductionLayout from './ProductionLayout'
import Button from '../shared/Button'
import Badge from '../shared/Badge'
import { casting as castingApi } from '../../services/api'

const STATUS_MAP = {
  considering: { label: 'Рассматривается', color: 'amber' },
  approved:    { label: 'Утверждён',       color: 'green' },
  rejected:    { label: 'Отклонён',        color: 'red' },
}

const GENDER_LABELS = { male: 'Мужской', female: 'Женский' }

const EMPTY_FORM = {
  name: '', role_name: '', gender: '', age_range: '', height: '', weight: '',
  hair_color: '', eye_color: '', body_type: '', ethnicity: '',
  phone: '', email: '', agency: '', experience: '', notes: '', status: 'considering',
}

export default function CastingPage() {
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const searchTimer = useRef(null)
  const [statusFilter, setStatusFilter] = useState('all')
  const [genderFilter, setGenderFilter] = useState('all')

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
    clearTimeout(searchTimer.current)
    searchTimer.current = setTimeout(() => setDebouncedSearch(search), 300)
    return () => clearTimeout(searchTimer.current)
  }, [search])

  useEffect(() => {
    const params = {}
    if (debouncedSearch.trim()) params.search = debouncedSearch.trim()
    if (statusFilter !== 'all') params.status = statusFilter
    if (genderFilter !== 'all') params.gender = genderFilter
    setLoading(true)
    castingApi.list(params).then(data => {
      setItems(Array.isArray(data) ? data : [])
    }).catch(() => {}).finally(() => setLoading(false))
  }, [debouncedSearch, statusFilter, genderFilter])

  const filtered = items

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

  async function handleSave() {
    if (!form.name.trim()) { setSaveError('Укажите ФИО'); return }
    setSaving(true)
    setSaveError('')
    try {
      const body = {
        name: form.name,
        role_name: form.role_name || null,
        gender: form.gender || null,
        age_range: form.age_range || null,
        height: form.height ? Number(form.height) : null,
        weight: form.weight ? Number(form.weight) : null,
        hair_color: form.hair_color || null,
        eye_color: form.eye_color || null,
        body_type: form.body_type || null,
        ethnicity: form.ethnicity || null,
        phone: form.phone || null,
        email: form.email || null,
        agency: form.agency || null,
        experience: form.experience || null,
        notes: form.notes || null,
        status: form.status,
      }
      const data = await castingApi.create(body)
      const cardId = data.id
      if (cardId && photos.length > 0) {
        for (const file of photos) {
          const fd = new FormData()
          fd.append('photos', file)
          try { await castingApi.uploadPhoto(cardId, fd) } catch { /* skip */ }
        }
      }
      setShowAdd(false)
      const refreshParams = {}
      if (debouncedSearch.trim()) refreshParams.search = debouncedSearch.trim()
      if (statusFilter !== 'all') refreshParams.status = statusFilter
      if (genderFilter !== 'all') refreshParams.gender = genderFilter
      const refreshed = await castingApi.list(refreshParams)
      setItems(Array.isArray(refreshed) ? refreshed : [])
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
      const data = await castingApi.get(id)
      setDetail(data)
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
      await castingApi.delete(id)
      setItems(prev => prev.filter(c => c.id !== id))
      closeDetail()
    } catch { /* ignore */ }
  }

  async function handleStatusChange(id, status) {
    try {
      await castingApi.update(id, { ...detail, status })
      setDetail(prev => ({ ...prev, status }))
      setItems(prev => prev.map(c => c.id === id ? { ...c, status } : c))
    } catch { /* ignore */ }
  }

  return (
    <ProductionLayout>
      <div style={{ padding: '24px 32px', maxWidth: 960 }}>
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20, gap: 12, flexWrap: 'wrap' }}>
          <div>
            <h1 style={{ fontSize: 20, fontWeight: 600 }}>Кастинг АМС</h1>
            <p style={{ fontSize: 13, color: 'var(--muted)', marginTop: 2 }}>Актёры и массовка</p>
          </div>
          <Button onClick={openAdd}><Plus size={15} style={{ marginRight: 2 }} />Добавить</Button>
        </div>

        {/* Filters */}
        <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap', alignItems: 'center' }}>
          <div style={{ position: 'relative', flex: 1, minWidth: 200 }}>
            <Search size={16} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--muted)', pointerEvents: 'none' }} />
            <input
              value={search} onChange={e => setSearch(e.target.value)}
              placeholder="Поиск по имени, роли, агентству..."
              style={{ width: '100%', height: 38, padding: '0 12px 0 36px', border: '1px solid var(--border)', borderRadius: 'var(--radius-btn)', fontSize: 13, background: 'var(--white)', outline: 'none', boxSizing: 'border-box' }}
            />
          </div>
          <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} style={{ height: 38, padding: '0 12px', border: '1px solid var(--border)', borderRadius: 'var(--radius-btn)', fontSize: 13, background: 'var(--white)', cursor: 'pointer', color: 'var(--text)' }}>
            <option value="all">Все статусы</option>
            <option value="considering">Рассматривается</option>
            <option value="approved">Утверждён</option>
            <option value="rejected">Отклонён</option>
          </select>
          <select value={genderFilter} onChange={e => setGenderFilter(e.target.value)} style={{ height: 38, padding: '0 12px', border: '1px solid var(--border)', borderRadius: 'var(--radius-btn)', fontSize: 13, background: 'var(--white)', cursor: 'pointer', color: 'var(--text)' }}>
            <option value="all">Пол</option>
            <option value="male">Мужской</option>
            <option value="female">Женский</option>
          </select>
          <span style={{ fontSize: 13, color: 'var(--muted)' }}>{filtered.length} чел.</span>
        </div>

        {loading && <div style={{ textAlign: 'center', padding: '60px 0', color: 'var(--muted)', fontSize: 14 }}>Загрузка...</div>}
        {!loading && filtered.length === 0 && (
          <div style={{ textAlign: 'center', padding: '60px 0', color: 'var(--muted)', fontSize: 14 }}>
            {search || statusFilter !== 'all' || genderFilter !== 'all' ? 'Ничего не найдено' : 'Нет карточек. Добавьте первую!'}
          </div>
        )}

        {/* Grid */}
        {!loading && filtered.length > 0 && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 14 }}>
            {filtered.map(c => (
              <div key={c.id} onClick={() => openDetail(c.id)} style={{
                background: 'var(--white)', border: '1px solid var(--border)',
                borderRadius: 'var(--radius-card)', cursor: 'pointer', overflow: 'hidden',
                transition: 'box-shadow 0.15s',
              }}
                onMouseEnter={e => e.currentTarget.style.boxShadow = '0 2px 8px rgba(0,0,0,0.08)'}
                onMouseLeave={e => e.currentTarget.style.boxShadow = 'none'}
              >
                <div style={{ aspectRatio: '3/4', background: 'var(--bg)', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
                  {c.photo_url
                    ? <img src={c.photo_url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                    : <UserCheck size={40} style={{ color: 'var(--muted)', opacity: 0.4 }} />}
                </div>
                <div style={{ padding: '10px 12px' }}>
                  <div style={{ fontWeight: 500, fontSize: 14, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{c.name}</div>
                  {c.role_name && <div style={{ fontSize: 12, color: 'var(--accent)', marginTop: 2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{c.role_name}</div>}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 6, flexWrap: 'wrap' }}>
                    <Badge color={STATUS_MAP[c.status]?.color || 'muted'}>{STATUS_MAP[c.status]?.label || c.status}</Badge>
                    {c.gender && <span style={{ fontSize: 11, color: 'var(--muted)' }}>{GENDER_LABELS[c.gender] || c.gender}</span>}
                    {c.age_range && <span style={{ fontSize: 11, color: 'var(--muted)' }}>{c.age_range} лет</span>}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        <style>{`
          @media (max-width: 560px) {
            div[style*="grid-template-columns: repeat(auto-fill"] { grid-template-columns: repeat(2, 1fr) !important; }
          }
        `}</style>
      </div>

      {/* Add modal */}
      {showAdd && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 400, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}
          onClick={() => setShowAdd(false)}>
          <div style={{ background: 'var(--white)', borderRadius: 'var(--radius-card)', padding: 24, maxWidth: 520, width: '100%', maxHeight: '92vh', overflowY: 'auto' }}
            onClick={e => e.stopPropagation()}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
              <div style={{ fontWeight: 600, fontSize: 16 }}>Новая карточка</div>
              <button onClick={() => setShowAdd(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--muted)', padding: 4 }}><X size={18} /></button>
            </div>

            {/* Photos */}
            <FL>Фотографии</FL>
            <div style={{ display: 'flex', gap: 10, marginBottom: 16, flexWrap: 'wrap' }}>
              {photos.map((f, i) => (
                <div key={i} style={{ position: 'relative', width: 80, height: 80 }}>
                  <img src={URL.createObjectURL(f)} alt="" style={{ width: 80, height: 80, objectFit: 'cover', borderRadius: 'var(--radius-btn)', border: '1px solid var(--border)' }} />
                  <button onClick={() => setPhotos(p => p.filter((_, j) => j !== i))}
                    style={{ position: 'absolute', top: -6, right: -6, background: 'var(--red, #ef4444)', border: 'none', borderRadius: '50%', width: 20, height: 20, color: '#fff', fontSize: 12, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <X size={12} />
                  </button>
                </div>
              ))}
              {photos.length < 5 && (
                <button onClick={() => fileRef.current?.click()}
                  style={{ width: 80, height: 80, borderRadius: 'var(--radius-btn)', border: '2px dashed var(--border)', background: 'var(--bg)', cursor: 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 4, color: 'var(--muted)', fontSize: 11 }}>
                  <Camera size={20} /> Фото
                </button>
              )}
            </div>
            <input ref={fileRef} type="file" accept="image/*" multiple style={{ display: 'none' }} onChange={onFiles} />

            <FL>ФИО *</FL>
            <FI value={form.name} onChange={v => setForm(f => ({ ...f, name: v }))} placeholder="Иванов Иван Иванович" />

            <FL>Роль в проекте</FL>
            <FI value={form.role_name} onChange={v => setForm(f => ({ ...f, role_name: v }))} placeholder="Главный герой, массовка..." />

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 0 }}>
              <div>
                <FL>Пол</FL>
                <select value={form.gender} onChange={e => setForm(f => ({ ...f, gender: e.target.value }))}
                  style={{ width: '100%', height: 38, padding: '0 10px', border: '1px solid var(--border)', borderRadius: 'var(--radius-btn)', fontSize: 13, marginBottom: 12, background: 'var(--white)' }}>
                  <option value="">—</option>
                  <option value="male">Мужской</option>
                  <option value="female">Женский</option>
                </select>
              </div>
              <div>
                <FL>Возраст</FL>
                <FI value={form.age_range} onChange={v => setForm(f => ({ ...f, age_range: v }))} placeholder="25-35" />
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 0 }}>
              <div>
                <FL>Рост (см)</FL>
                <FI type="number" value={form.height} onChange={v => setForm(f => ({ ...f, height: v }))} placeholder="175" />
              </div>
              <div>
                <FL>Вес (кг)</FL>
                <FI type="number" value={form.weight} onChange={v => setForm(f => ({ ...f, weight: v }))} placeholder="70" />
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 0 }}>
              <div>
                <FL>Цвет волос</FL>
                <FI value={form.hair_color} onChange={v => setForm(f => ({ ...f, hair_color: v }))} placeholder="Тёмный" />
              </div>
              <div>
                <FL>Цвет глаз</FL>
                <FI value={form.eye_color} onChange={v => setForm(f => ({ ...f, eye_color: v }))} placeholder="Карие" />
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 0 }}>
              <div>
                <FL>Телосложение</FL>
                <FI value={form.body_type} onChange={v => setForm(f => ({ ...f, body_type: v }))} placeholder="Атлетическое" />
              </div>
              <div>
                <FL>Типаж / этнос</FL>
                <FI value={form.ethnicity} onChange={v => setForm(f => ({ ...f, ethnicity: v }))} placeholder="Славянский" />
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 0 }}>
              <div>
                <FL>Телефон</FL>
                <FI value={form.phone} onChange={v => setForm(f => ({ ...f, phone: v }))} placeholder="+7 999 123-45-67" />
              </div>
              <div>
                <FL>Email</FL>
                <FI value={form.email} onChange={v => setForm(f => ({ ...f, email: v }))} placeholder="actor@mail.ru" />
              </div>
            </div>

            <FL>Агентство</FL>
            <FI value={form.agency} onChange={v => setForm(f => ({ ...f, agency: v }))} placeholder="Кастинг-агентство ..." />

            <FL>Опыт</FL>
            <textarea value={form.experience} onChange={e => setForm(f => ({ ...f, experience: e.target.value }))}
              placeholder="Фильмография, театральный опыт..."
              style={{ width: '100%', height: 60, padding: '8px 10px', border: '1px solid var(--border)', borderRadius: 'var(--radius-btn)', fontSize: 13, resize: 'vertical', marginBottom: 12, fontFamily: 'inherit', boxSizing: 'border-box' }} />

            <FL>Заметки</FL>
            <textarea value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
              placeholder="Доп. информация..."
              style={{ width: '100%', height: 50, padding: '8px 10px', border: '1px solid var(--border)', borderRadius: 'var(--radius-btn)', fontSize: 13, resize: 'vertical', marginBottom: 16, fontFamily: 'inherit', boxSizing: 'border-box' }} />

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
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 400, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}
          onClick={closeDetail}>
          <div style={{ background: 'var(--white)', borderRadius: 'var(--radius-card)', padding: 24, maxWidth: 560, width: '100%', maxHeight: '92vh', overflowY: 'auto' }}
            onClick={e => e.stopPropagation()}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
              <div style={{ fontWeight: 600, fontSize: 16 }}>Карточка актёра</div>
              <button onClick={closeDetail} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--muted)', padding: 4 }}><X size={18} /></button>
            </div>

            {detailLoading && <div style={{ textAlign: 'center', padding: '40px 0', color: 'var(--muted)', fontSize: 14 }}>Загрузка...</div>}

            {!detailLoading && detail && (
              <>
                {/* Photos */}
                {detail.photos && detail.photos.length > 0 ? (
                  <div style={{ display: 'flex', gap: 8, marginBottom: 16, overflowX: 'auto', paddingBottom: 4 }}>
                    {detail.photos.map((p, i) => (
                      <img key={i} src={typeof p === 'string' ? p : p.url} alt=""
                        style={{ width: 140, height: 180, objectFit: 'cover', borderRadius: 'var(--radius-btn)', border: '1px solid var(--border)', flexShrink: 0 }} />
                    ))}
                  </div>
                ) : detail.photo_url ? (
                  <div style={{ marginBottom: 16 }}>
                    <img src={detail.photo_url} alt="" style={{ width: '100%', maxHeight: 300, objectFit: 'cover', borderRadius: 'var(--radius-btn)', border: '1px solid var(--border)' }} />
                  </div>
                ) : (
                  <div style={{ height: 140, background: 'var(--bg)', borderRadius: 'var(--radius-btn)', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 16 }}>
                    <UserCheck size={48} style={{ color: 'var(--muted)', opacity: 0.3 }} />
                  </div>
                )}

                {/* Name + status */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
                  <div style={{ fontWeight: 600, fontSize: 18, flex: 1 }}>{detail.name}</div>
                  <Badge color={STATUS_MAP[detail.status]?.color || 'muted'}>{STATUS_MAP[detail.status]?.label || detail.status}</Badge>
                </div>
                {detail.role_name && <div style={{ fontSize: 14, color: 'var(--accent)', marginBottom: 12 }}>{detail.role_name}</div>}

                {/* Info grid */}
                <div style={{ background: 'var(--bg)', borderRadius: 'var(--radius-card)', padding: '4px 14px', marginBottom: 14 }}>
                  {detail.gender && <InfoRow label="Пол" value={GENDER_LABELS[detail.gender] || detail.gender} />}
                  {detail.age_range && <InfoRow label="Возраст" value={`${detail.age_range} лет`} />}
                  {detail.height && <InfoRow label="Рост" value={`${detail.height} см`} />}
                  {detail.weight && <InfoRow label="Вес" value={`${detail.weight} кг`} />}
                  {detail.hair_color && <InfoRow label="Волосы" value={detail.hair_color} />}
                  {detail.eye_color && <InfoRow label="Глаза" value={detail.eye_color} />}
                  {detail.body_type && <InfoRow label="Телосложение" value={detail.body_type} />}
                  {detail.ethnicity && <InfoRow label="Типаж" value={detail.ethnicity} />}
                  {detail.phone && <InfoRow label="Телефон" value={detail.phone} />}
                  {detail.email && <InfoRow label="Email" value={detail.email} />}
                  {detail.agency && <InfoRow label="Агентство" value={detail.agency} last={!detail.experience && !detail.notes} />}
                </div>

                {detail.experience && (
                  <div style={{ marginBottom: 14 }}>
                    <div style={{ fontSize: 12, fontWeight: 500, color: 'var(--muted)', marginBottom: 4 }}>Опыт</div>
                    <div style={{ fontSize: 13, lineHeight: 1.5 }}>{detail.experience}</div>
                  </div>
                )}
                {detail.notes && (
                  <div style={{ marginBottom: 14 }}>
                    <div style={{ fontSize: 12, fontWeight: 500, color: 'var(--muted)', marginBottom: 4 }}>Заметки</div>
                    <div style={{ fontSize: 13, lineHeight: 1.5 }}>{detail.notes}</div>
                  </div>
                )}

                {/* Status buttons */}
                <div style={{ display: 'flex', gap: 6, marginBottom: 12, flexWrap: 'wrap' }}>
                  {detail.status !== 'approved' && (
                    <Button onClick={() => handleStatusChange(detail.id, 'approved')}
                      style={{ background: 'var(--green)', borderColor: 'var(--green)', fontSize: 13, height: 34 }}>Утвердить</Button>
                  )}
                  {detail.status !== 'rejected' && (
                    <Button variant="secondary" onClick={() => handleStatusChange(detail.id, 'rejected')}
                      style={{ color: 'var(--red)', fontSize: 13, height: 34 }}>Отклонить</Button>
                  )}
                  {detail.status !== 'considering' && (
                    <Button variant="secondary" onClick={() => handleStatusChange(detail.id, 'considering')}
                      style={{ fontSize: 13, height: 34 }}>Вернуть на рассмотрение</Button>
                  )}
                </div>

                <div style={{ display: 'flex', gap: 8 }}>
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
    </ProductionLayout>
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

function InfoRow({ label, value, last }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 0', borderBottom: last ? 'none' : '1px solid var(--border)' }}>
      <span style={{ color: 'var(--muted)', fontSize: 13 }}>{label}</span>
      <span style={{ fontWeight: 500, fontSize: 13, textAlign: 'right', maxWidth: '60%' }}>{value}</span>
    </div>
  )
}
