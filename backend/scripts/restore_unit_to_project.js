// Одноразовый скрипт: вернуть единицу «Пневматический пистолет-пулемёт с глушителем»
// обратно на склад проекта «Наш Спецназ 4 сезон» (она была случайно отправлена на общий склад
// прямой кнопкой «Вернуть», которая была переработана в двухэтапный поток).

const { Pool } = require('pg')

const DATABASE_URL = process.env.DATABASE_URL
if (!DATABASE_URL) {
  console.error('DATABASE_URL не задан')
  process.exit(1)
}

const pool = new Pool({ connectionString: DATABASE_URL })

;(async () => {
  try {
    const { rows: proj } = await pool.query(
      `SELECT id, name FROM projects WHERE name ILIKE '%спецназ%' LIMIT 1`
    )
    if (!proj.length) { console.error('Проект не найден'); process.exit(1) }
    console.log('Проект:', proj[0])

    const { rows: units } = await pool.query(
      `SELECT id, name, is_project_kept, project_id, warehouse_id
       FROM units
       WHERE name ILIKE '%пневмат%пулемет%глушител%'
          OR name ILIKE '%пневматический пистолет-пулемет%'`
    )
    console.log('Найдено:', units.length, units.map(u => ({ id: u.id, name: u.name, project_id: u.project_id, wh: u.warehouse_id, kept: u.is_project_kept })))

    for (const u of units) {
      await pool.query(
        `UPDATE units SET is_project_kept=true, project_id=$2,
                           warehouse_id=NULL, cell_id=NULL, pavilion_id=NULL
         WHERE id=$1`,
        [u.id, proj[0].id]
      )
      await pool.query(
        `INSERT INTO unit_history (unit_id, action, user_id, notes)
         VALUES ($1, 'Возвращено на склад проекта (ручное восстановление)', NULL, NULL)`,
        [u.id]
      )
      console.log('Восстановлено:', u.name)
    }
  } catch (err) {
    console.error(err)
    process.exit(1)
  } finally {
    await pool.end()
  }
})()
