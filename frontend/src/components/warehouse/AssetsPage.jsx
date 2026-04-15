import { useState, useEffect, useRef } from 'react'
import WarehouseLayout from './WarehouseLayout'
import ProductionLayout from '../production/ProductionLayout'
import { units as unitsApi, warehouses as warehousesApi } from '../../services/api'
import { useAuth } from '../../hooks/useAuth'
import { ROLES } from '../../constants/roles'
import { categoryLabel } from '../../constants/categories'

export default function AssetsPage() {
  const { user } = useAuth()
  const [items, setItems] = useState([])
  const [warehouses, setWarehouses] = useState([])
  const [loading, setLoading] = useState(true)
  const [whFilter, setWhFilter] = useState('')
  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const searchTimer = useRef(null)

  useEffect(() => {
    clearTimeout(searchTimer.current)
    searchTimer.current = setTimeout(() => setDebouncedSearch(search), 300)
    return () => clearTimeout(searchTimer.current)
  }, [search])

  useEffect(() => {
    const stockParams = { status: 'on_stock' }
    const issuedParams = { status: 'issued' }
    if (debouncedSearch.trim()) {
      stockParams.search = debouncedSearch.trim()
      issuedParams.search = debouncedSearch.trim()
    }
    let cancelled = false
    setLoading(true) // eslint-disable-line react-hooks/set-state-in-effect
    Promise.all([
      unitsApi.list(stockParams),
      unitsApi.list(issuedParams),
      warehousesApi.list(),
    ]).then(([stock, issued, wh]) => {
      if (cancelled) return
      setItems([...(stock.units || []), ...(issued.units || [])])
      setWarehouses(wh.warehouses || [])
    }).finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [debouncedSearch])

  const filtered = items.filter(u => {
    if (whFilter && String(u.warehouse_id) !== whFilter) return false
    return true
  })

  const totalValue = filtered.reduce((s, u) => s + (Number(u.valuation) || 0) * (u.qty || 1), 0)
  const issuedValue = filtered.filter(u => u.status === 'issued').reduce((s, u) => s + (Number(u.valuation) || 0) * (u.qty || 1), 0)

  const Layout = ROLES[user?.role]?.world === 'production' ? ProductionLayout : WarehouseLayout

  return (
    <Layout>
      <div style={{ padding: '24px 32px', maxWidth: 960 }}>
        <h1 style={{ fontSize: 20, fontWeight: 600, marginBottom: 4 }}>Активы</h1>
        <p style={{ color: 'var(--muted)', fontSize: 13, marginBottom: 20 }}>Стоимость имущества на складе</p>

        <div style={{ display: 'flex', gap: 12, marginBottom: 24, flexWrap: 'wrap' }}>
          <div style={{ background: 'var(--white)', border: '1px solid var(--border)', borderRadius: 'var(--radius-card)', padding: 16, flex: 1, minWidth: 180 }}>
            <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 4 }}>Наши активы</div>
            <div style={{ fontSize: 22, fontWeight: 700, color: 'var(--blue)' }}>{totalValue.toLocaleString('ru-RU')} ₽</div>
          </div>
          <div style={{ background: 'var(--white)', border: '1px solid var(--border)', borderRadius: 'var(--radius-card)', padding: 16, flex: 1, minWidth: 180 }}>
            <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 4 }}>Выдано проектам</div>
            <div style={{ fontSize: 22, fontWeight: 700, color: 'var(--amber)' }}>{issuedValue.toLocaleString('ru-RU')} ₽</div>
          </div>
        </div>

        <div style={{ display: 'flex', gap: 10, marginBottom: 20, flexWrap: 'wrap' }}>
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Найдите по названию или серийному №..."
            style={{ flex: 1, minWidth: 200, height: 38, padding: '0 12px', border: '1px solid var(--border)', borderRadius: 'var(--radius-btn)', fontSize: 13, outline: 'none' }}
          />
          {warehouses.length > 1 && (
            <select value={whFilter} onChange={e => setWhFilter(e.target.value)} style={{
              height: 38, padding: '0 10px', border: '1px solid var(--border)',
              borderRadius: 'var(--radius-btn)', fontSize: 13, cursor: 'pointer',
            }}>
              <option value="">Выбрать склад</option>
              {warehouses.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
            </select>
          )}
        </div>

        {loading ? (
          <div style={{ color: 'var(--muted)', fontSize: 13, padding: '40px 0', textAlign: 'center' }}>Загрузка...</div>
        ) : filtered.length === 0 ? (
          <div style={{ color: 'var(--muted)', fontSize: 13, padding: '40px 0', textAlign: 'center' }}>Нет активов</div>
        ) : (
          <div style={{ background: 'var(--white)', border: '1px solid var(--border)', borderRadius: 'var(--radius-card)', overflow: 'hidden' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ background: 'var(--bg)', textAlign: 'left' }}>
                  <th style={{ padding: '10px 14px', fontWeight: 500, color: 'var(--muted)' }}>Название</th>
                  <th style={{ padding: '10px 14px', fontWeight: 500, color: 'var(--muted)' }}>Категория</th>
                  <th style={{ padding: '10px 14px', fontWeight: 500, color: 'var(--muted)' }}>Кол-во</th>
                  <th style={{ padding: '10px 14px', fontWeight: 500, color: 'var(--muted)' }}>Стоимость</th>
                  <th style={{ padding: '10px 14px', fontWeight: 500, color: 'var(--muted)' }}>Итого</th>
                  <th style={{ padding: '10px 14px', fontWeight: 500, color: 'var(--muted)' }}>Статус</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(u => (
                  <tr key={u.id} style={{ borderTop: '1px solid var(--border)' }}>
                    <td style={{ padding: '10px 14px', fontWeight: 500 }}>
                      {u.name}
                      {u.serial && <span style={{ color: 'var(--muted)', fontWeight: 400 }}> · {u.serial}</span>}
                    </td>
                    <td style={{ padding: '10px 14px', color: 'var(--muted)' }}>{categoryLabel(u.category)}</td>
                    <td style={{ padding: '10px 14px' }}>{u.qty || 1}</td>
                    <td style={{ padding: '10px 14px' }}>{u.valuation ? `${Number(u.valuation).toLocaleString('ru-RU')} ₽` : '—'}</td>
                    <td style={{ padding: '10px 14px', fontWeight: 600 }}>
                      {u.valuation ? `${(Number(u.valuation) * (u.qty || 1)).toLocaleString('ru-RU')} ₽` : '—'}
                    </td>
                    <td style={{ padding: '10px 14px' }}>
                      <span style={{
                        padding: '2px 8px', borderRadius: 10, fontSize: 11, fontWeight: 500,
                        background: u.status === 'on_stock' ? 'var(--green-dim)' : 'var(--amber-dim)',
                        color: u.status === 'on_stock' ? 'var(--green)' : 'var(--amber)',
                      }}>
                        {u.status === 'on_stock' ? 'На складе' : 'Выдано'}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </Layout>
  )
}
