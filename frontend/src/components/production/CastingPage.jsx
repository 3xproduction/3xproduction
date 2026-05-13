import { useState, useEffect, useRef } from 'react'
import { useSearchParams } from 'react-router-dom'
import { UserCheck, Plus, User, Baby, PawPrint, Search } from 'lucide-react'
import ProductionLayout from './ProductionLayout'
import Button from '../shared/Button'
import Badge from '../shared/Badge'
import { casting as castingApi } from '../../services/api'
import AddCastingModal from './AddCastingModal'
import CastingDetailModal from './CastingDetailModal'

const STATUS_MAP = {
  considering: { label: 'Рассматривается', color: 'amber' },
  approved:    { label: 'Утверждён',       color: 'green' },
  rejected:    { label: 'Отклонён',        color: 'red' },
}

const KIND_MAP = {
  adult:  { label: 'Взрослый', short: '👤', icon: User },
  child:  { label: 'Ребёнок',  short: '👶', icon: Baby },
  animal: { label: 'Животное', short: '🐾', icon: PawPrint },
}

const GENDER_LABELS = { male: 'Мужской', female: 'Женский' }

function isVideoUrl(url) {
  if (!url) return false
  const lower = url.toLowerCase()
  return lower.includes('.mp4') || lower.includes('.webm') || lower.includes('.mov')
}

export default function CastingPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const searchTimer = useRef(null)
  const [statusFilter, setStatusFilter] = useState('all')
  const [genderFilter, setGenderFilter] = useState('all')
  const [kindFilter, setKindFilter] = useState('all')

  const [showAdd, setShowAdd] = useState(false)
  const [detailId, setDetailId] = useState(searchParams.get('card') || null)

  useEffect(() => {
    clearTimeout(searchTimer.current)
    searchTimer.current = setTimeout(() => setDebouncedSearch(search), 300)
    return () => clearTimeout(searchTimer.current)
  }, [search])

  const refresh = () => {
    const params = {}
    if (debouncedSearch.trim()) params.search = debouncedSearch.trim()
    if (statusFilter !== 'all') params.status = statusFilter
    if (genderFilter !== 'all') params.gender = genderFilter
    if (kindFilter !== 'all') params.kind = kindFilter
    setLoading(true)
    castingApi.list(params)
      .then(data => setItems(Array.isArray(data) ? data : []))
      .catch(() => {})
      .finally(() => setLoading(false))
  }

  useEffect(() => { refresh() }, [debouncedSearch, statusFilter, genderFilter, kindFilter])

  // Deep-link через ?card=<id> — открыть detail-modal автоматически.
  useEffect(() => {
    const cardParam = searchParams.get('card')
    if (cardParam && cardParam !== detailId) setDetailId(cardParam)
  }, [searchParams])

  function openDetail(id) {
    setDetailId(id)
    const next = new URLSearchParams(searchParams)
    next.set('card', id)
    setSearchParams(next, { replace: true })
  }

  function closeDetail() {
    setDetailId(null)
    const next = new URLSearchParams(searchParams)
    next.delete('card')
    setSearchParams(next, { replace: true })
  }

  return (
    <ProductionLayout>
      <div style={{ padding: '24px 32px', maxWidth: 960 }}>
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20, gap: 12, flexWrap: 'wrap' }}>
          <div>
            <h1 style={{ fontSize: 20, fontWeight: 600 }}>Кастинг АМС</h1>
            <p style={{ fontSize: 13, color: 'var(--muted)', marginTop: 2 }}>Актёры, дети, животные</p>
          </div>
          <Button onClick={() => setShowAdd(true)}><Plus size={15} style={{ marginRight: 2 }} />Добавить</Button>
        </div>

        {/* Filters */}
        <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap', alignItems: 'center' }}>
          <div style={{ position: 'relative', flex: 1, minWidth: 200 }}>
            <Search size={16} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--muted)', pointerEvents: 'none' }} />
            <input
              value={search} onChange={e => setSearch(e.target.value)}
              placeholder="Поиск по имени, роли, тегам..."
              style={{ width: '100%', height: 38, padding: '0 12px 0 36px', border: '1px solid var(--border)', borderRadius: 'var(--radius-btn)', fontSize: 13, background: 'var(--white)', outline: 'none', boxSizing: 'border-box' }}
            />
          </div>
          <select value={kindFilter} onChange={e => setKindFilter(e.target.value)}
            style={{ height: 38, padding: '0 12px', border: '1px solid var(--border)', borderRadius: 'var(--radius-btn)', fontSize: 13, background: 'var(--white)', cursor: 'pointer', color: 'var(--text)' }}>
            <option value="all">Все типы</option>
            <option value="adult">Взрослые</option>
            <option value="child">Дети</option>
            <option value="animal">Животные</option>
          </select>
          <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)}
            style={{ height: 38, padding: '0 12px', border: '1px solid var(--border)', borderRadius: 'var(--radius-btn)', fontSize: 13, background: 'var(--white)', cursor: 'pointer', color: 'var(--text)' }}>
            <option value="all">Все статусы</option>
            <option value="considering">Рассматривается</option>
            <option value="approved">Утверждён</option>
            <option value="rejected">Отклонён</option>
          </select>
          <select value={genderFilter} onChange={e => setGenderFilter(e.target.value)}
            style={{ height: 38, padding: '0 12px', border: '1px solid var(--border)', borderRadius: 'var(--radius-btn)', fontSize: 13, background: 'var(--white)', cursor: 'pointer', color: 'var(--text)' }}>
            <option value="all">Пол</option>
            <option value="male">Мужской</option>
            <option value="female">Женский</option>
          </select>
          <span style={{ fontSize: 13, color: 'var(--muted)' }}>{items.length} чел.</span>
        </div>

        {loading && <div style={{ textAlign: 'center', padding: '60px 0', color: 'var(--muted)', fontSize: 14 }}>Загрузка...</div>}
        {!loading && items.length === 0 && (
          <div style={{ textAlign: 'center', padding: '60px 0', color: 'var(--muted)', fontSize: 14 }}>
            {search || statusFilter !== 'all' || genderFilter !== 'all' || kindFilter !== 'all'
              ? 'Ничего не найдено'
              : 'Нет карточек. Добавьте первую!'}
          </div>
        )}

        {/* Grid */}
        {!loading && items.length > 0 && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 14 }}>
            {items.map(c => (
              <div key={c.id} onClick={() => openDetail(c.id)} style={{
                background: 'var(--white)', border: '1px solid var(--border)',
                borderRadius: 'var(--radius-card)', cursor: 'pointer', overflow: 'hidden',
                transition: 'box-shadow 0.15s',
              }}
                onMouseEnter={e => e.currentTarget.style.boxShadow = '0 2px 8px rgba(0,0,0,0.08)'}
                onMouseLeave={e => e.currentTarget.style.boxShadow = 'none'}
              >
                <div style={{ aspectRatio: '3/4', background: 'var(--bg)', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', position: 'relative' }}>
                  {c.photo_url
                    ? isVideoUrl(c.photo_url)
                      ? <video src={c.photo_url} muted preload="metadata" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                      : <img src={c.photo_url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                    : <UserCheck size={40} style={{ color: 'var(--muted)', opacity: 0.4 }} />}
                  {c.kind && c.kind !== 'adult' && (
                    <div style={{ position: 'absolute', top: 6, left: 6, background: 'rgba(255,255,255,0.92)', borderRadius: 10, padding: '2px 8px', fontSize: 11, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 4 }}>
                      <span>{KIND_MAP[c.kind]?.short}</span>
                      <span>{KIND_MAP[c.kind]?.label}</span>
                    </div>
                  )}
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

      <AddCastingModal
        open={showAdd}
        onClose={() => setShowAdd(false)}
        onCreated={() => { setShowAdd(false); refresh() }}
      />

      <CastingDetailModal
        open={!!detailId}
        cardId={detailId}
        onClose={closeDetail}
        onUpdated={updated => setItems(prev => prev.map(c => c.id === updated.id ? { ...c, ...updated } : c))}
        onDeleted={id => setItems(prev => prev.filter(c => c.id !== id))}
      />
    </ProductionLayout>
  )
}
