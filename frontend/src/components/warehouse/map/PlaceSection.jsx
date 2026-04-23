// Секция «Место» — одна большая позиция для крупных предметов (авто,
// мебель, крупная бутафория). Минималистичный брендовый стиль.

import { Truck, Package, Plus } from 'lucide-react'
import { SectionHeader } from './ShelfSection'

export default function PlaceSection({ section, onCellClick, selectedCellId }) {
  const cell = (section.cells || [])[0]
  const occupied = cell?.unit_id && cell.unit_status === 'on_stock'
  const selected = cell && String(selectedCellId) === String(cell.id)

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
        kind="place"
        name={section.name}
        occ={occupied ? 1 : 0}
        total={1}
      />

      <button
        onClick={(e) => { e.stopPropagation(); cell && onCellClick?.(cell) }}
        onPointerDown={(e) => e.stopPropagation()}
        style={{
          flex: 1, minHeight: 0, width: '100%',
          border: 'none', background: 'transparent',
          padding: 10, cursor: 'pointer',
          display: 'flex', flexDirection: 'column',
          fontFamily: 'inherit',
        }}
      >
        <div style={{
          flex: 1, minHeight: 0, width: '100%',
          border: selected
            ? '2px solid var(--gold-500)'
            : occupied ? '1px solid var(--border)' : '1px dashed var(--border-strong)',
          borderRadius: 10,
          background: occupied ? '#fff' : 'var(--paper)',
          display: 'flex', flexDirection: 'column',
          alignItems: 'center', justifyContent: 'center',
          padding: 10, gap: 6,
          overflow: 'hidden',
        }}>
          {occupied && cell.photo_url ? (
            <>
              <img
                src={cell.photo_url}
                alt=""
                style={{
                  maxWidth: '100%', maxHeight: '100%',
                  width: 'auto', height: 'auto',
                  objectFit: 'contain',
                  display: 'block',
                  flex: 1, minHeight: 0,
                }}
              />
              <div style={{
                flex: '0 0 auto',
                fontSize: 'clamp(11px, 1.1vw, 13px)',
                fontWeight: 500, color: 'var(--text)',
                textAlign: 'center',
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                maxWidth: '100%',
              }}>{cell.unit_name}</div>
            </>
          ) : occupied ? (
            <>
              <Package size={44} color="var(--gold-600)" strokeWidth={1.4} style={{ maxWidth: '40%', maxHeight: '40%' }} />
              <div style={{
                fontSize: 'clamp(11px, 1.1vw, 13px)',
                fontWeight: 500, color: 'var(--text)',
                textAlign: 'center',
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                maxWidth: '100%',
              }}>{cell.unit_name}</div>
            </>
          ) : (
            <>
              <Plus size={44} color="var(--gold-500)" strokeWidth={1.6} style={{ maxWidth: '35%', maxHeight: '35%', opacity: 0.7 }} />
              <div style={{
                fontSize: 'clamp(10px, 1vw, 12px)',
                fontWeight: 500, color: 'var(--subtle)',
              }}>
                Свободно — добавить
              </div>
            </>
          )}
        </div>
      </button>
    </div>
  )
}
