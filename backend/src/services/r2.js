const { S3Client, PutObjectCommand, DeleteObjectCommand } = require('@aws-sdk/client-s3')
const crypto = require('crypto')
const path   = require('path')

const endpoint = (process.env.S3_ENDPOINT || '').trim()
const accessKeyId = (process.env.S3_ACCESS_KEY_ID || '').trim()
const secretAccessKey = (process.env.S3_SECRET_ACCESS_KEY || '').trim()

console.log('S3 config:', { endpoint, region: process.env.S3_REGION, bucket: process.env.S3_BUCKET_NAME, hasKey: !!accessKeyId, hasSecret: !!secretAccessKey })

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

function getContentType(ext) {
  const map = {
    '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp',
    '.pdf': 'application/pdf',
    '.mp4': 'video/mp4', '.webm': 'video/webm', '.mov': 'video/quicktime',
  }
  return map[ext.toLowerCase()] || 'application/octet-stream'
}

module.exports = { uploadFile, deleteFile }
