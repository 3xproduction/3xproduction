// «Поступления» — информационный экран последних единиц, попавших на склад.
// Приём без согласования отключён: единица сразу числится на складе, поэтому здесь
// нет кнопок «Подписать»/«Отклонить»/«Цена» — только просмотр карточек.

import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { Package } from 'lucide-react'
import WarehouseLayout from './WarehouseLayout'
import Button from '../shared/Button'
import { units as unitsApi } from '../../services/api'
import { categoryLabel } from '../../constants/categories'

const css = `
.apr-page { padding: 28px 32px; max-width: 900px; }
.apr-title { font-size: 22px; font-weight: 600; letter-spacing: -0.03em; margin-bottom: 2px; }
.apr-sub { color: var(--muted); font-size: 13px; margin-bottom: 24px; }
.apr-list { display: flex; flex-direction: column; gap: 10px; }
.apr-item {
  background: var(--card); border: 1px solid var(--border);
  border-radius: var(--radius-card); padding: 14px 18px;
  box-shadow: var(--shadow-sm); display: flex; align-items: center; gap: 14px;
}
.apr-photo {
  width: 48px; height: 48px; border-radius: 10px; overflow: hidden; flex-shrink: 0;
  background: var(--bg); display: flex; align-items: center; justify-content: center; color: var(--muted);
}
.apr-unit-name { font-weight: 600; font-size: 14px; }
.apr-unit-meta { font-size: 12px; color: var(--muted); margin-top: 2px; }
.apr-empty { color: var(--muted); font-size: 14px; padding: 60px 0; text-align: center; }

@media (max-width: 768px) {
  .apr-page { padding: 16px; }
  .apr-title { font-size: 18px; }
  .apr-item { padding: 12px 14px; }
}
`

function formatDate(str) {
  if (!str) return ''
  return new Date(str).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', year: 'numeric' })
}

export default function ApprovalsPage() {
  const navigate = useNavigate()
  const [units, setUnits] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    unitsApi.list({})
      .then(d => setUnits((d.units || []).slice(0, 50)))
      .finally(() => setLoading(false))
  }, [])

  return (
    <WarehouseLayout>
      <style>{css}</style>
      <div className="apr-page">
        <h1 className="apr-title">Поступления</h1>
        <p className="apr-sub">
          {loading ? '...' : `Последние единицы на складе · ${units.length}`}
        </p>

        {loading ? (
          <div className="apr-empty">Загрузка...</div>
        ) : units.length === 0 ? (
          <div className="apr-empty">Пока нет поступлений</div>
        ) : (
          <div className="apr-list">
            {units.map(u => (
              <div key={u.id} className="apr-item">
                <div className="apr-photo">
                  {u.photo_url
                    ? <img src={u.photo_url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                    : <Package size={20} strokeWidth={1.8} />}
                </div>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div className="apr-unit-name" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {u.name}
                  </div>
                  <div className="apr-unit-meta">
                    {categoryLabel(u.category)}
                    {u.warehouse_name ? ` · ${u.warehouse_name}` : ''}
                    {u.cell_custom || u.cell_code ? ` · ${u.cell_custom || u.cell_code}` : ''}
                    {' · '}{formatDate(u.created_at)}
                  </div>
                </div>
                <Button
                  variant="secondary"
                  style={{ height: 34, fontSize: 13 }}
                  onClick={() => navigate(`/units/${u.id}`)}
                >
                  Карточка
                </Button>
              </div>
            ))}
          </div>
        )}
      </div>
    </WarehouseLayout>
  )
}
