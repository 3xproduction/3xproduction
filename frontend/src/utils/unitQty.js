export function unitQty(item) {
  const raw = item?.unit_qty ?? item?.qty
  const n = Number(raw)
  return Number.isFinite(n) && n > 0 ? n : 1
}

export function sumUnitQty(items) {
  return (items || []).reduce((sum, item) => sum + unitQty(item), 0)
}

export function sumOnStockCellQty(cells) {
  return (cells || []).reduce((sum, cell) => {
    if (!cell?.unit_id || cell.unit_status !== 'on_stock') return sum
    return sum + unitQty(cell)
  }, 0)
}
