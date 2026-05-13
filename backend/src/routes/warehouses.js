const router = require('express').Router()
const db     = require('../db')
const { verifyJWT, checkRole } = require('../middleware/auth')

const DIRECTOR_ROLES = ['warehouse_director', 'warehouse_deputy']

// GET /warehouses
router.get('/', verifyJWT, async (req, res) => {
  try {
    const { rows } = await db.query(`SELECT * FROM warehouses ORDER BY name`)
    res.json({ warehouses: rows })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Server error' })
  }
})

// POST /warehouses — create warehouse
router.post('/', verifyJWT, checkRole(...DIRECTOR_ROLES), async (req, res) => {
  const { name, address } = req.body
  if (!name) return res.status(400).json({ error: 'Name required' })
  try {
    const { rows } = await db.query(
      `INSERT INTO warehouses (name, address) VALUES ($1, $2) RETURNING *`, [name, address || null]
    )
    res.status(201).json({ warehouse: rows[0] })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: err.message || 'Server error' })
  }
})

// GET /warehouses/:id/cells — sections with cells
// Single query вместо N+1 (был цикл по секциям + коррелированный подзапрос
// за фото для каждой ячейки → 100 ячеек = 100+ round-trip). Индекс
// idx_units_cell_id (миграция 054) обеспечивает быстрый JOIN.
router.get('/:id/cells', verifyJWT, async (req, res) => {
  try {
    const { rows } = await db.query(
      `SELECT
         sec.id              AS section_id,
         sec.warehouse_id    AS section_warehouse_id,
         sec.name            AS section_name,
         sec.category        AS section_category,
         sec.rows            AS section_rows,
         sec.shelves         AS section_shelves,
         sec.type            AS section_type,
         sec.sort_order      AS section_sort_order,
         sec.parent_section_id AS section_parent_id,
         sec.x_pos           AS section_x_pos,
         sec.y_pos           AS section_y_pos,
         sec.width           AS section_width,
         sec.height          AS section_height,
         sec.rotation        AS section_rotation,
         sec.created_at      AS section_created_at,
         c.id                AS cell_id,
         c.code              AS cell_code,
         c.custom_name       AS cell_custom_name,
         c.created_at        AS cell_created_at,
         u.id                AS unit_id,
         u.name              AS unit_name,
         u.status            AS unit_status,
         u.qty               AS unit_qty,
         p.url               AS photo_url
       FROM warehouse_sections sec
       LEFT JOIN cells c ON c.section_id = sec.id
       LEFT JOIN units u ON u.cell_id = c.id AND u.status != 'written_off'
       LEFT JOIN LATERAL (
         SELECT url FROM unit_photos
         WHERE unit_id = u.id
         ORDER BY CASE WHEN url ~* '\.(mp4|webm|mov)$' THEN 1 ELSE 0 END,
                  created_at
         LIMIT 1
       ) p ON u.id IS NOT NULL
       WHERE sec.warehouse_id = $1
       ORDER BY sec.sort_order, sec.name, c.code`,
      [req.params.id]
    )

    // Группируем rows → sections с вложенными cells, сохраняя порядок.
    const sectionsMap = new Map()
    for (const r of rows) {
      let section = sectionsMap.get(r.section_id)
      if (!section) {
        section = {
          id:           r.section_id,
          warehouse_id: r.section_warehouse_id,
          name:         r.section_name,
          category:     r.section_category,
          rows:         r.section_rows,
          shelves:      r.section_shelves,
          type:         r.section_type,
          sort_order:   r.section_sort_order,
          parent_section_id: r.section_parent_id,
          x_pos:        r.section_x_pos,
          y_pos:        r.section_y_pos,
          width:        r.section_width,
          height:       r.section_height,
          rotation:     r.section_rotation,
          created_at:   r.section_created_at,
          cells:        [],
        }
        sectionsMap.set(r.section_id, section)
      }
      if (r.cell_id) {
        section.cells.push({
          id:          r.cell_id,
          section_id:  r.section_id,
          code:        r.cell_code,
          custom_name: r.cell_custom_name,
          created_at:  r.cell_created_at,
          unit_id:     r.unit_id,
          unit_name:   r.unit_name,
          unit_status: r.unit_status,
          unit_qty:    r.unit_qty == null ? null : Number(r.unit_qty),
          photo_url:   r.photo_url,
        })
      }
    }

    res.json({ sections: Array.from(sectionsMap.values()) })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Server error' })
  }
})

// POST /sections — create section with cells
router.post('/sections', verifyJWT, checkRole(...DIRECTOR_ROLES), async (req, res) => {
  const { warehouse_id, name, category, rows: numRows, shelves, cells, type,
          parent_section_id } = req.body
  if (!warehouse_id || !name || !category) return res.status(400).json({ error: 'Missing fields' })

  const client = await db.getClient()
  try {
    await client.query('BEGIN')

    const { rows: sec } = await client.query(
      `INSERT INTO warehouse_sections
         (warehouse_id, name, category, rows, shelves, type, parent_section_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [warehouse_id, name, category, numRows || 1, shelves || 1,
       type || 'shelf', parent_section_id || null]
    )
    const section = sec[0]

    if (cells && cells.length) {
      const seen = new Set()
      for (const cell of cells) {
        const code = (cell.id || '').trim()
        if (!code || seen.has(code)) continue
        seen.add(code)
        await client.query(
          `INSERT INTO cells (section_id, code, custom_name) VALUES ($1,$2,$3)`,
          [section.id, code, cell.custom || null]
        )
      }
    }

    // Re-read inserted cells so frontend can place a unit immediately.
    const { rows: createdCells } = await client.query(
      `SELECT * FROM cells WHERE section_id = $1 ORDER BY code`,
      [section.id]
    )
    section.cells = createdCells

    await client.query('COMMIT')
    res.status(201).json({ section })
  } catch (err) {
    await client.query('ROLLBACK')
    console.error('Create section error:', err.message, err.detail || '')
    res.status(500).json({ error: err.message || 'Server error' })
  } finally {
    client.release()
  }
})

// POST /sections/:id/cells — create a single empty cell with auto-code.
// Используется каталог-интерфейсом: секция создаётся пустой, каждая
// единица получает свою ячейку в момент добавления.
router.post('/sections/:id/cells', verifyJWT, checkRole(...DIRECTOR_ROLES), async (req, res) => {
  try {
    const { rows: secRows } = await db.query(
      `SELECT id, type FROM warehouse_sections WHERE id = $1`,
      [req.params.id]
    )
    if (!secRows.length) return res.status(404).json({ error: 'Section not found' })
    // code нужен для UNIQUE(section_id, code), но в UI не показывается —
    // просто порядковый номер. На коллизиях увеличиваем.
    const { rows: countRows } = await db.query(
      `SELECT COUNT(*)::int AS n FROM cells WHERE section_id = $1`,
      [req.params.id]
    )
    let next = (countRows[0].n || 0) + 1
    let cell = null
    for (let attempt = 0; attempt < 10 && !cell; attempt++) {
      try {
        const ins = await db.query(
          `INSERT INTO cells (section_id, code) VALUES ($1, $2) RETURNING *`,
          [req.params.id, String(next)]
        )
        cell = ins.rows[0]
      } catch (err) {
        if (err.code === '23505') { next += 1; continue }
        throw err
      }
    }
    if (!cell) return res.status(500).json({ error: 'Could not allocate cell code' })
    res.status(201).json({ cell })
  } catch (err) {
    console.error('POST /sections/:id/cells failed:', err.message)
    res.status(500).json({ error: err.message || 'Server error' })
  }
})

// PUT /cells/:id — rename cell
router.put('/cells/:id', verifyJWT, checkRole(...DIRECTOR_ROLES), async (req, res) => {
  const { custom_name } = req.body
  try {
    const { rows } = await db.query(
      `UPDATE cells SET custom_name=$1 WHERE id=$2 RETURNING *`,
      [custom_name || null, req.params.id]
    )
    if (!rows.length) return res.status(404).json({ error: 'Cell not found' })
    res.json({ cell: rows[0] })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Server error' })
  }
})

// PUT /sections/:id — rename and/or re-categorise a section (inline edit in catalog view).
router.put('/sections/:id', verifyJWT, checkRole(...DIRECTOR_ROLES), async (req, res) => {
  const { name, category } = req.body || {}
  if (name !== undefined && !String(name).trim()) {
    return res.status(400).json({ error: 'name must not be empty' })
  }
  try {
    const { rows } = await db.query(
      `UPDATE warehouse_sections
          SET name     = COALESCE($1, name),
              category = COALESCE($2, category)
        WHERE id = $3
        RETURNING *`,
      [name !== undefined ? String(name).trim() : null,
       category !== undefined ? String(category) : null,
       req.params.id]
    )
    if (!rows.length) return res.status(404).json({ error: 'Section not found' })
    res.json({ section: rows[0] })
  } catch (err) {
    console.error('PUT /sections/:id failed:', err.message)
    res.status(500).json({ error: err.message || 'Server error' })
  }
})

// PUT /sections/:id/layout — update position/size/rotation of a single section.
// Rotation — опциональное поле (миграция 051). Если колонки нет — fallback на
// запрос без rotation чтобы не ломать endpoint на старых БД.
router.put('/sections/:id/layout', verifyJWT, checkRole(...DIRECTOR_ROLES), async (req, res) => {
  const { x_pos, y_pos, width, height, rotation } = req.body || {}
  const rot = Number.isFinite(rotation) ? ((Math.round(rotation) % 360) + 360) % 360 : null
  const params = [
    Number.isFinite(x_pos) ? Math.round(x_pos) : null,
    Number.isFinite(y_pos) ? Math.round(y_pos) : null,
    Number.isFinite(width) ? Math.round(width) : null,
    Number.isFinite(height) ? Math.round(height) : null,
    req.params.id,
  ]
  try {
    let rows
    if (rot !== null) {
      // С rotation
      const r = await db.query(
        `UPDATE warehouse_sections
           SET x_pos    = COALESCE($1, x_pos),
               y_pos    = COALESCE($2, y_pos),
               width    = COALESCE($3, width),
               height   = COALESCE($4, height),
               rotation = $6
         WHERE id = $5 RETURNING *`,
        [...params, rot]
      )
      rows = r.rows
    } else {
      // Без rotation — безопасный запрос без touching этой колонки
      const r = await db.query(
        `UPDATE warehouse_sections
           SET x_pos  = COALESCE($1, x_pos),
               y_pos  = COALESCE($2, y_pos),
               width  = COALESCE($3, width),
               height = COALESCE($4, height)
         WHERE id = $5 RETURNING *`,
        params
      )
      rows = r.rows
    }
    if (!rows.length) return res.status(404).json({ error: 'Section not found' })
    res.json({ section: rows[0] })
  } catch (err) {
    console.error('PUT /sections/:id/layout failed:', err.message, 'body:', req.body)
    res.status(500).json({ error: err.message || 'Server error' })
  }
})

// PUT /sections/layout/bulk — batch update layouts (used for auto-grid fallback)
router.put('/sections/layout/bulk', verifyJWT, checkRole(...DIRECTOR_ROLES), async (req, res) => {
  const { layouts } = req.body || {}
  if (!Array.isArray(layouts)) return res.status(400).json({ error: 'layouts array required' })
  const client = await db.getClient()
  try {
    await client.query('BEGIN')
    for (const L of layouts) {
      if (!L?.id) continue
      await client.query(
        `UPDATE warehouse_sections
           SET x_pos = COALESCE($1, x_pos),
               y_pos = COALESCE($2, y_pos),
               width = COALESCE($3, width),
               height = COALESCE($4, height)
         WHERE id = $5`,
        [
          Number.isFinite(L.x_pos) ? Math.round(L.x_pos) : null,
          Number.isFinite(L.y_pos) ? Math.round(L.y_pos) : null,
          Number.isFinite(L.width) ? Math.round(L.width) : null,
          Number.isFinite(L.height) ? Math.round(L.height) : null,
          L.id,
        ]
      )
    }
    await client.query('COMMIT')
    res.json({ ok: true })
  } catch (err) {
    await client.query('ROLLBACK')
    console.error(err)
    res.status(500).json({ error: err.message || 'Server error' })
  } finally {
    client.release()
  }
})

// PUT /sections/reorder — reorder sections
router.put('/sections/reorder', verifyJWT, checkRole(...DIRECTOR_ROLES), async (req, res) => {
  const { section_ids } = req.body
  if (!Array.isArray(section_ids)) return res.status(400).json({ error: 'section_ids required' })
  try {
    for (let i = 0; i < section_ids.length; i++) {
      await db.query(`UPDATE warehouse_sections SET sort_order=$1 WHERE id=$2`, [i, section_ids[i]])
    }
    res.json({ ok: true })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Server error' })
  }
})

// DELETE /cells/:id — delete cell
router.delete('/cells/:id', verifyJWT, checkRole(...DIRECTOR_ROLES), async (req, res) => {
  try {
    // Check if cell has units
    const { rows: units } = await db.query(
      `SELECT id FROM units WHERE cell_id = $1 AND status != 'written_off' LIMIT 1`,
      [req.params.id]
    )
    if (units.length) return res.status(400).json({ error: 'Cell has units, cannot delete' })

    const { rows } = await db.query(`DELETE FROM cells WHERE id = $1 RETURNING *`, [req.params.id])
    if (!rows.length) return res.status(404).json({ error: 'Cell not found' })
    res.json({ ok: true })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Server error' })
  }
})

// ─── Request Visibility Settings ─────────────────────────────────────────────

// GET /warehouses/request-visibility — get visibility settings
router.get('/request-visibility', verifyJWT, checkRole('warehouse_director', 'warehouse_deputy'), async (req, res) => {
  try {
    // Get all warehouse staff/deputy with their visibility setting
    const { rows } = await db.query(
      `SELECT u.id, u.name, u.role,
              COALESCE(rv.can_see_requests, true) AS can_see_requests
       FROM users u
       LEFT JOIN request_visibility rv ON rv.user_id = u.id
       WHERE u.role IN ('warehouse_deputy', 'warehouse_staff')
         AND u.project_id IS NULL
       ORDER BY u.name`
    )
    res.json({ settings: rows })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Server error' })
  }
})

// PUT /warehouses/request-visibility — update visibility for a user
router.put('/request-visibility', verifyJWT, checkRole('warehouse_director', 'warehouse_deputy'), async (req, res) => {
  const { user_id, can_see_requests } = req.body
  if (!user_id || typeof can_see_requests !== 'boolean') {
    return res.status(400).json({ error: 'Missing user_id or can_see_requests' })
  }
  try {
    await db.query(
      `INSERT INTO request_visibility (user_id, can_see_requests)
       VALUES ($1, $2)
       ON CONFLICT (user_id) DO UPDATE SET can_see_requests = $2`,
      [user_id, can_see_requests]
    )
    res.json({ ok: true })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Server error' })
  }
})

// DELETE /sections/:id — удалить секцию (если нет единиц на её ячейках).
// Удаляет саму секцию + все её ячейки каскадом.
router.delete('/sections/:id', verifyJWT, checkRole(...DIRECTOR_ROLES), async (req, res) => {
  const client = await db.pool.connect()
  try {
    await client.query('BEGIN')

    // Проверка: есть ли на ячейках секции живые единицы.
    const { rows: units } = await client.query(
      `SELECT u.id FROM units u
       JOIN cells c ON c.id = u.cell_id
       WHERE c.section_id = $1 AND u.status != 'written_off'
       LIMIT 1`,
      [req.params.id]
    )
    if (units.length) {
      await client.query('ROLLBACK')
      return res.status(400).json({ error: 'На секции есть единицы — сначала переместите или удалите их' })
    }

    await client.query(`DELETE FROM cells WHERE section_id = $1`, [req.params.id])
    const { rows } = await client.query(
      `DELETE FROM warehouse_sections WHERE id = $1 RETURNING id`,
      [req.params.id]
    )
    if (!rows.length) {
      await client.query('ROLLBACK')
      return res.status(404).json({ error: 'Section not found' })
    }

    await client.query('COMMIT')
    res.json({ ok: true })
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {})
    console.error(err)
    res.status(500).json({ error: err.message || 'Server error' })
  } finally {
    client.release()
  }
})

// DELETE /warehouses/:id — delete warehouse (director/deputy only).
// Каскадно чистит связанные записи, чтобы не падать на FK-ограничениях:
//   units.warehouse_id / units.cell_id → NULL (единицы становятся «без места»)
//   warehouse_sections + cells → удаляются
router.delete('/:id', verifyJWT, checkRole(...DIRECTOR_ROLES), async (req, res) => {
  const client = await db.getClient()
  try {
    await client.query('BEGIN')
    // 1. Открепить единицы от ячеек/складов удаляемого склада.
    await client.query(
      `UPDATE units SET cell_id = NULL
       WHERE cell_id IN (
         SELECT c.id FROM cells c
         JOIN warehouse_sections s ON s.id = c.section_id
         WHERE s.warehouse_id = $1
       )`,
      [req.params.id]
    )
    await client.query(
      `UPDATE units SET warehouse_id = NULL WHERE warehouse_id = $1`,
      [req.params.id]
    )
    // 2. Удалить ячейки и секции.
    await client.query(
      `DELETE FROM cells WHERE section_id IN (
         SELECT id FROM warehouse_sections WHERE warehouse_id = $1
       )`,
      [req.params.id]
    )
    await client.query(
      `DELETE FROM warehouse_sections WHERE warehouse_id = $1`,
      [req.params.id]
    )
    // 3. Сам склад.
    const { rowCount } = await client.query(
      `DELETE FROM warehouses WHERE id = $1`,
      [req.params.id]
    )
    await client.query('COMMIT')
    if (!rowCount) return res.status(404).json({ error: 'Warehouse not found' })
    res.json({ ok: true })
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {})
    console.error('DELETE /warehouses/:id failed:', err.message)
    res.status(500).json({ error: err.message || 'Server error' })
  } finally {
    client.release()
  }
})

module.exports = router
