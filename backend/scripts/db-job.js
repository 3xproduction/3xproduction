// One-off, isolation-safe DB job. Runs in a SEPARATE throwaway serverless
// container (NOT the live app). Applies ONLY new idempotent migrations
// (numeric prefix >= 67) that are not yet recorded in _migrations — it never
// touches 001..066, so it cannot replay old non-idempotent migrations (that
// is what 502'd prod on boot-migrate). Everything runs in ONE transaction
// with stock-count guards: if unit totals change, it ROLLS BACK.
//
// Output: a single JSON line to stdout (visible via `yc logging read`) and
// served at GET / so it can be curled. Job runs exactly once per process.

const fs = require('fs')
const path = require('path')
const http = require('http')
const { Pool } = require('pg')

const MIN_PREFIX = 67 // never run anything below 067

const isProd = process.env.NODE_ENV === 'production'
const pool = new Pool({
  connectionString: (process.env.DATABASE_URL || '').replace(/\?.*$/, ''),
  ssl: isProd ? { rejectUnauthorized: false } : false,
})

let RESULT = { status: 'pending' }

async function readBlock(client) {
  const q = async (sql) => (await client.query(sql)).rows
  return {
    stock: (await q(`SELECT count(*)::int units_total,
        count(*) FILTER (WHERE is_project_kept)::int project_kept,
        count(*) FILTER (WHERE status='written_off')::int written_off,
        COALESCE(sum(qty),0)::int qty_sum FROM units`))[0],
    user_projects_tbl: (await q(`SELECT to_regclass('public.user_projects') t`))[0].t,
    project_location_col: (await q(`SELECT EXISTS(SELECT 1 FROM information_schema.columns
        WHERE table_name='units' AND column_name='project_location') e`))[0].e,
    migrations_tail: (await q(`SELECT filename FROM _migrations
        ORDER BY filename DESC LIMIT 6`)).map(r => r.filename),
    projects: await q(`SELECT id,name FROM projects
        WHERE lower(trim(name)) ~ 'шеф|закон|тайг|опасн' ORDER BY name`),
    varya: await q(`SELECT id,name,role,project_id FROM users
        WHERE lower(split_part(regexp_replace(trim(name),'\\s+',' ','g'),' ',1))
        IN ('варя','варвара')`),
    warehouses_217_513: await q(`SELECT id,name,project_id FROM warehouses
        WHERE name ~ '217|513' ORDER BY name`),
  }
}

async function run() {
  const client = await pool.connect()
  try {
    await client.query(`CREATE TABLE IF NOT EXISTS _migrations (
      id SERIAL PRIMARY KEY, filename TEXT NOT NULL UNIQUE,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`)
    const dir = path.join(__dirname, '..', 'src', 'db', 'migrations')
    const all = fs.readdirSync(dir).filter(f => f.endsWith('.sql')).sort()
    const applied = new Set(
      (await client.query('SELECT filename FROM _migrations')).rows.map(r => r.filename))
    const todo = all.filter(f => {
      const n = parseInt(f.slice(0, 3), 10)
      return Number.isFinite(n) && n >= MIN_PREFIX && !applied.has(f)
    })

    await client.query('BEGIN')
    const before = await readBlock(client)
    const ran = []
    for (const f of todo) {
      const sql = fs.readFileSync(path.join(dir, f), 'utf8')
      await client.query(sql)
      await client.query('INSERT INTO _migrations (filename) VALUES ($1) ON CONFLICT DO NOTHING', [f])
      ran.push(f)
    }
    const after = await readBlock(client)

    const stockChanged =
      before.stock.units_total !== after.stock.units_total ||
      before.stock.qty_sum !== after.stock.qty_sum ||
      before.stock.written_off !== after.stock.written_off
    if (stockChanged) {
      await client.query('ROLLBACK')
      RESULT = { status: 'ROLLED_BACK_stock_changed', before, after, candidates: todo }
    } else {
      await client.query('COMMIT')
      RESULT = { status: 'OK', applied: ran, candidates: todo, before, after }
    }
  } catch (err) {
    try { await client.query('ROLLBACK') } catch { /* already aborted */ }
    RESULT = { status: 'ERROR', error: String(err && err.message || err) }
  } finally {
    client.release()
  }
  console.log('DBJOB_RESULT ' + JSON.stringify(RESULT))
}

run().catch(e => { RESULT = { status: 'FATAL', error: String(e) }; console.log('DBJOB_RESULT ' + JSON.stringify(RESULT)) })

// Keep the serverless container healthy + let the result be curled.
http.createServer((req, res) => {
  res.setHeader('content-type', 'application/json')
  res.end(JSON.stringify(RESULT))
}).listen(process.env.PORT || 3000)
