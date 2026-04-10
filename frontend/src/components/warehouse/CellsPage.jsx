import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import WarehouseLayout from './WarehouseLayout'
import Button from '../shared/Button'
import UnitCardModal from '../shared/UnitCardModal'
import { warehouses as warehousesApi } from '../../services/api'
import { useAuth } from '../../hooks/useAuth'
import { useToast } from '../shared/Toast'

export default function CellsPage() {
  const navigate = useNavigate()
  const { user } = useAuth()
  const toast = useToast()
  const canDeleteWarehouse = ['warehouse_director', 'warehouse_deputy'].includes(user?.role)
  const [warehouseList, setWarehouseList] = useState([])
  const [selWh, setSelWh] = useState('')
  const [sections, setSections] = useState([])
  const [loading, setLoading] = useState(false)
  const [selected, setSelected] = useState(null)
  const [cardId, setCardId] = useState(null)
  const [dragIdx, setDragIdx] = useState(null)

  // Add warehouse modal
  const [showAddWh, setShowAddWh] = useState(false)
  const [newWhName, setNewWhName] = useState('')
  const [addingWh, setAddingWh] = useState(false)

  useEffect(() => {
    warehousesApi.list().then(d => {
      const whs = d.warehouses || []
      setWarehouseList(whs)
      if (whs.length) setSelWh(String(whs[0].id))
    })
  }, [])

  useEffect(() => {
    if (!selWh) return
    setLoading(true)
    warehousesApi.cells(selWh)
      .then(d => setSections(d.sections || []))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [selWh])

  async function handleAddWarehouse() {
    if (!newWhName.trim()) return
    setAddingWh(true)
    try {
      const data = await warehousesApi.create({ name: newWhName.trim() })
      const wh = data.warehouse
      setWarehouseList(prev => [...prev, wh])
      setSelWh(String(wh.id))
      setShowAddWh(false)
      setNewWhName('')
      toast?.(`Склад "${wh.name}" создан`, 'success')
    } catch (e) {
      toast?.(e.message || 'Ошибка создания склада', 'error')
    } finally {
      setAddingWh(false)
    }
  }

  const selectedCell = sections.flatMap(s => s.cells || []).find(c => String(c.id) === String(selected))

  return (
    <WarehouseLayout>
      <style>{`
        .cells-page { display: flex; height: 100%; min-height: calc(100vh - 60px); }
        .cells-main { flex: 1; padding: 24px 28px; overflow-y: auto; min-width: 0; }
        .cells-detail { width: 280px; border-left: 1px solid var(--border); background: var(--white); padding: 20px; overflow-y: auto; flex-shrink: 0; }
        @media (max-width: 768px) {
          .cells-page { flex-direction: column; }
          .cells-main { padding: 16px; }
          .cells-detail { display: none; }
          .cells-sheet { display: block !important; }
          .cells-grid { grid-template-columns: repeat(4, 1fr) !important; gap: 6px !important; }
        }
        .wh-chip {
          padding: 8px 18px; border-radius: 20; border: 2px solid var(--border);
          background: var(--white); cursor: pointer; font-size: 13px; font-weight: 500;
          color: var(--text); transition: all 0.15s; white-space: nowrap;
        }
        .wh-chip:hover { border-color: var(--blue); }
        .wh-chip.active { border-color: var(--blue); background: var(--blue-dim); color: var(--blue); font-weight: 600; }
      `}</style>
      <div className="cells-page">
        <div className="cells-main">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20, flexWrap: 'wrap', gap: 10 }}>
            <h1 style={{ fontSize: 20, fontWeight: 600 }}>Места на складе</h1>
            <div style={{ display: 'flex', gap: 8 }}>
              <Button variant="secondary" style={{ height: 36, fontSize: 13 }}
                onClick={() => { setNewWhName(''); setShowAddWh(true) }}>
                + Склад
              </Button>
              <Button variant="secondary" style={{ height: 36, fontSize: 13 }}
                onClick={() => navigate('/cells/constructor')}>
                + Секция
              </Button>
              {canDeleteWarehouse && selWh && (
                <Button variant="secondary" style={{ height: 36, fontSize: 13, color: 'var(--red)' }}
                  onClick={async () => {
                    if (!confirm('Удалить этот склад? Это действие необратимо.')) return
                    try {
                      await warehousesApi.deleteWarehouse(selWh)
                      setWarehouseList(prev => prev.filter(w => String(w.id) !== selWh))
                      setSelWh('')
                      setSections([])
                      toast?.('Склад удалён', 'success')
                    } catch (e) { toast?.(e.message || 'Ошибка', 'error') }
                  }}>
                  Удалить склад
                </Button>
              )}
            </div>
          </div>

          {/* Warehouse chips slider */}
          {warehouseList.length > 0 && (
            <div style={{
              display: 'flex', gap: 8, marginBottom: 20, overflowX: 'auto',
              paddingBottom: 4, scrollbarWidth: 'thin',
            }}>
              {warehouseList.map(w => (
                <button key={w.id}
                  className={`wh-chip ${String(w.id) === selWh ? 'active' : ''}`}
                  onClick={() => setSelWh(String(w.id))}
                  style={{ borderRadius: 20 }}>
                  <span style={{ marginRight: 6 }}>🏪</span>
                  {w.name}
                </button>
              ))}
            </div>
          )}

          {loading && <div style={{ color: 'var(--muted)', fontSize: 14, padding: '40px 0', textAlign: 'center' }}>Загрузка...</div>}

          {sections.map((section, sIdx) => {
            const cells = section.cells || []
            const freeCells = cells.filter(c => !c.unit_id || c.unit_status !== 'on_stock').length
            const totalCells = cells.length
            const occupancyPct = totalCells > 0 ? Math.round(((totalCells - freeCells) / totalCells) * 100) : 0
            return (
              <div key={section.id} style={{ marginBottom: 28 }}
                draggable
                onDragStart={() => setDragIdx(sIdx)}
                onDragOver={e => e.preventDefault()}
                onDrop={() => {
                  if (dragIdx === null || dragIdx === sIdx) return
                  const reordered = [...sections]
                  const [moved] = reordered.splice(dragIdx, 1)
                  reordered.splice(sIdx, 0, moved)
                  setSections(reordered)
                  setDragIdx(null)
                  warehousesApi.reorderSections(reordered.map(s => s.id)).catch(() => {})
                }}
                onDragEnd={() => setDragIdx(null)}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10, cursor: 'grab' }}>
                  <span style={{ color: 'var(--muted)', fontSize: 14 }}>⠿</span>
                  <div style={{ fontWeight: 600, fontSize: 15 }}>{section.name}</div>
                  {section.type === 'hanger' && (
                    <span style={{ padding: '2px 8px', borderRadius: 10, fontSize: 10, fontWeight: 600, background: 'rgba(168,85,247,0.1)', color: '#7c3aed' }}>Вешалка</span>
                  )}
                  <div style={{
                    display: 'flex', alignItems: 'center', gap: 6,
                    padding: '3px 10px', borderRadius: 20,
                    background: occupancyPct > 80 ? 'rgba(239,68,68,0.1)' : occupancyPct > 50 ? 'rgba(234,179,8,0.1)' : 'rgba(34,197,94,0.1)',
                    fontSize: 11, fontWeight: 500,
                    color: occupancyPct > 80 ? 'var(--red)' : occupancyPct > 50 ? '#b45309' : 'var(--green)',
                  }}>
                    {freeCells} свободных / {totalCells}
                  </div>
                  <button onClick={(e) => { e.stopPropagation(); navigate(`/cells/constructor?warehouse=${selWh}&section=${section.id}`) }}
                    style={{ background: 'none', border: '1px solid var(--border)', borderRadius: 6, padding: '2px 8px', fontSize: 12, color: 'var(--accent)', cursor: 'pointer', fontWeight: 500 }}>
                    + Добавить
                  </button>
                </div>
                <div className="cells-grid" style={{
                  display: 'grid',
                  gridTemplateColumns: `repeat(${Math.min(section.cells?.length || 6, 8)}, 1fr)`,
                  gap: 8,
                }}>
                  {cells.map(cell => {
                    const isOccupied = cell.unit_id && cell.unit_status === 'on_stock'
                    const isSelected = String(selected) === String(cell.id)
                    return (
                      <div key={cell.id}
                        onClick={() => setSelected(isSelected ? null : cell.id)}
                        style={{
                          aspectRatio: '1',
                          background: isOccupied
                            ? 'linear-gradient(135deg, rgba(30,157,218,0.08), rgba(30,157,218,0.15))'
                            : 'var(--bg)',
                          border: isSelected
                            ? '2px solid var(--blue)'
                            : isOccupied
                              ? '1px solid rgba(30,157,218,0.3)'
                              : '1px solid var(--border)',
                          borderRadius: 10,
                          display: 'flex', flexDirection: 'column',
                          alignItems: 'center', justifyContent: 'center',
                          cursor: 'pointer', transition: 'all 0.15s',
                          fontSize: 10, fontWeight: 500,
                          color: isOccupied ? 'var(--blue)' : 'var(--muted)',
                          userSelect: 'none',
                          overflow: 'hidden', padding: 6,
                          boxShadow: isSelected ? '0 0 0 3px rgba(30,157,218,0.15)' : 'none',
                        }}
                      >
                        <div style={{ fontSize: 10, fontWeight: 600, marginBottom: 2 }}>{cell.custom_name || cell.code}</div>
                        {isOccupied && (
                          <div style={{
                            fontSize: 8, textAlign: 'center', lineHeight: 1.2,
                            overflow: 'hidden', maxWidth: '100%', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                            opacity: 0.8,
                          }}>
                            {cell.unit_name}
                          </div>
                        )}
                        {!isOccupied && <div style={{ fontSize: 12, opacity: 0.3, marginTop: 2 }}>—</div>}
                      </div>
                    )
                  })}
                </div>
              </div>
            )
          })}

          {!loading && sections.length === 0 && (
            <div style={{ textAlign: 'center', padding: '60px 0', color: 'var(--muted)', fontSize: 14 }}>
              Нет секций. <span style={{ color: 'var(--blue)', cursor: 'pointer' }} onClick={() => navigate('/cells/constructor')}>Создать секцию</span>
            </div>
          )}
        </div>

        {/* Desktop detail panel */}
        {selected && selectedCell && (
          <aside className="cells-detail">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <div style={{ fontWeight: 600, fontSize: 15 }}>
                {selectedCell.custom_name || selectedCell.code}
              </div>
              <button onClick={() => setSelected(null)} style={{ background: 'none', border: 'none', fontSize: 18, cursor: 'pointer', color: 'var(--muted)' }}>✕</button>
            </div>

            {!selectedCell.unit_id || selectedCell.unit_status !== 'on_stock' ? (
              <div style={{ textAlign: 'center', paddingTop: 40 }}>
                <div style={{ fontSize: 32, marginBottom: 12, opacity: 0.3 }}>📦</div>
                <div style={{ color: 'var(--muted)', fontSize: 14, marginBottom: 16 }}>Полка свободна</div>
                <button onClick={async () => {
                  if (!window.confirm('Удалить полку?')) return
                  try {
                    await warehousesApi.deleteCell(selectedCell.id)
                    setSections(prev => prev.map(s => ({
                      ...s, cells: (s.cells || []).filter(c => c.id !== selectedCell.id)
                    })))
                    setSelected(null)
                    toast?.('Полка удалена', 'success')
                  } catch (e) { toast?.(e.message || 'Ошибка', 'error') }
                }} style={{
                  fontSize: 12, color: 'var(--red)', background: 'none',
                  border: '1px solid var(--red)', borderRadius: 6,
                  padding: '6px 14px', cursor: 'pointer',
                }}>Удалить полку</button>
              </div>
            ) : (
              <>
                <div style={{
                  padding: '14px', background: 'var(--bg)', borderRadius: 10,
                  marginBottom: 14,
                }}>
                  <div style={{ fontWeight: 500, fontSize: 14, marginBottom: 4 }}>{selectedCell.unit_name}</div>
                  <div style={{ fontSize: 12, color: 'var(--muted)' }}>Занята</div>
                </div>
                <Button fullWidth onClick={() => { setCardId(selectedCell.unit_id); setSelected(null) }}>
                  Открыть карточку
                </Button>
              </>
            )}
          </aside>
        )}
      </div>

      {/* Mobile bottom sheet */}
      {selected && selectedCell && (
        <div className="cells-sheet" style={{ display: 'none' }}>
          <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 200 }} onClick={() => setSelected(null)} />
          <div style={{ position: 'fixed', bottom: 72, left: 0, right: 0, zIndex: 201, background: 'var(--white)', borderRadius: '16px 16px 0 0', padding: 24 }}>
            <div style={{ fontWeight: 600, marginBottom: 8 }}>{selectedCell.custom_name || selectedCell.code}</div>
            {selectedCell.unit_id && selectedCell.unit_status === 'on_stock' ? (
              <>
                <div style={{ fontSize: 14, color: 'var(--text)', marginBottom: 16 }}>{selectedCell.unit_name}</div>
                <Button fullWidth onClick={() => { setCardId(selectedCell.unit_id); setSelected(null) }}>Открыть карточку</Button>
              </>
            ) : (
              <div style={{ fontSize: 13, color: 'var(--muted)' }}>Полка свободна</div>
            )}
          </div>
        </div>
      )}

      {/* Add warehouse modal */}
      {showAddWh && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 400, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}
          onClick={() => setShowAddWh(false)}>
          <div style={{ background: 'var(--white)', borderRadius: 16, padding: 28, maxWidth: 400, width: '100%' }}
            onClick={e => e.stopPropagation()}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 20 }}>
              <span style={{ fontSize: 24 }}>🏪</span>
              <div style={{ fontWeight: 600, fontSize: 16 }}>Новый склад</div>
            </div>
            <div style={{ fontSize: 12, fontWeight: 500, marginBottom: 6, color: 'var(--muted)' }}>Название склада</div>
            <input
              autoFocus
              value={newWhName}
              onChange={e => setNewWhName(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleAddWarehouse()}
              placeholder="Основной склад, Цех №2..."
              style={{
                width: '100%', height: 44, padding: '0 14px',
                border: '1px solid var(--border)', borderRadius: 10,
                fontSize: 14, background: 'var(--bg)', outline: 'none',
                boxSizing: 'border-box',
              }}
            />
            <div style={{ display: 'flex', gap: 8, marginTop: 20 }}>
              <Button variant="secondary" fullWidth onClick={() => setShowAddWh(false)}>Отмена</Button>
              <Button fullWidth disabled={!newWhName.trim() || addingWh} onClick={handleAddWarehouse}>
                {addingWh ? 'Создание...' : 'Создать'}
              </Button>
            </div>
          </div>
        </div>
      )}

      {cardId && <UnitCardModal unitId={cardId} onClose={() => setCardId(null)} />}
    </WarehouseLayout>
  )
}
