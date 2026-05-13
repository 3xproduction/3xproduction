// Одноразовый upload @imgly/background-removal-data в Yandex Object Storage.
// Запуск: S3_ACCESS_KEY_ID=... S3_SECRET_ACCESS_KEY=... node scripts/upload-imgly-data.js
const fs = require('fs')
const path = require('path')
const { S3Client, PutObjectCommand, HeadObjectCommand } = require('@aws-sdk/client-s3')

const SRC = path.resolve(__dirname, '..', 'frontend', 'node_modules', '@imgly', 'background-removal-data', 'dist')
const BUCKET = '3xproduction-files'
const PREFIX = 'imgly-data/v1.4.5/dist/'

const s3 = new S3Client({
  region: 'ru-central1',
  endpoint: 'https://storage.yandexcloud.net',
  credentials: {
    accessKeyId: process.env.S3_ACCESS_KEY_ID,
    secretAccessKey: process.env.S3_SECRET_ACCESS_KEY,
  },
})

function mimeFor(filename) {
  if (filename === 'resources.json') return 'application/json'
  // Все остальные — chunks (.wasm/.onnx parts), отдаём как octet-stream
  return 'application/octet-stream'
}

async function exists(key) {
  try {
    await s3.send(new HeadObjectCommand({ Bucket: BUCKET, Key: key }))
    return true
  } catch (e) {
    if (e.$metadata?.httpStatusCode === 404 || e.name === 'NotFound') return false
    throw e
  }
}

async function upload(file) {
  const filepath = path.join(SRC, file)
  const stat = fs.statSync(filepath)
  const key = PREFIX + file
  if (await exists(key)) {
    return { file, status: 'skip', size: stat.size }
  }
  await s3.send(new PutObjectCommand({
    Bucket: BUCKET,
    Key: key,
    Body: fs.readFileSync(filepath),
    ContentType: mimeFor(file),
    CacheControl: 'public, max-age=31536000, immutable',
  }))
  return { file, status: 'upload', size: stat.size }
}

async function main() {
  if (!process.env.S3_ACCESS_KEY_ID || !process.env.S3_SECRET_ACCESS_KEY) {
    console.error('Missing S3_ACCESS_KEY_ID / S3_SECRET_ACCESS_KEY')
    process.exit(1)
  }
  const files = fs.readdirSync(SRC)
  console.log(`>>> Загружаю ${files.length} файлов в s3://${BUCKET}/${PREFIX}`)

  let uploaded = 0, skipped = 0, totalBytes = 0
  // Параллельно по 4
  const queue = [...files]
  async function worker() {
    while (queue.length) {
      const f = queue.shift()
      try {
        const r = await upload(f)
        if (r.status === 'upload') { uploaded++; totalBytes += r.size; process.stdout.write(`+ ${f} (${(r.size/1024/1024).toFixed(1)}MB)\n`) }
        else { skipped++; process.stdout.write(`= ${f}\n`) }
      } catch (e) {
        console.error(`! ${f}: ${e.message}`)
      }
    }
  }
  await Promise.all([worker(), worker(), worker(), worker()])
  console.log(`>>> Загружено: ${uploaded}, пропущено: ${skipped}, объём: ${(totalBytes/1024/1024).toFixed(1)}MB`)
}

main().catch(e => { console.error(e); process.exit(1) })
