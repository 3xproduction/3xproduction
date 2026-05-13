import { useState, useEffect } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import WarehouseLayout from './WarehouseLayout'
import Badge from '../shared/Badge'
import Button from '../shared/Button'
import { STATUS_LABEL, STATUS_COLOR } from '../../constants/statuses'
import { categoryLabel, ALL_CATEGORIES } from '../../constants/categories'
import { units as unitsApi } from '../../services/api'
import { useAuth } from '../../hooks/useAuth'

export default function UnitPage() {
  const navigate = useNavigate()
  const { id } = useParams()
  const { user } = useAuth()
  const [unit, setUnit] = useState(null)
  const [history, setHistory] = useState([])
  const [activePhoto, setActivePhoto] = useState(0)
  const [loading, setLoading] = useState(true)
  const [showWriteoff, setShowWriteoff] = useState(false)
  const [writeoffReason, setWriteoffReason] = useState('')
  const [showEdit, setShowEdit] = useState(false)
  const [editForm, setEditForm] = useState({})
  const [editSaving, setEditSaving] = useState(false)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)

  const isDirectorOrDeputy = ['warehouse_director', 'warehouse_deputy'].includes(user?.role)
  const isDirector = ['warehouse_director', 'warehouse_deputy'].includes(user?.role)
  const canSeeValuation = ['warehouse_director', 'warehouse_deputy', 'producer'].includes(user?.role)

  useEffect(() => {
    unitsApi.get(id).then(uData => {
      setUnit(uData.unit)
      setHistory(uData.unit?.history || [])
    }).catch(() => {}).finally(() => setLoading(false))
  }, [id])

  if (loading) {
    return (
      <WarehouseLayout>
        <div style={{ padding: '24px 32px', color: 'var(--muted)', fontSize: 14 }}>Загрузка...</div>
      </WarehouseLayout>
    )
  }

  if (!unit) {
    return (
      <WarehouseLayout>
        <div style={{ padding: '24px 32px', color: 'var(--red)', fontSize: 14 }}>Единица не найдена</div>
      </WarehouseLayout>
    )
  }

  const photos = unit.photos || []

  return (
    <WarehouseLayout>
      <div style={{ padding: '24px 32px', maxWidth: 1000 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: 'var(--muted)', marginBottom: 20 }}>
          <span style={{ cursor: 'pointer', color: 'var(--blue)' }} onClick={() => navigate('/units')}>Склад</span>
          <span>›</span>
          <span>{unit.name}</span>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24 }}>
          {/* Left column */}
          <div>
            <div style={{
              aspectRatio: '4/3', background: 'var(--bg)',
              borderRadius: 'var(--radius-card)', border: '1px solid var(--border)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              marginBottom: 10, overflow: 'hidden',
            }}>
              {photos[activePhoto]?.url ? (
                <img src={photos[activePhoto].url} alt="" style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
              ) : (
                <span style={{ color: 'var(--muted)', fontSize: 13 }}>📷 Нет фото</span>
              )}
            </div>
            {photos.length > 1 && (
              <div style={{ display: 'flex', gap: 8 }}>
                {photos.map((p, i) => (
                  <div key={i} onClick={() => setActivePhoto(i)} style={{
                    flex: 1, aspectRatio: '1', background: 'var(--bg)',
                    borderRadius: 8, border: `2px solid ${i === activePhoto ? 'var(--blue)' : 'var(--border)'}`,
                    cursor: 'pointer', overflow: 'hidden',
                  }}>
                    {p.url ? (
                      <img src={p.url} alt="" style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
                    ) : (
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', fontSize: 11, color: 'var(--muted)' }}>📷</div>
                    )}
                  </div>
                ))}
              </div>
            )}

            {isDirectorOrDeputy && history.length > 0 && (
              <div style={{ marginTop: 24 }}>
                <div style={{ fontWeight: 600, fontSize: 15, marginBottom: 14 }}>История движения</div>
                <div style={{ position: 'relative' }}>
                  <div style={{ position: 'absolute', left: 7, top: 0, bottom: 0, width: 2, background: 'var(--border)' }} />
                  {history.map((h, i) => (
                    <div key={i} style={{ display: 'flex', gap: 14, marginBottom: 18, position: 'relative' }}>
                      <div style={{
                        width: 16, height: 16, borderRadius: '50%', flexShrink: 0, marginTop: 1,
                        background: h.action === 'Выдано' ? 'var(--blue)' : h.action === 'Возврат' ? 'var(--green)' : 'var(--border)',
                        border: '2px solid var(--white)', zIndex: 1,
                      }} />
                      <div>
                        <div style={{ fontWeight: 500, fontSize: 13 }}>{h.action}</div>
                        <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>
                          {h.user_name || '—'} · {new Date(h.created_at).toLocaleDateString('ru-RU')}
                          {h.notes && ` · ${h.notes}`}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Right column */}
          <div>
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 16 }}>
              <div>
                <h1 style={{ fontSize: 20, fontWeight: 600, marginBottom: 4 }}>{unit.name}</h1>
                <div style={{ color: 'var(--muted)', fontSize: 13 }}>{categoryLabel(unit.category)}</div>
              </div>
              <Badge color={STATUS_COLOR[unit.status]}>{STATUS_LABEL[unit.status]}</Badge>
            </div>

            <div style={{ background: 'var(--bg)', borderRadius: 'var(--radius-card)', padding: 16, marginBottom: 16 }}>
              <InfoRow label="Серийный номер" value={unit.serial} />
              {unit.warehouse_name && <InfoRow label="Склад" value={unit.warehouse_name} />}
              {unit.hall_name && <InfoRow label="Зал" value={unit.hall_name} />}
              {unit.section_name && (
                <InfoRow
                  label={({ shelf: 'Полка', hanger: 'Вешалка', place: 'Место' })[unit.section_type] || 'Секция'}
                  value={unit.section_name}
                />
              )}
              {unit.qty && <InfoRow label="Количество" value={`${unit.qty} шт.`} />}
              {unit.dimensions && <InfoRow label="Размер" value={unit.dimensions.split('/')[0].trim()} />}
              {canSeeValuation && unit.source && <InfoRow label="Источник" value={unit.source} />}
              {unit.materials && <InfoRow label="Материалы" value={unit.materials} />}
              {unit.period && <InfoRow label={unit.is_admin_stock ? 'Адрес хранения' : 'Временное понятие'} value={unit.period} />}
              {unit.condition && <InfoRow label="Состояние" value={unit.condition} last />}
            </div>

            {unit.description && (
              <div style={{ marginBottom: 16 }}>
                <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 4 }}>Описание</div>
                <div style={{ fontSize: 13, lineHeight: 1.5 }}>{unit.description}</div>
              </div>
            )}

            {canSeeValuation && unit.valuation && (
              <div style={{
                background: 'var(--green-dim)', borderRadius: 8,
                padding: '10px 14px', marginBottom: 16,
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
              }}>
                <span style={{ fontSize: 13, color: 'var(--muted)' }}>Оценочная стоимость</span>
                <span style={{ fontWeight: 600, color: 'var(--green)' }}>
                  {Number(unit.valuation).toLocaleString('ru-RU')} ₽
                </span>
              </div>
            )}

            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {isDirectorOrDeputy && (
                <Button variant="secondary"
                  onClick={() => {
                    setEditForm({
                      name: unit.name || '', category: unit.category || '', serial: unit.serial || '',
                      description: unit.description || '', qty: unit.qty || 1, condition: unit.condition || '',
                      valuation: unit.valuation || '', dimensions: unit.dimensions || '',
                      source: unit.source || '',
                      materials: unit.materials || '', period: unit.period || '',
                    })
                    setShowEdit(true)
                  }}>
                  Редактировать
                </Button>
              )}
              {isDirector && (
                <Button variant="secondary" style={{ color: 'var(--muted)' }}
                  onClick={() => { setWriteoffReason(''); setShowWriteoff(true) }}>
                  Списать
                </Button>
              )}
              {(user?.role === 'warehouse_deputy' || user?.role === 'warehouse_staff') && (
                <Button variant="secondary" style={{ color: 'var(--muted)' }}
                  onClick={() => { setWriteoffReason(''); setShowWriteoff(true) }}>
                  Заявка на списание
                </Button>
              )}
              {isDirector && (
                <Button variant="secondary" style={{ color: 'var(--red)' }}
                  onClick={() => setShowDeleteConfirm(true)}>
                  Удалить
                </Button>
              )}
            </div>
          </div>
        </div>
      </div>
      {showEdit && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 400, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}
          onClick={() => setShowEdit(false)}>
          <div style={{ background: 'var(--white)', borderRadius: 'var(--radius-card)', padding: 24, maxWidth: 480, width: '100%', maxHeight: '92vh', overflowY: 'auto' }}
            onClick={e => e.stopPropagation()}>
            <div style={{ fontWeight: 600, fontSize: 16, marginBottom: 20 }}>Редактировать: {unit.name}</div>
            <EFL>Название *</EFL>
            <input value={editForm.name} onChange={e => setEditForm(f => ({ ...f, name: e.target.value }))}
              style={inputStyle} />
            <EFL>Категория</EFL>
            <select value={editForm.category} onChange={e => setEditForm(f => ({ ...f, category: e.target.value }))}
              style={{ ...inputStyle, cursor: 'pointer' }}>
              {ALL_CATEGORIES.map(c => <option key={c} value={c}>{categoryLabel(c)}</option>)}
            </select>
            <EFL>Серийный номер</EFL>
            <input value={editForm.serial} onChange={e => setEditForm(f => ({ ...f, serial: e.target.value }))}
              style={inputStyle} />
            <EFL>Количество</EFL>
            <input type="number" value={editForm.qty} onChange={e => setEditForm(f => ({ ...f, qty: e.target.value }))}
              style={inputStyle} />
            <EFL>Размеры</EFL>
            <input value={editForm.dimensions} onChange={e => setEditForm(f => ({ ...f, dimensions: e.target.value }))}
              style={inputStyle} />
            <EFL>Источник</EFL>
            <input value={editForm.source} onChange={e => setEditForm(f => ({ ...f, source: e.target.value }))}
              placeholder="покупка, аренда, дар..." style={inputStyle} />
            <EFL>Состояние</EFL>
            <input value={editForm.condition} onChange={e => setEditForm(f => ({ ...f, condition: e.target.value }))}
              style={inputStyle} />
            <EFL>Оценочная стоимость</EFL>
            <input type="number" value={editForm.valuation} onChange={e => setEditForm(f => ({ ...f, valuation: e.target.value }))}
              style={inputStyle} />
            <EFL>Материалы</EFL>
            <input value={editForm.materials} onChange={e => setEditForm(f => ({ ...f, materials: e.target.value }))}
              placeholder="Дерево, металл, пластик..." style={inputStyle} />
            <EFL>{unit.is_admin_stock ? 'Адрес хранения' : 'Временное понятие'}</EFL>
            <input value={editForm.period} onChange={e => setEditForm(f => ({ ...f, period: e.target.value }))} placeholder={unit.is_admin_stock ? 'Офис, шкаф реквизита, склад на площадке' : 'Советское, XVIII век...'} style={inputStyle} />
            <EFL>Описание</EFL>
            <textarea value={editForm.description} onChange={e => setEditForm(f => ({ ...f, description: e.target.value }))}
              style={{ ...inputStyle, height: 72, resize: 'vertical', padding: '8px 10px' }} />
            <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
              <Button variant="secondary" fullWidth onClick={() => setShowEdit(false)}>Отмена</Button>
              <Button fullWidth disabled={!editForm.name?.trim() || editSaving}
                onClick={async () => {
                  setEditSaving(true)
                  try {
                    const res = await unitsApi.update(unit.id, editForm)
                    if (res.unit) setUnit(res.unit)
                    setShowEdit(false)
                  } catch {
                    // Keep the modal open; the user can retry without losing edits.
                  }
                  setEditSaving(false)
                }}>
                {editSaving ? 'Сохранение...' : 'Сохранить'}
              </Button>
            </div>
          </div>
        </div>
      )}
      {showWriteoff && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 400, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}
          onClick={() => setShowWriteoff(false)}>
          <div style={{ background: 'var(--white)', borderRadius: 'var(--radius-card)', padding: 24, maxWidth: 400, width: '100%' }}
            onClick={e => e.stopPropagation()}>
            <div style={{ fontWeight: 600, fontSize: 16, marginBottom: 8 }}>Списание: {unit.name}</div>
            <div style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 14 }}>Укажите причину списания</div>
            <textarea value={writeoffReason} onChange={e => setWriteoffReason(e.target.value)}
              placeholder="Сломано, утеряно, износ..."
              style={{ width: '100%', height: 80, padding: '8px 10px', border: '1px solid var(--border)', borderRadius: 'var(--radius-btn)', fontSize: 13, resize: 'vertical', marginBottom: 16, fontFamily: 'inherit', boxSizing: 'border-box' }} />
            <div style={{ display: 'flex', gap: 8 }}>
              <Button variant="secondary" fullWidth onClick={() => setShowWriteoff(false)}>Отмена</Button>
              <Button fullWidth style={{ background: 'var(--red)', borderColor: 'var(--red)' }}
                onClick={() => {
                  const isRequest = user?.role === 'warehouse_deputy' || user?.role === 'warehouse_staff'
                  const action = isRequest
                    ? unitsApi.requestWriteoff(unit.id, writeoffReason)
                    : unitsApi.writeoff(unit.id, writeoffReason)
                  action.then(() => navigate('/units')).catch(e => alert(e.message || 'Ошибка'))
                }}>
                {(user?.role === 'warehouse_deputy' || user?.role === 'warehouse_staff') ? 'Отправить заявку' : 'Списать'}
              </Button>
            </div>
          </div>
        </div>
      )}
      {showDeleteConfirm && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 400, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}
          onClick={() => setShowDeleteConfirm(false)}>
          <div style={{ background: 'var(--white)', borderRadius: 'var(--radius-card)', padding: 24, maxWidth: 400, width: '100%' }}
            onClick={e => e.stopPropagation()}>
            <div style={{ fontWeight: 600, fontSize: 16, marginBottom: 8 }}>Удалить позицию</div>
            <div style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 20 }}>
              Вы уверены, что хотите удалить «{unit.name}»? Это действие необратимо.
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <Button variant="secondary" fullWidth onClick={() => setShowDeleteConfirm(false)}>Отмена</Button>
              <Button fullWidth style={{ background: 'var(--red)', borderColor: 'var(--red)' }}
                onClick={() => {
                  unitsApi.delete(unit.id).then(() => navigate('/units')).catch(() => alert('Ошибка при удалении'))
                  setShowDeleteConfirm(false)
                }}>
                Удалить
              </Button>
            </div>
          </div>
        </div>
      )}
    </WarehouseLayout>
  )
}

const inputStyle = { width: '100%', height: 38, padding: '0 10px', border: '1px solid var(--border)', borderRadius: 'var(--radius-btn)', fontSize: 13, marginBottom: 12, background: 'var(--white)', outline: 'none', boxSizing: 'border-box' }
function EFL({ children }) {
  return <div style={{ fontSize: 12, fontWeight: 500, marginBottom: 4, color: 'var(--muted)' }}>{children}</div>
}

function InfoRow({ label, value, last }) {
  return (
    <div style={{
      display: 'flex', justifyContent: 'space-between', alignItems: 'center',
      paddingBottom: last ? 0 : 10, marginBottom: last ? 0 : 10,
      borderBottom: last ? 'none' : '1px solid var(--border)',
    }}>
      <span style={{ color: 'var(--muted)', fontSize: 13 }}>{label}</span>
      <span style={{ fontWeight: 500, fontSize: 13, textAlign: 'right', maxWidth: '60%' }}>{value}</span>
    </div>
  )
}
