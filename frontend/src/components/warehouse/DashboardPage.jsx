import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { Package, ArrowRightLeft, AlertTriangle, Wallet, ChevronRight, ClipboardCheck, RotateCw, MapPin, TrendingUp, ShoppingBag } from 'lucide-react'
import WarehouseLayout from './WarehouseLayout'
import Button from '../shared/Button'
import UnitCardModal from '../shared/UnitCardModal'
import { useToast } from '../shared/Toast'
import { units as unitsApi, requests as requestsApi, issuances as issuancesApi, projectUnits as projectUnitsApi, rent as rentApi, debts as debtsApi, writeoffs as writeoffsApi, issued as issuedApi } from '../../services/api'
import { useAuth } from '../../hooks/useAuth'
import { pluralRu } from '../../utils/pluralRu'
import { unitQty, sumUnitQty } from '../../utils/unitQty'

const css = `
.dash-page { padding: 28px 32px; max-width: 1200px; }

/* Шапка */
.dash-head { display: flex; align-items: baseline; justify-content: space-between; margin-bottom: 24px; gap: 16px; }
.dash-title { font-size: 24px; font-weight: 600; letter-spacing: -0.03em; color: var(--text); }
.dash-date  { font-size: 13px; color: var(--muted); text-transform: capitalize; }

/* Сетка счётчиков (5) */
.dash-kpis { display: grid; grid-template-columns: repeat(5, 1fr); gap: 12px; margin-bottom: 20px; }
@media (max-width: 1200px) {
  .dash-kpis { grid-template-columns: repeat(3, 1fr); }
}
.dash-kpi {
  background: var(--card);
  border: 1px solid var(--border);
  border-radius: var(--radius-card);
  padding: 16px 18px;
  position: relative;
  transition: border-color 0.12s, transform 0.08s;
}
.dash-kpi.clickable { cursor: pointer; }
.dash-kpi.clickable:hover { border-color: var(--border-strong); }
.dash-kpi-row { display: flex; align-items: center; justify-content: space-between; margin-bottom: 10px; }
.dash-kpi-label { font-size: 12px; color: var(--muted); font-weight: 500; letter-spacing: 0.01em; }
.dash-kpi-icon {
  width: 28px; height: 28px; border-radius: 8px;
  display: flex; align-items: center; justify-content: center;
}
.dash-kpi-value { font-size: 28px; font-weight: 600; line-height: 1.1; letter-spacing: -0.03em; color: var(--text); }
.dash-kpi-sub { font-size: 11px; color: var(--muted); margin-top: 4px; }

/* Уведомления — светлый блок с золотым акцентом */
.dash-todo {
  background: var(--card);
  border: 1px solid var(--border);
  border-left: 3px solid var(--gold-500);
  border-radius: var(--radius-card);
  padding: 16px 20px;
  margin-bottom: 20px;
}
.dash-todo-head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px; }
.dash-todo-title { font-size: 11px; letter-spacing: 0.08em; text-transform: uppercase; font-weight: 600; color: var(--gold-600); }
.dash-todo-count { font-size: 12px; color: var(--muted); }
.dash-todo-list { display: flex; flex-direction: column; }
.dash-todo-item {
  display: flex; align-items: center; gap: 12px;
  padding: 10px 0;
  border-bottom: 1px solid var(--border);
  cursor: pointer;
  transition: background 0.12s;
  color: var(--text);
  background: none; border-left: none; border-right: none; border-top: none;
  width: 100%; text-align: left; font-family: inherit;
}
.dash-todo-item:last-child { border-bottom: none; }
.dash-todo-item:hover { background: var(--bg-secondary); margin: 0 -20px; padding: 10px 20px; border-bottom-color: transparent; }
.dash-todo-ico {
  width: 28px; height: 28px; border-radius: 8px;
  background: var(--gold-100);
  color: var(--gold-600);
  display: flex; align-items: center; justify-content: center;
  flex-shrink: 0;
}
.dash-todo-text { flex: 1; font-size: 13.5px; font-weight: 500; }
.dash-todo-arrow { color: var(--subtle); flex-shrink: 0; }
.dash-todo-empty {
  padding: 6px 0 2px;
  font-size: 13px;
  color: var(--muted);
}
.dash-todo-empty b { color: var(--gold-600); font-weight: 600; }

/* Карточки (2 колонки) */
.dash-cards { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-bottom: 16px; }
.dash-card {
  background: var(--card);
  border: 1px solid var(--border);
  border-radius: var(--radius-card);
  padding: 18px 20px;
}
.dash-card-head {
  display: flex; justify-content: space-between; align-items: center;
  margin-bottom: 12px;
}
.dash-card-title { font-size: 14px; font-weight: 600; color: var(--text); }
.dash-card-link {
  font-size: 12px; color: var(--muted); font-weight: 500;
  background: none; border: none; cursor: pointer; padding: 0;
  font-family: inherit;
  display: inline-flex; align-items: center; gap: 3px;
}
.dash-card-link:hover { color: var(--gold-600); }
.dash-card-empty { color: var(--subtle); font-size: 13px; padding: 16px 0; text-align: center; }

.dash-row {
  display: flex; align-items: center; justify-content: space-between;
  padding: 10px 0;
  border-bottom: 1px solid var(--border);
  gap: 12px;
}
.dash-row:last-child { border-bottom: none; }
.dash-row.clickable { cursor: pointer; }
.dash-row.clickable:hover { background: var(--bg-secondary); margin: 0 -20px; padding: 10px 20px; border-radius: 6px; border-bottom-color: transparent; }
.dash-row-title { font-weight: 500; font-size: 13.5px; color: var(--text); display: flex; align-items: center; gap: 6px; flex-wrap: nowrap; min-width: 0; }
.dash-row-title-text { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; }
.dash-row-title .dash-badge { flex-shrink: 0; }
.dash-row-sub { color: var(--muted); font-size: 12px; margin-top: 2px; }

.dash-badge {
  font-size: 10.5px; font-weight: 600; padding: 2px 7px; border-radius: 8px;
  letter-spacing: 0.02em; text-transform: uppercase;
}
.dash-badge-public  { background: var(--gold-100); color: var(--gold-600); }
.dash-badge-return  { background: var(--red-dim); color: var(--red); }

/* Широкий блок Поступления */
.dash-wide .dash-row { padding: 12px 0; }

@media (max-width: 1024px) {
  .dash-kpis { grid-template-columns: repeat(2, 1fr); }
  .dash-cards { grid-template-columns: 1fr; }
}
@media (max-width: 768px) {
  .dash-page { padding: 16px; }
  /* Sticky-шапка под mtop. Заголовок и дата — в одной строке, дата ужимается. */
  .dash-head {
    position: sticky; top: var(--page-sticky-top, 52px); z-index: 12;
    background: var(--paper);
    margin: -16px -16px 16px;
    padding: 12px 16px;
    flex-direction: row;
    align-items: baseline;
    gap: 10px;
    flex-wrap: nowrap;
  }
  .dash-title { font-size: 18px; flex-shrink: 0; }
  .dash-date {
    font-size: 12px; color: var(--muted);
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    min-width: 0;
  }
  .dash-kpis { grid-template-columns: repeat(2, 1fr); gap: 10px; }
  .dash-kpi { padding: 14px; }
  .dash-kpi-value { font-size: 22px; }
  .dash-card { padding: 14px; }
}
`

function timeAgo(dateStr) {
  const diff = (Date.now() - new Date(dateStr)) / 1000
  if (diff < 60)    return 'только что'
  if (diff < 3600)  return `${Math.floor(diff / 60)} мин`
  if (diff < 86400) return `${Math.floor(diff / 3600)} ч`
  return `${Math.floor(diff / 86400)} д`
}

function formatDate(str) {
  if (!str) return ''
  return new Date(str).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })
}

// Дата + время: «20 апр · 14:35»
function formatDateTime(str) {
  if (!str) return ''
  const d = new Date(str)
  const date = d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })
  const time = d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })
  return `${date} · ${time}`
}

function fmtNum(n) { return (n || 0).toLocaleString('ru-RU') }

function fmtMoney(n) {
  if (!n) return '0 ₽'
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1).replace('.', ',') + ' млн ₽'
  if (n >= 1_000)     return Math.round(n / 1_000) + ' тыс ₽'
  return fmtNum(n) + ' ₽'
}

function isCommonStockWithoutPlace(u) {
  return u?.status === 'on_stock'
    && !u.cell_id
    && !u.pavilion_id
    && !u.is_project_kept
    && !u.is_admin_stock
}

function formatReceiptLocation(u) {
  const parts = []
  if (u?.warehouse_name) parts.push(u.warehouse_name)
  if (u?.hall_name) parts.push(u.hall_name)
  if (u?.section_name) parts.push(u.section_name)
  if (u?.cell_custom || u?.cell_code) parts.push(u.cell_custom || u.cell_code)
  if (isCommonStockWithoutPlace(u)) parts.push('Без места')
  return parts.join(' · ') || 'Без места'
}

const today = new Date().toLocaleDateString('ru-RU', { weekday: 'long', day: 'numeric', month: 'long' })

export default function DashboardPage() {
  const navigate = useNavigate()
  useAuth()
  const toast = useToast()

  const [stats, setStats] = useState({ on_stock: 0, issued: 0, overdue: 0, pending: 0, no_cell: 0, assets_value: 0 })
  const [notReturned, setNotReturned] = useState({ total: 0, debts: 0, writeoffs: 0, misplaced: 0 })
  const [revenue, setRevenue] = useState(0)
  const [reqs, setReqs] = useState([])
  const [updating, setUpdating] = useState(null)
  const [activeIssuances, setActiveIssuances] = useState([])
  const [returnReqCount, setReturnReqCount] = useState(0)
  const [returned, setReturned] = useState([])
  const [purchased, setPurchased] = useState({ totals: { qty: 0, value: 0, projects: 0 }, projects: [] })
  const [receipts, setReceipts] = useState([])
  const [openUnitId, setOpenUnitId] = useState(null)

  function reloadReqs() {
    Promise.all([
      requestsApi.list().then(d => (d.requests || [])
        .filter(r => ['new', 'collecting', 'ready'].includes(r.status) && !r.returned_at)
      ).catch(() => []),
      requestsApi.list({ status: 'issued' }).then(d => (d.requests || [])
        .filter(r => r.return_requested_at && !r.returned_at)
      ).catch(() => []),
      rentApi.list({ status: 'pending_review' }).then(d => d.deals || []).catch(() => []),
    ]).then(([news, returning, publicReqs]) => {
      setReturnReqCount(returning.length)
      const combined = [
        ...news.map(r => ({ ...r, _kind: 'project' })),
        ...returning.map(r => ({ ...r, _kind: 'return' })),
        ...publicReqs.map(d => ({
          id: d.id,
          _kind: 'public',
          _stage: d.workflow_stage || null,
          project_name: d.counterparty_name,
          requester_name: d.requester_name || d.counterparty_contact || '',
          unit_ids: d.unit_ids || [],
          created_at: d.created_at,
        })),
      ].sort((a, b) => {
        const ta = a._kind === 'return' ? a.return_requested_at : a.created_at
        const tb = b._kind === 'return' ? b.return_requested_at : b.created_at
        return new Date(tb) - new Date(ta)
      }).slice(0, 5)
      setReqs(combined)
    })
  }

  useEffect(() => {
    Promise.all([
      unitsApi.list().then(data => data.units || []).catch(() => []),
      unitsApi.list({ scope: 'project', status: 'on_stock' }).then(data => data.units || []).catch(() => []),
    ]).then(([commonUnits, projectStockUnits]) => {
      const us = [...commonUnits, ...projectStockUnits]
      const assetsValue = us
        .filter(u => u.status === 'on_stock' || u.status === 'issued')
        .reduce((s, u) => s + (Number(u.valuation) || 0) * unitQty(u), 0)
      // `issued` намеренно НЕ трогаем здесь — он принадлежит источнику
      // «Движения» (byProjects('issued')) или fallback'у ниже, чтобы цифра
      // на главной всегда совпадала с разделом «Движение».
      setStats(s => ({
        ...s,
        on_stock: sumUnitQty(us.filter(u => u.status === 'on_stock')),
        overdue:  sumUnitQty(commonUnits.filter(u => u.status === 'overdue')),
        pending:  sumUnitQty(commonUnits.filter(u => u.status === 'pending')),
        no_cell:  sumUnitQty(commonUnits.filter(isCommonStockWithoutPlace)),
        assets_value: assetsValue,
      }))
    }).catch(() => {})

    Promise.all([
      debtsApi.list('open').then(d => (d.debts || []).length).catch(() => 0),
      writeoffsApi.list().then(d => {
        const ws = d.writeoffs || []
        return {
          writeoffs: ws.filter(w => w.kind === 'writeoff').length,
          legacyDebts: ws.filter(w => w.kind === 'debt').length,
        }
      }).catch(() => ({ writeoffs: 0, legacyDebts: 0 })),
      unitsApi.list({ misplaced: 'true' }).then(d => sumUnitQty(d.units || [])).catch(() => 0),
    ]).then(([debts, w, misplaced]) => {
      const totalDebts = debts + w.legacyDebts
      setNotReturned({
        debts: totalDebts,
        writeoffs: w.writeoffs,
        misplaced,
        total: totalDebts + w.writeoffs + misplaced,
      })
    })

    reloadReqs()

    // Выручка — сумма price_total всех сделок кроме отменённых/pending.
    rentApi.list().then(d => {
      const all = d.deals || []
      const sum = all
        .filter(x => x.status !== 'cancelled' && x.status !== 'pending_review')
        .reduce((a, x) => a + (Number(x.price_total) || 0), 0)
      setRevenue(sum)
    }).catch(() => {})

    // Счётчик «Выдано» и список «Выданы» берём из того же источника, что и
    // раздел «Движение» → вкладка «Выданы» (GET /issued/by-projects?view=issued),
    // чтобы цифра и список на главной всегда совпадали с «Движением».
    // Для ролей без доступа к этому эндпоинту (напр. warehouse_staff) —
    // тихий фолбэк на старый расчёт.
    const fallbackActive = () => Promise.all([
      issuancesApi.active().then(d => d.issuances || []).catch(() => []),
      rentApi.list({ status: 'active', type: 'out' }).then(d => d.deals || []).catch(() => []),
    ]).then(([iss, deals]) => {
      const normalizedDeals = deals.map(d => ({
        id: 'rd_' + d.id, _isRent: true, receiver_name: d.counterparty_name,
        project_name: 'Партнёрская', unit_ids: d.unit_ids || [],
        deadline: d.period_end, return_requested_at: null, _rentId: d.id,
      }))
      const all = [...iss, ...normalizedDeals]
      const issuedQty = all.reduce((n, x) => n + (x.unit_ids || []).length, 0)
      setStats(s => ({ ...s, issued: issuedQty }))
      const combined = all
        .sort((a, b) => new Date(a.deadline || 0) - new Date(b.deadline || 0))
        .slice(0, 4)
      setActiveIssuances(combined)
    })

    issuedApi.byProjects('issued').then(r => {
      const projects = r?.projects || []
      // Счётчик «Выдано» = totals.qty из «Движения» (issued+overdue, без
      // запрошенных возвратов и без уже вернувшихся).
      if (r?.totals && typeof r.totals.qty === 'number') {
        setStats(s => ({ ...s, issued: r.totals.qty }))
      }
      // Список — одна строка на выдачу/сделку, как раньше, но набор строго
      // совпадает с «Движением».
      const byKey = new Map()
      for (const p of projects) {
        const isRent = p.kind === 'rent'
        for (const person of p.people || []) {
          for (const it of person.items || []) {
            const key = isRent ? 'rd_' + it.deal_id : 'is_' + it.issuance_id
            let row = byKey.get(key)
            if (!row) {
              row = isRent
                ? { id: 'rd_' + it.deal_id, _isRent: true, _rentId: it.deal_id,
                    receiver_name: person.name, project_name: 'Партнёрская',
                    unit_ids: [], deadline: it.deadline, return_requested_at: it.return_requested_at }
                : { id: it.issuance_id, _isRent: false,
                    receiver_name: person.name,
                    project_name: p.kind === 'no_project' ? null : p.name,
                    unit_ids: [], deadline: it.deadline, return_requested_at: it.return_requested_at }
              byKey.set(key, row)
            }
            if (it.unit_id) row.unit_ids.push(it.unit_id)
          }
        }
      }
      const combined = Array.from(byKey.values())
        .sort((a, b) => new Date(a.deadline || 0) - new Date(b.deadline || 0))
        .slice(0, 4)
      setActiveIssuances(combined)
    }).catch(() => { fallbackActive() })

    Promise.all([
      projectUnitsApi.listReturnRequests('outgoing', 'confirmed').then(d => d.requests || []).catch(() => []),
      issuancesApi.acts().then(d => d.returns || []).catch(() => []),
      rentApi.list().then(d => d.deals || []).catch(() => []),
    ]).then(([projReturns, returns, deals]) => {
      const combined = [
        ...projReturns.map(r => ({
          id: 'p_' + r.id, title: r.unit_name, sub: `Склад проекта «${r.from_project_name}»`,
          when: r.confirmed_at, unitId: r.unit_id,
        })),
        ...returns.map(a => ({
          id: 'a_' + a.id,
          title: a.returned_by_name || `Возврат #${String(a.id).slice(0, 8)}`,
          sub: `Заявка · ${(a.unit_ids || []).length || ''} ед.`,
          when: a.returned_at, unitId: null,
        })),
        ...deals.filter(d => d.status === 'returned' || d.status === 'completed').map(d => ({
          id: 'r_' + d.id, title: `Аренда — ${d.requester_name || '—'}`,
          sub: `${d.project_name || d.company_name || ''}`,
          when: d.returned_at || d.end_date || d.updated_at, unitId: null,
        })),
      ].filter(x => x.when)
       .sort((a, b) => new Date(b.when) - new Date(a.when))
       .slice(0, 5)
      setReturned(combined)
    })

    unitsApi.list({}).then(d => setReceipts((d.units || []).slice(0, 5))).catch(() => {})

    // «Куплено у проектов» — единицы, купленные проектами (purchased=true),
    // это не «выдано складом», а отдельная категория.
    projectUnitsApi.purchasedByProjects()
      .then(d => setPurchased({
        totals: d.totals || { qty: 0, value: 0, projects: 0 },
        projects: d.projects || [],
      }))
      .catch(() => {})
  }, [])

  // ── KPI ──
  const KPIS = [
    {
      label: 'На складе', value: fmtNum(stats.on_stock),
      Icon: Package, bg: 'var(--gold-100)', color: 'var(--gold-600)',
      onClick: () => navigate('/units'),
    },
    {
      label: 'Выдано', value: fmtNum(stats.issued),
      Icon: ArrowRightLeft, bg: 'var(--bg-secondary)', color: 'var(--ink-900)',
      onClick: () => navigate('/issued?view=issued'),
    },
    {
      label: 'Куплено', value: fmtNum(purchased.totals.qty),
      Icon: ShoppingBag, bg: 'var(--gold-100)', color: 'var(--gold-600)',
      sub: purchased.totals.projects > 0
        ? `${purchased.totals.projects} ${pluralRu(purchased.totals.projects, ['проект', 'проекта', 'проектов'])} · ${fmtMoney(purchased.totals.value)}`
        : 'проектами',
    },
    {
      label: 'Не вернули', value: fmtNum(notReturned.total),
      Icon: AlertTriangle, bg: 'var(--red-dim)', color: 'var(--red)',
      sub: notReturned.total > 0 ? `долги ${notReturned.debts} · списания ${notReturned.writeoffs} · пересорт ${notReturned.misplaced}` : 'всё вернулось',
      onClick: () => navigate('/debts'),
    },
    {
      label: 'Активы', value: fmtMoney(stats.assets_value),
      Icon: Wallet, bg: 'var(--gold-100)', color: 'var(--gold-600)',
      sub: `${fmtNum(stats.on_stock + stats.issued)} ед.`,
      onClick: () => navigate('/assets'),
    },
    {
      label: 'Выручка', value: fmtMoney(revenue),
      Icon: TrendingUp, bg: 'var(--green-dim)', color: 'var(--green)',
      sub: 'партнёрская аренда',
      onClick: () => navigate('/rent?filter=public'),
    },
  ]

  // ── Уведомления ──
  const todos = []
  const pendingReqCount = reqs.filter(r => r._kind !== 'return').length
  if (pendingReqCount) {
    const noun = pluralRu(pendingReqCount, ['заявка', 'заявки', 'заявок'])
    const verb = pluralRu(pendingReqCount, ['ждёт', 'ждут', 'ждут'])
    todos.push({
      Icon: ClipboardCheck,
      text: `${pendingReqCount} ${noun} ${verb} ответа`,
      onClick: () => navigate('/requests'),
    })
  }
  if (returnReqCount) {
    const noun = pluralRu(returnReqCount, ['запрос', 'запроса', 'запросов'])
    todos.push({
      Icon: RotateCw,
      text: `${returnReqCount} ${noun} возврата`,
      onClick: () => navigate('/requests'),
    })
  }
  if (stats.no_cell) {
    const noun = pluralRu(stats.no_cell, ['пополнение', 'пополнения', 'пополнений'])
    todos.push({
      Icon: MapPin,
      text: `${stats.no_cell} ${noun} без места`,
      onClick: () => navigate('/cells', { state: { openNoPlace: true } }),
    })
  }

  return (
    <WarehouseLayout>
      <style>{css}</style>
      <div className="dash-page">
        <div className="dash-head">
          <h1 className="dash-title">Главная</h1>
          <span className="dash-date">{today}</span>
        </div>

        {/* KPI */}
        <div className="dash-kpis">
          {KPIS.map(k => (
            <div
              key={k.label}
              className={`dash-kpi${k.onClick ? ' clickable' : ''}`}
              onClick={k.onClick}
            >
              <div className="dash-kpi-row">
                <div className="dash-kpi-label">{k.label}</div>
                <div className="dash-kpi-icon" style={{ background: k.bg, color: k.color }}>
                  <k.Icon size={15} strokeWidth={1.8} />
                </div>
              </div>
              <div className="dash-kpi-value">{k.value}</div>
              {k.sub && <div className="dash-kpi-sub">{k.sub}</div>}
            </div>
          ))}
        </div>

        {/* Уведомления */}
        <div className="dash-todo">
          <div className="dash-todo-head">
            <span className="dash-todo-title">Уведомления</span>
            <span className="dash-todo-count">{todos.length || 'всё закрыто'}</span>
          </div>
          {todos.length === 0
            ? <div className="dash-todo-empty"><b>Всё в порядке.</b> Новых задач нет.</div>
            : (
              <div className="dash-todo-list">
                {todos.map((t, i) => (
                  <button key={i} className="dash-todo-item" onClick={t.onClick}>
                    <div className="dash-todo-ico">
                      <t.Icon size={14} strokeWidth={1.8} />
                    </div>
                    <div className="dash-todo-text">{t.text}</div>
                    <ChevronRight size={16} className="dash-todo-arrow" />
                  </button>
                ))}
              </div>
            )}
        </div>

        {/* Две карточки рядом: Заявки + Выдали */}
        <div className="dash-cards">
          <div className="dash-card">
            <div className="dash-card-head">
              <span className="dash-card-title">Заявки от проектов</span>
              <button className="dash-card-link" onClick={() => navigate('/requests?status=new')}>
                Новые <ChevronRight size={12} />
              </button>
            </div>
            {reqs.length === 0
              ? <div className="dash-card-empty">Нет новых заявок</div>
              : reqs.map(r => {
                const isReturn = r._kind === 'return'
                const isPublic = r._kind === 'public'
                const badge = isReturn ? 'Возврат' : isPublic ? 'От партнёров' : null
                const badgeCls = isReturn ? 'dash-badge-return' : 'dash-badge-public'
                const stage = isPublic ? r._stage : null
                let btnLabel = 'Выдать'
                let btnVariant = 'secondary'
                let action = null
                if (isReturn) {
                  btnLabel = 'Принять'; btnVariant = 'primary'
                  action = () => navigate(r.issuance_id ? `/return/${r.issuance_id}` : '/requests')
                } else if (isPublic) {
                  if (stage === null) {
                    btnLabel = 'Принять'
                    action = async () => {
                      setUpdating(r.id)
                      try { await rentApi.workflowStage(r.id, 'collecting'); await reloadReqs() }
                      catch (e) { toast?.(e.message || 'Ошибка', 'error') }
                      finally { setUpdating(null) }
                    }
                  } else if (stage === 'collecting') {
                    btnLabel = 'Готово'
                    action = async () => {
                      setUpdating(r.id)
                      try { await rentApi.workflowStage(r.id, 'ready'); await reloadReqs() }
                      catch (e) { toast?.(e.message || 'Ошибка', 'error') }
                      finally { setUpdating(null) }
                    }
                  } else if (stage === 'ready') {
                    btnLabel = 'Выдать'; btnVariant = 'primary'
                    action = () => navigate(`/issue/rent/${r.id}`)
                  }
                } else {
                  if (r.status === 'new') {
                    btnLabel = 'Принять'
                    action = async () => {
                      setUpdating(r.id)
                      try { await requestsApi.status(r.id, 'collecting'); await reloadReqs() }
                      catch (e) { toast?.(e.message || 'Ошибка', 'error') }
                      finally { setUpdating(null) }
                    }
                  } else if (r.status === 'collecting') {
                    btnLabel = 'Готово'
                    action = async () => {
                      setUpdating(r.id)
                      try { await requestsApi.status(r.id, 'ready'); await reloadReqs() }
                      catch (e) { toast?.(e.message || 'Ошибка', 'error') }
                      finally { setUpdating(null) }
                    }
                  } else if (r.status === 'ready') {
                    btnLabel = 'Выдать'; btnVariant = 'primary'
                    action = () => navigate(`/issue/${r.id}`)
                  }
                }
                return (
                  <div key={r.id} className="dash-row">
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div className="dash-row-title">
                        Заявка #{String(r.id).slice(0, 8)}
                        {badge && <span className={`dash-badge ${badgeCls}`}>{badge}</span>}
                      </div>
                      <div className="dash-row-sub">
                        {r.project_name && `${r.project_name} · `}
                        {r.requester_name && `${r.requester_name} · `}
                        {(r.unit_ids || []).length} ед.
                      </div>
                    </div>
                    <Button variant={btnVariant} size="sm"
                      disabled={updating === r.id || !action}
                      onClick={action || undefined}>
                      {btnLabel}
                    </Button>
                  </div>
                )
              })
            }
          </div>

          <div className="dash-card">
            <div className="dash-card-head">
              <span className="dash-card-title">Выданы</span>
              <button className="dash-card-link" onClick={() => navigate('/issued?view=issued')}>
                Все <ChevronRight size={12} />
              </button>
            </div>
            {activeIssuances.length === 0
              ? <div className="dash-card-empty">Нет активных выдач</div>
              : activeIssuances.map(iss => (
                <div key={iss.id} className="dash-row">
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div className="dash-row-title">
                      <span className="dash-row-title-text">{iss.receiver_name || `Выдача #${String(iss.id).slice(0, 8)}`}</span>
                      {iss._isRent && <span className="dash-badge dash-badge-public">От партнёров</span>}
                      {iss.return_requested_at && <span className="dash-badge dash-badge-return">Возврат</span>}
                    </div>
                    <div className="dash-row-sub">
                      {iss.project_name && `${iss.project_name} · `}
                      {(iss.unit_ids || []).length} ед.
                      {iss.deadline ? ` · до ${formatDate(iss.deadline)}` : ''}
                    </div>
                  </div>
                  <Button variant={iss.return_requested_at ? 'primary' : 'secondary'} size="sm"
                    onClick={() => iss._isRent ? navigate(`/return/rent/${iss._rentId}`) : navigate(`/return/${iss.id}`)}>
                    Возврат
                  </Button>
                </div>
              ))
            }
          </div>
        </div>

        {/* Вернули + Поступления — 2 колонки */}
        <div className="dash-cards">
          <div className="dash-card">
            <div className="dash-card-head">
              <span className="dash-card-title">Вернули</span>
              <button className="dash-card-link" onClick={() => navigate('/requests?status=returned')}>
                Вернули <ChevronRight size={12} />
              </button>
            </div>
            {returned.length === 0
              ? <div className="dash-card-empty">Пока возвратов нет</div>
              : returned.map(r => (
                <div
                  key={r.id}
                  className={`dash-row${r.unitId ? ' clickable' : ''}`}
                  onClick={() => r.unitId ? setOpenUnitId(r.unitId) : null}
                >
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div className="dash-row-title">{r.title}</div>
                    <div className="dash-row-sub">{r.sub}</div>
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--subtle)', flexShrink: 0, whiteSpace: 'nowrap' }}>
                    {formatDateTime(r.when)}
                  </div>
                </div>
              ))
            }
          </div>

          <div className="dash-card">
            <div className="dash-card-head">
              <span className="dash-card-title">Последние добавленные</span>
              <button className="dash-card-link" onClick={() => navigate('/units')}>
                Все <ChevronRight size={12} />
              </button>
            </div>
            {receipts.length === 0
              ? <div className="dash-card-empty">Пока нет новых единиц</div>
              : receipts.map(u => (
                <div key={u.id} className="dash-row clickable" onClick={() => setOpenUnitId(u.id)}>
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div className="dash-row-title">{u.name}</div>
                    <div className="dash-row-sub">
                      {formatReceiptLocation(u)} · {timeAgo(u.created_at)}
                    </div>
                  </div>
                  <ChevronRight size={14} style={{ color: 'var(--subtle)', flexShrink: 0 }} />
                </div>
              ))
            }
          </div>
        </div>

        {/* Куплено у проектов — отдельная категория (не «выдано складом») */}
        <div className="dash-cards">
          <div className="dash-card" style={{ gridColumn: '1 / -1' }}>
            <div className="dash-card-head">
              <span className="dash-card-title">Куплено у проектов</span>
              <span className="dash-card-link" style={{ cursor: 'default' }}>
                {purchased.totals.qty} ед. · {fmtMoney(purchased.totals.value)}
              </span>
            </div>
            {(!purchased.projects || purchased.projects.length === 0)
              ? <div className="dash-card-empty">Проекты пока ничего не покупали</div>
              : purchased.projects.map(p => (
                <div key={p.id} className="dash-row">
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div className="dash-row-title">
                      <span className="dash-row-title-text">{p.name}</span>
                    </div>
                    <div className="dash-row-sub">
                      {(p.items || []).slice(0, 3).map(i => i.name).join(', ')}
                      {(p.items || []).length > 3 ? ` +${p.items.length - 3}` : ''}
                    </div>
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--muted)', flexShrink: 0, whiteSpace: 'nowrap', textAlign: 'right' }}>
                    {p.qty} ед.<br />{fmtMoney(p.value)}
                  </div>
                </div>
              ))
            }
          </div>
        </div>
      </div>

      {openUnitId && (
        <UnitCardModal
          unitId={openUnitId}
          onClose={() => setOpenUnitId(null)}
          onChanged={() => unitsApi.list({}).then(d => setReceipts((d.units || []).slice(0, 5))).catch(() => {})}
        />
      )}
    </WarehouseLayout>
  )
}
