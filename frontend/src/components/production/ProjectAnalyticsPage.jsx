import { useState, useEffect } from 'react'
import ProductionLayout from './ProductionLayout'
import { analytics as analyticsApi, projects as projectsApi } from '../../services/api'
import { useAuth } from '../../hooks/useAuth'

const SOURCE_COLORS = {
  kpp: { bg: 'var(--blue-dim)', color: 'var(--blue)', label: 'КПП' },
  scenario: { bg: 'var(--amber-dim)', color: 'var(--amber)', label: 'Сценарий' },
  ai: { bg: 'rgba(34,197,94,0.08)', color: '#16a34a', label: 'ИИ' },
  manual: { bg: 'var(--bg)', color: 'var(--muted)', label: 'Вручную' },
}

export default function ProjectAnalyticsPage() {
  const { user } = useAuth()
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [projectsList, setProjectsList] = useState([])
  const [selectedProjectId, setSelectedProjectId] = useState(user?.project_id || null)
  const isProducer = user?.role === 'producer'

  useEffect(() => {
    if (isProducer) {
      projectsApi.list().then(d => {
        const list = d.projects || []
        setProjectsList(list)
        const savedName = localStorage.getItem('project')
        const match = list.find(p => p.name === savedName)
        if (match) setSelectedProjectId(match.id)
        else if (list.length) setSelectedProjectId(list[0].id)
      }).catch(() => {})
    }
  }, [])

  useEffect(() => {
    if (!selectedProjectId) return
    setLoading(true)
    analyticsApi.project(selectedProjectId)
      .then(d => setData(d))
      .catch(() => setData(null))
      .finally(() => setLoading(false))
  }, [selectedProjectId])

  const totalItems = (data?.items_by_source || []).reduce((s, r) => s + parseInt(r.count), 0)
  const aiItems = (data?.items_by_source || []).find(r => r.source === 'ai')?.count || 0

  return (
    <ProductionLayout>
      <div style={{ padding: '24px 32px', maxWidth: 900 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 }}>
          <div>
            <h1 style={{ fontSize: 20, fontWeight: 600 }}>Аналитика проекта</h1>
            <p style={{ fontSize: 13, color: 'var(--muted)', marginTop: 2 }}>Статистика документов, списков и команды</p>
          </div>
          {isProducer && projectsList.length > 1 && (
            <select value={selectedProjectId || ''} onChange={e => setSelectedProjectId(e.target.value)}
              style={{ height: 40, padding: '0 12px', border: '1px solid var(--border)', borderRadius: 8, fontSize: 13, cursor: 'pointer' }}>
              {projectsList.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          )}
        </div>

        {loading && <div style={{ color: 'var(--muted)', fontSize: 13 }}>Загрузка...</div>}

        {data && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>

            {/* Summary cards */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 12 }}>
              <Card label="Всего позиций" value={totalItems} />
              <Card label="ИИ добавил" value={aiItems} sub={totalItems > 0 ? `${Math.round(aiItems / totalItems * 100)}%` : ''} color="#16a34a" />
              <Card label="Сквозных" value={data.cross_scenes?.count || 0} color="#7c3aed" />
              <Card label="На складе найдено" value={data.warehouse_match?.matched || 0}
                sub={data.warehouse_match?.total > 0 ? `из ${data.warehouse_match.total} (${Math.round(data.warehouse_match.matched / data.warehouse_match.total * 100)}%)` : ''} color="var(--blue)" />
              <Card label="Участников" value={data.team?.length || 0} />
            </div>

            {/* Documents */}
            <Section title="Документы">
              <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                {(data.documents || []).map(d => (
                  <div key={d.type} style={{
                    flex: '1 1 200px', padding: 16, background: 'var(--white)',
                    border: '1px solid var(--border)', borderRadius: 8,
                  }}>
                    <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 8 }}>
                      {d.type === 'kpp' ? 'КПП' : d.type === 'scenario' ? 'Сценарий' : 'Вызывной'}
                    </div>
                    <div style={{ fontSize: 24, fontWeight: 700, color: 'var(--blue)' }}>v{d.latest_version}</div>
                    <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 4 }}>
                      {d.versions} версий | Обновлено {new Date(d.last_upload).toLocaleDateString('ru-RU')}
                    </div>
                  </div>
                ))}
              </div>
            </Section>

            {/* Items by source — bar chart */}
            <Section title="Источники позиций">
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {(data.items_by_source || []).map(r => {
                  const sc = SOURCE_COLORS[r.source] || SOURCE_COLORS.manual
                  const pct = totalItems > 0 ? (parseInt(r.count) / totalItems * 100) : 0
                  return (
                    <div key={r.source} style={{ flex: '1 1 140px' }}>
                      <div style={{ fontSize: 12, fontWeight: 500, marginBottom: 4, color: sc.color }}>{sc.label}</div>
                      <div style={{ height: 28, borderRadius: 6, background: 'var(--bg)', overflow: 'hidden', position: 'relative' }}>
                        <div style={{ height: '100%', width: `${pct}%`, background: sc.color, borderRadius: 6, transition: 'width 0.3s', opacity: 0.2 }} />
                        <span style={{ position: 'absolute', left: 8, top: '50%', transform: 'translateY(-50%)', fontSize: 12, fontWeight: 600 }}>{r.count}</span>
                      </div>
                    </div>
                  )
                })}
              </div>
            </Section>

            {/* Items by category */}
            <Section title="Позиции по категориям">
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                {(data.items_by_category || []).filter(r => parseInt(r.count) > 0).map(r => {
                  const maxCount = Math.max(...(data.items_by_category || []).map(x => parseInt(x.count)))
                  const pct = maxCount > 0 ? (parseInt(r.count) / maxCount * 100) : 0
                  return (
                    <div key={r.type} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <span style={{ fontSize: 12, width: 120, flexShrink: 0, textTransform: 'capitalize' }}>{r.type}</span>
                      <div style={{ flex: 1, height: 22, borderRadius: 4, background: 'var(--bg)', overflow: 'hidden', position: 'relative' }}>
                        <div style={{ height: '100%', width: `${pct}%`, background: 'var(--blue)', borderRadius: 4, opacity: 0.15 }} />
                        <span style={{ position: 'absolute', left: 8, top: '50%', transform: 'translateY(-50%)', fontSize: 11, fontWeight: 500 }}>{r.count}</span>
                      </div>
                    </div>
                  )
                })}
              </div>
            </Section>

            {/* Cross-scene items */}
            {data.cross_scenes?.top?.length > 0 && (
              <Section title="Сквозные предметы (топ-5)">
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {data.cross_scenes.top.map((cs, i) => (
                    <div key={i} style={{
                      padding: '10px 14px', background: 'var(--white)',
                      border: '1px solid var(--border)', borderRadius: 8,
                      display: 'flex', alignItems: 'center', gap: 12,
                    }}>
                      <span style={{ fontWeight: 500, fontSize: 13, flex: 1 }}>{cs.name}</span>
                      <span style={{
                        padding: '2px 8px', borderRadius: 12, fontSize: 10, fontWeight: 500,
                        background: 'rgba(139,92,246,0.08)', color: '#7c3aed',
                      }}>
                        {cs.scenes?.length || 0} сцен
                      </span>
                      {cs.reason && <span style={{ fontSize: 11, color: 'var(--muted)', maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{cs.reason}</span>}
                    </div>
                  ))}
                </div>
              </Section>
            )}

            {/* Team activity */}
            <Section title="Активность команды">
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                {(data.team_uploads || []).map((u, i) => (
                  <div key={i} style={{
                    display: 'flex', alignItems: 'center', gap: 10,
                    padding: '8px 12px', background: 'var(--white)', borderRadius: 6,
                    border: '1px solid var(--border)',
                  }}>
                    <div style={{ width: 32, height: 32, borderRadius: '50%', background: 'var(--blue-dim)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, fontWeight: 600, color: 'var(--blue)', flexShrink: 0 }}>
                      {(u.name || '?')[0].toUpperCase()}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 500, fontSize: 13 }}>{u.name}</div>
                      <div style={{ fontSize: 11, color: 'var(--muted)' }}>{u.role}</div>
                    </div>
                    <span style={{ fontSize: 12, fontWeight: 500 }}>{u.uploads} загрузок</span>
                    <span style={{ fontSize: 10, color: 'var(--muted)' }}>
                      {new Date(u.last_upload).toLocaleDateString('ru-RU')}
                    </span>
                  </div>
                ))}
                {(!data.team_uploads || data.team_uploads.length === 0) && (
                  <div style={{ color: 'var(--muted)', fontSize: 13, textAlign: 'center', padding: 20 }}>Нет данных</div>
                )}
              </div>
            </Section>

            {/* Block groups */}
            {data.groups?.length > 0 && (
              <Section title="Блоки проекта">
                <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                  {data.groups.map(g => (
                    <div key={g.id} style={{
                      padding: 14, background: 'var(--white)', border: '1px solid var(--border)',
                      borderRadius: 8, minWidth: 140,
                    }}>
                      <div style={{ fontWeight: 600, fontSize: 14 }}>{g.name}</div>
                      <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 4 }}>
                        {g.doc_count} документов
                      </div>
                      {g.doc_types && (
                        <div style={{ marginTop: 6, display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                          {g.doc_types.filter(Boolean).map(t => (
                            <span key={t} style={{
                              padding: '1px 6px', borderRadius: 10, fontSize: 10, fontWeight: 500,
                              background: t === 'kpp' ? 'var(--blue-dim)' : t === 'scenario' ? 'var(--amber-dim)' : 'var(--green-dim)',
                              color: t === 'kpp' ? 'var(--blue)' : t === 'scenario' ? 'var(--amber)' : 'var(--green)',
                            }}>
                              {t === 'kpp' ? 'КПП' : t === 'scenario' ? 'Сценарий' : 'Вызывной'}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </Section>
            )}
          </div>
        )}
      </div>
    </ProductionLayout>
  )
}

function Card({ label, value, sub, color }) {
  return (
    <div style={{
      padding: 16, background: 'var(--white)', border: '1px solid var(--border)',
      borderRadius: 8,
    }}>
      <div style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.5px' }}>{label}</div>
      <div style={{ fontSize: 28, fontWeight: 700, color: color || 'var(--text)', marginTop: 4 }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>{sub}</div>}
    </div>
  )
}

function Section({ title, children }) {
  return (
    <div>
      <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 10 }}>{title}</div>
      {children}
    </div>
  )
}
