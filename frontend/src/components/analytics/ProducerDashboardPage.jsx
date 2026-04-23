import { useState, useEffect } from 'react'
import ProductionLayout from '../production/ProductionLayout'
import { categoryLabel } from '../../constants/categories'
import { analytics, projects as projectsApi, rent as rentApi, debts as debtsApi, writeoffs as writeoffsApi } from '../../services/api'

export default function ProducerDashboardPage() {
  const [data, setData] = useState(null)
  const [warehouseData, setWarehouseData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [projectList, setProjectList] = useState([])
  const [selectedProject, setSelectedProject] = useState('')
  const [rentDeals, setRentDeals] = useState([])
  const [notReturned, setNotReturned] = useState({ total: 0, debts: 0, writeoffs: 0 })

  useEffect(() => {
    projectsApi.list().then(d => setProjectList(d.projects || [])).catch(() => {})
    rentApi.list().then(d => setRentDeals(d.deals || [])).catch(() => {})
    analytics.warehouse().then(setWarehouseData).catch(() => {})
    Promise.all([
      debtsApi.list('open').then(d => (d.debts || []).length).catch(() => 0),
      writeoffsApi.list().then(d => {
        const ws = d.writeoffs || []
        return {
          writeoffs: ws.filter(w => w.kind === 'writeoff').length,
          legacyDebts: ws.filter(w => w.kind === 'debt').length,
        }
      }).catch(() => ({ writeoffs: 0, legacyDebts: 0 })),
    ]).then(([debts, w]) => {
      const totalDebts = debts + w.legacyDebts
      setNotReturned({ debts: totalDebts, writeoffs: w.writeoffs, total: totalDebts + w.writeoffs })
    })
  }, [])

  useEffect(() => {
    setLoading(true)
    analytics.producer(selectedProject || undefined).then(setData).catch(() => {}).finally(() => setLoading(false))
  }, [selectedProject])

  if (loading) {
    return <ProductionLayout><div style={{ padding: '24px 32px', color: 'var(--muted)', fontSize: 14 }}>Загрузка аналитики...</div></ProductionLayout>
  }

  const budgetByCat   = data?.budget_by_category || []
  const topUsers      = data?.top_users           || []
  const assetVal      = data?.asset_valuation     || {}

  const byCategory   = warehouseData?.by_category  || []
  const topRequested = warehouseData?.top_requested || []
  const maxCat = Math.max(...byCategory.map(c => Number(c.total)), 1)

  const totalBudget = budgetByCat.reduce((s, c) => s + Number(c.estimated_cost || 0), 0)
  const maxBudget = Math.max(...budgetByCat.map(c => Number(c.estimated_cost || 0)), 1)

  const activeDeals  = rentDeals.filter(d => d.status === 'active').length
  const overdueDeals = rentDeals.filter(d => d.status === 'overdue').length
  const rentRevenue  = rentDeals.filter(d => d.status !== 'cancelled').reduce((a, d) => a + (Number(d.price_total) || 0), 0)

  const COLORS = ['var(--blue)', 'var(--green)', 'var(--amber)', 'var(--red)', 'var(--muted)']

  return (
    <ProductionLayout>
      <div style={{ padding: '24px 32px', maxWidth: 1000 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 28, flexWrap: 'wrap', gap: 12 }}>
          <div>
            <h1 style={{ fontSize: 20, fontWeight: 600 }}>Аналитика компании</h1>
            <p style={{ fontSize: 13, color: 'var(--muted)', marginTop: 2 }}>
              {selectedProject ? projectList.find(p => p.id === selectedProject)?.name : 'Все проекты'}
            </p>
          </div>
          <select value={selectedProject} onChange={e => setSelectedProject(e.target.value)} style={{
            height: 36, padding: '0 12px', border: '1px solid var(--border)',
            borderRadius: 'var(--radius-btn)', fontSize: 13, background: 'var(--white)', cursor: 'pointer',
          }}>
            <option value="">Все проекты</option>
            {projectList.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </div>

        {/* Основные метрики */}
        <div className="resp-3-col" style={{ marginBottom: 20 }}>
          <StatCard label="Потрачено" value={totalBudget.toLocaleString('ru-RU') + ' ₽'} color="var(--blue)" />
          <StatCard label="Хранится" value={Number(assetVal.total_assets_value || 0).toLocaleString('ru-RU') + ' ₽'} color="var(--green)" />
          <StatCard label="Выдано"
            value={`${assetVal.issued_count || 0} ед.`}
            color="var(--amber)"
            tooltip={`Сумма: ${Number(assetVal.issued_assets_value || 0).toLocaleString('ru-RU')} ₽`} />
        </div>

        {/* Аренда */}
        <div className="resp-3-col" style={{ marginBottom: 28 }}>
          <StatCard label="Активные сделки" value={activeDeals} color="var(--blue)" />
          <StatCard label="Выручка с аренды" value={rentRevenue.toLocaleString('ru-RU') + ' ₽'} color="var(--green)" />
          <StatCard
            label="Просрочено"
            value={overdueDeals + notReturned.total}
            color="var(--red)"
            tooltip={`Аренда — ${overdueDeals} · Долги — ${notReturned.debts} · Списания — ${notReturned.writeoffs}`}
          />
        </div>

        <div className="resp-2-col" style={{ marginBottom: 20 }}>
          <Card title="Расходы по категориям">
            {budgetByCat.length === 0 && <Empty />}
            {budgetByCat.map((c, i) => {
              const pct = Math.round((Number(c.estimated_cost) / totalBudget) * 100)
              return (
                <div key={c.category} style={{ marginBottom: 14 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, marginBottom: 5 }}>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                      <div style={{ width: 10, height: 10, borderRadius: 2, background: COLORS[i % COLORS.length], flexShrink: 0 }} />
                      {categoryLabel(c.category) || '—'}
                    </span>
                    <span style={{ fontWeight: 600 }}>{Number(c.estimated_cost || 0).toLocaleString('ru-RU')} ₽</span>
                  </div>
                  <div style={{ height: 6, borderRadius: 3, background: 'var(--bg)', overflow: 'hidden' }}>
                    <div style={{ height: '100%', width: `${Math.round((Number(c.estimated_cost) / maxBudget) * 100)}%`, background: COLORS[i % COLORS.length], borderRadius: 3 }} />
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>{pct}%</div>
                </div>
              )
            })}
          </Card>

          <Card title="Самые активные сотрудники">
            {topUsers.length === 0 && <Empty />}
            {topUsers.slice(0, 5).map((u, i) => (
              <div key={u.id} style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                padding: '10px 0', borderBottom: i < 4 ? '1px solid var(--border)' : 'none',
              }}>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 500 }}>{u.name}</div>
                  <div style={{ fontSize: 11, color: 'var(--muted)' }}>{u.role}</div>
                </div>
                <div style={{ display: 'flex', gap: 8, fontSize: 12 }}>
                  <span style={{ color: 'var(--blue)', fontWeight: 600 }}>{u.issuances} выдач</span>
                  {Number(u.currently_holding) > 0 && (
                    <span style={{ color: 'var(--amber)' }}>держит {u.currently_holding}</span>
                  )}
                </div>
              </div>
            ))}
          </Card>
        </div>

        <div className="resp-2-col">
          <Card title="Топ категории">
            {byCategory.length === 0 && <Empty />}
            {byCategory.map(c => (
              <div key={c.category} style={{ marginBottom: 12 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, marginBottom: 5 }}>
                  <span>{categoryLabel(c.category) || '—'}</span>
                  <span style={{ fontWeight: 500 }}>{c.total} ед.</span>
                </div>
                <div style={{ height: 6, borderRadius: 3, background: 'var(--bg)', overflow: 'hidden' }}>
                  <div style={{ height: '100%', width: `${Math.round((Number(c.total) / maxCat) * 100)}%`, background: 'var(--blue)', borderRadius: 3 }} />
                </div>
              </div>
            ))}
          </Card>

          <Card title="Популярно на складе">
            {topRequested.length === 0 && <Empty />}
            {topRequested.slice(0, 5).map((u, i) => (
              <div key={u.id} style={{
                display: 'flex', alignItems: 'center', gap: 12,
                padding: '9px 0', borderBottom: i < 4 ? '1px solid var(--border)' : 'none',
              }}>
                <div style={{
                  width: 24, height: 24, borderRadius: 6, flexShrink: 0,
                  background: i === 0 ? 'var(--amber-dim)' : 'var(--bg)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 12, fontWeight: 700, color: i === 0 ? 'var(--amber)' : 'var(--muted)',
                }}>{i + 1}</div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 13, fontWeight: 500 }}>{u.name}</div>
                  <div style={{ fontSize: 11, color: 'var(--muted)' }}>{categoryLabel(u.category)}</div>
                </div>
                <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--blue)' }}>{u.request_count}×</div>
              </div>
            ))}
          </Card>
        </div>
      </div>
    </ProductionLayout>
  )
}

function StatCard({ label, value, color, tooltip }) {
  return (
    <div style={{
      background: 'var(--white)', border: '1px solid var(--border)',
      borderRadius: 'var(--radius-card)', padding: '18px',
      position: 'relative',
    }}
    onMouseEnter={e => {
      if (!tooltip) return
      const tip = e.currentTarget.querySelector('.pd-stat-tip')
      if (tip) tip.style.opacity = '1'
    }}
    onMouseLeave={e => {
      if (!tooltip) return
      const tip = e.currentTarget.querySelector('.pd-stat-tip')
      if (tip) tip.style.opacity = '0'
    }}>
      <div style={{ fontSize: 22, fontWeight: 700, color }}>{value}</div>
      <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 4 }}>{label}</div>
      {tooltip && (
        <div className="pd-stat-tip" style={{
          position: 'absolute', bottom: 'calc(100% + 6px)', left: '50%', transform: 'translateX(-50%)',
          background: '#1a1a1a', color: '#fff', fontSize: 12, padding: '8px 12px', borderRadius: 8,
          whiteSpace: 'nowrap', opacity: 0, transition: 'opacity 0.15s', pointerEvents: 'none',
          boxShadow: '0 4px 12px rgba(0,0,0,0.15)', zIndex: 20, fontWeight: 500,
        }}>
          {tooltip}
        </div>
      )}
    </div>
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
