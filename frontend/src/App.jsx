import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { useAuth } from './hooks/useAuth'
import { ROLES } from './constants/roles'
import { getHomeRoute } from './utils/getHomeRoute'
import LoginPage from './components/auth/LoginPage'
import RegisterPage from './components/auth/RegisterPage'
import InvitePage from './components/auth/InvitePage'
import SignPage from './components/rent/SignPage'
import RecoverPage from './components/auth/RecoverPage'
import DashboardPage from './components/warehouse/DashboardPage'
import UnitPage from './components/warehouse/UnitPage'
import IssuePage from './components/movement/IssuePage'
import ReturnPage from './components/movement/ReturnPage'
import CellsIndex from './components/warehouse/cells/CellsIndex'
import CellsTypeView from './components/warehouse/cells/CellsTypeView'
import CellsHallView from './components/warehouse/cells/CellsHallView'
import CellsSectionView from './components/warehouse/cells/CellsSectionView'
import UnitsPage from './components/warehouse/UnitsPage'
import RentPage from './components/rent/RentPage'
import RequestsPage from './components/warehouse/RequestsPage'
import TeamPage from './components/warehouse/TeamPage'
import ActsPage from './components/warehouse/ActsPage'
import DebtsPage from './components/warehouse/DebtsPage'
import ReturnsPage from './components/warehouse/ReturnsPage'
import WriteoffsPage from './components/warehouse/WriteoffsPage'
import MisplacedPage from './components/warehouse/MisplacedPage'
import ApprovalsPage from './components/warehouse/ApprovalsPage'
import DocumentsPage from './components/production/DocumentsPage'
import DocumentViewer from './components/production/DocumentViewer'
import RequestsProductionPage from './components/production/RequestsProductionPage'
import WarehouseViewPage from './components/production/WarehouseViewPage'
import ProjectWarehousePage from './components/production/ProjectWarehousePage'
import HandoversPage from './components/production/HandoversPage'
import ColleaguesPage from './components/production/ColleaguesPage'
import ProjectWarehouseHub from './components/production/ProjectWarehouseHub'
import PublicWarehousePage from './components/production/PublicWarehousePage'
import NotificationsPage from './components/shared/NotificationsPage'
import ProfilePage from './components/shared/ProfilePage'
import WarehouseAnalyticsPage from './components/analytics/WarehouseAnalyticsPage'
import ProducerDashboardPage from './components/analytics/ProducerDashboardPage'
import StaffPage from './components/production/StaffPage'
import AssetsPage from './components/warehouse/AssetsPage'
import LocationsPage from './components/warehouse/LocationsPage'
import DecorationsPage from './components/warehouse/DecorationsPage'
import VehiclesPage from './components/warehouse/VehiclesPage'
import CastingPage from './components/production/CastingPage'
import ProjectAnalyticsPage from './components/production/ProjectAnalyticsPage'
import SeedPage from './components/dev/SeedPage'

// Requires auth only
function PrivateRoute({ children }) {
  const { token, loading } = useAuth()
  if (loading) return null
  if (!token) return <Navigate to="/login" replace />
  return children
}

// Requires auth + warehouse world
function WarehouseRoute({ children }) {
  const { token, user, loading } = useAuth()
  if (loading) return null
  if (!token) return <Navigate to="/login" replace />
  const world = ROLES[user?.role]?.world
  if (world && world !== 'warehouse') return <Navigate to={getHomeRoute(user.role)} replace />
  return children
}

// Requires auth + production world
function ProductionRoute({ children }) {
  const { token, user, loading } = useAuth()
  if (loading) return null
  if (!token) return <Navigate to="/login" replace />
  const world = ROLES[user?.role]?.world
  if (world && world !== 'production') return <Navigate to={getHomeRoute(user.role)} replace />
  return children
}

function ImpersonateBanner() {
  const { user, login } = useAuth()
  const producerToken = sessionStorage.getItem('producer_token')

  document.documentElement.style.setProperty('--impersonate-offset', '0px')

  if (!producerToken) return null
  if (import.meta.env.PROD) return null

  function handleReturn() {
    const token = sessionStorage.getItem('producer_token')
    const userData = sessionStorage.getItem('producer_user')
    if (token && userData) {
      login(token, JSON.parse(userData))
      sessionStorage.removeItem('producer_token')
      sessionStorage.removeItem('producer_user')
      window.location.href = '/production/staff'
    }
  }

  return (
    <button
      className="impersonate-banner"
      onClick={handleReturn}
      style={{
        position: 'fixed', top: 68, right: 20, zIndex: 9999,
        background: '#0A0A0A', color: '#fff',
        border: '1px solid #B8935A',
        borderRadius: 10,
        padding: '6px 12px 6px 10px',
        fontSize: 12, fontWeight: 500,
        cursor: 'pointer',
        boxShadow: '0 4px 14px rgba(0,0,0,0.25)',
        display: 'inline-flex', alignItems: 'center', gap: 6,
        letterSpacing: '0.01em',
        fontFamily: 'inherit',
      }}
    >
      <span style={{ color: '#C9A876', fontSize: 14, lineHeight: 1 }}>←</span>
      Вернуться
    </button>
  )
}

// Полоса «DEV — тестовая среда» сверху экрана. Показывается в dev-режиме
// локально и в staging-сборке (VITE_APP_ENV=staging). В проде скрыта.
function DevEnvBanner() {
  const env = import.meta.env.VITE_APP_ENV
  const isDev = !import.meta.env.PROD
  if (!isDev && env !== 'staging') return null
  const label = env === 'staging' ? 'STAGING — тестовый стенд' : 'DEV — локальная разработка'
  return (
    <div style={{
      position: 'fixed', top: 0, left: 0, right: 0, zIndex: 10000,
      background: '#E8A500', color: '#0A0A0A',
      fontSize: 11, fontWeight: 700, letterSpacing: '0.04em',
      padding: '3px 12px', textAlign: 'center',
      fontFamily: 'inherit', textTransform: 'uppercase',
    }}>
      ⚠ {label} — данные не реальные
    </div>
  )
}

function App() {
  return (
    <BrowserRouter>
      <DevEnvBanner />
      <ImpersonateBanner />
      <Routes>
        <Route path="/" element={<Navigate to="/login" replace />} />
        <Route path="/login" element={<LoginPage />} />
        <Route path="/register" element={<RegisterPage />} />
        <Route path="/invite/:token" element={<InvitePage />} />
        <Route path="/recover" element={<RecoverPage />} />

        {/* Warehouse routes */}
        <Route path="/dashboard"               element={<WarehouseRoute><DashboardPage /></WarehouseRoute>} />
        <Route path="/units"                   element={<WarehouseRoute><UnitsPage /></WarehouseRoute>} />
        <Route path="/units/:id"               element={<WarehouseRoute><UnitPage /></WarehouseRoute>} />
        <Route path="/cells"                                     element={<WarehouseRoute><CellsIndex /></WarehouseRoute>} />
        <Route path="/cells/constructor"                         element={<Navigate replace to="/cells" />} />
        <Route path="/cells/:warehouseId"                        element={<WarehouseRoute><CellsIndex /></WarehouseRoute>} />
        <Route path="/cells/:warehouseId/type/:type"             element={<WarehouseRoute><CellsTypeView /></WarehouseRoute>} />
        <Route path="/cells/:warehouseId/hall/:hallId"           element={<WarehouseRoute><CellsHallView /></WarehouseRoute>} />
        <Route path="/cells/:warehouseId/section/:sectionId"     element={<WarehouseRoute><CellsSectionView /></WarehouseRoute>} />
        <Route path="/rent"                    element={<PrivateRoute><RentPage /></PrivateRoute>} />
        <Route path="/issue/rent/:id"          element={<WarehouseRoute><IssuePage /></WarehouseRoute>} />
        <Route path="/issue/:id"               element={<WarehouseRoute><IssuePage /></WarehouseRoute>} />
        <Route path="/return/rent/:id"         element={<WarehouseRoute><ReturnPage /></WarehouseRoute>} />
        <Route path="/return/:id"              element={<WarehouseRoute><ReturnPage /></WarehouseRoute>} />
        <Route path="/requests"                element={<WarehouseRoute><RequestsPage /></WarehouseRoute>} />
        <Route path="/team"                    element={<PrivateRoute><TeamPage /></PrivateRoute>} />
        <Route path="/acts"                    element={<WarehouseRoute><ActsPage /></WarehouseRoute>} />
        {/* Долги/Активы/Возвраты доступны также продюсеру (production world) — через PrivateRoute */}
        <Route path="/debts"                   element={<PrivateRoute><DebtsPage /></PrivateRoute>} />
        <Route path="/returns"                 element={<PrivateRoute><ReturnsPage /></PrivateRoute>} />
        <Route path="/writeoffs"               element={<PrivateRoute><WriteoffsPage /></PrivateRoute>} />
        <Route path="/misplaced"               element={<PrivateRoute><MisplacedPage /></PrivateRoute>} />
        <Route path="/approvals"               element={<WarehouseRoute><ApprovalsPage /></WarehouseRoute>} />
        <Route path="/analytics"               element={<WarehouseRoute><WarehouseAnalyticsPage /></WarehouseRoute>} />
        <Route path="/assets"                  element={<PrivateRoute><AssetsPage /></PrivateRoute>} />
        <Route path="/locations"               element={<PrivateRoute><LocationsPage /></PrivateRoute>} />
        <Route path="/decorations"             element={<PrivateRoute><DecorationsPage /></PrivateRoute>} />
        <Route path="/vehicles"                element={<PrivateRoute><VehiclesPage /></PrivateRoute>} />

        {/* Production routes */}
        <Route path="/production" element={<Navigate to="/production/documents" replace />} />
        <Route path="/production/"element={<Navigate to="/production/documents" replace />} />
        <Route path="/production/requests"      element={<ProductionRoute><RequestsProductionPage /></ProductionRoute>} />
        <Route path="/production/documents"    element={<ProductionRoute><DocumentsPage /></ProductionRoute>} />
        <Route path="/production/documents/:projectId/:docId" element={<ProductionRoute><DocumentViewer /></ProductionRoute>} />
        <Route path="/production/lists"        element={<Navigate to="/production/documents" replace />} />
        <Route path="/production/warehouse"    element={<ProductionRoute><WarehouseViewPage /></ProductionRoute>} />
        {/* Хаб «Склад проекта» с 4 вкладками. Доступен и warehouse_director/deputy,
            поэтому просто PrivateRoute (хаб сам выбирает layout по роли). */}
        <Route path="/production/project-warehouse" element={<PrivateRoute><ProjectWarehouseHub /></PrivateRoute>} />
        <Route path="/production/handovers"   element={<ProductionRoute><Navigate to="/production/project-warehouse?tab=handovers" replace /></ProductionRoute>} />
        <Route path="/production/handovers/:id" element={<ProductionRoute><HandoversPage /></ProductionRoute>} />
        <Route path="/production/colleagues"  element={<ProductionRoute><Navigate to="/production/project-warehouse?tab=colleagues" replace /></ProductionRoute>} />
        <Route path="/production/units"        element={<ProductionRoute><UnitsPage /></ProductionRoute>} />
        <Route path="/production/rent"            element={<ProductionRoute><RentPage /></ProductionRoute>} />
        <Route path="/production/acts"            element={<ProductionRoute><ActsPage /></ProductionRoute>} />
        <Route path="/production/locations"       element={<ProductionRoute><LocationsPage /></ProductionRoute>} />
        <Route path="/production/decorations"     element={<ProductionRoute><DecorationsPage /></ProductionRoute>} />
        <Route path="/production/vehicles"        element={<ProductionRoute><VehiclesPage /></ProductionRoute>} />
        <Route path="/production/casting"         element={<ProductionRoute><CastingPage /></ProductionRoute>} />
        <Route path="/production/staff"          element={<ProductionRoute><StaffPage /></ProductionRoute>} />
        <Route path="/analytics/producer"      element={<ProductionRoute><ProducerDashboardPage /></ProductionRoute>} />
        <Route path="/production/analytics"   element={<ProductionRoute><ProjectAnalyticsPage /></ProductionRoute>} />

        {/* Shared routes (any authenticated user) */}
        <Route path="/notifications"           element={<PrivateRoute><NotificationsPage /></PrivateRoute>} />
        <Route path="/profile"                 element={<PrivateRoute><ProfilePage /></PrivateRoute>} />

        {/* Dev tools */}
        <Route path="/dev/seed" element={<SeedPage />} />

        {/* Public — no auth required */}
        <Route path="/public/warehouse/:token" element={<PublicWarehousePage />} />
        <Route path="/sign/:token" element={<SignPage />} />
      </Routes>
    </BrowserRouter>
  )
}

export default App
