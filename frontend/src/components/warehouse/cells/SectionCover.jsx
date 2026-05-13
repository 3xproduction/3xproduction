// Обложка карточки секции в стиле Apple Photos / Wildberries:
// коллаж из 1–4 фото занятых ячеек + оверлей-бейдж занятости.
// Если фото нет — градиент с иконкой типа секции.

import { Package, Shirt, Truck } from 'lucide-react'
import { sumOnStockCellQty } from '../../../utils/unitQty'

const ICON_BY_TYPE = {
  shelf: Package,
  hanger: Shirt,
  place: Truck,
}

export default function SectionCover({ section }) {
  const cells = section.cells || []
  const photos = cells
    .map(c => c.photo_url)
    .filter(u => u && !/\.(mp4|webm|mov)$/i.test(u))
    .slice(0, 4)

  const occupied = sumOnStockCellQty(cells)
  // Места безлимитные — бейдж всегда нейтрально-белый с текстом количества.
  const badgeBg = 'rgba(255,255,255,0.88)'
  const badgeColor = 'var(--text)'

  const Icon = ICON_BY_TYPE[section.type] || Package

  return (
    <div style={{
      position: 'relative', width: '100%', aspectRatio: '4 / 3',
      borderRadius: 12, overflow: 'hidden',
      background: photos.length
        ? 'var(--bg-secondary)'
        : 'linear-gradient(135deg, var(--gold-100) 0%, rgba(201,165,92,0.18) 100%)',
    }}>
      {photos.length === 0 && (
        <div style={{
          position: 'absolute', inset: 0,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          color: 'var(--gold-600)',
        }}>
          <Icon size={42} strokeWidth={1.3} />
        </div>
      )}

      {photos.length === 1 && (
        <img
          src={photos[0]} alt=""
          style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }}
        />
      )}

      {photos.length >= 2 && (
        <div style={{
          position: 'absolute', inset: 0,
          display: 'grid',
          gridTemplateColumns: photos.length === 2 ? '1fr 1fr' : '1fr 1fr',
          gridTemplateRows: photos.length === 2 ? '1fr' : '1fr 1fr',
          gap: 2,
        }}>
          {photos.map((src, i) => (
            <div key={i} style={{
              background: `url(${src}) center/cover, var(--bg-secondary)`,
              width: '100%', height: '100%',
              // 3-е фото на весь нижний ряд если всего 3
              gridColumn: photos.length === 3 && i === 2 ? '1 / span 2' : 'auto',
            }} />
          ))}
        </div>
      )}

      {/* Бейдж количества единиц справа-сверху. Места безлимитные — показываем
          только сколько реально размещено. */}
      {occupied > 0 && (
        <div style={{
          position: 'absolute', top: 8, right: 8,
          padding: '3px 9px', borderRadius: 999,
          fontSize: 11, fontWeight: 600, letterSpacing: '-0.005em',
          background: badgeBg, color: badgeColor,
          backdropFilter: 'blur(6px)',
          WebkitBackdropFilter: 'blur(6px)',
          boxShadow: '0 1px 4px rgba(0,0,0,0.08)',
        }}>
          {occupied}
        </div>
      )}
    </div>
  )
}
