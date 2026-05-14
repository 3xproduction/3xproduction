import { useLayoutEffect, useRef } from 'react'
import { BrowserRouter, Routes, Route, Navigate, useParams } from 'react-router-dom'
import { useAuth } from './hooks/useAuth'
import { ROLES } from './constants/roles'
import { getHomeRoute } from './utils/getHomeRoute'
import LoginPage from './components/auth/LoginPage'
import RegisterPage from './components/auth/RegisterPage'
import InvitePage from './components/auth/InvitePage'
import ClaimPage from './components/auth/ClaimPage'
import SignPage from './components/rent/SignPage'
import RecoverPage from './components/auth/RecoverPage'
import DashboardPage from './components/warehouse/DashboardPage'
import IssuePage from './components/movement/IssuePage'
import ReturnPage from './components/movement/ReturnPage'
import CellsIndex from './components/warehouse/cells/CellsIndex'
import CellsTypeView from './components/warehouse/cells/CellsTypeView'
import CellsHallView from './components/warehouse/cells/CellsHallView'
import CellsSectionView from './components/warehouse/cells/CellsSectionView'
import UnitsPage from './components/warehouse/UnitsPage'
import AdminStockPage from './components/warehouse/AdminStockPage'
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
import WalkinIssuePage from './components/warehouse/WalkinIssuePage'
import WalkinReturnPage from './components/warehouse/WalkinReturnPage'
import IssuedByProjectsPage from './components/warehouse/IssuedByProjectsPage'
import BulkUploadPage from './components/warehouse/BulkUploadPage'
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

function ProductionHomeRedirect() {
  const { user, loading } = useAuth()
  if (loading) return null
  return <Navigate to={user?.role === 'costume_designer' ? '/production/project-warehouse?tab=my' : '/production/documents'} replace />
}

function NotForCostumeDesigner({ children }) {
  const { user } = useAuth()
  if (user?.role === 'costume_designer') {
    return <Navigate to="/production/project-warehouse?tab=my" replace />
  }
  return children
}

function ImpersonateBanner() {
  const { login } = useAuth()
  const producerToken = sessionStorage.getItem('producer_token')

  document.documentElement.style.setProperty('--impersonate-offset', '0px')

  if (!producerToken) return null
  // Показываем на dev и staging (mode=staging → VITE_APP_ENV=staging), скрываем
  // только на реальном проде. Паттерн зеркалит DevEnvBanner ниже.
  const isStaging = import.meta.env.VITE_APP_ENV === 'staging'
  if (import.meta.env.PROD && !isStaging) return null

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

// Роутер /production/requests — выбирает страницу по роли:
// producer → IssuedByProjectsPage (раздел «Движение» в новом виде),
// остальные production-роли → RequestsProductionPage (legacy «Заявки»).
function ProductionRequestsRouter() {
  const { user } = useAuth()
  if (user?.role === 'producer') {
    return <IssuedByProjectsPage scope="producer" />
  }
  return <RequestsProductionPage />
}

// Полоса «DEV — тестовая среда» сверху экрана. Показывается в dev-режиме
// локально и в staging-сборке (VITE_APP_ENV=staging). В проде скрыта.
//
// Реальная высота измеряется через ref — env(safe-area-inset-top) на разных
// устройствах разный, fontSize/lineHeight тоже могут варьироваться. Layout
// читает --devenv-banner-h (полную высоту) чтобы сдвинуть topbar строго на эту
// величину и sticky-табы прилипали без зазора.
function DevEnvBanner() {
  const env = import.meta.env.VITE_APP_ENV
  const isDev = !import.meta.env.PROD
  const show = isDev || env === 'staging'
  const ref = useRef(null)
  useLayoutEffect(() => {
    const root = document.documentElement
    if (!show) {
      root.style.removeProperty('--devenv-banner-h')
      return
    }
    function update() {
      if (ref.current) {
        // Math.ceil чтобы layout всегда резервировал >= фактической высоты
        // баннера. Math.round может округлить вниз (28.4 → 28) и оставить
        // 0.4-1px полоску, через которую при скролле просвечивает контент.
        const h = Math.ceil(ref.current.getBoundingClientRect().height)
        if (h > 0) root.style.setProperty('--devenv-banner-h', h + 'px')
      }
    }
    update()
    let ro
    if (typeof ResizeObserver !== 'undefined' && ref.current) {
      ro = new ResizeObserver(update)
      ro.observe(ref.current)
    }
    window.addEventListener('resize', update)
    window.addEventListener('orientationchange', update)
    return () => {
      window.removeEventListener('resize', update)
      window.removeEventListener('orientationchange', update)
      if (ro) ro.disconnect()
      root.style.removeProperty('--devenv-banner-h')
    }
  }, [show])
  if (!show) return null
  const label = env === 'staging' ? 'STAGING — тестовый стенд' : 'DEV — локальная разработка'
  return (
    <div ref={ref} style={{
      position: 'fixed', top: 0, left: 0, right: 0, zIndex: 10000,
      background: '#E8A500', color: '#0A0A0A',
      fontSize: 11, fontWeight: 700, letterSpacing: '0.04em',
      lineHeight: 1.2,
      padding: 'calc(3px + env(safe-area-inset-top, 0px)) 12px 3px',
      boxSizing: 'border-box',
      textAlign: 'center',
      fontFamily: 'inherit', textTransform: 'uppercase',
    }}>
      ⚠ {label} — данные не реальные
    </div>
  )
}

// Старый /units/:id (UnitPage) больше не используем. Сохраняем роут как
// тонкий редирект на каталог, чтобы старые ссылки/закладки/уведомления вели
// на актуальную UnitCardModal через query-параметр open=<id>.
function UnitRedirect() {
  const { id } = useParams()
  return <Navigate to={`/units?open=${id}`} replace />
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
        <Route path="/claim/:token" element={<ClaimPage />} />
        <Route path="/recover" element={<RecoverPage />} />

        {/* Warehouse routes */}
        <Route path="/dashboard"               element={<WarehouseRoute><DashboardPage /></WarehouseRoute>} />
        <Route path="/units"                   element={<WarehouseRoute><UnitsPage /></WarehouseRoute>} />
        <Route path="/units/bulk"              element={<WarehouseRoute><BulkUploadPage /></WarehouseRoute>} />
        <Route path="/project-intake"          element={<WarehouseRoute><BulkUploadPage /></WarehouseRoute>} />
        <Route path="/units/:id"               element={<UnitRedirect />} />
        <Route path="/admin-stock"             element={<WarehouseRoute><AdminStockPage /></WarehouseRoute>} />
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
        <Route path="/walkin/new"              element={<WarehouseRoute><WalkinIssuePage /></WarehouseRoute>} />
        <Route path="/walkin/return/:user_id"  element={<WarehouseRoute><WalkinReturnPage /></WarehouseRoute>} />
        <Route path="/issued"                  element={<WarehouseRoute><IssuedByProjectsPage /></WarehouseRoute>} />
        <Route path="/analytics"               element={<WarehouseRoute><WarehouseAnalyticsPage /></WarehouseRoute>} />
        <Route path="/assets"                  element={<PrivateRoute><AssetsPage /></PrivateRoute>} />
        <Route path="/locations"               element={<PrivateRoute><LocationsPage /></PrivateRoute>} />
        <Route path="/decorations"             element={<PrivateRoute><DecorationsPage /></PrivateRoute>} />
        <Route path="/vehicles"                element={<PrivateRoute><VehiclesPage /></PrivateRoute>} />

        {/* Production routes */}
        <Route path="/production" element={<ProductionHomeRedirect />} />
        <Route path="/production/" element={<ProductionHomeRedirect />} />
        {/* Раздел «Движение» у продюсера — единый список «Проект → Получатель → Единицы»
            (тот же IssuedByProjectsPage, но фильтр по своему проекту, без партнёрской аренды).
            Другие production-роли (project_director, ams_assistant и т.д.) пока видят прежнюю
            страницу заявок RequestsProductionPage. */}
        <Route path="/production/requests" element={<ProductionRoute><ProductionRequestsRouter /></ProductionRoute>} />
        {/* «Склады» у продюсера — те же экраны, что и у директора (CellsIndex и т.д.),
            но в ProductionLayout и read-only (canEdit=false). */}
        <Route path="/production/cells"                                element={<ProductionRoute><CellsIndex world="production" /></ProductionRoute>} />
        <Route path="/production/cells/:warehouseId"                   element={<ProductionRoute><CellsIndex world="production" /></ProductionRoute>} />
        <Route path="/production/cells/:warehouseId/type/:type"        element={<ProductionRoute><CellsTypeView world="production" /></ProductionRoute>} />
        <Route path="/production/cells/:warehouseId/hall/:hallId"      element={<ProductionRoute><CellsHallView world="production" /></ProductionRoute>} />
        <Route path="/production/cells/:warehouseId/section/:sectionId" element={<ProductionRoute><CellsSectionView world="production" /></ProductionRoute>} />
        <Route path="/production/documents"    element={<ProductionRoute><NotForCostumeDesigner><DocumentsPage /></NotForCostumeDesigner></ProductionRoute>} />
        <Route path="/production/documents/:projectId/:docId" element={<ProductionRoute><NotForCostumeDesigner><DocumentViewer /></NotForCostumeDesigner></ProductionRoute>} />
        <Route path="/production/lists"        element={<Navigate to="/production/documents" replace />} />
        <Route path="/production/warehouse"    element={<ProductionRoute><WarehouseViewPage /></ProductionRoute>} />
        <Route path="/production/admin-stock"  element={<ProductionRoute><NotForCostumeDesigner><AdminStockPage /></NotForCostumeDesigner></ProductionRoute>} />
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
        <Route path="/production/decorations"     element={<ProductionRoute><NotForCostumeDesigner><DecorationsPage /></NotForCostumeDesigner></ProductionRoute>} />
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
