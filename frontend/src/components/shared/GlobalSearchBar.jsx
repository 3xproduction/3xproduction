import { useRef, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Search, X, Package, MapPin, Film, FileText, Car,
  Users, Handshake, ClipboardList, Clapperboard, Clock,
  UserCheck, Send, Folder,
} from 'lucide-react'

const ENTITY_CONFIG = {
  unit:       { icon: Package,       color: '#3b82f6', label: 'Единицы' },
  scene:      { icon: Film,          color: '#eab308', label: 'Сцены' },
  document:   { icon: FileText,      color: '#6b7280', label: 'Документы' },
  list_item:  { icon: ClipboardList, color: '#6366f1', label: 'Позиции' },
  location:   { icon: MapPin,        color: '#22c55e', label: 'Локации' },
  decoration: { icon: Clapperboard,  color: '#a855f7', label: 'Декорации' },
  vehicle:    { icon: Car,           color: '#f97316', label: 'Транспорт' },
  rent:       { icon: Handshake,     color: 'var(--red)', label: 'Аренда' },
  casting:    { icon: UserCheck,     color: '#ec4899', label: 'Кастинг' },
  user:       { icon: Users,         color: '#14b8a6', label: 'Люди' },
  project:    { icon: Folder,        color: '#0ea5e9', label: 'Проекты' },
  issuance:   { icon: Send,          color: '#10b981', label: 'Выданное' },
  request:    { icon: ClipboardList, color: '#f59e0b', label: 'Заявки' },
}

function highlightSnippet(text, query) {
  if (!text || !query) return text || ''
  const tokens = query.trim().split(/\s+/).filter(t => t.length > 1)
  if (!tokens.length) return text
  const escaped = tokens.map(t => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
  const regex = new RegExp(`(${escaped.join('|')})`, 'gi')
  const parts = text.split(regex)
  return parts.map((part) =>
    regex.test(part)
      ? `<mark style="background:#fef08a;padding:0 1px;border-radius:2px">${part}</mark>`
      : part
  ).join('')
}

// Инлайн-поиск: когда open=true, рендерится фикс-оверлей на позиции топбара,
// визуально заменяет кнопку «Поиск по всему складу…» активным инпутом,
// под ним — светлый dropdown со списком результатов.
// Не использует backdrop/blur/body-lock — остальной интерфейс виден и живой.
export default function GlobalSearchBar({
  open, close, query, setQuery, results, loading,
  getRecent,
}) {
  const containerRef = useRef(null)
  const inputRef = useRef(null)
  const listRef = useRef(null)
  const [selectedIdx, setSelectedIdx] = useState(-1)
  const navigate = useNavigate()

  useEffect(() => {
    if (open) {
      // setTimeout небольшой — даёт React зарендерить инпут перед focus().
      setTimeout(() => inputRef.current?.focus(), 30)
    }
  }, [open])

  useEffect(() => {
    if (selectedIdx >= 0 && listRef.current) {
      const el = listRef.current.children[selectedIdx]
      if (el) el.scrollIntoView({ block: 'nearest' })
    }
  }, [selectedIdx])

  // Закрытие при клике вне инпута/дропдауна.
  useEffect(() => {
    if (!open) return
    function onMouseDown(e) {
      if (containerRef.current && !containerRef.current.contains(e.target)) {
        close()
      }
    }
    document.addEventListener('mousedown', onMouseDown)
    return () => document.removeEventListener('mousedown', onMouseDown)
  }, [open, close])

  if (!open) return null

  const items = results?.results || []
  const recent = !query.trim() ? getRecent() : []

  const handleNavigate = (item) => {
    if (item.url) navigate(item.url)
    close()
  }

  const handleKeyDown = (e) => {
    const list = items.length ? items : recent
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setSelectedIdx(i => Math.min(i + 1, list.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setSelectedIdx(i => Math.max(i - 1, -1))
    } else if (e.key === 'Enter' && selectedIdx >= 0) {
      e.preventDefault()
      if (items.length && items[selectedIdx]) {
        handleNavigate(items[selectedIdx])
      } else if (recent[selectedIdx]) {
        setQuery(recent[selectedIdx])
      }
    } else if (e.key === 'Escape') {
      e.preventDefault()
      close()
    }
  }

  const hasDropdownContent =
    loading ||
    (query.trim() && items.length === 0) ||
    items.length > 0 ||
    recent.length > 0 ||
    !query.trim()

  return (
    <>
      <style>{css}</style>
      <div className="gsb-root" ref={containerRef}>
        <div className="gsb-inner">
          <div className="gsb-input-row">
            <Search size={16} strokeWidth={2} color="rgba(255,255,255,0.6)" />
            <input
              ref={inputRef}
              className="gsb-input"
              placeholder="Поиск по всей платформе..."
              value={query}
              onChange={e => { setQuery(e.target.value); setSelectedIdx(-1) }}
              onKeyDown={handleKeyDown}
            />
            {query && (
              <button
                type="button"
                className="gsb-icon-btn"
                onClick={() => { setQuery(''); inputRef.current?.focus() }}
                aria-label="Очистить"
              >
                <X size={14} />
              </button>
            )}
            <button
              type="button"
              className="gsb-kbd"
              onClick={close}
              aria-label="Закрыть"
            >Esc</button>
          </div>

          {hasDropdownContent && (
            <div className="gsb-dropdown" ref={listRef}>
              {loading && (
                <div className="gsb-status">Ищем...</div>
              )}

              {!loading && query.trim() && items.length === 0 && (
                <div className="gsb-status">Ничего не найдено</div>
              )}

              {!loading && items.map((item, idx) => {
                const cfg = ENTITY_CONFIG[item.entityType] || ENTITY_CONFIG.unit
                const Icon = cfg.icon
                return (
                  <div
                    key={item.id + item.entityType}
                    className={`gsb-item${idx === selectedIdx ? ' active' : ''}`}
                    onClick={() => handleNavigate(item)}
                    onMouseEnter={() => setSelectedIdx(idx)}
                  >
                    <div className="gsb-item-icon" style={{ background: cfg.color + '18' }}>
                      <Icon size={15} color={cfg.color} />
                    </div>
                    <div className="gsb-item-content">
                      <div className="gsb-item-title">{item.title}</div>
                      {item.snippet && (
                        <div
                          className="gsb-item-snippet"
                          dangerouslySetInnerHTML={{
                            __html: highlightSnippet(item.snippet, query)
                          }}
                        />
                      )}
                    </div>
                    <span className="gsb-badge" style={{ background: cfg.color + '18', color: cfg.color }}>
                      {cfg.label}
                    </span>
                  </div>
                )
              })}

              {!loading && !query.trim() && recent.length > 0 && (
                <>
                  <div className="gsb-recent-header">
                    <Clock size={13} />
                    <span>Недавние запросы</span>
                  </div>
                  {recent.map((r, idx) => (
                    <div
                      key={r}
                      className={`gsb-recent-item${idx === selectedIdx ? ' active' : ''}`}
                      onClick={() => setQuery(r)}
                      onMouseEnter={() => setSelectedIdx(idx)}
                    >
                      <Search size={13} color="#9ca3af" />
                      <span>{r}</span>
                    </div>
                  ))}
                </>
              )}

              {!loading && !query.trim() && recent.length === 0 && (
                <div className="gsb-status-hint">
                  Начните вводить для поиска по каталогу и складу, сценам, документам, локациям...
                </div>
              )}

              {results?.totalCount > 0 && (
                <div className="gsb-footer">Найдено: {results.totalCount}</div>
              )}
            </div>
          )}
        </div>
      </div>
    </>
  )
}

const css = `
.gsb-root {
  position: fixed;
  top: calc(var(--impersonate-offset, 0px) + max(env(safe-area-inset-top, 0px), var(--devenv-banner-h, 0px)));
  left: 64px;
  right: 0;
  padding: 8px 20px;
  z-index: 260;
  pointer-events: none;
}
.gsb-inner {
  position: relative;
  width: 100%;
  max-width: 560px;
  pointer-events: auto;
}
.gsb-input-row {
  display: flex; align-items: center; gap: 10px;
  height: 40px; padding: 0 14px;
  background: rgba(255,255,255,0.08);
  border: 1px solid rgba(184,147,90,0.55);
  border-radius: 10px;
  color: #fff;
  box-shadow: 0 0 0 3px rgba(184,147,90,0.14);
  backdrop-filter: blur(6px);
  -webkit-backdrop-filter: blur(6px);
}
.gsb-input {
  flex: 1; min-width: 0;
  border: none; outline: none;
  background: transparent; color: #fff;
  font-size: 16px; font-family: inherit;
  padding: 0;
}
.gsb-input::placeholder { color: rgba(255,255,255,0.45); }
.gsb-icon-btn {
  background: transparent; border: none; cursor: pointer;
  color: rgba(255,255,255,0.65);
  padding: 4px; border-radius: 4px;
  display: inline-flex; align-items: center; justify-content: center;
  font-family: inherit;
}
.gsb-icon-btn:hover { color: #fff; background: rgba(255,255,255,0.08); }
.gsb-kbd {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 10px; line-height: 18px;
  padding: 2px 7px;
  background: rgba(255,255,255,0.10);
  border: 1px solid rgba(255,255,255,0.12);
  border-radius: 4px;
  color: rgba(255,255,255,0.75);
  cursor: pointer;
}
.gsb-kbd:hover { background: rgba(255,255,255,0.16); color: #fff; }
.gsb-dropdown {
  position: absolute;
  top: calc(100% + 6px);
  left: 0; right: 0;
  background: #fff;
  border: 1px solid var(--border);
  border-radius: 12px;
  box-shadow: 0 12px 40px rgba(0,0,0,0.22);
  max-height: min(70vh, 520px);
  overflow-y: auto;
  padding: 4px 0;
  -webkit-overflow-scrolling: touch;
}
.gsb-status {
  padding: 20px 16px; text-align: center;
  color: var(--muted); font-size: 13px;
}
.gsb-status-hint {
  padding: 14px 16px; text-align: center;
  color: var(--subtle); font-size: 12.5px; line-height: 1.45;
}
.gsb-item {
  display: flex; align-items: center; gap: 10px;
  padding: 8px 14px; cursor: pointer;
  transition: background 0.1s;
}
.gsb-item.active, .gsb-item:hover { background: var(--bg-secondary); }
.gsb-item-icon {
  width: 30px; height: 30px; border-radius: 8px;
  display: flex; align-items: center; justify-content: center;
  flex-shrink: 0;
}
.gsb-item-content { flex: 1; min-width: 0; }
.gsb-item-title {
  font-size: 13.5px; font-weight: 500; color: var(--text);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.gsb-item-snippet {
  font-size: 12px; color: var(--muted); margin-top: 1px;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.gsb-badge {
  font-size: 10.5px; padding: 2px 8px; border-radius: 10px;
  white-space: nowrap; font-weight: 500; flex-shrink: 0;
}
.gsb-recent-header {
  display: flex; align-items: center; gap: 6px;
  padding: 10px 14px 4px; font-size: 11px;
  color: var(--subtle);
  text-transform: uppercase; letter-spacing: 0.04em;
}
.gsb-recent-item {
  display: flex; align-items: center; gap: 10px;
  padding: 7px 14px; cursor: pointer;
  font-size: 13px; color: var(--text);
}
.gsb-recent-item.active, .gsb-recent-item:hover { background: var(--bg-secondary); }
.gsb-footer {
  padding: 8px 14px;
  border-top: 1px solid var(--border);
  font-size: 11.5px; color: var(--subtle); text-align: center;
}

/* На мобильной (когда desktop-rail скрыт) — поиск занимает всю ширину */
@media (max-width: 768px) {
  .gsb-root {
    left: 0;
    padding: 6px 12px;
  }
  .gsb-inner { max-width: none; }
  .gsb-input-row { height: 40px; }
  .gsb-dropdown { max-height: min(70vh, 420px); }
}
`
