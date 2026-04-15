import { useState } from 'react'
import { NavLink, useNavigate, useLocation } from 'react-router-dom'
import {
  LayoutDashboard, ClipboardList, Package, Grid3x3,
  Users, FileText, Handshake, BarChart2, Bell,
  User, X, Menu, ChevronDown, LogOut, Clock, AlertTriangle, ArrowLeft,
  MapPin, Clapperboard, Car, Search
} from 'lucide-react'
import { useAuth } from '../../hooks/useAuth'
import { useGlobalSearch } from '../../hooks/useGlobalSearch'
import GlobalSearchBar from '../shared/GlobalSearchBar'

const HIDDEN_BY_ROLE = {
  warehouse_director: ['/analytics', '/locations', '/vehicles'],
  warehouse_deputy:   ['/analytics', '/assets', '/locations', '/vehicles'],
  warehouse_staff:    ['/analytics', '/assets', '/acts', '/rent', '/team', '/locations', '/vehicles'],
}

const NAV_ALL = [
  {
    section: 'Склад',
    items: [
      { to: '/dashboard',  icon: LayoutDashboard, label: 'Офис' },
      { to: '/requests',   icon: ClipboardList,   label: 'Заявки',     badge: true },
      { to: '/units',      icon: Package,          label: 'Склад' },
      { to: '/cells',      icon: Grid3x3,          label: 'Места на складе' },
      { to: '/team',       icon: Users,            label: 'Наша команда' },
      { to: '/approvals',  icon: Clock,            label: 'Принять на склад' },
      { to: '/debts',      icon: AlertTriangle,    label: 'Долги' },
    ],
  },
  {
    section: 'Финансы',
    items: [
      { to: '/acts',  icon: FileText,  label: 'Акты' },
      { to: '/rent',  icon: Handshake, label: 'Аренда' },
    ],
  },
  {
    section: 'Каталоги',
    items: [
      { to: '/locations',    icon: MapPin,        label: 'Локации' },
      { to: '/decorations',  icon: Clapperboard,  label: 'Декорации' },
      { to: '/vehicles',     icon: Car,           label: 'Транспорт' },
    ],
  },
  {
    section: 'Аналитика',
    items: [
      { to: '/analytics', icon: BarChart2, label: 'Отчёты' },
      { to: '/assets', icon: Package, label: 'Активы' },
    ],
  },
]

function getNav(role) {
  const hidden = HIDDEN_BY_ROLE[role] || []
  return NAV_ALL.map(s => ({ ...s, items: s.items.filter(i => !hidden.includes(i.to)) })).filter(s => s.items.length > 0)
}

const MOBILE_NAV_ALL = [
  { to: '/dashboard', icon: LayoutDashboard, label: 'Офис' },
  { to: '/requests',  icon: ClipboardList,   label: 'Заявки' },
  { to: '/units',     icon: Package,          label: 'Склад' },
  { to: '/analytics', icon: BarChart2,        label: 'Отчёты' },
]

const MOBILE_BURGER_ALL = [
  { to: '/cells',      icon: Grid3x3,   label: 'Места на складе' },
  { to: '/team',       icon: Users,     label: 'Наша команда' },
  { to: '/acts',       icon: FileText,  label: 'Акты' },
  { to: '/rent',       icon: Handshake, label: 'Аренда' },
  { to: '/notifications', icon: Bell,  label: 'Что нового?' },
  { to: '/profile',    icon: User,      label: 'Профиль' },
]

const css = `
/* ── Layout ── */
.wl-root { display: flex; min-height: 100vh; background: var(--bg); }

/* ── Sidebar ── */
.wl-sidebar {
  width: 240px;
  background: var(--sidebar-bg);
  color: var(--sidebar-text);
  display: flex;
  flex-direction: column;
  position: fixed;
  top: var(--impersonate-offset, 0px); left: 0; bottom: 0;
  z-index: 100;
  border-right: 1px solid rgba(255,255,255,0.06);
}
.wl-logo {
  padding: 22px 20px 14px;
  border-bottom: 1px solid rgba(255,255,255,0.06);
}
.wl-logo-title { font-size: 26px; font-weight: 700; letter-spacing: -0.02em; cursor: pointer; display: flex; align-items: center; gap: 8px; }
.wl-online-dot { width: 8px; height: 8px; border-radius: 50%; background: #22c55e; box-shadow: 0 0 0 0 rgba(34,197,94,0.6); animation: wl-pulse 2s infinite; flex-shrink: 0; }
@keyframes wl-pulse { 0% { box-shadow: 0 0 0 0 rgba(34,197,94,0.6); } 70% { box-shadow: 0 0 0 6px rgba(34,197,94,0); } 100% { box-shadow: 0 0 0 0 rgba(34,197,94,0); } }
.wl-logo-sub { font-size: 10px; letter-spacing: 2px; text-transform: uppercase; color: var(--sidebar-muted); margin-top: 3px; }

.wl-warehouse {
  padding: 12px 12px 8px;
  border-bottom: 1px solid rgba(255,255,255,0.06);
  position: relative;
}
.wl-warehouse-btn {
  width: 100%; padding: 7px 10px;
  background: rgba(255,255,255,0.06);
  border: 1px solid rgba(255,255,255,0.08);
  border-radius: 8px; color: var(--sidebar-text);
  font-size: 12px; cursor: pointer;
  display: flex; align-items: center; justify-content: space-between;
  font-family: inherit;
}
.wl-warehouse-btn:hover { background: rgba(255,255,255,0.10); }
.wl-warehouse-dd {
  position: absolute; top: calc(100% - 8px); left: 12px; right: 12px;
  background: #252525; border: 1px solid rgba(255,255,255,0.12);
  border-radius: 8px; overflow: hidden; z-index: 200;
}
.wl-warehouse-opt {
  padding: 9px 12px; font-size: 12px; color: rgba(255,255,255,0.85);
  cursor: pointer; display: block; width: 100%; text-align: left;
  background: none; border: none; font-family: inherit;
}
.wl-warehouse-opt:hover { background: rgba(255,255,255,0.08); }
.wl-warehouse-opt.sel { color: var(--accent); }

.wl-nav { flex: 1; overflow-y: auto; padding: 8px 10px; }
.wl-section-label {
  font-size: 10px; font-weight: 600;
  letter-spacing: 0.08em; text-transform: uppercase;
  color: var(--sidebar-muted);
  padding: 12px 10px 4px;
}
.wl-nav-item {
  display: flex; align-items: center; gap: 9px;
  padding: 8px 10px; border-radius: 8px; margin-bottom: 1px;
  color: var(--sidebar-text);
  font-size: 13.5px; font-weight: 450;
  text-decoration: none;
  transition: background 0.12s, color 0.12s;
  position: relative;
}
.wl-nav-item:hover { background: var(--sidebar-hover-bg); color: #fff; }
.wl-nav-item.active { background: var(--sidebar-active-bg); color: var(--sidebar-active-text); }
.wl-nav-badge {
  margin-left: auto;
  background: var(--accent);
  color: #fff;
  font-size: 10px; font-weight: 600;
  padding: 1px 6px; border-radius: 10px;
}

.wl-profile {
  padding: 12px 12px 18px;
  border-top: 1px solid rgba(255,255,255,0.06);
}
.wl-profile-inner {
  display: flex; align-items: center; gap: 10px;
  padding: 8px 10px; border-radius: 9px;
  cursor: pointer;
  transition: background 0.12s;
}
.wl-profile-inner:hover { background: var(--sidebar-hover-bg); }
.wl-avatar {
  width: 30px; height: 30px; border-radius: 50%;
  background: var(--accent);
  display: flex; align-items: center; justify-content: center;
  font-size: 12px; font-weight: 600; color: #fff;
  flex-shrink: 0;
}
.wl-profile-name { font-size: 13px; font-weight: 500; }
.wl-profile-role { font-size: 11px; color: var(--sidebar-muted); margin-top: 1px; }

/* ── Main ── */
.wl-main { margin-left: 240px; flex: 1; min-height: 100vh; }
.wl-back {
  display: inline-flex; align-items: center; gap: 4px;
  background: none; border: none; color: var(--muted);
  font-size: 13px; font-weight: 500; cursor: pointer;
  padding: 8px 12px 0; font-family: inherit;
  transition: color 0.12s;
}
.wl-back:hover { color: var(--text); }

/* ── Mobile top bar ── */
.wl-topbar {
  display: none;
  position: fixed; top: var(--impersonate-offset, 0px); left: 0; right: 0; height: 52px;
  background: var(--sidebar-bg);
  color: #fff;
  align-items: center; justify-content: space-between;
  padding: 0 16px;
  z-index: 200;
  border-bottom: 1px solid rgba(255,255,255,0.08);
}
.wl-topbar-logo { font-size: 18px; font-weight: 700; display: flex; align-items: center; gap: 7px; }
.wl-topbar-btn {
  width: 36px; height: 36px; border-radius: 9px;
  background: rgba(255,255,255,0.08);
  border: none; color: #fff;
  display: flex; align-items: center; justify-content: center;
  cursor: pointer;
}

/* ── Mobile bottom nav ── */
.wl-mobile-nav {
  display: none;
  position: fixed; bottom: 0; left: 0; right: 0;
  background: var(--white);
  border-top: 1px solid var(--border);
  z-index: 200;
  padding: 6px 0 max(6px, env(safe-area-inset-bottom));
}
.wl-mobile-nav-inner { display: flex; justify-content: space-around; }
.wl-mobile-nav-item {
  display: flex; flex-direction: column; align-items: center;
  gap: 3px; padding: 4px 12px;
  font-size: 10px; font-weight: 500;
  color: var(--muted); text-decoration: none;
  border: none; background: none; cursor: pointer;
  transition: color 0.12s;
}
.wl-mobile-nav-item.active, .wl-mobile-nav-item:hover { color: var(--accent); }

/* ── Drawer (burger) ── */
.wl-drawer-overlay {
  position: fixed; inset: 0; z-index: 300;
  background: rgba(0,0,0,0.45);
  backdrop-filter: blur(2px);
}
.wl-drawer {
  position: absolute; bottom: 0; left: 0; right: 0;
  background: var(--white);
  border-radius: 18px 18px 0 0;
  padding: 8px 16px max(20px, env(safe-area-inset-bottom));
  max-height: 80vh;
  overflow-y: auto;
}
.wl-drawer-handle {
  width: 36px; height: 4px; border-radius: 4px;
  background: var(--border-strong);
  margin: 8px auto 16px;
}
.wl-drawer-title { font-size: 13px; font-weight: 600; color: var(--muted); margin-bottom: 8px; padding: 0 4px; }
.wl-drawer-item {
  display: flex; align-items: center; gap: 12px;
  padding: 13px 4px;
  border-bottom: 1px solid var(--border);
  color: var(--text); font-size: 15px; font-weight: 450;
  text-decoration: none;
}
.wl-drawer-item:last-child { border-bottom: none; }
.wl-drawer-item-icon {
  width: 36px; height: 36px; border-radius: 9px;
  background: var(--bg-secondary);
  display: flex; align-items: center; justify-content: center;
  color: var(--accent);
  flex-shrink: 0;
}

/* ── Responsive ── */
@media (max-width: 768px) {
  .wl-sidebar   { display: none !important; }
  .wl-main      { margin-left: 0 !important; padding-top: 52px; padding-bottom: 72px; }
  .wl-topbar    { display: flex !important; }
  .wl-mobile-nav { display: block !important; }
}

/* 769–1024px: compact sidebar */
@media (min-width: 769px) and (max-width: 1024px) {
  .wl-sidebar { width: 200px; }
  .wl-main    { margin-left: 200px; }
  .wl-logo-title { font-size: 15px; }
  .wl-nav-item { font-size: 13px; padding: 7px 8px; }
  .wl-section-label { font-size: 9px; }
}

/* 1024–1280px: normal sidebar, slightly tighter */
@media (min-width: 1025px) and (max-width: 1280px) {
  .wl-sidebar { width: 220px; }
  .wl-main    { margin-left: 220px; }
}

/* 1280px+: full sidebar */
@media (min-width: 1281px) {
  .wl-sidebar { width: 240px; }
  .wl-main    { margin-left: 240px; }
}

/* 1440px+: wider content breathing room */
@media (min-width: 1440px) {
  .wl-main { padding-left: 8px; }
}
`

function getInitials(name = '') {
  return name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase()
}

const WAREHOUSES = ['Выбрать склад', 'Вирки 22', 'Чапаева 6']

export default function WarehouseLayout({ children }) {
  const [burger, setBurger] = useState(false)
  const [whOpen, setWhOpen] = useState(false)
  const [selectedWh, setSelectedWh] = useState(() => localStorage.getItem('warehouse') || 'Выбрать склад')
  const navigate = useNavigate()
  const location = useLocation()
  const { user, logout } = useAuth()
  const showBack = location.pathname !== '/dashboard'
  const searchProps = useGlobalSearch()

  function selectWarehouse(w) {
    localStorage.setItem('warehouse', w)
    setSelectedWh(w)
    setWhOpen(false)
    window.location.reload()
  }

  return (
    <>
      <style>{css}</style>
      <div className="wl-root">

        {/* Desktop Sidebar */}
        <aside className="wl-sidebar">
          <div className="wl-logo" onClick={() => navigate('/dashboard')}>
            <div className="wl-logo-title">
              <span><span style={{ color: 'var(--accent)' }}>3X</span>Media</span>
              <span className="wl-online-dot" />
            </div>
            <div className="wl-logo-sub">Production</div>
          </div>

          <div style={{ padding: '8px 12px' }}>
            <button
              onClick={() => searchProps.setOpen(true)}
              style={{
                width: '100%', display: 'flex', alignItems: 'center', gap: 8,
                padding: '7px 10px', borderRadius: 8,
                border: '1px solid var(--sidebar-border, rgba(255,255,255,0.1))',
                background: 'rgba(255,255,255,0.04)', cursor: 'pointer',
                color: 'var(--sidebar-muted)', fontSize: 13, fontFamily: 'inherit',
              }}
            >
              <Search size={14} />
              <span style={{ flex: 1, textAlign: 'left' }}>Поиск...</span>
              <kbd style={{ fontSize: 10, opacity: 0.5, fontFamily: 'monospace' }}>Ctrl+K</kbd>
            </button>
          </div>

          <nav className="wl-nav">
            {getNav(user?.role).map(group => (
              <div key={group.section}>
                <div className="wl-section-label">{group.section}</div>
                {group.items.map(item => (
                  <NavLink key={item.to} to={item.to} className={({ isActive }) => `wl-nav-item${isActive ? ' active' : ''}`}>
                    <item.icon size={16} strokeWidth={1.8} />
                    <span style={{ flex: 1 }}>{item.label}</span>
                  </NavLink>
                ))}
              </div>
            ))}
          </nav>

          <div className="wl-profile">
            <div className="wl-profile-inner" onClick={() => navigate('/profile')}>
              <div className="wl-avatar">{getInitials(user?.name || 'ИП')}</div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="wl-profile-name truncate">{user?.name || 'Профиль'}</div>
                <div className="wl-profile-role truncate">{user?.role || ''}</div>
              </div>
              <User size={14} style={{ color: 'var(--sidebar-muted)', flexShrink: 0 }} />
            </div>
          </div>
        </aside>

        {/* Mobile top bar */}
        <div className="wl-topbar">
          <div className="wl-topbar-logo">
            <span><span style={{ color: 'var(--accent)' }}>3X</span>Media</span>
            <span className="wl-online-dot" />
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="wl-topbar-btn" onClick={() => navigate('/notifications')}>
              <Bell size={18} />
            </button>
            <button className="wl-topbar-btn" onClick={() => setBurger(true)}>
              <Menu size={18} />
            </button>
          </div>
        </div>

        {/* Main content */}
        <main className="wl-main">
          {showBack && (
            <button className="wl-back" onClick={() => navigate(-1)}>
              <ArrowLeft size={16} /> Назад
            </button>
          )}
          {children}
        </main>

        {/* Mobile bottom nav */}
        <nav className="wl-mobile-nav">
          <div className="wl-mobile-nav-inner">
            {MOBILE_NAV_ALL.filter(i => !(HIDDEN_BY_ROLE[user?.role] || []).includes(i.to)).map(item => (
              <NavLink key={item.to} to={item.to} className={({ isActive }) => `wl-mobile-nav-item${isActive ? ' active' : ''}`}>
                <item.icon size={22} strokeWidth={1.8} />
                {item.label}
              </NavLink>
            ))}
            <button className="wl-mobile-nav-item" onClick={() => setBurger(true)}>
              <Menu size={22} strokeWidth={1.8} />
              Ещё
            </button>
          </div>
        </nav>

        {/* Drawer */}
        {burger && (
          <div className="wl-drawer-overlay" onClick={() => setBurger(false)}>
            <div className="wl-drawer" onClick={e => e.stopPropagation()}>
              <div className="wl-drawer-handle" />
              <div className="wl-drawer-title">Меню</div>
              {MOBILE_BURGER_ALL.filter(i => !(HIDDEN_BY_ROLE[user?.role] || []).includes(i.to)).map(item => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  className="wl-drawer-item"
                  onClick={() => setBurger(false)}
                >
                  <div className="wl-drawer-item-icon">
                    <item.icon size={18} strokeWidth={1.8} />
                  </div>
                  {item.label}
                </NavLink>
              ))}
            </div>
          </div>
        )}

        <GlobalSearchBar {...searchProps} />
      </div>
    </>
  )
}
