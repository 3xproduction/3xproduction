// Правая панель / bottom-sheet для конкретной ячейки: если занята —
// карточка с фото + название + «Открыть карточку»; если свободна —
// действия «Добавить новое», «Добавить со склада», «Удалить место».

import { Package, Plus, Trash2 } from 'lucide-react'
import Button from '../../shared/Button'

export default function CellDetails({ cell, canEdit, onOpenCard, onDeleteCell, onAddUnit, onPickUnit }) {
  const occupied = cell.unit_id && cell.unit_status === 'on_stock'
  if (occupied) {
    return (
      <>
        <div style={{
          display: 'flex', gap: 12, alignItems: 'center',
          padding: 14, background: 'var(--bg)', borderRadius: 12,
          marginBottom: 14,
        }}>
          {cell.photo_url ? (
            <div style={{
              width: 80, height: 80, flexShrink: 0,
              background: `url(${cell.photo_url}) center/cover`,
              borderRadius: 10,
            }} />
          ) : (
            <div style={{
              width: 80, height: 80, flexShrink: 0,
              background: 'var(--gold-100)', color: 'var(--gold-600)',
              borderRadius: 10,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}><Package size={32} strokeWidth={1.4} /></div>
          )}
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: 600, fontSize: 15, overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {cell.unit_name}
            </div>
            <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 4 }}>Занята</div>
          </div>
        </div>
        <Button fullWidth onClick={onOpenCard}>Открыть карточку единицы</Button>
      </>
    )
  }
  return (
    <div style={{ textAlign: 'center', padding: '24px 0' }}>
      <Package size={36} color="var(--subtle)" strokeWidth={1.2} style={{ marginBottom: 12 }} />
      <div style={{ color: 'var(--muted)', fontSize: 14, marginBottom: 20 }}>Место свободно</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, alignItems: 'stretch', padding: '0 4px' }}>
        {onAddUnit && (
          <Button size="sm" fullWidth onClick={onAddUnit}>
            <Plus size={14} /> Добавить новое
          </Button>
        )}
        {onPickUnit && (
          <Button variant="secondary" size="sm" fullWidth onClick={onPickUnit}>
            <Package size={14} /> Добавить со склада
          </Button>
        )}
        {canEdit && (
          <Button variant="secondary" size="sm" fullWidth
            style={{ color: 'var(--red)', borderColor: 'var(--red-dim)' }}
            onClick={onDeleteCell}>
            <Trash2 size={13} /> Удалить место
          </Button>
        )}
      </div>
    </div>
  )
}
