import { useState, useEffect, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { AlertTriangle, ArrowRight, ArrowDown, ArrowUp } from 'lucide-react'
import ProductionLayout from '../production/ProductionLayout'
import { categoryLabel } from '../../constants/categories'
import { analytics, projects as projectsApi } from '../../services/api'

// Запоминаем выбор фильтров на пользователя — продюсер обычно
// постоянно работает с одним проектом, не должен каждый раз кликать.
const LS_PROJECT = 'pd:selectedProject'
const LS_PERIOD  = 'pd:periodDays'

const PERIOD_OPTIONS = [
  { value: '30',  label: '30 дней' },
  { value: '90',  label: '90 дней' },
  { value: 'all', label: 'Всё время' },
]

const COLORS = ['var(--blue)', 'var(--green)', 'var(--accent)', 'var(--red)', 'var(--muted)']

function fmtMoneyShort(v) {
  const n = Number(v || 0)
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1).replace(/\.0$/, '') + ' млн ₽'
  if (n >= 1_000)     return Math.round(n / 1_000) + ' тыс ₽'
  return Math.round(n) + ' ₽'
}
function daysAgo(iso) {
  if (!iso) return null
  return Math.floor((Date.now() - new Date(iso).getTime()) / 86400000)
}
function pluralRu(n, forms) {
  // forms: ['заявка','заявки','заявок']
  const a = Math.abs(n) % 100
  const b = a % 10
  if (a > 10 && a < 20) return forms[2]
  if (b > 1 && b < 5) return forms[1]
  if (b === 1) return forms[0]
  return forms[2]
}

// Здоровье проекта: считаем из comparison-row.
// open_debts > 0 ИЛИ (rent_in_total > 100k и нет недавнего КПП) → жёлтый/красный.
function projectHealth(p, docMap) {
  const debts = Number(p.open_debts || 0)
  const docs = docMap[p.id]
  const kppAge = daysAgo(docs?.kpp_last)
  const noKpp = !docs?.kpp_last
  if (debts >= 3 || noKpp) return 'red'
  if (debts >= 1 || (kppAge !== null && kppAge > 30)) return 'amber'
  return 'green'
}

export default function ProducerDashboardPage() {
  const navigate = useNavigate()
  const [data, setData] = useState(null)
  const [warehouseData, setWarehouseData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [projectList, setProjectList] = useState([])
  const [selectedProject, setSelectedProject] = useState(() => localStorage.getItem(LS_PROJECT) || '')
  const [period, setPeriod] = useState(() => localStorage.getItem(LS_PERIOD) || '90')

  // Список проектов и общая складская аналитика — один раз.
  useEffect(() => {
    projectsApi.list().then(d => setProjectList(d.projects || [])).catch(() => {})
    analytics.warehouse().then(setWarehouseData).catch(() => {})
  }, [])

  // Producer-аналитика — пересчёт на смене проекта/периода.
  useEffect(() => {
    setLoading(true)
    let stale = false
    analytics.producer(selectedProject || undefined, period === 'all' ? 'all' : period)
      .then(d => { if (!stale) setData(d) })
      .catch(() => {})
      .finally(() => { if (!stale) setLoading(false) })
    return () => { stale = true }
  }, [selectedProject, period])

  // Persist selection.
  useEffect(() => {
    if (selectedProject) localStorage.setItem(LS_PROJECT, selectedProject)
    else                 localStorage.removeItem(LS_PROJECT)
  }, [selectedProject])
  useEffect(() => { localStorage.setItem(LS_PERIOD, period) }, [period])

  // Map project_id → document freshness (для health-индикатора табов).
  const docMap = useMemo(() => {
    const m = {}
    for (const d of (data?.document_stats || [])) m[d.project_id] = d
    return m
  }, [data])

  const projectsForChips = useMemo(() => {
    const comp = data?.project_comparison || []
    const cmpMap = {}
    for (const c of comp) cmpMap[c.id] = c
    return projectList.map(p => ({
      ...p,
      health: projectHealth(cmpMap[p.id] || {}, docMap),
      stats: cmpMap[p.id] || {},
    }))
  }, [projectList, data, docMap])

  // ── Производные значения ───────────────────────────────────────────────
  const asset = data?.asset_valuation || {}
  const rent  = data?.rent_summary    || {}
  const debts = data?.debt_stats      || {}
  const wo    = data?.writeoff_stats  || {}
  const cov   = data?.coverage        || {}
  const cmp   = data?.period_compare  || null
  const idleSummary = data?.idle_summary || { idle_count: 0, idle_value: 0 }

  const valuedPct = asset.total_count
    ? Math.round((Number(asset.valued_count) / Number(asset.total_count)) * 100)
    : 0
  const coveragePct = cov.total ? Math.round((cov.matched / cov.total) * 100) : 0

  const totalSpent = Number(rent.spent_in || 0) + Number(asset.purchased_value || 0) + Number(wo.writeoffs_value || 0)
  const risksTotal = Number(rent.overdue || 0) + Number(debts.open_debts || 0) + Number(wo.writeoffs_count || 0)
  const riskColor  = risksTotal === 0 ? 'var(--green)' : risksTotal <= 3 ? 'var(--accent)' : 'var(--red)'

  // Тренды по периоду.
  const spentDelta = cmp
    ? cmp.previous.spent === 0
        ? null
        : Math.round(((cmp.current.spent - cmp.previous.spent) / cmp.previous.spent) * 100)
    : null

  // Категории ↔ бюджет / max для бара.
  const budgetByCat = data?.budget_by_category || []
  const maxBudget   = Math.max(...budgetByCat.map(c => Number(c.owned_value || 0)), 1)

  // Сравнение проектов.
  const projectComparison = data?.project_comparison || []
  const maxRequests = Math.max(...projectComparison.map(p => Number(p.requests || 0)), 1)

  // Месячная нагрузка.
  const monthly = data?.monthly_load || []
  const maxMonth = Math.max(...monthly.map(m => Number(m.issuances || 0)), 1)

  const topUsers = data?.top_users  || []
  const idleUnits = data?.idle_units || []
  const documentStats = data?.document_stats || []
  const categoryLoad  = data?.category_load   || []
  const maxCatLoad    = Math.max(...categoryLoad.map(c => Number(c.request_count || 0)), 1)

  const byCategoryWh   = warehouseData?.by_category   || []
  const topRequestedWh = warehouseData?.top_requested || []

  const selectedProjectName = selectedProject
    ? (projectList.find(p => p.id === selectedProject)?.name || '')
    : 'Все проекты'

  return (
    <ProductionLayout>
      <style>{CSS}</style>
      <div className="pd-page">
        {/* ── Шапка: заголовок + период chips ── */}
        <div className="pd-head">
          <div className="pd-head-titlebox">
            <h1 className="pd-title">Аналитика</h1>
            <div className="pd-subtitle">
              {selectedProjectName}
              <span className="pd-meta-dot">·</span>
              {PERIOD_OPTIONS.find(o => o.value === period)?.label}
            </div>
          </div>
          <div className="pd-period">
            {PERIOD_OPTIONS.map(o => (
              <button
                key={o.value}
                className={`pd-period-chip${period === o.value ? ' active' : ''}`}
                onClick={() => setPeriod(o.value)}
              >{o.label}</button>
            ))}
          </div>
        </div>

        {/* ── Чипы проектов с health-индикатором ── */}
        <div className="pd-projects">
          <button
            className={`pd-proj-chip${!selectedProject ? ' active' : ''}`}
            onClick={() => setSelectedProject('')}
          >Все проекты</button>
          {projectsForChips.map(p => (
            <button
              key={p.id}
              className={`pd-proj-chip${selectedProject === p.id ? ' active' : ''}`}
              onClick={() => setSelectedProject(p.id)}
              title={p.health === 'red' ? 'Требует внимания' : p.health === 'amber' ? 'Есть напоминания' : 'Без замечаний'}
            >
              <span className={`pd-health pd-health-${p.health}`} />
              {p.name}
            </button>
          ))}
        </div>

        {loading && !data ? (
          <SkeletonView />
        ) : (
          <>
            {/* ── Шапочные KPI: Потрачено / Покрытие сценария / Риски ── */}
            <div className="resp-3-col pd-kpi-row">
              <KpiCard
                label="Потрачено"
                value={fmtMoneyShort(totalSpent)}
                color="var(--blue)"
                hint={`Аренда: ${fmtMoneyShort(rent.spent_in)} · Закупка: ${fmtMoneyShort(asset.purchased_value)} · Списания: ${fmtMoneyShort(wo.writeoffs_value)}`}
                trend={spentDelta}
                trendLabel="к предыдущему периоду"
              />
              <KpiCard
                label="Покрытие сценария"
                value={cov.total ? `${coveragePct}%` : '—'}
                color={cov.total === 0 ? 'var(--muted)' : coveragePct >= 80 ? 'var(--green)' : coveragePct >= 50 ? 'var(--accent)' : 'var(--red)'}
                hint={cov.total
                  ? `Найдено ${cov.matched} из ${cov.total} · докупить ${cov.unmatched}`
                  : selectedProject
                    ? 'Загрузите сценарий проекта'
                    : `${cov.projects_with_doc} ${pluralRu(cov.projects_with_doc, ['проект','проекта','проектов'])} со сценарием`}
                onClick={() => navigate(selectedProject ? '/production/documents' : '/production/analytics')}
              />
              <KpiCard
                label="Риски"
                value={risksTotal}
                color={riskColor}
                hint={`Просрочка аренды: ${rent.overdue || 0} · Долги: ${debts.open_debts || 0} · Списания: ${wo.writeoffs_count || 0}`}
                onClick={() => navigate(rent.overdue > 0 ? '/production/rent' : debts.open_debts > 0 ? '/debts' : '/writeoffs')}
              />
            </div>

            {/* ── Активы / Аренда ── */}
            <div className="resp-3-col pd-kpi-row">
              <KpiCard
                label="Активы"
                value={fmtMoneyShort(asset.total_assets_value)}
                color="var(--green)"
                hint={`${asset.total_count || 0} ед. · оценено ${valuedPct}% (${asset.valued_count || 0})`}
                onClick={() => navigate('/assets')}
              />
              <KpiCard
                label="Выдано"
                value={`${asset.issued_count || 0} ед.`}
                color="var(--accent)"
                hint={`на ${fmtMoneyShort(asset.issued_assets_value)}`}
              />
              <KpiCard
                label="Выручка с аренды"
                value={fmtMoneyShort(rent.revenue_out)}
                color="var(--green)"
                hint={`${rent.active || 0} активных · ${rent.done || 0} закрытых сделок`}
                onClick={() => navigate('/production/rent')}
              />
            </div>

            {/* ── График: помесячная активность ── */}
            <Card title="Активность по месяцам" subtitle="Выдачи + уникальные получатели">
              {monthly.length === 0
                ? <Empty hint={selectedProject ? 'На этом проекте ещё не было выдач' : 'Нет выдач за выбранный период'} />
                : (
                  <div className="pd-monthly-chart">
                    {monthly.map(m => {
                      const h = Math.round((Number(m.issuances) / maxMonth) * 100)
                      return (
                        <div key={m.month} className="pd-month-col">
                          <div className="pd-month-bar-wrap">
                            <div className="pd-month-bar" style={{ height: `${Math.max(h, 4)}%` }} />
                          </div>
                          <div className="pd-month-val">{m.issuances}</div>
                          <div className="pd-month-label">{(m.month || '').slice(5)}</div>
                          <div className="pd-month-sub">{m.active_users} {pluralRu(m.active_users, ['чел','чел','чел'])}</div>
                        </div>
                      )
                    })}
                  </div>
                )}
              {cmp && (
                <div className="pd-trend-row">
                  <TrendChip
                    label="Расходы аренды"
                    cur={cmp.current.spent}
                    prev={cmp.previous.spent}
                    fmt={fmtMoneyShort}
                  />
                  <TrendChip
                    label="Заявок"
                    cur={cmp.current.requests}
                    prev={cmp.previous.requests}
                    fmt={v => String(v)}
                  />
                </div>
              )}
            </Card>

            {/* ── Сравнение проектов (только в режиме «Все») ── */}
            {!selectedProject && projectComparison.length > 0 && (
              <Card title="Сравнение проектов" subtitle="По числу заявок, аренде и долгам">
                <div className="pd-projects-bars">
                  {projectComparison.slice(0, 8).map(p => {
                    const w = Math.round((Number(p.requests || 0) / maxRequests) * 100)
                    const h = projectHealth(p, docMap)
                    return (
                      <button
                        key={p.id}
                        className="pd-proj-row"
                        onClick={() => setSelectedProject(p.id)}
                      >
                        <div className="pd-proj-row-head">
                          <span className={`pd-health pd-health-${h}`} />
                          <span className="pd-proj-row-name">{p.name}</span>
                          <span className="pd-proj-row-stats">
                            {p.requests || 0} {pluralRu(p.requests, ['заявка','заявки','заявок'])}
                            {Number(p.rent_in_total) > 0 && <> · {fmtMoneyShort(p.rent_in_total)} аренда</>}
                            {Number(p.open_debts) > 0 && <> · <span className="pd-warn">{p.open_debts} {pluralRu(p.open_debts, ['долг','долга','долгов'])}</span></>}
                          </span>
                        </div>
                        <div className="pd-proj-row-bar">
                          <div className="pd-proj-row-fill" style={{ width: `${Math.max(w, 2)}%` }} />
                        </div>
                      </button>
                    )
                  })}
                </div>
              </Card>
            )}

            {/* ── Сценарий ↔ Склад (когда выбран проект) ── */}
            {selectedProject && (
              <Card
                title="Сценарий ↔ Склад"
                subtitle={cov.total ? `${cov.matched} из ${cov.total} позиций найдено на складе` : 'Нет данных по сценарию'}
              >
                {cov.total === 0
                  ? <Empty hint="Загрузите сценарий и КПП — система сама сопоставит позиции со складом" cta={{ label: 'Перейти к документам', onClick: () => navigate('/production/documents') }} />
                  : (
                    <>
                      <div className="pd-coverage-bar">
                        <div className="pd-coverage-fill" style={{ width: `${coveragePct}%` }} />
                      </div>
                      <div className="pd-coverage-legend">
                        <span><span className="pd-dot pd-dot-green" /> На складе: <b>{cov.matched}</b></span>
                        <span><span className="pd-dot pd-dot-red" /> Нужно найти: <b>{cov.unmatched}</b></span>
                        <span className="pd-coverage-pct">{coveragePct}%</span>
                      </div>
                    </>
                  )}
              </Card>
            )}

            {/* ── Бюджет / Топ-сотрудники ── */}
            <div className="resp-2-col pd-cards-row">
              <Card title="Стоимость склада по категориям" subtitle="По оценочной стоимости (valuation)">
                {budgetByCat.length === 0
                  ? <Empty hint="Заполните valuation у единиц склада, чтобы увидеть распределение" />
                  : budgetByCat.slice(0, 7).map((c, i) => {
                      const pct = Math.round((Number(c.owned_value) / maxBudget) * 100)
                      return (
                        <div key={c.category} className="pd-budget-row">
                          <div className="pd-budget-head">
                            <span className="pd-budget-label">
                              <span className="pd-color-dot" style={{ background: COLORS[i % COLORS.length] }} />
                              {categoryLabel(c.category) || '—'}
                              <span className="pd-budget-count">· {c.owned_count} ед.</span>
                            </span>
                            <span className="pd-budget-val">{fmtMoneyShort(c.owned_value)}</span>
                          </div>
                          <div className="pd-budget-bar">
                            <div className="pd-budget-fill" style={{ width: `${pct}%`, background: COLORS[i % COLORS.length] }} />
                          </div>
                        </div>
                      )
                    })}
              </Card>

              <Card title="Самые активные получатели" subtitle="По числу выдач">
                {topUsers.length === 0
                  ? <Empty hint="Никто пока не получал реквизит" />
                  : topUsers.slice(0, 6).map((u, i, arr) => (
                      <div key={u.id} className="pd-user-row" style={{ borderBottom: i < arr.length - 1 ? '1px solid var(--border)' : 'none' }}>
                        <div className="pd-user-rank">{i + 1}</div>
                        <div className="pd-user-info">
                          <div className="pd-user-name">{u.name}</div>
                          <div className="pd-user-role">{u.role}</div>
                        </div>
                        <div className="pd-user-stats">
                          <span className="pd-user-iss">{u.issuances}</span>
                          {Number(u.currently_holding) > 0 && (
                            <span className="pd-user-holding">держит {u.currently_holding}</span>
                          )}
                        </div>
                      </div>
                    ))}
              </Card>
            </div>

            {/* ── Idle / Документы ── */}
            <div className="resp-2-col pd-cards-row">
              <Card
                title="Замороженный капитал"
                subtitle={idleSummary.idle_count > 0
                  ? `${idleSummary.idle_count} ${pluralRu(idleSummary.idle_count, ['ед','ед','ед'])} лежит ≥ 3 мес. на ${fmtMoneyShort(idleSummary.idle_value)}`
                  : 'Всё в обороте'}
              >
                {idleUnits.length === 0
                  ? <Empty hint="Реквизит активно используется — нет лежащего без движения дольше 3 месяцев" />
                  : (
                    <>
                      {idleUnits.slice(0, 8).map((u, i, arr) => {
                        const months = u.last_movement && data?.meta?.generated_at
                          ? Math.floor((new Date(data.meta.generated_at).getTime() - new Date(u.last_movement).getTime()) / (30 * 86400000))
                          : null
                        return (
                          <button
                            key={u.id}
                            className="pd-idle-row"
                            style={{ borderBottom: i < arr.length - 1 ? '1px solid var(--border)' : 'none' }}
                            onClick={() => navigate(`/production/warehouse?unit=${u.id}`)}
                          >
                            <div className="pd-idle-info">
                              <div className="pd-idle-name">{u.name}</div>
                              <div className="pd-idle-meta">
                                {categoryLabel(u.category) || '—'}
                                {u.serial && <> · {u.serial}</>}
                              </div>
                            </div>
                            <div className="pd-idle-side">
                              {Number(u.valuation) > 0 && <div className="pd-idle-val">{fmtMoneyShort(u.valuation)}</div>}
                              <div className="pd-idle-age">{months === null ? 'без движений' : `${months} мес.`}</div>
                            </div>
                          </button>
                        )
                      })}
                    </>
                  )}
              </Card>

              <Card title="Свежесть документов" subtitle="Последние загрузки КПП и сценариев">
                {documentStats.length === 0
                  ? <Empty hint="Нет проектов" />
                  : documentStats.slice(0, 8).map((p, i, arr) => {
                      const kppAge = daysAgo(p.kpp_last)
                      const scAge  = daysAgo(p.scenario_last)
                      const stale = (!p.kpp_last) || (kppAge !== null && kppAge > 30)
                      return (
                        <div key={p.project_id} className="pd-doc-row" style={{ borderBottom: i < arr.length - 1 ? '1px solid var(--border)' : 'none' }}>
                          <div className="pd-doc-info">
                            <div className="pd-doc-name">
                              {p.project_name}
                              {stale && <span className="pd-doc-warn"><AlertTriangle size={12} /> устарел</span>}
                            </div>
                            <div className="pd-doc-meta">
                              КПП: {p.kpp_last ? `${kppAge} ${pluralRu(kppAge, ['день','дня','дней'])} назад` : '—'}
                              <span className="pd-meta-dot">·</span>
                              Сцен.: {p.scenario_last ? `${scAge} ${pluralRu(scAge, ['день','дня','дней'])} назад` : '—'}
                            </div>
                          </div>
                          <div className="pd-doc-versions">
                            v{p.kpp_versions || 0}/{p.scenario_versions || 0}
                          </div>
                        </div>
                      )
                    })}
              </Card>
            </div>

            {/* ── Что востребовано / Топ склад категории ── */}
            <div className="resp-2-col pd-cards-row">
              <Card title="Востребованные категории" subtitle={selectedProject ? 'На этом проекте' : 'По всем проектам'}>
                {categoryLoad.length === 0
                  ? <Empty hint="Нет данных по заявкам" />
                  : categoryLoad.slice(0, 6).map(c => {
                      const w = Math.round((Number(c.request_count) / maxCatLoad) * 100)
                      return (
                        <div key={c.category} className="pd-cat-row">
                          <div className="pd-cat-head">
                            <span>{categoryLabel(c.category) || '—'}</span>
                            <span className="pd-cat-val">{c.request_count} {pluralRu(c.request_count, ['заявка','заявки','заявок'])}</span>
                          </div>
                          <div className="pd-cat-bar">
                            <div className="pd-cat-fill" style={{ width: `${w}%` }} />
                          </div>
                        </div>
                      )
                    })}
              </Card>

              <Card title="Популярно на складе" subtitle="Топ-5 единиц по числу запросов">
                {topRequestedWh.length === 0
                  ? <Empty hint="Нет данных" />
                  : topRequestedWh.slice(0, 5).map((u, i, arr) => (
                      <div key={u.id} className="pd-pop-row" style={{ borderBottom: i < arr.length - 1 ? '1px solid var(--border)' : 'none' }}>
                        <div className={`pd-pop-rank ${i === 0 ? 'pd-pop-rank-first' : ''}`}>{i + 1}</div>
                        <div className="pd-pop-info">
                          <div className="pd-pop-name">{u.name}</div>
                          <div className="pd-pop-meta">{categoryLabel(u.category)}</div>
                        </div>
                        <div className="pd-pop-count">{u.request_count}×</div>
                      </div>
                    ))}
              </Card>
            </div>

            {/* ── Топ категории склада (если ничего не фильтровано — общий обзор) ── */}
            {!selectedProject && byCategoryWh.length > 0 && (
              <Card title="Состав склада" subtitle="Все единицы по категориям">
                {byCategoryWh.slice(0, 8).map(c => {
                  const max = Math.max(...byCategoryWh.map(x => Number(x.total)), 1)
                  const w = Math.round((Number(c.total) / max) * 100)
                  return (
                    <div key={c.category} className="pd-cat-row">
                      <div className="pd-cat-head">
                        <span>{categoryLabel(c.category) || '—'}</span>
                        <span className="pd-cat-val">{c.total} ед.</span>
                      </div>
                      <div className="pd-cat-bar">
                        <div className="pd-cat-fill" style={{ width: `${w}%`, background: 'var(--blue)' }} />
                      </div>
                    </div>
                  )
                })}
              </Card>
            )}

            <div className="pd-footer-meta">
              Данные обновлены{' '}
              {data?.meta?.generated_at
                ? new Date(data.meta.generated_at).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })
                : '—'}
            </div>
          </>
        )}
      </div>
    </ProductionLayout>
  )
}

// ── Подкомпоненты ──────────────────────────────────────────────────────────

function KpiCard({ label, value, color, hint, trend, trendLabel, onClick }) {
  const interactive = !!onClick
  return (
    <div
      className={`pd-kpi${interactive ? ' pd-kpi-clickable' : ''}`}
      onClick={onClick}
      role={interactive ? 'button' : undefined}
      tabIndex={interactive ? 0 : undefined}
      onKeyDown={interactive ? (e) => { if (e.key === 'Enter') onClick() } : undefined}
    >
      <div className="pd-kpi-label">{label}</div>
      <div className="pd-kpi-value" style={{ color }}>{value}</div>
      {hint && <div className="pd-kpi-hint">{hint}</div>}
      {trend !== null && trend !== undefined && (
        <div className={`pd-kpi-trend ${trend > 0 ? 'pd-kpi-trend-up' : trend < 0 ? 'pd-kpi-trend-down' : ''}`}>
          {trend > 0 ? <ArrowUp size={12} /> : trend < 0 ? <ArrowDown size={12} /> : null}
          {Math.abs(trend)}% {trendLabel}
        </div>
      )}
      {interactive && <ArrowRight size={14} className="pd-kpi-arrow" />}
    </div>
  )
}

function TrendChip({ label, cur, prev, fmt }) {
  const delta = prev === 0 ? null : Math.round(((cur - prev) / prev) * 100)
  const cls = delta > 0 ? 'pd-trend-up' : delta < 0 ? 'pd-trend-down' : ''
  return (
    <div className={`pd-trend ${cls}`}>
      <span className="pd-trend-label">{label}</span>
      <span className="pd-trend-cur">{fmt(cur)}</span>
      {delta !== null && (
        <span className="pd-trend-delta">
          {delta > 0 ? <ArrowUp size={11} /> : delta < 0 ? <ArrowDown size={11} /> : null}
          {Math.abs(delta)}%
        </span>
      )}
    </div>
  )
}

function Card({ title, subtitle, children }) {
  return (
    <div className="pd-card">
      <div className="pd-card-head">
        <div className="pd-card-title">{title}</div>
        {subtitle && <div className="pd-card-subtitle">{subtitle}</div>}
      </div>
      <div className="pd-card-body">{children}</div>
    </div>
  )
}

function Empty({ hint, cta }) {
  return (
    <div className="pd-empty">
      <div className="pd-empty-text">{hint || 'Нет данных'}</div>
      {cta && <button className="pd-empty-cta" onClick={cta.onClick}>{cta.label}</button>}
    </div>
  )
}

function SkeletonView() {
  return (
    <>
      <div className="resp-3-col pd-kpi-row">
        {[0,1,2].map(i => <div key={i} className="pd-kpi pd-skel-card" />)}
      </div>
      <div className="resp-3-col pd-kpi-row">
        {[0,1,2].map(i => <div key={i} className="pd-kpi pd-skel-card" />)}
      </div>
      <div className="pd-card pd-skel-card pd-skel-tall" />
      <div className="resp-2-col pd-cards-row">
        <div className="pd-card pd-skel-card pd-skel-mid" />
        <div className="pd-card pd-skel-card pd-skel-mid" />
      </div>
    </>
  )
}

// ── CSS ────────────────────────────────────────────────────────────────────
const CSS = `
.pd-page { padding: 24px 32px; max-width: 1180px; }
@media (max-width: 768px) {
  .pd-page { padding: 16px 14px; }
}

.pd-head {
  display: flex; align-items: flex-start; justify-content: space-between;
  gap: 12px; margin-bottom: 14px; flex-wrap: wrap;
}
.pd-title { font-size: 22px; font-weight: 600; letter-spacing: -0.02em; line-height: 1.2; }
.pd-subtitle {
  font-size: 12.5px; color: var(--muted); margin-top: 4px;
  display: flex; align-items: center; gap: 6px; flex-wrap: wrap;
}
.pd-meta-dot { color: var(--border-strong); }

/* Period chips — паттерн как в /issued (phv-period). */
.pd-period { display: flex; gap: 6px; flex-wrap: wrap; }
.pd-period-chip {
  padding: 6px 14px; font-size: 12.5px; font-weight: 500;
  border: 1px solid var(--border); background: var(--card);
  color: var(--text); border-radius: 16px; cursor: pointer;
  font-family: inherit; transition: all 0.12s; white-space: nowrap;
}
.pd-period-chip:hover { border-color: var(--accent); }
.pd-period-chip.active {
  background: var(--accent); color: #fff; border-color: var(--accent);
}

/* Project chips с health-индикатором (зелёный/жёлтый/красный). */
.pd-projects {
  display: flex; gap: 6px; margin-bottom: 22px; overflow-x: auto;
  scrollbar-width: none; padding: 2px 0 6px;
}
.pd-projects::-webkit-scrollbar { display: none; }
.pd-proj-chip {
  display: inline-flex; align-items: center; gap: 7px;
  padding: 7px 14px; font-size: 13px; font-weight: 500;
  border: 1px solid var(--border); background: var(--card);
  color: var(--text); border-radius: 18px; cursor: pointer;
  font-family: inherit; transition: all 0.12s; white-space: nowrap;
  flex-shrink: 0;
}
.pd-proj-chip:hover { border-color: var(--accent); }
.pd-proj-chip.active {
  background: var(--accent); color: #fff; border-color: var(--accent);
}
.pd-proj-chip.active .pd-health { box-shadow: 0 0 0 1.5px #fff; }

.pd-health {
  width: 8px; height: 8px; border-radius: 50%;
  flex-shrink: 0; display: inline-block;
}
.pd-health-green { background: #5C8B3F; }
.pd-health-amber { background: #C9A676; }
.pd-health-red   { background: #B85A3F; }

.pd-kpi-row { margin-bottom: 14px; }
.pd-cards-row { margin-bottom: 18px; }

/* KPI tile. */
.pd-kpi {
  position: relative; background: var(--card); border: 1px solid var(--border);
  border-radius: var(--radius-card); padding: 16px 18px;
  display: flex; flex-direction: column; gap: 4px;
}
.pd-kpi-clickable {
  cursor: pointer; transition: border-color 0.12s, transform 0.06s;
}
.pd-kpi-clickable:hover { border-color: var(--accent); }
.pd-kpi-clickable:active { transform: translateY(1px); }
.pd-kpi-label { font-size: 12px; color: var(--muted); font-weight: 500; }
.pd-kpi-value { font-size: 26px; font-weight: 700; line-height: 1.1; margin-top: 2px; letter-spacing: -0.02em; }
.pd-kpi-hint { font-size: 11.5px; color: var(--muted); line-height: 1.45; margin-top: 4px; }
.pd-kpi-trend {
  display: inline-flex; align-items: center; gap: 4px;
  font-size: 11px; font-weight: 600; color: var(--muted);
  margin-top: 4px;
}
.pd-kpi-trend-up   { color: var(--red); }
.pd-kpi-trend-down { color: var(--green); }
.pd-kpi-arrow {
  position: absolute; top: 16px; right: 14px; color: var(--muted); opacity: 0.5;
}
.pd-kpi-clickable:hover .pd-kpi-arrow { opacity: 1; color: var(--accent); }
@media (max-width: 768px) {
  .pd-kpi-value { font-size: 22px; }
}

/* Card wrapper. */
.pd-card {
  background: var(--card); border: 1px solid var(--border);
  border-radius: var(--radius-card); padding: 18px 20px;
  margin-bottom: 14px;
}
.resp-2-col .pd-card, .resp-3-col .pd-card { margin-bottom: 0; }
.pd-card-head { margin-bottom: 14px; }
.pd-card-title { font-size: 14.5px; font-weight: 600; letter-spacing: -0.01em; }
.pd-card-subtitle { font-size: 11.5px; color: var(--muted); margin-top: 3px; }

/* Empty / CTA. */
.pd-empty {
  display: flex; flex-direction: column; align-items: flex-start;
  gap: 10px; padding: 8px 0;
}
.pd-empty-text { color: var(--muted); font-size: 12.5px; line-height: 1.5; }
.pd-empty-cta {
  background: transparent; border: 1px solid var(--accent);
  color: var(--accent); border-radius: 14px; padding: 6px 14px;
  font-size: 12.5px; font-weight: 500; cursor: pointer; font-family: inherit;
}
.pd-empty-cta:hover { background: var(--accent-dim); }

/* Monthly chart. */
.pd-monthly-chart {
  display: flex; align-items: flex-end; gap: 6px;
  height: 130px; padding: 4px 0 0;
}
.pd-month-col {
  flex: 1; min-width: 0; display: flex; flex-direction: column;
  align-items: center; gap: 4px; height: 100%;
}
.pd-month-bar-wrap {
  flex: 1; width: 100%; display: flex; align-items: flex-end;
  justify-content: center;
}
.pd-month-bar {
  width: 70%; max-width: 32px;
  background: var(--accent); border-radius: 4px 4px 0 0;
  min-height: 4px; transition: opacity 0.12s;
}
.pd-month-col:hover .pd-month-bar { opacity: 0.85; }
.pd-month-val { font-size: 11px; font-weight: 600; color: var(--text); }
.pd-month-label { font-size: 10.5px; color: var(--muted); font-weight: 500; }
.pd-month-sub { font-size: 9.5px; color: var(--muted); opacity: 0.7; }

.pd-trend-row {
  display: flex; gap: 12px; margin-top: 16px; padding-top: 14px;
  border-top: 1px solid var(--border); flex-wrap: wrap;
}
.pd-trend {
  display: inline-flex; align-items: center; gap: 7px;
  font-size: 12px;
}
.pd-trend-label { color: var(--muted); font-weight: 500; }
.pd-trend-cur { font-weight: 600; }
.pd-trend-delta {
  display: inline-flex; align-items: center; gap: 2px;
  font-size: 11px; font-weight: 600; color: var(--muted);
  padding: 2px 8px; border-radius: 10px; background: var(--bg-secondary);
}
.pd-trend-up   .pd-trend-delta { color: var(--red);   background: var(--red-dim); }
.pd-trend-down .pd-trend-delta { color: var(--green); background: var(--green-dim); }

/* Project comparison bars. */
.pd-projects-bars { display: flex; flex-direction: column; gap: 12px; }
.pd-proj-row {
  background: transparent; border: none; padding: 0;
  font-family: inherit; cursor: pointer;
  display: flex; flex-direction: column; gap: 6px;
  text-align: left;
}
.pd-proj-row-head {
  display: flex; align-items: center; gap: 8px; flex-wrap: wrap;
  font-size: 12.5px;
}
.pd-proj-row-name { font-weight: 500; }
.pd-proj-row-stats { color: var(--muted); font-size: 11.5px; }
.pd-warn { color: var(--red); font-weight: 600; }
.pd-proj-row-bar {
  height: 8px; border-radius: 4px; background: var(--bg-secondary);
  overflow: hidden;
}
.pd-proj-row-fill {
  height: 100%; background: var(--accent); border-radius: 4px;
  transition: width 0.2s;
}
.pd-proj-row:hover .pd-proj-row-fill { background: var(--accent-hover); }

/* Coverage bar. */
.pd-coverage-bar {
  height: 14px; border-radius: 8px; background: var(--red-dim);
  overflow: hidden; margin-bottom: 12px;
}
.pd-coverage-fill {
  height: 100%; background: var(--green); border-radius: 8px;
  transition: width 0.3s;
}
.pd-coverage-legend {
  display: flex; align-items: center; gap: 16px;
  font-size: 12.5px; flex-wrap: wrap;
}
.pd-coverage-pct {
  margin-left: auto; font-size: 18px; font-weight: 700; color: var(--green);
}
.pd-dot {
  width: 8px; height: 8px; border-radius: 50%; display: inline-block;
  margin-right: 6px;
}
.pd-dot-green { background: var(--green); }
.pd-dot-red   { background: var(--red); }

/* Budget rows. */
.pd-budget-row { margin-bottom: 12px; }
.pd-budget-row:last-child { margin-bottom: 0; }
.pd-budget-head {
  display: flex; justify-content: space-between; align-items: baseline;
  font-size: 12.5px; margin-bottom: 5px; gap: 8px;
}
.pd-budget-label {
  display: inline-flex; align-items: center; gap: 7px; min-width: 0;
}
.pd-budget-count { color: var(--muted); font-size: 11px; font-weight: 400; }
.pd-budget-val { font-weight: 600; flex-shrink: 0; }
.pd-color-dot {
  width: 9px; height: 9px; border-radius: 2px; flex-shrink: 0;
}
.pd-budget-bar {
  height: 5px; border-radius: 3px; background: var(--bg-secondary);
  overflow: hidden;
}
.pd-budget-fill { height: 100%; border-radius: 3px; transition: width 0.2s; }

/* User rows. */
.pd-user-row {
  display: flex; align-items: center; gap: 10px; padding: 10px 0;
}
.pd-user-rank {
  width: 22px; height: 22px; border-radius: 50%;
  background: var(--bg-secondary); color: var(--muted);
  font-size: 11px; font-weight: 700; flex-shrink: 0;
  display: flex; align-items: center; justify-content: center;
}
.pd-user-info { flex: 1; min-width: 0; }
.pd-user-name { font-size: 13px; font-weight: 500; }
.pd-user-role { font-size: 11px; color: var(--muted); margin-top: 1px; }
.pd-user-stats {
  display: flex; gap: 8px; font-size: 12px; flex-shrink: 0; align-items: center;
}
.pd-user-iss { color: var(--blue); font-weight: 600; }
.pd-user-holding { color: var(--accent); }

/* Idle rows. */
.pd-idle-row {
  display: flex; align-items: center; gap: 10px; padding: 10px 0;
  background: transparent; border: none; border-bottom: 1px solid var(--border);
  width: 100%; text-align: left; cursor: pointer; font-family: inherit;
}
.pd-idle-row:hover .pd-idle-name { color: var(--accent); }
.pd-idle-info { flex: 1; min-width: 0; }
.pd-idle-name { font-size: 13px; font-weight: 500; transition: color 0.1s; }
.pd-idle-meta { font-size: 11px; color: var(--muted); margin-top: 2px; }
.pd-idle-side { text-align: right; flex-shrink: 0; }
.pd-idle-val { font-size: 12.5px; font-weight: 600; color: var(--text); }
.pd-idle-age { font-size: 11px; color: var(--red); margin-top: 2px; }

/* Documents rows. */
.pd-doc-row {
  display: flex; align-items: center; gap: 10px; padding: 10px 0;
}
.pd-doc-info { flex: 1; min-width: 0; }
.pd-doc-name {
  font-size: 13px; font-weight: 500;
  display: inline-flex; align-items: center; gap: 6px; flex-wrap: wrap;
}
.pd-doc-warn {
  display: inline-flex; align-items: center; gap: 3px;
  font-size: 10.5px; font-weight: 600; color: var(--red);
  padding: 1px 7px; border-radius: 8px;
  background: var(--red-dim);
}
.pd-doc-meta { font-size: 11px; color: var(--muted); margin-top: 2px; }
.pd-doc-versions {
  font-size: 11px; color: var(--muted); font-weight: 600;
  flex-shrink: 0;
}

/* Category rows (warehouse top). */
.pd-cat-row { margin-bottom: 11px; }
.pd-cat-row:last-child { margin-bottom: 0; }
.pd-cat-head {
  display: flex; justify-content: space-between;
  font-size: 12.5px; margin-bottom: 5px;
}
.pd-cat-val { font-weight: 500; color: var(--muted); }
.pd-cat-bar {
  height: 5px; border-radius: 3px; background: var(--bg-secondary);
  overflow: hidden;
}
.pd-cat-fill {
  height: 100%; background: var(--accent); border-radius: 3px;
  transition: width 0.2s;
}

/* Popular (warehouse top items). */
.pd-pop-row { display: flex; align-items: center; gap: 10px; padding: 9px 0; }
.pd-pop-rank {
  width: 24px; height: 24px; border-radius: 6px; flex-shrink: 0;
  background: var(--bg-secondary); color: var(--muted);
  font-size: 12px; font-weight: 700;
  display: flex; align-items: center; justify-content: center;
}
.pd-pop-rank-first {
  background: var(--accent-dim); color: var(--accent);
}
.pd-pop-info { flex: 1; min-width: 0; }
.pd-pop-name { font-size: 13px; font-weight: 500; }
.pd-pop-meta { font-size: 11px; color: var(--muted); margin-top: 1px; }
.pd-pop-count { font-size: 13px; font-weight: 600; color: var(--blue); flex-shrink: 0; }

.pd-footer-meta {
  font-size: 11px; color: var(--muted); text-align: center;
  padding: 18px 0 8px; opacity: 0.6;
}

/* Skeleton. */
.pd-skel-card {
  background: linear-gradient(90deg, #ECE9E2 0%, #F5F2EC 50%, #ECE9E2 100%);
  background-size: 200% 100%;
  animation: pd-shim 1.2s linear infinite;
  border: 1px solid var(--border);
  min-height: 90px;
}
.pd-skel-tall { min-height: 220px; margin-bottom: 14px; }
.pd-skel-mid  { min-height: 260px; }
@keyframes pd-shim { 0% { background-position: 200% 0; } 100% { background-position: -200% 0; } }
`
