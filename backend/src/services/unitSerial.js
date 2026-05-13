function serialPrefix(category) {
  const prefix = String(category || 'XX')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, 3)
  return prefix || 'XX'
}

async function nextUnitSerial(dbOrClient, category) {
  const prefix = serialPrefix(category)
  await dbOrClient.query(
    `INSERT INTO unit_serial_counters (prefix, next_value)
     VALUES (
       $1,
       (
         SELECT COALESCE(MAX(substring(serial from '^[A-Z0-9]+-([0-9]+)$')::int), 0) + 1
         FROM units
         WHERE serial LIKE $1 || '-%'
       )
     )
     ON CONFLICT (prefix) DO NOTHING`,
    [prefix]
  )

  const { rows } = await dbOrClient.query(
    `UPDATE unit_serial_counters
     SET next_value = next_value + 1
     WHERE prefix = $1
     RETURNING next_value - 1 AS value`,
    [prefix]
  )

  if (!rows.length) throw new Error(`Unable to allocate unit serial for prefix ${prefix}`)
  const value = Number(rows[0].value)
  return `${prefix}-${String(value).padStart(5, '0')}`
}

module.exports = { nextUnitSerial, serialPrefix }
