// Вкладка «Запросы» в хабе «Склад проекта».
// Показывает входящие (меня просят выдать) и исходящие (я прошу у других) заявки
// между проектами, с действиями: Принять/Отклонить, Отменить, Вернуть, Продлить.

import { useState, useEffect } from 'react'
import Button from '../shared/Button'
import Badge from '../shared/Badge'
import { useToast } from '../shared/Toast'
import { colleagues as colleaguesApi, projectUnits as projectUnitsApi } from '../../services/api'
import { categoryLabel } from '../../constants/categories'
import { ROLES } from '../../constants/roles'
import { useNotifications } from '../../hooks/useNotifications'

const STATUS_LABEL = {
  pending:   'Ожидает',
  accepted:  'Получено',
  rejected:  'Отклонено',
  returned:  'Возвращено',
  cancelled: 'Отменено',
}
const STATUS_COLOR = {
  pending:   'amber',
  accepted:  'green',
  rejected:  'red',
  returned:  'muted',
  cancelled: 'muted',
}

export default function LoanRequestsSection() {
  const [dir, setDir] = useState('incoming')  // incoming | outgoing
  const [list, setList] = useState([])
  const [loading, setLoading] = useState(true)
  // Входящие запросы возврата на основной склад от warehouse/producer.
  const [whReturns, setWhReturns] = useState([])
  const toast = useToast()
  // Когда юзер заходит сюда — это и есть «прочитал». Гасим непрочитанные
  // loan-уведомления, чтобы цифорка у вкладки «Запросы» в хабе очистилась.
  const { items: notifs, markRead } = useNotifications()

  function reload() {
    setLoading(true)
    Promise.all([
      colleaguesApi.listRequests(dir),
      // Только для incoming-направления: проект может видеть, что у них просят вернуть.
      dir === 'incoming'
        ? projectUnitsApi.listReturnRequests('incoming', 'pending').catch(() => ({ requests: [] }))
        : Promise.resolve({ requests: [] }),
    ])
      .then(([loans, wh]) => {
        setList(loans.requests || [])
        setWhReturns(wh.requests || [])
      })
      .finally(() => setLoading(false))
  }
  useEffect(reload, [dir])

  useEffect(() => {
    notifs
      .filter(n => !n.read && ['project_loan_request', 'warehouse_return_request'].includes(n.entity_type))
      .forEach(n => markRead(n.id).catch(() => {}))
    // markRead — стабильная функция, в deps не кладём (иначе цикл при не-memoized identity)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [notifs])

  async function act(fn, successMsg) {
    try {
      await fn()
      toast?.(successMsg, 'success')
      reload()
      window.dispatchEvent(new Event('project-warehouse-requests-changed'))
    } catch (e) {
      // 409 — заявка успела измениться (другой ответственный принял/отклонил,
      // запросчик отменил и т.п.). Показываем человеку что произошло и
      // принудительно перерисовываем список — иначе кнопка осталась бы со
      // stale-данными и второй клик дал бы тот же 409.
      if (e?.status === 409 || e?.status === 404) {
        toast?.(e.message || 'Заявка уже обработана', 'error')
        reload()
      } else {
        toast?.(e?.message || 'Ошибка', 'error')
      }
    }
  }

  return (
    <div>
      {/* Direction tabs */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 18, borderBottom: '1px solid var(--border)' }}>
        {[
          { k: 'incoming', label: 'Входящие' },
          { k: 'outgoing', label: 'Исходящие' },
        ].map(t => (
          <button key={t.k} onClick={() => setDir(t.k)}
            style={{
              padding: '10px 18px', border: 'none', background: 'none', cursor: 'pointer',
              fontSize: 14, fontWeight: dir === t.k ? 600 : 500,
              color: dir === t.k ? 'var(--accent)' : 'var(--muted)',
              borderBottom: dir === t.k ? '2px solid var(--accent)' : '2px solid transparent',
              marginBottom: -1,
            }}>
            {t.label}
          </button>
        ))}
      </div>

      {/* Входящие запросы возврата на основной склад (warehouse/producer → проект) */}
      {dir === 'incoming' && whReturns.length > 0 && (
        <div style={{ marginBottom: 18 }}>
          <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8, color: 'var(--text)' }}>
            ⏳ Просят вернуть на основной склад · {whReturns.length}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {whReturns.map(r => {
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
                    <div style={{ width: 44, height: 44, borderRadius: 8, background: 'var(--bg)', flexShrink: 0,
                      display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20 }}>📦</div>
                  )}
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={{ fontSize: 13, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.unit_name}</div>
                    <div style={{ fontSize: 11, color: 'var(--muted)' }}>
                      {categoryLabel(r.unit_category)} · просит {r.requested_by_name || '—'}
                      {' · срок: '}<strong style={{ color: overdue ? 'var(--red)' : 'var(--text)' }}>{dl}</strong>
                    </div>
                  </div>
                  <Badge color="amber">Нужно вернуть</Badge>
                  <Button onClick={() => act(() => projectUnitsApi.confirmReturn(r.id), 'Вернули')}>
                    Вернули
                  </Button>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {loading ? (
        <div style={{ padding: 40, textAlign: 'center', color: 'var(--muted)' }}>Загрузка...</div>
      ) : list.length === 0 && (dir !== 'incoming' || whReturns.length === 0) ? (
        <div style={{ padding: 40, textAlign: 'center', color: 'var(--muted)' }}>
          {dir === 'incoming' ? 'Нет запросов от других проектов.' : 'Вы не отправляли запросы.'}
        </div>
      ) : list.length > 0 ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {list.map(r => (
            <LoanCard key={r.id} req={r} direction={dir} act={act} />
          ))}
        </div>
      ) : null}
    </div>
  )
}

function LoanCard({ req, direction, act }) {
  const isIncoming = direction === 'incoming'
  const partnerProject = isIncoming ? req.to_project_name : req.from_project_name
  const partnerLabel = isIncoming ? 'Просит' : 'Владелец'
  const partnerUser = isIncoming
    ? [req.requested_by_name, ROLES[req.requested_by_role]?.label].filter(Boolean).join(' · ')
    : [req.responder_name, ROLES[req.responder_role]?.label].filter(Boolean).join(' · ')

  const deadline = req.deadline ? new Date(req.deadline).toLocaleDateString() : '—'
  const extensionPending = req.extension_requested && req.extension_new_deadline

  return (
    <div style={{ background: 'var(--white)', border: '1px solid var(--border)', borderRadius: 12, padding: 14 }}>
      <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
        {req.unit_photo ? (
          <img src={req.unit_photo} alt="" style={{ width: 56, height: 56, borderRadius: 8, objectFit: 'cover', flexShrink: 0 }} />
        ) : (
          <div style={{ width: 56, height: 56, borderRadius: 8, background: 'var(--bg)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 24, flexShrink: 0 }}>📦</div>
        )}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginBottom: 4 }}>
            <div style={{ fontSize: 14, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {req.unit_name}
            </div>
            <Badge color={STATUS_COLOR[req.status]}>{STATUS_LABEL[req.status]}</Badge>
          </div>
          <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 6 }}>
            {categoryLabel(req.unit_category)} · 🎬 {partnerProject}
          </div>
          <div style={{ fontSize: 12, color: 'var(--text)', marginBottom: 4 }}>
            <strong>{partnerLabel}:</strong> {partnerUser || '—'}
          </div>
          <div style={{ fontSize: 12, color: 'var(--muted)' }}>
            Срок: <strong style={{ color: 'var(--text)' }}>{deadline}</strong>
            {extensionPending && (
              <span style={{ marginLeft: 10, color: 'var(--amber, #d97706)' }}>
                · запрошено продление до {new Date(req.extension_new_deadline).toLocaleDateString()}
              </span>
            )}
          </div>
          {req.comment && (
            <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 6, fontStyle: 'italic' }}>
              «{req.comment}»
            </div>
          )}

          {/* Actions */}
          <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
            {isIncoming && req.status === 'pending' && (
              <>
                <Button onClick={() => act(() => colleaguesApi.acceptRequest(req.id), 'Выдано')}>
                  Выдать
                </Button>
                <Button variant="secondary" onClick={() => act(() => colleaguesApi.rejectRequest(req.id), 'Отклонено')}>
                  Отклонить
                </Button>
              </>
            )}
            {isIncoming && req.status === 'accepted' && extensionPending && (
              <Button onClick={() => act(() => colleaguesApi.approveExtension(req.id), 'Продление одобрено')}>
                Одобрить продление
              </Button>
            )}
            {isIncoming && req.status === 'accepted' && (
              <Button variant="secondary" onClick={() => act(() => colleaguesApi.returnRequest(req.id), 'Возвращено')}>
                Вернули
              </Button>
            )}

            {!isIncoming && req.status === 'pending' && (
              <Button variant="secondary" onClick={() => act(() => colleaguesApi.cancelRequest(req.id), 'Отменено')}>
                Отменить
              </Button>
            )}
            {!isIncoming && req.status === 'accepted' && (
              <>
                <Button onClick={() => act(() => colleaguesApi.returnRequest(req.id), 'Возвращено')}>
                  Вернули
                </Button>
                {!extensionPending && (
                  <ExtendButton req={req} act={act} />
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

function ExtendButton({ req, act }) {
  const [open, setOpen] = useState(false)
  const [newDeadline, setNewDeadline] = useState('')
  if (!open) {
    return <Button variant="secondary" onClick={() => setOpen(true)}>Запросить продление</Button>
  }
  return (
    <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
      <input type="date" value={newDeadline} onChange={e => setNewDeadline(e.target.value)}
        min={req.deadline || new Date().toISOString().slice(0, 10)}
        style={{ height: 34, padding: '0 8px', border: '1px solid var(--border)', borderRadius: 8, fontSize: 13 }} />
      <Button disabled={!newDeadline}
        onClick={() => act(() => colleaguesApi.extendRequest(req.id, newDeadline), 'Запрос продления отправлен').then(() => setOpen(false))}>
        Отправить
      </Button>
      <Button variant="secondary" onClick={() => setOpen(false)}>×</Button>
    </div>
  )
}
