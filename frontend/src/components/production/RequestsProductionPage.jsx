import { useState, useEffect } from 'react'
import ProductionLayout from './ProductionLayout'
import Badge from '../shared/Badge'
import Button from '../shared/Button'
import ConfirmModal from '../shared/ConfirmModal'
import UnitCardModal from '../shared/UnitCardModal'
import { useToast } from '../shared/Toast'
import { requests as requestsApi, units as unitsApi, issuances as issuancesApi } from '../../services/api'
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
  issued:     { label: 'Получен',     color: 'green' },
  cancelled:  { label: 'Отменён',     color: 'red' },
}

const FILTERS = [
  { value: '',           label: 'Все' },
  { value: 'new',        label: 'Новые' },
  { value: 'issued',     label: 'Получены' },
  { value: 'returning',  label: 'Возвращаю' },
  { value: 'returned',   label: 'Вернули' },
]

function formatDate(str) {
  if (!str) return '—'
  return new Date(str).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', year: 'numeric' })
}

export default function RequestsProductionPage() {
  const { user } = useAuth()
  const [filter, setFilter] = useState('')
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [confirmReturnReq, setConfirmReturnReq] = useState(null)
  const [expanded, setExpanded] = useState(null)
  const [unitCache, setUnitCache] = useState({})
  const [loadingUnits, setLoadingUnits] = useState(null)
  // Открытая карточка единицы — новый UnitCardModal вместо навигации /units/:id.
  const [cardUnitId, setCardUnitId] = useState(null)
  const toast = useToast()

  async function doRequestReturn() {
    const r = confirmReturnReq
    if (!r) return
    try {
      await issuancesApi.requestReturn(r.issuance_id)
      setItems(prev => prev.map(x =>
        x.id === r.id ? { ...x, return_requested_at: new Date().toISOString() } : x
      ))
      toast?.('Готовы вернуть — ожидайте подтверждения склада', 'success')
    } catch (err) {
      toast?.(err.message || 'Ошибка', 'error')
    }
    setConfirmReturnReq(null)
  }

  function load(status) {
    if (!user?.id) return
    setLoading(true)
    const isProducer = user?.role === 'producer'
    const base = isProducer
      ? {}
      : user?.project_id
        ? { project_id: user.project_id }
        : { requester_id: user.id }
    const params = status && status !== 'returning' && status !== 'returned'
      ? { ...base, status }
      : base
    requestsApi.list(params)
      .then(data => setItems(data.requests || []))
      .catch(() => {})
      .finally(() => setLoading(false))
  }

  const displayedItems = (() => {
    if (filter === 'returning') {
      return items.filter(r => r.return_requested_at && !r.returned_at && r.status === 'issued')
    }
    if (filter === 'returned') {
      return items.filter(r => r.returned_at)
    }
    return items.filter(r => !r.returned_at)
  })()

  useEffect(() => { load(filter) }, [filter, user?.id])

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
    <ProductionLayout>
      <style>{css}</style>
      <div className="req-page">
        <div className="req-header">
          <div>
            <h1 className="req-title">Заявки</h1>
          </div>
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
        ) : displayedItems.length === 0 ? (
          <div className="req-empty">Нет заявок</div>
        ) : (
          <div className="req-list">
            {displayedItems.map(r => {
              const st = r.returned_at
                ? { label: 'Вернули', color: 'green' }
                : STATUS_LABELS[r.status] || { label: r.status, color: 'blue' }
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
                      {r.status === 'issued' && r.issuance_id && !r.return_requested_at && !r.returned_at && (
                        <Button variant="primary" style={{ height: 34, fontSize: 13 }}
                          onClick={() => setConfirmReturnReq(r)}>
                          Запросить возврат
                        </Button>
                      )}
                      {r.status === 'issued' && r.return_requested_at && !r.returned_at && (
                        <Badge color="amber">Готовы вернуть</Badge>
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
                              }} onClick={() => setCardUnitId(uid)}>
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
                                  {u.status === 'on_stock' ? 'На складе' : u.status === 'issued' ? 'Получено' : u.status}
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

      {cardUnitId && (
        <UnitCardModal unitId={cardUnitId} onClose={() => setCardUnitId(null)} />
      )}

      <ConfirmModal
        open={!!confirmReturnReq}
        title="Запросить возврат"
        message="Склад получит уведомление и подтвердит фактический возврат имущества."
        confirmLabel="Запросить"
        cancelLabel="Отмена"
        onConfirm={doRequestReturn}
        onCancel={() => setConfirmReturnReq(null)}
      />
    </ProductionLayout>
  )
}
