// Секция-вешалка для карты склада. Тёмная штанга + минималистичные
// плечики. Ячейки адаптивно сжимаются — фото/иконка через `object-fit:
// contain`, шрифт через `clamp()`. Стилистика под бренд.

import { Shirt, Plus } from 'lucide-react'
import { SectionHeader } from './ShelfSection'

export default function HangerSection({ section, onCellClick, selectedCellId }) {
  const cells = section.cells || []
  const free = cells.filter(c => !c.unit_id || c.unit_status !== 'on_stock').length
  const occ = cells.length - free

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
      <SectionHeader kind="hanger" name={section.name} occ={occ} total={cells.length} />

      {/* Штанги с плечиками */}
      <div style={{
        flex: 1, minHeight: 0,
        display: 'flex', flexDirection: 'column',
        padding: '10px 10px 10px',
        gap: 8,
      }}>
        {buildRodRows(cells, section.rows).map((rowCells, r) => (
          <div key={r} style={{
            flex: 1, minHeight: 0,
            display: 'flex', flexDirection: 'column',
            position: 'relative',
          }}>
            <Rod />
            <div style={{
              flex: 1, display: 'flex', alignItems: 'stretch', gap: 4,
              paddingTop: 2, minHeight: 0, overflow: 'hidden',
            }}>
              {rowCells.map(cell => (
                <HangerCell
                  key={cell.id}
                  cell={cell}
                  selected={String(selectedCellId) === String(cell.id)}
                  onClick={() => onCellClick?.(cell)}
                />
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

function buildRodRows(cells, rows) {
  const n = Math.max(1, rows || 1)
  if (n === 1) return [cells]
  const perRow = Math.ceil(cells.length / n)
  const out = []
  for (let r = 0; r < n; r++) out.push(cells.slice(r * perRow, (r + 1) * perRow))
  return out
}

function Rod() {
  return (
    <div style={{ position: 'relative', height: 8, flex: '0 0 auto' }}>
      {/* Золотая штанга */}
      <div style={{
        position: 'absolute', left: -3, right: -3, top: 2,
        height: 3,
        background: 'linear-gradient(180deg, var(--gold-400) 0%, var(--gold-600) 100%)',
        borderRadius: 2,
        boxShadow: '0 1px 2px rgba(184,147,90,0.3)',
      }} />
      {/* Крепления слева/справа */}
      <div style={{
        position: 'absolute', left: -6, top: 0,
        width: 4, height: 7,
        background: 'var(--ink-700)',
        borderRadius: 2,
        opacity: 0.7,
      }} />
      <div style={{
        position: 'absolute', right: -6, top: 0,
        width: 4, height: 7,
        background: 'var(--ink-700)',
        borderRadius: 2,
        opacity: 0.7,
      }} />
    </div>
  )
}

function HangerCell({ cell, selected, onClick }) {
  const occupied = cell.unit_id && cell.unit_status === 'on_stock'
  return (
    <button
      onClick={(e) => { e.stopPropagation(); onClick?.() }}
      onPointerDown={(e) => e.stopPropagation()}
      style={{
        flex: 1, minWidth: 36,
        background: 'none', border: 'none', padding: 0,
        display: 'flex', flexDirection: 'column', alignItems: 'center',
        cursor: 'pointer',
        fontFamily: 'inherit',
      }}
      title={cell.unit_name || cell.custom_name || cell.code}
    >
      {/* Плечики — золотые */}
      <svg width="22" height="14" viewBox="0 0 26 18" style={{ flex: '0 0 auto', marginTop: -4 }}>
        <path
          d="M13 0 C13 3, 10 4, 10 7 L1 15 L25 15 L16 7 C16 4, 13 3, 13 0 Z"
          fill="none"
          stroke="var(--gold-500)"
          strokeWidth="1.4"
          strokeLinejoin="round"
        />
      </svg>

      <div style={{
        flex: 1, width: '100%', minHeight: 0,
        background: occupied ? '#fff' : 'transparent',
        border: selected
          ? '2px solid var(--gold-500)'
          : occupied ? '1px solid var(--border)' : '1px dashed var(--border-strong)',
        borderRadius: '4px 4px 10px 10px',
        display: 'flex', flexDirection: 'column',
        overflow: 'hidden',
      }}>
        {occupied ? (
          <>
            <div style={{
              flex: 1, width: '100%', minHeight: 0,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
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
                <Shirt size={28} color="var(--gold-600)" strokeWidth={1.4} style={{ maxWidth: '70%', maxHeight: '70%' }} />
              )}
            </div>
            <div style={{
              flex: '0 0 auto', padding: '3px 4px',
              fontSize: 'clamp(9px, 1vw, 11px)',
              fontWeight: 500, color: 'var(--text)',
              textAlign: 'center',
              background: 'rgba(255,255,255,0.95)',
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}>{cell.unit_name || cell.custom_name || cell.code}</div>
          </>
        ) : (
          <div style={{
            flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: 'var(--border-strong)', opacity: 0.55,
          }}>
            <Plus size={16} strokeWidth={1.6} />
          </div>
        )}
      </div>
    </button>
  )
}
