// Склады коллег — каталог чужих проектов в стиле общего каталога.
// Показывает все существующие проекты (даже без своих единиц) — у любого
// проекта может быть выдача со склада или одолженное у третьего проекта.
// Каждая строка несёт source: own / from_warehouse / from_project.
//
// «Запросить» во временное пользование — для own и from_warehouse источников
// (нельзя только перецеплять sub-loan from_project — возвратная цепочка
// через посредника-проект ломает ответственность).
// Backend на accept выставляет on_loan_to_project_id и шлёт уведомление
// warehouse_director — для from_warehouse это критично, т.к. issuance
// со склада остаётся прежний, но физически вещь уходит в другой проект.
//
// Доступ:
//   • production-роли (директор/реквизитор/костюмер площадки и т.д.) — отправляют loan-заявку.
//   • warehouse_director/warehouse_deputy/warehouse_staff/producer — кнопка
//     «Запросить возврат» (двухэтапный поток) + блок «⏳ Ожидают возврата».

import { useState, useEffect } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Package, ArrowRightLeft } from 'lucide-react'
import ProductionLayout from './ProductionLayout'
import Badge from '../shared/Badge'
import Button from '../shared/Button'
import UnitCardModal from '../shared/UnitCardModal'
import TruncTip from '../shared/TruncTip'
import UnitMissingDataBadge from '../shared/UnitMissingDataBadge'
import { missingUnitCardStyle } from '../../utils/unitMissingData'
import ConfirmModal from '../shared/ConfirmModal'
import RequestUnitModal from './RequestUnitModal'
import { useToast } from '../shared/Toast'
import {
  colleagues as colleaguesApi,
  projectUnits as projectUnitsApi,
  writeoffs as writeoffsApi,
  debts as debtsApi,
  issued as issuedApi,
} from '../../services/api'
import { CATEGORIES_FILTER, categoryLabel } from '../../constants/categories'
import { IS_CLOTHING_CAT } from '../../constants/clothingSizes'
import { useAuth } from '../../hooks/useAuth'

// Двухэтапный возврат на основной склад: warehouse-сторона / продюсер.
const DIRECT_RETURN_ROLES = new Set([
  'warehouse_director', 'warehouse_deputy', 'warehouse_staff', 'producer',
])
// Списание / в долг при приёмке возврата — только warehouse-сторона.
const WRITEOFF_ROLES = new Set(['warehouse_director', 'warehouse_deputy', 'warehouse_staff'])

const SOURCE_FILTERS = [
  { key: 'all',            label: 'Все источники' },
  { key: 'own',            label: 'На хранении' },
  { key: 'from_warehouse', label: 'Со склада' },
  { key: 'from_project',   label: 'От других проектов' },
]

function SourceBadge({ unit }) {
  const s = unit.source
  if (s === 'own')
    return <Badge color={unit.purchased ? 'green' : 'muted'}>{unit.purchased ? '🛒 Куплено' : '📦 На хранении'}</Badge>
  if (s === 'from_warehouse')
    return <Badge color="blue">📤 Со склада</Badge>
  if (s === 'from_project')
    return <Badge color="amber">🤝 {unit.loan_from_project_name || 'Из проекта'}</Badge>
  return null
}

function PendingLoanBadge({ unit }) {
  if (!unit.pending_loan_request) return null
  return <Badge color="amber">⏳ Запрошено</Badge>
}

function PageWrap({ embedded, children }) {
  return embedded ? <>{children}</> : <ProductionLayout>{children}</ProductionLayout>
}

export default function ColleaguesPage({ embedded = false }) {
  const { user } = useAuth()
  const toast = useToast()
  const [searchParams, setSearchParams] = useSearchParams()
  const isDirectReturn = DIRECT_RETURN_ROLES.has(user?.role)
  const canWriteoff   = WRITEOFF_ROLES.has(user?.role)

  const [projects, setProjects] = useState([])  // [{id, name, available_count}]
  const [activeId, setActiveId] = useState(null)
  const [units, setUnits] = useState([])
  const [loading, setLoading] = useState(true)
  const [unitsLoading, setUnitsLoading] = useState(false)

  const [category, setCategory] = useState('all')
  const [sourceFilter, setSourceFilter] = useState('all')
  const [viewMode, setViewMode] = useState(() => localStorage.getItem('unitsViewMode') || 'grid')

  const [cardId, setCardId] = useState(null)             // открытие UnitCardModal
  const [requestUnit, setRequestUnit] = useState(null)   // создание loan-заявки
  const [confirmReturnUnit, setConfirmReturnUnit] = useState(null) // запрос возврата на склад
  const [returnRequests, setReturnRequests] = useState([])

  const activeProject = projects.find(p => p.id === activeId)

  // ── Загрузка списков ──
  useEffect(() => {
    colleaguesApi.projects()
      .then(d => {
        const list = d.projects || []
        setProjects(list)
        if (list.length && !activeId) {
          const requestedProjectId = searchParams.get('project_id')
          const requested = list.find(p => String(p.id) === String(requestedProjectId))
          setActiveId(requested?.id || list[0].id)
        }
      })
      .finally(() => setLoading(false))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function reloadUnits(pid = activeId) {
    if (!pid) return
    setUnitsLoading(true)
    colleaguesApi.projectUnits(pid)
      .then(d => setUnits(d.units || []))
      .catch(() => setUnits([]))
      .finally(() => setUnitsLoading(false))
  }
  useEffect(() => { reloadUnits(activeId) }, [activeId]) // eslint-disable-line

  function reloadReturnRequests() {
    if (!isDirectReturn) return
    projectUnitsApi.listReturnRequests('outgoing', 'pending')
      .then(d => setReturnRequests(d.requests || []))
      .catch(() => {})
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { reloadReturnRequests() }, [isDirectReturn])

  // ── Действия ──
  async function doRequestReturn() {
    const u = confirmReturnUnit
    if (!u) return
    try {
      await projectUnitsApi.requestReturn(u.id)
      toast?.('Запрос отправлен — у проекта 3 дня, чтобы принести вещь', 'success')
      setCardId(null)
      reloadUnits(); reloadReturnRequests()
      window.dispatchEvent(new Event('project-warehouse-requests-changed'))
    } catch (e) { toast?.(e.message || 'Ошибка', 'error') }
    setConfirmReturnUnit(null)
  }
  async function confirmReturn(r) {
    try {
      await projectUnitsApi.confirmReturn(r.id)
      toast?.('Вернули — единица на основном складе', 'success')
      reloadReturnRequests(); reloadUnits()
    } catch (e) { toast?.(e.message || 'Ошибка', 'error') }
  }
  async function writeoffReturn(r, kind) {
    const reason = window.prompt(kind === 'debt' ? 'Причина долга:' : 'Причина списания:') || ''
    try {
      if (kind === 'debt' && r.requested_by) {
        await debtsApi.create({
          user_id: r.requested_by, unit_id: r.unit_id,
          project_id: r.from_project_id, reason,
        })
      } else {
        await writeoffsApi.create({
          unit_id: r.unit_id, source: 'project', source_ref: r.id,
          project_id: r.from_project_id, reason, kind,
        })
      }
      await projectUnitsApi.confirmReturn(r.id).catch(() => {})
      toast?.(kind === 'debt' ? 'Переведено в долг' : 'Списано', 'success')
      reloadReturnRequests(); reloadUnits()
    } catch (e) { toast?.(e.message || 'Ошибка', 'error') }
  }
  async function cancelReturn(r) {
    try {
      await projectUnitsApi.cancelReturn(r.id)
      toast?.('Запрос отменён', 'info')
      reloadReturnRequests()
    } catch (e) { toast?.(e.message || 'Ошибка', 'error') }
  }

  // ── Фильтрация ──
  const filtered = units.filter(u =>
    (category === 'all' || u.category === category) &&
    (sourceFilter === 'all' || u.source === sourceFilter)
  )

  return (
    <PageWrap embedded={embedded}>
      <style>{`
        .col-grid {
          transform: translate3d(0, 0, 0);
          will-change: transform;
          contain: paint;
        }
        .col-grid img {
          backface-visibility: hidden;
          transform: translateZ(0);
        }
        @media (max-width: 480px) {
          .col-grid { grid-template-columns: repeat(2, 1fr) !important; gap: 10px !important; }
          .col-page { padding: 16px 12px !important; }
        }
      `}</style>
      <div className="col-page" style={{ padding: embedded ? 0 : '24px 32px' }}>
        {/* Header */}
        {!embedded && (
          <div style={{ marginBottom: 18 }}>
            <h1 style={{ fontSize: 22, fontWeight: 700, marginBottom: 6 }}>
              {isDirectReturn ? 'Склады проектов' : 'Склады коллег'}
            </h1>
            <div style={{ fontSize: 13, color: 'var(--muted)' }}>
              {isDirectReturn
                ? 'Остатки на складах всех проектов. Можно вернуть единицу на основной склад.'
                : 'Что есть у других проектов. Можно попросить во временное пользование.'}
            </div>
          </div>
        )}

        {/* «Ожидают возврата» — только warehouse/producer */}
        {isDirectReturn && returnRequests.length > 0 && (
          <div style={{ marginBottom: 22 }}>
            <h2 style={{ fontSize: 15, fontWeight: 600, marginBottom: 10 }}>
              ⏳ Ожидают возврата · {returnRequests.length}
            </h2>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {returnRequests.map(r => {
                const dl = r.deadline ? new Date(r.deadline).toLocaleDateString() : '—'
                const overdue = r.deadline && new Date(r.deadline) < new Date()
                return (
                  <div key={r.id} style={{
                    background: 'var(--white)', border: '1px solid var(--border)', borderRadius: 10,
                    padding: 12, display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap',
                  }}>
                    {r.unit_photo ? (
                      <img src={r.unit_photo} alt="" style={{ width: 44, height: 44, borderRadius: 8, objectFit: 'cover', flexShrink: 0 }} />
                    ) : (
                      <div style={{ width: 44, height: 44, borderRadius: 8, background: 'var(--bg)',
                        display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                        <Package size={18} color="var(--muted)" />
                      </div>
                    )}
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div style={{ fontSize: 13, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.unit_name}</div>
                      <div style={{ fontSize: 11, color: 'var(--muted)' }}>
                        {categoryLabel(r.unit_category)} · 🎬 {r.from_project_name} · срок: <strong style={{ color: overdue ? 'var(--red)' : 'var(--text)' }}>{dl}</strong>
                      </div>
                    </div>
                    <Button onClick={() => confirmReturn(r)}>Вернули</Button>
                    {canWriteoff && (
                      <>
                        <Button variant="secondary" onClick={() => writeoffReturn(r, 'writeoff')} style={{ color: 'var(--red)' }}>Списать</Button>
                        <Button variant="secondary" onClick={() => writeoffReturn(r, 'debt')} style={{ color: 'var(--amber, #d97706)' }}>В долг</Button>
                      </>
                    )}
                    <Button variant="secondary" onClick={() => cancelReturn(r)}>Отменить</Button>
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {loading ? (
          <div style={{ padding: 40, textAlign: 'center', color: 'var(--muted)' }}>Загрузка...</div>
        ) : projects.length === 0 ? (
          <div style={{ padding: 40, textAlign: 'center', color: 'var(--muted)' }}>
            В системе нет других проектов.
          </div>
        ) : (
          <>
            {/* Project tabs */}
            <div style={{ display: 'flex', gap: 6, marginBottom: 18, flexWrap: 'wrap' }}>
              {projects.map(p => (
                <button key={p.id} onClick={() => {
                  setActiveId(p.id)
                  const next = new URLSearchParams(searchParams)
                  next.set('project_id', p.id)
                  setSearchParams(next, { replace: true })
                }}
                  style={{
                    padding: '8px 14px', borderRadius: 999, fontSize: 13, fontWeight: 500,
                    border: activeId === p.id ? '1.5px solid var(--accent)' : '1px solid var(--border)',
                    background: activeId === p.id ? 'rgba(var(--accent-rgb,249,115,22),0.08)' : 'var(--white)',
                    cursor: 'pointer',
                  }}>
                  🎬 {p.name} <span style={{ color: 'var(--muted)', marginLeft: 6 }}>· {p.available_count}</span>
                </button>
              ))}
            </div>

            {/* Filters row */}
            <div style={{ display: 'flex', gap: 10, marginBottom: 18, flexWrap: 'wrap', alignItems: 'center' }}>
              <select value={category} onChange={e => setCategory(e.target.value)} style={{
                height: 40, padding: '0 12px', border: '1px solid var(--border)',
                borderRadius: 'var(--radius-btn)', fontSize: 13, background: 'var(--white)', cursor: 'pointer',
              }}>
                {CATEGORIES_FILTER.map(c => <option key={c} value={c}>{c === 'all' ? 'Категория' : categoryLabel(c)}</option>)}
              </select>
              <select value={sourceFilter} onChange={e => setSourceFilter(e.target.value)} style={{
                height: 40, padding: '0 12px', border: '1px solid var(--border)',
                borderRadius: 'var(--radius-btn)', fontSize: 13, background: 'var(--white)', cursor: 'pointer',
              }}>
                {SOURCE_FILTERS.map(s => <option key={s.key} value={s.key}>{s.label}</option>)}
              </select>
              <span style={{ fontSize: 13, color: 'var(--muted)' }}>{filtered.length} ед.</span>
              <div style={{ display: 'flex', gap: 2, marginLeft: 'auto' }}>
                {[
                  { mode: 'grid', icon: '▦', title: 'Карточки' },
                  { mode: 'rows', icon: '☰', title: 'Строки' },
                  { mode: 'list', icon: '≡', title: 'Список' },
                ].map(v => (
                  <button key={v.mode} title={v.title}
                    onClick={() => { setViewMode(v.mode); localStorage.setItem('unitsViewMode', v.mode) }}
                    style={{
                      width: 32, height: 32, border: '1px solid var(--border)', borderRadius: 'var(--radius-btn)',
                      background: viewMode === v.mode ? 'var(--accent)' : 'var(--white)',
                      color: viewMode === v.mode ? '#fff' : 'var(--muted)',
                      fontSize: 16, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
                    }}>{v.icon}</button>
                ))}
              </div>
            </div>

            {unitsLoading && <div style={{ textAlign: 'center', padding: '40px 0', color: 'var(--muted)', fontSize: 14 }}>Загрузка...</div>}

            {!unitsLoading && filtered.length === 0 && (
              <div style={{ textAlign: 'center', padding: '40px 0', color: 'var(--muted)', fontSize: 14 }}>
                У этого проекта пока ничего нет в выбранных фильтрах.
              </div>
            )}

            {/* Grid */}
            {!unitsLoading && viewMode === 'grid' && filtered.length > 0 && (
              <div className="col-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(170px, 1fr))', gap: 12 }}>
                {filtered.map(u => (
                  <GridTile
                    key={`${u.source}-${u.id}`}
                    unit={u}
                    onOpen={() => setCardId(u.id)}
                    onRequest={() => setRequestUnit({ ...u, _project_id: activeId, _project_name: activeProject?.name })}
                    onRequestReturn={() => setConfirmReturnUnit(u)}
                    isDirectReturn={isDirectReturn}
                    userRole={user?.role}
                  />
                ))}
              </div>
            )}

            {/* Rows */}
            {!unitsLoading && viewMode === 'rows' && filtered.length > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {filtered.map(u => (
                  <RowTile
                    key={`${u.source}-${u.id}`}
                    unit={u}
                    onOpen={() => setCardId(u.id)}
                    onRequest={() => setRequestUnit({ ...u, _project_id: activeId, _project_name: activeProject?.name })}
                    onRequestReturn={() => setConfirmReturnUnit(u)}
                    isDirectReturn={isDirectReturn}
                    userRole={user?.role}
                  />
                ))}
              </div>
            )}

            {/* List */}
            {!unitsLoading && viewMode === 'list' && filtered.length > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                {filtered.map(u => (
                  <div key={`${u.source}-${u.id}`} onClick={() => setCardId(u.id)} style={{
                    display: 'flex', alignItems: 'center', gap: 12, padding: '8px 12px',
                    background: 'var(--card)', borderRadius: 'var(--radius-btn)', cursor: 'pointer',
                  }}>
                    <div style={{ flex: 1, minWidth: 0, fontSize: 13, fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{u.name}</div>
                    <span style={{ fontSize: 12, color: 'var(--muted)', flexShrink: 0 }}>{categoryLabel(u.category)}</span>
                    <SourceBadge unit={u} />
                    <PendingLoanBadge unit={u} />
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>

      {/* Card — с extraActions в зависимости от роли и источника единицы */}
      {cardId && (() => {
        const u = units.find(x => x.id === cardId)
        const isLoaned = !!u?.on_loan_to_project_id
        const hasPendingLoan = !!u?.pending_loan_request
        // own + from_warehouse поддерживаем; from_project не трогаем (sub-loan).
        const canLoanRequest = u && !isLoaned && !hasPendingLoan && (u.source === 'own' || u.source === 'from_warehouse')
        const actions = []
        if (u && !isLoaned && !hasPendingLoan) {
          if (isDirectReturn) {
            // wh-director/deputy/staff/producer
            if (u.source === 'own') {
              actions.push({
                label: 'Запросить возврат на склад',
                variant: 'primary',
                onClick: () => { setConfirmReturnUnit(u); setCardId(null) },
              })
            } else if (u.source === 'from_warehouse' && u.issuance_id) {
              actions.push({
                label: 'Запросить возврат на склад',
                variant: 'primary',
                onClick: async () => {
                  try {
                    await issuedApi.requestReturnByIssuance(u.issuance_id)
                    toast?.('Запрос возврата отправлен получателю', 'success')
                    setCardId(null); reloadUnits()
                  } catch (e) { toast?.(e.message || 'Ошибка', 'error') }
                },
              })
            }
          } else if (canLoanRequest) {
            // production-роль с project_id — loan-заявка на свой проект.
            // Работает и для own (одолжить у владельца), и для from_warehouse
            // (передача держателя — issuance остаётся, склад уведомляется).
            actions.push({
              label: 'Запросить на проект',
              variant: 'primary',
              onClick: () => {
                setRequestUnit({ ...u, _project_id: activeId, _project_name: activeProject?.name })
                setCardId(null)
              },
            })
          }
        }
        return <UnitCardModal unitId={cardId} onClose={() => setCardId(null)} extraActions={actions} />
      })()}

      {/* Request modal — loan от чужого проекта */}
      {requestUnit && (
        <RequestUnitModal
          unit={requestUnit}
          ownerProjectId={requestUnit._project_id}
          ownerProjectName={requestUnit._project_name}
          onClose={() => setRequestUnit(null)}
          onSent={() => {
            setRequestUnit(null)
            toast?.('Заявка отправлена владельцу', 'success')
            reloadUnits()
            window.dispatchEvent(new Event('project-warehouse-requests-changed'))
          }}
        />
      )}

      {/* Confirm: запросить возврат на основной склад (warehouse/producer) */}
      <ConfirmModal
        open={!!confirmReturnUnit}
        title="Запросить возврат"
        message={confirmReturnUnit
          ? `Сотрудники проекта получат уведомление и у них будет 3 дня, чтобы принести «${confirmReturnUnit.name}» на основной склад.`
          : ''}
        confirmLabel="Запросить"
        cancelLabel="Отмена"
        onConfirm={doRequestReturn}
        onCancel={() => setConfirmReturnUnit(null)}
      />
    </PageWrap>
  )
}

// ────────────────────────────────────────────────────────────────────────────
function GridTile({ unit, onOpen, onRequest, onRequestReturn, isDirectReturn, userRole }) {
  const isLoaned = !!unit.on_loan_to_project_id
  const hasPendingLoan = !!unit.pending_loan_request
  // Loan-запрос разрешён для own (одолжить у владельца) и from_warehouse
  // (перехватить выдачу — issuance остаётся, склад уведомляется на accept).
  // from_project оставляем недоступным (sub-loan ломает возвратную цепочку).
  const canLoan = !isLoaned && !hasPendingLoan && (unit.source === 'own' || unit.source === 'from_warehouse')
  // «Запросить возврат на склад» — только для own у warehouse-стороны
  // (для from_warehouse у warehouse-стороны есть отдельная ветка — см. модалку).
  const canRequestReturn = isDirectReturn && unit.source === 'own' && !isLoaned
  const missingStyle = missingUnitCardStyle(unit, userRole)
  return (
    <div onClick={onOpen} style={{
      background: 'var(--card)', borderRadius: 'var(--radius-card)',
      border: missingStyle.border || '1px solid var(--border)', cursor: 'pointer', overflow: 'hidden',
      boxShadow: missingStyle.boxShadow,
      opacity: isLoaned ? 0.6 : 1, position: 'relative',
    }}>
      <div style={{
        aspectRatio: '1', background: 'var(--bg)', display: 'flex',
        alignItems: 'center', justifyContent: 'center', overflow: 'hidden',
      }}>
        {unit.photo_url
          ? <img src={unit.photo_thumb_url || unit.photo_url} alt="" loading="lazy" decoding="async" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
          : <Package size={36} color="var(--muted)" strokeWidth={1.4} />}
      </div>
      <div style={{ padding: '10px 12px' }}>
        <TruncTip as="div" style={{ fontWeight: 500, fontSize: 13 }}>{unit.name}</TruncTip>
        <TruncTip as="div" style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}
          fullText={`${categoryLabel(unit.category)}${IS_CLOTHING_CAT(unit.category) && unit.dimensions ? ` · ${unit.dimensions.split('/')[0].trim()}` : ''}`}>
          {categoryLabel(unit.category)}
          {IS_CLOTHING_CAT(unit.category) && unit.dimensions && (
            <>{' · '}<span style={{ color: 'var(--text)', fontWeight: 500 }}>{unit.dimensions.split('/')[0].trim()}</span></>
          )}
        </TruncTip>
        <div style={{ marginTop: 6, display: 'flex', flexDirection: 'column', gap: 6 }}>
          <SourceBadge unit={unit} />
          <PendingLoanBadge unit={unit} />
          {isLoaned ? (
            <Badge color="amber">В другом проекте</Badge>
          ) : hasPendingLoan ? (
            null
          ) : isDirectReturn ? (
            canRequestReturn ? (
              <Button fullWidth variant="secondary" onClick={e => { e.stopPropagation(); onRequestReturn() }} style={{ height: 28, fontSize: 11 }}>
                Запросить возврат
              </Button>
            ) : null
          ) : canLoan ? (
            <Button fullWidth variant="secondary" onClick={e => { e.stopPropagation(); onRequest() }} style={{ height: 28, fontSize: 11 }}>
              <ArrowRightLeft size={11} style={{ marginRight: 4 }} /> Запросить
            </Button>
          ) : null}
        </div>
        <UnitMissingDataBadge unit={unit} role={userRole} />
      </div>
    </div>
  )
}

function RowTile({ unit, onOpen, onRequest, onRequestReturn, isDirectReturn, userRole }) {
  const isLoaned = !!unit.on_loan_to_project_id
  const hasPendingLoan = !!unit.pending_loan_request
  const canLoan = !isLoaned && !hasPendingLoan && (unit.source === 'own' || unit.source === 'from_warehouse')
  const canRequestReturn = isDirectReturn && unit.source === 'own' && !isLoaned
  const missingStyle = missingUnitCardStyle(unit, userRole)
  return (
    <div style={{
      background: 'var(--white)', borderRadius: 'var(--radius-card)',
      border: missingStyle.border || '1px solid var(--border)', overflow: 'hidden',
      boxShadow: missingStyle.boxShadow,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '14px 16px', cursor: 'pointer' }} onClick={onOpen}>
        <div style={{
          width: 52, height: 52, borderRadius: 8, flexShrink: 0,
          background: 'var(--bg)', border: '1px solid var(--border)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden',
        }}>
          {unit.photo_url
            ? <img src={unit.photo_thumb_url || unit.photo_url} alt="" loading="lazy" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
            : <Package size={22} color="var(--muted)" />}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 500, fontSize: 14, color: 'var(--accent)' }}>{unit.name}</div>
          <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>
            {unit.serial ? `${unit.serial} · ` : ''}{categoryLabel(unit.category)}
          </div>
          <UnitMissingDataBadge unit={unit} role={userRole} compact />
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }} onClick={e => e.stopPropagation()}>
          <SourceBadge unit={unit} />
          <PendingLoanBadge unit={unit} />
          {isLoaned ? (
            <Badge color="amber">В другом проекте</Badge>
          ) : hasPendingLoan ? (
            null
          ) : isDirectReturn ? (
            canRequestReturn ? (
              <Button variant="secondary" style={{ height: 32, fontSize: 12, padding: '0 10px' }} onClick={onRequestReturn}>Запросить возврат</Button>
            ) : null
          ) : canLoan ? (
            <Button variant="secondary" style={{ height: 32, fontSize: 12, padding: '0 10px' }} onClick={onRequest}>
              <ArrowRightLeft size={11} style={{ marginRight: 4 }} /> Запросить
            </Button>
          ) : null}
        </div>
      </div>
    </div>
  )
}
