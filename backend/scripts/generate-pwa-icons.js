const path = require('path')
const sharp = require('sharp')

// Иконки PWA из triix-logo.png — буква «X» (bbox из brandbook).
// Генерируем 2 набора:
//   • any-purpose — 192/512/apple-touch, X занимает ~75% квадрата
//   • maskable    — 192/512, X в safe-zone ~55% (Android адаптивные иконки
//     обрезают внешние ~20% с каждой стороны; круглая маска режет углы)

const publicDir = path.join(__dirname, '..', '..', 'frontend', 'public')
const src = path.join(publicDir, 'triix-logo.png')

const X = { left: 76, top: 105, width: 518 - 76, height: 487 - 105 } // 442×382
const INK = { r: 10, g: 10, b: 10, alpha: 1 }

// padding — сколько «пустоты» вокруг X в процентах от стороны квадрата
const variants = [
  { out: 'icon-192.png',          size: 192, paddingRatio: 0.12, purpose: 'any' },
  { out: 'icon-512.png',          size: 512, paddingRatio: 0.12, purpose: 'any' },
  { out: 'apple-touch-icon.png',  size: 180, paddingRatio: 0.12, purpose: 'any' },
  { out: 'icon-maskable-192.png', size: 192, paddingRatio: 0.22, purpose: 'maskable' },
  { out: 'icon-maskable-512.png', size: 512, paddingRatio: 0.22, purpose: 'maskable' },
]

async function run() {
  for (const { out, size, paddingRatio } of variants) {
    const padding = Math.round(size * paddingRatio)
    const inner = size - padding * 2

    const cropped = await sharp(src)
      .extract({ left: X.left, top: X.top, width: X.width, height: X.height })
      .resize(inner, inner, { fit: 'contain', background: INK })
      .png()
      .toBuffer()

    await sharp({
      create: { width: size, height: size, channels: 4, background: INK },
    })
      .composite([{ input: cropped, gravity: 'center' }])
      .png()
      .toFile(path.join(publicDir, out))

    console.log(`✓ ${out} (${size}x${size}, pad ${padding}px)`)
  }
}

run().catch(e => { console.error(e); process.exit(1) })
