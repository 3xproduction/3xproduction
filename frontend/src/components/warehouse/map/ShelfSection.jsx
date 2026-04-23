// Секция-стеллаж для карты склада. Плоский минимализм под бренд:
// тёплый нейтральный фон, тёмный header с золотой полосой занятости.
// Ячейки: тонкая рамка, фото/иконка адаптивно сжимается под размер
// ячейки (`object-fit: contain`), шрифт имени тоже масштабируется.

import { Package, Shirt, Truck, Plus } from 'lucide-react'

export default function ShelfSection({ section, onCellClick, selectedCellId }) {
  const cells = section.cells || []

  // Группируем по префиксу кода (A-1, A-2...) → полки.
  const groupsByPrefix = new Map()
  for (const c of cells) {
    const m = /^([A-Za-zА-Яа-я]+)[\s\-_.]*/.exec(c.code || '')
    const key = m ? m[1].toUpperCase() : '_'
    if (!groupsByPrefix.has(key)) groupsByPrefix.set(key, [])
    groupsByPrefix.get(key).push(c)
  }

  let rows
  if (groupsByPrefix.size > 1) {
    rows = [...groupsByPrefix.values()]
  } else {
    const rowsCount = Math.max(1, section.rows || 1)
    const perRow = Math.ceil(cells.length / rowsCount) || 1
    rows = []
    for (let r = 0; r < rowsCount; r++) {
      rows.push(cells.slice(r * perRow, (r + 1) * perRow))
    }
  }

  const free = cells.filter(c => !c.unit_id || c.unit_status !== 'on_stock').length
  const occ  = cells.length - free

  return (
    <div style={{
      width: '100%', height: '100%',
      display: 'flex', flexDirection: 'column',
      background: 'var(--paper)',
      border: '1px solid var(--border)',
      borderRadius: 12,
      boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
      overflow: 'hidden',
      userSelect: 'none',
    }}>
      <SectionHeader
        kind="shelf"
        name={section.name}
        occ={occ}
        total={cells.length}
      />

      {/* Полки */}
      <div style={{
        flex: 1, display: 'flex', flexDirection: 'column',
        padding: '8px 10px 10px', gap: 6, overflow: 'hidden',
      }}>
        {rows.map((rowCells, r) => (
          <div key={r} style={{
            flex: 1, minHeight: 0,
            display: 'flex', alignItems: 'stretch',
            position: 'relative',
          }}>
            <div style={{
              flex: 1, display: 'flex', gap: 4, alignItems: 'stretch',
              height: '100%', paddingBottom: 4,
            }}>
              {rowCells.map(cell => (
                <ShelfCell
                  key={cell.id}
                  cell={cell}
                  selected={String(selectedCellId) === String(cell.id)}
                  onClick={() => onCellClick?.(cell)}
                />
              ))}
            </div>
            {/* Золотая полка под ячейками */}
            <div style={{
              position: 'absolute', left: 0, right: 0, bottom: 0,
              height: 3,
              background: 'linear-gradient(180deg, var(--gold-400) 0%, var(--gold-600) 100%)',
              borderRadius: 1.5,
              boxShadow: '0 1px 2px rgba(184,147,90,0.25)',
            }} />
          </div>
        ))}
      </div>
    </div>
  )
}

function ShelfCell({ cell, selected, onClick }) {
  const occupied = cell.unit_id && cell.unit_status === 'on_stock'
  return (
    <button
      onClick={(e) => { e.stopPropagation(); onClick?.() }}
      onPointerDown={(e) => e.stopPropagation()}
      style={{
        flex: 1, minWidth: 32,
        height: '100%',
        background: occupied ? '#fff' : 'transparent',
        border: selected
          ? '2px solid var(--gold-500)'
          : occupied
            ? '1px solid var(--border)'
            : '1px dashed var(--border-strong)',
        borderRadius: 6,
        padding: 3,
        cursor: 'pointer',
        display: 'flex', flexDirection: 'column', alignItems: 'stretch',
        gap: 2,
        overflow: 'hidden',
        fontFamily: 'inherit',
        transition: 'border-color 0.12s',
      }}
    >
      {occupied ? (
        <>
          <div style={{
            flex: 1, width: '100%', minHeight: 0,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            borderRadius: 4,
            background: cell.photo_url ? '#fff' : 'var(--gold-100)',
            overflow: 'hidden',
          }}>
            {cell.photo_url ? (
              <img
                src={cell.photo_url}
                alt=""
                style={{
                  maxWidth: '100%', maxHeight: '100%',
                  width: 'auto', height: 'auto',
                  objectFit: 'contain',
                  display: 'block',
                }}
              />
            ) : (
              <Package
                size={28}
                color="var(--gold-600)"
                strokeWidth={1.4}
                style={{ maxWidth: '70%', maxHeight: '70%' }}
              />
            )}
          </div>
          <div style={{
            width: '100%',
            fontSize: 'clamp(9px, 1vw, 12px)',
            fontWeight: 500,
            color: 'var(--text)', textAlign: 'center',
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            padding: '0 2px',
            marginTop: 2,
          }}>{cell.unit_name || cell.custom_name || cell.code}</div>
        </>
      ) : (
        <div style={{
          flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center',
          color: 'var(--border-strong)', opacity: 0.55,
        }}>
          <Plus size={18} strokeWidth={1.6} />
        </div>
      )}
    </button>
  )
}

// Общий header секции — вынесен в функцию чтобы переиспользовать
// из Hanger/Place (через импорт, если понадобится). Пока локальный.
function SectionHeader({ kind, name, occ, total }) {
  const pct = total ? Math.round((occ / total) * 100) : 0
  const badgeBg =
    pct > 80 ? 'var(--red-dim)' :
    pct > 50 ? 'var(--gold-100)' :
    'rgba(47,125,50,0.10)'
  const badgeColor =
    pct > 80 ? 'var(--red)' :
    pct > 50 ? 'var(--gold-600)' :
    'var(--green)'

  const Icon = kind === 'shelf' ? Package : kind === 'hanger' ? Shirt : Truck

  return (
    <div style={{
      flex: '0 0 auto',
      display: 'flex', alignItems: 'center', gap: 8,
      padding: '8px 12px',
      background: 'var(--ink-950)',
      color: '#fff',
      fontSize: 13, fontWeight: 600,
      letterSpacing: '-0.005em',
      borderBottom: '2px solid var(--gold-500)',
    }}>
      <Icon size={13} strokeWidth={1.8} color="var(--gold-400)" />
      <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {name}
      </span>
      <span style={{
        padding: '2px 8px', borderRadius: 10, fontSize: 11, fontWeight: 600,
        background: badgeBg, color: badgeColor,
      }}>
        {total - occ}/{total}
      </span>
    </div>
  )
}

// Экспортируем для использования в Hanger/Place
export { SectionHeader }
