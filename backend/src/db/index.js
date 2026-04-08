const { Pool } = require('pg')

// Yandex Cloud Managed PostgreSQL uses self-signed certs
// New pg versions treat sslmode=require as verify-full, so we force rejectUnauthorized: false
const dbUrl = (process.env.DATABASE_URL || '').replace(/\?.*$/, '')
const isProduction = process.env.NODE_ENV === 'production'

const pool = new Pool({
  connectionString: isProduction ? dbUrl : process.env.DATABASE_URL,
  ssl: isProduction ? { rejectUnauthorized: false } : false,
})

pool.on('error', (err) => {
  console.error('PostgreSQL pool error:', err)
})

module.exports = {
  query: (text, params) => pool.query(text, params),
  getClient: () => pool.connect(),
  pool,
}
