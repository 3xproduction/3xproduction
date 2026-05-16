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
  const spExists = (await q(`SELECT to_regclass('public.section_projects') t`))[0].t
  return {
    section_projects: spExists ? await q(`SELECT ws.name AS section, p.name AS project
        FROM section_projects sp
        JOIN warehouse_sections ws ON ws.id = sp.section_id
        JOIN projects p ON p.id = sp.project_id
        ORDER BY ws.name, p.name`) : null,
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
    varya_candidates: await q(`SELECT id,name,role,project_id FROM users
        WHERE lower(name) LIKE '%бартнов%' OR lower(name) LIKE '%варвар%' ORDER BY name`),
    warehouses_217_513: await q(`SELECT w.id,w.name,w.project_id,p.name AS project_name
        FROM warehouses w LEFT JOIN projects p ON p.id=w.project_id
        WHERE w.name ~ '217|513' ORDER BY w.name`),
    sections_217_513: await q(`SELECT s.id,s.name,s.type,
        (to_jsonb(s) ->> 'project_id') AS project_id
        FROM warehouse_sections s
        WHERE s.name ~ '217|513' ORDER BY s.name`),
    units_in_217_513: (await q(`SELECT count(*)::int c FROM units u
        LEFT JOIN warehouses w ON w.id=u.warehouse_id
        LEFT JOIN cells c ON c.id=u.cell_id
        LEFT JOIN warehouse_sections s ON s.id=c.section_id
        LEFT JOIN warehouse_sections h ON h.id=s.parent_section_id
        WHERE lower(concat_ws(' ',w.name,h.name,s.name,c.custom_name,c.code))
              ~ '(^|[^0-9])(217|513)([^0-9]|$)'`))[0].c,
  }
}

// Post-commit, read-only verification (outside the apply transaction so it
// can never affect what was applied). Tolerant: any failure → captured.
async function verifyBlock(client) {
  const q = async (sql) => (await client.query(sql)).rows
  try {
    return {
      varya_memberships: await q(`SELECT u.name AS user_name, p.name AS project
          FROM users u
          JOIN user_projects up ON up.user_id = u.id
          JOIN projects p ON p.id = up.project_id
          WHERE lower(u.name) LIKE '%бартнов%' OR lower(u.name) LIKE '%варвар%'
          ORDER BY u.name, p.name`),
      sections_217_513: await q(`SELECT id,name,type,warehouse_id
          FROM warehouse_sections WHERE name ~ '217|513' ORDER BY name`),
      units_period_217_513: (await q(`SELECT count(*)::int c FROM units
          WHERE period ~ '217|513'`))[0].c,
      units_project_location_set: (await q(`SELECT count(*)::int c FROM units
          WHERE project_location IS NOT NULL AND project_location <> ''`))[0].c,
    }
  } catch (e) {
    return { verify_error: String(e && e.message || e) }
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
      const verify = await verifyBlock(client)
      RESULT = { status: 'OK', applied: ran, candidates: todo, before, after, verify }
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
