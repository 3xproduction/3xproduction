import { useState, useEffect } from 'react'
import { X, ChevronDown, ZoomIn } from 'lucide-react'
import Badge from './Badge'
import Lightbox from './Lightbox'
import Button from './Button'
import { units as unitsApi, warehouses as warehousesApi } from '../../services/api'
import { useAuth } from '../../hooks/useAuth'
import { STATUS_LABEL, STATUS_COLOR } from '../../constants/statuses'
import { categoryLabel } from '../../constants/categories'
import ConfirmModal from './ConfirmModal'

const WAREHOUSE_ROLES = ['warehouse_director', 'warehouse_deputy', 'warehouse_staff']
const DIRECTOR_ROLES  = ['warehouse_director', 'warehouse_deputy']

export default function UnitCardModal({ unitId, onClose, onChanged }) {
  const { user } = useAuth()
  const [currentId, setCurrentId]     = useState(unitId)
  const [unit, setUnit]               = useState(null)
  const [loading, setLoading]         = useState(true)
  const [activePhoto, setActivePhoto] = useState(0)
  const [similar, setSimilar]         = useState([])
  const [lightbox, setLightbox]       = useState(null)

  // Cell assignment
  const [showCell, setShowCell]       = useState(false)
  const [warehouses, setWarehouses]   = useState([])
  const [cells, setCells]             = useState([])
  const [selWh, setSelWh]             = useState('')
  const [selCell, setSelCell]         = useState('')
  const [cellSaving, setCellSaving]   = useState(false)

  // Writeoff
  const [showWriteoff, setShowWriteoff]     = useState(false)
  const [writeoffReason, setWriteoffReason] = useState('')
  // Delete
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)

  const isWarehouse = WAREHOUSE_ROLES.includes(user?.role)
  const isDirector  = DIRECTOR_ROLES.includes(user?.role)

  useEffect(() => {
    setLoading(true)
    setActivePhoto(0)
    setSimilar([])
    unitsApi.get(currentId)
      .then(d => {
        setUnit(d.unit)
        setLoading(false)
        if (d.unit?.category) {
          unitsApi.list({ category: d.unit.category }).then(r => {
            setSimilar((r.units || []).filter(s => s.id !== currentId).slice(0, 6))
          }).catch(() => {})
        }
      })
      .catch(() => setLoading(false))
  }, [currentId])

  // Load warehouses when cell panel opens, preselect unit's warehouse
  useEffect(() => {
    if (!showCell) return
    warehousesApi.list().then(d => {
      setWarehouses(d.warehouses || [])
      if (unit?.warehouse_id) setSelWh(String(unit.warehouse_id))
    })
  }, [showCell])

  // Load cells when warehouse selected
  useEffect(() => {
    if (!selWh) { setCells([]); setSelCell(''); return }
    warehousesApi.cells(selWh).then(d => {
      const allCells = (d.sections || []).flatMap(s => s.cells || [])
      setCells(allCells)
    })
  }, [selWh])

  async function handleAssignCell() {
    if (!selCell) return
    setCellSaving(true)
    try {
      const u = unit
      await unitsApi.update(currentId, {
        name: u.name, category: u.category, serial: u.serial,
        warehouse_id: selWh, cell_id: selCell,
        description: u.description, qty: u.qty,
        condition: u.condition, valuation: u.valuation,
      })
      const d = await unitsApi.get(currentId)
      setUnit(d.unit)
      setShowCell(false)
      setSelWh(''); setSelCell('')
    } catch(e) { /* ignore */ }
    setCellSaving(false)
  }

  const [writeoffSuccess, setWriteoffSuccess] = useState(false)

  async function handleWriteoff() {
    if (!writeoffReason.trim()) return
    try {
      const isRequest = user?.role === 'warehouse_deputy' || user?.role === 'warehouse_staff'
      const action = isRequest
        ? unitsApi.requestWriteoff(currentId, writeoffReason)
        : unitsApi.writeoff(currentId, writeoffReason)
      await action
      if (!isRequest) {
        setWriteoffSuccess(true)
        setTimeout(() => onClose(), 1500)
        return
      }
      onClose()
    } catch (e) {
      alert(e.message || 'Ошибка при списании')
    }
  }

  if (loading) return (
    <div style={styles.overlay} onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div style={styles.modal} onClick={e => e.stopPropagation()}>
        <div style={{ padding: 32, color: 'var(--muted)', fontSize: 14 }}>Загрузка...</div>
      </div>
    </div>
  )

  if (!unit) return (
    <div style={styles.overlay} onClick={onClose}>
      <div style={styles.modal} onClick={e => e.stopPropagation()}>
        <div style={{ padding: 32, color: 'var(--red)', fontSize: 14 }}>Единица не найдена</div>
      </div>
    </div>
  )

  const photos = unit.photos || []
  const cellLabel = unit.cell_custom || unit.cell_code || unit.cell_name || '—'

  return (
    <div style={styles.overlay} onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div style={styles.modal} onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div style={styles.header}>
          <div>
            <div style={{ fontWeight: 600, fontSize: 17 }}>{unit.name}</div>
            <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>{categoryLabel(unit.category)}</div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <Badge color={STATUS_COLOR[unit.status]}>{STATUS_LABEL[unit.status]}</Badge>
            <button style={styles.closeBtn} onClick={onClose}><X size={18} /></button>
          </div>
        </div>

        <div style={styles.body}>
          {/* Photos */}
          {photos.length > 0 && (
            <div style={{ marginBottom: 16 }}>
              <div style={{ ...styles.mainPhoto, cursor: photos[activePhoto]?.url ? 'zoom-in' : 'default', position: 'relative' }}
                onClick={e => { e.stopPropagation(); photos[activePhoto]?.url && setLightbox(activePhoto) }}>
                {photos[activePhoto]?.url
                  ? <>
                      <img src={photos[activePhoto].url} alt="" style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
                      <div style={{ position: 'absolute', top: 8, right: 8, background: 'rgba(0,0,0,0.5)', borderRadius: '50%', width: 28, height: 28, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        <ZoomIn size={14} color="#fff" />
                      </div>
                    </>
                  : <span style={{ color: 'var(--muted)', fontSize: 13 }}>📷</span>
                }
              </div>
              {photos.length > 1 && (
                <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
                  {photos.map((p, i) => (
                    <div key={i} onClick={e => { e.stopPropagation(); setActivePhoto(i) }} style={{
                      width: 48, height: 48, borderRadius: 6, overflow: 'hidden', cursor: 'pointer', flexShrink: 0,
                      border: `2px solid ${i === activePhoto ? 'var(--blue)' : 'var(--border)'}`,
                    }}>
                      {p.url
                        ? <img src={p.url} alt="" style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
                        : <div style={{ width: '100%', height: '100%', background: 'var(--bg)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, color: 'var(--muted)' }}>📷</div>
                      }
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Info rows */}
          <div style={{ background: 'var(--bg)', borderRadius: 'var(--radius-card)', padding: '4px 14px', marginBottom: 14 }}>
            {unit.serial     && <InfoRow label="Серийный номер" value={unit.serial} />}
            {unit.warehouse_name && <InfoRow label="Склад"      value={unit.warehouse_name} />}
            <InfoRow label="Полка" value={cellLabel} />
            {unit.qty        && <InfoRow label="Количество"     value={`${unit.qty} шт.`} />}
            {unit.dimensions && <InfoRow label="Размеры"        value={unit.dimensions} />}
            {unit.condition  && <InfoRow label="Состояние"      value={unit.condition} />}
            {unit.source     && <InfoRow label="Источник"       value={unit.source} />}
            {unit.valuation  && <InfoRow label="Стоимость"      value={`${Number(unit.valuation).toLocaleString('ru-RU')} ₽`} last />}
          </div>

          {unit.description && (
            <div style={{ marginBottom: 14 }}>
              <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 4 }}>Описание</div>
              <div style={{ fontSize: 13, lineHeight: 1.5 }}>{unit.description}</div>
            </div>
          )}

          {/* Similar items */}
          {similar.length > 0 && (
            <div style={{ marginBottom: 14 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--muted)', marginBottom: 8 }}>Похожие</div>
              <div style={{ display: 'flex', gap: 8, overflowX: 'auto', paddingBottom: 4 }}>
                {similar.map(s => (
                  <div key={s.id} onClick={() => setCurrentId(s.id)} style={{
                    flexShrink: 0, width: 100, cursor: 'pointer',
                    borderRadius: 'var(--radius-btn)', border: '1px solid var(--border)',
                    background: 'var(--bg)', overflow: 'hidden',
                  }}>
                    <div style={{ width: 100, height: 80, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--bg)' }}>
                      {s.photo_url
                        ? <img src={s.photo_url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                        : <span style={{ fontSize: 24 }}>📦</span>}
                    </div>
                    <div style={{ padding: '6px 8px', fontSize: 11, fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', color: 'var(--text)' }}>{s.name}</div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Warehouse buttons */}
          {isWarehouse && (
            <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
              {!unit.cell_id && (
                <Button onClick={() => { setShowCell(v => !v); setShowWriteoff(false) }}>
                  Полка <ChevronDown size={13} style={{ marginLeft: 4, transform: showCell ? 'rotate(180deg)' : 'none', transition: '0.15s' }} />
                </Button>
              )}
              {isDirector && (
                <Button variant="secondary" style={{ color: 'var(--red)' }}
                  onClick={() => { setShowWriteoff(v => !v); setShowCell(false); setShowDeleteConfirm(false) }}>
                  Списать
                </Button>
              )}
              {['warehouse_director', 'warehouse_deputy'].includes(user?.role) && (
                <Button variant="secondary" style={{ color: 'var(--red)' }}
                  onClick={() => { setShowDeleteConfirm(v => !v); setShowWriteoff(false); setShowCell(false) }}>
                  Удалить
                </Button>
              )}
            </div>
          )}
          {isWarehouse && unit.cell_id && (
            <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 8 }}>
              Полка: <strong>{unit.cell_custom || unit.cell_code || '—'}</strong>
            </div>
          )}

          {/* Cell assignment panel */}
          {showCell && (
            <div style={{ background: 'var(--bg)', borderRadius: 10, padding: 14, marginBottom: 8, border: '1px solid var(--border)' }}>
              <div style={{ fontSize: 13, fontWeight: 500, marginBottom: 10 }}>Назначить полку</div>
              <select value={selWh} onChange={e => setSelWh(e.target.value)} style={styles.select}>
                <option value="">— Выберите склад —</option>
                {warehouses.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
              </select>
              {cells.length > 0 && (
                <select value={selCell} onChange={e => setSelCell(e.target.value)} style={{ ...styles.select, marginTop: 8 }}>
                  <option value="">— Выберите полку —</option>
                  {cells.map(c => <option key={c.id} value={c.id}>{c.custom_name || c.code}</option>)}
                </select>
              )}
              <Button
                style={{ marginTop: 10, width: '100%' }}
                onClick={handleAssignCell}
                disabled={!selCell || cellSaving}
              >
                {cellSaving ? 'Сохранение...' : 'Сохранить'}
              </Button>
            </div>
          )}

          {/* Writeoff panel */}
          {showWriteoff && (
            <div style={{ background: 'var(--bg)', borderRadius: 10, padding: 14, border: '1px solid var(--border)' }}>
              {writeoffSuccess ? (
                <div style={{ textAlign: 'center', padding: '12px 0' }}>
                  <div style={{ fontSize: 28, marginBottom: 8 }}>✓</div>
                  <div style={{ fontWeight: 600, color: 'var(--green)', fontSize: 14 }}>Успешно списано</div>
                </div>
              ) : (
                <>
                  <div style={{ fontSize: 13, fontWeight: 500, marginBottom: 8 }}>Причина списания</div>
                  <textarea
                    value={writeoffReason}
                    onChange={e => setWriteoffReason(e.target.value)}
                    placeholder="Сломано, утеряно, износ..."
                    style={{ width: '100%', height: 70, padding: '8px 10px', border: '1px solid var(--border)', borderRadius: 8, fontSize: 13, resize: 'vertical', fontFamily: 'inherit', boxSizing: 'border-box' }}
                  />
                  <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
                    <Button variant="secondary" fullWidth onClick={() => setShowWriteoff(false)}>Отмена</Button>
                    <Button fullWidth style={{ background: 'var(--red)', borderColor: 'var(--red)' }} onClick={handleWriteoff}>
                      Списать
                    </Button>
                  </div>
                </>
              )}
            </div>
          )}

          <ConfirmModal
            open={showDeleteConfirm}
            title="Удалить единицу"
            message={`Вы уверены, что хотите удалить «${unit?.name || 'позицию'}»? Это действие необратимо.`}
            confirmLabel="Удалить"
            onCancel={() => setShowDeleteConfirm(false)}
            onConfirm={async () => {
              try { await unitsApi.delete(currentId); onChanged?.(); onClose() } catch (e) { alert(e.message || 'Ошибка') }
            }}
          />
        </div>
      </div>
      {lightbox !== null && (
        <Lightbox
          photos={photos.map(p => p.url)}
          startIndex={lightbox}
          onClose={() => setLightbox(null)}
        />
      )}
    </div>
  )
}

function InfoRow({ label, value, last }) {
  return (
    <div style={{
      display: 'flex', justifyContent: 'space-between', alignItems: 'center',
      padding: '10px 0',
      borderBottom: last ? 'none' : '1px solid var(--border)',
    }}>
      <span style={{ color: 'var(--muted)', fontSize: 13 }}>{label}</span>
      <span style={{ fontWeight: 500, fontSize: 13, textAlign: 'right', maxWidth: '60%' }}>{value}</span>
    </div>
  )
}

const styles = {
  overlay: {
    position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)',
    zIndex: 500, display: 'flex', alignItems: 'center', justifyContent: 'center',
    padding: 16,
  },
  modal: {
    background: 'var(--white)', borderRadius: 'var(--radius-card)',
    width: '100%', maxWidth: 480,
    maxHeight: '90vh', display: 'flex', flexDirection: 'column',
    overflow: 'hidden',
  },
  header: {
    display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between',
    padding: '18px 20px 14px', borderBottom: '1px solid var(--border)', flexShrink: 0,
  },
  body: {
    padding: '16px 20px 20px', overflowY: 'auto', flex: 1,
  },
  mainPhoto: {
    width: '100%', aspectRatio: '16/9',
    background: 'var(--bg)', borderRadius: 10, overflow: 'hidden',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    border: '1px solid var(--border)',
  },
  closeBtn: {
    background: 'none', border: 'none', cursor: 'pointer',
    color: 'var(--muted)', padding: 4, display: 'flex', alignItems: 'center',
  },
  select: {
    width: '100%', padding: '8px 10px', border: '1px solid var(--border)',
    borderRadius: 8, fontSize: 13, background: 'var(--white)', fontFamily: 'inherit',
    color: 'var(--text)',
  },
}
