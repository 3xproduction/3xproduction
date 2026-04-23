// Склады коллег — единицы других проектов.
// Клик по карточке открывает UnitCardModal (общий компонент) с кнопкой «Запросить»,
// которая открывает RequestUnitModal для создания заявки-займа между проектами.

import { useState, useEffect } from 'react'
import ProductionLayout from './ProductionLayout'
import Button from '../shared/Button'
import Badge from '../shared/Badge'
import { useToast } from '../shared/Toast'
import { colleagues as colleaguesApi, projectUnits as projectUnitsApi, warehouses as warehousesApi, writeoffs as writeoffsApi, debts as debtsApi } from '../../services/api'
import ConfirmModal from '../shared/ConfirmModal'
import { categoryLabel } from '../../constants/categories'
import RequestUnitModal from './RequestUnitModal'
import { useAuth } from '../../hooks/useAuth'

// Роли, которые забирают единицу с проекта через «запрос возврата» (двухэтапный поток):
// запрос → уведомление проекту → физическое возвращение → подтверждение.
// warehouse_director, warehouse_deputy, warehouse_staff и producer.
// Остальные (площадка) — создают loan-request для временного пользования.
const DIRECT_RETURN_ROLES = new Set([
  'warehouse_director', 'warehouse_deputy', 'warehouse_staff', 'producer',
])

// Роли, которым разрешено списывать / переводить в долг при приёмке возврата.
// Только warehouse-сторона — продюсер тут не участвует (это складской процесс).
const WRITEOFF_ROLES = new Set(['warehouse_director', 'warehouse_deputy', 'warehouse_staff'])

function PageWrap({ embedded, children }) {
  return embedded ? <>{children}</> : <ProductionLayout>{children}</ProductionLayout>
}

export default function ColleaguesPage({ embedded = false }) {
  const toast = useToast()
  const { user } = useAuth()
  const isDirectReturn = DIRECT_RETURN_ROLES.has(user?.role)
  const canWriteoff   = WRITEOFF_ROLES.has(user?.role)
  const [projects, setProjects] = useState([])
  const [active, setActive] = useState(null)
  const [units, setUnits] = useState([])
  const [loading, setLoading] = useState(true)
  const [openUnit, setOpenUnit] = useState(null)          // unit being viewed
  const [requestUnit, setRequestUnit] = useState(null)    // unit being requested
  const [confirmReturnUnit, setConfirmReturnUnit] = useState(null)
  // Открытые запросы возврата (видны warehouse/producer).
  const [returnRequests, setReturnRequests] = useState([])

  async function reloadReturnRequests() {
    if (!isDirectReturn) return
    try {
      const d = await projectUnitsApi.listReturnRequests('outgoing', 'pending')
      setReturnRequests(d.requests || [])
    } catch { /* silent */ }
  }
  useEffect(() => { reloadReturnRequests() }, [isDirectReturn])

  async function confirmReturn(r) {
    try {
      await projectUnitsApi.confirmReturn(r.id)
      toast?.('Возврат подтверждён — единица на основном складе', 'success')
      reloadReturnRequests()
      reloadUnits()
    } catch (e) { toast?.(e.message || 'Ошибка', 'error') }
  }
  // Списать/перевести в долг — альтернатива подтверждению возврата.
  // «Списать» → writeoffs (status=written_off, виден в WriteoffsPage).
  // «В долг» → debts на инициатора запроса (виден в DebtsPage) + writeoffs
  // как страховка, если debt.create упадёт без user_id.
  async function writeoffReturn(r, kind) {
    const reason = window.prompt(kind === 'debt' ? 'Причина долга:' : 'Причина списания:') || ''
    try {
      if (kind === 'debt' && r.requested_by) {
        await debtsApi.create({
          user_id: r.requested_by,
          unit_id: r.unit_id,
          project_id: r.from_project_id,
          reason,
        })
      } else {
        await writeoffsApi.create({
          unit_id: r.unit_id,
          source: 'project',
          source_ref: r.id,
          project_id: r.from_project_id,
          reason,
          kind,
        })
      }
      // Закрываем запрос возврата как подтверждённый — единица всё равно уходит из проекта.
      await projectUnitsApi.confirmReturn(r.id).catch(() => {})
      toast?.(kind === 'debt' ? 'Переведено в долг' : 'Списано', 'success')
      reloadReturnRequests()
      reloadUnits()
    } catch (e) { toast?.(e.message || 'Ошибка', 'error') }
  }
  async function cancelReturn(r) {
    try {
      await projectUnitsApi.cancelReturn(r.id)
      toast?.('Запрос отменён', 'info')
      reloadReturnRequests()
    } catch (e) { toast?.(e.message || 'Ошибка', 'error') }
  }

  async function reloadUnits() {
    if (!active) return
    const d = await colleaguesApi.projectUnits(active)
    setUnits(d.units || [])
  }

  async function doDirectReturnConfirmed() {
    const unit = confirmReturnUnit
    if (!unit) return
    try {
      await projectUnitsApi.requestReturn(unit.id)
      toast?.('Запрос на возврат отправлен — у проекта 3 дня, чтобы принести вещь', 'success')
      setOpenUnit(null)
      reloadUnits()
      reloadReturnRequests()
    } catch (e) {
      toast?.(e.message || 'Ошибка', 'error')
    }
    setConfirmReturnUnit(null)
  }

  useEffect(() => {
    colleaguesApi.projects()
      .then(d => {
        setProjects(d.projects || [])
        if ((d.projects || []).length) setActive(d.projects[0].id)
      })
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    if (!active) return
    colleaguesApi.projectUnits(active).then(d => setUnits(d.units || [])).catch(() => {})
  }, [active])

  const activeProject = projects.find(p => p.id === active)

  return (
    <PageWrap embedded={embedded}>
      <div style={{ padding: embedded ? 0 : '24px 32px' }}>
        {!embedded && (
          <>
            <h1 style={{ fontSize: 22, fontWeight: 700, marginBottom: 8 }}>
              {isDirectReturn ? 'Склад проекта' : 'Склады коллег'}
            </h1>
            <div style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 20 }}>
              {isDirectReturn
                ? 'Остатки на складах проектов. Можно вернуть единицу на основной склад.'
                : 'Что есть у других проектов. Можно попросить на время по заявке.'}
            </div>
          </>
        )}

        {/* Блок запросов возврата — только для warehouse/producer */}
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
                    padding: 12, display: 'flex', alignItems: 'center', gap: 12,
                  }}>
                    {r.unit_photo ? (
                      <img src={r.unit_photo} alt="" style={{ width: 44, height: 44, borderRadius: 8, objectFit: 'cover', flexShrink: 0 }} />
                    ) : (
                      <div style={{ width: 44, height: 44, borderRadius: 8, background: 'var(--bg)',
                        display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20, flexShrink: 0 }}>📦</div>
                    )}
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div style={{ fontSize: 13, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.unit_name}</div>
                      <div style={{ fontSize: 11, color: 'var(--muted)' }}>
                        {categoryLabel(r.unit_category)} · 🎬 {r.from_project_name} · срок: <strong style={{ color: overdue ? 'var(--red)' : 'var(--text)' }}>{dl}</strong>
                      </div>
                    </div>
                    <Button onClick={() => confirmReturn(r)}>Подтвердить возврат</Button>
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
            У других проектов пока нет предметов на своих складах.
          </div>
        ) : (
          <>
            {/* Project tabs */}
            <div style={{ display: 'flex', gap: 6, marginBottom: 18, flexWrap: 'wrap' }}>
              {projects.map(p => (
                <button key={p.id} onClick={() => setActive(p.id)}
                  style={{
                    padding: '8px 14px', borderRadius: 999, fontSize: 13, fontWeight: 500,
                    border: active === p.id ? '1.5px solid var(--accent)' : '1px solid var(--border)',
                    background: active === p.id ? 'rgba(var(--accent-rgb,249,115,22),0.08)' : 'var(--white)',
                    cursor: 'pointer',
                  }}>
                  🎬 {p.name} <span style={{ color: 'var(--muted)', marginLeft: 6 }}>· {p.available_count}</span>
                </button>
              ))}
            </div>

            {/* Items grid */}
            <div style={{
              display: 'grid', gap: 14,
              gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
            }}>
              {units.map(u => {
                const isLoaned = !!u.on_loan_to_project_id
                return (
                  <div key={u.id}
                    onClick={() => setOpenUnit(u)}
                    style={{
                      background: 'var(--white)', borderRadius: 12,
                      border: '1px solid var(--border)', overflow: 'hidden',
                      cursor: 'pointer', transition: 'transform 0.12s, box-shadow 0.12s',
                      opacity: isLoaned ? 0.6 : 1,
                    }}
                    onMouseEnter={e => { e.currentTarget.style.transform = 'translateY(-2px)'; e.currentTarget.style.boxShadow = '0 4px 12px rgba(0,0,0,0.06)' }}
                    onMouseLeave={e => { e.currentTarget.style.transform = 'none'; e.currentTarget.style.boxShadow = 'none' }}
                  >
                    {u.photo_url ? (
                      <img src={u.photo_url} alt="" style={{ width: '100%', aspectRatio: '1 / 1', objectFit: 'cover' }} />
                    ) : (
                      <div style={{ width: '100%', aspectRatio: '1 / 1', background: 'var(--bg)',
                        display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--muted)', fontSize: 32 }}>📦</div>
                    )}
                    <div style={{ padding: 10 }}>
                      <div style={{ fontSize: 13, fontWeight: 500, marginBottom: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{u.name}</div>
                      <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 8 }}>{categoryLabel(u.category)}</div>
                      {isLoaned
                        ? <Badge color="amber">В другом проекте</Badge>
                        : isDirectReturn
                          ? <Button fullWidth variant="secondary" onClick={e => { e.stopPropagation(); setConfirmReturnUnit(u) }}>
                              Запросить возврат
                            </Button>
                          : <Button fullWidth variant="secondary" onClick={e => { e.stopPropagation(); setRequestUnit({ ...u, _project_id: active, _project_name: activeProject?.name }) }}>
                              Запросить
                            </Button>
                      }
                    </div>
                  </div>
                )
              })}
            </div>
          </>
        )}
      </div>

      {openUnit && (
        <ColleagueUnitModal
          unit={openUnit}
          projectName={activeProject?.name}
          isDirectReturn={isDirectReturn}
          onRequest={() => { setRequestUnit({ ...openUnit, _project_id: active, _project_name: activeProject?.name }); setOpenUnit(null) }}
          onDirectReturn={() => setConfirmReturnUnit(openUnit)}
          onClose={() => setOpenUnit(null)}
        />
      )}

      {requestUnit && (
        <RequestUnitModal
          unit={requestUnit}
          ownerProjectId={requestUnit._project_id}
          ownerProjectName={requestUnit._project_name}
          onClose={() => setRequestUnit(null)}
          onSent={() => {
            setRequestUnit(null)
            toast?.('Заявка отправлена владельцу', 'success')
          }}
        />
      )}

      <ConfirmModal
        open={!!confirmReturnUnit}
        title="Запросить возврат"
        message={confirmReturnUnit
          ? `Сотрудники проекта получат уведомление и у них будет 3 дня, чтобы принести «${confirmReturnUnit.name}» на основной склад.`
          : ''}
        confirmLabel="Запросить"
        cancelLabel="Отмена"
        onConfirm={doDirectReturnConfirmed}
        onCancel={() => setConfirmReturnUnit(null)}
      />
    </PageWrap>
  )
}

// Read-only карточка единицы из чужого проекта. Не использует общий UnitCardModal
// потому что тот рассчитан на полноценную единицу склада (действия, полки, и т.п.).
function ColleagueUnitModal({ unit, projectName, isDirectReturn, onRequest, onDirectReturn, onClose }) {
  const isLoaned = !!unit.on_loan_to_project_id
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 500,
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }} onClick={onClose}>
      <div style={{ background: 'var(--white)', borderRadius: 14, padding: 22, maxWidth: 520, width: '100%' }}
        onClick={e => e.stopPropagation()}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 10 }}>
          <div>
            <div style={{ fontSize: 17, fontWeight: 600 }}>{unit.name}</div>
            <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>
              {categoryLabel(unit.category)} · 🎬 {projectName || '—'}
            </div>
          </div>
          {isLoaned && <Badge color="amber">Уже в другом проекте</Badge>}
        </div>

        {unit.photo_url && (
          <img src={unit.photo_url} alt="" style={{ width: '100%', aspectRatio: '16/9', objectFit: 'cover', borderRadius: 10, marginBottom: 12 }} />
        )}

        {unit.description && (
          <div style={{ fontSize: 13, marginBottom: 12, color: 'var(--text)' }}>{unit.description}</div>
        )}

        <div style={{ background: 'var(--bg)', borderRadius: 10, padding: 10, fontSize: 12, color: 'var(--muted)', marginBottom: 14 }}>
          Единица принадлежит складу проекта <strong style={{ color: 'var(--text)' }}>{projectName}</strong>.
          {isDirectReturn
            ? ' При запросе возврата у сотрудников проекта будет 3 дня, чтобы принести вещь на основной склад.'
            : ' Чтобы взять её во временное пользование — отправьте заявку владельцу.'}
        </div>

        <div style={{ display: 'flex', gap: 8 }}>
          <Button variant="secondary" fullWidth onClick={onClose}>Закрыть</Button>
          {!isLoaned && (
            isDirectReturn
              ? <Button fullWidth onClick={onDirectReturn}>Запросить возврат</Button>
              : <Button fullWidth onClick={onRequest}>Запросить</Button>
          )}
        </div>
      </div>
    </div>
  )
}
