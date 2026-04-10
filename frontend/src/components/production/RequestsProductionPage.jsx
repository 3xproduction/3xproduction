import { useState, useEffect } from 'react'
import ProductionLayout from './ProductionLayout'
import { requests as requestsApi, units as unitsApi, issuances as issuancesApi } from '../../services/api'
import { useAuth } from '../../hooks/useAuth'

const TABS = ['Смотрим', 'Получено', 'Прошлые']

const STATUS_MAP = {
  'Смотрим':   ['new', 'approved', 'collecting', 'ready'],
  'Получено':  ['issued'],
  'Прошлые':   ['cancelled', 'rejected'],
}

const STATUS_BADGE = {
  new:        { label: 'Новая',              bg: 'var(--blue-dim)',   color: 'var(--blue)' },
  approved:   { label: 'Одобрено',           bg: 'var(--green-dim)',  color: 'var(--green)' },
  collecting: { label: 'Принято в работу',   bg: 'var(--amber-dim)',  color: 'var(--amber)' },
  ready:      { label: 'Готово к выдаче',    bg: 'var(--green-dim)',  color: 'var(--green)' },
  issued:     { label: 'Получено',            bg: 'var(--green-dim)',  color: 'var(--green)' },
  cancelled:  { label: 'Отменено',           bg: 'var(--bg)',         color: 'var(--muted)' },
  rejected:   { label: 'Отклонено',          bg: 'var(--red-dim)',    color: 'var(--red)' },
}

function formatDate(str) {
  if (!str) return '—'
  return new Date(str).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })
}

const css = `
@media (max-width: 768px) {
  .rp-page { padding: 16px !important; }
  .rp-tabs { overflow-x: auto; scrollbar-width: none; }
  .rp-tabs::-webkit-scrollbar { display: none; }
  .rp-tabs button { white-space: nowrap; padding: 9px 14px !important; font-size: 13px !important; }
  .rp-card { padding: 14px 16px !important; }
  .rp-card-head { flex-wrap: wrap; gap: 6px; }
}
`

export default function RequestsProductionPage() {
  const { user } = useAuth()
  const [tab, setTab] = useState('Смотрим')
  const [allRequests, setAllRequests] = useState([])
  const [loading, setLoading] = useState(true)
  const [expanded, setExpanded] = useState(null)
  const [unitDetails, setUnitDetails] = useState({})
  const [unitPhotos, setUnitPhotos] = useState({})
  const [loadingUnits, setLoadingUnits] = useState(null)
  const [selectedUnit, setSelectedUnit] = useState(null)

  useEffect(() => {
    if (!user?.id) return
    const isProducer = user?.role === 'producer'
    const params = isProducer
      ? {} // producer sees all requests
      : user?.project_id
        ? { project_id: user.project_id }
        : { requester_id: user.id }
    requestsApi.list(params)
      .then(data => setAllRequests(data.requests || []))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [user?.id])

  async function toggleExpand(reqId, unitIds) {
    if (expanded === reqId) { setExpanded(null); return }
    setExpanded(reqId)

    const missing = (unitIds || []).filter(id => !unitDetails[id])
    if (missing.length === 0) return

    setLoadingUnits(reqId)
    try {
      const results = await Promise.all(missing.map(id => unitsApi.get(id).catch(() => null)))
      const next = { ...unitDetails }
      const nextPhotos = { ...unitPhotos }
      for (const r of results) {
        if (r?.unit) {
          next[r.unit.id] = r.unit
          nextPhotos[r.unit.id] = r.unit.photos || []
        }
      }
      setUnitDetails(next)
      setUnitPhotos(nextPhotos)
    } catch {}
    setLoadingUnits(null)
  }

  const filtered = allRequests.filter(r => (STATUS_MAP[tab] || []).includes(r.status))

  return (
    <ProductionLayout>
      <style>{css}</style>
      <div className="rp-page" style={{ padding: '24px 32px', maxWidth: 800 }}>
        <div style={{ marginBottom: 24 }}>
          <h1 style={{ fontSize: 20, fontWeight: 600 }}>Заявки на склад</h1>
          <p style={{ fontSize: 13, color: 'var(--muted)', marginTop: 2 }}>
            {allRequests.length} всего · {allRequests.filter(r => r.status === 'new').length} на рассмотрении
          </p>
        </div>

        <div className="rp-tabs" style={{ display: 'flex', gap: 0, marginBottom: 24, borderBottom: '2px solid var(--border)' }}>
          {TABS.map(t => (
            <button key={t} onClick={() => setTab(t)} style={{
              padding: '9px 20px', border: 'none', background: 'none',
              fontWeight: 500, fontSize: 14, cursor: 'pointer',
              color: tab === t ? 'var(--blue)' : 'var(--muted)',
              borderBottom: `2px solid ${tab === t ? 'var(--blue)' : 'transparent'}`,
              marginBottom: -2,
            }}>
              {t}
              {t === 'Смотрим' && allRequests.filter(r => STATUS_MAP[t].includes(r.status)).length > 0 && (
                <span style={{ marginLeft: 6, fontSize: 11, fontWeight: 600, padding: '1px 6px', borderRadius: 10, background: 'var(--blue-dim)', color: 'var(--blue)' }}>
                  {allRequests.filter(r => STATUS_MAP[t].includes(r.status)).length}
                </span>
              )}
            </button>
          ))}
        </div>

        {loading ? (
          <div style={{ color: 'var(--muted)', fontSize: 13 }}>Загрузка...</div>
        ) : filtered.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '60px 0', color: 'var(--muted)', fontSize: 14 }}>
            {tab === 'Смотрим' ? 'Нет активных заявок' : 'Нет заявок'}
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {filtered.map(r => {
              const badge = STATUS_BADGE[r.status] || { label: r.status, bg: 'var(--bg)', color: 'var(--muted)' }
              const isOpen = expanded === r.id
              const ids = r.unit_ids || []
              return (
                <div key={r.id} className="rp-card" style={{
                  background: 'var(--white)', border: '1px solid var(--border)',
                  borderRadius: 'var(--radius-card)', padding: '16px 20px',
                }}>
                  <div className="rp-card-head" style={{
                    display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 8,
                    cursor: 'pointer',
                  }} onClick={() => toggleExpand(r.id, ids)}>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontWeight: 500, fontSize: 14 }}>
                        Заявка #{String(r.id).slice(0, 8)}
                      </div>
                      {r.notes && (
                        <div style={{ fontSize: 13, color: 'var(--text)', marginTop: 4, lineHeight: 1.5 }}>
                          {r.notes}
                        </div>
                      )}
                      <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 4 }}>
                        {ids.length} ед. · {formatDate(r.created_at)}
                        {r.user_name && ` · ${r.user_name}`}
                      </div>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ fontSize: 12, fontWeight: 500, padding: '3px 10px', borderRadius: 'var(--radius-badge)', background: badge.bg, color: badge.color }}>
                        {badge.label}
                      </span>
                      <span style={{ fontSize: 16, color: 'var(--muted)', transition: 'transform 0.2s', transform: isOpen ? 'rotate(180deg)' : 'rotate(0)' }}>
                        ▾
                      </span>
                    </div>
                  </div>

                  {isOpen && (
                    <div style={{ borderTop: '1px solid var(--border)', paddingTop: 12, marginTop: 4 }}>
                      {loadingUnits === r.id ? (
                        <div style={{ fontSize: 13, color: 'var(--muted)' }}>Загрузка единиц...</div>
                      ) : (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                          {r.status === 'issued' && r.issuance_id && (
                            <div style={{ marginBottom: 8 }}>
                              {r.return_requested_at ? (
                                <div style={{
                                  padding: '10px 14px', borderRadius: 'var(--radius-btn)',
                                  background: 'var(--amber-dim)', color: 'var(--amber)',
                                  fontSize: 13, fontWeight: 500, textAlign: 'center',
                                }}>
                                  Возврат запрошен — ожидайте подтверждения склада
                                </div>
                              ) : (
                                <button onClick={async (e) => {
                                  e.stopPropagation()
                                  if (!confirm('Запросить возврат имущества?')) return
                                  try {
                                    await issuancesApi.requestReturn(r.issuance_id)
                                    setAllRequests(prev => prev.map(req =>
                                      req.id === r.id ? { ...req, return_requested_at: new Date().toISOString() } : req
                                    ))
                                  } catch (err) {
                                    alert(err.message || 'Ошибка')
                                  }
                                }} style={{
                                  width: '100%', padding: '10px 14px', borderRadius: 'var(--radius-btn)',
                                  background: 'var(--accent)', color: '#fff', border: 'none',
                                  fontSize: 13, fontWeight: 500, cursor: 'pointer',
                                }}>
                                  Запросить возврат
                                </button>
                              )}
                            </div>
                          )}
                          {ids.map(uid => {
                            const u = unitDetails[uid]
                            if (!u) return (
                              <div key={uid} style={{ fontSize: 12, color: 'var(--muted)', padding: '8px 0' }}>
                                Единица не найдена
                              </div>
                            )
                            const photos = unitPhotos[uid] || []
                            return (
                              <div key={uid} onClick={() => setSelectedUnit(selectedUnit === uid ? null : uid)} style={{
                                padding: '10px 12px', borderRadius: 8,
                                border: '1px solid var(--border)', cursor: 'pointer',
                                background: selectedUnit === uid ? 'var(--blue-dim)' : 'var(--bg)',
                                transition: 'background 0.15s',
                              }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                                  {photos.length > 0 && (
                                    <img src={photos[0].url || photos[0]} alt="" style={{
                                      width: 44, height: 44, borderRadius: 6, objectFit: 'contain', flexShrink: 0,
                                    }} />
                                  )}
                                  <div style={{ flex: 1 }}>
                                    <div style={{ fontWeight: 500, fontSize: 13 }}>{u.name}</div>
                                    <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>
                                      {u.serial && `${u.serial} · `}{u.category || ''}
                                    </div>
                                  </div>
                                  <span style={{
                                    fontSize: 11, fontWeight: 500, padding: '2px 8px', borderRadius: 'var(--radius-badge)',
                                    background: u.status === 'on_stock' ? 'var(--green-dim)' : u.status === 'issued' ? 'var(--amber-dim)' : 'var(--bg)',
                                    color: u.status === 'on_stock' ? 'var(--green)' : u.status === 'issued' ? 'var(--amber)' : 'var(--muted)',
                                  }}>
                                    {u.status === 'on_stock' ? 'На складе' : u.status === 'issued' ? 'Получено' : u.status}
                                  </span>
                                </div>

                                {selectedUnit === uid && (
                                  <div style={{ marginTop: 10, borderTop: '1px solid var(--border)', paddingTop: 10 }}>
                                    {u.description && (
                                      <div style={{ fontSize: 12, color: 'var(--text)', marginBottom: 8, lineHeight: 1.5 }}>
                                        {u.description}
                                      </div>
                                    )}
                                    <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 8 }}>
                                      {u.serial && <div>Серийный №: {u.serial}</div>}
                                      {u.category && <div>Категория: {u.category}</div>}
                                      {u.cell_name && <div>Полка: {u.cell_name}</div>}
                                    </div>
                                    {photos.length > 0 && (
                                      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                                        {photos.map((p, i) => (
                                          <img key={i} src={p.url || p} alt="" style={{
                                            width: 80, height: 80, borderRadius: 8, objectFit: 'contain',
                                          }} />
                                        ))}
                                      </div>
                                    )}
                                    {photos.length === 0 && (
                                      <div style={{ fontSize: 12, color: 'var(--muted)' }}>Нет фото</div>
                                    )}
                                  </div>
                                )}
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

      {selectedUnit && unitDetails[selectedUnit] && (() => {
        const photos = unitPhotos[selectedUnit] || []
        return photos.length > 0 ? null : null
      })()}
    </ProductionLayout>
  )
}
