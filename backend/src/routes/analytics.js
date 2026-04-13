const router = require('express').Router()
const db     = require('../db')
const { verifyJWT, checkRole } = require('../middleware/auth')

// GET /analytics/warehouse — for warehouse_director
router.get('/warehouse', verifyJWT, checkRole('warehouse_director', 'warehouse_deputy', 'warehouse_staff'), async (req, res) => {
  try {
    // Units by category
    const { rows: byCategory } = await db.query(`
      SELECT category, COUNT(*) AS total,
             COUNT(*) FILTER (WHERE status = 'issued')      AS issued,
             COUNT(*) FILTER (WHERE status = 'on_stock')    AS on_stock,
             COUNT(*) FILTER (WHERE status = 'overdue')     AS overdue,
             COUNT(*) FILTER (WHERE status = 'written_off') AS written_off
      FROM units
      GROUP BY category
      ORDER BY total DESC
    `)

    // Overall unit counts
    const { rows: totals } = await db.query(`
      SELECT
        COUNT(*)                                            AS total,
        COUNT(*) FILTER (WHERE status = 'on_stock')        AS on_stock,
        COUNT(*) FILTER (WHERE status = 'issued')          AS issued,
        COUNT(*) FILTER (WHERE status = 'overdue')         AS overdue,
        COUNT(*) FILTER (WHERE status = 'written_off')     AS written_off,
        COUNT(*) FILTER (WHERE status = 'pending')         AS pending
      FROM units
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

// GET /analytics/producer — for producer
router.get('/producer', verifyJWT, checkRole('producer'), async (req, res) => {
  const { project_id } = req.query

  try {
    // Budget by category (from rent_deals where type='out', grouped by unit category)
    const { rows: budgetByCategory } = await db.query(`
      SELECT u.category,
             SUM(rd.price_total / array_length(rd.unit_ids, 1)) AS estimated_cost,
             COUNT(DISTINCT rd.id)                               AS deal_count
      FROM rent_deals rd
      JOIN units u ON u.id = ANY(rd.unit_ids)
      WHERE rd.type = 'out'
        AND rd.status != 'cancelled'
      GROUP BY u.category
      ORDER BY estimated_cost DESC
    `)

    // Per-project expenses comparison
    const { rows: projectComparison } = await db.query(`
      SELECT
        p.id, p.name,
        COUNT(DISTINCT r.id)  AS requests,
        COUNT(DISTINCT i.id)  AS issuances,
        COUNT(DISTINCT u_ids) AS unique_units
      FROM projects p
      LEFT JOIN users usr ON usr.project_id = p.id
      LEFT JOIN requests r ON r.project_id  = p.id
      LEFT JOIN issuances i ON i.received_by = usr.id
      LEFT JOIN LATERAL unnest(r.unit_ids) AS u_ids ON TRUE
      GROUP BY p.id
      ORDER BY requests DESC
    `)

    // Monthly issuance load (all projects or filtered)
    let loadQuery = `
      SELECT
        TO_CHAR(i.issued_at, 'YYYY-MM') AS month,
        COUNT(*)                          AS issuances,
        COUNT(DISTINCT i.received_by)     AS active_users
      FROM issuances i
    `
    const params = []
    if (project_id) {
      loadQuery += ` JOIN users u ON u.id = i.received_by WHERE u.project_id = $1`
      params.push(project_id)
    } else {
      loadQuery += ` WHERE i.issued_at >= NOW() - INTERVAL '6 months'`
    }
    loadQuery += ` GROUP BY month ORDER BY month`
    const { rows: monthlyLoad } = await db.query(loadQuery, params)

    // Most used unit categories (by request count)
    const { rows: categoryLoad } = await db.query(`
      SELECT u.category,
             COUNT(DISTINCT r.id)  AS request_count,
             COUNT(DISTINCT u.id)  AS unique_units_used
      FROM requests r
      JOIN units u ON u.id = ANY(r.unit_ids)
      ${project_id ? 'WHERE r.project_id = $1' : ''}
      GROUP BY u.category
      ORDER BY request_count DESC
    `, project_id ? [project_id] : [])

    // Top users by issuance count (who takes the most props)
    const { rows: topUsers } = await db.query(`
      SELECT u.id, u.name, u.role,
             COUNT(DISTINCT i.id)        AS issuances,
             COUNT(DISTINCT rt.id)       AS returns,
             COUNT(DISTINCT i.id) - COUNT(DISTINCT rt.id) AS currently_holding
      FROM users u
      JOIN issuances i ON i.received_by = u.id
      LEFT JOIN returns rt ON rt.issuance_id = i.id
      ${project_id ? 'WHERE u.project_id = $1' : ''}
      GROUP BY u.id
      ORDER BY issuances DESC
      LIMIT 10
    `, project_id ? [project_id] : [])

    // KPP/Scenario document versions count by project
    const { rows: documentStats } = await db.query(`
      SELECT p.id AS project_id, p.name AS project_name,
             COUNT(*) FILTER (WHERE d.type = 'kpp')       AS kpp_versions,
             COUNT(*) FILTER (WHERE d.type = 'scenario')  AS scenario_versions,
             COUNT(*) FILTER (WHERE d.type = 'callsheet') AS callsheet_versions,
             MAX(d.created_at)                             AS last_upload
      FROM projects p
      LEFT JOIN documents d ON d.project_id = p.id
      GROUP BY p.id
      ORDER BY last_upload DESC NULLS LAST
    `)

    // Asset valuation
    const { rows: assetValuation } = await db.query(`
      SELECT
        COALESCE(SUM(valuation * qty) FILTER (WHERE status IN ('on_stock','issued')), 0) AS total_assets_value,
        COALESCE(SUM(valuation * qty) FILTER (WHERE status = 'issued'), 0) AS issued_assets_value
      FROM units
      WHERE valuation IS NOT NULL
    `)

    res.json({
      budget_by_category:  budgetByCategory,
      project_comparison:  projectComparison,
      monthly_load:        monthlyLoad,
      category_load:       categoryLoad,
      top_users:           topUsers,
      document_stats:      documentStats,
      asset_valuation:     assetValuation[0],
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
