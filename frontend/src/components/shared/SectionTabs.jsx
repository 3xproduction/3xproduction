// Горизонтальные табы раздела. Рендерится в layout'е — сам решает
// показывать ли: если текущий URL не входит ни в один items.match — ничего
// не рисует.
//
// Пример:
//   <SectionTabs items={[
//     { to: '/units',   label: 'Единицы',   match: /^\/units/ },
//     { to: '/decorations', label: 'Декорации', match: /^\/decorations/ },
//   ]} />

import { NavLink, useLocation } from 'react-router-dom'

export default function SectionTabs({ items }) {
  const loc = useLocation()
  const path = loc.pathname + loc.search

  const isInSection = items.some(it => (it.match ? it.match.test(path) : path.startsWith(it.to)))
  if (!isInSection) return null

  return (
    <>
      <style>{css}</style>
      <div className="st-bar">
        {items.map(it => {
          const active = it.match ? it.match.test(path) : path.startsWith(it.to)
          const Icon = it.icon
          return (
            <NavLink
              key={it.to}
              to={it.to}
              className={`st-tab${active ? ' active' : ''}`}
            >
              {Icon && <Icon size={14} strokeWidth={1.8} />}
              {it.label}
            </NavLink>
          )
        })}
      </div>
    </>
  )
}

const css = `
.st-bar {
  display: flex;
  gap: 2px;
  padding: 0 28px;
  background: var(--white);
  border-bottom: 1px solid var(--border);
  overflow-x: auto;
  position: sticky;
  top: 0;
  z-index: 10;
  scrollbar-width: none;
}
.st-bar::-webkit-scrollbar { display: none; }
.st-tab {
  padding: 14px 14px 12px;
  font-size: 13px;
  font-weight: 500;
  color: var(--muted);
  text-decoration: none;
  border-bottom: 2px solid transparent;
  margin-bottom: -1px;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  white-space: nowrap;
  transition: color 0.12s, border-color 0.12s;
  letter-spacing: 0.005em;
}
.st-tab:hover { color: var(--text); }
.st-tab.active {
  color: var(--gold-600);
  border-bottom-color: var(--gold-500);
  font-weight: 600;
}
@media (max-width: 768px) {
  .st-bar {
    padding: 0 14px;
    /* На мобилке отключаем sticky — несколько табов от разных разделов
       иначе накладываются друг на друга под tiny topbar (52px). */
    position: static;
  }
  .st-tab { padding: 11px 10px 9px; font-size: 12.5px; letter-spacing: 0; }
}
`
