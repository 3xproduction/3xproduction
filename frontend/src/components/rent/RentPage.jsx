import { useState, useEffect } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Handshake, TrendingUp, AlertTriangle, Package } from 'lucide-react'
import WarehouseLayout from '../warehouse/WarehouseLayout'
import ProductionLayout from '../production/ProductionLayout'
import { useAuth } from '../../hooks/useAuth'
import { ROLES } from '../../constants/roles'
import Badge from '../shared/Badge'
import Button from '../shared/Button'
import Input from '../shared/Input'
import ConfirmModal from '../shared/ConfirmModal'
import SignatureCanvas from '../shared/SignatureCanvas'
import PhotoUpload from '../shared/PhotoUpload'
import MultiPhotoPicker from '../shared/MultiPhotoPicker'
import UnitCardModal from '../shared/UnitCardModal'
import { useToast } from '../shared/Toast'
import { categoryLabel, CATEGORIES_FILTER } from '../../constants/categories'
import { rent as rentApi, units as unitsApi, warehouses as warehousesApi } from '../../services/api'

// /rent показывает только партнёрские сделки (rent_deals) — 1-в-1 как
// проектные заявки, но через workflow_stage. Фильтры зеркалят RequestsPage.
const DEAL_FILTERS = [
  { value: 'all',      label: 'Все' },
  { value: 'new',      label: 'Новые' },
  { value: 'issued',   label: 'Выданы' },
  { value: 'returned', label: 'Вернули' },
]

const STATUS_LABELS = {
  new:        { label: 'Новый',          color: 'blue' },
  collecting: { label: 'Собирают',       color: 'amber' },
  ready:      { label: 'Готов',          color: 'green' },
  issued:     { label: 'Выдан',          color: 'green' },
  returning:  { label: 'Готовы вернуть', color: 'amber' },
  returned:   { label: 'Вернули',        color: 'green' },
  cancelled:  { label: 'Отменён',        color: 'red' },
}

// Партнёрская сделка — пришла через внешнюю ссылку (requester_* или workflow_stage).
function isPartner(d) {
  return !!(d.requester_name || d.requester_project || d.requester_message || d.workflow_stage)
}

function formatDate(str) {
  if (!str) return '—'
  return new Date(str).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', year: 'numeric' })
}

// Какой визуальный статус показывать для сделки — унифицирует status/workflow_stage
// и возвращает ключ STATUS_LABELS.
function getDisplayStatus(d) {
  if (d.status === 'cancelled') return 'cancelled'
  if (d.status === 'done' || d.status === 'completed' || d.status === 'returned') return 'returned'
  if ((d.status === 'active' || d.status === 'overdue') && d.return_requested_at) return 'returning'
  if (d.status === 'active' || d.status === 'overdue') return 'issued'
  if (d.status === 'pending_review') {
    if (d.workflow_stage === 'ready') return 'ready'
    if (d.workflow_stage === 'collecting') return 'collecting'
    return 'new'
  }
  return d.status
}

const css = `
.rent-page { padding: 28px 32px; max-width: 960px; }
.rent-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 20px; }
.rent-title { font-size: 22px; font-weight: 600; letter-spacing: -0.02em; margin-bottom: 2px; }
.rent-sub { color: var(--muted); font-size: 13px; }
.rent-stats { display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 12px; margin-bottom: 20px; }
.rent-filters { display: flex; gap: 6px; margin-bottom: 20px; overflow-x: auto; padding-bottom: 4px; scrollbar-width: none; }
.rent-filters::-webkit-scrollbar { display: none; }
.rent-filter {
  padding: 6px 14px; border-radius: 20px; font-size: 13px; font-weight: 500;
  border: 1px solid var(--border); background: var(--card); color: var(--text);
  cursor: pointer; white-space: nowrap; transition: all 0.12s;
}
.rent-filter.active { background: var(--accent); color: #fff; border-color: var(--accent); }
.rent-empty { color: var(--muted); font-size: 14px; padding: 60px 0; text-align: center; }
.rent-loading { color: var(--muted); font-size: 14px; padding: 60px 0; text-align: center; }
.rent-list { display: flex; flex-direction: column; gap: 10px; }
.rent-item {
  background: var(--card); border: 1px solid var(--border);
  border-radius: var(--radius-card); padding: 16px 20px;
  display: flex; align-items: center; gap: 16px;
  box-shadow: var(--shadow-sm);
}
.rent-item-body { flex: 1; min-width: 0; }
.rent-item-title { font-weight: 600; font-size: 14px; display: flex; align-items: center; gap: 8px; margin-bottom: 6px; flex-wrap: wrap; }
.rent-item-meta { font-size: 12px; color: var(--muted); display: flex; gap: 14px; flex-wrap: wrap; }
.rent-item-actions { display: flex; gap: 8px; flex-shrink: 0; }
@media (max-width: 768px) {
  .rent-page { padding: 16px; overflow-x: hidden; }
  .rent-title { font-size: 18px; }
  .rent-item { flex-direction: column; align-items: flex-start; gap: 12px; padding: 14px 16px; }
  .rent-item-body { width: 100%; }
  .rent-item-actions { width: 100%; }
  .rent-item-actions .btn { flex: 1; }
}
`

export default function RentPage() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const Layout = ROLES[user?.role]?.world === 'production' ? ProductionLayout : WarehouseLayout
  const [deals, setDeals] = useState([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState('all')
  const [expanded, setExpanded] = useState(null)
  const [unitCache, setUnitCache] = useState({})
  const [loadingUnits, setLoadingUnits] = useState(null)
  const [updating, setUpdating] = useState(null)
  const [confirmReturnReq, setConfirmReturnReq] = useState(null)
  const [cardId, setCardId] = useState(null)
  const [searchParams, setSearchParams] = useSearchParams()
  const toast = useToast()

  function loadDeals() {
    setLoading(true)
    rentApi.list().then(d => setDeals(d.deals || [])).finally(() => setLoading(false))
  }
  useEffect(() => { loadDeals() }, [])

  // Убираем устаревшие query-параметры (?filter=public, ?review=…) — раньше
  // /rent умел авто-открывать ReviewModal, теперь обработка через список.
  useEffect(() => {
    const dirty = searchParams.get('filter') || searchParams.get('review')
    if (dirty) {
      const next = new URLSearchParams(searchParams)
      next.delete('filter'); next.delete('review')
      setSearchParams(next, { replace: true })
    }
  }, [])

  const partnerDeals = deals.filter(isPartner)

  const activeCount = partnerDeals.filter(d => d.status === 'active').length
  const monthSum = partnerDeals
    .filter(d => d.status !== 'cancelled' && d.status !== 'pending_review')
    .reduce((a, d) => a + (Number(d.price_total) || 0), 0)
  const overdueCount = partnerDeals.filter(d => d.status === 'overdue').length

  const filtered = partnerDeals.filter(d => {
    const ds = getDisplayStatus(d)
    if (filter === 'all')      return true
    if (filter === 'new')      return ds === 'new' || ds === 'collecting' || ds === 'ready'
    if (filter === 'issued')   return ds === 'issued' || ds === 'returning'
    if (filter === 'returned') return ds === 'returned' || ds === 'cancelled'
    return true
  })

  async function toggleExpand(dealId, unitIds) {
    if (expanded === dealId) { setExpanded(null); return }
    setExpanded(dealId)
    const missing = (unitIds || []).filter(id => !unitCache[id])
    if (!missing.length) return
    setLoadingUnits(dealId)
    try {
      const results = await Promise.all(missing.map(id => unitsApi.get(id).catch(() => null)))
      const next = { ...unitCache }
      for (const r of results) { if (r?.unit) next[r.unit.id] = r.unit }
      setUnitCache(next)
    } catch {}
    setLoadingUnits(null)
  }

  async function changeStage(id, stage) {
    setUpdating(id)
    try {
      await rentApi.workflowStage(id, stage)
      loadDeals()
    } catch (e) {
      toast?.(e.message || 'Ошибка', 'error')
    } finally {
      setUpdating(null)
    }
  }

  async function cancelDeal(id) {
    setUpdating(id)
    try {
      await rentApi.status(id, 'cancelled')
      loadDeals()
    } catch (e) {
      toast?.(e.message || 'Ошибка', 'error')
    } finally {
      setUpdating(null)
    }
  }

  async function doRequestReturn() {
    const d = confirmReturnReq
    if (!d) return
    try {
      await rentApi.requestReturn(d.id)
      setDeals(prev => prev.map(x =>
        x.id === d.id ? { ...x, return_requested_at: new Date().toISOString() } : x
      ))
      toast?.('Возврат запрошен — партнёр получит уведомление', 'success')
    } catch (err) {
      toast?.(err.message || 'Ошибка', 'error')
    }
    setConfirmReturnReq(null)
  }

  return (
    <Layout>
      <style>{css}</style>
      <div className="rent-page">
        <div className="rent-header">
          <div>
            <h1 className="rent-title">Выручка</h1>
            <p className="rent-sub">Партнёрские сделки на аренду имущества</p>
          </div>
        </div>

        <div className="rent-stats">
          <StatCard icon={Handshake} label="Активных сделок" value={activeCount} accent="gold" />
          <StatCard icon={TrendingUp} label="Выручка" value={monthSum.toLocaleString('ru-RU') + ' ₽'} accent="green" />
          {overdueCount > 0 && <StatCard icon={AlertTriangle} label="Просрочено" value={overdueCount} accent="red" />}
        </div>

        <div className="rent-filters">
          {DEAL_FILTERS.map(f => (
            <button key={f.value} className={`rent-filter${filter === f.value ? ' active' : ''}`}
              onClick={() => setFilter(f.value)}>
              {f.label}
            </button>
          ))}
        </div>

        {loading ? (
          <div className="rent-loading">Загрузка...</div>
        ) : filtered.length === 0 ? (
          <div className="rent-empty">Нет сделок</div>
        ) : (
          <div className="rent-list">
            {filtered.map(d => {
              const ds = getDisplayStatus(d)
              const st = STATUS_LABELS[ds] || { label: ds, color: 'blue' }
              const ids = d.unit_ids || []
              const isOpen = expanded === d.id
              return (
                <div key={d.id} style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 'var(--radius-card)', boxShadow: 'var(--shadow-sm)' }}>
                  <div className="rent-item" style={{ cursor: 'pointer' }} onClick={() => toggleExpand(d.id, ids)}>
                    <div className="rent-item-body">
                      <div className="rent-item-title">
                        Партнёрская #{String(d.id).slice(0, 8)}
                        <Badge color={st.color}>{st.label}</Badge>
                        <Badge color="blue">Партнёрская</Badge>
                      </div>
                      <div className="rent-item-meta">
                        {d.counterparty_name && <span>{d.counterparty_name}</span>}
                        {d.requester_name && d.requester_name !== d.counterparty_name && <span>· {d.requester_name}</span>}
                        {d.counterparty_email && <span>{d.counterparty_email}</span>}
                        <span>{ids.length} ед.</span>
                        {d.period_end && <span>до {formatDate(d.period_end)}</span>}
                        <span>{formatDate(d.created_at)}</span>
                      </div>
                      {d.requester_message && <div style={{ fontSize: 12, color: 'var(--text)', marginTop: 4 }}>{d.requester_message}</div>}
                    </div>
                    <div className="rent-item-actions" onClick={e => e.stopPropagation()}>
                      {/* pending_review: null → collecting → ready → выдача */}
                      {d.status === 'pending_review' && !d.workflow_stage && (<>
                        <Button variant="secondary" style={{ height: 34, fontSize: 13 }} disabled={updating === d.id}
                          onClick={() => changeStage(d.id, 'collecting')}>
                          Принять
                        </Button>
                        <Button variant="danger" style={{ height: 34, fontSize: 13 }} disabled={updating === d.id}
                          onClick={() => cancelDeal(d.id)}>
                          Отменить
                        </Button>
                      </>)}
                      {d.status === 'pending_review' && d.workflow_stage === 'collecting' && (<>
                        <Button variant="secondary" style={{ height: 34, fontSize: 13 }} disabled={updating === d.id}
                          onClick={() => changeStage(d.id, 'ready')}>
                          Готово
                        </Button>
                        <Button variant="danger" style={{ height: 34, fontSize: 13 }} disabled={updating === d.id}
                          onClick={() => cancelDeal(d.id)}>
                          Отменить
                        </Button>
                      </>)}
                      {d.status === 'pending_review' && d.workflow_stage === 'ready' && (
                        <Button variant="primary" style={{ height: 34, fontSize: 13 }}
                          onClick={() => navigate(`/issue/rent/${d.id}`)}>
                          Выдать →
                        </Button>
                      )}
                      {/* active: запрос возврата → возврат */}
                      {(d.status === 'active' || d.status === 'overdue') && !d.return_requested_at && (
                        <Button variant="primary" style={{ height: 34, fontSize: 13 }}
                          onClick={() => setConfirmReturnReq(d)}>
                          Запросить возврат
                        </Button>
                      )}
                      {(d.status === 'active' || d.status === 'overdue') && d.return_requested_at && (
                        <Button variant="primary" style={{ height: 34, fontSize: 13 }}
                          onClick={() => navigate(`/return/rent/${d.id}`)}>
                          Принять
                        </Button>
                      )}
                    </div>
                    <span style={{ color: 'var(--muted)', fontSize: 14, transition: 'transform 0.2s', transform: isOpen ? 'rotate(180deg)' : 'none' }}>▾</span>
                  </div>
                  {isOpen && (
                    <div style={{ borderTop: '1px solid var(--border)', padding: '12px 20px' }}>
                      {loadingUnits === d.id ? (
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
                              }} onClick={() => setCardId(uid)}>
                                {photos[0]?.url ? (
                                  <img src={photos[0].url} alt="" style={{ width: 44, height: 44, borderRadius: 6, objectFit: 'contain', flexShrink: 0 }} />
                                ) : (
                                  <div style={{ width: 44, height: 44, borderRadius: 6, background: 'var(--paper)', border: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                                    <Package size={18} color="var(--subtle)" strokeWidth={1.4} />
                                  </div>
                                )}
                                <div style={{ flex: 1 }}>
                                  <div style={{ fontWeight: 500, fontSize: 13 }}>{u.name}</div>
                                  <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 1 }}>
                                    {u.serial && `${u.serial} · `}{u.category ? categoryLabel(u.category) : ''}
                                  </div>
                                </div>
                                <Badge color={u.status === 'on_stock' ? 'green' : u.status === 'issued' ? 'amber' : 'muted'}>
                                  {u.status === 'on_stock' ? 'На складе' : u.status === 'issued' ? 'Выдано' : u.status}
                                </Badge>
                              </div>
                            )
                          })}
                          {d.requester_message && (
                            <div style={{
                              fontSize: 12, color: 'var(--muted)', marginTop: 4,
                              padding: '10px 12px', background: 'var(--card)',
                              borderLeft: '3px solid var(--gold-500)', borderRadius: 6, lineHeight: 1.5,
                            }}>
                              {d.requester_message}
                            </div>
                          )}
                          {d.price_total && (
                            <div style={{
                              fontSize: 14, fontWeight: 600, marginTop: 4,
                              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                              padding: '10px 12px', background: 'var(--card)', borderRadius: 6,
                            }}>
                              <span style={{ color: 'var(--muted)', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 600 }}>Сумма</span>
                              <span>{Number(d.price_total).toLocaleString('ru-RU')} ₽</span>
                            </div>
                          )}
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

      <ConfirmModal
        open={!!confirmReturnReq}
        title="Запросить возврат имущества"
        message="Партнёр получит уведомление и подтвердит готовность вернуть. Затем вы оформите возврат."
        confirmLabel="Запросить"
        cancelLabel="Отмена"
        onConfirm={doRequestReturn}
        onCancel={() => setConfirmReturnReq(null)}
      />
      {cardId && <UnitCardModal unitId={cardId} onClose={() => setCardId(null)} onChanged={loadDeals} />}
    </Layout>
  )
}

const CONDITIONS = [
  { value: 'excellent', label: 'Отлично', color: 'var(--green)' },
  { value: 'good', label: 'Хорошее', color: 'var(--blue)' },
  { value: 'damaged', label: 'Повреждено', color: 'var(--red)' },
]

const RETURN_STEPS = ['Детали сделки', 'Фото и состояние', 'Подпись арендатора', 'Штамп принимающего']

function RentReturnModal({ deal, onClose, onDone }) {
  const [step, setStep] = useState(0)
  const [units, setUnits] = useState([])
  const [conditions, setConditions] = useState({})
  const [damages, setDamages] = useState({})
  const [photos, setPhotos] = useState({})
  const [renterSignature, setRenterSignature] = useState(null)
  const [acceptorStamped, setAcceptorStamped] = useState(false)
  const [returnSuccess, setReturnSuccess] = useState(false)
  const [loading, setLoading] = useState(false)
  const [unitsLoading, setUnitsLoading] = useState(true)

  useEffect(() => {
    if (!deal.unit_ids?.length) { setUnitsLoading(false); return }
    unitsApi.list().then(d => {
      const ids = deal.unit_ids.map(String)
      const found = (d.units || []).filter(u => ids.includes(String(u.id)))
      setUnits(found.length ? found : deal.unit_ids.map(id => ({ id, name: `Единица #${String(id).slice(0, 8)}` })))
    }).catch(() => {
      setUnits(deal.unit_ids.map(id => ({ id, name: `Единица #${String(id).slice(0, 8)}` })))
    }).finally(() => setUnitsLoading(false))
  }, [deal])

  function setPhoto(unitId, idx, file) {
    setPhotos(p => {
      const arr = [...(p[unitId] || [null, null])]
      arr[idx] = file
      return { ...p, [unitId]: arr }
    })
  }

  async function handleReturn(acceptorSignature) {
    setLoading(true)
    try {
      const allNotes = Object.entries(damages)
        .filter(([, v]) => v)
        .map(([id, v]) => {
          const u = units.find(u => String(u.id) === String(id))
          return `${u?.name || id}: ${v}`
        })
        .join('; ')
      await rentApi.return(deal.id, { condition_notes: allNotes || undefined })
      setReturnSuccess(true)
      setTimeout(() => onDone(), 2000)
    } catch (err) {
      alert(err.message || 'Ошибка возврата')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 500, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}
      onClick={onClose}>
      <div style={{ background: 'var(--white)', borderRadius: 'var(--radius-card)', padding: 28, maxWidth: 600, width: '100%', maxHeight: '90vh', overflowY: 'auto' }}
        onClick={e => e.stopPropagation()}>

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
          <div style={{ fontWeight: 600, fontSize: 16 }}>Возврат от партнёров</div>
          <button onClick={onClose} style={{ border: 'none', background: 'none', cursor: 'pointer', color: 'var(--muted)', fontSize: 18 }}>✕</button>
        </div>

        {/* Step indicator */}
        <div style={{ display: 'flex', gap: 0, marginBottom: 24 }}>
          {RETURN_STEPS.map((s, i) => (
            <div key={s} style={{ flex: 1, display: 'flex', alignItems: 'center' }}>
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', flex: 1 }}>
                <div style={{
                  width: 26, height: 26, borderRadius: '50%', display: 'flex',
                  alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 600,
                  background: i < step ? 'var(--green)' : i === step ? 'var(--blue)' : 'var(--border)',
                  color: i <= step ? '#fff' : 'var(--muted)',
                }}>{i < step ? '✓' : i + 1}</div>
                <div style={{ fontSize: 10, color: i === step ? 'var(--blue)' : 'var(--muted)', marginTop: 3, fontWeight: i === step ? 600 : 400, textAlign: 'center' }}>{s}</div>
              </div>
              {i < RETURN_STEPS.length - 1 && <div style={{ height: 2, flex: 1, background: i < step ? 'var(--green)' : 'var(--border)', marginBottom: 16 }} />}
            </div>
          ))}
        </div>

        {/* Step 0 — deal details */}
        {step === 0 && (
          <div>
            <div style={{ background: 'var(--bg)', borderRadius: 10, padding: 16, marginBottom: 16 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                <span style={{ color: 'var(--muted)', fontSize: 13 }}>Контрагент</span>
                <span style={{ fontWeight: 500, fontSize: 13 }}>{deal.counterparty_name}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                <span style={{ color: 'var(--muted)', fontSize: 13 }}>Период</span>
                <span style={{ fontSize: 13 }}>{new Date(deal.period_start).toLocaleDateString('ru-RU')} — {new Date(deal.period_end).toLocaleDateString('ru-RU')}</span>
              </div>
              {deal.price_total && (
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: deal.deposit ? 8 : 0 }}>
                  <span style={{ color: 'var(--muted)', fontSize: 13 }}>Сумма</span>
                  <span style={{ fontWeight: 600, fontSize: 13 }}>{Number(deal.price_total).toLocaleString('ru-RU')} ₽</span>
                </div>
              )}
              {deal.deposit && (
                <div style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderTop: '1px solid var(--border)' }}>
                  <span style={{ color: 'var(--green)', fontSize: 13, fontWeight: 500 }}>Залог</span>
                  <span style={{ fontWeight: 600, fontSize: 13, color: 'var(--green)' }}>{Number(deal.deposit).toLocaleString('ru-RU')} ₽</span>
                </div>
              )}
            </div>
            <div style={{ fontWeight: 500, fontSize: 13, marginBottom: 8 }}>Единицы ({units.length})</div>
            {unitsLoading ? (
              <div style={{ color: 'var(--muted)', fontSize: 13 }}>Загрузка...</div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 16 }}>
                {units.map(u => (
                  <div key={u.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', border: '1px solid var(--border)', borderRadius: 8 }}>
                    <div style={{ width: 36, height: 36, borderRadius: 6, background: 'var(--bg)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16, flexShrink: 0, overflow: 'hidden' }}>
                      {u.photo_url ? <img src={u.photo_url} alt="" style={{ width: '100%', height: '100%', objectFit: 'contain' }} /> : '📦'}
                    </div>
                    <div>
                      <div style={{ fontWeight: 500, fontSize: 13 }}>{u.name}</div>
                      {u.serial && <div style={{ fontSize: 11, color: 'var(--muted)' }}>{u.serial}</div>}
                    </div>
                  </div>
                ))}
              </div>
            )}
            <Button fullWidth onClick={() => setStep(1)}>Далее — Фото и состояние</Button>
          </div>
        )}

        {/* Step 1 — photos + condition */}
        {step === 1 && (
          <div>
            <div style={{ fontWeight: 600, marginBottom: 4 }}>Фото и состояние при возврате</div>
            <div style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 16 }}>Зафиксируйте состояние каждой единицы</div>
            {units.map(u => (
              <div key={u.id} style={{ border: '1px solid var(--border)', borderRadius: 10, padding: 14, marginBottom: 14 }}>
                <div style={{ fontWeight: 500, fontSize: 13, marginBottom: 10 }}>{u.name}</div>
                <div style={{ marginBottom: 12 }}>
                  <MultiPhotoPicker files={Array.isArray(photos[u.id]) ? photos[u.id] : []} min={2}
                    onChange={files => setPhotos(p => ({ ...p, [u.id]: files }))} />
                </div>
                <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
                  {CONDITIONS.map(c => (
                    <button key={c.value} onClick={() => setConditions(p => ({ ...p, [u.id]: c.value }))} style={{
                      flex: 1, height: 34, borderRadius: 'var(--radius-btn)',
                      border: `2px solid ${conditions[u.id] === c.value ? c.color : 'var(--border)'}`,
                      background: conditions[u.id] === c.value ? c.color + '15' : 'var(--white)',
                      color: conditions[u.id] === c.value ? c.color : 'var(--muted)',
                      fontSize: 12, fontWeight: 500, cursor: 'pointer',
                    }}>{c.label}</button>
                  ))}
                </div>
                {conditions[u.id] === 'damaged' && (
                  <textarea placeholder="Опишите повреждение..." value={damages[u.id] || ''}
                    onChange={e => setDamages(p => ({ ...p, [u.id]: e.target.value }))}
                    style={{ width: '100%', minHeight: 60, padding: '8px 10px', border: '1px solid var(--red)', borderRadius: 'var(--radius-btn)', fontSize: 12, resize: 'vertical', outline: 'none' }} />
                )}
              </div>
            ))}
            <div style={{ display: 'flex', gap: 8 }}>
              <Button variant="secondary" onClick={() => setStep(0)}>Назад</Button>
              <Button fullWidth onClick={() => setStep(2)}>Далее — Подпись</Button>
            </div>
          </div>
        )}

        {/* Step 2 — renter signature */}
        {step === 2 && (
          <div>
            <div style={{ fontWeight: 600, marginBottom: 4 }}>Подпись арендатора</div>
            <div style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 16 }}>{deal.counterparty_name}</div>
            <SignatureCanvas onSave={data => { setRenterSignature(data); setStep(3) }} />
            <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 10, textAlign: 'center' }}>Подпись лица, возвращающего имущество</div>
            <Button variant="secondary" fullWidth style={{ marginTop: 12 }} onClick={() => setStep(1)}>Назад</Button>
          </div>
        )}

        {/* Step 3 — acceptor stamp */}
        {step === 3 && !returnSuccess && (
          <div>
            <div style={{ fontWeight: 600, marginBottom: 4 }}>Подпись принимающего</div>
            <div style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 16 }}>Нажмите на поле чтобы поставить штамп сотрудника склада</div>
            <div onClick={() => setAcceptorStamped(true)} style={{
              width: '100%', height: 100, border: '2px dashed var(--border)',
              borderRadius: 'var(--radius-card)', display: 'flex', alignItems: 'center',
              justifyContent: 'center', cursor: 'pointer', marginBottom: 16,
              background: acceptorStamped ? 'var(--accent-dim)' : 'var(--bg)',
              borderColor: acceptorStamped ? 'var(--accent)' : 'var(--border)',
            }}>
              {acceptorStamped ? (
                <div style={{ textAlign: 'center' }}>
                  <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--accent)' }}>Штамп / Подпись</div>
                  <div style={{ fontSize: 12, color: 'var(--accent)', marginTop: 4 }}>Сотрудник склада</div>
                </div>
              ) : (
                <div style={{ color: 'var(--muted)', fontSize: 13 }}>Нажмите для подтверждения</div>
              )}
            </div>
            <Button fullWidth disabled={!acceptorStamped || loading} onClick={() => handleReturn('stamp')}>
              {loading ? 'Оформление...' : 'Оформить возврат'}
            </Button>
            <Button variant="secondary" fullWidth style={{ marginTop: 8 }} onClick={() => setStep(2)}>Назад</Button>
          </div>
        )}

        {returnSuccess && (
          <div style={{ textAlign: 'center', padding: '40px 0' }}>
            <div style={{ fontSize: 40, marginBottom: 12 }}>✅</div>
            <div style={{ fontWeight: 600, fontSize: 18, marginBottom: 6, color: 'var(--green)' }}>Успешно</div>
            <div style={{ fontSize: 13, color: 'var(--muted)' }}>Возврат оформлен, подписан обеими сторонами</div>
          </div>
        )}
      </div>
    </div>
  )
}

function ReviewModal({ deal, onClose, onDone }) {
  const isCompany = deal.counterparty_type === 'company'
  const [form, setForm] = useState({
    period_start: deal.period_start ? deal.period_start.slice(0, 10) : '',
    period_end: deal.period_end ? deal.period_end.slice(0, 10) : '',
    price_total: deal.price_total || '',
    deposit: deal.deposit || '',
    counterparty_email: deal.counterparty_email || '',
    counterparty_type: deal.counterparty_type || 'person',
    inn: deal.inn || '', legal_address: deal.legal_address || '',
    extra_contact: deal.extra_contact || '',
  })
  const [units, setUnits] = useState([])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!deal.unit_ids?.length) return
    unitsApi.list().then(d => {
      const ids = deal.unit_ids.map(String)
      setUnits((d.units || []).filter(u => ids.includes(String(u.id))))
    }).catch(() => {})
  }, [deal])

  async function handleApprove() {
    if (!form.period_start || !form.period_end) { setError('Укажите даты аренды'); return }
    setSaving(true)
    setError('')
    try {
      await rentApi.review(deal.id, {
        period_start: form.period_start,
        period_end: form.period_end,
        price_total: form.price_total ? Number(form.price_total) : null,
        deposit: form.deposit ? Number(form.deposit) : null,
        counterparty_email: form.counterparty_email || null,
        counterparty_type: form.counterparty_type,
        inn: form.inn || null,
        legal_address: form.legal_address || null,
        extra_contact: form.extra_contact || null,
      })
      onDone()
    } catch (err) {
      setError(err.message || 'Ошибка обработки')
    } finally {
      setSaving(false)
    }
  }

  async function handleReject() {
    setSaving(true)
    try {
      await rentApi.status(deal.id, 'cancelled')
      onDone()
    } catch (err) {
      setError(err.message || 'Ошибка отклонения')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 400, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}
      onClick={onClose}>
      <div style={{ background: 'var(--white)', borderRadius: 'var(--radius-card)', padding: 24, maxWidth: 520, width: '100%', maxHeight: '90vh', overflowY: 'auto' }}
        onClick={e => e.stopPropagation()}>

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
          <div style={{ fontWeight: 600, fontSize: 16 }}>Выдача имущества</div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--muted)' }}>✕</button>
        </div>

        {/* Requester info */}
        <div style={{ background: 'var(--bg)', borderRadius: 'var(--radius-btn)', padding: '14px 16px', marginBottom: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
            <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--text)' }}>Заявитель</div>
            <Badge color={isCompany ? 'blue' : 'muted'}>{isCompany ? 'Компания' : 'Физлицо'}</Badge>
          </div>
          <div style={{ fontSize: 13 }}>{deal.requester_name || deal.counterparty_name}</div>
          <div style={{ fontSize: 12, color: 'var(--muted)' }}>{deal.requester_phone || deal.counterparty_contact}</div>
          {deal.counterparty_email && <div style={{ fontSize: 12, color: 'var(--muted)' }}>{deal.counterparty_email}</div>}
          {deal.requester_project && <div style={{ fontSize: 12, color: 'var(--muted)' }}>Проект: {deal.requester_project}</div>}
          {isCompany && deal.inn && <div style={{ fontSize: 12, color: 'var(--muted)' }}>ИНН: {deal.inn}</div>}
          {isCompany && deal.legal_address && <div style={{ fontSize: 12, color: 'var(--muted)' }}>Адрес: {deal.legal_address}</div>}
          {deal.requester_message && <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 4, fontStyle: 'italic' }}>{deal.requester_message}</div>}
        </div>

        {/* Units */}
        <div style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 13, fontWeight: 500, marginBottom: 8 }}>Запрошенные единицы ({(deal.unit_ids || []).length})</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {units.map(u => (
              <div key={u.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px', border: '1px solid var(--border)', borderRadius: 6, fontSize: 13 }}>
                {u.photos?.[0] && <img src={u.photos[0].url || u.photos[0]} alt="" style={{ width: 32, height: 32, objectFit: 'cover', borderRadius: 4 }} />}
                <div style={{ flex: 1, fontWeight: 500 }}>{u.name}</div>
                <div style={{ fontSize: 11, color: 'var(--muted)' }}>{categoryLabel(u.category)}</div>
              </div>
            ))}
            {units.length === 0 && <div style={{ fontSize: 12, color: 'var(--muted)' }}>{(deal.unit_ids || []).length} единиц</div>}
          </div>
        </div>

        {/* Form */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 0 }}>
          <Input label="Начало аренды *" type="date" value={form.period_start} onChange={e => setForm(f => ({ ...f, period_start: e.target.value }))} />
          <Input label="Конец аренды *" type="date" value={form.period_end} onChange={e => setForm(f => ({ ...f, period_end: e.target.value }))} />
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 0 }}>
          <Input label="Цена (руб)" type="number" value={form.price_total} onChange={e => setForm(f => ({ ...f, price_total: e.target.value }))} placeholder="0" />
          <Input label="Залог (руб)" type="number" value={form.deposit} onChange={e => setForm(f => ({ ...f, deposit: e.target.value }))} placeholder="0" />
        </div>
        <Input label="Email контрагента" type="email" value={form.counterparty_email} onChange={e => setForm(f => ({ ...f, counterparty_email: e.target.value }))} placeholder="email@example.com" />

        {error && <div style={{ color: 'var(--red)', fontSize: 13, marginBottom: 12 }}>{error}</div>}

        <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
          <Button variant="danger" fullWidth onClick={handleReject} loading={saving}>Отменить</Button>
          <Button fullWidth onClick={handleApprove} loading={saving}>Выдать</Button>
        </div>
      </div>
    </div>
  )
}

function NewDeal({ onDone }) {
  const [dealType, setDealType] = useState('out')
  const [cpType, setCpType] = useState('person')
  const [form, setForm] = useState({ name: '', contact: '', email: '' })
  const [availableUnits, setAvailableUnits] = useState([])
  const [selectedUnits, setSelectedUnits] = useState([])
  const [prices, setPrices] = useState({})
  const [dateStart, setDateStart] = useState('')
  const [dateEnd, setDateEnd] = useState('')
  const [step, setStep] = useState(1)
  const [loading, setLoading] = useState(false)
  const [signLink, setSignLink] = useState('')
  const [copied, setCopied] = useState(false)
  const [warehouseList, setWarehouseList] = useState([])
  const [whFilter, setWhFilter] = useState('')
  const [unitSearch, setUnitSearch] = useState('')
  const [unitCat, setUnitCat] = useState('all')
  const [dealPhotos, setDealPhotos] = useState([])
  const [renterSig, setRenterSig] = useState(null)
  const [issuerStamped, setIssuerStamped] = useState(false)
  const [showDeposit, setShowDeposit] = useState(false)
  const [depositAmount, setDepositAmount] = useState('')

  useEffect(() => {
    unitsApi.list({ status: 'on_stock' }).then(data => setAvailableUnits(data.units || []))
    warehousesApi.list().then(d => setWarehouseList(d.warehouses || []))
  }, [])

  function setDealPhoto(i, file) {
    setDealPhotos(p => { const a = [...p]; a[i] = file; return a })
  }

  const filteredUnits = availableUnits.filter(u => {
    const matchWh = !whFilter || String(u.warehouse_id) === whFilter
    const matchSearch = !unitSearch || u.name.toLowerCase().includes(unitSearch.toLowerCase()) || (u.serial || '').toLowerCase().includes(unitSearch.toLowerCase())
    const matchCat = unitCat === 'all' || u.category === unitCat
    return matchWh && matchSearch && matchCat
  })

  function set(f) { return e => setForm(p => ({ ...p, [f]: e.target.value })) }

  function toggleUnit(id) {
    setSelectedUnits(s => s.includes(id) ? s.filter(x => x !== id) : [...s, id])
  }

  const days = dateStart && dateEnd ? Math.max(1, Math.ceil((new Date(dateEnd) - new Date(dateStart)) / 86400000)) : 0

  function calcTotal() {
    return selectedUnits.reduce((sum, id) => sum + (Number(prices[id]) || 0) * days, 0)
  }

  async function handleSign(signatureData) {
    setLoading(true)
    try {
      const data = await rentApi.create({
        type: dealType,
        counterparty_name: form.name,
        counterparty_type: cpType,
        counterparty_contact: form.contact,
        counterparty_email: form.email,
        inn: form.inn,
        legal_address: form.legal_address,
        extra_contact: form.extra_contact,
        unit_ids: selectedUnits,
        period_start: dateStart,
        period_end: dateEnd,
        price_total: calcTotal() || null,
        deposit: depositAmount || null,
        signature_data: signatureData,
      })
      const dealId = data.deal?.id
      if (dealId) {
        const firstUnitId = selectedUnits[0]
        if (firstUnitId) {
          for (const file of dealPhotos) {
            if (file) {
              const fd = new FormData()
              fd.append('photos', file)
              unitsApi.uploadPhoto(firstUnitId, fd).catch(() => {})
            }
          }
        }
      }
      setStep(6)
    } catch (err) {
      alert(err.message || 'Ошибка создания сделки')
    } finally {
      setLoading(false)
    }
  }

  function copyLink() {
    navigator.clipboard.writeText(signLink).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

  return (
    <div style={{ maxWidth: 560 }}>

      {step === 1 && (
        <div>
          <div style={{ fontWeight: 600, marginBottom: 14 }}>Данные контрагента</div>
          <div style={{ display: 'flex', gap: 6, marginBottom: 16 }}>
            {[['person', 'Физлицо'], ['company', 'Компания']].map(([key, label]) => (
              <button key={key} onClick={() => setCpType(key)} style={{
                padding: '6px 14px', borderRadius: 'var(--radius-badge)',
                border: `1px solid ${cpType === key ? 'var(--blue)' : 'var(--border)'}`,
                background: cpType === key ? 'var(--blue-dim)' : 'var(--white)',
                color: cpType === key ? 'var(--blue)' : 'var(--muted)',
                fontSize: 13, cursor: 'pointer',
              }}>{label}</button>
            ))}
          </div>
          <Input label={cpType === 'person' ? 'ФИО' : 'Название компании'} placeholder={cpType === 'person' ? 'Иванов Иван Иванович' : 'ООО «Реквизит+»'} value={form.name} onChange={set('name')} />
          {cpType === 'company' && (
            <>
              <Input label="ИНН" placeholder="1234567890" value={form.inn || ''} onChange={set('inn')} />
              <Input label="Юридический адрес" placeholder="г. Москва, ул. Примерная, д. 1" value={form.legal_address || ''} onChange={set('legal_address')} />
            </>
          )}
          <Input label="Контакт (телефон)" placeholder="+7 900 000 00 00" value={form.contact} onChange={set('contact')} />
          <Input label="Email" type="email" placeholder="client@example.com" value={form.email} onChange={set('email')} />
          <Input label="Дополнительный контакт" placeholder="Имя, телефон или email" value={form.extra_contact || ''} onChange={set('extra_contact')} />
          <Button fullWidth disabled={!form.name} onClick={() => setStep(2)} style={{ marginTop: 8 }}>
            Далее — Единицы
          </Button>
        </div>
      )}

      {step === 2 && (
        <div>
          <div style={{ fontWeight: 600, marginBottom: 14 }}>Единицы и период</div>

          {/* Search */}
          <div style={{ position: 'relative', marginBottom: 14 }}>
            <span style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--muted)', fontSize: 14 }}>🔍</span>
            <input value={unitSearch} onChange={e => setUnitSearch(e.target.value)}
              placeholder="Найдите по названию или серийному №..."
              style={{ width: '100%', height: 38, padding: '0 10px 0 32px', border: '1px solid var(--border)', borderRadius: 'var(--radius-btn)', fontSize: 13, outline: 'none', boxSizing: 'border-box' }} />
          </div>

          {/* Selected units bar */}
          {selectedUnits.length > 0 && (
            <div style={{ padding: '8px 12px', marginBottom: 12, borderRadius: 8, background: 'var(--blue-dim)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--blue)' }}>Выбрано: {selectedUnits.length} ед.</span>
              <button onClick={() => setSelectedUnits([])} style={{ fontSize: 12, color: 'var(--muted)', background: 'none', border: 'none', cursor: 'pointer' }}>Очистить</button>
            </div>
          )}

          {/* Units list — only show search results or selected */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 360, overflowY: 'auto', marginBottom: 14 }}>
            {(unitSearch ? filteredUnits : availableUnits.filter(u => selectedUnits.includes(u.id))).map(u => {
              const isSel = selectedUnits.includes(u.id)
              return (
                <div key={u.id} style={{
                  background: 'var(--white)', borderRadius: 'var(--radius-card)',
                  border: `1px solid ${isSel ? 'var(--blue)' : 'var(--border)'}`, overflow: 'hidden',
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 14px', cursor: 'pointer' }}
                    onClick={() => toggleUnit(u.id)}>
                    <div style={{
                      width: 44, height: 44, borderRadius: 6, flexShrink: 0,
                      background: 'var(--bg)', border: '1px solid var(--border)',
                      display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18, overflow: 'hidden',
                    }}>
                      {u.photo_url
                        ? <img src={u.photo_url} alt="" style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
                        : '📦'}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 500, fontSize: 13 }}>{u.name}</div>
                      <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 1 }}>
                        {u.serial && `${u.serial} · `}{categoryLabel(u.category)}
                      </div>
                    </div>
                    <div style={{
                      width: 22, height: 22, borderRadius: 4, flexShrink: 0,
                      border: `2px solid ${isSel ? 'var(--blue)' : 'var(--border)'}`,
                      background: isSel ? 'var(--blue)' : 'transparent',
                      display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: 12,
                    }}>{isSel ? '✓' : ''}</div>
                  </div>
                  {isSel && (
                    <div style={{ padding: '6px 14px 10px', display: 'flex', alignItems: 'center', gap: 8, borderTop: '1px solid var(--border)', background: 'var(--bg)' }}>
                      <input type="number" placeholder="Цена/сутки ₽" min="0"
                        value={prices[u.id] || ''}
                        onChange={e => setPrices(p => ({ ...p, [u.id]: e.target.value }))}
                        onClick={e => e.stopPropagation()}
                        style={{ width: 140, height: 32, padding: '0 10px', border: '1px solid var(--border)', borderRadius: 'var(--radius-btn)', fontSize: 12, outline: 'none' }}
                      />
                      <span style={{ fontSize: 11, color: 'var(--muted)' }}>₽ / сутки</span>
                    </div>
                  )}
                </div>
              )
            })}
            {unitSearch && filteredUnits.length === 0 && (
              <div style={{ textAlign: 'center', padding: '30px 0', color: 'var(--muted)', fontSize: 13 }}>Ничего не найдено</div>
            )}
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div>
              <div style={{ fontSize: 13, fontWeight: 500, marginBottom: 6 }}>Дата выдачи</div>
              <input type="date" value={dateStart} onChange={e => setDateStart(e.target.value)}
                style={{ width: '100%', height: 40, padding: '0 10px', border: '1px solid var(--border)', borderRadius: 'var(--radius-btn)', fontSize: 13, outline: 'none', boxSizing: 'border-box' }} />
            </div>
            <div>
              <div style={{ fontSize: 13, fontWeight: 500, marginBottom: 6 }}>Плановый возврат</div>
              <input type="date" value={dateEnd} onChange={e => setDateEnd(e.target.value)}
                style={{ width: '100%', height: 40, padding: '0 10px', border: '1px solid var(--border)', borderRadius: 'var(--radius-btn)', fontSize: 13, outline: 'none', boxSizing: 'border-box' }} />
            </div>
          </div>

          {days > 0 && selectedUnits.length > 0 && (
            <div style={{ marginTop: 12, padding: '14px 16px', borderRadius: 8, background: 'var(--green-dim)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: 13, color: 'var(--muted)' }}>{days} дн. · {selectedUnits.length} ед.</span>
              <span style={{ fontWeight: 700, color: 'var(--green)', fontSize: 16 }}>{calcTotal().toLocaleString('ru-RU')} ₽</span>
            </div>
          )}

          {/* Deposit */}
          <div style={{ marginTop: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
            <button onClick={() => setShowDeposit(v => !v)} style={{
              padding: '8px 14px', borderRadius: 'var(--radius-btn)', fontSize: 13, fontWeight: 500, cursor: 'pointer',
              border: '1px solid var(--border)', background: showDeposit ? 'var(--green-dim)' : 'var(--white)', color: showDeposit ? 'var(--green)' : 'var(--text)',
            }}>
              {showDeposit ? '✓ Залог' : '+ Залог'}
            </button>
            {showDeposit && (
              <input type="number" placeholder="Сумма залога ₽" value={depositAmount}
                onChange={e => setDepositAmount(e.target.value)}
                style={{ flex: 1, height: 38, padding: '0 10px', border: '2px solid var(--green)', borderRadius: 'var(--radius-btn)', fontSize: 13, outline: 'none', background: 'var(--green-dim)', boxSizing: 'border-box' }} />
            )}
          </div>

          <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
            <Button variant="secondary" onClick={() => setStep(1)}>Назад</Button>
            <Button fullWidth disabled={selectedUnits.length === 0 || !dateStart || !dateEnd || calcTotal() === 0} onClick={() => setStep(3)}>
              Далее — Фото
            </Button>
          </div>
        </div>
      )}

      {step === 3 && (
        <div>
          <div style={{ fontWeight: 600, marginBottom: 4 }}>Фото к сделке</div>
          <div style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 20 }}>Минимум 2 фото — состояние имущества при передаче</div>
          <div style={{ marginBottom: 20 }}>
            <MultiPhotoPicker files={dealPhotos} min={2} onChange={setDealPhotos} />
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <Button variant="secondary" onClick={() => setStep(2)}>Назад</Button>
            <Button fullWidth disabled={dealPhotos.length < 2} onClick={() => setStep(4)}>Далее — Подпись</Button>
          </div>
        </div>
      )}

      {step === 4 && (
        <div>
          <div style={{ fontWeight: 600, marginBottom: 4 }}>Подпись арендатора</div>
          <div style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 16 }}>{form.name}</div>
          <SignatureCanvas onSave={data => { setRenterSig(data); setStep(5) }} />
          <Button variant="secondary" fullWidth style={{ marginTop: 12 }} onClick={() => setStep(3)}>Назад</Button>
        </div>
      )}

      {step === 5 && (
        <div>
          <div style={{ fontWeight: 600, marginBottom: 4 }}>Подпись выдавшего</div>
          <div style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 16 }}>Нажмите на поле чтобы поставить штамп сотрудника склада</div>
          <div onClick={() => setIssuerStamped(true)} style={{
            width: '100%', height: 100, border: '2px dashed var(--border)',
            borderRadius: 'var(--radius-card)', display: 'flex', alignItems: 'center',
            justifyContent: 'center', cursor: 'pointer', marginBottom: 16,
            background: issuerStamped ? 'var(--accent-dim)' : 'var(--bg)',
            borderColor: issuerStamped ? 'var(--accent)' : 'var(--border)',
          }}>
            {issuerStamped ? (
              <div style={{ textAlign: 'center' }}>
                <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--accent)' }}>Штамп / Подпись</div>
                <div style={{ fontSize: 12, color: 'var(--accent)', marginTop: 4 }}>Сотрудник склада</div>
              </div>
            ) : (
              <div style={{ color: 'var(--muted)', fontSize: 13 }}>Нажмите для подтверждения</div>
            )}
          </div>
          <Button fullWidth disabled={!issuerStamped || loading} onClick={() => handleSign(renterSig)}>
            {loading ? 'Создание сделки...' : 'Оформить сделку'}
          </Button>
          <Button variant="secondary" fullWidth style={{ marginTop: 8 }} onClick={() => setStep(4)}>Назад</Button>
        </div>
      )}

      {step === 6 && (
        <div style={{ textAlign: 'center', padding: '40px 0' }}>
          <div style={{ fontSize: 40, marginBottom: 12 }}>✅</div>
          <div style={{ fontWeight: 600, fontSize: 18, marginBottom: 6, color: 'var(--green)' }}>Успешно</div>
          <div style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 24 }}>Договор аренды подписан обеими сторонами и сформирован</div>
          <Button fullWidth onClick={onDone}>К списку сделок</Button>
        </div>
      )}
    </div>
  )
}

function StatCard({ icon: Icon, label, value, accent = 'gold' }) {
  const palette = {
    gold:  { bg: 'var(--gold-100)', fg: 'var(--gold-600)' },
    green: { bg: 'var(--green-dim)', fg: 'var(--green)' },
    red:   { bg: 'var(--red-dim)',   fg: 'var(--red)' },
  }[accent]
  return (
    <div style={{
      background: 'var(--card)',
      border: '1px solid var(--border)',
      borderRadius: 'var(--radius-card)',
      padding: '16px 18px',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
        <div style={{ fontSize: 12, color: 'var(--muted)', fontWeight: 500 }}>{label}</div>
        <div style={{
          width: 28, height: 28, borderRadius: 8,
          background: palette.bg, color: palette.fg,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          {Icon && <Icon size={15} strokeWidth={1.8} />}
        </div>
      </div>
      <div style={{
        fontSize: 24, fontWeight: 600,
        color: 'var(--text)', letterSpacing: '-0.03em', lineHeight: 1.1,
      }}>{value}</div>
    </div>
  )
}
