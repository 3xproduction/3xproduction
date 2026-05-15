require('dotenv').config()
const fs   = require('fs')
const path = require('path')
const { pool } = require('./index')

async function migrate() {
  const client = await pool.connect()
  try {
    // Create migrations table if not exists
    await client.query(`
      CREATE TABLE IF NOT EXISTS _migrations (
        id         SERIAL PRIMARY KEY,
        filename   TEXT NOT NULL UNIQUE,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `)

    const dir = path.join(__dirname, 'migrations')
    const files = fs.readdirSync(dir).filter(f => f.endsWith('.sql')).sort()

    // Migrations run on container start (Dockerfile CMD). Serverless can boot
    // several instances at once, so the check+apply+record runs inside a
    // transaction guarded by a transaction-scoped advisory lock. xact locks
    // auto-release on COMMIT/ROLLBACK and are safe through PgBouncer.
    const LOCK_KEY = 320677 // arbitrary fixed key for the migration runner

    for (const file of files) {
      const sql = fs.readFileSync(path.join(dir, file), 'utf8')
      await client.query('BEGIN')
      try {
        await client.query('SELECT pg_advisory_xact_lock($1)', [LOCK_KEY])
        const { rows } = await client.query(
          'SELECT id FROM _migrations WHERE filename = $1', [file]
        )
        if (rows.length > 0) {
          await client.query('ROLLBACK')
          console.log(`  skip: ${file}`)
          continue
        }
        await client.query(sql)
        await client.query('INSERT INTO _migrations (filename) VALUES ($1)', [file])
        await client.query('COMMIT')
        console.log(`  ✓ applied: ${file}`)
      } catch (err) {
        await client.query('ROLLBACK')
        console.error(`  ✗ failed: ${file}`, err.message)
        process.exit(1)
      }
    }

    console.log('Migrations complete.')
  } finally {
    client.release()
    await pool.end()
  }
}

migrate().catch(err => {
  console.error(err)
  process.exit(1)
})
