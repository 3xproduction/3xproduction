const jwt = require('jsonwebtoken')
const db  = require('../db')

async function verifyJWT(req, res, next) {
  const header = req.headers['x-auth-token'] || req.headers.authorization
  if (!header) return res.status(401).json({ error: 'Unauthorized' })
  const token = header.startsWith('Bearer ') ? header.slice(7) : header
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET)

    // Check actual role from DB to handle role changes
    const { rows } = await db.query(
      `SELECT id, role, project_id FROM users WHERE id = $1`, [payload.id]
    )
    if (!rows.length) return res.status(401).json({ error: 'User not found' })

    // If impersonating, use target user's data but keep track of real user
    if (payload.impersonating) {
      const { rows: target } = await db.query(
        `SELECT id, role, project_id FROM users WHERE id = $1`, [payload.impersonating]
      )
      if (!target.length) return res.status(401).json({ error: 'Impersonated user not found' })
      req.user = { id: target[0].id, role: target[0].role, project_id: target[0].project_id, impersonator_id: rows[0].id }
    } else {
      req.user = { id: rows[0].id, role: rows[0].role, project_id: rows[0].project_id }
    }
    next()
  } catch (err) {
    if (err.name === 'JsonWebTokenError' || err.name === 'TokenExpiredError') {
      return res.status(401).json({ error: 'Invalid token' })
    }
    return res.status(500).json({ error: 'Server error' })
  }
}

function checkRole(...roles) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Unauthorized' })
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'Forbidden' })
    }
    next()
  }
}

module.exports = { verifyJWT, checkRole }
