#!/usr/bin/env node
/* eslint-disable no-console */
// Backfill: применяет белый фон ко всем существующим unit_photos.type='stock'.
//
// Алгоритм на каждое фото:
//   1) скачиваем оригинал из S3 по url из БД
//   2) шлём в rembg-sidecar (?model=u2net) с form-field secret
//   3) загружаем результат под НОВЫМ ключом (suffix _white)
//   4) UPDATE unit_photos SET url=$new
//
// Старые S3-файлы НЕ удаляются — остаются как backup. Откат: ручной
// UPDATE unit_photos SET url=<original> WHERE id=...
//
// Запуск (dry-run, безопасно):
//   bash scripts/with-prod-pg-access.sh 'cd backend && node scripts/regen-bg.js --dry-run'
//
// Скрипт сам читает все секреты из Lockbox `prod-secrets` через `yc` CLI
// (юзер должен быть залогинен в `yc`). Подменяет host в DATABASE_URL на
// `$PROD_IP` из env (его пробрасывает wrapper with-prod-pg-access.sh).
//
// Параметры:
//   --dry-run          только вывести план, не менять БД/S3
//   --limit N          максимум N фото за запуск (default 200)
//   --model NAME       u2net (default) | silueta | isnet-general-use
//   --force            переобрабатывать даже если URL содержит '_white'
//   --stop-on-error    остановиться при первой ошибке

// Yandex Managed PG отдаёт сертификат подписанный собственным CA — Node по
// дефолту считает его «self-signed». В коде Pool({ ssl: { rejectUnauthorized:
// false } }), но pg в современных версиях это проверяет на уровне TLS до
// этого, поэтому отключаем строгую проверку сертификатов глобально для
// этого one-off скрипта. Это admin-tool, бежит локально, риск минимален.
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0'

const { Pool } = require('pg')
const { S3Client, GetObjectCommand, PutObjectCommand } = require('@aws-sdk/client-s3')
const { execSync } = require('child_process')

const argv = process.argv.slice(2)
function flag(name) { return argv.includes(name) }
function arg(name, fallback) {
  const i = argv.indexOf(name)
  if (i < 0) return fallback
  return argv[i + 1]
}

const DRY = flag('--dry-run')
const FORCE = flag('--force')
const STOP_ON_ERROR = flag('--stop-on-error')
const LIMIT = parseInt(arg('--limit', '200'), 10)
const MODEL = arg('--model', 'u2net')

// Тянем секреты из Lockbox `prod-secrets` через yc CLI. Юзер должен быть
// залогинен в yc (yc init). Это разовый затратный вызов, делается один раз.
function loadLockboxSecrets() {
  const raw = execSync('yc lockbox payload get --name prod-secrets --format json', { encoding: 'utf8' })
  const data = JSON.parse(raw)
  const out = {}
  for (const e of data.entries) {
    if (e.key) out[e.key] = e.text_value || ''
  }
  return out
}

function need(o, name) {
  if (!o[name]) { console.error(`MISSING in Lockbox: ${name}`); process.exit(2) }
  return o[name]
}

const lb = loadLockboxSecrets()
const REMBG_URL = need(lb, 'REMBG_URL')
const REMBG_SECRET = need(lb, 'REMBG_SECRET')

// host в DATABASE_URL надо подменить на public IP — приватный YC FQDN не
// резолвится снаружи. wrapper with-prod-pg-access.sh экспортит PROD_HOST/PROD_IP.
const PROD_HOST = process.env.PROD_HOST
const PROD_IP = process.env.PROD_IP
if (!PROD_HOST || !PROD_IP) {
  console.error('REFUSING: PROD_HOST/PROD_IP не выставлены — запусти через scripts/with-prod-pg-access.sh')
  process.exit(2)
}
const DATABASE_URL = need(lb, 'DATABASE_URL').replace('@' + PROD_HOST, '@' + PROD_IP)

// S3 креды — из Lockbox; endpoint/bucket/public-url фиксированы (см. CLAUDE.md).
const S3_ENDPOINT = 'https://storage.yandexcloud.net'
const S3_REGION = 'ru-central1'
const S3_BUCKET = '3xproduction-files'
const S3_PUBLIC_URL = 'https://storage.yandexcloud.net/3xproduction-files'

const s3 = new S3Client({
  endpoint: S3_ENDPOINT,
  region: S3_REGION,
  credentials: {
    accessKeyId: need(lb, 'S3_ACCESS_KEY_ID'),
    secretAccessKey: need(lb, 'S3_SECRET_ACCESS_KEY'),
  },
  forcePathStyle: true,
})

const pool = new Pool({ connectionString: DATABASE_URL, ssl: { rejectUnauthorized: false } })

async function listPhotos() {
  const where = FORCE
    ? `p.type = 'stock'`
    : `p.type = 'stock' AND p.url NOT LIKE '%_white%'`
  const { rows } = await pool.query(
    `SELECT p.id, p.url, p.unit_id, u.name
       FROM unit_photos p
       JOIN units u ON u.id = p.unit_id
      WHERE ${where}
      ORDER BY u.created_at, p.created_at
      LIMIT $1`,
    [LIMIT]
  )
  return rows
}

async function downloadFromS3(url) {
  if (!url.startsWith(S3_PUBLIC_URL + '/')) {
    throw new Error('url не начинается с S3_PUBLIC_URL: ' + url)
  }
  const key = url.slice(S3_PUBLIC_URL.length + 1)
  const r = await s3.send(new GetObjectCommand({ Bucket: S3_BUCKET, Key: key }))
  const chunks = []
  for await (const c of r.Body) chunks.push(c)
  return { buf: Buffer.concat(chunks), key }
}

async function rembgWhite(buf) {
  const fd = new FormData()
  fd.append('photo', new Blob([buf], { type: 'image/jpeg' }), 'photo.jpg')
  fd.append('secret', REMBG_SECRET)
  fd.append('model', MODEL)
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), 90_000)
  let r
  try {
    r = await fetch(REMBG_URL, { method: 'POST', body: fd, signal: ctrl.signal })
  } finally {
    clearTimeout(timer)
  }
  if (!r.ok) {
    const t = await r.text().catch(() => '')
    throw new Error(`sidecar ${r.status}: ${t.slice(0, 200)}`)
  }
  const usedModel = r.headers.get('x-bg-model-used') || ''
  return { buf: Buffer.from(await r.arrayBuffer()), usedModel }
}

async function uploadToS3(buf, originalKey) {
  const baseNoExt = originalKey.replace(/\.[^./]+$/, '')
  const newKey = `${baseNoExt}_white.jpg`
  await s3.send(new PutObjectCommand({
    Bucket: S3_BUCKET,
    Key: newKey,
    Body: buf,
    ContentType: 'image/jpeg',
  }))
  return `${S3_PUBLIC_URL}/${newKey}`
}

async function main() {
  console.log(`[regen-bg] dry-run=${DRY} limit=${LIMIT} model=${MODEL} force=${FORCE} stop-on-error=${STOP_ON_ERROR}`)
  console.log(`[regen-bg] sidecar=${REMBG_URL}`)
  console.log(`[regen-bg] s3=${S3_PUBLIC_URL}`)

  const photos = await listPhotos()
  console.log(`[regen-bg] found ${photos.length} photo(s):`)
  for (const p of photos) {
    console.log(`  ${p.id}  unit="${p.name}"  url=${p.url}`)
  }
  if (DRY) {
    console.log('[regen-bg] DRY — exiting without changes')
    await pool.end()
    return
  }

  const failed = []
  let ok = 0
  for (const p of photos) {
    const t0 = Date.now()
    try {
      console.log(`[regen-bg] >> ${p.id}  unit="${p.name}"`)
      const { buf: orig, key } = await downloadFromS3(p.url)
      console.log(`     downloaded ${orig.length} B  key=${key}`)
      const { buf: processed, usedModel } = await rembgWhite(orig)
      console.log(`     rembg ${processed.length} B  model-used=${usedModel || '(unknown)'}`)
      const newUrl = await uploadToS3(processed, key)
      console.log(`     uploaded → ${newUrl}`)
      await pool.query('UPDATE unit_photos SET url = $1 WHERE id = $2', [newUrl, p.id])
      console.log(`     DB updated  (${Date.now() - t0}ms)`)
      ok++
    } catch (err) {
      console.error(`     FAILED ${p.id}: ${err.message}`)
      failed.push({ id: p.id, url: p.url, error: err.message })
      if (STOP_ON_ERROR) break
    }
  }
  console.log(`\n[regen-bg] done: ok=${ok} failed=${failed.length} total=${photos.length}`)
  if (failed.length) console.log('[regen-bg] failures:\n', JSON.stringify(failed, null, 2))
  await pool.end()
}

main().catch(err => { console.error('[regen-bg] FATAL:', err); pool.end(); process.exit(1) })
