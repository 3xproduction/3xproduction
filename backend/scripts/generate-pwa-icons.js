const path = require('path')
const fs = require('fs')
const sharp = require('sharp')

const publicDir = path.join(__dirname, '..', '..', 'frontend', 'public')
const src = path.join(publicDir, 'favicon.svg')

const svg = fs.readFileSync(src)

const sizes = [
  { out: 'icon-192.png', size: 192, padding: 32 },
  { out: 'icon-512.png', size: 512, padding: 80 },
  { out: 'apple-touch-icon.png', size: 180, padding: 30 },
]

async function run() {
  for (const { out, size, padding } of sizes) {
    const inner = size - padding * 2
    const rendered = await sharp(svg).resize(inner, inner, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer()

    const bg = { r: 10, g: 10, b: 10, alpha: 1 }
    await sharp({
      create: { width: size, height: size, channels: 4, background: bg },
    })
      .composite([{ input: rendered, gravity: 'center' }])
      .png()
      .toFile(path.join(publicDir, out))

    console.log(`✓ ${out} (${size}x${size})`)
  }
}

run().catch(e => { console.error(e); process.exit(1) })
