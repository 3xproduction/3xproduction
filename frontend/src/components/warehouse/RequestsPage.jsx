import { useState, useEffect } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { ClipboardList, Package, Clapperboard, SlidersHorizontal, ChevronLeft, Pencil } from 'lucide-react'
import WarehouseLayout from './WarehouseLayout'
import Badge from '../shared/Badge'
import Button from '../shared/Button'
import ConfirmModal from '../shared/ConfirmModal'
import UnitCardModal from '../shared/UnitCardModal'
import EditRequestItemsModal from './EditRequestItemsModal'
import { useToast } from '../shared/Toast'
import { requests as requestsApi, units as unitsApi, issuances as issuancesApi, projectUnits as projectUnitsApi, rent as rentApi } from '../../services/api'

// Статусы заявки, в которых ещё разрешено редактировать состав. Backend
// дублирует эту проверку (см. requests.js EDITABLE_REQUEST_STATUSES).
const EDITABLE_STATUSES = new Set(['new', 'collecting', 'ready'])

const css = `
.req-page { padding: 28px 32px; max-width: 900px; }
/* Embed: вкладка внутри IssuedByProjectsPage. Своя шапка/паддинги/max-width
   уже заданы родителем (.iss-page) — снимаем их. */
.req-page-embed { padding: 0 !important; max-width: none !important; }
.req-page-embed .req-list { margin-top: 0; }
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

/* Sticky-шапка + кнопка фильтра (видна на мобилке).
   top = page-sticky-top: над ним SectionTabs (Заявки/Акты), под ним эта шапка. */
.req-sticky {
  position: sticky; top: var(--page-sticky-top, 52px); z-index: 12;
  background: var(--paper);
}
@media (max-width: 768px) {
  .req-sticky {
    /* -1px: см. WarehouseLayout — sticky опускается на 1px выше, чтобы
       перекрыться с расширенным mtop и SectionTabs. */
    top: calc(var(--page-sticky-top, 52px) - 1px) !important;
    box-shadow: 0 1px 0 var(--border);
  }
}
.req-header-row {
  display: flex; align-items: center; gap: 10px;
}
.req-back-btn {
  background: none; border: none; cursor: pointer;
  width: 32px; height: 32px; border-radius: 8px;
  display: none; align-items: center; justify-content: center;
  color: var(--muted);
  flex-shrink: 0;
}
.req-back-btn:hover { color: var(--text); background: var(--bg-secondary); }
.req-filter-btn {
  margin-left: auto;
  display: none; align-items: center; gap: 6px;
  height: 34px; padding: 0 12px;
  background: var(--card); border: 1px solid var(--border);
  border-radius: 10px;
  font-size: 13px; font-weight: 500;
  color: var(--text);
  cursor: pointer;
  font-family: inherit;
  flex-shrink: 0;
}
.req-filter-btn-dot {
  width: 6px; height: 6px; border-radius: 50%;
  background: var(--gold-500);
}

/* Bottom-sheet с фильтрами на мобилке */
.req-sheet-overlay {
  position: fixed; inset: 0; z-index: 300;
  background: rgba(0,0,0,0.5);
  backdrop-filter: blur(2px);
  display: flex; align-items: flex-end;
}
.req-sheet {
  background: #fff;
  width: 100%;
  border-radius: 18px 18px 0 0;
  padding: 8px 16px max(20px, env(safe-area-inset-bottom));
}
.req-sheet-handle {
  width: 36px; height: 4px; border-radius: 4px;
  background: var(--border-strong);
  margin: 8px auto 14px;
}
.req-sheet-title {
  font-size: 11px; font-weight: 600;
  letter-spacing: 0.08em; text-transform: uppercase;
  color: var(--muted);
  padding: 0 4px 8px;
}
.req-sheet-item {
  display: flex; align-items: center; gap: 10px;
  width: 100%;
  padding: 14px 4px;
  border: none; border-bottom: 1px solid var(--border);
  background: none; text-align: left;
  font-size: 15px; font-weight: 450;
  color: var(--text);
  font-family: inherit;
  cursor: pointer;
}
.req-sheet-item:last-of-type { border-bottom: none; }
.req-sheet-item.active { color: var(--gold-600); font-weight: 600; }

@media (max-width: 768px) {
  /* overflow-x: hidden ломает sticky внутренних элементов в Chromium —
     убрали, горизонтальный wrap уже под контролем word-break. */
  .req-page { padding: 16px; }
  .req-page-embed { padding: 0 !important; }
  .req-title { font-size: 18px; }
  .req-sticky {
    margin: -16px -16px 14px;
    padding: 12px 16px;
  }
  .req-back-btn { display: inline-flex; }
  .req-filter-btn { display: inline-flex; }
  /* Pills-фильтр на мобилке прячем — переезжает в bottom-sheet через кнопку. */
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
  { value: 'issued',     label: 'Выданы' },
  // «Возвращают» — отдельная вкладка, ниже рендерится список warehouse_return_requests
  // со склада проекта + issuances с return_requested_at (запрошен, но не закрыт).
  { value: 'returning',  label: 'Возвращают' },
  // «Вернули» — заявки с завершённым возвратом (returns.returned_at).
  { value: 'returned',   label: 'Вернули' },
]

function formatDate(str) {
  if (!str) return '—'
  return new Date(str).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', year: 'numeric' })
}

// Нормализует rent_deal (публичную заявку) в единый формат с проектной заявкой
// для общего рендера. _isPublic + _stage — маркёры публички.
function normalizePublicDeal(d) {
  return {
    id: d.id,
    _isPublic: true,
    _stage: d.workflow_stage || null, // null | 'collecting' | 'ready'
    status: 'new', // для единообразия отображения в фильтрах «Все»/«Новые»
    unit_ids: d.unit_ids || [],
    requester_name: d.requester_name || d.counterparty_contact || '',
    requester_email: d.counterparty_email || null,
    project_name: d.counterparty_name || 'Партнёрская заявка',
    deadline: d.period_end || null,
    created_at: d.created_at,
    notes: d.requester_message || null,
    return_requested_at: null,
    returned_at: null,
    issuance_id: null,
    _rawDeal: d, // пригодится при открытии ReviewModal
  }
}

// Активная публичная аренда (после выдачи) — нормализуем в issued-строку.
// _stage намеренно НЕ null — иначе срабатывает ветка «Принять/Отменить»
// (баг был: для issued-аренды показывались все три кнопки).
function normalizeActiveRent(d) {
  return {
    id: d.id,
    _isPublic: true,
    _stage: 'issued', // маркер для ветки «Запросить возврат» / «Готовы вернуть»
    status: 'issued',
    unit_ids: d.unit_ids || [],
    requester_name: d.requester_name || d.counterparty_contact || '',
    requester_email: d.counterparty_email || null,
    project_name: d.counterparty_name || 'Партнёрская заявка',
    deadline: d.period_end || null,
    created_at: d.created_at,
    notes: null,
    return_requested_at: d.return_requested_at || null,
    returned_at: null,
    issuance_id: null,
  }
}

export default function RequestsPage({ embed = false, initialFilter }) {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  // В embed-режиме (когда страница встроена внутрь IssuedByProjectsPage как
  // подвкладка) фильтр приходит из родителя через prop. Иначе — из ?status=.
  const initialStatus = embed
    ? (initialFilter ?? '')
    : (searchParams.get('status') || '')
  const validInitial = FILTERS.some(f => f.value === initialStatus) ? initialStatus : ''
  const [filter, setFilter] = useState(validInitial)
  // Синхронизация при смене initialFilter из родителя (переключение
  // подвкладок Все/Новые/Возвращают/Вернули внутри «Выдачи»).
  useEffect(() => {
    if (embed && FILTERS.some(f => f.value === (initialFilter ?? ''))) {
      setFilter(initialFilter ?? '')
    }
  }, [embed, initialFilter])
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [updating, setUpdating] = useState(null)
  const [confirmReturnReq, setConfirmReturnReq] = useState(null)
  // Открытая карточка единицы (новый UnitCardModal — вместо навигации на /units/:id).
  const [cardUnitId, setCardUnitId] = useState(null)
  // Списки для вкладки «Возвращают»
  const [projectReturns, setProjectReturns] = useState([])
  // Публичные заявки (rent_deals в pending_review) — смешиваются с проектными
  // в едином списке и проходят те же статусы (через workflow_stage).
  const [publicReqs, setPublicReqs] = useState([])
  // Активные публичные аренды (status='active') — отображаются в «Выданы».
  const [activeRents, setActiveRents] = useState([])
  const toast = useToast()

  async function reloadProjectReturns() {
    try {
      const d = await projectUnitsApi.listReturnRequests('outgoing', 'pending')
      setProjectReturns(d.requests || [])
    } catch { setProjectReturns([]) }
  }
  async function reloadPublicReqs() {
    try {
      const d = await rentApi.list({ status: 'pending_review' })
      setPublicReqs(d.deals || [])
    } catch { setPublicReqs([]) }
  }
  async function reloadActiveRents() {
    try {
      const d = await rentApi.list({ status: 'active', type: 'out' })
      setActiveRents(d.deals || [])
    } catch { setActiveRents([]) }
  }
  async function confirmProjectReturn(r) {
    try {
      await projectUnitsApi.confirmReturn(r.id)
      toast?.('Возврат подтверждён — единица на основном складе', 'success')
      reloadProjectReturns()
    } catch (e) { toast?.(e.message || 'Ошибка', 'error') }
  }

  async function doRequestReturn() {
    const r = confirmReturnReq
    if (!r) return
    try {
      if (r._isPublic) {
        await rentApi.requestReturn(r.id)
        setActiveRents(prev => prev.map(x =>
          x.id === r.id ? { ...x, return_requested_at: new Date().toISOString() } : x
        ))
      } else {
        await issuancesApi.requestReturn(r.issuance_id)
        setItems(prev => prev.map(x =>
          x.id === r.id ? { ...x, return_requested_at: new Date().toISOString() } : x
        ))
      }
      toast?.('Возврат запрошен — получатель получил уведомление', 'success')
    } catch (err) {
      toast?.(err.message || 'Ошибка', 'error')
    }
    setConfirmReturnReq(null)
  }
  const [expanded, setExpanded] = useState(null)
  const [unitCache, setUnitCache] = useState({})
  const [loadingUnits, setLoadingUnits] = useState(null)
  // Заявка, состав которой сейчас редактируется в EditRequestItemsModal.
  // Хранит сам объект request — нужен initialUnits для предзаполнения.
  const [editingRequest, setEditingRequest] = useState(null)

  function load(status) {
    setLoading(true)
    // «Возвращают» и «Вернули» — клиентский фильтр, поэтому грузим все.
    const params = status && status !== 'returning' && status !== 'returned' ? { status } : {}
    requestsApi.list(params)
      .then(data => setItems(data.requests || []))
      .catch(() => {})
      .finally(() => setLoading(false))
  }

  // Публичные заявки нормализуются и мёржатся в общий список.
  // Один-в-один с проектными:
  //   • «Все» — pending_review + все active (и ожидающие возврата тоже).
  //   • «Новые» — только pending_review.
  //   • «Выданы» — active без return_requested_at.
  //   • «Возвращают» — active с return_requested_at (партнёр уже нажал «Запросить возврат»).
  const publicItems = (() => {
    if (filter === '' || filter === 'new') {
      const out = publicReqs.map(normalizePublicDeal)
      if (filter === '') {
        return [...out, ...activeRents.map(normalizeActiveRent)]
      }
      return out
    }
    if (filter === 'issued') {
      return activeRents.filter(d => !d.return_requested_at).map(normalizeActiveRent)
    }
    if (filter === 'returning') {
      return activeRents.filter(d => d.return_requested_at).map(normalizeActiveRent)
    }
    return []
  })()

  // Заявку, которую уже приняли назад (есть returned_at) — не показываем ни
  // в «Все», ни в «Выданы», ни в «Возвращают». Она живёт только в «Вернули».
  const displayedItems = (() => {
    if (filter === 'returning') {
      return items.filter(r => r.return_requested_at && !r.returned_at && r.status === 'issued')
    }
    if (filter === 'returned') {
      return items.filter(r => r.returned_at)
    }
    // Прочие вкладки — скрываем уже возвращённые.
    return items.filter(r => !r.returned_at)
  })()

  const combinedItems = [...publicItems, ...displayedItems]

  useEffect(() => { load(filter); if (filter === 'returning') reloadProjectReturns() }, [filter])
  useEffect(() => {
    reloadProjectReturns()
    reloadPublicReqs()
    reloadActiveRents()
  }, [])

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

  // Переход по публичной заявке: null → 'collecting' → 'ready'.
  async function changePublicStage(id, stage) {
    setUpdating(id)
    try {
      await rentApi.workflowStage(id, stage)
      await reloadPublicReqs()
    } catch (e) {
      toast?.(e.message || 'Ошибка', 'error')
    } finally {
      setUpdating(null)
    }
  }

  // «Отменить» публичной заявки — статус cancelled.
  async function cancelPublic(id) {
    setUpdating(id)
    try {
      await rentApi.status(id, 'cancelled')
      await reloadPublicReqs()
    } catch (e) {
      toast?.(e.message || 'Ошибка', 'error')
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

  // Подсчёт пустоты — учитываем публичные тоже.
  const isEmpty =
    combinedItems.length === 0 &&
    (filter !== 'returning' || projectReturns.length === 0)

  // Bottom-sheet с фильтрами (мобилка)
  const [filterSheetOpen, setFilterSheetOpen] = useState(false)
  const activeFilterLabel = (FILTERS.find(f => f.value === filter) || FILTERS[0]).label

  // В embed-режиме страница рендерится внутри другой страницы (без своего
  // WarehouseLayout, заголовка, back-кнопки и pills-фильтров) — родитель
  // отвечает за шапку и переключение между подвкладками.
  const Wrapper = embed ? 'div' : WarehouseLayout
  const wrapperProps = embed ? { className: 'req-embed' } : {}

  return (
    <Wrapper {...wrapperProps}>
      <style>{css}</style>
      <div className={embed ? 'req-page req-page-embed' : 'req-page'}>
        {!embed && (
          <div className="req-sticky">
            <div className="req-header-row">
              <button className="req-back-btn" onClick={() => navigate(-1)} aria-label="Назад">
                <ChevronLeft size={20} />
              </button>
              <h1 className="req-title" style={{ margin: 0 }}>Заявки</h1>
              <button className="req-filter-btn" onClick={() => setFilterSheetOpen(true)}>
                <SlidersHorizontal size={14} />
                {activeFilterLabel}
                {filter && <span className="req-filter-btn-dot" />}
              </button>
            </div>

            <div className="req-filters">
              {FILTERS.map(f => (
                <button key={f.value} className={`req-filter${filter === f.value ? ' active' : ''}`}
                  onClick={() => setFilter(f.value)}>
                  {f.label}
                </button>
              ))}
            </div>
          </div>
        )}

        {loading ? (
          <div className="req-loading">Загрузка...</div>
        ) : isEmpty ? (
          <div className="req-empty">Нет заявок</div>
        ) : (
          <div className="req-list">
            {/* Возвраты со склада проекта — только на вкладке «Возвращают» */}
            {filter === 'returning' && projectReturns.length > 0 && (
              <>
                <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--muted)', margin: '4px 0 4px' }}>
                  Со склада проекта · {projectReturns.length}
                </div>
                {projectReturns.map(r => {
                  const dl = r.deadline ? new Date(r.deadline).toLocaleDateString() : '—'
                  return (
                    <div key={'pr_' + r.id} style={{
                      background: 'var(--card)', border: '1px solid var(--border)',
                      borderRadius: 'var(--radius-card)', padding: 14,
                      display: 'flex', alignItems: 'center', gap: 12,
                    }}>
                      <Badge color="amber">Возврат с проекта</Badge>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 14, fontWeight: 600 }}>{r.unit_name}</div>
                        <div style={{ fontSize: 12, color: 'var(--muted)', display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                          <Clapperboard size={11} strokeWidth={1.8} /> {r.from_project_name} · срок: {dl} · запросил {r.requested_by_name || '—'}
                        </div>
                      </div>
                      <Button onClick={() => confirmProjectReturn(r)}>Подтвердить</Button>
                    </div>
                  )
                })}
                {displayedItems.length > 0 && (
                  <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--muted)', margin: '14px 0 4px' }}>
                    По заявкам · {displayedItems.length}
                  </div>
                )}
              </>
            )}
            {combinedItems.map(r => {
              const isPublic = !!r._isPublic
              // Бейдж статуса: для публичной показываем её stage через тот же маппинг,
              // либо status=issued для активных аренд.
              const publicStatus = isPublic
                ? (r.status === 'issued' ? 'issued'
                  : r._stage === 'ready' ? 'ready'
                  : r._stage === 'collecting' ? 'collecting' : 'new')
                : r.status
              const st = r.returned_at
                ? { label: 'Вернули', color: 'green' }
                : STATUS_LABELS[publicStatus] || { label: publicStatus, color: 'blue' }
              const ids = r.unit_ids || []
              const isOpen = expanded === r.id
              return (
                <div key={r.id} style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 'var(--radius-card)', boxShadow: 'var(--shadow-sm)' }}>
                  <div className="req-item" style={{ cursor: 'pointer' }} onClick={() => toggleExpand(r.id, ids)}>
                    <div className="req-item-body">
                      <div className="req-item-title">
                        {isPublic ? 'Партнёрская' : 'Заявка'} #{String(r.id).slice(0, 8)}
                        <Badge color={st.color}>{st.label}</Badge>
                        {isPublic && <Badge color="blue">Партнёрская</Badge>}
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
                      {/* Публичная заявка — тот же цикл Принять/Готово/Выдать через workflow_stage.
                          Ветки null/collecting/ready работают только для pending_review (status='new'),
                          чтобы не конфликтовать с активной арендой (status='issued'). */}
                      {isPublic && r.status === 'new' && r._stage === null && (<>
                        <Button variant="secondary" style={{ height: 34, fontSize: 13 }}
                          disabled={updating === r.id} onClick={() => changePublicStage(r.id, 'collecting')}>
                          Принять
                        </Button>
                        <Button variant="danger" style={{ height: 34, fontSize: 13 }}
                          disabled={updating === r.id} onClick={() => cancelPublic(r.id)}>
                          Отменить
                        </Button>
                      </>)}
                      {isPublic && r.status === 'new' && r._stage === 'collecting' && (<>
                        <Button variant="secondary" style={{ height: 34, fontSize: 13 }}
                          disabled={updating === r.id} onClick={() => changePublicStage(r.id, 'ready')}>
                          Готово
                        </Button>
                        <Button variant="danger" style={{ height: 34, fontSize: 13 }}
                          disabled={updating === r.id} onClick={() => cancelPublic(r.id)}>
                          Отменить
                        </Button>
                      </>)}
                      {isPublic && r.status === 'new' && r._stage === 'ready' && (
                        <Button variant="primary" style={{ height: 34, fontSize: 13 }}
                          onClick={() => navigate(`/issue/rent/${r.id}`)}>
                          Выдать →
                        </Button>
                      )}
                      {/* Активная партнёрская — один-в-один как у директора площадки:
                          «Запросить возврат» пока не запрошен, далее бейдж «Готовы вернуть»
                          и кнопка «Принять» ведёт на экран возврата. */}
                      {isPublic && r.status === 'issued' && !r.return_requested_at && (
                        <Button variant="primary" style={{ height: 34, fontSize: 13 }}
                          onClick={() => setConfirmReturnReq(r)}>
                          Запросить возврат
                        </Button>
                      )}
                      {isPublic && r.status === 'issued' && r.return_requested_at && (<>
                        <Badge color="amber">Готовы вернуть</Badge>
                        <Button variant="primary" style={{ height: 34, fontSize: 13 }}
                          onClick={() => navigate(`/return/rent/${r.id}`)}>
                          Принять
                        </Button>
                      </>)}
                      {/* Обычная проектная заявка */}
                      {!isPublic && EDITABLE_STATUSES.has(r.status) && (
                        <Button variant="secondary" style={{ height: 34, fontSize: 13 }}
                          title="Изменить состав заявки"
                          onClick={async () => {
                            // Догружаем недостающие единицы из БД (без toggle expand'а
                            // карточки заявки — модалка живёт независимо).
                            const missing = (ids || []).filter(id => !unitCache[id])
                            let cache = unitCache
                            if (missing.length) {
                              try {
                                const results = await Promise.all(
                                  missing.map(id => unitsApi.get(id).catch(() => null))
                                )
                                const next = { ...unitCache }
                                for (const result of results) {
                                  if (result?.unit) next[result.unit.id] = result.unit
                                }
                                setUnitCache(next)
                                cache = next
                              } catch { /* fallthrough — отрисуем что есть */ }
                            }
                            const initialUnits = (ids || []).map(uid => {
                              const u = cache[uid]
                              if (!u) return { id: uid, name: '—', category: 'other', qty: 1 }
                              return {
                                id: u.id, name: u.name, category: u.category,
                                qty: u.qty || 1, serial: u.serial,
                                photo_url: (u.photos || [])[0]?.url || null,
                              }
                            })
                            setEditingRequest({ id: r.id, initialUnits })
                          }}>
                          <Pencil size={14} style={{ marginRight: 4 }} /> Состав
                        </Button>
                      )}
                      {!isPublic && r.status === 'new' && (<>
                        <Button variant="secondary" style={{ height: 34, fontSize: 13 }}
                          disabled={updating === r.id} onClick={() => changeStatus(r.id, 'collecting')}>
                          Принять
                        </Button>
                        <Button variant="danger" style={{ height: 34, fontSize: 13 }}
                          disabled={updating === r.id} onClick={() => changeStatus(r.id, 'cancelled')}>
                          Отменить
                        </Button>
                      </>)}
                      {!isPublic && r.status === 'collecting' && (<>
                        <Button variant="secondary" style={{ height: 34, fontSize: 13 }}
                          disabled={updating === r.id} onClick={() => changeStatus(r.id, 'ready')}>
                          Готово
                        </Button>
                        <Button variant="danger" style={{ height: 34, fontSize: 13 }}
                          disabled={updating === r.id} onClick={() => changeStatus(r.id, 'cancelled')}>
                          Отменить
                        </Button>
                      </>)}
                      {!isPublic && r.status === 'ready' && (
                        <Button variant="primary" style={{ height: 34, fontSize: 13 }}
                          onClick={() => navigate(`/issue/${r.id}`)}>
                          Выдать →
                        </Button>
                      )}
                      {!isPublic && r.status === 'issued' && r.issuance_id && !r.return_requested_at && !r.returned_at && (
                        <Button variant="primary" style={{ height: 34, fontSize: 13 }}
                          onClick={() => setConfirmReturnReq(r)}>
                          Запросить возврат
                        </Button>
                      )}
                      {!isPublic && r.status === 'issued' && r.return_requested_at && !r.returned_at && (
                        <>
                          <Badge color="amber">Возврат запрошен</Badge>
                          {r.issuance_id && (
                            <Button variant="primary" style={{ height: 34, fontSize: 13 }}
                              onClick={() => navigate(`/return/${r.issuance_id}`)}>
                              Принять
                            </Button>
                          )}
                        </>
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
                                  <div style={{ width: 44, height: 44, borderRadius: 6, background: 'var(--paper)', border: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                                    <Package size={18} color="var(--subtle)" strokeWidth={1.4} />
                                  </div>
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

      {cardUnitId && (
        <UnitCardModal unitId={cardUnitId} onClose={() => setCardUnitId(null)} />
      )}

      {editingRequest && (
        <EditRequestItemsModal
          requestId={editingRequest.id}
          initialUnits={editingRequest.initialUnits}
          onClose={() => setEditingRequest(null)}
          onSaved={() => {
            setEditingRequest(null)
            // Сбрасываем кеш единиц этой заявки и список заявок —
            // updateItems на бэке мог создать новые units (через фото).
            setUnitCache({})
            load(filter)
          }}
        />
      )}

      <ConfirmModal
        open={!!confirmReturnReq}
        title="Запросить возврат имущества"
        message="Получатель получит уведомление и должен вернуть имущество. Нужно будет подтвердить фактический возврат."
        confirmLabel="Запросить"
        cancelLabel="Отмена"
        onConfirm={doRequestReturn}
        onCancel={() => setConfirmReturnReq(null)}
      />

      {filterSheetOpen && (
        <div className="req-sheet-overlay" onClick={() => setFilterSheetOpen(false)}>
          <div className="req-sheet" onClick={e => e.stopPropagation()}>
            <div className="req-sheet-handle" />
            <div className="req-sheet-title">Статус</div>
            {FILTERS.map(f => (
              <button
                key={f.value}
                className={`req-sheet-item${filter === f.value ? ' active' : ''}`}
                onClick={() => { setFilter(f.value); setFilterSheetOpen(false) }}
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>
      )}
    </Wrapper>
  )
}
