// Быстрый возврат от конкретного человека.
//
// 1 экран:
//   • Все открытые единицы человека принимаются одним действием
//   • На каждой — quick-pick «✓ Хорошее / ⚠ Повреждено / 💰 В долг / ❌ Списать»
//   • Штамп склада
//   • [Принять]
//
// Submit → POST /issued/walkin-return: транзакционно создаёт returns,
// обновляет статусы юнитов, генерирует один общий PDF на всю операцию.
import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import WarehouseLayout from './WarehouseLayout'
import Button from '../shared/Button'
import UnitCardModal from '../shared/UnitCardModal'
import { issued as issuedApi } from '../../services/api'

const CONDITIONS = [
  { value: 'good',     label: '✓ Хорошее',  color: 'var(--green, #10b981)' },
  { value: 'damaged',  label: '⚠ Повреждено', color: 'var(--red)' },
  { value: 'debt',     label: '💰 В долг',    color: 'var(--gold-600, #C9A55C)' },
  { value: 'writeoff', label: '❌ Списать',   color: 'var(--ink-500)' },
]

export default function WalkinReturnPage() {
  const { user_id } = useParams()
  const navigate = useNavigate()

  const [snapshot, setSnapshot] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  // conditions: Map<unit_id, condition>
  const [conditions, setConditions] = useState({})
  const [stamped, setStamped] = useState(false)
  const [conditionNotes, setConditionNotes] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [cardId, setCardId] = useState(null)

  useEffect(() => {
    issuedApi.user(user_id)
      .then(r => {
        setSnapshot(r)
        // По умолчанию все единицы принимаются, состояние «good».
        const cond = {}
        for (const it of r.items) cond[it.unit_id] = 'good'
        setConditions(cond)
      })
      .catch(err => setError(err?.message || 'Ошибка загрузки'))
      .finally(() => setLoading(false))
  }, [user_id])

  function setCondition(id, c) {
    setConditions(o => ({ ...o, [id]: c }))
  }

  const chosenIds = (snapshot?.items || []).map(it => it.unit_id)
  const canSubmit = chosenIds.length > 0 && stamped && !submitting

  async function handleSubmit() {
    if (!canSubmit) return
    setSubmitting(true)
    try {
      const fd = new FormData()
      fd.append('user_id', user_id)
      fd.append('unit_ids', JSON.stringify(chosenIds))
      const condMap = {}
      for (const id of chosenIds) condMap[id] = conditions[id] || 'good'
      fd.append('items_condition', JSON.stringify(condMap))
      fd.append('acceptor_signature_data', 'stamp')
      if (conditionNotes) fd.append('condition_notes', conditionNotes)

      await issuedApi.walkinReturn(fd)
      // Акт сохранён в S3 и виден в /acts. PDF не открываем — возвращаемся
      // в раздел «Выдано».
      navigate('/issued')
    } catch (err) {
      setError(err?.message || 'Ошибка возврата')
      setSubmitting(false)
    }
  }

  if (loading) {
    return <WarehouseLayout><div style={{ padding: 40, textAlign: 'center', color: 'var(--muted)' }}>Загрузка…</div></WarehouseLayout>
  }
  if (error && !snapshot) {
    return <WarehouseLayout><div style={{ padding: 40, textAlign: 'center', color: 'var(--red)' }}>{error}</div></WarehouseLayout>
  }
  if (!snapshot || !snapshot.items.length) {
    return (
      <WarehouseLayout>
        <div style={{ padding: 40, textAlign: 'center' }}>
          <div style={{ color: 'var(--muted)', marginBottom: 16 }}>У этого человека нет открытых выдач.</div>
          <Button variant="secondary" onClick={() => navigate('/issued')}>Назад к списку</Button>
        </div>
      </WarehouseLayout>
    )
  }

  return (
    <WarehouseLayout>
      <div style={{ padding: '24px 32px', maxWidth: 700, margin: '0 auto' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8 }}>
          <button
            onClick={() => navigate(-1)}
            style={{ background: 'none', border: 'none', fontSize: 20, cursor: 'pointer', color: 'var(--muted)' }}
            aria-label="Назад"
          >←</button>
          <h1 style={{ fontSize: 18, fontWeight: 600 }}>Принять возврат</h1>
        </div>
        <div style={{ marginLeft: 32, marginBottom: 20, color: 'var(--muted)', fontSize: 13 }}>
          {snapshot.receiver?.name} · {snapshot.receiver?.role}
          {snapshot.receiver?.project_name && ` · ${snapshot.receiver.project_name}`}
        </div>

        <div style={{
          padding: 12, marginBottom: 16, borderRadius: 'var(--radius-card)',
          background: 'var(--bg-secondary)', border: '1px solid var(--border)',
        }}>
          <div style={{ fontSize: 12, color: 'var(--muted)', fontWeight: 600, marginBottom: 8 }}>
            УКАЖИТЕ СОСТОЯНИЕ ЕДИНИЦ
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {snapshot.items.map(it => (
              <ItemRow
                key={it.unit_id}
                item={it}
                condition={conditions[it.unit_id]}
                onSetCondition={(c) => setCondition(it.unit_id, c)}
                onOpen={() => setCardId(it.unit_id)}
              />
            ))}
          </div>
        </div>

        <textarea
          placeholder="Примечания по состоянию (опционально)"
          value={conditionNotes}
          onChange={e => setConditionNotes(e.target.value)}
          rows={2}
          style={{
            width: '100%', padding: 10, fontSize: 13, marginBottom: 16,
            border: '1px solid var(--border)', borderRadius: 'var(--radius-btn)',
            background: 'var(--white)', outline: 'none', fontFamily: 'inherit',
            resize: 'vertical',
          }}
        />

        <div style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 13, fontWeight: 500, marginBottom: 8 }}>Штамп склада</div>
          <button
            onClick={() => setStamped(s => !s)}
            style={{
              width: '100%', height: 56, borderRadius: 'var(--radius-card)',
              border: stamped ? '2px solid var(--gold-500, #C9A55C)' : '1px dashed var(--border)',
              background: stamped ? 'var(--gold-100, #FFF7E0)' : 'var(--white)',
              cursor: 'pointer', fontSize: 13,
              color: stamped ? 'var(--gold-600, #C9A55C)' : 'var(--muted)',
              fontWeight: stamped ? 600 : 400,
            }}
          >{stamped ? '✓ Штамп проставлен' : 'Нажмите чтобы поставить штамп'}</button>
        </div>

        {error && (
          <div style={{ color: 'var(--red)', fontSize: 13, textAlign: 'center', marginBottom: 12 }}>{error}</div>
        )}

        <Button
          fullWidth
          loading={submitting}
          disabled={!canSubmit}
          onClick={handleSubmit}
        >Принять {chosenIds.length} {chosenIds.length === 1 ? 'единицу' : 'ед.'}</Button>
      </div>
      {cardId && <UnitCardModal unitId={cardId} onClose={() => setCardId(null)} />}
    </WarehouseLayout>
  )
}

function ItemRow({ item, condition, onSetCondition, onOpen }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'flex-start', gap: 10, padding: 10,
      borderRadius: 8, background: 'var(--white)', border: '1px solid var(--border)',
    }}>
      <button
        type="button"
        onClick={onOpen}
        style={{
        width: 44, height: 44, borderRadius: 6, overflow: 'hidden',
        background: 'var(--bg-secondary)', flexShrink: 0,
        border: 'none', padding: 0, cursor: 'pointer',
      }}>
        {item.photo_url && <img src={item.photo_url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />}
      </button>
      <div style={{ flex: 1, minWidth: 0 }}>
        <button
          type="button"
          onClick={onOpen}
          style={{
            display: 'block', width: '100%', background: 'none', border: 'none', padding: 0,
            font: 'inherit', color: 'inherit', cursor: 'pointer', textAlign: 'left',
            fontWeight: 500, fontSize: 14, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}
        >
          {item.name}
        </button>
        <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 6 }}>
          {item.serial} · ×{item.qty}
        </div>
        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
          {CONDITIONS.map(c => (
            <button
              key={c.value}
              onClick={() => onSetCondition(c.value)}
              style={{
                padding: '4px 8px', fontSize: 11,
                borderRadius: 4, cursor: 'pointer',
                border: `1px solid ${condition === c.value ? c.color : 'var(--border)'}`,
                background: condition === c.value ? c.color : 'var(--white)',
                color: condition === c.value ? '#fff' : 'var(--text)',
                fontWeight: condition === c.value ? 600 : 400,
              }}
            >{c.label}</button>
          ))}
        </div>
      </div>
    </div>
  )
}
