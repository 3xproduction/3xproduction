// Пересорт — единицы, отмеченные «нет в наличии» при сборке заявки.
// Блюрятся и видны только директору/заму/продюсеру. Можно «Нашли» → вернуть на склад.

import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { Package, ChevronLeft } from 'lucide-react'
import WarehouseLayout from './WarehouseLayout'
import ProductionLayout from '../production/ProductionLayout'
import Badge from '../shared/Badge'
import Button from '../shared/Button'
import ConfirmModal from '../shared/ConfirmModal'
import { useToast } from '../shared/Toast'
import { units as unitsApi } from '../../services/api'
import { useAuth } from '../../hooks/useAuth'
import { ROLES } from '../../constants/roles'
import { categoryLabel } from '../../constants/categories'

function formatDate(str) {
  if (!str) return '—'
  return new Date(str).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', year: 'numeric' })
}

export default function MisplacedPage() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const toast = useToast()
  const canResolve = ['warehouse_director', 'warehouse_deputy', 'warehouse_staff'].includes(user?.role)
  const Layout = ROLES[user?.role]?.world === 'production' ? ProductionLayout : WarehouseLayout
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [resolveTarget, setResolveTarget] = useState(null)

  function load() {
    setLoading(true)
    unitsApi.list({ misplaced: 'true' })
      .then(d => setItems(d.units || []))
      .catch(() => setItems([]))
      .finally(() => setLoading(false))
  }
  useEffect(() => { load() }, [])

  async function handleResolve() {
    if (!resolveTarget) return
    try {
      await unitsApi.resolveMissing(resolveTarget.id)
      toast?.('Единица возвращена на склад', 'success')
      setResolveTarget(null)
      load()
    } catch (e) {
      toast?.(e.message || 'Ошибка', 'error')
    }
  }

  return (
    <Layout>
      <style>{`
        @media (max-width: 768px) {
          .misplaced-page { padding: 16px !important; }
          .misplaced-sticky {
            position: sticky; top: var(--page-sticky-top, 52px); z-index: 12;
            background: var(--paper);
            margin: -16px -16px 16px;
            padding: 12px 16px;
          }
        }
      `}</style>
      <div className="misplaced-page" style={{ padding: '28px 32px', maxWidth: 900 }}>
        <div className="misplaced-sticky">
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <button className="page-back" onClick={() => navigate(-1)} aria-label="Назад">
              <ChevronLeft size={20} />
            </button>
            <h1 style={{ fontSize: 22, fontWeight: 600, marginBottom: 2 }}>Пересорт</h1>
          </div>
          <p style={{ color: 'var(--muted)', fontSize: 13, margin: 0 }}>
            Единицы, не найденные при сборке заявки
          </p>
        </div>

        {loading ? (
          <div style={{ color: 'var(--muted)', fontSize: 14, padding: '60px 0', textAlign: 'center' }}>Загрузка...</div>
        ) : items.length === 0 ? (
          <div style={{ color: 'var(--muted)', fontSize: 14, padding: '60px 0', textAlign: 'center' }}>Пересорта нет</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {items.map(u => (
              <div key={u.id} style={{
                background: 'var(--card)', border: '1px solid var(--border)',
                borderRadius: 'var(--radius-card)', padding: '14px 18px',
                display: 'flex', alignItems: 'center', gap: 14,
                filter: 'grayscale(1)', opacity: 0.75,
              }}>
                <div style={{
                  width: 48, height: 48, borderRadius: 8, flexShrink: 0,
                  background: 'var(--bg)', border: '1px solid var(--border)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 20, overflow: 'hidden',
                }}>
                  {u.photo_url
                    ? <img src={u.photo_url} alt="" style={{ width: '100%', height: '100%', objectFit: 'contain', filter: 'blur(3px)' }} />
                    : <Package size={24} color="var(--subtle)" strokeWidth={1.4} />}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 600, fontSize: 14, display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4, textDecoration: 'line-through', color: 'var(--muted)' }}>
                    {u.name}
                    <Badge color="amber">Пересорт</Badge>
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--muted)', display: 'flex', gap: 14, flexWrap: 'wrap' }}>
                    {u.serial && <span>{u.serial}</span>}
                    <span>{categoryLabel(u.category)}</span>
                    {u.warehouse_name && <span>{u.warehouse_name}</span>}
                    <span>{formatDate(u.created_at)}</span>
                  </div>
                </div>
                {canResolve && (
                  <Button variant="secondary" style={{ height: 34, fontSize: 13, flexShrink: 0, filter: 'none' }}
                    onClick={() => setResolveTarget(u)}>
                    Нашли
                  </Button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      <ConfirmModal
        open={!!resolveTarget}
        title="Вернуть из пересорта"
        message={resolveTarget ? `Единица «${resolveTarget.name}» снова появится на складе.` : ''}
        confirmLabel="Вернуть"
        cancelLabel="Отмена"
        onConfirm={handleResolve}
        onCancel={() => setResolveTarget(null)}
      />
    </Layout>
  )
}
