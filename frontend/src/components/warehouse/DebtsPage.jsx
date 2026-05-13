import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { Package, Archive, ChevronLeft } from 'lucide-react'
import WarehouseLayout from './WarehouseLayout'
import ProductionLayout from '../production/ProductionLayout'
import Badge from '../shared/Badge'
import Button from '../shared/Button'
import ConfirmModal from '../shared/ConfirmModal'
import UnitCardModal from '../shared/UnitCardModal'
import { useToast } from '../shared/Toast'
import { debts as debtsApi, writeoffs as writeoffsApi } from '../../services/api'
import { useAuth } from '../../hooks/useAuth'
import { ROLES } from '../../constants/roles'

const FILTERS = [
  { value: '', label: 'Все' },
  { value: 'open', label: 'Открытые' },
  { value: 'closed', label: 'Закрытые' },
]

function formatDate(str) {
  if (!str) return '—'
  return new Date(str).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', year: 'numeric' })
}

export default function DebtsPage() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const toast = useToast()
  const canClose = ['warehouse_director', 'warehouse_deputy', 'producer'].includes(user?.role)
  const canWriteoff = ['warehouse_director', 'warehouse_deputy', 'producer'].includes(user?.role)
  // Выбор layout по миру пользователя — продюсер открывает страницу в production-сайдбаре.
  const Layout = ROLES[user?.role]?.world === 'production' ? ProductionLayout : WarehouseLayout
  const [filter, setFilter] = useState('open')
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [writeoffTarget, setWriteoffTarget] = useState(null)
  const [openDebt, setOpenDebt] = useState(null)
  // Цель для модалки выбора «Вернуть на склад / Списать».
  const [closeTarget, setCloseTarget] = useState(null)
  const [closing, setClosing] = useState(false)

  function load(status) {
    setLoading(true)
    // Мерджим два источника: таблицу debts (основной) и writeoffs с kind=debt
    // (legacy / проектные долги, где нет индивидуального user_id).
    Promise.all([
      debtsApi.list(status).then(d => d.debts || []).catch(() => []),
      writeoffsApi.list().then(d => (d.writeoffs || []).filter(w => w.kind === 'debt')).catch(() => []),
    ]).then(([debts, legacyDebts]) => {
      const legacy = legacyDebts.map(w => ({
        id: 'w_' + w.id,
        unit_id: w.unit_id,
        unit_name: w.unit_name,
        user_name: w.created_by_name || '—',
        project_name: w.project_name,
        reason: w.reason,
        created_at: w.created_at,
        status: 'open',
        _legacy: true,
      }))
      let merged = [...debts, ...legacy]
      if (status === 'open') merged = merged.filter(d => d.status === 'open')
      if (status === 'closed') merged = merged.filter(d => d.status === 'closed')
      merged.sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
      setItems(merged)
    }).finally(() => setLoading(false))
  }

  useEffect(() => { load(filter) }, [filter])

  async function handleWriteoff() {
    if (!writeoffTarget) return
    try {
      if (writeoffTarget._legacy) {
        const rawId = String(writeoffTarget.id).replace(/^w_/, '')
        await writeoffsApi.convertToWriteoff(rawId)
      } else {
        await debtsApi.writeoff(writeoffTarget.id)
      }
      toast?.('Единица списана', 'success')
      setWriteoffTarget(null)
      load(filter)
    } catch (e) {
      toast?.(e.message || 'Ошибка', 'error')
    }
  }

  // Закрыть долг: 'return' — на склад, 'writeoff' — списать.
  async function handleCloseDebt(action) {
    if (!closeTarget) return
    setClosing(true)
    try {
      if (action === 'writeoff') {
        if (closeTarget._legacy) {
          const rawId = String(closeTarget.id).replace(/^w_/, '')
          await writeoffsApi.convertToWriteoff(rawId)
        } else {
          await debtsApi.writeoff(closeTarget.id)
        }
        toast?.('Единица списана', 'success')
      } else {
        await debtsApi.close(closeTarget.id)
        toast?.('Долг закрыт — единица на складе', 'success')
      }
      setCloseTarget(null)
      load(filter)
    } catch (e) {
      toast?.(e.message || 'Ошибка', 'error')
    }
    setClosing(false)
  }

  return (
    <Layout>
      <style>{`
        @media (max-width: 768px) {
          .debts-page { padding: 16px !important; }
          .debts-sticky {
            position: sticky; top: var(--page-sticky-top, 52px); z-index: 12;
            background: var(--paper);
            margin: -16px -16px 14px;
            padding: 12px 16px;
          }
          .debts-filters { overflow-x: auto; scrollbar-width: none; -webkit-overflow-scrolling: touch; }
          .debts-filters::-webkit-scrollbar { display: none; }
          .debts-filters > button { flex-shrink: 0; }
        }
      `}</style>
      <div className="debts-page" style={{ padding: '28px 32px', maxWidth: 900 }}>
        <div className="debts-sticky">
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <button className="page-back" onClick={() => navigate(-1)} aria-label="Назад">
              <ChevronLeft size={20} />
            </button>
            <div>
              <h1 style={{ fontSize: 22, fontWeight: 600, marginBottom: 2 }}>Долги</h1>
              <p style={{ color: 'var(--muted)', fontSize: 13, margin: 0 }}>
                Невозвращённое имущество
              </p>
            </div>
          </div>

          <div className="debts-filters" style={{ display: 'flex', gap: 6, marginTop: 12 }}>
          {FILTERS.map(f => (
            <button key={f.value} onClick={() => setFilter(f.value)} style={{
              padding: '6px 14px', borderRadius: 20, fontSize: 13, fontWeight: 500,
              border: `1px solid ${filter === f.value ? 'var(--accent)' : 'var(--border)'}`,
              background: filter === f.value ? 'var(--accent)' : 'var(--card)',
              color: filter === f.value ? '#fff' : 'var(--text)',
              cursor: 'pointer',
            }}>{f.label}</button>
          ))}
          </div>
        </div>

        {loading ? (
          <div style={{ color: 'var(--muted)', fontSize: 14, padding: '60px 0', textAlign: 'center' }}>Загрузка...</div>
        ) : items.length === 0 ? (
          <div style={{ color: 'var(--muted)', fontSize: 14, padding: '60px 0', textAlign: 'center' }}>Нет долгов</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {items.map(d => (
              <div key={d.id} style={{
                background: 'var(--card)', border: '1px solid var(--border)',
                borderRadius: 'var(--radius-card)', padding: '16px 20px',
                display: 'flex', alignItems: 'center', gap: 16,
                cursor: 'pointer',
              }}
              onClick={() => setOpenDebt(d)}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 600, fontSize: 14, display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                    {d.unit_name}
                    <Badge color={d.status === 'open' ? 'red' : 'green'}>
                      {d.status === 'open' ? 'Открыт' : 'Закрыт'}
                    </Badge>
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--muted)', display: 'flex', gap: 14, flexWrap: 'wrap' }}>
                    <span>{d.user_name}</span>
                    {d.project_name && <span>{d.project_name}</span>}
                    <span>{formatDate(d.created_at)}</span>
                    {d.reason && <span>{d.reason}</span>}
                  </div>
                </div>
                {d.status === 'open' && (canClose || canWriteoff) && (
                  <div style={{ display: 'flex', gap: 6, flexShrink: 0 }} onClick={e => e.stopPropagation()}>
                    {canClose && !d._legacy && (
                      <Button variant="secondary" style={{ height: 34, fontSize: 13 }}
                        onClick={() => setCloseTarget(d)}>
                        Закрыть долг
                      </Button>
                    )}
                    {canWriteoff && (
                      <Button variant="danger" style={{ height: 34, fontSize: 13 }}
                        onClick={() => setWriteoffTarget(d)}>
                        Списать
                      </Button>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      <ConfirmModal
        open={!!writeoffTarget}
        title="Списать единицу из долга"
        message={writeoffTarget
          ? `Единица «${writeoffTarget.unit_name}» будет списана безвозвратно. Долг закроется, запись появится в списаниях.`
          : ''}
        confirmLabel="Списать"
        cancelLabel="Отмена"
        onConfirm={handleWriteoff}
        onCancel={() => setWriteoffTarget(null)}
      />

      {openDebt && openDebt.unit_id && (
        <UnitCardModal
          unitId={openDebt.unit_id}
          debt={openDebt}
          onClose={() => setOpenDebt(null)}
          onCloseDebt={() => { setOpenDebt(null); load(filter) }}
        />
      )}

      {closeTarget && (
        <div style={{
          position: 'fixed', inset: 0,
          background: 'rgba(10,10,10,0.55)', backdropFilter: 'blur(3px)',
          zIndex: 700, display: 'flex', alignItems: 'center', justifyContent: 'center',
          padding: 20,
        }}
          onClick={e => { if (e.target === e.currentTarget && !closing) setCloseTarget(null) }}>
          <div onClick={e => e.stopPropagation()} style={{
            background: 'var(--card)', borderRadius: 14,
            padding: '22px 24px 20px', maxWidth: 420, width: '100%',
            boxShadow: '0 16px 48px rgba(0,0,0,0.25)',
          }}>
            <div style={{ fontWeight: 600, fontSize: 16, marginBottom: 6, letterSpacing: '-0.01em' }}>Закрыть долг</div>
            <div style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 18, lineHeight: 1.5 }}>
              Что сделать с единицей «{closeTarget.unit_name}»?
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 12 }}>
              <button onClick={() => handleCloseDebt('return')} disabled={closing} style={{
                display: 'flex', alignItems: 'center', gap: 12,
                padding: '12px 14px', borderRadius: 10,
                border: '1px solid rgba(92,107,63,0.4)',
                background: 'var(--green-dim)',
                color: 'var(--green)',
                textAlign: 'left', cursor: closing ? 'wait' : 'pointer',
                fontFamily: 'inherit',
              }}>
                <Package size={18} />
                <div>
                  <div style={{ fontSize: 14, fontWeight: 600 }}>Вернуть на склад</div>
                  <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2, fontWeight: 400 }}>Предмет возвращается в доступный фонд</div>
                </div>
              </button>
              <button onClick={() => handleCloseDebt('writeoff')} disabled={closing} style={{
                display: 'flex', alignItems: 'center', gap: 12,
                padding: '12px 14px', borderRadius: 10,
                border: '1px solid rgba(139,58,31,0.4)',
                background: 'var(--red-dim)',
                color: 'var(--red)',
                textAlign: 'left', cursor: closing ? 'wait' : 'pointer',
                fontFamily: 'inherit',
              }}>
                <Archive size={18} />
                <div>
                  <div style={{ fontSize: 14, fontWeight: 600 }}>Списать</div>
                  <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2, fontWeight: 400 }}>Единица помечается списанной безвозвратно</div>
                </div>
              </button>
            </div>
            <Button variant="secondary" fullWidth disabled={closing} onClick={() => setCloseTarget(null)}>
              Отмена
            </Button>
          </div>
        </div>
      )}
    </Layout>
  )
}
