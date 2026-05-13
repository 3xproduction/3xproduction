import { useState, useEffect } from 'react'
import WarehouseLayout from '../warehouse/WarehouseLayout'
import { categoryLabel } from '../../constants/categories'
import { analytics } from '../../services/api'

export default function WarehouseAnalyticsPage() {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    analytics.warehouse().then(setData).catch(() => {}).finally(() => setLoading(false))
  }, [])

  if (loading) {
    return <WarehouseLayout><div style={{ padding: '24px 32px', color: 'var(--muted)', fontSize: 14 }}>Загрузка аналитики...</div></WarehouseLayout>
  }

  const totals = data?.totals || {}
  const assetVal = data?.asset_valuation || {}
  const dynamics = data?.issuance_dynamics || []
  const idleUnits = data?.idle_units || []

  const maxDyn = Math.max(...dynamics.map(d => Number(d.issuances)), 1)

  const MOVEMENT = [
    { label: 'На складе',  value: Number(totals.on_stock)   || 0, color: 'var(--green)',  bg: 'var(--green-dim)' },
    { label: 'Выдано',     value: Number(totals.issued)     || 0, color: 'var(--blue)',   bg: 'var(--blue-dim)' },
    { label: 'Просрочено', value: Number(totals.overdue)    || 0, color: 'var(--red)',    bg: 'var(--red-dim)' },
    { label: 'В ожидании', value: Number(totals.pending)    || 0, color: 'var(--amber)',  bg: 'var(--amber-dim)' },
  ]

  return (
    <WarehouseLayout>
      <style>{`
        @media (max-width: 768px) {
          .wa-page { padding: 16px !important; }
          .wa-stats { grid-template-columns: repeat(2,1fr) !important; gap: 10px !important; }
          .wa-cards { grid-template-columns: 1fr !important; }
          .wa-stat-val { font-size: 22px !important; }
        }
      `}</style>
      <div className="wa-page" style={{ padding: '24px 32px', maxWidth: 1000 }}>
        <div style={{ marginBottom: 28 }}>
          <h1 style={{ fontSize: 20, fontWeight: 600 }}>Аналитика склада</h1>
          <p style={{ fontSize: 13, color: 'var(--muted)', marginTop: 2 }}>Все данные</p>
        </div>

        <div className="wa-stats" style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 14, marginBottom: 28 }}>
          {MOVEMENT.map(m => (
            <div key={m.label} style={{
              background: 'var(--white)', border: '1px solid var(--border)',
              borderRadius: 'var(--radius-card)', padding: '18px',
            }}>
              <div className="wa-stat-val" style={{ fontSize: 28, fontWeight: 700, color: m.color }}>{m.value}</div>
              <div style={{ fontSize: 13, color: 'var(--muted)', marginTop: 4 }}>{m.label}</div>
            </div>
          ))}
        </div>

        <div className="wa-stats" style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 14, marginBottom: 28 }}>
          <div style={{ background: 'var(--white)', border: '1px solid var(--border)', borderRadius: 'var(--radius-card)', padding: '18px' }}>
            <div className="wa-stat-val" style={{ fontSize: 22, fontWeight: 700, color: 'var(--blue)' }}>{Number(assetVal.total_assets_value || 0).toLocaleString('ru-RU')} ₽</div>
            <div style={{ fontSize: 13, color: 'var(--muted)', marginTop: 4 }}>Стоимость активов</div>
          </div>
          <div style={{ background: 'var(--white)', border: '1px solid var(--border)', borderRadius: 'var(--radius-card)', padding: '18px' }}>
            <div className="wa-stat-val" style={{ fontSize: 22, fontWeight: 700, color: 'var(--amber)' }}>{Number(assetVal.issued_assets_value || 0).toLocaleString('ru-RU')} ₽</div>
            <div style={{ fontSize: 13, color: 'var(--muted)', marginTop: 4 }}>Сумма выданных активов</div>
          </div>
        </div>

        <div className="wa-cards" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
          <Card title="Динамика по месяцам">
            {dynamics.length === 0 && <Empty />}
            <div style={{ display: 'flex', alignItems: 'flex-end', gap: 8, height: 120, marginBottom: 8 }}>
              {dynamics.map(m => (
                <div key={m.month} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, height: '100%', justifyContent: 'flex-end' }}>
                  <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: 2, alignItems: 'center' }}>
                    <div style={{
                      width: '60%', height: Math.round((Number(m.returns) / maxDyn) * 100),
                      background: 'var(--green-dim)', borderRadius: '3px 3px 0 0',
                      border: '1px solid rgba(22,163,74,0.2)', minHeight: 4,
                    }} />
                    <div style={{
                      width: '100%', height: Math.round((Number(m.issuances) / maxDyn) * 100),
                      background: 'var(--blue-dim)', borderRadius: '3px 3px 0 0',
                      border: '1px solid rgba(30,157,218,0.2)', minHeight: 4,
                    }} />
                  </div>
                  <div style={{ fontSize: 10, color: 'var(--muted)' }}>{m.month?.slice(5) || ''}</div>
                </div>
              ))}
            </div>
            <div style={{ display: 'flex', gap: 16 }}>
              <LegendDot color="var(--blue)" label="Выдано" />
              <LegendDot color="var(--green)" label="Возвращено" />
            </div>
          </Card>

          <Card title="Не выдавались более 3 мес.">
            {idleUnits.length === 0 && <Empty />}
            {idleUnits.slice(0, 5).map((u, i) => (
              <div key={u.id} style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                padding: '10px 0', borderBottom: i < 4 ? '1px solid var(--border)' : 'none',
              }}>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 500 }}>{u.name}</div>
                  <div style={{ fontSize: 11, color: 'var(--muted)' }}>{categoryLabel(u.category)}</div>
                </div>
                <span style={{
                  fontSize: 12, padding: '2px 10px', borderRadius: 'var(--radius-badge)',
                  background: 'var(--amber-dim)', color: 'var(--amber)', fontWeight: 500,
                }}>
                  {u.last_movement ? new Date(u.last_movement).toLocaleDateString('ru-RU') : 'Никогда'}
                </span>
              </div>
            ))}
          </Card>
        </div>
      </div>
    </WarehouseLayout>
  )
}

function Card({ title, children }) {
  return (
    <div style={{ background: 'var(--white)', border: '1px solid var(--border)', borderRadius: 'var(--radius-card)', padding: '20px' }}>
      <div style={{ fontWeight: 600, fontSize: 15, marginBottom: 16 }}>{title}</div>
      {children}
    </div>
  )
}

function Empty() {
  return <div style={{ color: 'var(--muted)', fontSize: 13, padding: '12px 0' }}>Нет данных</div>
}

function LegendDot({ color, label }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--muted)' }}>
      <div style={{ width: 10, height: 10, borderRadius: 2, background: color }} />
      {label}
    </div>
  )
}
