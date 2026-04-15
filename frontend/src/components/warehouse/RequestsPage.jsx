import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { ClipboardList } from 'lucide-react'
import WarehouseLayout from './WarehouseLayout'
import Badge from '../shared/Badge'
import Button from '../shared/Button'
import { requests as requestsApi, warehouses as warehousesApi, units as unitsApi } from '../../services/api'
import { useAuth } from '../../hooks/useAuth'

const css = `
.req-page { padding: 28px 32px; max-width: 900px; }
.req-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 24px; }
.req-title { font-size: 22px; font-weight: 600; letter-spacing: -0.03em; margin-bottom: 2px; }
.req-sub { color: var(--muted); font-size: 13px; }
.req-filters { display: flex; gap: 6px; margin-bottom: 20px; overflow-x: auto; padding-bottom: 4px; scrollbar-width: none; }
.req-filters::-webkit-scrollbar { display: none; }
.req-filter {
  padding: 6px 14px; border-radius: 20px; font-size: 13px; font-weight: 500;
  border: 1px solid var(--border); background: var(--card); color: var(--text);
  cursor: pointer; white-space: nowrap; transition: all 0.12s;
}
.req-filter.active { background: var(--accent); color: #fff; border-color: var(--accent); }
.req-empty { color: var(--muted); font-size: 14px; padding: 60px 0; text-align: center; }
.req-loading { color: var(--muted); font-size: 14px; padding: 60px 0; text-align: center; }
.req-list { display: flex; flex-direction: column; gap: 10px; }
.req-item {
  background: var(--card); border: 1px solid var(--border);
  border-radius: var(--radius-card); padding: 16px 20px;
  display: flex; align-items: center; gap: 16px;
  box-shadow: var(--shadow-sm);
}
.req-item-body { flex: 1; min-width: 0; }
.req-item-title { font-weight: 600; font-size: 14px; display: flex; align-items: center; gap: 8px; margin-bottom: 6px; }
.req-item-meta { font-size: 12px; color: var(--muted); display: flex; gap: 14px; flex-wrap: wrap; }
.req-item-actions { display: flex; gap: 8px; flex-shrink: 0; }

@media (max-width: 768px) {
  .req-page { padding: 16px; overflow-x: hidden; }
  .req-title { font-size: 18px; }
  .req-filters { display: none !important; }
  .req-item { flex-direction: column; align-items: flex-start; gap: 12px; padding: 14px 16px; }
  .req-item-body { width: 100%; }
  .req-item-meta { flex-wrap: wrap; gap: 8px; }
  .req-item-actions { width: 100%; }
  .req-item-actions .btn { flex: 1; }
}
`

const STATUS_LABELS = {
  new:        { label: 'Новый',       color: 'blue' },
  collecting: { label: 'В работе',     color: 'amber' },
  ready:      { label: 'Готов',       color: 'green' },
  issued:     { label: 'Выдан',       color: 'green' },
  cancelled:  { label: 'Отменён',     color: 'red' },
}

const FILTERS = [
  { value: '',           label: 'Все' },
  { value: 'new',        label: 'Новые' },
  { value: 'collecting', label: 'В работе' },
  { value: 'ready',      label: 'Готовы' },
  { value: 'issued',     label: 'Выданы' },
  { value: 'cancelled',  label: 'Отменены' },
]

function formatDate(str) {
  if (!str) return '—'
  return new Date(str).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', year: 'numeric' })
}

export default function RequestsPage() {
  const navigate = useNavigate()
  const { user } = useAuth()
  const isDirector = ['warehouse_director', 'warehouse_deputy'].includes(user?.role)
  const [filter, setFilter] = useState('')
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [updating, setUpdating] = useState(null)
  const [showVisibility, setShowVisibility] = useState(false)
  const [visSettings, setVisSettings] = useState([])
  const [visLoading, setVisLoading] = useState(false)
  const [expanded, setExpanded] = useState(null)
  const [unitCache, setUnitCache] = useState({})
  const [loadingUnits, setLoadingUnits] = useState(null)

  function load(status) {
    setLoading(true)
    const params = status ? { status } : {}
    requestsApi.list(params)
      .then(data => setItems(data.requests || []))
      .catch(() => {})
      .finally(() => setLoading(false))
  }

  useEffect(() => { load(filter) }, [filter])

  async function changeStatus(id, status) {
    setUpdating(id)
    try {
      await requestsApi.status(id, status)
      load(filter)
    } catch (e) {
      alert(e.message)
    } finally {
      setUpdating(null)
    }
  }

  async function toggleExpand(reqId, unitIds) {
    if (expanded === reqId) { setExpanded(null); return }
    setExpanded(reqId)
    const missing = (unitIds || []).filter(id => !unitCache[id])
    if (!missing.length) return
    setLoadingUnits(reqId)
    try {
      const results = await Promise.all(missing.map(id => unitsApi.get(id).catch(() => null)))
      const next = { ...unitCache }
      for (const r of results) { if (r?.unit) next[r.unit.id] = r.unit }
      setUnitCache(next)
    } catch {}
    setLoadingUnits(null)
  }

  return (
    <WarehouseLayout>
      <style>{css}</style>
      <div className="req-page">
        <div className="req-header">
          <div>
            <h1 className="req-title">Заявки</h1>
            <p className="req-sub">Заявки на выдачу оборудования со склада</p>
          </div>
          {isDirector && (
            <Button variant="secondary" onClick={() => {
              setShowVisibility(true)
              setVisLoading(true)
              warehousesApi.requestVisibility()
                .then(data => setVisSettings(data.settings || []))
                .catch(() => {})
                .finally(() => setVisLoading(false))
            }}>
              Видимость
            </Button>
          )}
        </div>

        <div className="req-filters">
          {FILTERS.map(f => (
            <button key={f.value} className={`req-filter${filter === f.value ? ' active' : ''}`}
              onClick={() => setFilter(f.value)}>
              {f.label}
            </button>
          ))}
        </div>

        {loading ? (
          <div className="req-loading">Загрузка...</div>
        ) : items.length === 0 ? (
          <div className="req-empty">Нет заявок</div>
        ) : (
          <div className="req-list">
            {items.map(r => {
              const st = STATUS_LABELS[r.status] || { label: r.status, color: 'blue' }
              const ids = r.unit_ids || []
              const isOpen = expanded === r.id
              return (
                <div key={r.id} style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 'var(--radius-card)', boxShadow: 'var(--shadow-sm)' }}>
                  <div className="req-item" style={{ cursor: 'pointer' }} onClick={() => toggleExpand(r.id, ids)}>
                    <div className="req-item-body">
                      <div className="req-item-title">
                        Заявка #{r.id.slice(0, 8)}
                        <Badge color={st.color}>{st.label}</Badge>
                      </div>
                      <div className="req-item-meta">
                        {r.project_name && <span>{r.project_name} ·</span>}
                        <span>{r.requester_name}</span>
                        {r.requester_email && <span>{r.requester_email}</span>}
                        <span>{ids.length} ед.</span>
                        {r.deadline && <span>до {formatDate(r.deadline)}</span>}
                        <span>{formatDate(r.created_at)}</span>
                      </div>
                      {r.notes && <div style={{ fontSize: 12, color: 'var(--text)', marginTop: 4 }}>{r.notes}</div>}
                    </div>
                    <div className="req-item-actions" onClick={e => e.stopPropagation()}>
                      {r.status === 'new' && (<>
                        <Button variant="secondary" style={{ height: 34, fontSize: 13 }}
                          disabled={updating === r.id} onClick={() => changeStatus(r.id, 'collecting')}>
                          Принять
                        </Button>
                        <Button variant="danger" style={{ height: 34, fontSize: 13 }}
                          disabled={updating === r.id} onClick={() => changeStatus(r.id, 'cancelled')}>
                          Отменить
                        </Button>
                      </>)}
                      {r.status === 'collecting' && (<>
                        <Button variant="secondary" style={{ height: 34, fontSize: 13 }}
                          disabled={updating === r.id} onClick={() => changeStatus(r.id, 'ready')}>
                          Готово
                        </Button>
                        <Button variant="danger" style={{ height: 34, fontSize: 13 }}
                          disabled={updating === r.id} onClick={() => changeStatus(r.id, 'cancelled')}>
                          Отменить
                        </Button>
                      </>)}
                      {r.status === 'ready' && (
                        <Button variant="primary" style={{ height: 34, fontSize: 13 }}
                          onClick={() => navigate(`/issue/${r.id}`)}>
                          Выдать →
                        </Button>
                      )}
                    </div>
                    <span style={{ color: 'var(--muted)', fontSize: 14, transition: 'transform 0.2s', transform: isOpen ? 'rotate(180deg)' : 'none' }}>▾</span>
                  </div>
                  {isOpen && (
                    <div style={{ borderTop: '1px solid var(--border)', padding: '12px 20px' }}>
                      {loadingUnits === r.id ? (
                        <div style={{ fontSize: 13, color: 'var(--muted)' }}>Загрузка единиц...</div>
                      ) : (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                          {ids.map(uid => {
                            const u = unitCache[uid]
                            if (!u) return <div key={uid} style={{ fontSize: 12, color: 'var(--muted)' }}>Единица не найдена</div>
                            const photos = u.photos || []
                            return (
                              <div key={uid} style={{
                                display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px',
                                borderRadius: 8, background: 'var(--bg)', border: '1px solid var(--border)',
                                cursor: 'pointer',
                              }} onClick={() => navigate(`/units/${uid}`)}>
                                {photos[0]?.url ? (
                                  <img src={photos[0].url} alt="" style={{ width: 44, height: 44, borderRadius: 6, objectFit: 'contain', flexShrink: 0 }} />
                                ) : (
                                  <div style={{ width: 44, height: 44, borderRadius: 6, background: 'var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18, flexShrink: 0 }}>📦</div>
                                )}
                                <div style={{ flex: 1 }}>
                                  <div style={{ fontWeight: 500, fontSize: 13 }}>{u.name}</div>
                                  <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 1 }}>
                                    {u.serial && `${u.serial} · `}{u.category || ''}
                                  </div>
                                </div>
                                <Badge color={u.status === 'on_stock' ? 'green' : u.status === 'issued' ? 'amber' : 'muted'}>
                                  {u.status === 'on_stock' ? 'На складе' : u.status === 'issued' ? 'Выдано' : u.status}
                                </Badge>
                              </div>
                            )
                          })}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>

      {showVisibility && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 400, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}
          onClick={() => setShowVisibility(false)}>
          <div style={{ background: 'var(--white)', borderRadius: 'var(--radius-card)', padding: 24, maxWidth: 440, width: '100%' }}
            onClick={e => e.stopPropagation()}>
            <div style={{ fontWeight: 600, fontSize: 16, marginBottom: 16 }}>Видимость заявок</div>
            <div style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 16 }}>
              Выберите, кто из сотрудников видит заявки
            </div>
            {visLoading ? (
              <div style={{ color: 'var(--muted)', fontSize: 13 }}>Загрузка...</div>
            ) : visSettings.length === 0 ? (
              <div style={{ color: 'var(--muted)', fontSize: 13 }}>Нет сотрудников</div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {visSettings.map(s => (
                  <label key={s.id} style={{
                    display: 'flex', alignItems: 'center', gap: 10,
                    padding: '10px 12px', background: 'var(--bg)',
                    borderRadius: 8, border: '1px solid var(--border)', cursor: 'pointer',
                  }}>
                    <input type="checkbox" checked={s.can_see_requests}
                      onChange={async () => {
                        const newVal = !s.can_see_requests
                        setVisSettings(prev => prev.map(p => p.id === s.id ? { ...p, can_see_requests: newVal } : p))
                        await warehousesApi.setRequestVisibility(s.id, newVal).catch(() => {})
                      }}
                      style={{ width: 16, height: 16, cursor: 'pointer' }} />
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 500 }}>{s.name}</div>
                      <div style={{ fontSize: 11, color: 'var(--muted)' }}>{s.role === 'warehouse_deputy' ? 'Зам директора' : 'Сотрудник склада'}</div>
                    </div>
                  </label>
                ))}
              </div>
            )}
            <div style={{ marginTop: 16 }}>
              <Button fullWidth onClick={() => setShowVisibility(false)}>Готово</Button>
            </div>
          </div>
        </div>
      )}
    </WarehouseLayout>
  )
}
