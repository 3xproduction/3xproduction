// Логотип Триикс Медиа — оригинальный PNG + SVG-оверлей с золотым блик-градиентом
// по инструкции из брендбука (Downloads/README.md).
// Файл используется БЕЗ модификаций — анимация строго поверх через SVG.
//
//   variant="icon" — только X (rail / favicon)
//   variant="full" — логотип целиком с текстом

const LOGO_SRC = '/triix-logo.png'

// Координаты из брендбука (PNG 1280×548)
const LOGO_W = 1280
const LOGO_H = 548
// Bounding box буквы X
const X_LEFT = 76
const X_RIGHT = 518
const X_TOP = 105
const X_BOT = 487

// Полигоны двух лучей X для clipPath shine-эффекта
const CLIP_POLYGON_1 = '76,105 230,105 518,487 364,487'
const CLIP_POLYGON_2 = '364,105 518,105 230,487 76,487'

// Длительность пробега блика — 6s (медленнее дефолтных 4s из README,
// чтобы не отвлекать в рабочем интерфейсе)
const SHINE_DUR = '6s'

function ShineOverlay({ idSuffix }) {
  const clipId  = `triix-x-clip-${idSuffix}`
  const gradId  = `triix-shine-${idSuffix}`
  return (
    <svg
      viewBox={`0 0 ${LOGO_W} ${LOGO_H}`}
      xmlns="http://www.w3.org/2000/svg"
      preserveAspectRatio="none"
      style={{
        position: 'absolute', inset: 0,
        width: '100%', height: '100%',
        pointerEvents: 'none',
        mixBlendMode: 'screen',
      }}
    >
      <defs>
        <clipPath id={clipId}>
          <polygon points={CLIP_POLYGON_1} />
          <polygon points={CLIP_POLYGON_2} />
        </clipPath>
        <linearGradient id={gradId} x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%"   stopColor="#C9A55C" stopOpacity="0" />
          <stop offset="50%"  stopColor="#FFF4D0" stopOpacity="0.9" />
          <stop offset="100%" stopColor="#C9A55C" stopOpacity="0" />
          <animate attributeName="x1" values="-60%; 100%; -60%" dur={SHINE_DUR} repeatCount="indefinite" />
          <animate attributeName="x2" values="40%; 200%; 40%" dur={SHINE_DUR} repeatCount="indefinite" />
        </linearGradient>
      </defs>
      <g clipPath={`url(#${clipId})`}>
        <rect width={LOGO_W} height={LOGO_H} fill={`url(#${gradId})`} />
      </g>
    </svg>
  )
}

export default function TriixLogo({ size = 36, variant = 'icon', onClick, style }) {
  if (variant === 'full') {
    // Полный логотип: aspect 1280/548, виден целиком
    return (
      <button
        type="button"
        onClick={onClick}
        aria-label="Триикс Медиа"
        style={{
          background: 'transparent', border: 'none', padding: 0,
          cursor: onClick ? 'pointer' : 'default',
          lineHeight: 0,
          position: 'relative',
          display: 'inline-block',
          height: size,
          aspectRatio: `${LOGO_W} / ${LOGO_H}`,
          ...style,
        }}
      >
        <img
          src={LOGO_SRC}
          alt="Триикс Медиа"
          style={{
            position: 'absolute', inset: 0,
            width: '100%', height: '100%', display: 'block',
          }}
        />
        <ShineOverlay idSuffix="full" />
      </button>
    )
  }

  // Icon-вариант: квадрат size×size, виден только X (оригинальный файл
  // масштабируется внутри overflow:hidden контейнера так, чтобы bbox X
  // заполнял квадрат; PNG не изменяется, только отображение).
  const xW = X_RIGHT - X_LEFT  // 442
  const xH = X_BOT - X_TOP     // 382
  const scale = Math.min(size / xW, size / xH)
  const scaledW = LOGO_W * scale
  const scaledH = LOGO_H * scale
  const offsetX = -X_LEFT * scale + (size - xW * scale) / 2
  const offsetY = -X_TOP * scale + (size - xH * scale) / 2

  return (
    <button
      type="button"
      onClick={onClick}
      aria-label="Триикс Медиа"
      style={{
        background: '#0A0A0A',
        border: 'none', padding: 0,
        cursor: onClick ? 'pointer' : 'default',
        width: size, height: size,
        overflow: 'hidden',
        position: 'relative',
        borderRadius: 4,
        ...style,
      }}
    >
      <div
        style={{
          position: 'absolute',
          left: offsetX, top: offsetY,
          width: scaledW, height: scaledH,
        }}
      >
        <img
          src={LOGO_SRC}
          alt="Триикс Медиа"
          style={{
            position: 'absolute', inset: 0,
            width: '100%', height: '100%', display: 'block',
          }}
        />
        <ShineOverlay idSuffix="icon" />
      </div>
    </button>
  )
}
