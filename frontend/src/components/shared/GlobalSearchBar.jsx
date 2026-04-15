import { useRef, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Search, X, Package, MapPin, Film, FileText, Car,
  Users, Handshake, ClipboardList, Clapperboard, Clock,
  UserCheck,
} from 'lucide-react'

const ENTITY_CONFIG = {
  unit:       { icon: Package,       color: '#3b82f6', label: 'Единицы' },
  scene:      { icon: Film,          color: '#eab308', label: 'Сцены' },
  document:   { icon: FileText,      color: '#6b7280', label: 'Документы' },
  list_item:  { icon: ClipboardList, color: '#6366f1', label: 'Позиции' },
  location:   { icon: MapPin,        color: '#22c55e', label: 'Локации' },
  decoration: { icon: Clapperboard,  color: '#a855f7', label: 'Декорации' },
  vehicle:    { icon: Car,           color: '#f97316', label: 'Транспорт' },
  rent:       { icon: Handshake,     color: '#ef4444', label: 'Аренда' },
  casting:    { icon: UserCheck,     color: '#ec4899', label: 'Кастинг' },
  user:       { icon: Users,         color: '#14b8a6', label: 'Люди' },
}

const CATEGORIES = [
  { key: null, label: 'Все' },
  { key: 'unit', label: 'Единицы' },
  { key: 'location', label: 'Локации' },
  { key: 'scene', label: 'Сцены' },
  { key: 'document', label: 'Документы' },
  { key: 'vehicle', label: 'Транспорт' },
  { key: 'rent', label: 'Аренда' },
]

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

export default function GlobalSearchBar({
  open, close, query, setQuery, results, loading,
  category, setCategory, getRecent,
}) {
  const inputRef = useRef(null)
  const listRef = useRef(null)
  const [selectedIdx, setSelectedIdx] = useState(-1)
  const navigate = useNavigate()

  useEffect(() => {
    if (open) {
      setTimeout(() => inputRef.current?.focus(), 50)
    }
  }, [open])

  // Scroll selected item into view
  useEffect(() => {
    if (selectedIdx >= 0 && listRef.current) {
      const el = listRef.current.children[selectedIdx]
      if (el) el.scrollIntoView({ block: 'nearest' })
    }
  }, [selectedIdx])

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
    }
  }

  return (
    <div style={styles.overlay} onClick={close}>
      <div style={styles.modal} onClick={e => e.stopPropagation()}>
        {/* Search input */}
        <div style={styles.inputRow}>
          <Search size={18} color="#9ca3af" />
          <input
            ref={inputRef}
            style={styles.input}
            placeholder="Поиск по всей платформе..."
            value={query}
            onChange={e => { setQuery(e.target.value); setSelectedIdx(-1) }}
            onKeyDown={handleKeyDown}
          />
          {query && (
            <button style={styles.clearBtn} onClick={() => setQuery('')}>
              <X size={16} />
            </button>
          )}
          <kbd style={styles.kbd}>Esc</kbd>
        </div>

        {/* Category tabs */}
        <div style={styles.tabs}>
          {CATEGORIES.map(cat => (
            <button
              key={cat.key || 'all'}
              style={{
                ...styles.tab,
                ...(category === cat.key ? styles.tabActive : {}),
              }}
              onClick={() => setCategory(cat.key)}
            >
              {cat.label}
              {results?.categories?.[cat.key] != null && (
                <span style={styles.tabCount}>{results.categories[cat.key]}</span>
              )}
            </button>
          ))}
        </div>

        {/* Results */}
        <div style={styles.resultsList} ref={listRef}>
          {loading && (
            <div style={styles.status}>Ищем...</div>
          )}

          {!loading && query.trim() && items.length === 0 && (
            <div style={styles.status}>Ничего не найдено</div>
          )}

          {!loading && items.map((item, idx) => {
            const cfg = ENTITY_CONFIG[item.entityType] || ENTITY_CONFIG.unit
            const Icon = cfg.icon
            return (
              <div
                key={item.id + item.entityType}
                style={{
                  ...styles.resultItem,
                  ...(idx === selectedIdx ? styles.resultItemActive : {}),
                }}
                onClick={() => handleNavigate(item)}
                onMouseEnter={() => setSelectedIdx(idx)}
              >
                <div style={{ ...styles.iconBox, background: cfg.color + '18' }}>
                  <Icon size={16} color={cfg.color} />
                </div>
                <div style={styles.resultContent}>
                  <div style={styles.resultTitle}>{item.title}</div>
                  {item.snippet && (
                    <div
                      style={styles.resultSnippet}
                      dangerouslySetInnerHTML={{
                        __html: highlightSnippet(item.snippet, query)
                      }}
                    />
                  )}
                </div>
                <span style={{ ...styles.badge, background: cfg.color + '18', color: cfg.color }}>
                  {cfg.label}
                </span>
              </div>
            )
          })}

          {/* Recent searches (when no query) */}
          {!query.trim() && recent.length > 0 && (
            <>
              <div style={styles.recentHeader}>
                <Clock size={14} color="#9ca3af" />
                <span>Недавние запросы</span>
              </div>
              {recent.map((r, idx) => (
                <div
                  key={r}
                  style={{
                    ...styles.recentItem,
                    ...(idx === selectedIdx ? styles.resultItemActive : {}),
                  }}
                  onClick={() => setQuery(r)}
                  onMouseEnter={() => setSelectedIdx(idx)}
                >
                  <Search size={14} color="#9ca3af" />
                  <span>{r}</span>
                </div>
              ))}
            </>
          )}

          {!query.trim() && recent.length === 0 && (
            <div style={styles.status}>
              Начните вводить для поиска по единицам, сценам, документам, локациям...
            </div>
          )}
        </div>

        {/* Footer */}
        {results?.totalCount > 0 && (
          <div style={styles.footer}>
            Найдено: {results.totalCount}
          </div>
        )}
      </div>
    </div>
  )
}

const styles = {
  overlay: {
    position: 'fixed', inset: 0, zIndex: 9999,
    background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(2px)',
    display: 'flex', alignItems: 'flex-start', justifyContent: 'center',
    paddingTop: '12vh',
  },
  modal: {
    width: '100%', maxWidth: 640,
    background: '#fff', borderRadius: 12,
    boxShadow: '0 20px 60px rgba(0,0,0,0.3)',
    overflow: 'hidden',
    maxHeight: '70vh', display: 'flex', flexDirection: 'column',
  },
  inputRow: {
    display: 'flex', alignItems: 'center', gap: 10,
    padding: '14px 16px', borderBottom: '1px solid #e5e7eb',
  },
  input: {
    flex: 1, border: 'none', outline: 'none',
    fontSize: 16, background: 'transparent',
    fontFamily: 'inherit',
  },
  clearBtn: {
    background: 'none', border: 'none', cursor: 'pointer',
    padding: 4, borderRadius: 4, display: 'flex',
    color: '#9ca3af',
  },
  kbd: {
    fontSize: 11, padding: '2px 6px', borderRadius: 4,
    border: '1px solid #d1d5db', color: '#9ca3af',
    fontFamily: 'monospace', lineHeight: '18px',
  },
  tabs: {
    display: 'flex', gap: 2, padding: '8px 16px',
    borderBottom: '1px solid #f3f4f6', overflowX: 'auto',
    flexShrink: 0,
  },
  tab: {
    padding: '4px 10px', borderRadius: 6, border: 'none',
    background: 'transparent', cursor: 'pointer',
    fontSize: 13, color: '#6b7280', whiteSpace: 'nowrap',
    display: 'flex', alignItems: 'center', gap: 4,
    fontFamily: 'inherit',
  },
  tabActive: {
    background: '#f3f4f6', color: '#111827', fontWeight: 500,
  },
  tabCount: {
    fontSize: 11, background: '#e5e7eb', borderRadius: 10,
    padding: '0 5px', minWidth: 18, textAlign: 'center',
  },
  resultsList: {
    flex: 1, overflowY: 'auto', padding: '4px 0',
  },
  resultItem: {
    display: 'flex', alignItems: 'center', gap: 10,
    padding: '8px 16px', cursor: 'pointer',
    transition: 'background 0.1s',
  },
  resultItemActive: {
    background: '#f3f4f6',
  },
  iconBox: {
    width: 32, height: 32, borderRadius: 8,
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    flexShrink: 0,
  },
  resultContent: {
    flex: 1, minWidth: 0,
  },
  resultTitle: {
    fontSize: 14, fontWeight: 500, color: '#111827',
    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
  },
  resultSnippet: {
    fontSize: 12, color: '#6b7280', marginTop: 1,
    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
  },
  badge: {
    fontSize: 11, padding: '2px 8px', borderRadius: 10,
    whiteSpace: 'nowrap', fontWeight: 500, flexShrink: 0,
  },
  status: {
    padding: '24px 16px', textAlign: 'center',
    color: '#9ca3af', fontSize: 14,
  },
  recentHeader: {
    display: 'flex', alignItems: 'center', gap: 6,
    padding: '8px 16px 4px', fontSize: 12, color: '#9ca3af',
  },
  recentItem: {
    display: 'flex', alignItems: 'center', gap: 10,
    padding: '6px 16px', cursor: 'pointer',
    fontSize: 14, color: '#374151',
  },
  footer: {
    padding: '8px 16px', borderTop: '1px solid #f3f4f6',
    fontSize: 12, color: '#9ca3af', textAlign: 'center',
    flexShrink: 0,
  },
}
