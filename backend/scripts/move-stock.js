// One-off DATA job (NOT a migration — touches no _migrations, no DDL).
// Moves project-warehouse stock (is_project_kept=true) from project «Сталин»
// to project «Спецы». Runs in a SEPARATE throwaway serverless container.
// One transaction; guarded (exactly one src + one dst project); prints
// moved unit ids for reversibility; ROLLBACK on any error.
//
// Result as JSON to stdout (yc logging read) and served at GET /.

const http = require('http')
const { Pool } = require('pg')

const SRC_NAME = 'Сталин'
const DST_NAME = 'Спецы'

const isProd = process.env.NODE_ENV === 'production'
const pool = new Pool({
  connectionString: (process.env.DATABASE_URL || '').replace(/\?.*$/, ''),
  ssl: isProd ? { rejectUnauthorized: false } : false,
})

let RESULT = { status: 'pending' }

async function run() {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')

    const src = (await client.query(
      `SELECT id,name FROM projects WHERE lower(trim(name)) = lower($1)`, [SRC_NAME])).rows
    const dst = (await client.query(
      `SELECT id,name FROM projects WHERE lower(trim(name)) = lower($1)`, [DST_NAME])).rows

    if (src.length !== 1 || dst.length !== 1) {
      await client.query('ROLLBACK')
      RESULT = { status: 'ABORT_ambiguous_projects',
        src_matches: src, dst_matches: dst }
      return
    }
    const srcId = src[0].id, dstId = dst[0].id

    const before = (await client.query(
      `SELECT
         count(*) FILTER (WHERE is_project_kept AND project_id=$1)::int src_kept,
         count(*) FILTER (WHERE is_project_kept AND project_id=$2)::int dst_kept,
         count(*) FILTER (WHERE project_id=$1)::int src_total,
         (SELECT count(*) FROM units)::int units_total,
         (SELECT COALESCE(sum(qty),0) FROM units)::int qty_sum`,
      [srcId, dstId])).rows[0]

    const moved = (await client.query(
      `UPDATE units SET project_id=$2
         WHERE is_project_kept = true AND project_id = $1
       RETURNING id`, [srcId, dstId])).rows.map(r => r.id)

    if (moved.length) {
      await client.query(
        `INSERT INTO unit_history (unit_id, action, project_id)
         SELECT unnest($1::uuid[]), 'Проект изменён: Сталин → Спецы', $2`,
        [moved, dstId])
    }

    const after = (await client.query(
      `SELECT
         count(*) FILTER (WHERE is_project_kept AND project_id=$1)::int src_kept,
         count(*) FILTER (WHERE is_project_kept AND project_id=$2)::int dst_kept,
         (SELECT count(*) FROM units)::int units_total,
         (SELECT COALESCE(sum(qty),0) FROM units)::int qty_sum`,
      [srcId, dstId])).rows[0]

    // Сохранность общего стока: total и qty не должны измениться (мы только
    // меняем project_id, не удаляем/не множим).
    if (before.units_total !== after.units_total || before.qty_sum !== after.qty_sum) {
      await client.query('ROLLBACK')
      RESULT = { status: 'ROLLED_BACK_stock_changed', before, after, moved_count: moved.length }
      return
    }

    await client.query('COMMIT')
    RESULT = {
      status: 'OK',
      src: { id: srcId, name: src[0].name },
      dst: { id: dstId, name: dst[0].name },
      moved_count: moved.length,
      moved_ids: moved,             // для отката: UPDATE units SET project_id=src WHERE id = ANY(...)
      before, after,
    }
  } catch (err) {
    try { await client.query('ROLLBACK') } catch { /* already aborted */ }
    RESULT = { status: 'ERROR', error: String(err && err.message || err) }
  } finally {
    client.release()
  }
  console.log('MOVESTOCK_RESULT ' + JSON.stringify(RESULT))
}

run().catch(e => { RESULT = { status: 'FATAL', error: String(e) }; console.log('MOVESTOCK_RESULT ' + JSON.stringify(RESULT)) })

http.createServer((req, res) => {
  res.setHeader('content-type', 'application/json')
  res.end(JSON.stringify(RESULT))
}).listen(process.env.PORT || 3000)
