const router = require('express').Router()
const db     = require('../db')
const { verifyJWT, checkRole } = require('../middleware/auth')

// GET /analytics/warehouse — общая статистика склада.
// Продюсер тоже читает этот endpoint для блоков «Топ категории» и
// «Популярно на складе» на /analytics/producer.
router.get('/warehouse', verifyJWT, checkRole('warehouse_director', 'warehouse_deputy', 'warehouse_staff', 'producer'), async (req, res) => {
  try {
    // Units by category
    const { rows: byCategory } = await db.query(`
      SELECT category,
             COALESCE(SUM(COALESCE(qty, 1)), 0)::int AS total,
             COALESCE(SUM(COALESCE(qty, 1)) FILTER (WHERE status = 'issued'), 0)::int      AS issued,
             COALESCE(SUM(COALESCE(qty, 1)) FILTER (WHERE status = 'on_stock'), 0)::int    AS on_stock,
             COALESCE(SUM(COALESCE(qty, 1)) FILTER (WHERE status = 'overdue'), 0)::int     AS overdue,
             COALESCE(SUM(COALESCE(qty, 1)) FILTER (WHERE status = 'written_off'), 0)::int AS written_off
      FROM units
      WHERE COALESCE(is_admin_stock, false) = false
      GROUP BY category
      ORDER BY total DESC
    `)

    // Overall unit counts
    const { rows: totals } = await db.query(`
      SELECT
        COALESCE(SUM(COALESCE(qty, 1)), 0)::int                                            AS total,
        COALESCE(SUM(COALESCE(qty, 1)) FILTER (WHERE status = 'on_stock'), 0)::int        AS on_stock,
        COALESCE(SUM(COALESCE(qty, 1)) FILTER (WHERE status = 'issued'), 0)::int          AS issued,
        COALESCE(SUM(COALESCE(qty, 1)) FILTER (WHERE status = 'overdue'), 0)::int         AS overdue,
        COALESCE(SUM(COALESCE(qty, 1)) FILTER (WHERE status = 'written_off'), 0)::int     AS written_off,
        COALESCE(SUM(COALESCE(qty, 1)) FILTER (WHERE status = 'pending'), 0)::int         AS pending
      FROM units
      WHERE COALESCE(is_admin_stock, false) = false
    `)

    // Top 10 most requested units
    const { rows: topRequested } = await db.query(`
      SELECT u.id, u.name, u.category, u.serial,
             COUNT(DISTINCT r.id) AS request_count,
             COUNT(DISTINCT i.id) AS issuance_count
      FROM units u
      LEFT JOIN requests r  ON u.id = ANY(r.unit_ids)
      LEFT JOIN issuances i ON u.id = ANY(
        SELECT unnest(r2.unit_ids) FROM requests r2 WHERE r2.id = i.request_id
      )
      GROUP BY u.id
      ORDER BY request_count DESC
      LIMIT 10
    `)

    // Rental activity (rent_deals by month, last 6 months)
    const { rows: rentalActivity } = await db.query(`
      SELECT
        TO_CHAR(created_at, 'YYYY-MM') AS month,
        COUNT(*) FILTER (WHERE type = 'out') AS rented_out,
        COUNT(*) FILTER (WHERE type = 'in')  AS rented_in,
        SUM(price_total) FILTER (WHERE type = 'out') AS revenue
      FROM rent_deals
      WHERE created_at >= NOW() - INTERVAL '6 months'
      GROUP BY month
      ORDER BY month
    `)

    // Issuance dynamics (last 6 months)
    const { rows: issuanceDynamics } = await db.query(`
      SELECT
        TO_CHAR(i.issued_at, 'YYYY-MM') AS month,
        COUNT(*)                          AS issuances,
        COUNT(DISTINCT rt.id)             AS returns,
        COUNT(*) FILTER (
          WHERE i.deadline < COALESCE(rt.returned_at, NOW())
        ) AS overdue_count
      FROM issuances i
      LEFT JOIN returns rt ON rt.issuance_id = i.id
      WHERE i.issued_at >= NOW() - INTERVAL '6 months'
      GROUP BY month
      ORDER BY month
    `)

    // Idle units — on_stock for more than 3 months without any issuance
    const { rows: idleUnits } = await db.query(`
      SELECT u.id, u.name, u.category, u.serial, u.status,
             MAX(h.created_at) AS last_movement
      FROM units u
      LEFT JOIN unit_history h ON h.unit_id = u.id
      WHERE u.status = 'on_stock'
        AND COALESCE(u.is_admin_stock, false) = false
      GROUP BY u.id
      HAVING MAX(h.created_at) < NOW() - INTERVAL '3 months'
          OR MAX(h.created_at) IS NULL
      ORDER BY last_movement ASC NULLS FIRST
      LIMIT 20
    `)

    // Damage stats
    const { rows: damageStats } = await db.query(`
      SELECT
        COUNT(*) FILTER (WHERE condition_notes IS NOT NULL) AS damaged_returns,
        COUNT(*)                                            AS total_returns
      FROM returns
    `)

    // Debt stats
    const { rows: debtStats } = await db.query(`
      SELECT
        COUNT(*) FILTER (WHERE status = 'open') AS open_debts,
        COUNT(*) FILTER (WHERE status = 'closed') AS closed_debts,
        COUNT(*) AS total_debts
      FROM debts
    `)

    // Active rent deals
    const { rows: activeRentDeals } = await db.query(`
      SELECT COUNT(*) FILTER (WHERE status = 'active') AS active,
             COUNT(*) FILTER (WHERE status = 'done')   AS done,
             SUM(price_total) FILTER (WHERE status IN ('active','done') AND type='out') AS total_revenue
      FROM rent_deals
    `)

    // Asset valuation
    const { rows: assetValuation } = await db.query(`
      SELECT
        COALESCE(SUM(valuation * qty) FILTER (WHERE status IN ('on_stock','issued')), 0) AS total_assets_value,
        COALESCE(SUM(valuation * qty) FILTER (WHERE status = 'issued'), 0) AS issued_assets_value
      FROM units
      WHERE valuation IS NOT NULL
        AND COALESCE(is_admin_stock, false) = false
    `)

    res.json({
      totals:           totals[0],
      by_category:      byCategory,
      top_requested:    topRequested,
      rental_activity:  rentalActivity,
      issuance_dynamics: issuanceDynamics,
      idle_units:       idleUnits,
      damage_stats:     damageStats[0],
      rent_summary:     activeRentDeals[0],
      debt_stats:       debtStats[0],
      asset_valuation:  assetValuation[0],
    })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Server error' })
  }
})

// GET /analytics/producer — расширенная аналитика для продюсера.
// Параметры:
//   project_id  — UUID проекта (если задан, ВСЕ блоки фильтруются по нему,
//                 включая аренду/долги/списания/активы/idle, не только выдачи).
//   period_days — '30'|'90'|'all' (default '90'). Применяется к активности
//                 (выдачи, аренда, документы), не к снимкам (активы, idle).
router.get('/producer', verifyJWT, checkRole('producer'), async (req, res) => {
  const { project_id } = req.query
  const periodRaw = req.query.period_days
  const period = periodRaw === 'all' ? null : (parseInt(periodRaw, 10) || 90)
  // Для оконного сравнения «текущий vs предыдущий период».
  const periodInterval = period ? `${period} days` : null

  // Условные WHERE для каждого источника. По units и debts/writeoffs project_id
  // FK напрямую; по rent_deals — через unit_ids → units.project_id; по issuances —
  // через requests.project_id (если задан) или users.project_id (если запрос
  // создан напрямую через walk-in без request).
  const pid = project_id || null

  try {
    // ── Активы (snapshot — без периода) ────────────────────────────────────
    // valued_count показывает, по скольким единицам у нас есть оценка —
    // продюсер должен видеть, что цифра «частичная» если valuation редкий.
    const { rows: assetRows } = await db.query(`
      SELECT
        COUNT(*) FILTER (WHERE status IN ('on_stock','issued'))              AS total_count,
        COUNT(*) FILTER (WHERE status = 'issued')                            AS issued_count,
        COUNT(*) FILTER (WHERE status IN ('on_stock','issued') AND valuation IS NOT NULL) AS valued_count,
        COALESCE(SUM(valuation * qty) FILTER (WHERE status IN ('on_stock','issued')), 0)  AS total_assets_value,
        COALESCE(SUM(valuation * qty) FILTER (WHERE status = 'issued'),               0)  AS issued_assets_value,
        COALESCE(SUM(purchase_price)  FILTER (WHERE purchased = true),                0)  AS purchased_value
      FROM units
      ${pid ? 'WHERE project_id = $1' : ''}
    `, pid ? [pid] : [])
    const asset_valuation = assetRows[0]

    // ── Аренда (rent_deals) ───────────────────────────────────────────────
    // type='out' = мы сдаём наш реквизит (доход), type='in' = мы берём чужой
    // (расход). Раньше «Потрачено» включало только наш OUT — это была выручка,
    // не расход. Теперь честно: spent_in = аренда у партнёров (расход).
    const rentArgs = []
    let rentWhere = `WHERE 1=1`
    if (pid) {
      rentArgs.push(pid)
      rentWhere += ` AND EXISTS (SELECT 1 FROM units u WHERE u.id = ANY(rd.unit_ids) AND u.project_id = $${rentArgs.length})`
    }
    const periodWhereRent = periodInterval
      ? ` AND rd.created_at >= NOW() - INTERVAL '${periodInterval}'`
      : ''
    const { rows: rentRows } = await db.query(`
      SELECT
        COUNT(*) FILTER (WHERE rd.status = 'active')                              AS active,
        COUNT(*) FILTER (WHERE rd.status = 'overdue')                             AS overdue,
        COUNT(*) FILTER (WHERE rd.status = 'done')                                AS done,
        COALESCE(SUM(rd.price_total) FILTER (WHERE rd.type = 'out' AND rd.status != 'cancelled'), 0) AS revenue_out,
        COALESCE(SUM(rd.price_total) FILTER (WHERE rd.type = 'in'  AND rd.status != 'cancelled'), 0) AS spent_in
      FROM rent_deals rd
      ${rentWhere}${periodWhereRent}
    `, rentArgs)
    const rent_summary = rentRows[0]

    // ── Долги (debts) ─────────────────────────────────────────────────────
    const { rows: debtRows } = await db.query(`
      SELECT
        COUNT(*) FILTER (WHERE status = 'open')   AS open_debts,
        COUNT(*) FILTER (WHERE status = 'closed') AS closed_debts
      FROM debts
      ${pid ? 'WHERE project_id = $1' : ''}
    `, pid ? [pid] : [])
    const debt_stats = debtRows[0]

    // ── Списания (writeoffs) ──────────────────────────────────────────────
    const writeoffArgs = pid ? [pid] : []
    const writeoffWhere = pid ? `WHERE w.project_id = $1` : 'WHERE 1=1'
    const writeoffPeriod = periodInterval
      ? ` AND w.created_at >= NOW() - INTERVAL '${periodInterval}'`
      : ''
    const { rows: writeoffRows } = await db.query(`
      SELECT
        COUNT(*) FILTER (WHERE w.kind = 'writeoff') AS writeoffs_count,
        COUNT(*) FILTER (WHERE w.kind = 'debt')     AS legacy_debts_count,
        COALESCE(SUM(u.valuation) FILTER (WHERE w.kind = 'writeoff'), 0) AS writeoffs_value
      FROM writeoffs w
      LEFT JOIN units u ON u.id = w.unit_id
      ${writeoffWhere}${writeoffPeriod}
    `, writeoffArgs)
    const writeoff_stats = writeoffRows[0]

    // ── Покрытие сценария (warehouse_match из последних документов) ───────
    // Если задан project_id — берём последний scenario+kpp; если нет —
    // агрегируем по всем проектам (latest doc per project, then sum).
    let coverageMatched = 0, coverageTotal = 0, coverageProjectsWithDoc = 0
    if (pid) {
      const { rows: cov } = await db.query(`
        SELECT matched_units FROM documents
        WHERE project_id = $1 AND matched_units IS NOT NULL
        ORDER BY version DESC LIMIT 1
      `, [pid])
      const matched = cov[0]?.matched_units || []
      const { rows: tot } = await db.query(`
        SELECT COUNT(DISTINCT LOWER(TRIM(i.name))) AS total
        FROM production_list_items i
        JOIN production_lists l ON l.id = i.list_id
        WHERE l.project_id = $1
      `, [pid])
      coverageMatched = matched.filter(m => m.unit_id).length
      coverageTotal = parseInt(tot[0]?.total || 0, 10)
      coverageProjectsWithDoc = coverageTotal > 0 ? 1 : 0
    } else {
      // Сводное покрытие: по каждому проекту берём latest matched_units
      // и общее число позиций списков, суммируем.
      const { rows } = await db.query(`
        WITH latest_doc AS (
          SELECT DISTINCT ON (project_id) project_id, matched_units
          FROM documents
          WHERE matched_units IS NOT NULL
          ORDER BY project_id, version DESC
        ),
        list_totals AS (
          SELECT l.project_id, COUNT(DISTINCT LOWER(TRIM(i.name))) AS total
          FROM production_lists l
          LEFT JOIN production_list_items i ON i.list_id = l.id
          GROUP BY l.project_id
        )
        SELECT
          ld.project_id, ld.matched_units, COALESCE(lt.total, 0) AS total
        FROM latest_doc ld
        LEFT JOIN list_totals lt ON lt.project_id = ld.project_id
      `)
      for (const r of rows) {
        const matched = (r.matched_units || []).filter(m => m.unit_id).length
        const total = parseInt(r.total || 0, 10)
        if (total > 0) {
          coverageMatched += matched
          coverageTotal += total
          coverageProjectsWithDoc += 1
        }
      }
    }
    const coverage = {
      matched: coverageMatched,
      total: coverageTotal,
      unmatched: Math.max(coverageTotal - coverageMatched, 0),
      projects_with_doc: coverageProjectsWithDoc,
    }

    // ── Бюджет по категориям (взвешенный по valuation, не по rent_deals) ──
    // Старый расчёт делил price_total пополам между unit_ids — давал
    // искажённую картину (камера и штатив получали поровну). Теперь:
    // факт инвестиций = valuation*qty собственных единиц по категориям +
    // SUM(rent_deals.price_total) пропорционально valuation в рамках сделки.
    const budgetArgs = []
    const budgetPidWhere = pid
      ? (() => { budgetArgs.push(pid); return ` AND u.project_id = $${budgetArgs.length}` })()
      : ''
    const { rows: budgetByCategory } = await db.query(`
      SELECT u.category,
             COALESCE(SUM(u.valuation * u.qty), 0) AS owned_value,
             COUNT(*)                              AS owned_count
      FROM units u
      WHERE u.status IN ('on_stock','issued')
        AND u.valuation IS NOT NULL
        ${budgetPidWhere}
      GROUP BY u.category
      ORDER BY owned_value DESC
    `, budgetArgs)

    // ── Сравнение проектов (existing — на странице рисуется bar-chart) ───
    const { rows: projectComparison } = await db.query(`
      SELECT
        p.id, p.name,
        COUNT(DISTINCT r.id)        AS requests,
        COUNT(DISTINCT i.id)        AS issuances,
        COUNT(DISTINCT u_ids)       AS unique_units,
        COALESCE(SUM(rd.price_total) FILTER (WHERE rd.type = 'in' AND rd.status != 'cancelled'), 0) AS rent_in_total,
        COUNT(DISTINCT d.id) FILTER (WHERE d.status = 'open') AS open_debts
      FROM projects p
      LEFT JOIN requests r  ON r.project_id  = p.id
      LEFT JOIN issuances i ON i.request_id  = r.id
      LEFT JOIN LATERAL unnest(r.unit_ids) AS u_ids ON TRUE
      LEFT JOIN debts d ON d.project_id = p.id
      LEFT JOIN rent_deals rd ON EXISTS (
        SELECT 1 FROM units u
        WHERE u.id = ANY(rd.unit_ids) AND u.project_id = p.id
      )
      GROUP BY p.id
      ORDER BY requests DESC NULLS LAST
    `)

    // ── Месячная нагрузка (выдачи + активные пользователи) ────────────────
    // Через requests.project_id, не через users.project_id — корректно для
    // продюсеров, у которых получатели работают на нескольких проектах.
    const monthlyArgs = []
    const monthlyWhere = []
    if (pid) {
      monthlyArgs.push(pid)
      monthlyWhere.push(`r.project_id = $${monthlyArgs.length}`)
    }
    if (periodInterval) {
      monthlyWhere.push(`i.issued_at >= NOW() - INTERVAL '${periodInterval}'`)
    } else {
      monthlyWhere.push(`i.issued_at >= NOW() - INTERVAL '12 months'`)
    }
    const { rows: monthlyLoad } = await db.query(`
      SELECT
        TO_CHAR(i.issued_at, 'YYYY-MM') AS month,
        COUNT(*)                          AS issuances,
        COUNT(DISTINCT i.received_by)     AS active_users
      FROM issuances i
      LEFT JOIN requests r ON r.id = i.request_id
      WHERE ${monthlyWhere.join(' AND ')}
      GROUP BY month
      ORDER BY month
    `, monthlyArgs)

    // ── Категории, наиболее востребованные ────────────────────────────────
    const { rows: categoryLoad } = await db.query(`
      SELECT u.category,
             COUNT(DISTINCT r.id)  AS request_count,
             COUNT(DISTINCT u.id)  AS unique_units_used
      FROM requests r
      JOIN units u ON u.id = ANY(r.unit_ids)
      ${pid ? 'WHERE r.project_id = $1' : ''}
      GROUP BY u.category
      ORDER BY request_count DESC
      LIMIT 8
    `, pid ? [pid] : [])

    // ── Топ-сотрудники по выдачам (через requests, не users.project_id) ──
    const { rows: topUsers } = await db.query(`
      SELECT usr.id, usr.name, usr.role,
             COUNT(DISTINCT i.id)        AS issuances,
             COUNT(DISTINCT rt.id)       AS returns,
             COUNT(DISTINCT i.id) - COUNT(DISTINCT rt.id) AS currently_holding
      FROM issuances i
      JOIN users usr ON usr.id = i.received_by
      LEFT JOIN requests r ON r.id = i.request_id
      LEFT JOIN returns rt ON rt.issuance_id = i.id
      ${pid ? 'WHERE r.project_id = $1' : ''}
      GROUP BY usr.id
      ORDER BY issuances DESC
      LIMIT 10
    `, pid ? [pid] : [])

    // ── Документы — свежесть по проектам (для риска «КПП устарел») ────────
    const { rows: documentStats } = await db.query(`
      SELECT p.id AS project_id, p.name AS project_name,
             MAX(d.created_at) FILTER (WHERE d.type = 'kpp')       AS kpp_last,
             MAX(d.created_at) FILTER (WHERE d.type = 'scenario')  AS scenario_last,
             MAX(d.created_at) FILTER (WHERE d.type = 'callsheet') AS callsheet_last,
             COUNT(*) FILTER (WHERE d.type = 'kpp')                AS kpp_versions,
             COUNT(*) FILTER (WHERE d.type = 'scenario')           AS scenario_versions
      FROM projects p
      LEFT JOIN documents d ON d.project_id = p.id
      ${pid ? 'WHERE p.id = $1' : ''}
      GROUP BY p.id
      ORDER BY GREATEST(
        COALESCE(MAX(d.created_at) FILTER (WHERE d.type = 'kpp'),       'epoch'),
        COALESCE(MAX(d.created_at) FILTER (WHERE d.type = 'scenario'),  'epoch')
      ) DESC NULLS LAST
    `, pid ? [pid] : [])

    // ── Idle units: лежат ≥3 месяцев без движений, опц. фильтр по проекту ─
    const { rows: idleUnits } = await db.query(`
      SELECT u.id, u.name, u.category, u.serial, u.valuation,
             MAX(h.created_at) AS last_movement
      FROM units u
      LEFT JOIN unit_history h ON h.unit_id = u.id
      WHERE u.status = 'on_stock'
        ${pid ? 'AND u.project_id = $1' : ''}
      GROUP BY u.id
      HAVING MAX(h.created_at) < NOW() - INTERVAL '3 months'
          OR MAX(h.created_at) IS NULL
      ORDER BY last_movement ASC NULLS FIRST
      LIMIT 12
    `, pid ? [pid] : [])
    const idleValueRow = await db.query(`
      SELECT COALESCE(SUM(t.valuation), 0) AS idle_value, COUNT(*) AS idle_count
      FROM (
        SELECT u.id, u.valuation
        FROM units u
        LEFT JOIN unit_history h ON h.unit_id = u.id
        WHERE u.status = 'on_stock' ${pid ? 'AND u.project_id = $1' : ''}
        GROUP BY u.id
        HAVING MAX(h.created_at) < NOW() - INTERVAL '3 months'
            OR MAX(h.created_at) IS NULL
      ) t
    `, pid ? [pid] : [])

    // ── Period compare: текущий период vs предыдущий ──────────────────────
    let period_compare = null
    if (periodInterval) {
      const cmpArgs = []
      const cmpUnitsPid = pid
        ? (() => { cmpArgs.push(pid); return ` AND EXISTS (SELECT 1 FROM units u WHERE u.id = ANY(rd.unit_ids) AND u.project_id = $${cmpArgs.length})` })()
        : ''
      const reqArgs = pid ? [pid] : []
      const cmpReqWhere = pid ? `WHERE r.project_id = $1` : ''

      const [{ rows: rentCur }, { rows: rentPrev }, { rows: reqCur }, { rows: reqPrev }] = await Promise.all([
        db.query(`
          SELECT COALESCE(SUM(rd.price_total), 0) AS spent
          FROM rent_deals rd
          WHERE rd.type = 'in' AND rd.status != 'cancelled'
            AND rd.created_at >= NOW() - INTERVAL '${periodInterval}'
            ${cmpUnitsPid}
        `, cmpArgs),
        db.query(`
          SELECT COALESCE(SUM(rd.price_total), 0) AS spent
          FROM rent_deals rd
          WHERE rd.type = 'in' AND rd.status != 'cancelled'
            AND rd.created_at >= NOW() - INTERVAL '${period * 2} days'
            AND rd.created_at <  NOW() - INTERVAL '${periodInterval}'
            ${cmpUnitsPid}
        `, cmpArgs),
        db.query(`
          SELECT COUNT(*) AS cnt FROM requests r
          ${cmpReqWhere}${cmpReqWhere ? ' AND' : 'WHERE'} r.created_at >= NOW() - INTERVAL '${periodInterval}'
        `, reqArgs),
        db.query(`
          SELECT COUNT(*) AS cnt FROM requests r
          ${cmpReqWhere}${cmpReqWhere ? ' AND' : 'WHERE'} r.created_at >= NOW() - INTERVAL '${period * 2} days'
            AND r.created_at <  NOW() - INTERVAL '${periodInterval}'
        `, reqArgs),
      ])
      period_compare = {
        current:  { spent: Number(rentCur[0]?.spent || 0), requests: parseInt(reqCur[0]?.cnt || 0, 10) },
        previous: { spent: Number(rentPrev[0]?.spent || 0), requests: parseInt(reqPrev[0]?.cnt || 0, 10) },
      }
    }

    res.json({
      // Шапка / KPI
      asset_valuation,
      rent_summary,
      debt_stats,
      writeoff_stats,
      coverage,
      period_compare,
      // Карточки
      budget_by_category:  budgetByCategory,
      project_comparison:  projectComparison,
      monthly_load:        monthlyLoad,
      category_load:       categoryLoad,
      top_users:           topUsers,
      document_stats:      documentStats,
      idle_units:          idleUnits,
      idle_summary:        idleValueRow.rows[0] || { idle_value: 0, idle_count: 0 },
      // Метаданные
      meta: {
        project_id: pid,
        period_days: period,
        generated_at: new Date().toISOString(),
      },
    })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Server error' })
  }
})

// GET /analytics/project/:projectId — project-specific analytics for producer
router.get('/project/:projectId', verifyJWT, checkRole('producer', 'project_director'), async (req, res) => {
  const pid = req.params.projectId
  try {
    // 1. Document stats
    const { rows: docStats } = await db.query(`
      SELECT type,
             COUNT(*) AS versions,
             MAX(version) AS latest_version,
             MAX(created_at) AS last_upload
      FROM documents WHERE project_id = $1
      GROUP BY type
    `, [pid])

    // 2. List items by source
    const { rows: itemsBySource } = await db.query(`
      SELECT i.source, COUNT(*) AS count
      FROM production_list_items i
      JOIN production_lists l ON l.id = i.list_id
      WHERE l.project_id = $1
      GROUP BY i.source
    `, [pid])

    // 3. Items by category (list type)
    const { rows: itemsByCategory } = await db.query(`
      SELECT l.type, COUNT(i.id) AS count
      FROM production_lists l
      LEFT JOIN production_list_items i ON i.list_id = l.id
      WHERE l.project_id = $1
      GROUP BY l.type
      ORDER BY count DESC
    `, [pid])

    // 4. Cross-scene items count
    const { rows: crossDocs } = await db.query(`
      SELECT parsed_data FROM documents
      WHERE project_id = $1 AND type = 'scenario' AND parsed_data IS NOT NULL
      ORDER BY version DESC LIMIT 1
    `, [pid])
    const crossScenes = crossDocs[0]?.parsed_data?.cross_scenes || []

    // 5. Team activity
    const { rows: uploaders } = await db.query(`
      SELECT u.name, u.role, COUNT(d.id) AS uploads, MAX(d.created_at) AS last_upload
      FROM documents d
      JOIN users u ON u.id = d.uploaded_by
      WHERE d.project_id = $1
      GROUP BY u.id, u.name, u.role
      ORDER BY uploads DESC
    `, [pid])

    // 6. Manual additions by user
    const { rows: manualAdders } = await db.query(`
      SELECT u.name, u.role, COUNT(i.id) AS manual_items
      FROM production_list_items i
      JOIN production_lists l ON l.id = i.list_id
      JOIN users u ON u.id = l.user_id
      WHERE l.project_id = $1 AND i.source = 'manual'
      GROUP BY u.id, u.name, u.role
      ORDER BY manual_items DESC
      LIMIT 10
    `, [pid])

    // 7. Warehouse match rate
    const { rows: matchData } = await db.query(`
      SELECT matched_units FROM documents
      WHERE project_id = $1 AND matched_units IS NOT NULL
      ORDER BY version DESC LIMIT 1
    `, [pid])
    const matchedUnits = matchData[0]?.matched_units || []

    const { rows: totalItems } = await db.query(`
      SELECT COUNT(DISTINCT LOWER(TRIM(i.name))) AS total
      FROM production_list_items i
      JOIN production_lists l ON l.id = i.list_id
      WHERE l.project_id = $1
    `, [pid])

    // 8. Team members
    const { rows: teamMembers } = await db.query(`
      SELECT id, name, role, created_at FROM users WHERE project_id = $1 ORDER BY name
    `, [pid])

    // 9. Document groups
    const { rows: groupStats } = await db.query(`
      SELECT g.id, g.name, g.sort_order,
             COUNT(d.id) AS doc_count,
             array_agg(DISTINCT d.type) FILTER (WHERE d.type IS NOT NULL) AS doc_types
      FROM document_groups g
      LEFT JOIN documents d ON d.group_id = g.id
      WHERE g.project_id = $1
      GROUP BY g.id, g.name, g.sort_order
      ORDER BY g.sort_order
    `, [pid])

    res.json({
      documents: docStats,
      items_by_source: itemsBySource,
      items_by_category: itemsByCategory,
      cross_scenes: {
        count: crossScenes.length,
        top: crossScenes.sort((a, b) => (b.scenes?.length || 0) - (a.scenes?.length || 0)).slice(0, 5),
      },
      team_uploads: uploaders,
      team_manual: manualAdders,
      warehouse_match: {
        matched: matchedUnits.filter(m => m.unit_id).length,
        total: parseInt(totalItems[0]?.total || 0),
      },
      team: teamMembers,
      groups: groupStats,
    })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Server error' })
  }
})

module.exports = router
