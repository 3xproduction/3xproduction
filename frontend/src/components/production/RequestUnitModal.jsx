// Модалка запроса единицы у чужого проекта. Референс визуала — форма новой заявки
// в складе (RequestsPage): дедлайн + комментарий + выбор получателя.
// Специфика inter-project: получатель (requester) подставляется автоматически из
// текущего пользователя, а «кому направлен запрос» — роль-выдающий из проекта-владельца.

import { useState, useEffect } from 'react'
import Button from '../shared/Button'
import { useToast } from '../shared/Toast'
import { colleagues as colleaguesApi } from '../../services/api'
import { useAuth } from '../../hooks/useAuth'
import { categoryLabel } from '../../constants/categories'
import { ROLES } from '../../constants/roles'

export default function RequestUnitModal({ unit, ownerProjectId, ownerProjectName, onClose, onSent }) {
  const { user } = useAuth()
  const toast = useToast()
  const [deadline, setDeadline] = useState('')
  const [comment, setComment] = useState('')
  const [responders, setResponders] = useState([])
  const [responderId, setResponderId] = useState('')
  const [sending, setSending] = useState(false)
  const [loadingResponders, setLoadingResponders] = useState(true)

  useEffect(() => {
    if (!ownerProjectId) return
    setLoadingResponders(true)
    colleaguesApi.responders(ownerProjectId, unit.category)
      .then(d => {
        setResponders(d.responders || [])
        if ((d.responders || []).length) setResponderId(d.responders[0].id)
      })
      .catch(() => {})
      .finally(() => setLoadingResponders(false))
  }, [ownerProjectId, unit?.category])

  const canSend = !!deadline && !sending

  async function send() {
    setSending(true)
    try {
      await colleaguesApi.createRequest({
        unit_id: unit.id,
        responder_id: responderId || null,
        deadline,
        comment: comment.trim() || null,
      })
      onSent?.()
    } catch (e) {
      toast?.(e.message || 'Не удалось отправить заявку', 'error')
    }
    setSending(false)
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 600,
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }} onClick={onClose}>
      <div style={{ background: 'var(--white)', borderRadius: 14, padding: 22, maxWidth: 480, width: '100%' }}
        onClick={e => e.stopPropagation()}>
        <div style={{ fontSize: 17, fontWeight: 600, marginBottom: 4 }}>Запрос единицы</div>
        <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 14 }}>
          Единица будет передана во временное пользование вашему проекту после подтверждения
          со стороны владельца.
        </div>

        {/* Unit preview */}
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', background: 'var(--bg)', borderRadius: 10, padding: 10, marginBottom: 14 }}>
          {unit.photo_url ? (
            <img src={unit.photo_url} alt="" style={{ width: 48, height: 48, borderRadius: 8, objectFit: 'cover', flexShrink: 0 }} />
          ) : (
            <div style={{ width: 48, height: 48, borderRadius: 8, background: 'var(--white)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22 }}>📦</div>
          )}
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ fontSize: 13, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{unit.name}</div>
            <div style={{ fontSize: 11, color: 'var(--muted)' }}>
              {categoryLabel(unit.category)} · 🎬 {ownerProjectName || '—'}
            </div>
          </div>
        </div>

        {/* Requester (read-only) */}
        <div style={{ marginBottom: 12 }}>
          <div style={{ fontSize: 12, fontWeight: 500, marginBottom: 4 }}>Получатель</div>
          <div style={{ ...inputStyle, background: 'var(--bg)', display: 'flex', alignItems: 'center', cursor: 'default' }}>
            {user?.name || '—'} <span style={{ color: 'var(--muted)', marginLeft: 6, fontSize: 11 }}>
              · {ROLES[user?.role]?.label || user?.role}
            </span>
          </div>
        </div>

        {/* Responder */}
        <div style={{ marginBottom: 12 }}>
          <div style={{ fontSize: 12, fontWeight: 500, marginBottom: 4 }}>Кому направить запрос</div>
          {loadingResponders ? (
            <div style={{ ...inputStyle, color: 'var(--muted)' }}>Загрузка...</div>
          ) : responders.length === 0 ? (
            <div style={{ ...inputStyle, color: 'var(--muted)' }}>
              В проекте-владельце нет ответственных по этой категории
            </div>
          ) : (
            <select value={responderId} onChange={e => setResponderId(e.target.value)} style={inputStyle}>
              {responders.map(r => (
                <option key={r.id} value={r.id}>
                  {r.name} · {ROLES[r.role]?.label || r.role}
                </option>
              ))}
            </select>
          )}
        </div>

        {/* Deadline */}
        <div style={{ marginBottom: 12 }}>
          <div style={{ fontSize: 12, fontWeight: 500, marginBottom: 4 }}>До какого числа нужна *</div>
          <input type="date" value={deadline} onChange={e => setDeadline(e.target.value)}
            min={new Date().toISOString().slice(0, 10)} style={inputStyle} />
          <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 3 }}>
            Срок можно продлить по согласованию с владельцем.
          </div>
        </div>

        {/* Comment */}
        <div style={{ marginBottom: 14 }}>
          <div style={{ fontSize: 12, fontWeight: 500, marginBottom: 4 }}>Комментарий</div>
          <textarea value={comment} onChange={e => setComment(e.target.value)}
            placeholder="Зачем/на какие сцены нужна единица"
            style={{ ...inputStyle, height: 64, resize: 'vertical', fontFamily: 'inherit' }} />
        </div>

        <div style={{ display: 'flex', gap: 8 }}>
          <Button variant="secondary" fullWidth onClick={onClose}>Отмена</Button>
          <Button fullWidth disabled={!canSend} onClick={send}>
            {sending ? 'Отправка...' : 'Отправить заявку'}
          </Button>
        </div>
        {!deadline && (
          <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 8, textAlign: 'center' }}>
            Укажите срок возврата
          </div>
        )}
      </div>
    </div>
  )
}

const inputStyle = {
  width: '100%', height: 36, padding: '0 10px',
  border: '1px solid var(--border)', borderRadius: 8, fontSize: 13,
  boxSizing: 'border-box', background: 'var(--white)',
}
