import { useState, useEffect, useRef } from 'react'
import { NavLink, useNavigate, useLocation } from 'react-router-dom'
import {
  FileText, Package, BarChart2, Menu, Users, MapPin, FolderOpen, Search,
  ChevronDown, ChevronLeft, Plus, LogOut, User, UserPlus, Link as LinkIcon,
  Copy, Check,
} from 'lucide-react'
import { useAuth } from '../../hooks/useAuth'
import { ROLES } from '../../constants/roles'
import { projects as projectsApi, invites as invitesApi, rent as rentApi } from '../../services/api'
import Button from '../shared/Button'
import Input from '../shared/Input'
import { useGlobalSearch } from '../../hooks/useGlobalSearch'
import GlobalSearchBar from '../shared/GlobalSearchBar'
import SectionTabs from '../shared/SectionTabs'
import TriixLogo from '../shared/TriixLogo'
import { useBodyLock } from '../../hooks/useBodyLock'

// ── Роли, которые НЕ видят склад (только читают документы) ──
// Используется чтобы скрыть пункт «Склад» в rail у зрителей.
const NON_WAREHOUSE_ROLES = new Set([
  'driver', 'playback', 'camera_mechanic', 'gaffer', 'dop',
  'casting_director', 'casting_assistant',
])
function canSeeProjectWarehouse(role) {
  const def = ROLES[role] || {}
  if (def.world !== 'production') return false
  return !NON_WAREHOUSE_ROLES.has(role)
}

// ── Горизонтальные табы раздела (под topbar) ──
// Экспортируются на случай, если понадобятся в других местах.
export const PRODUCER_WAREHOUSE_TABS = [
  { to: '/production/warehouse',         label: 'Склад',         match: /^\/production\/warehouse/ },
  { to: '/production/project-warehouse', label: 'Склад проекта', match: /^\/production\/project-warehouse/ },
  { to: '/production/requests',          label: 'Заявки',        match: /^\/production\/requests/ },
  { to: '/production/rent',              label: 'Аренда',        match: /^\/production\/rent/ },
  { to: '/production/decorations',       label: 'Декорации',     match: /^\/production\/decorations/ },
]
export const PRODUCER_ANALYTICS_TABS = [
  { to: '/analytics/producer', label: 'Аналитика', match: /^\/analytics\/producer/ },
  { to: '/production/acts',    label: 'Акты',      match: /^\/production\/acts/ },
  { to: '/assets',             label: 'Активы',    match: /^\/assets/ },
  { to: '/debts',              label: 'Долги',     match: /^\/debts/ },
  { to: '/writeoffs',          label: 'Списания',  match: /^\/writeoffs/ },
]
export const PRODUCTION_BASE_TABS = [
  { to: '/production/locations', label: 'Локации',     match: /^\/production\/locations/ },
  { to: '/production/vehicles',  label: 'Транспорт',   match: /^\/production\/vehicles/ },
  { to: '/production/casting',   label: 'Кастинг АМС', match: /^\/production\/casting/ },
]
// Вкладки раздела «Проекты» у продюсера — объединяет обзор проектов и записи
// (КПП/сценарии/вызывные), т.к. документы — проектный контент.
export const PRODUCER_PROJECTS_TABS = [
  { to: '/production/analytics', label: 'Проекты', match: /^\/production\/analytics/ },
  { to: '/production/documents', label: 'Записи',  match: /^\/production\/documents/ },
]
export const STAFF_WAREHOUSE_TABS = [
  { to: '/production/warehouse',         label: 'Склад',         match: /^\/production\/warehouse/ },
  { to: '/production/project-warehouse', label: 'Склад проекта', match: /^\/production\/project-warehouse/ },
  { to: '/production/requests',          label: 'Заявки',        match: /^\/production\/requests/ },
  { to: '/production/decorations',       label: 'Декорации',     match: /^\/production\/decorations/ },
  { to: '/debts',                        label: 'Долги',         match: /^\/debts/ },
  { to: '/writeoffs',                    label: 'Списания',      match: /^\/writeoffs/ },
]
export const PROJECT_DIRECTOR_WAREHOUSE_TABS = STAFF_WAREHOUSE_TABS

// ── Rail-навигация по ролям ──
// Паттерн зеркалит WarehouseLayout: group.match — regex на URL-семью,
// чтобы один пункт подсвечивался для всех вложенных страниц.
function getRailNav(role) {
  const docs = { key: 'docs', to: '/production/documents', icon: FileText, label: 'Записи', match: /^\/production\/documents/ }

  if (role === 'producer') {
    // У продюсера «Записи» вынесены в раздел «Проекты» как вкладка —
    // документы всё равно проектный контент. Отдельного rail-пункта нет.
    return [
      { key: 'warehouse', to: '/production/warehouse', icon: Package, label: 'Склад',
        match: /^\/production\/(warehouse|project-warehouse|requests|rent|decorations)/ },
      { key: 'analytics', to: '/analytics/producer', icon: BarChart2, label: 'Аналитика',
        match: /^\/(analytics\/producer|production\/acts|assets|debts|writeoffs)/ },
      { key: 'base', to: '/production/locations', icon: MapPin, label: 'Продакшн-база',
        match: /^\/production\/(locations|vehicles|casting)/ },
      { key: 'projects', to: '/production/analytics', icon: FolderOpen, label: 'Проекты',
        match: /^\/production\/(analytics|documents)/ },
      { key: 'staff', to: '/production/staff', icon: Users, label: 'Сотрудники',
        match: /^\/production\/staff/ },
    ]
  }

  const isProjectHead = role === 'project_director'
    || role === 'project_deputy' || role === 'project_deputy_upload'

  const items = [docs]

  if (isProjectHead || canSeeProjectWarehouse(role)) {
    items.push({
      key: 'warehouse', to: '/production/warehouse', icon: Package, label: 'Склад',
      match: /^\/production\/(warehouse|project-warehouse|requests|decorations)|^\/(debts|writeoffs)/,
    })
  }
  if (isProjectHead || role === 'ams_assistant' || role === 'location_manager') {
    items.push({
      key: 'base', to: '/production/locations', icon: MapPin, label: 'Продакшн-база',
      match: /^\/production\/(locations|vehicles|casting)/,
    })
  }
  // Директор площадки работает в одном проекте — межпроектный обзор не нужен.
  if (!isProjectHead && role !== 'project_director') {
    // Не добавляем «Проекты» — он только для producer (обрабатывается выше).
  } else if (role !== 'project_director') {
    items.push({
      key: 'projects', to: '/production/analytics', icon: FolderOpen, label: 'Проекты',
      match: /^\/production\/analytics/,
    })
  }
  if (role === 'project_director') {
    items.push({ key: 'team', to: '/team', icon: Users, label: 'Команда', match: /^\/team/ })
  }
  return items
}

// Мобильный bottom-bar: первые 3 основные ссылки + центральный FAB «Создать»
// (или «Записи» для ролей без быстрых действий) + «Профиль» / «Ещё».
const MOBILE_SHOW_FAB_ROLES = new Set(['producer', 'project_director'])

function getInitials(name = '') {
  return name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase()
}

const css = `
/* ── Root ── */
.pl-root { display: flex; min-height: 100vh; background: var(--paper); }

/* ── Rail (desktop, 64px) ── */
.pl-rail {
  position: fixed;
  top: var(--impersonate-offset, 0px); left: 0; bottom: 0;
  width: 64px;
  background: var(--ink-950);
  display: flex; flex-direction: column; align-items: center;
  padding: 12px 0 10px;
  z-index: 100;
  border-right: 1px solid var(--sidebar-border);
}
.pl-rail-logo {
  width: 44px; height: 44px;
  display: flex; align-items: center; justify-content: center;
  margin-bottom: 14px;
  cursor: pointer;
  border-radius: 10px;
  transition: background 0.12s;
}
.pl-rail-logo:hover { background: rgba(255,255,255,0.04); }
.pl-rail-nav {
  flex: 1;
  display: flex; flex-direction: column; align-items: center;
  gap: 4px;
  width: 100%;
}
.pl-rail-btn {
  position: relative;
  width: 44px; height: 44px;
  display: flex; align-items: center; justify-content: center;
  background: transparent; border: none;
  border-radius: 10px;
  color: var(--sidebar-muted);
  cursor: pointer;
  transition: background 0.12s, color 0.12s;
  text-decoration: none;
}
.pl-rail-btn:hover {
  background: var(--sidebar-hover-bg);
  color: #fff;
}
.pl-rail-btn.active {
  color: var(--gold-400);
  background: var(--sidebar-active-bg);
}
.pl-rail-btn.active::before {
  content: '';
  position: absolute;
  left: -10px;
  top: 12px; bottom: 12px;
  width: 3px;
  background: var(--gold-500);
  border-radius: 0 3px 3px 0;
}
.pl-rail-tooltip {
  position: absolute;
  left: calc(100% + 10px);
  top: 50%; transform: translateY(-50%);
  background: var(--ink-800);
  color: #fff;
  font-size: 12px;
  font-weight: 500;
  padding: 6px 10px;
  border-radius: 6px;
  white-space: nowrap;
  opacity: 0;
  pointer-events: none;
  transition: opacity 0.12s;
  z-index: 300;
  box-shadow: 0 4px 12px rgba(0,0,0,0.3);
}
.pl-rail-btn:hover .pl-rail-tooltip { opacity: 1; }

.pl-rail-bottom {
  display: flex; flex-direction: column; align-items: center;
  gap: 6px;
  width: 100%;
}
.pl-rail-bottom::before {
  content: '';
  width: 28px; height: 1px;
  background: var(--sidebar-border);
  margin-bottom: 4px;
}
.pl-rail-quick {
  background: var(--gold-500);
  color: var(--ink-950);
}
.pl-rail-quick:hover {
  background: var(--gold-400);
  color: var(--ink-950);
}
.pl-rail-avatar {
  width: 36px; height: 36px;
  border-radius: 50%;
  background: var(--ink-700);
  color: #fff;
  font-size: 12px; font-weight: 600;
  display: flex; align-items: center; justify-content: center;
  border: 1px solid var(--sidebar-border);
  cursor: pointer;
  transition: background 0.12s;
}
.pl-rail-avatar:hover { background: var(--ink-800); }

/* ── Topbar (desktop) ── */
.pl-topbar {
  position: fixed;
  top: var(--impersonate-offset, 0px); left: 64px; right: 0;
  height: 56px;
  background: var(--ink-950);
  border-bottom: 1px solid var(--sidebar-border);
  display: flex; align-items: center;
  padding: 0 20px;
  gap: 14px;
  z-index: 90;
}
.pl-proj-selector {
  display: inline-flex; align-items: center; gap: 8px;
  padding: 7px 12px;
  background: rgba(255,255,255,0.05);
  border: 1px solid var(--sidebar-border);
  border-radius: 8px;
  color: #fff;
  font-size: 13px; font-weight: 500;
  cursor: pointer;
  transition: background 0.12s;
  position: relative;
  font-family: inherit;
  max-width: 240px;
}
.pl-proj-selector:hover { background: rgba(255,255,255,0.08); }
.pl-proj-selector-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.pl-proj-dd {
  position: absolute; top: calc(100% + 4px); left: 0;
  min-width: 240px; max-height: 360px; overflow-y: auto;
  background: var(--ink-900);
  border: 1px solid var(--sidebar-border);
  border-radius: 10px;
  padding: 4px;
  box-shadow: 0 10px 30px rgba(0,0,0,0.4);
  z-index: 300;
}
.pl-proj-opt {
  width: 100%; text-align: left;
  padding: 8px 10px;
  background: transparent; border: none;
  color: rgba(255,255,255,0.85);
  font-size: 13px;
  border-radius: 6px;
  cursor: pointer;
  font-family: inherit;
  display: block;
}
.pl-proj-opt:hover { background: rgba(255,255,255,0.06); }
.pl-proj-opt.sel { color: var(--gold-400); }
.pl-proj-divider {
  height: 1px;
  background: var(--sidebar-border);
  margin: 4px 0;
}
.pl-proj-add {
  width: 100%; text-align: left;
  padding: 8px 10px;
  background: transparent; border: none;
  color: var(--gold-400);
  font-size: 13px; font-weight: 500;
  border-radius: 6px;
  cursor: pointer;
  font-family: inherit;
  display: flex; align-items: center; gap: 6px;
}
.pl-proj-add:hover { background: rgba(255,255,255,0.06); }

.pl-search-btn {
  flex: 1; max-width: 560px;
  display: inline-flex; align-items: center; gap: 10px;
  padding: 8px 14px;
  background: rgba(255,255,255,0.04);
  border: 1px solid var(--sidebar-border);
  border-radius: 10px;
  color: rgba(255,255,255,0.5);
  font-size: 13px;
  cursor: pointer;
  font-family: inherit;
  transition: background 0.12s;
}
.pl-search-btn:hover {
  background: rgba(255,255,255,0.07);
  border-color: rgba(255,255,255,0.14);
}
.pl-search-btn kbd {
  margin-left: auto;
  font-family: ui-monospace, monospace;
  font-size: 10px;
  padding: 2px 6px;
  background: rgba(255,255,255,0.07);
  border-radius: 4px;
  color: rgba(255,255,255,0.6);
}

.pl-top-actions { display: flex; align-items: center; gap: 6px; margin-left: auto; }
.pl-top-btn {
  position: relative;
  width: 36px; height: 36px;
  background: transparent;
  border: 1px solid transparent;
  border-radius: 8px;
  color: rgba(255,255,255,0.7);
  display: flex; align-items: center; justify-content: center;
  cursor: pointer;
  transition: background 0.12s, color 0.12s;
}
.pl-top-btn:hover { background: rgba(255,255,255,0.06); color: #fff; }
.pl-top-btn-dot {
  position: absolute; top: 6px; right: 6px;
  width: 7px; height: 7px;
  border-radius: 50%;
  background: var(--gold-500);
  border: 2px solid var(--ink-950);
}

/* ── Main content ── */
.pl-main {
  margin-left: 64px;
  padding-top: 56px;
  flex: 1;
  min-height: 100vh;
}
.pl-back {
  display: inline-flex; align-items: center; gap: 4px;
  padding: 8px 14px 4px 28px;
  background: none; border: none;
  color: var(--muted);
  font-size: 12.5px; font-weight: 500;
  font-family: inherit;
  cursor: pointer;
  transition: color 0.12s;
  letter-spacing: 0.005em;
}
.pl-back:hover { color: var(--gold-600); }

/* ── Mobile topbar ── */
.pl-mtop {
  display: none;
  position: fixed;
  top: var(--impersonate-offset, 0px); left: 0; right: 0;
  height: 52px;
  background: var(--ink-950);
  border-bottom: 1px solid var(--sidebar-border);
  align-items: center;
  padding: 0 12px;
  gap: 8px;
  z-index: 200;
}
.pl-mtop-logo { display: flex; align-items: center; gap: 8px; cursor: pointer; flex-shrink: 0; }
.pl-mtop-proj {
  background: rgba(255,255,255,0.06);
  color: #fff;
  border: 1px solid var(--sidebar-border);
  padding: 5px 10px;
  border-radius: 8px;
  font-size: 12px;
  font-family: inherit;
  display: inline-flex; align-items: center; gap: 4px;
  cursor: pointer;
  min-width: 0;
  flex: 1;
  max-width: 180px;
}
.pl-mtop-proj span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.pl-mtop-actions { display: flex; gap: 2px; margin-left: auto; flex-shrink: 0; }

/* ── Mobile bottom nav ── */
.pl-mnav {
  display: none;
  position: fixed; bottom: 0; left: 0; right: 0;
  background: #fff;
  border-top: 1px solid var(--border);
  z-index: 200;
  padding: 6px 0 max(6px, env(safe-area-inset-bottom));
}
.pl-mnav-inner { display: flex; justify-content: space-around; align-items: center; }
.pl-mnav-item {
  flex: 1;
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  gap: 2px; padding: 6px 4px;
  font-size: 10px; font-weight: 500;
  color: var(--muted);
  text-decoration: none;
  background: none; border: none;
  cursor: pointer;
  font-family: inherit;
  min-height: 52px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.pl-mnav-item.active { color: var(--gold-600); }
.pl-mnav-fab-wrap {
  display: flex; justify-content: center; flex: 0 0 auto;
  padding: 0 4px;
}
.pl-mnav-fab {
  width: 52px; height: 52px;
  border-radius: 50%;
  background: var(--gold-500);
  color: var(--ink-950);
  border: none;
  display: flex; align-items: center; justify-content: center;
  box-shadow: 0 6px 16px rgba(184,147,90,0.4);
  cursor: pointer;
  transform: translateY(-14px);
  transition: background 0.12s;
}
.pl-mnav-fab:hover { background: var(--gold-400); }

/* ── Drawer (mobile «Ещё») ── */
.pl-drawer-overlay {
  position: fixed; inset: 0; z-index: 300;
  background: rgba(0,0,0,0.5);
  backdrop-filter: blur(2px);
}
.pl-drawer {
  position: absolute; bottom: 0; left: 0; right: 0;
  background: #fff;
  border-radius: 18px 18px 0 0;
  padding: 8px 16px max(20px, env(safe-area-inset-bottom));
  max-height: 80vh;
  overflow-y: auto;
}
.pl-drawer-handle {
  width: 36px; height: 4px; border-radius: 4px;
  background: var(--border-strong);
  margin: 8px auto 14px;
}
.pl-drawer-title {
  font-size: 11px; font-weight: 600;
  letter-spacing: 0.08em; text-transform: uppercase;
  color: var(--muted);
  padding: 0 4px 6px;
}
.pl-drawer-item {
  display: flex; align-items: center; gap: 12px;
  padding: 14px 4px;
  border-bottom: 1px solid var(--border);
  color: var(--text); font-size: 15px; font-weight: 450;
  text-decoration: none;
  background: none; border-left: none; border-right: none; border-top: none;
  width: 100%; text-align: left;
  font-family: inherit;
  cursor: pointer;
}
.pl-drawer-item:last-of-type { border-bottom: none; }
.pl-drawer-item-icon {
  width: 36px; height: 36px; border-radius: 9px;
  background: var(--gold-100);
  color: var(--gold-600);
  display: flex; align-items: center; justify-content: center;
  flex-shrink: 0;
}
.pl-drawer-profile {
  display: flex; align-items: center; gap: 12px;
  padding: 12px 4px 14px;
  border-bottom: 1px solid var(--border);
  margin-bottom: 6px;
}
.pl-drawer-avatar {
  width: 42px; height: 42px; border-radius: 50%;
  background: var(--ink-900);
  color: #fff; font-weight: 600; font-size: 14px;
  display: flex; align-items: center; justify-content: center;
}
.pl-drawer-name { font-size: 14px; font-weight: 600; color: var(--text); }
.pl-drawer-role { font-size: 11px; color: var(--muted); margin-top: 2px; letter-spacing: 0.04em; }
.pl-drawer-logout { color: var(--red); margin-top: 4px; }
.pl-drawer-logout .pl-drawer-item-icon { background: var(--red-dim); color: var(--red); }

/* ── Quick Action popover (desktop «+») ── */
.pl-qa-pop {
  position: fixed;
  left: 72px; bottom: 66px;
  background: var(--ink-900);
  border: 1px solid var(--sidebar-border);
  border-radius: 12px;
  padding: 6px;
  min-width: 240px;
  box-shadow: 0 12px 32px rgba(0,0,0,0.4);
  z-index: 300;
}
.pl-qa-item {
  display: flex; align-items: center; gap: 10px;
  width: 100%;
  padding: 10px 12px;
  background: transparent; border: none;
  color: rgba(255,255,255,0.85);
  font-size: 13px;
  border-radius: 8px;
  cursor: pointer;
  font-family: inherit;
  text-align: left;
}
.pl-qa-item:hover { background: rgba(255,255,255,0.06); color: #fff; }

/* Mobile: Quick Action bottom-sheet */
.pl-qa-sheet-overlay {
  display: none;
  position: fixed; inset: 0;
  background: rgba(0,0,0,0.5);
  backdrop-filter: blur(2px);
  z-index: 305;
  align-items: flex-end; justify-content: center;
}
.pl-qa-sheet {
  background: #fff;
  border-radius: 18px 18px 0 0;
  padding: 8px 16px max(20px, env(safe-area-inset-bottom));
  width: 100%;
  max-height: 70vh; overflow-y: auto;
}
.pl-qa-sheet-handle {
  width: 36px; height: 4px; border-radius: 4px;
  background: var(--border-strong);
  margin: 8px auto 10px;
}
.pl-qa-sheet-title {
  font-size: 11px; font-weight: 600;
  letter-spacing: 0.08em; text-transform: uppercase;
  color: var(--muted);
  padding: 0 4px 6px;
}
.pl-qa-sheet-item {
  display: flex; align-items: center; gap: 12px;
  width: 100%;
  padding: 14px 4px;
  border: none; border-bottom: 1px solid var(--border);
  background: none;
  color: var(--text); font-size: 15px; font-weight: 450;
  cursor: pointer;
  font-family: inherit;
  text-align: left;
}
.pl-qa-sheet-item:last-child { border-bottom: none; }
.pl-qa-sheet-icon {
  width: 36px; height: 36px; border-radius: 9px;
  background: var(--gold-100); color: var(--gold-600);
  display: flex; align-items: center; justify-content: center;
  flex-shrink: 0;
}
@media (max-width: 768px) {
  .pl-qa-pop { display: none !important; }
  .pl-qa-sheet-overlay { display: flex; }
}

/* ── Публичная ссылка — модалка (переиспользует стили из WarehouseLayout) ── */
.pl-pl-overlay {
  position: fixed; inset: 0; z-index: 400;
  background: rgba(10,10,10,0.55);
  backdrop-filter: blur(3px);
  display: flex; align-items: center; justify-content: center;
  padding: 20px;
}
.pl-pl-modal {
  background: #fff;
  border-radius: 14px;
  padding: 24px;
  width: 100%; max-width: 520px;
  box-shadow: 0 16px 48px rgba(0,0,0,0.25);
}
.pl-pl-title { font-size: 17px; font-weight: 600; color: var(--text); }
.pl-pl-sub   { font-size: 13px; color: var(--muted); margin-top: 4px; margin-bottom: 18px; }
.pl-pl-row   { display: flex; gap: 8px; margin-bottom: 14px; }
.pl-pl-input {
  flex: 1;
  height: 40px;
  padding: 0 12px;
  border: 1px solid var(--border);
  border-radius: 10px;
  background: var(--paper);
  font-family: ui-monospace, monospace;
  font-size: 12px;
  color: var(--text);
}
.pl-pl-input:focus { border-color: var(--gold-500); }
.pl-pl-copy {
  height: 40px;
  padding: 0 14px;
  background: var(--ink-950);
  color: #fff;
  border: none;
  border-radius: 10px;
  font-size: 13px; font-weight: 500;
  display: inline-flex; align-items: center; gap: 6px;
  cursor: pointer;
  font-family: inherit;
  transition: background 0.12s;
  white-space: nowrap;
}
.pl-pl-copy:hover { background: var(--ink-800); }
.pl-pl-close {
  width: 100%;
  height: 40px;
  background: transparent;
  border: 1px solid var(--border);
  border-radius: 10px;
  color: var(--text);
  font-size: 13px; font-weight: 500;
  cursor: pointer;
  font-family: inherit;
}
.pl-pl-close:hover { background: var(--bg-secondary); }

/* ── Responsive ── */
@media (max-width: 768px) {
  .pl-rail   { display: none !important; }
  .pl-topbar { display: none !important; }
  .pl-main   {
    margin-left: 0 !important;
    padding-top: 52px;
    padding-bottom: calc(76px + env(safe-area-inset-bottom, 0px));
  }
  .pl-mtop   { display: flex !important; }
  .pl-mnav   { display: block !important; }
}
`

export default function ProductionLayout({ children }) {
  const navigate = useNavigate()
  const location = useLocation()
  const { user, logout } = useAuth()
  const searchProps = useGlobalSearch()

  const [projOpen, setProjOpen] = useState(false)
  const [qaOpen, setQaOpen]     = useState(false)
  const [burger, setBurger]     = useState(false)

  const [projectsList, setProjectsList] = useState([])
  const [selectedProject, setSelectedProject] = useState(() => localStorage.getItem('project') || '')

  const [showNewProject, setShowNewProject] = useState(false)
  const [newProjectName, setNewProjectName] = useState('')
  const [creatingProject, setCreatingProject] = useState(false)
  const [projectCreated, setProjectCreated] = useState(false)

  const [showInvite, setShowInvite]     = useState(false)
  const [inviteRole, setInviteRole]     = useState('project_director')
  const [inviteLink, setInviteLink]     = useState('')
  const [inviteLoading, setInviteLoading] = useState(false)

  const [publicLink, setPublicLink]       = useState('')
  const [publicLinkLoading, setPublicLinkLoading] = useState(false)
  const [publicLinkCopied, setPublicLinkCopied] = useState(false)

  const projRef    = useRef(null)
  const qaRef      = useRef(null)
  const qaSheetRef = useRef(null)

  const role = user?.role || ''
  const roleDef = ROLES[role] || {}
  const roleLabel = roleDef.label || role
  const nav = getRailNav(role)
  const pathFull = location.pathname + location.search
  const showBack = !/^\/production\/documents(?:\/|$|\?)/.test(location.pathname)
    && location.pathname !== '/'
    && nav[0]?.to !== location.pathname
  const canPublicLink = !!ROLES[role]?.canPublicLink
  const showFab = MOBILE_SHOW_FAB_ROLES.has(role)

  // Блок body-scroll на время открытых оверлеев mobile/ui
  useBodyLock(burger || qaOpen || projOpen || showNewProject || showInvite || !!publicLink)

  useEffect(() => {
    projectsApi.list().then(d => {
      const HIDDEN = ['3xmedia', 'тестовый проект']
      const list = (d.projects || []).filter(p => !HIDDEN.includes((p.name || '').toLowerCase()))
      setProjectsList(list)
      const savedName = localStorage.getItem('project')
      if (!selectedProject && list.length) {
        const match = list.find(p => p.name === savedName) || list[0]
        setSelectedProject(match.name)
        localStorage.setItem('project', match.name)
      }
    }).catch(() => {})
  }, [])

  // Закрытие поповеров при клике вне.
  // Для QA учитываем И desktop-popover (qaRef) И mobile bottom-sheet (qaSheetRef) —
  // иначе тап по кнопке в мобильной sheet-е закрывает её через mousedown
  // до срабатывания onClick («кнопки не откликаются»).
  useEffect(() => {
    function onClick(e) {
      if (projRef.current && !projRef.current.contains(e.target)) setProjOpen(false)
      const insideQa = (qaRef.current && qaRef.current.contains(e.target))
        || (qaSheetRef.current && qaSheetRef.current.contains(e.target))
      if (!insideQa) setQaOpen(false)
    }
    if (projOpen || qaOpen) {
      document.addEventListener('mousedown', onClick)
      return () => document.removeEventListener('mousedown', onClick)
    }
  }, [projOpen, qaOpen])

  function selectProject(name) {
    localStorage.setItem('project', name)
    setSelectedProject(name)
    setProjOpen(false)
  }

  function getSelectedProjectId() {
    const proj = projectsList.find(p => p.name === selectedProject)
    return proj?.id || user?.project_id || null
  }

  async function handleCreateProject() {
    if (!newProjectName.trim()) return
    setCreatingProject(true)
    try {
      const res = await projectsApi.create(newProjectName.trim())
      const newProj = res.project || { name: newProjectName.trim() }
      setProjectsList(prev => [...prev, newProj])
      selectProject(newProj.name)
      setProjectCreated(true)
    } catch (e) { alert(e.message || 'Ошибка') }
    setCreatingProject(false)
  }

  async function handleGenerateInvite() {
    setInviteLoading(true)
    try {
      const pid = getSelectedProjectId()
      if (!pid) { alert('Выберите проект'); setInviteLoading(false); return }
      const d = await invitesApi.generate({ role: inviteRole, project_id: pid })
      setInviteLink(`${window.location.origin}/invite/${d.invite.token}`)
    } catch (e) { alert(e.message || 'Ошибка') }
    setInviteLoading(false)
  }

  async function generatePublicLink() {
    setQaOpen(false); setBurger(false)
    if (publicLinkLoading) return
    setPublicLinkLoading(true)
    try {
      const data = await rentApi.generateLink()
      const url = data.url || data.link
      if (url) setPublicLink(`${window.location.origin}${url}`)
    } catch { /* silent */ }
    setPublicLinkLoading(false)
  }

  function copyPublicLink() {
    navigator.clipboard.writeText(publicLink)
    setPublicLinkCopied(true)
    setTimeout(() => setPublicLinkCopied(false), 1800)
  }

  function closePublicLink() {
    setPublicLink('')
    setPublicLinkCopied(false)
  }

  function quickNav(path) {
    setQaOpen(false)
    navigate(path)
  }

  // Мобильный FAB открывает bottom-sheet с тем же набором, что desktop-поповер
  // на rail. Прямой шорткат на одно действие был неинтуитивен.
  function handleFabClick() {
    setQaOpen(true); setBurger(false)
  }

  // Мобильный drawer — все пункты кроме первых 2-3 + Профиль + Логаут.
  const mobileMain = nav.slice(0, showFab ? 2 : 3)
  const mobileDrawerItems = nav.slice(mobileMain.length)

  return (
    <>
      <style>{css}</style>
      <div className="pl-root">

        {/* ═══ Desktop Rail (64px) ═══ */}
        <aside className="pl-rail">
          <div className="pl-rail-logo" onClick={() => navigate(nav[0]?.to || '/production/documents')} title="Главная">
            <TriixLogo size={30} />
          </div>

          <nav className="pl-rail-nav">
            {nav.map(g => {
              const active = g.match.test(pathFull)
              const Icon = g.icon
              return (
                <NavLink
                  key={g.key}
                  to={g.to}
                  className={`pl-rail-btn${active ? ' active' : ''}`}
                >
                  <Icon size={20} strokeWidth={1.8} />
                  <span className="pl-rail-tooltip">{g.label}</span>
                </NavLink>
              )
            })}
          </nav>

          <div className="pl-rail-bottom">
            {(role === 'producer' || role === 'project_director') && (
              <div ref={qaRef} style={{ position: 'relative' }}>
                <button
                  className="pl-rail-btn pl-rail-quick"
                  onClick={() => setQaOpen(v => !v)}
                  aria-label="Быстрое действие"
                >
                  <Plus size={22} strokeWidth={2.2} />
                  <span className="pl-rail-tooltip">Создать</span>
                </button>
                {qaOpen && (
                  <div className="pl-qa-pop">
                    {role === 'producer' && (
                      <button className="pl-qa-item" onClick={() => { setQaOpen(false); setShowNewProject(true) }}>
                        <FolderOpen size={16} /> Новый проект
                      </button>
                    )}
                    <button className="pl-qa-item" onClick={() => { setQaOpen(false); setShowInvite(true) }}>
                      <UserPlus size={16} /> Пригласить участника
                    </button>
                    {canPublicLink && (
                      <button className="pl-qa-item" onClick={generatePublicLink} disabled={publicLinkLoading}>
                        <LinkIcon size={16} /> {publicLinkLoading ? 'Генерация…' : 'Партнёрская ссылка'}
                      </button>
                    )}
                    <button className="pl-qa-item" onClick={() => quickNav('/production/documents')}>
                      <FileText size={16} /> К документам
                    </button>
                  </div>
                )}
              </div>
            )}

            <button
              className="pl-rail-avatar"
              onClick={() => navigate('/profile')}
              title={user?.name || 'Профиль'}
            >
              {getInitials(user?.name || 'ПР')}
            </button>
          </div>
        </aside>

        {/* ═══ Desktop Topbar (56px) ═══ */}
        <div className="pl-topbar">
          <div ref={projRef} style={{ position: 'relative' }}>
            <button className="pl-proj-selector" onClick={() => setProjOpen(v => !v)}>
              <FolderOpen size={14} strokeWidth={2} />
              <span className="pl-proj-selector-name">{selectedProject || 'Выбрать проект'}</span>
              <ChevronDown size={14} strokeWidth={2} style={{ opacity: 0.6 }} />
            </button>
            {projOpen && (
              <div className="pl-proj-dd">
                {projectsList.length === 0 && (
                  <div style={{ padding: '10px 12px', fontSize: 12, color: 'var(--sidebar-muted)' }}>
                    Проектов пока нет
                  </div>
                )}
                {projectsList.map(p => (
                  <button
                    key={p.id || p.name}
                    className={`pl-proj-opt${p.name === selectedProject ? ' sel' : ''}`}
                    onClick={() => selectProject(p.name)}
                  >
                    {p.name}
                  </button>
                ))}
                {role === 'producer' && (
                  <>
                    <div className="pl-proj-divider" />
                    <button className="pl-proj-add" onClick={() => { setProjOpen(false); setShowNewProject(true) }}>
                      <Plus size={14} strokeWidth={2.2} /> Новый проект
                    </button>
                  </>
                )}
              </div>
            )}
          </div>

          <button className="pl-search-btn" onClick={() => searchProps.setOpen(true)}>
            <Search size={14} strokeWidth={2} />
            <span>Поиск по проекту…</span>
            <kbd>Ctrl K</kbd>
          </button>

          <div className="pl-top-actions">
            {/* Уведомления убраны по ТЗ. */}
          </div>
        </div>

        {/* ═══ Mobile Topbar ═══ */}
        <div className="pl-mtop">
          <div className="pl-mtop-logo" onClick={() => navigate(nav[0]?.to || '/production/documents')}>
            <TriixLogo size={26} />
          </div>
          <button className="pl-mtop-proj" onClick={() => setProjOpen(v => !v)}>
            <FolderOpen size={12} strokeWidth={2} />
            <span>{selectedProject || 'Проект'}</span>
          </button>
          <div className="pl-mtop-actions">
            <button className="pl-top-btn" onClick={() => searchProps.setOpen(true)}>
              <Search size={17} />
            </button>
          </div>

          {projOpen && (
            <div className="pl-proj-dd" style={{ position: 'fixed', top: 56, right: 14, left: 'auto' }}>
              {projectsList.length === 0 && (
                <div style={{ padding: '10px 12px', fontSize: 12, color: 'var(--sidebar-muted)' }}>
                  Проектов пока нет
                </div>
              )}
              {projectsList.map(p => (
                <button
                  key={p.id || p.name}
                  className={`pl-proj-opt${p.name === selectedProject ? ' sel' : ''}`}
                  onClick={() => selectProject(p.name)}
                >
                  {p.name}
                </button>
              ))}
              {role === 'producer' && (
                <>
                  <div className="pl-proj-divider" />
                  <button className="pl-proj-add" onClick={() => { setProjOpen(false); setShowNewProject(true) }}>
                    <Plus size={14} strokeWidth={2.2} /> Новый проект
                  </button>
                </>
              )}
            </div>
          )}
        </div>

        {/* ═══ Main content ═══ */}
        <main className="pl-main">
          {role === 'producer' && <SectionTabs items={PRODUCER_WAREHOUSE_TABS} />}
          {role === 'producer' && <SectionTabs items={PRODUCER_ANALYTICS_TABS} />}
          {role === 'producer' && <SectionTabs items={PRODUCER_PROJECTS_TABS} />}
          {role !== 'producer' && canSeeProjectWarehouse(role) &&
            <SectionTabs items={STAFF_WAREHOUSE_TABS} />}
          {(role === 'producer' || role === 'project_director'
             || role === 'project_deputy' || role === 'project_deputy_upload'
             || role === 'ams_assistant' || role === 'location_manager') &&
            <SectionTabs items={PRODUCTION_BASE_TABS} />}
          {showBack && (
            <button className="pl-back" onClick={() => navigate(-1)}>
              <ChevronLeft size={14} /> Назад
            </button>
          )}
          {children}
        </main>

        {/* ═══ Mobile bottom nav ═══ */}
        <nav className="pl-mnav">
          <div className="pl-mnav-inner">
            {mobileMain.map(item => (
              <NavLink
                key={item.to + item.label}
                to={item.to}
                className={({ isActive }) => `pl-mnav-item${isActive ? ' active' : ''}`}
              >
                <item.icon size={22} strokeWidth={1.8} />
                {item.label}
              </NavLink>
            ))}

            {showFab ? (
              <div className="pl-mnav-fab-wrap">
                <button className="pl-mnav-fab" onClick={handleFabClick} aria-label="Создать">
                  <Plus size={26} strokeWidth={2.2} />
                </button>
              </div>
            ) : null}

            <NavLink to="/profile" className={({ isActive }) => `pl-mnav-item${isActive ? ' active' : ''}`}>
              <User size={22} strokeWidth={1.8} />
              Профиль
            </NavLink>
            {mobileDrawerItems.length > 0 && (
              <button className="pl-mnav-item" onClick={() => setBurger(true)}>
                <Menu size={22} strokeWidth={1.8} />
                Ещё
              </button>
            )}
          </div>
        </nav>

        {/* ═══ Mobile Quick Action bottom-sheet ═══
            Mobile FAB открывает тот же набор, что desktop-поповер на rail. */}
        {qaOpen && (
          <div className="pl-qa-sheet-overlay" onClick={() => setQaOpen(false)}>
            <div className="pl-qa-sheet" ref={qaSheetRef} onClick={e => e.stopPropagation()}>
              <div className="pl-qa-sheet-handle" />
              <div className="pl-qa-sheet-title">Создать</div>
              {role === 'producer' && (
                <button className="pl-qa-sheet-item" onClick={() => { setQaOpen(false); setShowNewProject(true) }}>
                  <div className="pl-qa-sheet-icon"><FolderOpen size={18} /></div>
                  Новый проект
                </button>
              )}
              {(role === 'producer' || role === 'project_director') && (
                <button className="pl-qa-sheet-item" onClick={() => { setQaOpen(false); setShowInvite(true) }}>
                  <div className="pl-qa-sheet-icon"><UserPlus size={18} /></div>
                  Пригласить участника
                </button>
              )}
              {canPublicLink && (
                <button className="pl-qa-sheet-item" onClick={generatePublicLink} disabled={publicLinkLoading}>
                  <div className="pl-qa-sheet-icon"><LinkIcon size={18} /></div>
                  {publicLinkLoading ? 'Генерация…' : 'Партнёрская ссылка'}
                </button>
              )}
              <button className="pl-qa-sheet-item" onClick={() => quickNav('/production/documents')}>
                <div className="pl-qa-sheet-icon"><FileText size={18} /></div>
                К документам
              </button>
            </div>
          </div>
        )}

        {/* ═══ Mobile drawer ═══ */}
        {burger && (
          <div className="pl-drawer-overlay" onClick={() => setBurger(false)}>
            <div className="pl-drawer" onClick={e => e.stopPropagation()}>
              <div className="pl-drawer-handle" />

              <div className="pl-drawer-profile">
                <div className="pl-drawer-avatar">{getInitials(user?.name || 'ПР')}</div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="pl-drawer-name truncate">{user?.name || 'Профиль'}</div>
                  <div className="pl-drawer-role truncate">{roleLabel}</div>
                </div>
              </div>

              <div className="pl-drawer-title">Меню</div>
              {mobileDrawerItems.map(item => (
                <button key={item.to + item.label} className="pl-drawer-item"
                  onClick={() => { setBurger(false); navigate(item.to) }}>
                  <div className="pl-drawer-item-icon">
                    <item.icon size={18} strokeWidth={1.8} />
                  </div>
                  {item.label}
                </button>
              ))}
              <button className="pl-drawer-item pl-drawer-logout" onClick={() => { setBurger(false); logout(); }}>
                <div className="pl-drawer-item-icon">
                  <LogOut size={18} strokeWidth={1.8} />
                </div>
                Выйти
              </button>
            </div>
          </div>
        )}

        {/* ═══ Публичная ссылка ═══ */}
        {publicLink && (
          <div className="pl-pl-overlay" onClick={closePublicLink}>
            <div className="pl-pl-modal" onClick={e => e.stopPropagation()}>
              <div className="pl-pl-title">Партнёрская ссылка склада</div>
              <div className="pl-pl-sub">Отправьте клиенту — он увидит каталог без регистрации.</div>
              <div className="pl-pl-row">
                <input readOnly value={publicLink} className="pl-pl-input" onFocus={e => e.target.select()} />
                <button className="pl-pl-copy" onClick={copyPublicLink}>
                  {publicLinkCopied ? <><Check size={14} /> Скопировано</> : <><Copy size={14} /> Копировать</>}
                </button>
              </div>
              <button className="pl-pl-close" onClick={closePublicLink}>Закрыть</button>
            </div>
          </div>
        )}

        <GlobalSearchBar {...searchProps} />
      </div>

      {/* ═══ Модалка нового проекта ═══ */}
      {showNewProject && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 500, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}
          onClick={() => { setShowNewProject(false); setProjectCreated(false); setNewProjectName('') }}>
          <div style={{ background: 'var(--white)', borderRadius: 'var(--radius-card)', padding: 24, maxWidth: 400, width: '100%' }}
            onClick={e => e.stopPropagation()}>
            <div style={{ fontWeight: 600, fontSize: 16, marginBottom: 16 }}>
              {projectCreated ? 'Проект создан' : 'Новый проект'}
            </div>
            {!projectCreated ? (
              <>
                <Input label="Название проекта" placeholder="Название..." value={newProjectName} onChange={e => setNewProjectName(e.target.value)} />
                <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                  <Button variant="secondary" fullWidth onClick={() => setShowNewProject(false)}>Отмена</Button>
                  <Button fullWidth disabled={!newProjectName.trim() || creatingProject} onClick={handleCreateProject}>
                    {creatingProject ? 'Создание...' : 'Создать'}
                  </Button>
                </div>
              </>
            ) : (
              <>
                <div style={{ fontSize: 13, color: 'var(--green)', marginBottom: 16, fontWeight: 500 }}>
                  Проект «{selectedProject}» успешно создан
                </div>
                <Button fullWidth onClick={() => { setShowNewProject(false); setProjectCreated(false); setShowInvite(true) }}>
                  Пригласить участника
                </Button>
                <Button variant="secondary" fullWidth style={{ marginTop: 8 }}
                  onClick={() => { setShowNewProject(false); setProjectCreated(false); setNewProjectName('') }}>
                  Закрыть
                </Button>
              </>
            )}
          </div>
        </div>
      )}

      {/* ═══ Модалка инвайта ═══ */}
      {showInvite && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 500, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}
          onClick={() => { setShowInvite(false); setInviteLink('') }}>
          <div style={{ background: 'var(--white)', borderRadius: 'var(--radius-card)', padding: 24, maxWidth: 420, width: '100%' }}
            onClick={e => e.stopPropagation()}>
            <div style={{ fontWeight: 600, fontSize: 16, marginBottom: 16 }}>Пригласить участника</div>
            <div style={{ fontSize: 12, fontWeight: 500, marginBottom: 4, color: 'var(--muted)' }}>Роль</div>
            <select value={inviteRole} onChange={e => setInviteRole(e.target.value)}
              style={{ width: '100%', height: 38, padding: '0 10px', border: '1px solid var(--border)', borderRadius: 'var(--radius-btn)', fontSize: 13, background: 'var(--white)', marginBottom: 12 }}>
              {Object.entries(ROLES).filter(([, v]) => v.world).map(([k, v]) => (
                <option key={k} value={k}>{v.label}</option>
              ))}
            </select>
            {!inviteLink ? (
              <Button fullWidth disabled={inviteLoading} onClick={handleGenerateInvite}>
                {inviteLoading ? 'Генерация...' : 'Сгенерировать ссылку'}
              </Button>
            ) : (
              <div>
                <div style={{ fontSize: 12, fontWeight: 500, marginBottom: 4, color: 'var(--muted)' }}>Ссылка приглашения</div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <input readOnly value={inviteLink}
                    style={{ flex: 1, height: 38, padding: '0 10px', border: '1px solid var(--border)', borderRadius: 'var(--radius-btn)', fontSize: 12, background: 'var(--bg)' }} />
                  <Button onClick={() => { navigator.clipboard.writeText(inviteLink); }}>Копировать</Button>
                </div>
              </div>
            )}
            <Button variant="secondary" fullWidth style={{ marginTop: 12 }}
              onClick={() => { setShowInvite(false); setInviteLink('') }}>Закрыть</Button>
          </div>
        </div>
      )}
    </>
  )
}
