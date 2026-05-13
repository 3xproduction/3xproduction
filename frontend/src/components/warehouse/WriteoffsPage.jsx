// «Списания» — журнал списанных единиц. Показывается как вкладка в «Аналитика»
// (у директора склада и продюсера). Сама страница открывается и в warehouse, и в
// production layout — выбирается по роли.

import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { ChevronLeft } from 'lucide-react'
import WarehouseLayout from './WarehouseLayout'
import ProductionLayout from '../production/ProductionLayout'
import Badge from '../shared/Badge'
import UnitCardModal from '../shared/UnitCardModal'
import { writeoffs as writeoffsApi } from '../../services/api'
import { useAuth } from '../../hooks/useAuth'
import { ROLES } from '../../constants/roles'
import { categoryLabel } from '../../constants/categories'

const SOURCE_LABEL = { issue: 'Заявка', rent: 'Аренда', public: 'Партнёрская', project: 'Склад проекта', direct: 'Прямое' }
const KIND_LABEL   = { writeoff: 'Списано', debt: 'В долг' }
const KIND_COLOR   = { writeoff: 'red', debt: 'amber' }

function formatDate(s) {
  if (!s) return ''
  return new Date(s).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', year: 'numeric' })
}

export default function WriteoffsPage() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const Layout = ROLES[user?.role]?.world === 'production' ? ProductionLayout : WarehouseLayout
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [openWriteoff, setOpenWriteoff] = useState(null)

  useEffect(() => {
    writeoffsApi.list()
      // «Списания» — только kind=writeoff. Долги (kind=debt) живут отдельно
      // в таблице `debts` и показываются на странице «Долги».
      .then(d => setItems((d.writeoffs || []).filter(w => w.kind === 'writeoff')))
      .finally(() => setLoading(false))
  }, [])

  return (
    <Layout>
      <style>{`
        @media (max-width: 768px) {
          .writeoffs-page { padding: 16px !important; }
          .writeoffs-sticky {
            position: sticky; top: var(--page-sticky-top, 52px); z-index: 12;
            background: var(--paper);
            margin: -16px -16px 14px;
            padding: 12px 16px;
          }
        }
      `}</style>
      <div className="writeoffs-page" style={{ padding: '28px 32px', maxWidth: 900 }}>
        <div className="writeoffs-sticky">
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <button className="page-back" onClick={() => navigate(-1)} aria-label="Назад">
              <ChevronLeft size={20} />
            </button>
            <div>
              <h1 style={{ fontSize: 22, fontWeight: 600, marginBottom: 2 }}>Списания</h1>
              <p style={{ color: 'var(--muted)', fontSize: 13, margin: 0 }}>
                {loading ? '...' : `Всего записей: ${items.length}`}
              </p>
            </div>
          </div>
        </div>

        {loading ? (
          <div style={{ padding: 40, textAlign: 'center', color: 'var(--muted)' }}>Загрузка...</div>
        ) : items.length === 0 ? (
          <div style={{ padding: 40, textAlign: 'center', color: 'var(--muted)' }}>Пока нет списаний</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {items.map(w => (
              <div key={w.id} style={{
                background: 'var(--white)', border: '1px solid var(--border)', borderRadius: 10,
                padding: 12, display: 'flex', alignItems: 'center', gap: 12, cursor: 'pointer',
              }}
              onClick={() => setOpenWriteoff(w)}>
                <Badge color={KIND_COLOR[w.kind] || 'muted'}>{KIND_LABEL[w.kind] || w.kind}</Badge>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13.5, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {w.unit_name}
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--muted)' }}>
                    {categoryLabel(w.unit_category)} · {SOURCE_LABEL[w.source] || w.source}
                    {w.project_name ? ` · ${w.project_name}` : ''}
                    {' · '}{formatDate(w.created_at)}
                    {w.created_by_name ? ` · ${w.created_by_name}` : ''}
                  </div>
                  {w.reason && (
                    <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 4, fontStyle: 'italic' }}>
                      «{w.reason}»
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {openWriteoff && openWriteoff.unit_id && (
        <UnitCardModal
          unitId={openWriteoff.unit_id}
          writeoff={openWriteoff}
          onClose={() => setOpenWriteoff(null)}
        />
      )}
    </Layout>
  )
}
