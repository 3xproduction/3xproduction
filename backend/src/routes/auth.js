const router  = require('express').Router()
const bcrypt  = require('bcrypt')
const jwt     = require('jsonwebtoken')
const crypto  = require('crypto')
const db      = require('../db')
const { sendEmail } = require('../services/resend')

const SALT_ROUNDS = 12
const CODE_TTL_MIN = 15
const MAX_CODES_PER_HOUR = 5

// POST /auth/register  — only via invite token
router.post('/register', async (req, res) => {
  const { token, name, email, password } = req.body
  if (!token || !name || !email || !password) {
    return res.status(400).json({ error: 'Missing fields' })
  }

  try {
    // Validate invite
    const { rows: invites } = await db.query(
      `SELECT * FROM invites WHERE token = $1 AND used = FALSE`, [token]
    )
    if (!invites.length) return res.status(400).json({ error: 'Invalid or used invite' })
    const invite = invites[0]

    // Check email not taken
    const { rows: existing } = await db.query(
      `SELECT id FROM users WHERE email = $1`, [email]
    )
    if (existing.length) return res.status(400).json({ error: 'Email already registered' })

    const password_hash = await bcrypt.hash(password, SALT_ROUNDS)

    // Create user
    const { rows } = await db.query(
      `INSERT INTO users (name, email, password_hash, role, project_id, warehouse_zone)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id, name, email, role, project_id`,
      [name, email, password_hash, invite.role, invite.project_id, invite.warehouse_zone]
    )
    const user = rows[0]

    // Mark invite used
    await db.query(`UPDATE invites SET used = TRUE WHERE id = $1`, [invite.id])

    const jwtToken = jwt.sign(
      { id: user.id, role: user.role, project_id: user.project_id },
      process.env.JWT_SECRET,
      { expiresIn: '30d' }
    )

    res.json({ token: jwtToken, user })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Server error' })
  }
})

// POST /auth/login
router.post('/login', async (req, res) => {
  const { email, password } = req.body
  if (!email || !password) return res.status(400).json({ error: 'Missing fields' })

  try {
    const { rows } = await db.query(
      `SELECT * FROM users WHERE email = $1`, [email]
    )
    if (!rows.length) return res.status(401).json({ error: 'Invalid credentials' })
    const user = rows[0]

    const match = await bcrypt.compare(password, user.password_hash)
    if (!match) return res.status(401).json({ error: 'Invalid credentials' })

    const token = jwt.sign(
      { id: user.id, role: user.role, project_id: user.project_id },
      process.env.JWT_SECRET,
      { expiresIn: '30d' }
    )

    res.json({
      token,
      user: { id: user.id, name: user.name, email: user.email, role: user.role, project_id: user.project_id, phone: user.phone },
    })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Server error' })
  }
})

// POST /auth/recover/request
router.post('/recover/request', async (req, res) => {
  const { email } = req.body
  if (!email) return res.status(400).json({ error: 'Missing email' })

  try {
    const { rows } = await db.query(`SELECT id FROM users WHERE email = $1`, [email])
    // Always return 200 to not leak user existence
    if (!rows.length) return res.json({ ok: true })

    // Rate limit: max N codes per hour per email
    const { rows: recent } = await db.query(
      `SELECT COUNT(*) AS cnt FROM recover_codes WHERE email = $1 AND created_at > NOW() - INTERVAL '1 hour'`,
      [email]
    )
    if (Number(recent[0].cnt) >= MAX_CODES_PER_HOUR) return res.json({ ok: true })

    const code = String(Math.floor(100000 + Math.random() * 900000))
    const expires_at = new Date(Date.now() + CODE_TTL_MIN * 60 * 1000)

    await db.query(
      `INSERT INTO recover_codes (email, code, expires_at) VALUES ($1, $2, $3)`,
      [email, code, expires_at]
    )

    await sendEmail({
      to: email,
      subject: 'Код восстановления пароля — 3XMedia Production',
      html: `
        <p>Ваш код восстановления пароля:</p>
        <h2 style="letter-spacing:8px;font-size:32px;">${code}</h2>
        <p>Код действителен ${CODE_TTL_MIN} минут.</p>
        <p>Если вы не запрашивали восстановление — проигнорируйте это письмо.</p>
      `,
    })

    res.json({ ok: true })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Server error' })
  }
})

// POST /auth/recover/verify
router.post('/recover/verify', async (req, res) => {
  const { email, code } = req.body
  if (!email || !code) return res.status(400).json({ error: 'Missing fields' })

  try {
    const { rows } = await db.query(
      `SELECT * FROM recover_codes
       WHERE email = $1 AND code = $2 AND used = FALSE AND expires_at > NOW()
       ORDER BY created_at DESC LIMIT 1`,
      [email, code]
    )
    if (!rows.length) return res.status(400).json({ error: 'Invalid or expired code' })

    res.json({ ok: true })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Server error' })
  }
})

// POST /auth/recover/reset
router.post('/recover/reset', async (req, res) => {
  const { email, code, password } = req.body
  if (!email || !code || !password) return res.status(400).json({ error: 'Missing fields' })
  if (password.length < 6) return res.status(400).json({ error: 'Password too short' })

  try {
    const { rows } = await db.query(
      `SELECT * FROM recover_codes
       WHERE email = $1 AND code = $2 AND used = FALSE AND expires_at > NOW()
       ORDER BY created_at DESC LIMIT 1`,
      [email, code]
    )
    if (!rows.length) return res.status(400).json({ error: 'Invalid or expired code' })

    const password_hash = await bcrypt.hash(password, SALT_ROUNDS)
    await db.query(`UPDATE users SET password_hash = $1 WHERE email = $2`, [password_hash, email])
    await db.query(`UPDATE recover_codes SET used = TRUE WHERE email = $1 AND used = FALSE`, [email])

    res.json({ ok: true })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Server error' })
  }
})

// POST /auth/seed-test — create test accounts for all roles (idempotent, skips existing)
// Temporarily allow in production for initial setup (protected by secret header)
router.post('/seed-test', (req, res, next) => {
  if (process.env.NODE_ENV === 'production' && req.headers['x-seed-key'] !== process.env.JWT_SECRET) {
    return res.status(404).json({ error: 'Not found' })
  }
  next()
}, async (req, res) => {
  try {
    const password = 'Test1234'
    const hash = await bcrypt.hash(password, SALT_ROUNDS)

    // Ensure test project exists
    let projectId
    const { rows: existingProjects } = await db.query(
      `SELECT id FROM projects WHERE name = $1 LIMIT 1`, ['Тестовый проект']
    )
    if (existingProjects.length) {
      projectId = existingProjects[0].id
    } else {
      const { rows: newProject } = await db.query(
        `INSERT INTO projects (name) VALUES ($1) RETURNING id`, ['Тестовый проект']
      )
      projectId = newProject[0].id
    }

    const testUsers = [
      { email: 'test.warehouse_director@3x.test',  name: 'Павел Геелев',       role: 'warehouse_director',  project_id: null },
      { email: 'test.project_director@3x.test',   name: 'Иван Сидоров',      role: 'project_director',    project_id: projectId },
      { email: 'test.producer@3x.test',           name: 'Мария Смирнова',    role: 'producer',            project_id: null },
      { email: 'test.warehouse_deputy@3x.test',   name: 'Алексей Попов',     role: 'warehouse_deputy',    project_id: null },
      { email: 'test.warehouse_staff@3x.test',    name: 'Дмитрий Козлов',    role: 'warehouse_staff',     project_id: null },
      { email: 'test.production_designer@3x.test',name: 'Анна Новикова',     role: 'production_designer', project_id: projectId },
      { email: 'test.props_master@3x.test',       name: 'Сергей Морозов',    role: 'props_master',        project_id: projectId },
      { email: 'test.costumer@3x.test',           name: 'Елена Волкова',     role: 'costumer',            project_id: projectId },
    ]

    const results = []
    for (const u of testUsers) {
      const { rows: existing } = await db.query(`SELECT id FROM users WHERE email=$1`, [u.email])
      if (existing.length) {
        results.push({ email: u.email, role: u.role, status: 'already_exists' })
        continue
      }
      await db.query(
        `INSERT INTO users (name, email, password_hash, role, project_id) VALUES ($1,$2,$3,$4,$5)`,
        [u.name, u.email, hash, u.role, u.project_id]
      )
      results.push({ email: u.email, role: u.role, name: u.name, status: 'created' })
    }

    res.json({ password, project_id: projectId, users: results })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Server error' })
  }
})

// POST /auth/seed-units — seed 10 units + 2 acts (idempotent)
router.post('/seed-units', (req, res, next) => {
  if (process.env.NODE_ENV === 'production') return res.status(404).json({ error: 'Not found' })
  next()
}, async (req, res) => {
  try {
    const { rows: directors } = await db.query(
      `SELECT id FROM users WHERE email = $1`, ['test.warehouse_director@3x.test']
    )
    if (!directors.length) return res.status(400).json({ error: 'Run /auth/seed-test first' })
    const directorId = directors[0].id

    const { rows: staffRows } = await db.query(
      `SELECT id FROM users WHERE email = $1`, ['test.warehouse_staff@3x.test']
    )
    const staffId = staffRows[0]?.id

    const { rows: whs } = await db.query(`SELECT id FROM warehouses LIMIT 1`)
    if (!whs.length) return res.status(400).json({ error: 'No warehouses found' })
    const warehouseId = whs[0].id

    const seedUnits = [
      { name: 'Пистолет Беретта 92',         category: 'props',    serial: 'SED-WPN-01', condition: 'Хорошее',           qty: 2 },
      { name: 'Телефон Nokia 3310',           category: 'props',    serial: 'SED-ELC-01', condition: 'Хорошее',           qty: 1 },
      { name: 'Чемодан кожаный коричневый',   category: 'props',    serial: 'SED-BAG-01', condition: 'Удовлетворительное', qty: 1 },
      { name: 'Портфель деловой чёрный',      category: 'props',    serial: 'SED-BAG-02', condition: 'Хорошее',           qty: 3 },
      { name: 'Бутылка вина (бутафория)',     category: 'dummy',    serial: 'SED-DUM-01', condition: 'Отличное',          qty: 6 },
      { name: 'Пачка денег (бутафория)',      category: 'dummy',    serial: 'SED-DUM-02', condition: 'Отличное',          qty: 4 },
      { name: 'Ваза декоративная белая',      category: 'art_fill', serial: 'SED-ART-01', condition: 'Хорошее',           qty: 1 },
      { name: 'Картина масло 60x80',          category: 'art_fill', serial: 'SED-ART-02', condition: 'Хорошее',           qty: 1 },
      { name: 'Ковёр восточный 2x3 м',        category: 'art_fill', serial: 'SED-ART-03', condition: 'Удовлетворительное', qty: 1 },
      { name: 'Автомобиль BMW E39 (реквизит)', category: 'auto',    serial: 'SED-CAR-01', condition: 'Рабочее',           qty: 1 },
    ]

    const results = []
    const createdIds = []
    for (const u of seedUnits) {
      const { rows: ex } = await db.query(`SELECT id FROM units WHERE serial=$1`, [u.serial])
      if (ex.length) { results.push({ ...u, status: 'already_exists' }); createdIds.push(ex[0].id); continue }
      const { rows } = await db.query(
        `INSERT INTO units (name,category,serial,warehouse_id,condition,qty,status)
         VALUES ($1,$2,$3,$4,$5,$6,'on_stock') RETURNING id`,
        [u.name, u.category, u.serial, warehouseId, u.condition, u.qty]
      )
      createdIds.push(rows[0].id)
      results.push({ ...u, id: rows[0].id, status: 'created' })
    }

    // Seed acts
    const actResults = []
    if (createdIds.length >= 4 && staffId) {
      const deadline1 = new Date(); deadline1.setDate(deadline1.getDate() + 30)
      const { rows: ex1 } = await db.query(
        `SELECT id FROM requests WHERE notes='seed-act-issue' LIMIT 1`
      )
      let req1Id
      if (!ex1.length) {
        const { rows: r1 } = await db.query(
          `INSERT INTO requests (unit_ids, project_id, status, notes)
           VALUES ($1, null, 'issued', 'seed-act-issue') RETURNING id`,
          [[createdIds[0], createdIds[1]]]
        )
        req1Id = r1[0].id
        const { rows: i1 } = await db.query(
          `INSERT INTO issuances (request_id, issued_by, received_by, deadline)
           VALUES ($1,$2,$3,$4) RETURNING id`,
          [req1Id, directorId, staffId, deadline1.toISOString()]
        )
        for (const uid of [createdIds[0], createdIds[1]]) {
          await db.query(`UPDATE units SET status='issued' WHERE id=$1`, [uid])
          await db.query(`INSERT INTO unit_history(unit_id,action,user_id) VALUES($1,'Выдано',$2)`, [uid, directorId])
        }
        actResults.push({ type: 'issue', issuance_id: i1[0].id, status: 'created' })
      } else {
        actResults.push({ type: 'issue', status: 'already_exists' })
      }

      const { rows: ex2 } = await db.query(
        `SELECT id FROM requests WHERE notes='seed-act-return' LIMIT 1`
      )
      if (!ex2.length) {
        const { rows: r2 } = await db.query(
          `INSERT INTO requests (unit_ids, project_id, status, notes)
           VALUES ($1, null, 'issued', 'seed-act-return') RETURNING id`,
          [[createdIds[2], createdIds[3]]]
        )
        const deadline2 = new Date(); deadline2.setDate(deadline2.getDate() - 5)
        const { rows: i2 } = await db.query(
          `INSERT INTO issuances (request_id, issued_by, received_by, deadline)
           VALUES ($1,$2,$3,$4) RETURNING id`,
          [r2[0].id, directorId, staffId, deadline2.toISOString()]
        )
        const { rows: ret } = await db.query(
          `INSERT INTO returns (issuance_id, returned_by, accepted_by, condition_notes)
           VALUES ($1,$2,$3,'Состояние хорошее') RETURNING id`,
          [i2[0].id, staffId, directorId]
        )
        for (const uid of [createdIds[2], createdIds[3]]) {
          await db.query(`INSERT INTO unit_history(unit_id,action,user_id) VALUES($1,'Выдано',$2)`, [uid, directorId])
          await db.query(`INSERT INTO unit_history(unit_id,action,user_id) VALUES($1,'Возврат',$2)`, [uid, directorId])
        }
        actResults.push({ type: 'return', return_id: ret[0].id, status: 'created' })
      } else {
        actResults.push({ type: 'return', status: 'already_exists' })
      }
    }

    res.json({ units: results, acts: actResults })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Server error' })
  }
})

// PATCH /auth/password — change own password
const { verifyJWT, checkRole } = require('../middleware/auth')
router.patch('/password', verifyJWT, async (req, res) => {
  const { current, next } = req.body
  if (!current || !next) return res.status(400).json({ error: 'Missing fields' })
  if (next.length < 6) return res.status(400).json({ error: 'Password too short' })
  try {
    const { rows } = await db.query(`SELECT password_hash FROM users WHERE id=$1`, [req.user.id])
    if (!rows.length) return res.status(404).json({ error: 'User not found' })
    const match = await bcrypt.compare(current, rows[0].password_hash)
    if (!match) return res.status(400).json({ error: 'Текущий пароль неверный' })
    const password_hash = await bcrypt.hash(next, SALT_ROUNDS)
    await db.query(`UPDATE users SET password_hash=$1 WHERE id=$2`, [password_hash, req.user.id])
    res.json({ ok: true })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Server error' })
  }
})

// PATCH /auth/name — update own name
router.patch('/name', verifyJWT, async (req, res) => {
  const { name } = req.body
  if (!name?.trim()) return res.status(400).json({ error: 'Missing name' })
  try {
    await db.query(`UPDATE users SET name=$1 WHERE id=$2`, [name.trim(), req.user.id])
    res.json({ ok: true, name: name.trim() })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Server error' })
  }
})

// PATCH /auth/phone — update own phone
router.patch('/phone', verifyJWT, async (req, res) => {
  const { phone } = req.body
  if (!phone?.trim()) return res.status(400).json({ error: 'Missing phone' })
  try {
    await db.query(`UPDATE users SET phone=$1 WHERE id=$2`, [phone.trim(), req.user.id])
    res.json({ ok: true, phone: phone.trim() })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Server error' })
  }
})

// GET /auth/users — list all users (producer only)
router.get('/users', verifyJWT, checkRole('producer'), async (req, res) => {
  try {
    const { rows } = await db.query(`
      SELECT u.id, u.name, u.email, u.role, p.name AS project_name
      FROM users u
      LEFT JOIN projects p ON p.id = u.project_id
      ORDER BY u.role, u.name
    `)
    res.json({ users: rows })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Server error' })
  }
})

// POST /auth/impersonate — producer switches to another user's view
router.post('/impersonate', verifyJWT, checkRole('producer'), async (req, res) => {
  const { user_id } = req.body
  if (!user_id) return res.status(400).json({ error: 'Missing user_id' })

  try {
    const { rows } = await db.query(
      `SELECT id, name, email, role, project_id FROM users WHERE id = $1`, [user_id]
    )
    if (!rows.length) return res.status(404).json({ error: 'User not found' })
    const target = rows[0]

    const token = jwt.sign(
      { id: req.user.id, role: 'producer', impersonating: target.id },
      process.env.JWT_SECRET,
      { expiresIn: '4h' }
    )

    res.json({ token, user: { id: target.id, name: target.name, email: target.email, role: target.role, project_id: target.project_id } })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Server error' })
  }
})

module.exports = router
