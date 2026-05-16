// ONE-TIME, isolation-safe reconcile of prod `_migrations` tracking.
//
// Problem: prod was brought up BEFORE migration tracking existed, so prod
// `_migrations` has no rows for 001..066 even though that schema IS present.
// Any "run all migrations" tool then re-runs non-idempotent 001..066 and
// crashes the container (the prod 502). This job FUNDAMENTALLY fixes that by
// marking 001..066 as applied WITHOUT running them — tracking rows only.
//
// HARD SAFETY:
//  - Touches ONLY the `_migrations` tracking table. Zero business-data writes.
//  - Refuses to mark anything unless representative schema objects spanning
//    001..066 are present (so we never hide a truly-unapplied migration).
//  - One transaction; business-data invariants captured before/after; if ANY
//    invariant changes -> ROLLBACK.
//  - MODE=audit (default) is fully read-only: reports, commits nothing.
//    MODE=apply performs the guarded tracking insert.
//
// Runs in a SEPARATE throwaway serverless container (NOT the live app),
// in-VPC (no public-IP toggle). Prints one JSON line + serves it on GET /.

const fs = require('fs')
const path = require('path')
const http = require('http')
const { Pool } = require('pg')

const MODE = (process.env.RECONCILE_MODE || 'audit').toLowerCase() // 'audit' | 'apply'
const MIN_PREFIX = 1
const MAX_PREFIX = 66 // reconcile ONLY 001..066; 067+ handled by db-job/normal flow

const isProd = process.env.NODE_ENV === 'production'
const pool = new Pool({
  connectionString: (process.env.DATABASE_URL || '').replace(/\?.*$/, ''),
  ssl: isProd ? { rejectUnauthorized: false } : false,
})

let RESULT = { status: 'pending', mode: MODE }

// Representative schema objects spanning the 001..066 history. If the app is
// healthy these all exist; a missing one means that migration era is NOT
// actually applied -> we must NOT mark it applied.
const SCHEMA_CHECKS = [
  ['table', 'users'], ['table', 'projects'], ['table', 'units'],
  ['table', 'warehouses'], ['table', 'warehouse_sections'],
  ['table', 'requests'], ['table', 'issuances'], ['table', 'debts'],
  ['table', 'project_loan_requests'], ['table', 'warehouse_return_requests'],
  ['table', 'handovers'], ['table', 'writeoffs'], ['table', 'search_synonyms'],
  ['table', 'unit_photos'], ['table', 'public_users'], ['table', 'casting_actors'],
  ['col', 'units.period'], ['col', 'units.is_misplaced'],
  ['col', 'units.is_admin_stock'], ['col', 'unit_photos.thumb_url'],
  ['col', 'units.pending_transfer'], ['col', 'users.phone'],
]

async function schemaPresence(client) {
  const out = {}
  for (const [kind, ref] of SCHEMA_CHECKS) {
    let present = false
    try {
      if (kind === 'table') {
        present = (await client.query(
          `SELECT to_regclass('public.'||$1) IS NOT NULL ok`, [ref])).rows[0].ok
      } else {
        const [t, c] = ref.split('.')
        present = (await client.query(
          `SELECT EXISTS(SELECT 1 FROM information_schema.columns
             WHERE table_name=$1 AND column_name=$2) ok`, [t, c])).rows[0].ok
      }
    } catch { present = false }
    out[`${kind}:${ref}`] = present
  }
  return out
}

async function invariants(client) {
  const q = async (sql) => (await client.query(sql)).rows[0]
  return {
    units: await q(`SELECT count(*)::int total,
        count(*) FILTER (WHERE status='written_off')::int written_off,
        COALESCE(sum(qty),0)::int qty_sum FROM units`),
    projects: (await q(`SELECT count(*)::int c FROM projects`)).c,
    users: (await q(`SELECT count(*)::int c FROM users`)).c,
    requests: (await q(`SELECT count(*)::int c FROM requests`)).c,
    issuances: (await q(`SELECT count(*)::int c FROM issuances`)).c,
  }
}

function changed(a, b) {
  return JSON.stringify(a) !== JSON.stringify(b)
}

async function run() {
  const client = await pool.connect()
  try {
    await client.query(`CREATE TABLE IF NOT EXISTS _migrations (
      id SERIAL PRIMARY KEY, filename TEXT NOT NULL UNIQUE,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`)

    const dir = path.join(__dirname, '..', 'src', 'db', 'migrations')
    const all = fs.readdirSync(dir).filter(f => f.endsWith('.sql')).sort()
    const inRange = all.filter(f => {
      const n = parseInt(f.slice(0, 3), 10)
      return Number.isFinite(n) && n >= MIN_PREFIX && n <= MAX_PREFIX
    })
    const applied = new Set(
      (await client.query('SELECT filename FROM _migrations')).rows.map(r => r.filename))
    const missing = inRange.filter(f => !applied.has(f))

    const schema = await schemaPresence(client)
    const schemaOk = Object.values(schema).every(Boolean)

    const before = await invariants(client)

    if (MODE !== 'apply') {
      RESULT = {
        status: 'AUDIT_ONLY', mode: MODE, schema_ok: schemaOk, schema,
        in_range: inRange.length, already_applied: inRange.length - missing.length,
        would_mark: missing, invariants: before,
        note: schemaOk ? 'schema present; safe to apply (RECONCILE_MODE=apply)'
                        : 'SCHEMA GAP — do NOT apply; investigate missing objects',
      }
      console.log('RECONCILE_RESULT ' + JSON.stringify(RESULT))
      return
    }

    if (!schemaOk) {
      RESULT = { status: 'ABORTED_schema_gap', mode: MODE, schema, missing }
      console.log('RECONCILE_RESULT ' + JSON.stringify(RESULT))
      return
    }

    await client.query('BEGIN')
    const marked = []
    for (const f of missing) {
      await client.query(
        'INSERT INTO _migrations (filename) VALUES ($1) ON CONFLICT DO NOTHING', [f])
      marked.push(f)
    }
    const after = await invariants(client)

    if (changed(before, after)) {
      await client.query('ROLLBACK')
      RESULT = { status: 'ROLLED_BACK_invariant_changed', before, after, missing }
    } else {
      await client.query('COMMIT')
      RESULT = { status: 'OK', mode: MODE, marked, schema_ok: true,
        invariants_before: before, invariants_after: after }
    }
  } catch (err) {
    try { await client.query('ROLLBACK') } catch { /* already aborted */ }
    RESULT = { status: 'ERROR', error: String(err && err.message || err) }
  } finally {
    client.release()
  }
  console.log('RECONCILE_RESULT ' + JSON.stringify(RESULT))
}

function finish() {
  // Throwaway serverless container: keep alive + serve result for curl.
  if (process.env.RECONCILE_SERVE === '1') {
    http.createServer((req, res) => {
      res.setHeader('content-type', 'application/json')
      res.end(JSON.stringify(RESULT))
    }).listen(process.env.PORT || 3000)
    return
  }
  // CLI run: exit with a status-derived code.
  const ok = RESULT.status === 'OK' || RESULT.status === 'AUDIT_ONLY'
  process.exit(ok ? 0 : 1)
}

run()
  .catch(e => {
    RESULT = { status: 'FATAL', error: String(e) }
    console.log('RECONCILE_RESULT ' + JSON.stringify(RESULT))
  })
  .finally(finish)
