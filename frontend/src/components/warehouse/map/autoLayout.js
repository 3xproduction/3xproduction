// Auto-place sections in a simple 3-column masonry grid.
// Used when sections have no saved layout yet (all x/y = 0).

const DEFAULTS = {
  shelf:  { w: 460, h: 220 },
  hanger: { w: 500, h: 280 },
  place:  { w: 320, h: 260 },
}

export function defaultSize(type) {
  return DEFAULTS[type] || DEFAULTS.shelf
}

export function autoGridLayout(sections, { cols = 3, gap = 40, padding = 40 } = {}) {
  const colHeights = new Array(cols).fill(padding)
  const colWidth = Math.max(
    ...sections.map(s => (s.width && s.width > 0 ? s.width : defaultSize(s.type).w))
  )

  return sections.map(s => {
    const w = s.width && s.width > 0 ? s.width : defaultSize(s.type).w
    const h = s.height && s.height > 0 ? s.height : defaultSize(s.type).h
    // Pick shortest column.
    let col = 0
    for (let i = 1; i < cols; i++) if (colHeights[i] < colHeights[col]) col = i
    const x = padding + col * (colWidth + gap)
    const y = colHeights[col]
    colHeights[col] = y + h + gap
    return { ...s, x_pos: x, y_pos: y, width: w, height: h }
  })
}
