import { useState, useEffect } from 'react'
import { NavLink, useNavigate } from 'react-router-dom'
import {
  FileText, Package, BarChart2, DollarSign,
  Bell, User, Menu, Users, Home, ChevronDown, Inbox,
  Handshake, ClipboardList, MapPin, Clapperboard, Car, UserCheck, FolderOpen, Search
} from 'lucide-react'
import { useAuth } from '../../hooks/useAuth'
import { ROLES } from '../../constants/roles'
import { projects as projectsApi, invites as invitesApi } from '../../services/api'
import Button from '../shared/Button'
import Input from '../shared/Input'
import { useGlobalSearch } from '../../hooks/useGlobalSearch'
import GlobalSearchBar from '../shared/GlobalSearchBar'

const css = `
.pl-root { display: flex; min-height: 100vh; background: var(--bg); }

/* Sidebar */
.pl-sidebar {
  width: 240px;
  background: var(--sidebar-bg);
  color: var(--sidebar-text);
  display: flex; flex-direction: column;
  position: fixed; top: var(--impersonate-offset, 0px); left: 0; bottom: 0; z-index: 100;
  border-right: 1px solid rgba(255,255,255,0.06);
}
.pl-logo { padding: 22px 20px 14px; border-bottom: 1px solid rgba(255,255,255,0.06); cursor: pointer; }
.pl-logo-title { font-size: 22px; font-weight: 700; letter-spacing: -0.02em; display: flex; align-items: center; gap: 8px; }
.pl-logo-sub { font-size: 9px; letter-spacing: 2px; text-transform: uppercase; color: var(--sidebar-muted); margin-top: 2px; }
.pl-online-dot { width: 8px; height: 8px; border-radius: 50%; background: #22c55e; box-shadow: 0 0 0 0 rgba(34,197,94,0.6); animation: pl-pulse 2s infinite; flex-shrink: 0; }
@keyframes pl-pulse { 0% { box-shadow: 0 0 0 0 rgba(34,197,94,0.6); } 70% { box-shadow: 0 0 0 6px rgba(34,197,94,0); } 100% { box-shadow: 0 0 0 0 rgba(34,197,94,0); } }
.pl-project {
  padding: 10px 12px 8px;
  border-bottom: 1px solid rgba(255,255,255,0.06);
  font-size: 12px; color: var(--sidebar-muted);
  position: relative;
}
.pl-project-btn {
  width: 100%; background: none; border: none; cursor: pointer; padding: 0;
  display: flex; align-items: center; justify-content: space-between; margin-top: 2px;
}
.pl-project-name { font-size: 13px; font-weight: 500; color: var(--sidebar-text); }
.pl-project-dd {
  position: absolute; top: 100%; left: 0; right: 0; z-index: 200;
  background: #252525; border: 1px solid rgba(255,255,255,0.12);
  border-radius: 8px; overflow: hidden; margin-top: 2px;
}
.pl-project-opt {
  padding: 9px 14px; font-size: 12px; color: rgba(255,255,255,0.85);
  cursor: pointer; display: block; width: 100%; text-align: left;
  background: none; border: none; font-family: inherit;
}
.pl-project-opt:hover { background: rgba(255,255,255,0.08); }
.pl-project-opt.sel { color: var(--accent); }

.pl-nav { flex: 1; overflow-y: auto; padding: 8px 10px; }
.pl-section-label {
  font-size: 10px; font-weight: 600; letter-spacing: 0.08em;
  text-transform: uppercase; color: var(--sidebar-muted);
  padding: 12px 10px 4px;
}
.pl-nav-item {
  display: flex; align-items: center; gap: 9px;
  padding: 8px 10px; border-radius: 8px; margin-bottom: 1px;
  color: var(--sidebar-text); font-size: 13.5px; font-weight: 450;
  text-decoration: none; transition: background 0.12s, color 0.12s;
}
.pl-nav-item:hover { background: var(--sidebar-hover-bg); color: #fff; }
.pl-nav-item.active { background: var(--sidebar-active-bg); color: #fff; }

.pl-profile {
  padding: 12px 12px 18px;
  border-top: 1px solid rgba(255,255,255,0.06);
}
.pl-profile-inner {
  display: flex; align-items: center; gap: 10px;
  padding: 8px 10px; border-radius: 9px; cursor: pointer;
  transition: background 0.12s;
}
.pl-profile-inner:hover { background: var(--sidebar-hover-bg); }
.pl-avatar {
  width: 30px; height: 30px; border-radius: 50%;
  background: var(--accent);
  display: flex; align-items: center; justify-content: center;
  font-size: 12px; font-weight: 600; color: #fff; flex-shrink: 0;
}
.pl-profile-name { font-size: 13px; font-weight: 500; }
.pl-profile-role { font-size: 11px; color: var(--sidebar-muted); margin-top: 1px; }

/* Main */
.pl-main { margin-left: 240px; flex: 1; min-height: 100vh; }

/* Mobile top bar */
.pl-topbar {
  display: none; position: fixed; top: var(--impersonate-offset, 0px); left: 0; right: 0; height: 52px;
  background: var(--sidebar-bg); color: #fff;
  align-items: center; justify-content: space-between;
  padding: 0 16px; z-index: 200;
  border-bottom: 1px solid rgba(255,255,255,0.08);
}
.pl-topbar-logo { font-size: 18px; font-weight: 700; display: flex; align-items: center; gap: 7px; }
.pl-topbar-btn {
  width: 36px; height: 36px; border-radius: 9px;
  background: rgba(255,255,255,0.08); border: none; color: #fff;
  display: flex; align-items: center; justify-content: center; cursor: pointer;
}

/* Mobile bottom nav */
.pl-mobile-nav {
  display: none; position: fixed; bottom: 0; left: 0; right: 0;
  background: var(--white); border-top: 1px solid var(--border);
  z-index: 200; padding: 6px 0 max(6px, env(safe-area-inset-bottom));
}
.pl-mobile-nav-inner { display: flex; justify-content: space-around; }
.pl-mobile-nav-item {
  display: flex; flex-direction: column; align-items: center;
  gap: 3px; padding: 4px 12px; font-size: 10px; font-weight: 500;
  color: var(--muted); text-decoration: none; border: none; background: none;
  cursor: pointer; transition: color 0.12s;
}
.pl-mobile-nav-item.active, .pl-mobile-nav-item:hover { color: var(--accent); }

/* Drawer */
.pl-drawer-overlay {
  position: fixed; inset: 0; z-index: 300;
  background: rgba(0,0,0,0.45); backdrop-filter: blur(2px);
}
.pl-drawer {
  position: absolute; bottom: 0; left: 0; right: 0;
  background: var(--white); border-radius: 18px 18px 0 0;
  padding: 8px 16px max(20px, env(safe-area-inset-bottom));
  max-height: 80vh; overflow-y: auto;
}
.pl-drawer-handle {
  width: 36px; height: 4px; border-radius: 4px;
  background: var(--border-strong); margin: 8px auto 16px;
}
.pl-drawer-item {
  display: flex; align-items: center; gap: 12px;
  padding: 13px 4px; border-bottom: 1px solid var(--border);
  color: var(--text); font-size: 15px; font-weight: 450;
  text-decoration: none;
}
.pl-drawer-item:last-child { border-bottom: none; }
.pl-drawer-icon {
  width: 36px; height: 36px; border-radius: 9px;
  background: var(--bg-secondary);
  display: flex; align-items: center; justify-content: center;
  color: var(--accent); flex-shrink: 0;
}

/* Responsive */
@media (max-width: 768px) {
  .pl-sidebar    { display: none !important; }
  .pl-main       { margin-left: 0 !important; padding-top: 52px; padding-bottom: 72px; }
  .pl-topbar     { display: flex !important; }
  .pl-mobile-nav { display: block !important; }
}
@media (min-width: 769px) and (max-width: 1024px) {
  .pl-sidebar { width: 200px; }
  .pl-main    { margin-left: 200px; }
}
@media (min-width: 1025px) and (max-width: 1280px) {
  .pl-sidebar { width: 220px; }
  .pl-main    { margin-left: 220px; }
}
`

function getInitials(name = '') {
  return name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase()
}

function buildNav(role) {
  const def = ROLES[role] || {}
  const nav = []

  // Documents — everyone
  nav.push({ to: '/production/documents', icon: FileText, label: 'Записи' })

  // Warehouse view
  if (def.ownLists?.length || def.seeAllLists || role === 'project_director') {
    nav.push({ to: '/production/warehouse', icon: Package, label: 'Склад' })
    nav.push({ to: '/production/requests', icon: Inbox, label: 'Заявки' })
  }

  // Producer sections
  if (role === 'producer') {
    nav.push({ to: '/production/warehouse', icon: Package,       label: 'Склад' })
    nav.push({ to: '/production/requests',  icon: Inbox,         label: 'Заявки' })
    nav.push({ to: '/production/rent',      icon: Handshake,     label: 'Аренда' })
    nav.push({ to: '/production/acts',      icon: ClipboardList, label: 'Акты' })
    // Каталогизатор
    nav.push({ section: 'Каталогизатор' })
    nav.push({ to: '/production/locations',    icon: MapPin,        label: 'Локации' })
    nav.push({ to: '/production/decorations',  icon: Clapperboard,  label: 'Декорации' })
    nav.push({ to: '/production/vehicles',     icon: Car,           label: 'Транспорт' })
    nav.push({ to: '/production/analytics', icon: FolderOpen,    label: 'Проекты' })
    nav.push({ section: '' })
    nav.push({ to: '/production/staff',     icon: Users,         label: 'Сотрудники' })
    nav.push({ to: '/analytics/producer',   icon: BarChart2,     label: 'Аналитика' })
    nav.push({ to: '/assets',              icon: DollarSign,     label: 'Активы' })
  }

  // Casting AMS — producer, project_director, ams_assistant
  if (role === 'producer' || role === 'project_director' || role === 'ams_assistant') {
    nav.push({ to: '/production/casting', icon: UserCheck, label: 'Кастинг АМС' })
  }

  // Catalogs for project director & deputy & location_manager
  if (role === 'project_director' || role === 'project_deputy' || role === 'project_deputy_upload') {
    nav.push({ section: 'Каталогизатор' })
    nav.push({ to: '/production/locations',    icon: MapPin,        label: 'Локации' })
    nav.push({ to: '/production/decorations',  icon: Clapperboard,  label: 'Декорации' })
    nav.push({ to: '/production/vehicles',     icon: Car,           label: 'Транспорт' })
    nav.push({ to: '/production/analytics', icon: FolderOpen,    label: 'Проекты' })
  }

  // Location manager — locations catalog
  if (role === 'location_manager') {
    nav.push({ to: '/production/locations', icon: MapPin, label: 'Локации' })
  }

  // Team (project director)
  if (role === 'project_director') {
    nav.push({ to: '/team', icon: Users, label: 'Команда' })
  }

  return nav
}

export default function ProductionLayout({ children }) {
  const [burger, setBurger] = useState(false)
  const [projectOpen, setProjectOpen] = useState(false)
  const [projectsList, setProjectsList] = useState([])
  const [selectedProject, setSelectedProject] = useState(() => localStorage.getItem('project') || '')
  const [showNewProject, setShowNewProject] = useState(false)
  const [newProjectName, setNewProjectName] = useState('')
  const [creatingProject, setCreatingProject] = useState(false)
  const [showInvite, setShowInvite] = useState(false)
  const [inviteRole, setInviteRole] = useState('project_director')
  const [inviteLink, setInviteLink] = useState('')
  const [inviteLoading, setInviteLoading] = useState(false)
  const navigate = useNavigate()
  const { user } = useAuth()
  const isProducer = user?.role === 'producer'
  const searchProps = useGlobalSearch()

  useEffect(() => {
    projectsApi.list().then(d => {
      const HIDDEN = ['3xmedia', 'тестовый проект']
      const list = (d.projects || [])
        .filter(p => !HIDDEN.includes((p.name || '').toLowerCase()))
      setProjectsList(list)
      const savedName = localStorage.getItem('project')
      if (!selectedProject && list.length) {
        const match = list.find(p => p.name === savedName) || list[0]
        setSelectedProject(match.name)
        localStorage.setItem('project', match.name)
      }
    }).catch(() => {})
  }, [])

  function selectProject(name) {
    localStorage.setItem('project', name)
    setSelectedProject(name)
    setProjectOpen(false)
  }

  function getSelectedProjectId() {
    const proj = projectsList.find(p => p.name === selectedProject)
    return proj?.id || user?.project_id || null
  }

  const [projectCreated, setProjectCreated] = useState(false)

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

  const role = user?.role || ''
  const roleDef = ROLES[role] || {}
  const roleLabel = roleDef.label || role
  const nav = buildNav(role)

  // Mobile: show first 3 link items + burger (skip section headers)
  const navLinks = nav.filter(item => item.section === undefined)
  const mobileMain = navLinks.slice(0, 3)
  const mobileBurger = navLinks.slice(3)

  return (
    <>
      <style>{css}</style>
      <div className="pl-root">

        {/* Desktop Sidebar */}
        <aside className="pl-sidebar">
          <div className="pl-logo" onClick={() => navigate(nav[0]?.to || '/production/documents')}>
            <div className="pl-logo-title">
              <span><span style={{ color: 'var(--accent)' }}>3X</span>Media</span>
              <span className="pl-online-dot" />
            </div>
            <div className="pl-logo-sub">Production</div>
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

          <nav className="pl-nav">
            <div className="pl-section-label">Навигация</div>
            {nav.map((item, idx) =>
              item.section !== undefined ? (
                item.section ? (
                  <div key={'sec-' + idx} className="pl-section-label" style={{ marginTop: 10 }}>{item.section}</div>
                ) : (
                  <div key={'sep-' + idx} style={{ height: 1, background: 'var(--sidebar-border, rgba(255,255,255,0.08))', margin: '6px 12px' }} />
                )
              ) : (
              <NavLink
                key={item.to + item.label}
                to={item.to}
                className={({ isActive }) => `pl-nav-item${isActive ? ' active' : ''}`}
              >
                <item.icon size={16} strokeWidth={1.8} />
                <span>{item.label}</span>
              </NavLink>
              )
            )}
          </nav>

          <div className="pl-profile">
            <div className="pl-profile-inner" onClick={() => navigate('/profile')}>
              <div className="pl-avatar">{getInitials(user?.name || '')}</div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="pl-profile-name truncate">{user?.name || 'Профиль'}</div>
                <div className="pl-profile-role truncate">{roleLabel}</div>
              </div>
              <User size={14} style={{ color: 'var(--sidebar-muted)', flexShrink: 0 }} />
            </div>
          </div>
        </aside>

        {/* Mobile top bar */}
        <div className="pl-topbar">
          <div className="pl-topbar-logo">
            <span><span style={{ color: 'var(--accent)' }}>3X</span>Media</span>
            <span className="pl-online-dot" />
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="pl-topbar-btn" onClick={() => navigate('/notifications')}>
              <Bell size={18} />
            </button>
            <button className="pl-topbar-btn" onClick={() => setBurger(true)}>
              <Menu size={18} />
            </button>
          </div>
        </div>

        {/* Main */}
        <main className="pl-main">{children}</main>

        {/* Mobile bottom nav */}
        <nav className="pl-mobile-nav">
          <div className="pl-mobile-nav-inner">
            {mobileMain.map(item => (
              <NavLink
                key={item.to + item.label}
                to={item.to}
                className={({ isActive }) => `pl-mobile-nav-item${isActive ? ' active' : ''}`}
              >
                <item.icon size={22} strokeWidth={1.8} />
                {item.label}
              </NavLink>
            ))}
            <NavLink to="/profile" className={({ isActive }) => `pl-mobile-nav-item${isActive ? ' active' : ''}`}>
              <User size={22} strokeWidth={1.8} />
              Профиль
            </NavLink>
            {mobileBurger.length > 0 && (
              <button className="pl-mobile-nav-item" onClick={() => setBurger(true)}>
                <Menu size={22} strokeWidth={1.8} />
                Ещё
              </button>
            )}
          </div>
        </nav>

        {/* Burger drawer */}
        {burger && (
          <div className="pl-drawer-overlay" onClick={() => setBurger(false)}>
            <div className="pl-drawer" onClick={e => e.stopPropagation()}>
              <div className="pl-drawer-handle" />
              {mobileBurger.map(item => (
                <NavLink
                  key={item.to + item.label}
                  to={item.to}
                  className="pl-drawer-item"
                  onClick={() => setBurger(false)}
                >
                  <div className="pl-drawer-icon">
                    <item.icon size={18} strokeWidth={1.8} />
                  </div>
                  {item.label}
                </NavLink>
              ))}
              <NavLink to="/notifications" className="pl-drawer-item" onClick={() => setBurger(false)}>
                <div className="pl-drawer-icon"><Bell size={18} strokeWidth={1.8} /></div>
                Уведомления
              </NavLink>
            </div>
          </div>
        )}
      </div>

      {/* New project modal */}
      {showNewProject && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 500, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}
          onClick={() => setShowNewProject(false)}>
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
                <Button fullWidth onClick={() => { setShowNewProject(false); setShowInvite(true) }}>
                  Пригласить участника
                </Button>
                <Button variant="secondary" fullWidth style={{ marginTop: 8 }} onClick={() => { setShowNewProject(false); setProjectCreated(false); setNewProjectName('') }}>
                  Закрыть
                </Button>
              </>
            )}
          </div>
        </div>
      )}

      {/* Invite modal */}
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
            <Button variant="secondary" fullWidth style={{ marginTop: 12 }} onClick={() => { setShowInvite(false); setInviteLink('') }}>Закрыть</Button>
          </div>
        </div>
      )}

      <GlobalSearchBar {...searchProps} />
    </>
  )
}
