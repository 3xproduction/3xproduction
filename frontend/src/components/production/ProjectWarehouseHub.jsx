// Хаб «Склад проекта» — объединяет 4 функции в одну страницу с вкладками:
//   • Мой склад       — ProjectWarehousePage (склад проекта)
//   • Склады коллег   — ColleaguesPage (единицы других проектов)
//   • Запросы         — LoanRequestsSection (заявки-займы между проектами)
//   • Передача склада — HandoversPage (акты между сотрудниками проекта)
//
// Активная вкладка берётся из ?tab=... query-param, чтобы deep-link работал.
// Старые роуты (/production/colleagues, /production/handovers) редиректят сюда.

import { useEffect, useState } from 'react'
import { useSearchParams, useNavigate } from 'react-router-dom'
import { Box, Users, Inbox, ClipboardList } from 'lucide-react'
import ProductionLayout from './ProductionLayout'
import WarehouseLayout from '../warehouse/WarehouseLayout'
import ProjectWarehousePage from './ProjectWarehousePage'
import ColleaguesPage from './ColleaguesPage'
import HandoversPage from './HandoversPage'
import LoanRequestsSection from './LoanRequestsSection'
import { useAuth } from '../../hooks/useAuth'
import { useNotifications } from '../../hooks/useNotifications'
import { ROLES } from '../../constants/roles'
import { colleagues as colleaguesApi, projectUnits as projectUnitsApi } from '../../services/api'

const TABS = [
  { k: 'my',         label: 'Мой склад',       icon: Box },
  { k: 'colleagues', label: 'Склады коллег',   icon: Users },
  { k: 'requests',   label: 'Запросы',         icon: Inbox },
  { k: 'handovers',  label: 'Передача склада', icon: ClipboardList },
]

// Роли, для которых хаб сводится к одной вкладке «Склады коллег» (=«Склад проекта»):
// warehouse-сторона (директор/зам/сотрудник склада) и продюсер работают только
// с обзором остатков и возвратами — другие вкладки им не нужны.
const COLLEAGUES_ONLY_ROLES = new Set([
  'warehouse_director', 'warehouse_deputy', 'warehouse_staff', 'producer',
])

export default function ProjectWarehouseHub() {
  const [sp, setSp] = useSearchParams()
  const { user } = useAuth()
  const role = user?.role
  const colleaguesOnly = COLLEAGUES_ONLY_ROLES.has(role)

  const visibleTabs = colleaguesOnly ? TABS.filter(t => t.k === 'colleagues') : TABS
  const active = visibleTabs.find(t => t.k === sp.get('tab'))?.k || visibleTabs[0].k

  const Layout = ROLES[role]?.world === 'warehouse' ? WarehouseLayout : ProductionLayout

  // Цифорка у вкладки «Запросы»: максимум из unread-уведомлений и актуальных
  // pending-заявок. Так цифра появляется и у того, кто сам нажал «Запросить»:
  // requester не получает push на собственное действие, но outgoing pending
  // всё равно должен подсветить вкладку.
  const { items: notifs } = useNotifications()
  const [pendingRequestsCount, setPendingRequestsCount] = useState(0)
  const unreadRequestsCount = notifs.filter(n =>
    !n.read && ['project_loan_request', 'warehouse_return_request'].includes(n.entity_type)
  ).length
  const requestsBadge = Math.max(unreadRequestsCount, pendingRequestsCount)

  useEffect(() => {
    if (colleaguesOnly) return
    let cancelled = false
    function reloadRequestsBadge() {
      Promise.all([
        colleaguesApi.listRequests('incoming', 'pending').catch(() => ({ requests: [] })),
        colleaguesApi.listRequests('outgoing', 'pending').catch(() => ({ requests: [] })),
        projectUnitsApi.listReturnRequests('incoming', 'pending').catch(() => ({ requests: [] })),
      ]).then(([incoming, outgoing, whReturns]) => {
        if (cancelled) return
        setPendingRequestsCount(
          (incoming.requests || []).length +
          (outgoing.requests || []).length +
          (whReturns.requests || []).length
        )
      })
    }
    reloadRequestsBadge()
    window.addEventListener('project-warehouse-requests-changed', reloadRequestsBadge)
    const id = setInterval(reloadRequestsBadge, 30000)
    return () => {
      cancelled = true
      window.removeEventListener('project-warehouse-requests-changed', reloadRequestsBadge)
      clearInterval(id)
    }
  }, [colleaguesOnly])

  function setTab(k) {
    const next = new URLSearchParams(sp)
    next.set('tab', k)
    setSp(next, { replace: true })
  }

  return (
    <Layout>
      <div style={{ padding: '24px 32px' }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, marginBottom: 14 }}>Склад проекта</h1>

        {/* Tabs — для директора склада показываем только один экран без вкладок */}
        {!colleaguesOnly && (
          <div style={{
            display: 'flex', gap: 2, marginBottom: 20,
            borderBottom: '1px solid var(--border)', overflowX: 'auto',
          }}>
            {visibleTabs.map(t => {
              const Icon = t.icon
              const isActive = active === t.k
              const badge = t.k === 'requests' ? requestsBadge : 0
              return (
                <button key={t.k} onClick={() => setTab(t.k)}
                  style={{
                    padding: '10px 16px', border: 'none', background: 'none', cursor: 'pointer',
                    fontSize: 13.5, fontWeight: isActive ? 600 : 500,
                    color: isActive ? 'var(--accent)' : 'var(--muted)',
                    borderBottom: isActive ? '2px solid var(--accent)' : '2px solid transparent',
                    marginBottom: -1, display: 'flex', alignItems: 'center', gap: 6,
                    whiteSpace: 'nowrap',
                  }}>
                  <Icon size={15} strokeWidth={1.8} /> {t.label}
                  {badge > 0 && (
                    <span style={{
                      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                      minWidth: 18, height: 18, padding: '0 5px',
                      fontSize: 11, fontWeight: 700,
                      background: 'var(--red, #dc2626)', color: '#fff',
                      borderRadius: 9,
                    }}>{badge > 99 ? '99+' : badge}</span>
                  )}
                </button>
              )
            })}
          </div>
        )}

        {active === 'my'         && <ProjectWarehousePage embedded />}
        {active === 'colleagues' && <ColleaguesPage embedded />}
        {active === 'requests'   && <LoanRequestsSection />}
        {active === 'handovers'  && <HandoversPage embedded />}
      </div>
    </Layout>
  )
}

// Вспомогательные редиректы для старых URL.
export function RedirectToHub({ tab }) {
  const nav = useNavigate()
  nav(`/production/project-warehouse?tab=${tab}`, { replace: true })
  return null
}
