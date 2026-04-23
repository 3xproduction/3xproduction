const { Pool } = require('pg')
const logger = require('../logger')

// Yandex Cloud Managed PostgreSQL uses self-signed certs
// New pg versions treat sslmode=require as verify-full, so we force rejectUnauthorized: false
const dbUrl = (process.env.DATABASE_URL || '').replace(/\?.*$/, '')
const isProduction = process.env.NODE_ENV === 'production'

const pool = new Pool({
  connectionString: isProduction ? dbUrl : process.env.DATABASE_URL,
  ssl: isProduction ? { rejectUnauthorized: false } : false,
  // Yandex Serverless Container паузит процесс после ~15 минут простоя; при
  // пробуждении пул может хранить «мёртвые» соединения, которые дают
  // «Connection terminated unexpectedly». Короткий idleTimeout перезаключает
  // соединения, keepAlive держит их живыми при активности.
  idleTimeoutMillis: 10_000,
  connectionTimeoutMillis: 10_000,
  keepAlive: true,
})

pool.on('error', (err) => {
  logger.error({ err, code: err.code }, 'PostgreSQL pool error')
})

// Обёртка с ретраем на transient-ошибки соединения: если первая попытка
// ловит дохлое соединение из пула, вторая возьмёт свежее.
async function queryWithRetry(text, params) {
  try {
    return await pool.query(text, params)
  } catch (err) {
    const msg = err.message || ''
    const transient = msg.includes('Connection terminated') ||
                      msg.includes('Client has encountered a connection error') ||
                      err.code === 'ECONNRESET' || err.code === '57P01'
    if (!transient) throw err
    return await pool.query(text, params)
  }
}

module.exports = {
  query: queryWithRetry,
  getClient: () => pool.connect(),
  pool,
}
