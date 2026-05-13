import { useState, useEffect, useRef } from 'react'
import { NavLink, useNavigate, useLocation, useSearchParams } from 'react-router-dom'
import {
  Home, Package, LayoutGrid, AlertTriangle, Users,
  Menu, Search, Plus, ChevronDown, ChevronLeft, MapPin, LogOut,
  Link as LinkIcon, Copy, Check, X, Zap, Send, Images,
} from 'lucide-react'
import { useAuth } from '../../hooks/useAuth'
import { useGlobalSearch } from '../../hooks/useGlobalSearch'
import { useBodyLock } from '../../hooks/useBodyLock'
import { ROLES } from '../../constants/roles'
import { rent as rentApi } from '../../services/api'
import GlobalSearchBar from '../shared/GlobalSearchBar'
import SectionTabs from '../shared/SectionTabs'
import TriixLogo from '../shared/TriixLogo'

// ── Группы навигации (6 пунктов вместо 11) ──
// Каждая группа покрывает семейство URL через `match`. Клик по пункту
// rail-сайдбара ведёт на первый URL из семейства (`to`), активная
// подсветка работает на все URL группы.
const NAV_GROUPS = [
  { key: 'home',     to: '/dashboard', icon: Home,            label: 'Главная',  match: /^\/(dashboard|assets)/ },
  { key: 'catalog',  to: '/units',     icon: Package,          label: 'Каталог',  match: /^\/(units|admin-stock|decorations|production\/project-warehouse)/ },
  // «Движение» — объединённый раздел: заявки/выданное/возвраты в едином
  // списке с подвкладками Все/Новые/Выданы/Возвращают/Вернули/Акты.
  // Раньше назывался «Выдача» — переименован 2026-05-04 чтобы семантически
  // покрыть все этапы цикла (а не только сам факт выдачи).
  { key: 'issuance', to: '/issued',    icon: Send,             label: 'Движение', match: /^\/(requests|issued|walkin|issue|return|returns|acts|rent)/ },
  { key: 'map',      to: '/cells',     icon: LayoutGrid,       label: 'Склады',   match: /^\/cells/ },
  { key: 'problems', to: '/debts',     icon: AlertTriangle,    label: 'Проблемы', match: /^\/(debts|writeoffs|misplaced)/ },
  { key: 'team',     to: '/team',      icon: Users,            label: 'Команда',  match: /^\/team/ },
]

// Скрытие групп по роли warehouse_staff (ограниченный функционал).
// Для staff «Проблемы» перенаправляем на /misplaced — единственная
// доступная им вкладка из этой группы.
const HIDDEN_GROUPS_BY_ROLE = {
  warehouse_staff: ['team'],
}
const STAFF_PROBLEMS_OVERRIDE = {
  warehouse_staff: { to: '/misplaced', match: /^\/misplaced/ },
}

function getNav(role) {
  const hidden = HIDDEN_GROUPS_BY_ROLE[role] || []
  const override = STAFF_PROBLEMS_OVERRIDE[role]
  return NAV_GROUPS
    .filter(g => !hidden.includes(g.key))
    .map(g => (override && g.key === 'problems') ? { ...g, ...override } : g)
}

// ── Вкладки раздела (SectionTabs) ──
// Рендерятся одной строкой под topbar, показываются только если текущий
// URL входит в соответствующую группу.
const CATALOG_TABS = [
  { to: '/units',                        label: 'Каталог',       match: /^\/units/ },
  { to: '/production/project-warehouse', label: 'Склад проекта', match: /^\/production\/project-warehouse/ },
  { to: '/admin-stock',                  label: 'Админка',       match: /^\/admin-stock/ },
  { to: '/decorations',                  label: 'Декорации',     match: /^\/decorations/ },
]
// «Движение» — единая страница без SectionTabs. Все секции
// (Все/Новые/Выданы/Возвращают/Вернули/Акты) живут как чипы-фильтры
// внутри самой страницы /issued (IssuedByProjectsPage).
const ISSUANCE_TABS = []
const PROBLEMS_TABS = [
  { to: '/debts',     label: 'Долги',     match: /^\/debts/ },
  { to: '/writeoffs', label: 'Списания',  match: /^\/writeoffs/ },
  { to: '/misplaced', label: 'Пересорт',  match: /^\/misplaced/ },
]
const TEAM_TABS = [
  { to: '/team', label: 'Команда', match: /^\/team/ },
]

// Фильтр табов по скрытым для роли URL
const HIDDEN_URLS_BY_ROLE = {
  // Staff не видит «Акты» (закрытая аналитика), «Команду» и пр.
  // «Движение» (/issued) теперь доступна — это иерархический список заявок
  // с подфильтрами, для staff это единственный таб раздела.
  warehouse_staff: ['/rent', '/acts', '/team', '/assets', '/debts', '/writeoffs'],
}
function filterTabsForRole(tabs, role) {
  const hidden = HIDDEN_URLS_BY_ROLE[role] || []
  return tabs.filter(t => !hidden.includes(t.to))
}

// Мобильный bottom-bar: 4 основных + центральная «+» + пункт «Ещё».
// «Движение» ведёт на /issued — единый список заявок/выданного/возвратов.
const MOBILE_TABS = [
  { to: '/dashboard', icon: Home,           label: 'Главная' },
  { to: '/units',     icon: Package,         label: 'Каталог' },
  { to: '/issued',    icon: Send,            label: 'Движение' },
]

// Mobile drawer «Ещё».
const MOBILE_DRAWER = [
  { to: '/cells',         icon: LayoutGrid,     label: 'Склады' },
  { to: '/debts',         icon: AlertTriangle,  label: 'Проблемы',    hideFor: ['warehouse_staff'] },
  { to: '/misplaced',     icon: AlertTriangle,  label: 'Пересорт',    onlyFor: ['warehouse_staff'] },
  { to: '/team',          icon: Users,          label: 'Команда',     hideFor: ['warehouse_staff'] },
  { to: '/profile',       icon: Users,          label: 'Профиль' },
]

const WAREHOUSES = ['Выбрать склад', 'Вирки 22', 'Чапаева 6']

function getInitials(name = '') {
  return name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase()
}

const css = `
/* ── Root ── */
/* --topbar-h: высота fixed-шапки (mtop на мобилке / topbar на десктопе).
   --tabs-h: высота строки SectionTabs если она активна (горизонтальные
            вкладки Заявки/Акты, Каталог/Склад/Декорации, Долги/…) — иначе 0.
   --page-sticky-top: точка прилипания шапки страницы (заголовок+фильтры).
            Прилипает под SectionTabs если они есть, иначе сразу под mtop. */
.wl-root {
  display: flex; min-height: 100vh; background: var(--paper);
  /* DEV/STAGING-баннер (App.jsx) измеряет свою реальную высоту через ref и
     выставляет --devenv-banner-h на documentElement. --top-offset = максимум
     между safe-area-inset-top и высотой баннера: когда баннер есть, он сам
     включает safe-area в свою padding-top, и нам нужно отступить ровно на
     полную высоту баннера. Когда баннера нет — просто safe-area. */
  --top-offset: max(env(safe-area-inset-top, 0px), var(--devenv-banner-h, 0px));
  --topbar-h: calc(56px + var(--top-offset));
  --tabs-h: 0px;
  --page-sticky-top: calc(var(--topbar-h) + var(--tabs-h));
}
/* --tabs-h-real пишется из SectionTabs (ResizeObserver на st-bar) — это
   точная высота строки табов в px. Фолбэк 40px используется до первого
   замера и если SectionTabs ещё не смонтирован. */
.wl-root.has-section-tabs { --tabs-h: var(--tabs-h-real, 40px); }

/* ── Rail (desktop, 64px) ── */
.wl-rail {
  position: fixed;
  top: var(--impersonate-offset, 0px); left: 0; bottom: 0;
  width: 64px;
  background: var(--ink-950);
  display: flex; flex-direction: column; align-items: center;
  padding: 12px 0 10px;
  z-index: 100;
  border-right: 1px solid var(--sidebar-border);
}
.wl-rail-logo {
  width: 44px; height: 44px;
  display: flex; align-items: center; justify-content: center;
  margin-bottom: 14px;
  cursor: pointer;
  border-radius: 10px;
  transition: background 0.12s;
}
.wl-rail-logo:hover { background: rgba(255,255,255,0.04); }
.wl-rail-nav {
  flex: 1;
  display: flex; flex-direction: column; align-items: center;
  gap: 4px;
  width: 100%;
}
.wl-rail-btn {
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
.wl-rail-btn:hover {
  background: var(--sidebar-hover-bg);
  color: #fff;
}
.wl-rail-btn.active {
  color: var(--gold-400);
  background: var(--sidebar-active-bg);
}
.wl-rail-btn.active::before {
  content: '';
  position: absolute;
  left: -10px;
  top: 12px; bottom: 12px;
  width: 3px;
  background: var(--gold-500);
  border-radius: 0 3px 3px 0;
}
.wl-rail-tooltip {
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
.wl-rail-btn:hover .wl-rail-tooltip { opacity: 1; }

.wl-rail-bottom {
  display: flex; flex-direction: column; align-items: center;
  gap: 6px;
  width: 100%;
}
.wl-rail-bottom::before {
  content: '';
  width: 28px; height: 1px;
  background: var(--sidebar-border);
  margin-bottom: 4px;
}
.wl-rail-quick {
  background: var(--gold-500);
  color: var(--ink-950);
}
.wl-rail-quick:hover {
  background: var(--gold-400);
  color: var(--ink-950);
}
.wl-rail-avatar {
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
.wl-rail-avatar:hover { background: var(--ink-800); }

/* ── Topbar (desktop) ── */
.wl-topbar {
  position: fixed;
  top: var(--impersonate-offset, 0px); left: 64px; right: 0;
  height: var(--topbar-h);
  padding-top: var(--top-offset);
  background: var(--ink-950);
  display: flex; align-items: center;
  padding-left: 20px; padding-right: 20px;
  gap: 14px;
  z-index: 90;
}
.wl-wh-selector {
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
}
.wl-wh-selector:hover { background: rgba(255,255,255,0.08); }
.wl-wh-dd {
  position: absolute; top: calc(100% + 4px); left: 0;
  min-width: 200px;
  background: var(--ink-900);
  border: 1px solid var(--sidebar-border);
  border-radius: 10px;
  padding: 4px;
  box-shadow: 0 10px 30px rgba(0,0,0,0.4);
  z-index: 300;
}
.wl-wh-opt {
  width: 100%; text-align: left;
  padding: 8px 10px;
  background: transparent; border: none;
  color: rgba(255,255,255,0.85);
  font-size: 13px;
  border-radius: 6px;
  cursor: pointer;
  font-family: inherit;
}
.wl-wh-opt:hover { background: rgba(255,255,255,0.06); }
.wl-wh-opt.sel { color: var(--gold-400); }

.wl-search-btn {
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
.wl-search-btn:hover {
  background: rgba(255,255,255,0.07);
  border-color: rgba(255,255,255,0.14);
}
.wl-search-btn kbd {
  margin-left: auto;
  font-family: ui-monospace, monospace;
  font-size: 10px;
  padding: 2px 6px;
  background: rgba(255,255,255,0.07);
  border-radius: 4px;
  color: rgba(255,255,255,0.6);
}

.wl-top-actions { display: flex; align-items: center; gap: 6px; margin-left: auto; }
.wl-top-btn {
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
.wl-top-btn:hover { background: rgba(255,255,255,0.06); color: #fff; }
.wl-top-btn-dot {
  position: absolute; top: 6px; right: 6px;
  width: 7px; height: 7px;
  border-radius: 50%;
  background: var(--gold-500);
  border: 2px solid var(--ink-950);
}

/* ── Main content ── */
.wl-main {
  margin-left: 64px;
  padding-top: var(--topbar-h);
  flex: 1;
  min-height: 100vh;
}
.wl-back {
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
.wl-back:hover { color: var(--gold-600); }

/* ── Mobile topbar ── */
.wl-mtop {
  display: none;
  position: fixed;
  top: var(--impersonate-offset, 0px); left: 0; right: 0;
  /* +2px к высоте + sticky-элементы под mtop поднимаются на -1px (3px
     перекрытия). Page padding-top остаётся var(--topbar-h), нижние пиксели
     mtop перекрывают первые пиксели sticky-табов. */
  height: calc(var(--topbar-h) + 2px);
  padding-top: var(--top-offset);
  background: var(--ink-950);
  /* НЕТ border-bottom: rgba(255,255,255,0.07) на стыке с белыми табами
     выглядел как полупрозрачная серая полоска. Граница между ink-950 и
     белым st-bar и так чёткая — дополнительная линия не нужна. */
  align-items: center;
  padding-left: 12px; padding-right: 12px;
  gap: 8px;
  z-index: 200;
  transform: translate3d(0, 0, 0);
  will-change: transform;
}
.wl-mtop-logo {
  display: flex; align-items: center; gap: 8px; cursor: pointer; flex-shrink: 0;
}
.wl-mtop-wh {
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
.wl-mtop-wh span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.wl-mtop-actions { display: flex; gap: 2px; margin-left: auto; flex-shrink: 0; }

/* Inline-поиск каталога: появляется в mtop вместо "иконка лупы → modal"
   только на страницах каталога (/units, /decorations, /production/project-warehouse).
   Значение синхронизируется с URL ?q=, страница каталога читает его. */
.wl-mtop-cat-search {
  flex: 1; min-width: 0;
  display: flex; align-items: center; gap: 8px;
  height: 34px; padding: 0 10px 0 32px;
  background: rgba(255,255,255,0.06);
  border: 1px solid var(--sidebar-border);
  border-radius: 8px;
  color: #fff;
  font-size: 13px;
  position: relative;
}
.wl-mtop-cat-search input {
  flex: 1; min-width: 0; height: 100%;
  background: transparent; border: none; outline: none;
  color: #fff;
  font-size: 13px;
  font-family: inherit;
}
.wl-mtop-cat-search input::placeholder { color: rgba(255,255,255,0.4); }
.wl-mtop-cat-search-icon {
  position: absolute; left: 10px; top: 50%; transform: translateY(-50%);
  color: rgba(255,255,255,0.5);
  pointer-events: none;
}
.wl-mtop-cat-search-clear {
  background: none; border: none;
  color: rgba(255,255,255,0.5);
  cursor: pointer; padding: 0;
  display: flex; align-items: center; justify-content: center;
  width: 18px; height: 18px;
}
.wl-mtop-cat-search-clear:hover { color: #fff; }

/* ── Mobile bottom nav ── */
/* iOS Safari квиркс: position:fixed внутри flex-контейнера прыгает при
   rubber-band скролле. Принудительно создаём GPU-layer через translate3d
   + will-change — отсекает контекст и элемент «клеится» к viewport. */
.wl-mnav {
  display: none;
  position: fixed; bottom: 0; left: 0; right: 0;
  background: #fff;
  border-top: 1px solid var(--border);
  z-index: 200;
  padding: 6px 0 max(6px, env(safe-area-inset-bottom));
  transform: translate3d(0, 0, 0);
  will-change: transform;
  -webkit-backface-visibility: hidden;
  backface-visibility: hidden;
}
.wl-mnav-inner { display: flex; justify-content: space-around; align-items: center; }
.wl-mnav-item {
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
.wl-mnav-item.active { color: var(--gold-600); }
.wl-mnav-fab-wrap {
  display: flex; justify-content: center; flex: 0 0 auto;
  padding: 0 4px;
}
.wl-mnav-fab {
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
.wl-mnav-fab:hover { background: var(--gold-400); }

/* ── Drawer (mobile «Ещё») ── */
.wl-drawer-overlay {
  position: fixed; inset: 0; z-index: 300;
  background: rgba(0,0,0,0.5);
  backdrop-filter: blur(2px);
}
.wl-drawer {
  position: absolute; bottom: 0; left: 0; right: 0;
  background: #fff;
  border-radius: 18px 18px 0 0;
  padding: 8px 16px max(20px, env(safe-area-inset-bottom));
  max-height: 80vh;
  overflow-y: auto;
}
.wl-drawer-handle {
  width: 36px; height: 4px; border-radius: 4px;
  background: var(--border-strong);
  margin: 8px auto 14px;
}
.wl-drawer-title {
  font-size: 11px; font-weight: 600;
  letter-spacing: 0.08em; text-transform: uppercase;
  color: var(--muted);
  padding: 0 4px 6px;
}
.wl-drawer-item {
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
.wl-drawer-item:last-of-type { border-bottom: none; }
.wl-drawer-item-icon {
  width: 36px; height: 36px; border-radius: 9px;
  background: var(--gold-100);
  color: var(--gold-600);
  display: flex; align-items: center; justify-content: center;
  flex-shrink: 0;
}
.wl-drawer-profile {
  display: flex; align-items: center; gap: 12px;
  padding: 12px 4px 14px;
  border-bottom: 1px solid var(--border);
  margin-bottom: 6px;
}
.wl-drawer-avatar {
  width: 42px; height: 42px; border-radius: 50%;
  background: var(--ink-900);
  color: #fff; font-weight: 600; font-size: 14px;
  display: flex; align-items: center; justify-content: center;
}
.wl-drawer-name { font-size: 14px; font-weight: 600; color: var(--text); }
.wl-drawer-role { font-size: 11px; color: var(--muted); margin-top: 2px; letter-spacing: 0.04em; }
.wl-drawer-logout {
  color: var(--red);
  margin-top: 4px;
}
.wl-drawer-logout .wl-drawer-item-icon {
  background: var(--red-dim);
  color: var(--red);
}

/* ── Quick Action popover (desktop «+» на rail) ── */
.wl-qa-pop {
  position: fixed;
  left: 72px; bottom: 66px;
  background: var(--ink-900);
  border: 1px solid var(--sidebar-border);
  border-radius: 12px;
  padding: 6px;
  min-width: 220px;
  box-shadow: 0 12px 32px rgba(0,0,0,0.4);
  z-index: 300;
}
.wl-qa-item {
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
.wl-qa-item:hover { background: rgba(255,255,255,0.06); color: #fff; }

/* Mobile: Quick Action — bottom-sheet по центру (FAB скрывает rail) */
.wl-qa-sheet-overlay {
  display: none;
  position: fixed; inset: 0;
  background: rgba(0,0,0,0.5);
  backdrop-filter: blur(2px);
  z-index: 305;
  align-items: flex-end; justify-content: center;
}
.wl-qa-sheet {
  background: #fff;
  border-radius: 18px 18px 0 0;
  padding: 8px 16px max(20px, env(safe-area-inset-bottom));
  width: 100%;
  max-height: 70vh; overflow-y: auto;
}
.wl-qa-sheet-handle {
  width: 36px; height: 4px; border-radius: 4px;
  background: var(--border-strong);
  margin: 8px auto 10px;
}
.wl-qa-sheet-title {
  font-size: 11px; font-weight: 600;
  letter-spacing: 0.08em; text-transform: uppercase;
  color: var(--muted);
  padding: 0 4px 6px;
}
.wl-qa-sheet-item {
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
.wl-qa-sheet-item:last-child { border-bottom: none; }
.wl-qa-sheet-icon {
  width: 36px; height: 36px; border-radius: 9px;
  background: var(--gold-100); color: var(--gold-600);
  display: flex; align-items: center; justify-content: center;
  flex-shrink: 0;
}
@media (max-width: 768px) {
  .wl-qa-pop { display: none !important; }
  .wl-qa-sheet-overlay { display: flex; }
}

/* ── Публичная ссылка — модалка ── */
.wl-pl-overlay {
  position: fixed; inset: 0; z-index: 400;
  background: rgba(10,10,10,0.55);
  backdrop-filter: blur(3px);
  display: flex; align-items: center; justify-content: center;
  padding: 20px;
}
.wl-pl-modal {
  background: #fff;
  border-radius: 14px;
  padding: 24px;
  width: 100%; max-width: 520px;
  box-shadow: 0 16px 48px rgba(0,0,0,0.25);
}
.wl-pl-title { font-size: 17px; font-weight: 600; color: var(--text); }
.wl-pl-sub   { font-size: 13px; color: var(--muted); margin-top: 4px; margin-bottom: 18px; }
.wl-pl-row   { display: flex; gap: 8px; margin-bottom: 14px; }
.wl-pl-input {
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
.wl-pl-input:focus { border-color: var(--gold-500); }
.wl-pl-copy {
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
.wl-pl-copy:hover { background: var(--ink-800); }
.wl-pl-close {
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
.wl-pl-close:hover { background: var(--bg-secondary); }

/* ── Responsive ── */
@media (max-width: 768px) {
  .wl-rail    { display: none !important; }
  .wl-topbar  { display: none !important; }
  .wl-main    {
    margin-left: 0 !important;
    padding-top: var(--topbar-h);
    /* Высота mobile bottom-nav (~70px контент + safe-area) */
    padding-bottom: calc(76px + env(safe-area-inset-bottom, 0px));
  }
  .wl-mtop    { display: flex !important; }
  .wl-mnav    { display: block !important; }
  .wl-root    { --topbar-h: calc(52px + var(--top-offset)); }
  /* Кнопка «Назад» на мобилке съедала отдельную строку перед шапкой страницы.
     На страницах есть sticky-шапки со своим inline chevron-back, а в мобильном
     нав-меню есть «Ещё» + системный жест. Прячем глобальную wl-back. */
  .wl-back    { display: none !important; }
  /* Универсальный inline chevron-back для sticky-шапок страниц.
     На десктопе скрыт — там есть .wl-back. */
  .page-back  { display: inline-flex !important; }
}
.page-back {
  display: none;
  background: none; border: none; cursor: pointer;
  width: 32px; height: 32px; border-radius: 8px;
  align-items: center; justify-content: center;
  color: var(--muted);
  flex-shrink: 0;
}
.page-back:hover { color: var(--text); background: var(--bg-secondary); }
`

export default function WarehouseLayout({ children }) {
  const navigate = useNavigate()
  const location = useLocation()
  const { user, logout } = useAuth()
  const searchProps = useGlobalSearch()

  const [whOpen, setWhOpen] = useState(false)
  const [qaOpen, setQaOpen] = useState(false)
  const [burger, setBurger] = useState(false)
  const [publicLink, setPublicLink] = useState('')
  const [linkLoading, setLinkLoading] = useState(false)
  const [linkCopied, setLinkCopied] = useState(false)
  const [selectedWh, setSelectedWh] = useState(() => localStorage.getItem('warehouse') || 'Выбрать склад')
  const whRef = useRef(null)
  const qaRef = useRef(null)
  const qaSheetRef = useRef(null)

  const canPublicLink = !!ROLES[user?.role]?.canPublicLink
  // Walk-in выдача — только директор/зам склада: они единственные имеют
  // право заводить новых юзеров и проекты на лету.
  const canWalkin = user?.role === 'warehouse_director' || user?.role === 'warehouse_deputy'

  // Блок body-scroll на время открытых оверлеев (drawer, bottom-sheet, модалка).
  useBodyLock(burger || qaOpen || whOpen || !!publicLink)

  async function generatePublicLink() {
    setQaOpen(false)
    setBurger(false)
    if (linkLoading) return
    setLinkLoading(true)
    try {
      const data = await rentApi.generateLink()
      const url = data.url || data.link
      if (url) setPublicLink(`${window.location.origin}${url}`)
    } catch { /* silent */ }
    setLinkLoading(false)
  }

  function copyLink() {
    navigator.clipboard.writeText(publicLink)
    setLinkCopied(true)
    setTimeout(() => setLinkCopied(false), 1800)
  }

  function closeLinkModal() {
    setPublicLink('')
    setLinkCopied(false)
  }

  const role = user?.role
  const nav = getNav(role)
  const pathFull = location.pathname + location.search
  // Кнопка «Назад» показывается на всех страницах кроме главной.
  const showBack = !/^\/dashboard(?:\/|$|\?)/.test(location.pathname) && location.pathname !== '/'

  // Режим каталога: на этих URL заменяем mtop-search-кнопку на инлайн-инпут,
  // а UnitsPage/Decorations/ProjectWarehouse читают значение через ?q=.
  const isCatalogRoute = /^\/(units|admin-stock|decorations|production\/project-warehouse)(\/|$)/.test(location.pathname)
  // Активна ли строка SectionTabs (вкладки Заявки/Акты, Каталог/Склад/Декорации,
  // Долги/Списания/Пересорт). Если да — sticky-шапка страницы должна прилипать
  // НИЖЕ табов, а не на ту же позицию (иначе табы её перекрывают).
  const hasSectionTabs =
    [...CATALOG_TABS, ...ISSUANCE_TABS, ...PROBLEMS_TABS]
      .some(t => t.match ? t.match.test(pathFull) : pathFull.startsWith(t.to))
  const [searchParams, setSearchParams] = useSearchParams()
  const catalogQuery = searchParams.get('q') || ''
  function updateCatalogQuery(val) {
    const next = new URLSearchParams(searchParams)
    if (val) next.set('q', val); else next.delete('q')
    setSearchParams(next, { replace: true })
  }

  // Закрытие поповеров при клике вне.
  // ВАЖНО: проверяем И desktop-popover (qaRef) И mobile-bottom-sheet (qaSheetRef),
  // иначе тап по кнопке в мобильном sheet закрывает его через mousedown
  // до того, как сработает onClick на кнопке — buttons «не откликаются».
  useEffect(() => {
    function onClick(e) {
      if (whRef.current && !whRef.current.contains(e.target)) setWhOpen(false)
      const insideQa = (qaRef.current && qaRef.current.contains(e.target))
        || (qaSheetRef.current && qaSheetRef.current.contains(e.target))
      if (!insideQa) setQaOpen(false)
    }
    if (whOpen || qaOpen) {
      document.addEventListener('mousedown', onClick)
      return () => document.removeEventListener('mousedown', onClick)
    }
  }, [whOpen, qaOpen])

  function selectWarehouse(w) {
    localStorage.setItem('warehouse', w)
    setSelectedWh(w)
    setWhOpen(false)
    window.location.reload()
  }

  function quick(path) {
    setQaOpen(false)
    navigate(path)
  }

  function drawerNav(item) {
    setBurger(false)
    navigate(item.to)
  }

  const drawerItems = MOBILE_DRAWER.filter(i => {
    if (i.hideFor?.includes(role)) return false
    if (i.onlyFor && !i.onlyFor.includes(role)) return false
    return true
  })

  return (
    <>
      <style>{css}</style>
      <div className={`wl-root${hasSectionTabs ? ' has-section-tabs' : ''}`}>

        {/* ═══ Desktop Rail (64px) ═══ */}
        <aside className="wl-rail">
          <div className="wl-rail-logo" onClick={() => navigate('/dashboard')} title="Главная">
            <TriixLogo size={30} />
          </div>

          <nav className="wl-rail-nav">
            {nav.map(g => {
              const active = g.match.test(pathFull)
              const Icon = g.icon
              return (
                <NavLink
                  key={g.key}
                  to={g.to}
                  className={`wl-rail-btn${active ? ' active' : ''}`}
                >
                  <Icon size={20} strokeWidth={1.8} />
                  <span className="wl-rail-tooltip">{g.label}</span>
                </NavLink>
              )
            })}
          </nav>

          <div className="wl-rail-bottom">
            <div ref={qaRef} style={{ position: 'relative' }}>
              <button
                className="wl-rail-btn wl-rail-quick"
                onClick={() => setQaOpen(v => !v)}
                aria-label="Быстрое действие"
              >
                <Plus size={22} strokeWidth={2.2} />
                <span className="wl-rail-tooltip">Создать</span>
              </button>
              {qaOpen && (
                <div className="wl-qa-pop">
                  <button className="wl-qa-item" onClick={() => quick('/units?add=1')}>
                    <Package size={16} /> Добавить единицу
                  </button>
                  <button className="wl-qa-item" onClick={() => quick('/units/bulk')}>
                    <Images size={16} /> Пакетное пополнение
                  </button>
                  {canWalkin && (
                    <button className="wl-qa-item" onClick={() => quick('/walkin/new')}>
                      <Zap size={16} /> Быстрая выдача
                    </button>
                  )}
                  {/* «Создать секцию» убрано — секции создаются из каталога
                      складов (/cells → Создать зал), чтобы не плодить точки входа. */}
                  {canPublicLink && (
                    <button className="wl-qa-item" onClick={generatePublicLink} disabled={linkLoading}>
                      <LinkIcon size={16} /> {linkLoading ? 'Генерация…' : 'Ссылка на каталог'}
                    </button>
                  )}
                </div>
              )}
            </div>

            <button
              className="wl-rail-avatar"
              onClick={() => navigate('/profile')}
              title={user?.name || 'Профиль'}
            >
              {getInitials(user?.name || 'ИП')}
            </button>
          </div>
        </aside>

        {/* ═══ Desktop Topbar (56px) ═══ */}
        <div className="wl-topbar">
          {/* Селектор склада временно скрыт — включать обратно через removal
              этого комментария вместе со стоящим ниже блоком в wl-mtop. */}
          <div ref={whRef} style={{ position: 'relative', display: 'none' }}>
            <button className="wl-wh-selector" onClick={() => setWhOpen(v => !v)}>
              <MapPin size={14} strokeWidth={2} />
              <span>{selectedWh}</span>
              <ChevronDown size={14} strokeWidth={2} style={{ opacity: 0.6 }} />
            </button>
            {whOpen && (
              <div className="wl-wh-dd">
                {WAREHOUSES.map(w => (
                  <button
                    key={w}
                    className={`wl-wh-opt${w === selectedWh ? ' sel' : ''}`}
                    onClick={() => selectWarehouse(w)}
                  >
                    {w}
                  </button>
                ))}
              </div>
            )}
          </div>

          <button className="wl-search-btn" onClick={() => searchProps.setOpen(true)}>
            <Search size={14} strokeWidth={2} />
            <span>Поиск по всему складу…</span>
            <kbd>Ctrl K</kbd>
          </button>

          <div className="wl-top-actions">
            {/* Кнопка уведомлений убрана по ТЗ. */}
          </div>
        </div>

        {/* ═══ Mobile Topbar ═══ */}
        <div className="wl-mtop">
          <div className="wl-mtop-logo" onClick={() => navigate('/dashboard')}>
            <TriixLogo size={26} />
          </div>
          {/* Мобильный селектор склада временно скрыт (sync с desktop). */}
          <button
            className="wl-mtop-wh"
            onClick={() => setWhOpen(v => !v)}
            style={{ display: 'none' }}
          >
            <MapPin size={12} strokeWidth={2} />
            <span>{selectedWh}</span>
          </button>
          {isCatalogRoute ? (
            <div className="wl-mtop-cat-search">
              <Search size={14} className="wl-mtop-cat-search-icon" />
              <input
                value={catalogQuery}
                onChange={e => updateCatalogQuery(e.target.value)}
                placeholder="Поиск по каталогу…"
              />
              {catalogQuery && (
                <button
                  className="wl-mtop-cat-search-clear"
                  onClick={() => updateCatalogQuery('')}
                  aria-label="Очистить"
                >
                  <X size={14} />
                </button>
              )}
            </div>
          ) : (
            <div className="wl-mtop-actions">
              <button className="wl-top-btn" onClick={() => searchProps.setOpen(true)}>
                <Search size={17} />
              </button>
            </div>
          )}

          {whOpen && (
            <div className="wl-wh-dd" style={{ position: 'fixed', top: 56, right: 14, left: 'auto' }}>
              {WAREHOUSES.map(w => (
                <button
                  key={w}
                  className={`wl-wh-opt${w === selectedWh ? ' sel' : ''}`}
                  onClick={() => selectWarehouse(w)}
                >
                  {w}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* ═══ Main content ═══ */}
        <main className="wl-main">
          <SectionTabs items={filterTabsForRole(CATALOG_TABS, role)} />
          <SectionTabs items={filterTabsForRole(ISSUANCE_TABS, role)} />
          <SectionTabs items={filterTabsForRole(PROBLEMS_TABS, role)} />
          <SectionTabs items={filterTabsForRole(TEAM_TABS, role)} />
          {showBack && (
            <button className="wl-back" onClick={() => navigate(-1)}>
              <ChevronLeft size={14} /> Назад
            </button>
          )}
          {children}
        </main>

        {/* ═══ Mobile bottom nav ═══ */}
        <nav className="wl-mnav">
          <div className="wl-mnav-inner">
            <NavLink to="/dashboard" className={({ isActive }) => `wl-mnav-item${isActive ? ' active' : ''}`}>
              <Home size={22} strokeWidth={1.8} />
              Главная
            </NavLink>
            <NavLink to="/units" className={({ isActive }) => `wl-mnav-item${isActive ? ' active' : ''}`}>
              <Package size={22} strokeWidth={1.8} />
              Каталог
            </NavLink>

            <div className="wl-mnav-fab-wrap">
              <button className="wl-mnav-fab" onClick={() => setQaOpen(true)} aria-label="Создать">
                <Plus size={26} strokeWidth={2.2} />
              </button>
            </div>

            <NavLink
              to="/issued"
              className={() => {
                const active = /^\/(requests|issued|walkin|issue|return|returns|acts|rent)/.test(location.pathname)
                return `wl-mnav-item${active ? ' active' : ''}`
              }}
            >
              <Send size={22} strokeWidth={1.8} />
              Движение
            </NavLink>
            <button className="wl-mnav-item" onClick={() => setBurger(true)}>
              <Menu size={22} strokeWidth={1.8} />
              Ещё
            </button>
          </div>
        </nav>

        {/* ═══ Mobile Quick Action bottom-sheet ═══
            Открывается при тапе на FAB — показывает те же действия, что
            и desktop-поповер на rail (Добавить единицу / Создать секцию /
            Партнёрская ссылка). */}
        {qaOpen && (
          <div className="wl-qa-sheet-overlay" onClick={() => setQaOpen(false)}>
            <div className="wl-qa-sheet" ref={qaSheetRef} onClick={e => e.stopPropagation()}>
              <div className="wl-qa-sheet-handle" />
              <div className="wl-qa-sheet-title">Создать</div>
              <button className="wl-qa-sheet-item" onClick={() => quick('/units?add=1')}>
                <div className="wl-qa-sheet-icon"><Package size={18} /></div>
                Пополнить склад
              </button>
              <button className="wl-qa-sheet-item" onClick={() => quick('/units/bulk')}>
                <div className="wl-qa-sheet-icon"><Images size={18} /></div>
                Пакетное пополнение
              </button>
              {canWalkin && (
                <button className="wl-qa-sheet-item" onClick={() => quick('/walkin/new')}>
                  <div className="wl-qa-sheet-icon"><Zap size={18} /></div>
                  Быстрая выдача
                </button>
              )}
              {/* «Создать секцию» убрано с мобилки — секции создаются
                  напрямую из каталога складов (/cells → Создать зал). */}
              {canPublicLink && (
                <button className="wl-qa-sheet-item" onClick={generatePublicLink} disabled={linkLoading}>
                  <div className="wl-qa-sheet-icon"><LinkIcon size={18} /></div>
                  {linkLoading ? 'Генерация…' : 'Ссылка на каталог'}
                </button>
              )}
            </div>
          </div>
        )}

        {/* ═══ Mobile drawer ═══ */}
        {burger && (
          <div className="wl-drawer-overlay" onClick={() => setBurger(false)}>
            <div className="wl-drawer" onClick={e => e.stopPropagation()}>
              <div className="wl-drawer-handle" />

              <div className="wl-drawer-profile">
                <div className="wl-drawer-avatar">{getInitials(user?.name || 'ИП')}</div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="wl-drawer-name truncate">{user?.name || 'Профиль'}</div>
                  <div className="wl-drawer-role truncate">{ROLES[user?.role]?.label || user?.role || ''}</div>
                </div>
              </div>

              <div className="wl-drawer-title">Меню</div>
              {drawerItems.map(item => (
                <button key={item.to} className="wl-drawer-item" onClick={() => drawerNav(item)}>
                  <div className="wl-drawer-item-icon">
                    <item.icon size={18} strokeWidth={1.8} />
                  </div>
                  {item.label}
                </button>
              ))}

              <button className="wl-drawer-item wl-drawer-logout" onClick={() => { setBurger(false); logout(); }}>
                <div className="wl-drawer-item-icon">
                  <LogOut size={18} strokeWidth={1.8} />
                </div>
                Выйти
              </button>
            </div>
          </div>
        )}

        {/* ═══ Публичная ссылка — модалка ═══ */}
        {publicLink && (
          <div className="wl-pl-overlay" onClick={closeLinkModal}>
            <div className="wl-pl-modal" onClick={e => e.stopPropagation()}>
              <div className="wl-pl-title">Ссылка на каталог</div>
              <div className="wl-pl-sub">Отправьте клиенту — он увидит каталог без регистрации.</div>
              <div className="wl-pl-row">
                <input readOnly value={publicLink} className="wl-pl-input" onFocus={e => e.target.select()} />
                <button className="wl-pl-copy" onClick={copyLink}>
                  {linkCopied ? <><Check size={14} /> Скопировано</> : <><Copy size={14} /> Копировать</>}
                </button>
              </div>
              <button className="wl-pl-close" onClick={closeLinkModal}>Закрыть</button>
            </div>
          </div>
        )}

        <GlobalSearchBar {...searchProps} />
      </div>
    </>
  )
}
