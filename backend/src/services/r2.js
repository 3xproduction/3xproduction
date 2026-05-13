const { S3Client, PutObjectCommand, DeleteObjectCommand } = require('@aws-sdk/client-s3')
const crypto = require('crypto')
const path   = require('path')
const sharp  = require('sharp')
const logger = require('../logger')

const endpoint = (process.env.S3_ENDPOINT || '').trim()
const accessKeyId = (process.env.S3_ACCESS_KEY_ID || '').trim()
const secretAccessKey = (process.env.S3_SECRET_ACCESS_KEY || '').trim()

logger.debug({
  endpoint,
  region: process.env.S3_REGION,
  bucket: process.env.S3_BUCKET_NAME,
  hasKey: !!accessKeyId,
  hasSecret: !!secretAccessKey,
}, 'S3 config loaded')

const s3 = new S3Client({
  region: (process.env.S3_REGION || 'auto').trim(),
  endpoint,
  credentials: { accessKeyId, secretAccessKey },
  forcePathStyle: true,
})

async function uploadFile(buffer, originalName, folder = 'uploads') {
  const ext  = path.extname(originalName)
  const key  = `${folder}/${crypto.randomBytes(16).toString('hex')}${ext}`

  await s3.send(new PutObjectCommand({
    Bucket:      process.env.S3_BUCKET_NAME,
    Key:         key,
    Body:        buffer,
    ContentType: getContentType(ext),
  }))

  return `${process.env.S3_PUBLIC_URL}/${key}`
}

async function deleteFile(url) {
  const key = url.replace(`${process.env.S3_PUBLIC_URL}/`, '')
  await s3.send(new DeleteObjectCommand({
    Bucket: process.env.S3_BUCKET_NAME,
    Key:    key,
  }))
}

// Загружает оригинал + сжатый 400px JPEG-thumbnail. Используется только для
// картинок (видео грузим через uploadFile). Возвращает { url, thumbUrl }.
// Если sharp падает (битый файл) — thumb опускается, возвращаем { url, thumbUrl: null }.
async function uploadImageWithThumb(buffer, originalName, folder = 'uploads') {
  const url = await uploadFile(buffer, originalName, folder)
  let thumbUrl = null
  try {
    const thumbBuf = await sharp(buffer)
      .rotate()
      .resize(400, 400, { fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 80, mozjpeg: true })
      .toBuffer()
    const base = path.basename(originalName, path.extname(originalName)) || 'photo'
    thumbUrl = await uploadFile(thumbBuf, `${base}_thumb.jpg`, folder)
  } catch (err) {
    logger.warn({ err, file: originalName }, 'thumb generation failed')
  }
  return { url, thumbUrl }
}

// Делает thumb из переданного buffer и кладёт в указанный folder. Возвращает URL
// либо null если sharp не справился. Используется при regen-bg для существующих
// фото.
async function makeThumbFromBuffer(buffer, originalName, folder = 'uploads') {
  try {
    const thumbBuf = await sharp(buffer)
      .rotate()
      .resize(400, 400, { fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 80, mozjpeg: true })
      .toBuffer()
    const base = path.basename(originalName, path.extname(originalName)) || 'photo'
    return await uploadFile(thumbBuf, `${base}_thumb.jpg`, folder)
  } catch (err) {
    logger.warn({ err, file: originalName }, 'thumb generation failed')
    return null
  }
}

function getContentType(ext) {
  const map = {
    '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp',
    '.pdf': 'application/pdf',
    '.mp4': 'video/mp4', '.webm': 'video/webm', '.mov': 'video/quicktime',
  }
  return map[ext.toLowerCase()] || 'application/octet-stream'
}

module.exports = { uploadFile, deleteFile, uploadImageWithThumb, makeThumbFromBuffer }
