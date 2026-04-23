// Хаб «Склад проекта» — объединяет 4 функции в одну страницу с вкладками:
//   • Мой склад       — ProjectWarehousePage (склад проекта)
//   • Склады коллег   — ColleaguesPage (единицы других проектов)
//   • Запросы         — LoanRequestsSection (заявки-займы между проектами)
//   • Передача склада — HandoversPage (акты между сотрудниками проекта)
//
// Активная вкладка берётся из ?tab=... query-param, чтобы deep-link работал.
// Старые роуты (/production/colleagues, /production/handovers) редиректят сюда.

import { useSearchParams, useNavigate } from 'react-router-dom'
import { Box, Users, Inbox, ClipboardList } from 'lucide-react'
import ProductionLayout from './ProductionLayout'
import WarehouseLayout from '../warehouse/WarehouseLayout'
import ProjectWarehousePage from './ProjectWarehousePage'
import ColleaguesPage from './ColleaguesPage'
import HandoversPage from './HandoversPage'
import LoanRequestsSection from './LoanRequestsSection'
import { useAuth } from '../../hooks/useAuth'
import { ROLES } from '../../constants/roles'

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
