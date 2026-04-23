// Каталог-сетка ячеек секции. Каждая ячейка — карточка в стиле UnitsPage:
// сверху фото единицы (или плюсик для свободной), ниже — имя/код +
// бейдж статуса или «Свободно». Последняя карточка всегда — «+ Добавить»
// (phantom), клик по ней открывает модалку действий, ячейка создаётся
// автоматически после подтверждения.
//
// Клик:
//   занятая ячейка → onOpenUnit(unit_id)
//   пустая ячейка  → onOpenEmptyCell(cell)
//   phantom «+»    → onAddNew()              (если canAdd=true)

import { Package, Plus } from 'lucide-react'
import Badge from '../../shared/Badge'
import { STATUS_LABEL, STATUS_COLOR } from '../../../constants/statuses'

export default function CellsGrid({ cells, onOpenUnit, onAddNew, canAdd }) {
  // Показываем только занятые ячейки. Пустые «остатки» (от старого конструктора
  // или после удаления единицы) скрываем — их создаёт phantom-кнопка.
  const occupiedCells = (cells || []).filter(c => c.unit_id && c.unit_status !== 'written_off')
  const hasCells = occupiedCells.length > 0

  if (!hasCells && !canAdd) {
    return (
      <div style={{ padding: '60px 20px', textAlign: 'center', color: 'var(--muted)' }}>
        В этой секции ещё нет единиц.
      </div>
    )
  }

  return (
    <>
      <style>{`
        .cg-grid {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
          gap: 16px;
        }
        .cg-card {
          background: var(--white);
          border: 1px solid var(--border);
          border-radius: 12px;
          overflow: hidden;
          cursor: pointer;
          padding: 0;
          font-family: inherit;
          text-align: left;
          display: flex; flex-direction: column;
          transition: transform 0.12s, box-shadow 0.12s, border-color 0.12s;
        }
        .cg-card:hover {
          transform: translateY(-2px);
          box-shadow: 0 8px 20px rgba(0,0,0,0.08);
          border-color: var(--gold-500);
        }
        .cg-card.empty {
          background: var(--paper);
          border-style: dashed;
        }
        .cg-card.empty:hover {
          border-color: var(--gold-500);
          background: var(--gold-100);
        }
        .cg-card.phantom {
          background: var(--paper);
          border-style: dashed;
          border-color: var(--gold-500);
        }
        .cg-card.phantom:hover {
          background: var(--gold-100);
        }
        .cg-phantom-body {
          padding: 10px 12px 12px;
          display: flex; flex-direction: column; gap: 4px;
          min-height: 72px;
        }
        .cg-phantom-label {
          font-size: 14px; font-weight: 600; color: var(--gold-600);
        }
        .cg-phantom-hint {
          font-size: 11px; color: var(--muted);
        }
        .cg-img-wrap {
          position: relative;
          width: 100%;
          aspect-ratio: 1 / 1;
          background: var(--bg-secondary);
          display: flex; align-items: center; justify-content: center;
          overflow: hidden;
        }
        .cg-img-wrap img {
          width: 100%; height: 100%; object-fit: cover;
        }
        .cg-img-placeholder {
          color: var(--gold-600);
        }
        .cg-empty-plus {
          color: var(--border-strong);
          opacity: 0.7;
        }
        .cg-cell-code {
          position: absolute;
          top: 8px; left: 8px;
          background: rgba(0,0,0,0.65);
          color: #fff;
          padding: 3px 8px;
          border-radius: 999px;
          font-size: 11px; font-weight: 600;
          letter-spacing: 0.01em;
          backdrop-filter: blur(4px);
          -webkit-backdrop-filter: blur(4px);
        }
        .cg-body { padding: 10px 12px 12px; display: flex; flex-direction: column; gap: 6px; min-height: 72px; }
        .cg-name {
          font-size: 14px; font-weight: 500; color: var(--text);
          line-height: 1.3;
          display: -webkit-box;
          -webkit-line-clamp: 2;
          -webkit-box-orient: vertical;
          overflow: hidden;
        }
        .cg-empty-label {
          font-size: 13px; font-weight: 500; color: var(--muted);
        }
        .cg-meta {
          font-size: 11px; color: var(--muted);
        }
        @media (max-width: 600px) {
          .cg-grid { grid-template-columns: repeat(2, 1fr); gap: 10px; }
          .cg-body { padding: 8px 10px 10px; min-height: 64px; }
          .cg-name { font-size: 13px; }
        }
      `}</style>

      <div className="cg-grid">
        {occupiedCells.map(cell => (
          <button
            key={cell.id}
            className="cg-card"
            onClick={() => onOpenUnit?.(cell.unit_id)}
          >
            <div className="cg-img-wrap">
              {cell.photo_url && !/\.(mp4|webm|mov)$/i.test(cell.photo_url) ? (
                <img src={cell.photo_url} alt="" />
              ) : (
                <Package size={36} strokeWidth={1.3} className="cg-img-placeholder" />
              )}
            </div>
            <div className="cg-body">
              <div className="cg-name">{cell.unit_name || '—'}</div>
              <Badge color={STATUS_COLOR[cell.unit_status] || 'muted'}>
                {STATUS_LABEL[cell.unit_status] || cell.unit_status || 'Не указан'}
              </Badge>
            </div>
          </button>
        ))}

        {canAdd && (
          <button
            key="__phantom"
            className="cg-card phantom"
            onClick={() => onAddNew?.()}
          >
            <div className="cg-img-wrap">
              <Plus size={42} strokeWidth={1.6} style={{ color: 'var(--gold-500)' }} />
            </div>
            <div className="cg-phantom-body">
              <div className="cg-phantom-label">+ Пополнить</div>
              <div className="cg-phantom-hint">Сфотографируй или Выбери из каталога</div>
            </div>
          </button>
        )}
      </div>
    </>
  )
}
