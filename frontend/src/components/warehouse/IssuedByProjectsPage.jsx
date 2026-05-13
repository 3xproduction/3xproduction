// «Движение» — единый раздел управления реквизитом: заявки, выдачи,
// возвраты и акты. Все подвкладки рендерятся одинаковой иерархией
// «Проект → Получатель → Единицы/Акты», меняются только источник данных,
// статистика, рендерер строк и набор действий.
//
// Источники (backend GET /issued/by-projects?view=...):
//   • issued    — выданное (status='issued'/'overdue', return_requested_at IS NULL)
//   • returning — запрошен возврат (return_requested_at IS NOT NULL)
//   • returned  — закрытые возвраты (есть returns row)
//   • new       — заявки в работе склада (status IN new/collecting/ready)
//   • all       — issued + returning
//   • acts      — все PDF-акты выдач/возвратов (включая партнёрские)
//
// Партнёрская аренда (rent_deals.type='out') добавляется в каждый view
// виртуальным проектом «Партнёрская аренда».
import { useEffect, useState, createContext, useContext } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import {
  ChevronDown, ChevronRight, AlertTriangle, Send, Package,
  Film, Handshake, FileCheck, ExternalLink, SlidersHorizontal,
  CheckCircle2, RotateCcw,
} from 'lucide-react'
import WarehouseLayout from './WarehouseLayout'
import ProductionLayout from '../production/ProductionLayout'
import Button from '../shared/Button'
import UnitCardModal from '../shared/UnitCardModal'
import { issued as issuedApi, projectUnits as projectUnitsApi, rent as rentApi, requests as requestsApi } from '../../services/api'
import { useToast } from '../shared/Toast'

// Открытие UnitCardModal с глубины дерева — без проброса setCardId через все
// уровни (проект → получатель → ItemRow). Провайдер ставит главный компонент.
const OpenUnitContext = createContext(() => {})

function fmtCurrency(v) {
  return new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 }).format(v || 0) + ' ₽'
}
function fmtDate(d) {
  if (!d) return ''
  return new Date(d).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' })
}

const css = `
.phv-page {
  padding: 28px 32px;
  max-width: 1200px;
}
.phv-head {
  display: flex; align-items: baseline; gap: 12px;
  margin-bottom: 22px;
}
.phv-title { font-size: 24px; font-weight: 600; flex: 1; letter-spacing: -0.03em; }

/* Подвкладки раздела «Движение»: Все/Новые/Выданы/Возвращают/Вернули/Акты.
   Pill-chip стиль — крупные цели для тапа на мобиле, активный таб залит
   акцентом (так же как фильтры в «Запросах»). */
.phv-tabs {
  display: flex; gap: 6px;
  margin: 0 0 18px;
  overflow-x: auto;
  scrollbar-width: none;
  padding-bottom: 4px;
}
.phv-tabs::-webkit-scrollbar { display: none; }
.phv-tab {
  padding: 8px 16px; font-size: 13px; font-weight: 500;
  border: 1px solid var(--border); background: var(--card);
  color: var(--text);
  border-radius: 22px;
  cursor: pointer; white-space: nowrap;
  transition: all 0.12s;
  font-family: inherit;
}
.phv-tab:hover { border-color: var(--accent); }
.phv-tab.active {
  background: var(--accent); color: #fff; border-color: var(--accent);
}

/* Mobile filter button (≤768px) — заменяет ряд chip-табов на одну
   кнопку-селектор с активным значением. Тап → bottom-sheet с 4 пунктами. */
.phv-filter-btn {
  display: none;
  align-items: center; gap: 8px;
  width: 100%;
  height: 42px;
  padding: 0 14px;
  background: var(--card); border: 1px solid var(--border);
  border-radius: var(--radius-btn);
  font-size: 14px; font-weight: 500;
  color: var(--text);
  cursor: pointer;
  font-family: inherit;
  margin-bottom: 14px;
}
.phv-filter-btn-label { color: var(--muted); font-weight: 400; flex-shrink: 0; }
.phv-filter-btn-value { flex: 1; text-align: left; font-weight: 600; }
@media (max-width: 768px) {
  .phv-tabs { display: none !important; }
  .phv-filter-btn { display: flex; }
}

/* Bottom-sheet с фильтром (мобилка) */
.phv-sheet-overlay {
  position: fixed; inset: 0; z-index: 300;
  background: rgba(0,0,0,0.5);
  backdrop-filter: blur(2px);
  display: flex; align-items: flex-end;
}
.phv-sheet {
  background: #fff;
  width: 100%;
  border-radius: 18px 18px 0 0;
  padding: 8px 16px max(20px, env(safe-area-inset-bottom));
}
.phv-sheet-handle {
  width: 36px; height: 4px; border-radius: 4px;
  background: var(--border-strong, #d1d5db);
  margin: 8px auto 14px;
}
.phv-sheet-title {
  font-size: 11px; font-weight: 600;
  letter-spacing: 0.08em; text-transform: uppercase;
  color: var(--muted);
  padding: 0 4px 8px;
}
.phv-sheet-item {
  display: block;
  width: 100%;
  padding: 14px 4px;
  border: none; border-bottom: 1px solid var(--border);
  background: none; text-align: left;
  font-size: 15px; font-weight: 450;
  color: var(--text);
  font-family: inherit;
  cursor: pointer;
}
.phv-sheet-item:last-of-type { border-bottom: none; }
.phv-sheet-item.active { color: var(--gold-600); font-weight: 600; }

/* Period chips для returned/acts — справа над списком, на мобиле под табами. */
.phv-period {
  display: flex; gap: 6px;
  margin: -4px 0 14px;
  flex-wrap: wrap;
}
.phv-period-label {
  font-size: 11px; font-weight: 600;
  letter-spacing: 0.06em; text-transform: uppercase;
  color: var(--muted);
  align-self: center;
  margin-right: 4px;
}
.phv-period-chip {
  padding: 5px 12px; font-size: 12.5px; font-weight: 500;
  border: 1px solid var(--border); background: var(--card);
  color: var(--text);
  border-radius: 14px;
  cursor: pointer; white-space: nowrap;
  font-family: inherit;
}
.phv-period-chip.active {
  background: var(--accent); color: #fff; border-color: var(--accent);
}

.phv-stats {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 12px;
  margin-bottom: 20px;
}
@media (max-width: 1024px) {
  .phv-stats { grid-template-columns: repeat(2, 1fr); }
}
.phv-stat {
  padding: 12px 14px;
  border-radius: var(--radius-card);
  border: 1px solid var(--border);
  background: var(--card, var(--white));
}
.phv-stat-label {
  font-size: 11px; color: var(--muted);
  text-transform: uppercase; letter-spacing: 0.04em;
  font-weight: 500;
}
.phv-stat-value {
  font-size: 20px; font-weight: 600; color: var(--text);
  margin-top: 4px; letter-spacing: -0.02em;
}

.phv-search-wrap { position: relative; margin-bottom: 16px; }
.phv-search-input {
  width: 100%; height: 42px;
  padding: 0 12px;
  border: 1px solid var(--border);
  border-radius: var(--radius-btn);
  background: var(--white);
  font-size: 14px; outline: none;
  font-family: inherit;
  transition: border-color 0.12s;
}
.phv-search-input:focus { border-color: var(--gold-500); }

.phv-empty {
  text-align: center;
  color: var(--muted);
  padding: 60px 16px 40px;
  font-size: 14px;
}
.phv-empty b { color: var(--text); display: block; margin-bottom: 4px; font-size: 15px; font-weight: 600; }

.phv-error {
  padding: 12px 14px;
  border-radius: var(--radius-card);
  background: var(--red-bg, #fee);
  color: var(--red);
  font-size: 13px;
  margin-bottom: 14px;
}

.phv-list { display: flex; flex-direction: column; gap: 10px; }

.phv-proj {
  border-radius: var(--radius-card);
  border: 1px solid var(--border);
  background: var(--card, var(--white));
  overflow: hidden;
}
.phv-proj-head {
  display: flex; align-items: center; gap: 12px;
  padding: 14px;
  cursor: pointer; user-select: none;
  transition: background 0.1s;
}
.phv-proj-head:hover { background: var(--bg-secondary); }
.phv-proj-icon {
  width: 36px; height: 36px;
  border-radius: 9px;
  background: var(--gold-100);
  color: var(--gold-600);
  display: flex; align-items: center; justify-content: center;
  flex-shrink: 0;
}
.phv-proj-icon.rent {
  background: var(--green-dim, rgba(16,185,129,0.12));
  color: var(--green, #10b981);
}
.phv-proj-icon.acts {
  background: var(--blue-dim, rgba(59,130,246,0.12));
  color: var(--blue, #3b82f6);
}
.phv-proj-info { flex: 1; min-width: 0; }
.phv-proj-name {
  font-weight: 600; font-size: 15px;
  display: flex; align-items: center; gap: 8px;
  flex-wrap: wrap;
  letter-spacing: -0.01em;
}
.phv-proj-name-text {
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  min-width: 0;
}
.phv-proj-sub {
  font-size: 12.5px; color: var(--muted);
  margin-top: 2px;
}

.phv-badge {
  font-size: 10.5px; font-weight: 600;
  padding: 2px 7px;
  border-radius: 6px;
  letter-spacing: 0.02em; text-transform: uppercase;
  flex-shrink: 0;
  white-space: nowrap;
}
.phv-badge-overdue { background: var(--red-bg, #fee); color: var(--red); }
.phv-badge-pending { background: var(--gold-100, #fef3c7); color: var(--gold-600, #C9A55C); }
.phv-badge-rent    { background: var(--green-dim, rgba(16,185,129,0.12)); color: var(--green, #10b981); }
.phv-badge-late    { background: var(--amber-dim, rgba(245,158,11,0.14)); color: var(--amber, #d97706); }
.phv-badge-issue   { background: var(--gold-100); color: var(--gold-600); }
.phv-badge-return  { background: var(--green-dim, rgba(16,185,129,0.12)); color: var(--green, #10b981); }

.phv-proj-body {
  padding: 0 14px 14px;
  display: flex; flex-direction: column; gap: 8px;
}

.phv-person {
  border-radius: var(--radius-card);
  border: 1px solid var(--border);
  background: var(--bg-secondary, #fafafa);
  overflow: hidden;
}
.phv-person-head {
  display: flex; align-items: center; gap: 10px;
  padding: 10px 12px;
  cursor: pointer;
}
.phv-person-info { flex: 1; min-width: 0; }
.phv-person-name {
  font-weight: 500; font-size: 14px;
  display: flex; align-items: center; gap: 6px;
  flex-wrap: wrap;
}
.phv-person-name-text {
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  min-width: 0;
}
.phv-person-role {
  font-size: 11px; color: var(--muted); font-weight: 400;
}
.phv-person-sub { font-size: 12px; color: var(--muted); margin-top: 2px; }
.phv-person-actions {
  display: flex; gap: 6px;
  flex-shrink: 0;
  flex-wrap: wrap;
}

.phv-items {
  padding: 0 12px 12px;
  display: flex; flex-direction: column; gap: 6px;
}
.phv-item {
  display: flex; align-items: center; gap: 10px;
  padding: 8px 10px;
  border-radius: 8px;
  background: var(--white);
  border: 1px solid var(--border);
}
.phv-item-thumb {
  width: 40px; height: 40px;
  border-radius: 6px; overflow: hidden;
  background: var(--bg-secondary);
  flex-shrink: 0;
}
.phv-item-thumb img {
  width: 100%; height: 100%; object-fit: cover;
}
.phv-item-thumb.icon {
  display: flex; align-items: center; justify-content: center;
  background: var(--gold-100); color: var(--gold-600);
}
.phv-item-thumb.icon-return {
  background: var(--green-dim, rgba(16,185,129,0.12));
  color: var(--green, #10b981);
}
.phv-item-info { flex: 1; min-width: 0; }
.phv-item-name {
  font-weight: 500; font-size: 13px;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  color: inherit; text-decoration: none;
  display: block;
}
.phv-item-name:hover { color: var(--gold-600); }
.phv-item-sub {
  font-size: 11px; color: var(--muted);
  margin-top: 1px;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.phv-item-sub.overdue { color: var(--red); }
.phv-item-sub.late    { color: var(--amber, #d97706); }
.phv-item-actions {
  display: flex; gap: 6px;
  flex-shrink: 0;
}
.phv-pdf-link {
  display: inline-flex; align-items: center; gap: 4px;
  padding: 6px 10px; border-radius: 8px;
  background: var(--accent-dim); color: var(--accent);
  font-size: 12px; font-weight: 500;
  text-decoration: none;
  flex-shrink: 0;
}
.phv-pdf-link:hover { background: var(--accent); color: #fff; }

.phv-bulk-row {
  display: flex; justify-content: flex-end;
  padding-top: 4px;
}

@media (max-width: 768px) {
  .phv-page { padding: 14px 12px; max-width: none; }
  .phv-head {
    position: sticky;
    top: var(--page-sticky-top, 52px);
    z-index: 12;
    background: var(--paper);
    margin: -14px -12px 14px;
    padding: 12px 14px;
    border-bottom: 1px solid var(--border);
  }
  .phv-title { font-size: 18px; }
  .phv-stats {
    grid-template-columns: repeat(2, 1fr);
    gap: 8px;
    margin-bottom: 14px;
  }
  .phv-stat { padding: 10px 12px; }
  .phv-stat-value { font-size: 17px; }

  .phv-proj-head { padding: 12px; gap: 10px; }
  .phv-proj-icon { width: 32px; height: 32px; }
  .phv-proj-name { font-size: 14.5px; gap: 6px; }
  .phv-proj-body { padding: 0 10px 10px; }

  .phv-person-head {
    flex-wrap: wrap;
    padding: 10px;
  }
  .phv-person-info { flex-basis: 100%; min-width: 0; }
  .phv-person-actions {
    flex-basis: 100%;
    justify-content: flex-end;
  }
  .phv-person-actions > * { flex: 1; }
  .phv-items { padding: 0 10px 10px; }
  .phv-item { flex-wrap: wrap; }
  .phv-item-info { min-width: 0; flex: 1; }
  .phv-pdf-link { flex-shrink: 0; }
}

@media (min-width: 769px) and (max-width: 1024px) {
  .phv-page { padding: 22px 24px; }
}
`

// ── Конфигурация подвкладок ─────────────────────────────────────────────────
// «Все» и «Акты» удалены 2026-05-04 — акты переехали как PDF-линк прямо в
// строки получателей раздела (Выданы / Возвращают / Вернули), отдельный таб
// больше не нужен. «Все» — избыточный агрегат.
const VIEWS = [
  { key: 'new',       label: 'Новые' },
  { key: 'issued',    label: 'Выданы' },
  { key: 'returning', label: 'Возвращают' },
  { key: 'returned',  label: 'Вернули' },
]

const PERIOD_CHIPS = [
  { value: '30',  label: '30 дн' },
  { value: '90',  label: '90 дн' },
  { value: 'all', label: 'Все' },
]
const PERIOD_VIEWS = new Set(['returned'])

// Лейблы 4-х stat-плиток для каждого view. Значения вытягиваем из data.totals
// и дополнительных counter'ов на уровне фронта (просрочки/late-returns).
function getStats(view, data) {
  if (!data) return [{}, {}, {}, {}]
  const t = data.totals || {}
  const overdueCount  = (data.projects || []).reduce((s, p) =>
    s + p.people.reduce((s2, ps) => s2 + ps.items.filter(i => i.status === 'overdue').length, 0), 0)
  const lateCount     = (data.projects || []).reduce((s, p) =>
    s + p.people.reduce((s2, ps) => s2 + ps.items.filter(i => i.late).length, 0), 0)
  const issueActs  = (data.projects || []).reduce((s, p) =>
    s + p.people.reduce((s2, ps) => s2 + ps.items.filter(i => i.kind === 'issue' || i.kind === 'rent_issue').length, 0), 0)
  const returnActs = (data.projects || []).reduce((s, p) =>
    s + p.people.reduce((s2, ps) => s2 + ps.items.filter(i => i.kind === 'return' || i.kind === 'rent_return').length, 0), 0)

  switch (view) {
    case 'issued':
      return [
        { label: 'На руках',     value: `${t.qty} ед.` },
        { label: 'Просрочено',   value: `${overdueCount} ед.` },
        { label: 'Получателей',  value: t.people },
        { label: 'Стоимость',    value: fmtCurrency(t.value) },
      ]
    case 'returning':
      return [
        { label: 'Ждут возврата', value: `${t.qty} ед.` },
        { label: 'Просрочено',    value: `${overdueCount} ед.` },
        { label: 'Получателей',   value: t.people },
        { label: 'Стоимость',     value: fmtCurrency(t.value) },
      ]
    case 'returned':
      return [
        { label: 'Возвращено',   value: `${t.qty} ед.` },
        { label: 'С опозданием', value: `${lateCount} ед.` },
        { label: 'Проектов',     value: t.projects },
        { label: 'Стоимость',    value: fmtCurrency(t.value) },
      ]
    case 'new':
      return [
        { label: 'В работе',     value: `${t.qty} ед.` },
        // t.requests добавлен в backend (issued.js finalizeHierarchy) —
        // считает уникальные request_id, чтобы счётчик отражал реальное
        // число заявок, а не число заявителей. Fallback на t.people для
        // совместимости со старыми ревизиями (если бэк ещё на v2.54).
        { label: 'Заявок',       value: t.requests ?? t.people },
        { label: 'Проектов',     value: t.projects },
        { label: 'Стоимость',    value: fmtCurrency(t.value) },
      ]
    case 'all':
      return [
        { label: 'В обороте',    value: `${t.qty} ед.` },
        { label: 'Просрочено',   value: `${overdueCount} ед.` },
        { label: 'Получателей',  value: t.people },
        { label: 'Стоимость',    value: fmtCurrency(t.value) },
      ]
    case 'acts':
      return [
        { label: 'Актов выдач',    value: issueActs },
        { label: 'Актов возвратов', value: returnActs },
        { label: 'Проектов',        value: t.projects },
        { label: 'Всего актов',     value: t.qty },
      ]
    default: return [{}, {}, {}, {}]
  }
}

function getEmpty(view, hasFilter) {
  if (hasFilter) return { hint: 'Ничего не найдено по фильтру' }
  switch (view) {
    case 'issued':    return { title: 'Всё на складе', hint: 'Невозвращённых выдач нет' }
    case 'returning': return { title: 'Ждут возврата — пусто', hint: 'Нет запрошенных возвратов' }
    case 'returned':  return { title: 'Возвратов за период нет', hint: 'Попробуй увеличить период' }
    case 'new':       return { title: 'Новых заявок нет', hint: 'Все заявки в работе или закрыты' }
    case 'all':       return { title: 'Всё на складе', hint: 'Активных выдач нет' }
    case 'acts':      return { title: 'Актов за период нет', hint: 'Попробуй увеличить период' }
    default: return { title: 'Пусто' }
  }
}

export default function IssuedByProjectsPage({ scope = 'warehouse' } = {}) {
  // scope='producer' → используем ProductionLayout, бэкенд фильтрует данные
  // по project_id текущего юзера. Действия выдачи/walkin-возврата скрыты,
  // т.к. это операции склада.
  const Layout = scope === 'producer' ? ProductionLayout : WarehouseLayout
  const isProducer = scope === 'producer'
  const navigate = useNavigate()
  const toast = useToast()
  const [searchParams, setSearchParams] = useSearchParams()

  const initialView = searchParams.get('view')
  const expandFromUrl = searchParams.get('project')
  const [view, setView] = useState(
    VIEWS.some(v => v.key === initialView) ? initialView : 'issued'
  )
  const [days, setDays] = useState(searchParams.get('days') || '30')

  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [openProjects, setOpenProjects] = useState(() =>
    expandFromUrl ? new Set([expandFromUrl]) : new Set()
  )
  const [openPeople, setOpenPeople] = useState(new Set())
  const [busyAction, setBusyAction] = useState(null)
  const [filterSheetOpen, setFilterSheetOpen] = useState(false)
  const [cardId, setCardId] = useState(null)

  async function reload() {
    setLoading(true)
    try {
      const params = PERIOD_VIEWS.has(view) ? { days } : {}
      const r = await issuedApi.byProjects(view, params)
      setData(r)
      setError('')
    } catch (err) {
      setError(err?.message || 'Ошибка загрузки')
    } finally {
      setLoading(false)
    }
  }
  useEffect(() => { reload() }, [view, days])

  // Если ?project=ID есть — раскрываем сразу.
  useEffect(() => {
    if (expandFromUrl && data) setOpenProjects(s => new Set([...s, expandFromUrl]))
  }, [expandFromUrl, data])

  // Синхронизируем view/days в URL — для шаринга и кнопки «назад».
  useEffect(() => {
    const next = new URLSearchParams(searchParams)
    if (view === 'issued') next.delete('view'); else next.set('view', view)
    if (PERIOD_VIEWS.has(view) && days !== '30') next.set('days', days)
    else next.delete('days')
    setSearchParams(next, { replace: true })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, days])

  // Клиентский фильтр поиска удалён 2026-05-04 (по запросу пользователя).
  // Все товары/получатели видны без сужения.
  const filtered = data

  function toggleProject(id) {
    setOpenProjects(s => {
      const next = new Set(s)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }
  function togglePerson(id) {
    setOpenPeople(s => {
      const next = new Set(s)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }

  // ── Действия ────────────────────────────────────────────────────────────
  async function withBusy(key, fn) {
    if (busyAction) return
    setBusyAction(key)
    try { await fn() }
    catch (err) { toast?.(err?.message || 'Ошибка', 'error') }
    finally { setBusyAction(null) }
  }

  async function runProjectStockBatch(tasks, emptyMessage) {
    if (!tasks.length) {
      toast?.(emptyMessage, 'info')
      return 0
    }
    const results = await Promise.allSettled(tasks.map(fn => fn()))
    const failed = results.filter(r => r.status === 'rejected')
    if (failed.length) {
      throw new Error(`Не удалось обработать ${failed.length} из ${tasks.length} ед.`)
    }
    return tasks.length
  }

  function actRequestReturnProject(projectId) {
    return withBusy(`project:${projectId}`, async () => {
      await issuedApi.requestReturnByProject(projectId)
      toast?.('Возврат запрошен — получатели получили уведомления', 'success')
      await reload()
    })
  }
  function actRequestReturnUser(userId) {
    return withBusy(`user:${userId}`, async () => {
      await issuedApi.requestReturnByUser(userId)
      toast?.('Возврат запрошен — получатель получил уведомление', 'success')
      await reload()
    })
  }
  function actCancelReturnIssuance(issuanceId) {
    return withBusy(`cancel:${issuanceId}`, async () => {
      await issuedApi.cancelReturnRequestByIssuance(issuanceId)
      toast?.('Запрос возврата отменён', 'success')
      await reload()
    })
  }
  function actCancelReturnRent(dealId) {
    return withBusy(`cancel-rent:${dealId}`, async () => {
      await rentApi.cancelReturnRequest(dealId)
      toast?.('Запрос возврата отменён', 'success')
      await reload()
    })
  }
  function actAcceptReturnUser(userId) {
    navigate(`/walkin/return/${userId}`)
  }
  function actAcceptReturnRent(dealId) {
    navigate(`/return/rent/${dealId}`)
  }
  function actRequestReturnProjectStock(person) {
    const items = (person.items || []).filter(it => it.unit_id && !it.return_request_id)
    const key = `project-stock-request:${person.project_id || 'unknown'}`
    return withBusy(key, async () => {
      const done = await runProjectStockBatch(
        items.map(it => () => projectUnitsApi.requestReturn(it.unit_id)),
        'Возврат уже запрошен'
      )
      if (done) toast?.(`Возврат запрошен: ${done} ед.`, 'success')
      await reload()
    })
  }
  function actAcceptProjectStock(person) {
    const items = (person.items || []).filter(it => it.unit_id)
    const key = `project-stock-accept:${person.project_id || 'unknown'}`
    return withBusy(key, async () => {
      const done = await runProjectStockBatch(
        items.map(it => () => it.return_request_id
          ? projectUnitsApi.confirmReturn(it.return_request_id)
          : projectUnitsApi.transfer(it.unit_id, 'Принято со склада проекта')),
        'Нет единиц для приёмки'
      )
      if (done) toast?.(`Принято: ${done} ед.`, 'success')
      await reload()
    })
  }
  function actCancelProjectStock(person) {
    const items = (person.items || []).filter(it => it.return_request_id)
    const key = `project-stock-cancel:${person.project_id || 'unknown'}`
    return withBusy(key, async () => {
      const done = await runProjectStockBatch(
        items.map(it => () => projectUnitsApi.cancelReturn(it.return_request_id)),
        'Нет активного запроса возврата'
      )
      if (done) toast?.('Запрос возврата отменён', 'success')
      await reload()
    })
  }
  // Для view='new': переходы по этапам заявки.
  function actChangeRequestStatus(requestId, status) {
    return withBusy(`req:${requestId}`, async () => {
      await requestsApi.status(requestId, status)
      toast?.(status === 'cancelled' ? 'Заявка отменена' : 'Статус обновлён', 'success')
      await reload()
    })
  }
  function actChangeRentStage(dealId, stage) {
    return withBusy(`rent-stage:${dealId}`, async () => {
      await rentApi.workflowStage(dealId, stage)
      toast?.('Статус обновлён', 'success')
      await reload()
    })
  }
  function actCancelRent(dealId) {
    return withBusy(`rent-cancel:${dealId}`, async () => {
      await rentApi.status(dealId, 'cancelled')
      toast?.('Заявка отменена', 'success')
      await reload()
    })
  }
  function actGoIssue(item) {
    if (item.source === 'rent') navigate(`/issue/rent/${item.deal_id}`)
    else if (item.request_id) navigate(`/issue/${item.request_id}`)
  }

  const isEmpty = !loading && (!filtered || filtered.projects.length === 0)
  const empty = getEmpty(view, false)
  const stats = getStats(view, data)

  return (
    <Layout>
      <OpenUnitContext.Provider value={setCardId}>
      <style>{css}</style>
      <div className="phv-page">
        <div className="phv-head">
          <h1 className="phv-title">Движение</h1>
        </div>

        {/* Подвкладки раздела. На десктопе — chip-ряд, на мобиле скрыт
            и заменён на кнопку-селектор + bottom-sheet (см. ниже). */}
        <div className="phv-tabs" role="tablist">
          {VIEWS.map(v => (
            <button
              key={v.key}
              role="tab"
              aria-selected={view === v.key}
              className={`phv-tab${view === v.key ? ' active' : ''}`}
              onClick={() => setView(v.key)}
            >
              {v.label}
            </button>
          ))}
        </div>

        {/* Mobile-only filter button — открывает bottom-sheet. */}
        <button className="phv-filter-btn" onClick={() => setFilterSheetOpen(true)}>
          <SlidersHorizontal size={16} color="var(--muted)" />
          <span className="phv-filter-btn-label">Фильтр:</span>
          <span className="phv-filter-btn-value">
            {(VIEWS.find(v => v.key === view) || VIEWS[0]).label}
          </span>
          <ChevronDown size={16} color="var(--muted)" />
        </button>

        {/* Period chips для returned/acts */}
        {PERIOD_VIEWS.has(view) && (
          <div className="phv-period">
            <div className="phv-period-label">Период:</div>
            {PERIOD_CHIPS.map(c => (
              <button
                key={c.value}
                className={`phv-period-chip${days === c.value ? ' active' : ''}`}
                onClick={() => setDays(c.value)}
              >
                {c.label}
              </button>
            ))}
          </div>
        )}

        {data && (
          <div className="phv-stats">
            {stats.map((s, i) => <Stat key={i} label={s.label} value={s.value} />)}
          </div>
        )}

        {error && <div className="phv-error">{error}</div>}

        {loading && <div className="phv-empty">Загрузка…</div>}

        {!loading && isEmpty && (
          <div className="phv-empty">
            {empty.title && <b>{empty.title}</b>}
            {empty.hint}
          </div>
        )}

        {filterSheetOpen && (
          <div className="phv-sheet-overlay" onClick={() => setFilterSheetOpen(false)}>
            <div className="phv-sheet" onClick={e => e.stopPropagation()}>
              <div className="phv-sheet-handle" />
              <div className="phv-sheet-title">Раздел движения</div>
              {VIEWS.map(v => (
                <button
                  key={v.key}
                  className={`phv-sheet-item${view === v.key ? ' active' : ''}`}
                  onClick={() => { setView(v.key); setFilterSheetOpen(false) }}
                >
                  {v.label}
                </button>
              ))}
            </div>
          </div>
        )}

        {!loading && !isEmpty && (
          <div className="phv-list">
            {filtered.projects.map(proj => {
              const projKey = proj.kind === 'rent' ? 'rent' : (proj.id || 'no_project')
              return (
                <ProjectRow
                  key={projKey}
                  proj={proj}
                  view={view}
                  isOpen={openProjects.has(projKey)}
                  onToggle={() => toggleProject(projKey)}
                  openPeople={openPeople}
                  onTogglePerson={togglePerson}
                  busyAction={busyAction}
                  actions={isProducer ? {
                    // Продюсер: только просмотр и отмена своих запросов возврата.
                    cancelReturnIssuance: actCancelReturnIssuance,
                    cancelReturnRent: actCancelReturnRent,
                  } : {
                    requestReturnProject: actRequestReturnProject,
                    requestReturnUser: actRequestReturnUser,
                    cancelReturnIssuance: actCancelReturnIssuance,
                    cancelReturnRent: actCancelReturnRent,
                    acceptReturnUser: actAcceptReturnUser,
                    acceptReturnRent: actAcceptReturnRent,
                    requestReturnProjectStock: actRequestReturnProjectStock,
                    acceptProjectStock: actAcceptProjectStock,
                    cancelProjectStock: actCancelProjectStock,
                    changeRequestStatus: actChangeRequestStatus,
                    changeRentStage: actChangeRentStage,
                    cancelRent: actCancelRent,
                    goIssue: actGoIssue,
                  }}
                />
              )
            })}
          </div>
        )}
      </div>
      {cardId && <UnitCardModal unitId={cardId} onClose={() => setCardId(null)} onChanged={reload} />}
      </OpenUnitContext.Provider>
    </Layout>
  )
}

function Stat({ label, value }) {
  return (
    <div className="phv-stat">
      <div className="phv-stat-label">{label}</div>
      <div className="phv-stat-value">{value}</div>
    </div>
  )
}

function ProjectRow({ proj, view, isOpen, onToggle, openPeople, onTogglePerson, busyAction, actions }) {
  const isRent = proj.kind === 'rent'
  const Icon = isRent ? Handshake : Film
  const iconClass = isRent ? 'rent' : ''

  return (
    <div className="phv-proj">
      <div className="phv-proj-head" onClick={onToggle}>
        {isOpen
          ? <ChevronDown size={18} style={{ flexShrink: 0, color: 'var(--muted)' }} />
          : <ChevronRight size={18} style={{ flexShrink: 0, color: 'var(--muted)' }} />}
        <div className={`phv-proj-icon ${iconClass}`}>
          <Icon size={18} strokeWidth={1.8} />
        </div>
        <div className="phv-proj-info">
          <div className="phv-proj-name">
            <span className="phv-proj-name-text">{proj.name}</span>
            {isRent && <span className="phv-badge phv-badge-rent">Аренда</span>}
            {proj.has_overdue && <span className="phv-badge phv-badge-overdue">Просрочено</span>}
            {proj.has_pending_return && view === 'issued' && (
              <span className="phv-badge phv-badge-pending">Возврат запрошен</span>
            )}
            {proj.has_late_return && view === 'returned' && (
              <span className="phv-badge phv-badge-late">С опозданием</span>
            )}
          </div>
          <div className="phv-proj-sub">
            {projSubtitle(proj, view)}
          </div>
        </div>
      </div>
      {isOpen && (
        <div className="phv-proj-body">
          {proj.people.map(person => {
            // С v2.55 в view=new одна person-row = одна заявка, поэтому
            // request_id входит в ключ — иначе React кидает duplicate-key
            // и openPeople схлопывал/раскрывал все строки одного человека
            // одновременно.
            const personKey = (person.user_id || person.deal_id || person.request_id || person.project_id || person.name)
              + (person.request_id ? `|${person.request_id}` : '')
              + (person.source ? `|${person.source}` : '')
            return (
              <PersonRow
                key={personKey}
                person={person}
                view={view}
                isOpen={openPeople.has(personKey)}
                onToggle={() => onTogglePerson(personKey)}
                busyAction={busyAction}
                actions={actions}
              />
            )
          })}
          {/* Project-level bulk action: только для view='issued' и обычного проекта. */}
          {!isRent && proj.id && view === 'issued' && actions.requestReturnProject && (
            <div className="phv-bulk-row">
              <Button
                variant="secondary"
                size="sm"
                onClick={() => actions.requestReturnProject(proj.id)}
                loading={busyAction === `project:${proj.id}`}
                disabled={!!busyAction || proj.has_pending_return}
              >
                <Send size={14} /> Запросить возврат всего
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function projSubtitle(proj, view) {
  const peopleCount = proj.people.length
  if (view === 'acts') {
    return `${proj.qty} актов · ${peopleCount} ${pluralize(peopleCount, ['получатель', 'получателя', 'получателей'])}`
  }
  if (view === 'new') {
    // С v2.55 backend в viewNew группирует person-rows по (user_id, request_id),
    // т.е. proj.people.length = количество заявок проекта. Лейбл подстраиваем.
    const reqCount = peopleCount
    return `${proj.qty} ед. · ${fmtCurrency(proj.value)} · ${reqCount} ${pluralize(reqCount, ['заявка', 'заявки', 'заявок'])}`
  }
  return `${proj.qty} ед. · ${fmtCurrency(proj.value)} · ${peopleCount} ${pluralize(peopleCount, ['получатель', 'получателя', 'получателей'])}`
}

function PersonRow({ person, view, isOpen, onToggle, busyAction, actions }) {
  const isRent = person.source === 'rent'
  return (
    <div className="phv-person">
      <div className="phv-person-head" onClick={onToggle}>
        {isOpen
          ? <ChevronDown size={16} style={{ flexShrink: 0, color: 'var(--muted)' }} />
          : <ChevronRight size={16} style={{ flexShrink: 0, color: 'var(--muted)' }} />}
        <div className="phv-person-info">
          <div className="phv-person-name">
            <span style={{ flexShrink: 0 }}>{isRent ? '🤝' : '👤'}</span>
            <span className="phv-person-name-text">{person.name}</span>
            {!isRent && person.role && <span className="phv-person-role">{person.role}</span>}
            {person.is_provisional && <span className="phv-badge phv-badge-pending">Не активирован</span>}
            {person.has_overdue && <AlertTriangle size={12} color="var(--red)" style={{ flexShrink: 0 }} />}
          </div>
          <div className="phv-person-sub">
            {personSubtitle(person, view)}
          </div>
        </div>
        <div onClick={e => e.stopPropagation()} className="phv-person-actions">
          <PersonActions person={person} view={view} busyAction={busyAction} actions={actions} />
        </div>
      </div>
      {isOpen && (
        <div className="phv-items">
          {person.items.map((item, idx) => (
            <ItemRow
              key={(item.unit_id || item.issuance_id || item.deal_id) + '_' + idx}
              item={item}
              view={view}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function personSubtitle(person, view) {
  if (view === 'acts') {
    return `${person.qty} ${pluralize(person.qty, ['акт', 'акта', 'актов'])}${person.contact ? ` · ${person.contact}` : ''}`
  }
  if (person.source === 'project_stock') {
    return `${person.qty} ед. · ${fmtCurrency(person.value)}`
  }
  // В view=new каждая person-row = одна заявка. Добавляем короткий request_id
  // (8 символов) и статус заявки, чтобы строки одного заявителя различались.
  // Дедлайн берём из items[0] — у всех items одной заявки он одинаковый.
  if (view === 'new' && person.request_id) {
    const slug = String(person.request_id).slice(0, 8)
    const it = person.items?.[0]
    const statusLabel = it?.request_status === 'collecting' ? ' · собирается'
      : it?.request_status === 'ready' ? ' · готова'
      : it?.request_status === 'new' ? ' · новая'
      : ''
    const dl = it?.deadline ? ` · к ${new Date(it.deadline).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' })}` : ''
    return `Заявка #${slug}${statusLabel} · ${person.qty} ед. · ${fmtCurrency(person.value)}${dl}`
  }
  return `${person.qty} ед. · ${fmtCurrency(person.value)}${person.contact ? ` · ${person.contact}` : ''}`
}

// ── Person-level действия по view ────────────────────────────────────────
function PersonActions({ person, view, busyAction, actions }) {
  const isRent = person.source === 'rent'
  const isProjectStock = person.source === 'project_stock'
  const anyBusy = !!busyAction

  if (isProjectStock) {
    const pendingCount = (person.items || []).filter(it => it.return_request_id).length
    const allPending = person.items?.length > 0 && pendingCount === person.items.length
    const baseKey = person.project_id || 'unknown'
    if (view === 'returning') {
      return (
        <>
          {actions.cancelProjectStock && pendingCount > 0 && (
            <Button
              variant="secondary"
              size="sm"
              onClick={() => actions.cancelProjectStock(person)}
              loading={busyAction === `project-stock-cancel:${baseKey}`}
              disabled={anyBusy}
            ><RotateCcw size={13} /> Отменить</Button>
          )}
          {actions.acceptProjectStock && (
            <Button
              size="sm"
              onClick={() => actions.acceptProjectStock(person)}
              loading={busyAction === `project-stock-accept:${baseKey}`}
              disabled={anyBusy}
            ><CheckCircle2 size={13} /> Принять</Button>
          )}
        </>
      )
    }
    if (view === 'issued' || view === 'all') {
      return (
        <>
          {actions.requestReturnProjectStock && (
            <Button
              variant="secondary"
              size="sm"
              onClick={() => actions.requestReturnProjectStock(person)}
              loading={busyAction === `project-stock-request:${baseKey}`}
              disabled={anyBusy || allPending}
            ><Send size={13} /> Возврат</Button>
          )}
          {actions.acceptProjectStock && (
            <Button
              size="sm"
              onClick={() => actions.acceptProjectStock(person)}
              loading={busyAction === `project-stock-accept:${baseKey}`}
              disabled={anyBusy}
            ><Package size={13} /> Принять</Button>
          )}
        </>
      )
    }
    return null
  }

  if (view === 'issued') {
    return (
      <>
        {person.act_pdf_url && <PdfChip url={person.act_pdf_url} label="Акт" />}
        {!isRent && person.user_id && (
          <Button
            variant="secondary"
            size="sm"
            onClick={() => actions.requestReturnUser(person.user_id)}
            loading={busyAction === `user:${person.user_id}`}
            disabled={anyBusy || person.has_pending_return}
          ><Send size={13} /> Возврат</Button>
        )}
        <Button
          size="sm"
          onClick={() => isRent
            ? actions.acceptReturnRent(person.deal_id)
            : actions.acceptReturnUser(person.user_id)}
          disabled={anyBusy}
        ><Package size={13} /> Принять</Button>
      </>
    )
  }

  if (view === 'returning') {
    // Cancel-returnRequest зацепляем за первое issuance/deal этого person
    // (в большинстве случаев у одного человека одна issuance в «Возвращают»).
    const firstItem = person.items[0]
    const firstIssuanceId = firstItem?.issuance_id
    const firstDealId = firstItem?.deal_id
    return (
      <>
        {person.act_pdf_url && <PdfChip url={person.act_pdf_url} label="Акт" />}
        {!isRent && firstIssuanceId && (
          <Button
            variant="secondary"
            size="sm"
            onClick={() => actions.cancelReturnIssuance(firstIssuanceId)}
            loading={busyAction === `cancel:${firstIssuanceId}`}
            disabled={anyBusy}
            title="Снять флаг «возврат запрошен»"
          ><RotateCcw size={13} /> Отменить</Button>
        )}
        {isRent && firstDealId && (
          <Button
            variant="secondary"
            size="sm"
            onClick={() => actions.cancelReturnRent(firstDealId)}
            loading={busyAction === `cancel-rent:${firstDealId}`}
            disabled={anyBusy}
          ><RotateCcw size={13} /> Отменить</Button>
        )}
        <Button
          size="sm"
          onClick={() => isRent
            ? actions.acceptReturnRent(person.deal_id)
            : actions.acceptReturnUser(person.user_id)}
          disabled={anyBusy}
        ><CheckCircle2 size={13} /> Принять</Button>
      </>
    )
  }

  if (view === 'returned') {
    // Группа закрытых возвратов одного человека — может быть несколько актов.
    // Берём последний с PDF.
    const lastWithPdf = [...person.items].reverse().find(i => i.act_pdf_url)
    if (!lastWithPdf) return null
    return <PdfChip url={lastWithPdf.act_pdf_url} label="Акт возврата" />
  }

  if (view === 'new') {
    // С v2.55 каждая person-row в view=new = одна заявка (backend группирует
    // по request_id). Все items в person.items принадлежат одному request_id /
    // request_status, поэтому кнопки рисуем по item[0]. Старая защита
    // `items.length !== 1` больше не нужна — она прятала кнопки у любых
    // multi-unit заявок и оставляла warehouse без действий.
    if (!person.items.length) return null
    const item = person.items[0]
    const isRentItem = item.source === 'rent'
    const status = item.request_status
    if (isRentItem) {
      if (!status || status === 'new') return (<>
        <Button variant="secondary" size="sm"
          loading={busyAction === `rent-stage:${item.deal_id}`} disabled={anyBusy}
          onClick={() => actions.changeRentStage(item.deal_id, 'collecting')}>Принять</Button>
        <Button variant="danger" size="sm" disabled={anyBusy}
          onClick={() => actions.cancelRent(item.deal_id)}>Отменить</Button>
      </>)
      if (status === 'collecting') return (<>
        <Button variant="secondary" size="sm"
          loading={busyAction === `rent-stage:${item.deal_id}`} disabled={anyBusy}
          onClick={() => actions.changeRentStage(item.deal_id, 'ready')}>Готово</Button>
        <Button variant="danger" size="sm" disabled={anyBusy}
          onClick={() => actions.cancelRent(item.deal_id)}>Отменить</Button>
      </>)
      if (status === 'ready') return (
        <Button size="sm" disabled={anyBusy} onClick={() => actions.goIssue(item)}>Выдать →</Button>
      )
      return null
    }
    // request
    if (status === 'new') return (<>
      <Button variant="secondary" size="sm"
        loading={busyAction === `req:${item.request_id}`} disabled={anyBusy}
        onClick={() => actions.changeRequestStatus(item.request_id, 'collecting')}>Принять</Button>
      <Button variant="danger" size="sm" disabled={anyBusy}
        onClick={() => actions.changeRequestStatus(item.request_id, 'cancelled')}>Отменить</Button>
    </>)
    if (status === 'collecting') return (<>
      <Button variant="secondary" size="sm"
        loading={busyAction === `req:${item.request_id}`} disabled={anyBusy}
        onClick={() => actions.changeRequestStatus(item.request_id, 'ready')}>Готово</Button>
      <Button variant="danger" size="sm" disabled={anyBusy}
        onClick={() => actions.changeRequestStatus(item.request_id, 'cancelled')}>Отменить</Button>
    </>)
    if (status === 'ready') return (
      <Button size="sm" disabled={anyBusy} onClick={() => actions.goIssue(item)}>Выдать →</Button>
    )
    return null
  }

  if (view === 'all') {
    // Универсальный «Принять» — имеет смысл, когда есть pending_return.
    if (person.has_pending_return) {
      return (
        <Button size="sm"
          onClick={() => isRent
            ? actions.acceptReturnRent(person.deal_id)
            : actions.acceptReturnUser(person.user_id)}
          disabled={anyBusy}
        ><CheckCircle2 size={13} /> Принять</Button>
      )
    }
    return null
  }

  return null
}

// ── Item-row по view ────────────────────────────────────────────────────
function ItemRow({ item, view }) {
  return <UnitItemRow item={item} view={view} />
}

function UnitItemRow({ item, view }) {
  const openUnit = useContext(OpenUnitContext)
  const overdue = item.status === 'overdue'
  const late = !!item.late
  const subClass = overdue ? 'overdue' : (late ? 'late' : '')

  let subText
  if (view === 'returned') {
    const label = late
      ? `опоздал ${fmtDate(item.returned_at)}`
      : `вернули ${fmtDate(item.returned_at)}`
    subText = `${item.serial || ''} · ×${item.qty} · ${label}`
  } else if (view === 'new') {
    subText = `${item.serial || ''} · ×${item.qty} · ${item.request_status === 'new' ? 'новая' : item.request_status === 'collecting' ? 'собирается' : item.request_status === 'ready' ? 'готова к выдаче' : ''}${item.deadline ? ` · к ${fmtDate(item.deadline)}` : ''}`
  } else {
    // issued / returning / all
    const dl = item.deadline ? fmtDate(item.deadline) : ''
    if (item.source === 'project_stock') subText = `${item.serial || ''} · ×${item.qty}${item.deadline ? ` · возврат до ${fmtDate(item.deadline)}` : ''}`
    else if (overdue) subText = `${item.serial || ''} · ×${item.qty}${dl ? ` · ⚠ просрочено с ${dl}` : ''}`
    else subText = `${item.serial || ''} · ×${item.qty}${dl ? ` · до ${dl}` : ''}`
    if (item.return_requested_at) subText += ' · 🟡 ждём возврата'
  }

  return (
    <div className="phv-item">
      <div className="phv-item-thumb">
        {item.photo_url
          ? <img src={item.photo_url} alt="" />
          : <div className="phv-item-thumb icon"><Package size={18} strokeWidth={1.6} /></div>}
      </div>
      <div className="phv-item-info">
        <button onClick={() => openUnit(item.unit_id)} className="phv-item-name"
          style={{ background: 'none', border: 'none', padding: 0, font: 'inherit', cursor: 'pointer', textAlign: 'left', color: 'inherit' }}>
          {item.name}
        </button>
        <div className={`phv-item-sub ${subClass}`}>{subText}</div>
      </div>
    </div>
  )
}

function pluralize(n, [one, few, many]) {
  const mod10 = n % 10
  const mod100 = n % 100
  if (mod10 === 1 && mod100 !== 11) return one
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few
  return many
}

// PDF-чип на person-уровне — открывает акт в новой вкладке.
// stopPropagation чтобы клик не сворачивал person-row.
function PdfChip({ url, label = 'PDF' }) {
  return (
    <a
      href={url}
      target="_blank"
      rel="noreferrer"
      className="phv-pdf-link"
      onClick={e => e.stopPropagation()}
    >
      <ExternalLink size={13} /> {label}
    </a>
  )
}
