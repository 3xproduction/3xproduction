import { useState, useEffect, useRef } from 'react'
import WarehouseLayout from './WarehouseLayout'
import ProductionLayout from '../production/ProductionLayout'
import Button from '../shared/Button'
import Input from '../shared/Input'
import { decorations as decorationsApi, locations as locationsApi } from '../../services/api'
import { useAuth } from '../../hooks/useAuth'
import { ROLES } from '../../constants/roles'
import { Clapperboard, Plus, X, Camera, Search } from 'lucide-react'

const TYPE_LABELS = { decoration: 'Декорация', pavilion: 'Павильон' }
const STATUS_LABELS = { available: 'Свободна', in_use: 'Используется', dismantled: 'Демонтирована' }
const STATUS_COLORS = {
  available:  { color: 'var(--green)', bg: 'var(--green-dim)' },
  in_use:     { color: 'var(--blue)',  bg: 'var(--blue-dim)' },
  dismantled: { color: 'var(--muted)', bg: 'var(--bg)' },
}

const EMPTY_FORM = {
  name: '', type: 'decoration', description: '', location_id: '', area_sqm: '', status: 'available',
}

export default function DecorationsPage() {
  const { user } = useAuth()
  const [items, setItems] = useState([])
  const [locations, setLocations] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const searchTimer = useRef(null)
  const [typeFilter, setTypeFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState('')

  const [showAdd, setShowAdd] = useState(false)
  const [form, setForm] = useState(EMPTY_FORM)
  const [photos, setPhotos] = useState([])
  const [adding, setAdding] = useState(false)
  const [addError, setAddError] = useState('')
  const [aiLoading, setAiLoading] = useState(false)
  const fileRef = useRef()
  const camRef = useRef()
  const videoRef = useRef()

  const [detail, setDetail] = useState(null)
  const [detailLoading, setDetailLoading] = useState(false)

  useEffect(() => {
    clearTimeout(searchTimer.current)
    searchTimer.current = setTimeout(() => setDebouncedSearch(search), 300)
    return () => clearTimeout(searchTimer.current)
  }, [search])

  useEffect(() => {
    locationsApi.list().then(d => setLocations(d.locations || d || [])).catch(() => {})
  }, [])

  useEffect(() => {
    const params = {}
    if (debouncedSearch.trim()) params.search = debouncedSearch.trim()
    if (typeFilter) params.type = typeFilter
    if (statusFilter) params.status = statusFilter
    setLoading(true)
    decorationsApi.list(params)
      .then(d => setItems(d.decorations || d || []))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [debouncedSearch, typeFilter, statusFilter])

  function loadList() {
    const params = {}
    if (debouncedSearch.trim()) params.search = debouncedSearch.trim()
    if (typeFilter) params.type = typeFilter
    if (statusFilter) params.status = statusFilter
    setLoading(true)
    decorationsApi.list(params)
      .then(d => setItems(d.decorations || d || []))
      .catch(() => {})
      .finally(() => setLoading(false))
  }

  function openDetail(id) {
    setDetailLoading(true)
    decorationsApi.get(id)
      .then(d => setDetail(d.decoration || d))
      .catch(() => {})
      .finally(() => setDetailLoading(false))
  }

  async function handleCreate(e) {
    e.preventDefault()
    if (!form.name.trim()) { setAddError('Введите название'); return }
    setAdding(true)
    setAddError('')
    try {
      const body = { ...form }
      if (body.area_sqm) body.area_sqm = Number(body.area_sqm)
      if (body.location_id) body.location_id = Number(body.location_id)
      const created = await decorationsApi.create(body)
      const newId = created.decoration?.id || created.id

      if (photos.length > 0 && newId) {
        for (const photo of photos) {
          const fd = new FormData()
          fd.append('photo', photo)
          await decorationsApi.uploadPhoto(newId, fd)
        }
      }
      setShowAdd(false)
      setForm(EMPTY_FORM)
      setPhotos([])
      loadList()
    } catch (err) {
      setAddError(err.message || 'Ошибка создания')
    } finally {
      setAdding(false)
    }
  }

  async function handleDelete(id) {
    if (!confirm('Удалить декорацию?')) return
    try {
      await decorationsApi.delete(id)
      setDetail(null)
      loadList()
    } catch { /* ignore */ }
  }

  function isVideoFile(file) {
    return file.type?.startsWith('video/')
  }

  function isVideoUrl(url) {
    if (!url) return false
    const lower = url.toLowerCase()
    return lower.includes('.mp4') || lower.includes('.webm') || lower.includes('.mov')
  }

  function onPhotosSelected(e) {
    const files = Array.from(e.target.files).slice(0, 5)
    const isFirstPhoto = photos.length === 0
    setPhotos(prev => [...prev, ...files].slice(0, 5))
    e.target.value = ''

    if (isFirstPhoto && files.length > 0) {
      const firstImage = files.find(f => f.type?.startsWith('image/'))
      if (firstImage) {
        setAiLoading(true)
        const fd = new FormData()
        fd.append('photo', firstImage)
        decorationsApi.recognize(fd)
          .then(result => {
            if (result.name || result.type || result.description) {
              setForm(f => ({
                ...f,
                name: result.name || f.name,
                type: result.type === 'decoration' || result.type === 'pavilion' ? result.type : f.type,
                description: result.description || f.description,
              }))
            }
          })
          .catch(() => {})
          .finally(() => setAiLoading(false))
      }
    }
  }

  const filtered = items

  const Layout = ROLES[user?.role]?.world === 'production' ? ProductionLayout : WarehouseLayout

  return (
    <Layout>
      <div style={{ padding: '24px 32px', maxWidth: 960 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
          <div>
            <h1 style={{ fontSize: 20, fontWeight: 600, marginBottom: 4 }}>Декорации</h1>
            <p style={{ color: 'var(--muted)', fontSize: 13, margin: 0 }}>Каталог декораций и павильонов</p>
          </div>
          <Button onClick={() => { setForm(EMPTY_FORM); setPhotos([]); setAddError(''); setShowAdd(true) }}>
            <Plus size={15} /> Добавить
          </Button>
        </div>

        {/* Filters */}
        <div style={{ display: 'flex', gap: 10, marginBottom: 20, flexWrap: 'wrap' }}>
          <div style={{ flex: 1, minWidth: 200, position: 'relative' }}>
            <Search size={15} style={{ position: 'absolute', left: 10, top: 11, color: 'var(--muted)', pointerEvents: 'none' }} />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Поиск по названию..."
              style={{
                width: '100%', height: 38, padding: '0 12px 0 32px',
                border: '1px solid var(--border)', borderRadius: 'var(--radius-btn)',
                fontSize: 13, outline: 'none', background: 'var(--white)',
              }}
            />
          </div>
          <select
            value={typeFilter}
            onChange={e => setTypeFilter(e.target.value)}
            style={{
              height: 38, padding: '0 10px', border: '1px solid var(--border)',
              borderRadius: 'var(--radius-btn)', fontSize: 13, cursor: 'pointer',
              background: 'var(--white)',
            }}
          >
            <option value="">Все типы</option>
            <option value="decoration">Декорация</option>
            <option value="pavilion">Павильон</option>
          </select>
          <select
            value={statusFilter}
            onChange={e => setStatusFilter(e.target.value)}
            style={{
              height: 38, padding: '0 10px', border: '1px solid var(--border)',
              borderRadius: 'var(--radius-btn)', fontSize: 13, cursor: 'pointer',
              background: 'var(--white)',
            }}
          >
            <option value="">Все статусы</option>
            <option value="available">Свободна</option>
            <option value="in_use">Используется</option>
            <option value="dismantled">Демонтирована</option>
          </select>
        </div>

        {/* Grid */}
        {loading ? (
          <div style={{ color: 'var(--muted)', fontSize: 13, padding: '40px 0', textAlign: 'center' }}>Загрузка...</div>
        ) : filtered.length === 0 ? (
          <div style={{ color: 'var(--muted)', fontSize: 13, padding: '40px 0', textAlign: 'center' }}>Нет декораций</div>
        ) : (
          <div className="dec-grid" style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(3, 1fr)',
            gap: 16,
          }}>
            <style>{`
              @media (max-width: 900px) {
                .dec-grid { grid-template-columns: repeat(2, 1fr) !important; }
              }
              @media (max-width: 580px) {
                .dec-grid { grid-template-columns: 1fr !important; }
              }
            `}</style>
            {filtered.map(d => (
              <div
                key={d.id}
                className="dec-grid-item"
                onClick={() => openDetail(d.id)}
                style={{
                  background: 'var(--white)', border: '1px solid var(--border)',
                  borderRadius: 'var(--radius-card)', overflow: 'hidden', cursor: 'pointer',
                  transition: 'box-shadow 0.15s',
                }}
                onMouseEnter={e => e.currentTarget.style.boxShadow = '0 2px 8px rgba(0,0,0,0.08)'}
                onMouseLeave={e => e.currentTarget.style.boxShadow = 'none'}
              >
                {/* Photo */}
                <div style={{
                  width: '100%', aspectRatio: '1', background: 'var(--bg)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden',
                }}>
                  {d.photo_url ? (
                    isVideoUrl(d.photo_url)
                      ? <video src={d.photo_url} muted preload="metadata" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                      : <img src={d.photo_url} alt={d.name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                  ) : (
                    <Clapperboard size={40} style={{ color: 'var(--muted)', opacity: 0.4 }} />
                  )}
                </div>

                {/* Info */}
                <div style={{ padding: '12px 14px' }}>
                  <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 6, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {d.name}
                  </div>
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 8 }}>
                    <span style={{
                      padding: '2px 8px', borderRadius: 10, fontSize: 11, fontWeight: 500,
                      background: 'var(--accent-dim)', color: 'var(--accent)',
                    }}>
                      {TYPE_LABELS[d.type] || d.type}
                    </span>
                    <span style={{
                      padding: '2px 8px', borderRadius: 10, fontSize: 11, fontWeight: 500,
                      background: STATUS_COLORS[d.status]?.bg || 'var(--bg)',
                      color: STATUS_COLORS[d.status]?.color || 'var(--muted)',
                    }}>
                      {STATUS_LABELS[d.status] || d.status}
                    </span>
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--muted)', display: 'flex', gap: 12 }}>
                    {d.area_sqm && <span>{d.area_sqm} м²</span>}
                    {d.location_name && <span>{d.location_name}</span>}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Add Modal */}
      {showAdd && (
        <div
          style={{
            position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000,
          }}
          onClick={e => { if (e.target === e.currentTarget) setShowAdd(false) }}
        >
          <div style={{
            background: 'var(--white)', borderRadius: 'var(--radius-card)',
            padding: 24, width: '100%', maxWidth: 480, maxHeight: '90vh', overflowY: 'auto',
            position: 'relative',
          }}>
            <button
              onClick={() => setShowAdd(false)}
              style={{ position: 'absolute', top: 12, right: 12, background: 'none', border: 'none', cursor: 'pointer', padding: 4 }}
            >
              <X size={18} style={{ color: 'var(--muted)' }} />
            </button>
            <h2 style={{ fontSize: 17, fontWeight: 600, marginBottom: 20 }}>Новая декорация</h2>

            <form onSubmit={handleCreate}>
              <Input
                label="Название"
                value={form.name}
                onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                placeholder="Название декорации"
              />

              <div style={{ marginBottom: 16 }}>
                <label style={{ display: 'block', fontWeight: 500, marginBottom: 6, fontSize: 13 }}>Тип</label>
                <select
                  value={form.type}
                  onChange={e => setForm(f => ({ ...f, type: e.target.value }))}
                  style={{
                    width: '100%', height: 40, padding: '0 12px',
                    border: '1px solid var(--border)', borderRadius: 'var(--radius-btn)',
                    fontSize: 14, outline: 'none', background: 'var(--white)', cursor: 'pointer',
                  }}
                >
                  <option value="decoration">Декорация</option>
                  <option value="pavilion">Павильон</option>
                </select>
              </div>

              <Input
                label="Описание"
                value={form.description}
                onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                placeholder="Краткое описание"
              />

              <div style={{ marginBottom: 16 }}>
                <label style={{ display: 'block', fontWeight: 500, marginBottom: 6, fontSize: 13 }}>Локация</label>
                <select
                  value={form.location_id}
                  onChange={e => setForm(f => ({ ...f, location_id: e.target.value }))}
                  style={{
                    width: '100%', height: 40, padding: '0 12px',
                    border: '1px solid var(--border)', borderRadius: 'var(--radius-btn)',
                    fontSize: 14, outline: 'none', background: 'var(--white)', cursor: 'pointer',
                  }}
                >
                  <option value="">Не указана</option>
                  {locations.map(loc => (
                    <option key={loc.id} value={loc.id}>{loc.name}</option>
                  ))}
                </select>
              </div>

              <Input
                label="Площадь (м²)"
                type="number"
                value={form.area_sqm}
                onChange={e => setForm(f => ({ ...f, area_sqm: e.target.value }))}
                placeholder="0"
                style={{ appearance: 'textfield' }}
              />

              <div style={{ marginBottom: 16 }}>
                <label style={{ display: 'block', fontWeight: 500, marginBottom: 6, fontSize: 13 }}>Статус</label>
                <select
                  value={form.status}
                  onChange={e => setForm(f => ({ ...f, status: e.target.value }))}
                  style={{
                    width: '100%', height: 40, padding: '0 12px',
                    border: '1px solid var(--border)', borderRadius: 'var(--radius-btn)',
                    fontSize: 14, outline: 'none', background: 'var(--white)', cursor: 'pointer',
                  }}
                >
                  <option value="available">Свободна</option>
                  <option value="in_use">Используется</option>
                  <option value="dismantled">Демонтирована</option>
                </select>
              </div>

              {/* Photo upload */}
              <div style={{ marginBottom: 16 }}>
                <label style={{ display: 'block', fontWeight: 500, marginBottom: 6, fontSize: 13 }}>Фото</label>
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/*,video/mp4,video/webm,video/quicktime"
                  multiple
                  onChange={onPhotosSelected}
                  style={{ display: 'none' }}
                />
                <input
                  ref={camRef}
                  type="file"
                  accept="image/*,video/mp4,video/webm,video/quicktime"
                  capture="environment"
                  onChange={onPhotosSelected}
                  style={{ display: 'none' }}
                />
                <input
                  ref={videoRef}
                  type="file"
                  accept="video/mp4,video/webm,video/quicktime"
                  onChange={onPhotosSelected}
                  style={{ display: 'none' }}
                />
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  {photos.map((p, i) => (
                    <div key={i} style={{ position: 'relative', width: 64, height: 64, borderRadius: 8, overflow: 'hidden', border: '1px solid var(--border)' }}>
                      {isVideoFile(p) ? (
                        <video src={URL.createObjectURL(p)} muted preload="metadata" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                      ) : (
                        <img src={URL.createObjectURL(p)} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                      )}
                      <button
                        type="button"
                        onClick={() => setPhotos(prev => prev.filter((_, j) => j !== i))}
                        style={{
                          position: 'absolute', top: 2, right: 2, width: 18, height: 18,
                          borderRadius: '50%', background: 'rgba(0,0,0,0.5)', border: 'none',
                          color: '#fff', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
                          padding: 0, fontSize: 11,
                        }}
                      >
                        <X size={10} />
                      </button>
                    </div>
                  ))}
                  {photos.length < 5 && (
                    <>
                      <button
                        type="button"
                        onClick={() => fileRef.current?.click()}
                        style={{
                          width: 64, height: 64, borderRadius: 8,
                          border: '1px dashed var(--border)', background: 'var(--bg)',
                          cursor: 'pointer', display: 'flex', flexDirection: 'column',
                          alignItems: 'center', justifyContent: 'center', gap: 2,
                          color: 'var(--muted)', fontSize: 10,
                        }}
                      >
                        <Plus size={16} />
                        Галерея
                      </button>
                      <button
                        type="button"
                        onClick={() => camRef.current?.click()}
                        style={{
                          width: 64, height: 64, borderRadius: 8,
                          border: '1px dashed var(--border)', background: 'var(--bg)',
                          cursor: 'pointer', display: 'flex', flexDirection: 'column',
                          alignItems: 'center', justifyContent: 'center', gap: 2,
                          color: 'var(--muted)', fontSize: 10,
                        }}
                      >
                        <Camera size={16} />
                        Камера
                      </button>
                      <button
                        type="button"
                        onClick={() => videoRef.current?.click()}
                        style={{
                          width: 64, height: 64, borderRadius: 8,
                          border: '1px dashed var(--accent)', background: 'var(--bg)',
                          cursor: 'pointer', display: 'flex', flexDirection: 'column',
                          alignItems: 'center', justifyContent: 'center', gap: 2,
                          color: 'var(--accent)', fontSize: 10,
                        }}
                      >
                        <span style={{ fontSize: 16 }}>🎬</span>
                        Видео
                      </button>
                    </>
                  )}
                </div>
              </div>

              {aiLoading && (
                <div style={{ fontSize: 13, color: 'var(--accent)', marginBottom: 12 }}>AI распознаёт фото...</div>
              )}

              {addError && (
                <div style={{ color: 'var(--red)', fontSize: 13, marginBottom: 12 }}>{addError}</div>
              )}

              <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
                <Button variant="secondary" type="button" onClick={() => setShowAdd(false)}>Отмена</Button>
                <Button type="submit" loading={adding}>Создать</Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Detail Modal */}
      {(detail || detailLoading) && (
        <div
          style={{
            position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000,
          }}
          onClick={e => { if (e.target === e.currentTarget) { setDetail(null) } }}
        >
          <div style={{
            background: 'var(--white)', borderRadius: 'var(--radius-card)',
            padding: 24, width: '100%', maxWidth: 560, maxHeight: '90vh', overflowY: 'auto',
            position: 'relative',
          }}>
            <button
              onClick={() => setDetail(null)}
              style={{ position: 'absolute', top: 12, right: 12, background: 'none', border: 'none', cursor: 'pointer', padding: 4 }}
            >
              <X size={18} style={{ color: 'var(--muted)' }} />
            </button>

            {detailLoading && !detail ? (
              <div style={{ color: 'var(--muted)', fontSize: 13, padding: '40px 0', textAlign: 'center' }}>Загрузка...</div>
            ) : detail ? (
              <>
                <h2 style={{ fontSize: 17, fontWeight: 600, marginBottom: 4 }}>{detail.name}</h2>
                <div style={{ display: 'flex', gap: 6, marginBottom: 16 }}>
                  <span style={{
                    padding: '2px 8px', borderRadius: 10, fontSize: 11, fontWeight: 500,
                    background: 'var(--accent-dim)', color: 'var(--accent)',
                  }}>
                    {TYPE_LABELS[detail.type] || detail.type}
                  </span>
                  <span style={{
                    padding: '2px 8px', borderRadius: 10, fontSize: 11, fontWeight: 500,
                    background: STATUS_COLORS[detail.status]?.bg || 'var(--bg)',
                    color: STATUS_COLORS[detail.status]?.color || 'var(--muted)',
                  }}>
                    {STATUS_LABELS[detail.status] || detail.status}
                  </span>
                </div>

                {/* Photos gallery */}
                {detail.photos && detail.photos.length > 0 && (
                  <div style={{ display: 'flex', gap: 8, marginBottom: 16, overflowX: 'auto', paddingBottom: 4 }}>
                    {detail.photos.map((photo, i) => {
                      const src = photo.url || photo
                      return isVideoUrl(src) ? (
                        <video key={i} src={src} controls preload="metadata" style={{ width: 120, height: 120, objectFit: 'cover', borderRadius: 8, border: '1px solid var(--border)', flexShrink: 0 }} />
                      ) : (
                        <img key={i} src={src} alt="" style={{ width: 120, height: 120, objectFit: 'cover', borderRadius: 8, border: '1px solid var(--border)', flexShrink: 0 }} />
                      )
                    })}
                  </div>
                )}

                {/* Info rows */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8, fontSize: 13, marginBottom: 16 }}>
                  {detail.description && (
                    <div>
                      <span style={{ color: 'var(--muted)' }}>Описание: </span>
                      {detail.description}
                    </div>
                  )}
                  {detail.location_name && (
                    <div>
                      <span style={{ color: 'var(--muted)' }}>Локация: </span>
                      {detail.location_name}
                    </div>
                  )}
                  {detail.area_sqm && (
                    <div>
                      <span style={{ color: 'var(--muted)' }}>Площадь: </span>
                      {detail.area_sqm} м²
                    </div>
                  )}
                </div>

                {/* Linked units */}
                {detail.units && detail.units.length > 0 && (
                  <div>
                    <h3 style={{ fontSize: 14, fontWeight: 600, marginBottom: 10 }}>Связанные единицы</h3>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                      {detail.units.map(unit => (
                        <div
                          key={unit.id}
                          style={{
                            display: 'flex', alignItems: 'center', gap: 10,
                            padding: '8px 10px', border: '1px solid var(--border)',
                            borderRadius: 'var(--radius-btn)', fontSize: 13,
                          }}
                        >
                          {unit.photo_url ? (
                            <img src={unit.photo_url} alt="" style={{ width: 36, height: 36, objectFit: 'cover', borderRadius: 6, flexShrink: 0 }} />
                          ) : (
                            <div style={{
                              width: 36, height: 36, borderRadius: 6, background: 'var(--bg)',
                              display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                            }}>
                              <Clapperboard size={14} style={{ color: 'var(--muted)' }} />
                            </div>
                          )}
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{unit.name}</div>
                            {unit.category && <div style={{ fontSize: 11, color: 'var(--muted)' }}>{unit.category}</div>}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Delete */}
                <div style={{ marginTop: 20, display: 'flex', justifyContent: 'flex-end' }}>
                  <Button variant="danger" onClick={() => handleDelete(detail.id)}>Удалить</Button>
                </div>
              </>
            ) : null}
          </div>
        </div>
      )}
    </Layout>
  )
}
