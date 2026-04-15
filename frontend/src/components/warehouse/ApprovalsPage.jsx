import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { CheckCircle, XCircle, Package, Edit3 } from 'lucide-react'
import WarehouseLayout from './WarehouseLayout'
import Button from '../shared/Button'
import Badge from '../shared/Badge'
import { units as unitsApi } from '../../services/api'
import { categoryLabel } from '../../constants/categories'
import { useAuth } from '../../hooks/useAuth'
import { useToast } from '../shared/Toast'

const css = `
.apr-page { padding: 28px 32px; max-width: 900px; }
.apr-title { font-size: 22px; font-weight: 600; letter-spacing: -0.03em; margin-bottom: 2px; }
.apr-sub { color: var(--muted); font-size: 13px; margin-bottom: 24px; }
.apr-list { display: flex; flex-direction: column; gap: 10px; }
.apr-item {
  background: var(--card); border: 1px solid var(--border);
  border-radius: var(--radius-card); padding: 18px 20px;
  box-shadow: var(--shadow-sm);
}
.apr-item-top { display: flex; align-items: center; gap: 12px; margin-bottom: 10px; }
.apr-icon {
  width: 38px; height: 38px; border-radius: 10px;
  display: flex; align-items: center; justify-content: center;
  flex-shrink: 0;
}
.apr-icon-add  { background: var(--blue-dim);   color: var(--blue); }
.apr-icon-edit { background: var(--amber-dim);  color: var(--amber); }
.apr-unit-name { font-weight: 600; font-size: 14px; }
.apr-unit-meta { font-size: 12px; color: var(--muted); margin-top: 2px; }
.apr-by { font-size: 12px; color: var(--muted); margin-left: auto; text-align: right; flex-shrink: 0; }
.apr-new-data {
  background: var(--bg); border-radius: 8px; padding: 10px 14px;
  margin-bottom: 12px; display: flex; flex-wrap: wrap; gap: 10px;
}
.apr-data-field { font-size: 12px; }
.apr-data-label { color: var(--muted); margin-right: 4px; }
.apr-data-value { font-weight: 500; }
.apr-actions { display: flex; gap: 8px; }
.apr-empty { color: var(--muted); font-size: 14px; padding: 60px 0; text-align: center; }
.apr-reject-input {
  width: 100%; padding: 8px 12px; border: 1px solid var(--border);
  border-radius: var(--radius-input); font-size: 13px;
  margin-bottom: 8px; background: var(--white); color: var(--text);
}

@media (max-width: 768px) {
  .apr-page { padding: 16px; }
  .apr-title { font-size: 18px; }
  .apr-item { padding: 14px 16px; }
  .apr-item-top { flex-wrap: wrap; }
  .apr-by { margin-left: 0; text-align: left; }
  .apr-actions .btn { flex: 1; }
}
`

function formatDate(str) {
  if (!str) return ''
  return new Date(str).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', year: 'numeric' })
}

const ACTION_LABEL = { add: 'Новая единица', edit: 'Изменение карточки' }

export default function ApprovalsPage() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [processing, setProcessing] = useState(null)
  const [rejectId, setRejectId] = useState(null)
  const [rejectReason, setRejectReason] = useState('')
  const [approvedMsg, setApprovedMsg] = useState(false)
  const [valuations, setValuations] = useState({})

  const toast = useToast()
  const isDirector = ['warehouse_director', 'warehouse_deputy'].includes(user?.role)

  function load() {
    setLoading(true)
    unitsApi.approvals()
      .then(data => {
        const list = data.approvals || []
        setItems(list)
        // Prefill valuations from new_data if unit had price when added
        const prefill = {}
        for (const item of list) {
          if (item.action === 'add' && item.new_data?.valuation && !valuations[item.approval_id]) {
            prefill[item.approval_id] = String(item.new_data.valuation)
          }
        }
        if (Object.keys(prefill).length) setValuations(v => ({ ...prefill, ...v }))
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }

  useEffect(() => { load() }, [])

  async function approve(item) {
    if (item.action === 'add' && !valuations[item.approval_id]) {
      toast?.('Укажите стоимость единицы', 'error')
      return
    }
    setProcessing(item.approval_id)
    try {
      await unitsApi.approve(item.unit_id, item.approval_id, valuations[item.approval_id])
      setApprovedMsg(true)
      setTimeout(() => setApprovedMsg(false), 2500)
      load()
    } catch (e) { alert(e.message) }
    finally { setProcessing(null) }
  }

  async function reject(item) {
    if (!rejectReason.trim()) return
    setProcessing(item.approval_id)
    try {
      await unitsApi.reject(item.unit_id, item.approval_id, rejectReason)
      setRejectId(null)
      setRejectReason('')
      load()
    } catch (e) { alert(e.message) }
    finally { setProcessing(null) }
  }

  return (
    <WarehouseLayout>
      <style>{css}</style>
      <div className="apr-page">
        <h1 className="apr-title">Принять на склад</h1>
        <p className="apr-sub">
          {loading ? '...' : `${items.length} ${items.length === 1 ? 'запрос' : 'запросов'} ожидают подписи`}
        </p>

        {approvedMsg && (
          <div style={{ background: 'var(--green-dim)', border: '1px solid rgba(22,163,74,0.2)', borderRadius: 'var(--radius-card)', padding: '10px 16px', fontSize: 13, marginBottom: 16, fontWeight: 500, color: 'var(--green)' }}>
            ✓ Подписано
          </div>
        )}

        {loading ? (
          <div className="apr-empty">Загрузка...</div>
        ) : items.length === 0 ? (
          <div className="apr-empty">Нет заявок на утверждение</div>
        ) : (
          <div className="apr-list">
            {items.map(item => (
              <div key={item.approval_id} className="apr-item">
                <div className="apr-item-top">
                  <div className={`apr-icon ${item.action === 'add' ? 'apr-icon-add' : 'apr-icon-edit'}`}>
                    {item.action === 'add'
                      ? <Package size={18} strokeWidth={1.8} />
                      : <Edit3 size={18} strokeWidth={1.8} />}
                  </div>
                  <div>
                    <div className="apr-unit-name">{item.unit_name}</div>
                    <div className="apr-unit-meta">{categoryLabel(item.category)} · {ACTION_LABEL[item.action]}</div>
                  </div>
                  <div className="apr-by">
                    <div style={{ fontWeight: 500 }}>{item.proposed_by_name}</div>
                    <div>{formatDate(item.created_at)}</div>
                  </div>
                </div>

                {item.action === 'edit' && item.new_data && (
                  <div className="apr-new-data">
                    {Object.entries(item.new_data).map(([k, v]) => v ? (
                      <div key={k} className="apr-data-field">
                        <span className="apr-data-label">{k}:</span>
                        <span className="apr-data-value">{String(v)}</span>
                      </div>
                    ) : null)}
                  </div>
                )}

                {item.action === 'add' && isDirector && (
                  <div style={{ marginBottom: 12 }}>
                    <div style={{ fontSize: 12, fontWeight: 500, marginBottom: 4, color: 'var(--text)' }}>Стоимость единицы (обязательно)</div>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      placeholder="Стоимость, ₽"
                      value={valuations[item.approval_id] || ''}
                      onChange={e => setValuations(v => ({ ...v, [item.approval_id]: e.target.value }))}
                      className="apr-reject-input"
                    />
                  </div>
                )}

                {rejectId === item.approval_id && (
                  <div>
                    <input
                      className="apr-reject-input"
                      placeholder="Причина отклонения..."
                      value={rejectReason}
                      onChange={e => setRejectReason(e.target.value)}
                      autoFocus
                    />
                  </div>
                )}

                <div className="apr-actions">
                  <Button
                    variant="secondary"
                    style={{ height: 34, fontSize: 13 }}
                    onClick={() => navigate(`/units/${item.unit_id}`)}
                  >
                    Карточка
                  </Button>

                  {isDirector && rejectId !== item.approval_id && (
                    <>
                      <Button
                        variant="primary"
                        style={{ height: 34, fontSize: 13 }}
                        loading={processing === item.approval_id}
                        onClick={() => approve(item)}
                      >
                        <CheckCircle size={14} />
                        Подписать
                      </Button>
                      <Button
                        variant="danger"
                        style={{ height: 34, fontSize: 13 }}
                        onClick={() => { setRejectId(item.approval_id); setRejectReason('') }}
                      >
                        <XCircle size={14} />
                        Отклонить
                      </Button>
                    </>
                  )}

                  {isDirector && rejectId === item.approval_id && (
                    <>
                      <Button
                        variant="danger"
                        style={{ height: 34, fontSize: 13 }}
                        loading={processing === item.approval_id}
                        onClick={() => reject(item)}
                      >
                        Отклонить
                      </Button>
                      <Button
                        variant="secondary"
                        style={{ height: 34, fontSize: 13 }}
                        onClick={() => setRejectId(null)}
                      >
                        Отмена
                      </Button>
                    </>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </WarehouseLayout>
  )
}
