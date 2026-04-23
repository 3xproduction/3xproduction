// Склад проекта — список единиц, принадлежащих проекту (без полок).
// Вкладки: Реквизит / Костюмы (фильтр по категории).
// Добавление через отдельную модалку: 🛒 Куплено (с чеком) или 🎁 Своё.

import React, { useState, useEffect, useRef } from 'react'
import ProductionLayout from './ProductionLayout'
import Badge from '../shared/Badge'
import Button from '../shared/Button'
import { useToast } from '../shared/Toast'
import { projectUnits as projectUnitsApi, units as unitsApi } from '../../services/api'
import { categoryLabel, ACTIVE_CATEGORIES } from '../../constants/categories'
import { Plus, Receipt, Gift, Trash2, Send } from 'lucide-react'
import { useAuth } from '../../hooks/useAuth'

const COSTUME_CATEGORIES = new Set(['costumes', 'shoes', 'jewelry', 'accessories', 'clothing'])

// Categories allowed by tab.
const CATEGORY_TAB = {
  props: ACTIVE_CATEGORIES.filter(c => !COSTUME_CATEGORIES.has(c)),
  costumes: ACTIVE_CATEGORIES.filter(c => COSTUME_CATEGORIES.has(c)),
}

const ROLES_CAN_ADD = new Set([
  'producer', 'project_director', 'director',
  'production_designer', 'art_director_assistant',
  'first_assistant_director', 'assistant_director',
  'props_master', 'props_assistant',
  'costumer', 'costume_assistant',
  'decorator', 'makeup_artist',
])

export default function ProjectWarehousePage({ embedded = false }) {
  const { user } = useAuth()
  const toast = useToast()
  const [tab, setTab] = useState('props')             // 'props' | 'costumes'
  const [units, setUnits] = useState([])
  const [loading, setLoading] = useState(true)
  const [showAdd, setShowAdd] = useState(false)
  const [showUnit, setShowUnit] = useState(null)      // unit object

  const canAdd = ROLES_CAN_ADD.has(user?.role)

  async function reload() {
    setLoading(true)
    try {
      const d = await projectUnitsApi.list({})
      setUnits(d.units || [])
    } catch (err) {
      toast?.(err.message || 'Не удалось загрузить склад проекта', 'error')
    }
    setLoading(false)
  }
  useEffect(() => { reload() }, [])

  const filteredUnits = units.filter(u =>
    tab === 'costumes' ? COSTUME_CATEGORIES.has(u.category) : !COSTUME_CATEGORIES.has(u.category)
  )

  const Wrapper = embedded ? React.Fragment : ProductionLayout
  return (
    <Wrapper>
      <style>{`
        /* На мобильной скрываем верхнюю кнопку «Добавить» — создание идёт через FAB. */
        @media (max-width: 768px) {
          .pw-top-add { display: none !important; }
        }
      `}</style>
      <div style={{ padding: embedded ? 0 : '24px 32px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
          <h1 style={{ fontSize: 22, fontWeight: 700 }}>Склад проекта</h1>
          {canAdd && (
            <div className="pw-top-add">
              <Button onClick={() => setShowAdd(true)}>
                <Plus size={14} style={{ marginRight: 6 }} /> Добавить
              </Button>
            </div>
          )}
        </div>

        {/* Tabs */}
        <div style={{ display: 'flex', gap: 6, marginBottom: 18, borderBottom: '1px solid var(--border)' }}>
          {[
            { key: 'props',    label: 'Реквизит' },
            { key: 'costumes', label: 'Костюмы'  },
          ].map(t => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              style={{
                padding: '10px 18px', border: 'none', background: 'none', cursor: 'pointer',
                fontSize: 14, fontWeight: tab === t.key ? 600 : 500,
                color: tab === t.key ? 'var(--accent)' : 'var(--muted)',
                borderBottom: tab === t.key ? '2px solid var(--accent)' : '2px solid transparent',
                marginBottom: -1,
              }}
            >
              {t.label} <span style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 400 }}>
                · {units.filter(u => t.key === 'costumes' ? COSTUME_CATEGORIES.has(u.category) : !COSTUME_CATEGORIES.has(u.category)).length}
              </span>
            </button>
          ))}
        </div>

        {loading ? (
          <div style={{ textAlign: 'center', padding: '40px 0', color: 'var(--muted)' }}>Загрузка...</div>
        ) : filteredUnits.length === 0 ? (
          <EmptyState tab={tab} canAdd={canAdd} onAdd={() => setShowAdd(true)} />
        ) : (
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
            gap: 14,
          }}>
            {filteredUnits.map(u => (
              <ProjectUnitCard key={u.id} unit={u} onOpen={() => setShowUnit(u)} />
            ))}
          </div>
        )}
      </div>

      {showAdd && (
        <AddUnitModal
          defaultTab={tab}
          onClose={() => setShowAdd(false)}
          onCreated={() => { setShowAdd(false); reload() }}
        />
      )}

      {showUnit && (
        <ProjectUnitModal
          unit={showUnit}
          canEdit={canAdd}
          onClose={() => setShowUnit(null)}
          onChanged={() => { setShowUnit(null); reload() }}
        />
      )}
    </Wrapper>
  )
}

function EmptyState({ tab, canAdd, onAdd }) {
  return (
    <div style={{
      textAlign: 'center', padding: '48px 20px', color: 'var(--muted)',
      background: 'var(--bg)', borderRadius: 12,
    }}>
      <div style={{ fontSize: 40, marginBottom: 12 }}>📦</div>
      <div style={{ fontSize: 15, fontWeight: 500, color: 'var(--text)', marginBottom: 4 }}>
        {tab === 'costumes' ? 'В проекте пока нет костюмов' : 'В проекте пока нет реквизита'}
      </div>
      <div style={{ fontSize: 13, marginBottom: 14 }}>
        Добавляйте сюда вещи, купленные или найденные для проекта — они не окажутся на публичном складе.
      </div>
      {canAdd && <Button onClick={onAdd}><Plus size={14} style={{ marginRight: 6 }} /> Добавить первую</Button>}
    </div>
  )
}

function ProjectUnitCard({ unit, onOpen }) {
  const isPurchased = unit.purchased
  const isPending = unit.pending_transfer
  return (
    <div
      onClick={onOpen}
      style={{
        background: 'var(--white)', borderRadius: 12,
        border: '1px solid var(--border)', overflow: 'hidden',
        cursor: 'pointer', transition: 'transform 0.12s, box-shadow 0.12s',
        opacity: isPending ? 0.55 : 1,
      }}
      onMouseEnter={e => { e.currentTarget.style.transform = 'translateY(-2px)'; e.currentTarget.style.boxShadow = '0 4px 12px rgba(0,0,0,0.06)' }}
      onMouseLeave={e => { e.currentTarget.style.transform = 'none'; e.currentTarget.style.boxShadow = 'none' }}
    >
      {unit.photo_url ? (
        <img src={unit.photo_url} alt="" style={{ width: '100%', aspectRatio: '1 / 1', objectFit: 'cover' }} />
      ) : (
        <div style={{ width: '100%', aspectRatio: '1 / 1', background: 'var(--bg)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--muted)', fontSize: 32 }}>📦</div>
      )}
      <div style={{ padding: 10 }}>
        <div style={{ fontSize: 13, fontWeight: 500, marginBottom: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{unit.name}</div>
        <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 6 }}>{categoryLabel(unit.category)}</div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6 }}>
          <div style={{ fontSize: 11, display: 'flex', alignItems: 'center', gap: 4, color: 'var(--muted)' }}>
            {isPurchased ? <><Receipt size={11} /> {unit.purchase_price ? `${Math.round(unit.purchase_price)} ₽` : 'С чеком'}</>
                        : <><Gift size={11} /> без чека</>}
          </div>
          {isPending && <Badge color="amber">В передаче</Badge>}
        </div>
      </div>
    </div>
  )
}

// ──────────────────────────────────────────────────────────────────────────
// Add unit modal
// ──────────────────────────────────────────────────────────────────────────
function AddUnitModal({ defaultTab, onClose, onCreated }) {
  const toast = useToast()
  const [mode, setMode] = useState('purchased')   // 'purchased' | 'own'
  const [form, setForm] = useState({
    name: '', category: defaultTab === 'costumes' ? 'costumes' : 'props',
    description: '', qty: 1, valuation: '',
    purchase_price: '', purchase_date: new Date().toISOString().slice(0, 10), vendor: '',
  })
  const [photos, setPhotos] = useState([])                // File[]
  const [photoPreviews, setPhotoPreviews] = useState([])  // URL[]
  const [receiptFile, setReceiptFile] = useState(null)
  const [receiptPreview, setReceiptPreview] = useState('')
  const [saving, setSaving] = useState(false)
  const [aiRecognizing, setAiRecognizing] = useState(false)
  const photoInputRef = useRef(null)
  const receiptInputRef = useRef(null)

  function update(k, v) { setForm(f => ({ ...f, [k]: v })) }

  async function onPhotosSelected(e) {
    const files = Array.from(e.target.files || [])
    if (!files.length) return
    setPhotos(prev => [...prev, ...files])
    const previews = files.map(f => URL.createObjectURL(f))
    setPhotoPreviews(prev => [...prev, ...previews])

    // AI recognize from first photo if name is empty
    if (!form.name && files[0]) {
      setAiRecognizing(true)
      try {
        const fd = new FormData()
        fd.append('photo', files[0])
        const result = await unitsApi.recognize(fd)
        setForm(f => ({
          ...f,
          name: result.name || f.name,
          category: result.category || f.category,
          description: result.description || f.description,
        }))
      } catch {/* silent */}
      setAiRecognizing(false)
    }
  }

  function onReceiptSelected(e) {
    const f = e.target.files?.[0]
    if (!f) return
    setReceiptFile(f)
    setReceiptPreview(URL.createObjectURL(f))
  }

  const canSave = form.name && form.category && photos.length >= 1 &&
    (mode === 'own' || (receiptFile && form.purchase_price))

  async function handleSave() {
    if (!canSave) return
    setSaving(true)
    try {
      // 1. upload receipt first (if purchased)
      let receiptUrl = null
      if (mode === 'purchased' && receiptFile) {
        const fd = new FormData()
        fd.append('receipt', receiptFile)
        const r = await projectUnitsApi.uploadReceipt(fd)
        receiptUrl = r.url
      }

      // 2. create unit
      const body = {
        name: form.name, category: form.category,
        description: form.description, qty: Number(form.qty) || 1,
        valuation: form.valuation ? Number(form.valuation) : null,
        purchased: mode === 'purchased',
        purchase_price: mode === 'purchased' ? Number(form.purchase_price) : null,
        purchase_date:  mode === 'purchased' ? form.purchase_date : null,
        vendor:         mode === 'purchased' ? form.vendor : null,
        receipt_url:    receiptUrl,
      }
      const d = await projectUnitsApi.create(body)
      const unitId = d.unit?.id

      // 3. upload photos
      if (unitId) {
        const fd = new FormData()
        for (const p of photos) fd.append('photos', p)
        try { await unitsApi.uploadPhoto(unitId, fd) } catch {/* non-fatal */}
      }
      toast?.('Добавлено на склад проекта', 'success')
      onCreated?.()
    } catch (err) {
      toast?.(err.message || 'Ошибка при сохранении', 'error')
    }
    setSaving(false)
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 500,
      display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: 20, overflowY: 'auto' }}
      onClick={onClose}>
      <div style={{ background: 'var(--white)', borderRadius: 14, padding: 22, maxWidth: 540, width: '100%' }}
        onClick={e => e.stopPropagation()}>
        <div style={{ fontSize: 17, fontWeight: 600, marginBottom: 16 }}>Добавить на склад проекта</div>

        {/* Purchased vs own */}
        <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
          {[
            { k: 'purchased', icon: <Receipt size={14} />, label: 'Куплено для проекта', hint: 'С чеком' },
            { k: 'own',       icon: <Gift size={14} />,    label: 'Своё / найденное',     hint: 'Без чека' },
          ].map(opt => (
            <button key={opt.k} onClick={() => setMode(opt.k)}
              style={{
                flex: 1, padding: '10px 12px', borderRadius: 10,
                border: mode === opt.k ? '1.5px solid var(--accent)' : '1px solid var(--border)',
                background: mode === opt.k ? 'rgba(var(--accent-rgb,249,115,22),0.08)' : 'var(--white)',
                textAlign: 'left', cursor: 'pointer',
              }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontWeight: 600, fontSize: 13 }}>
                {opt.icon} {opt.label}
              </div>
              <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>{opt.hint}</div>
            </button>
          ))}
        </div>

        {/* Photos */}
        <div style={{ marginBottom: 12 }}>
          <div style={{ fontSize: 12, fontWeight: 500, marginBottom: 6 }}>Фото предмета {aiRecognizing && <span style={{ color: 'var(--blue)' }}>· ИИ распознаёт...</span>}</div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {photoPreviews.map((p, i) => (
              <div key={i} style={{ position: 'relative' }}>
                <img src={p} alt="" style={{ width: 64, height: 64, objectFit: 'cover', borderRadius: 8 }} />
                <button onClick={() => {
                  setPhotos(ph => ph.filter((_, idx) => idx !== i))
                  setPhotoPreviews(pr => pr.filter((_, idx) => idx !== i))
                }} style={{
                  position: 'absolute', top: -6, right: -6, width: 20, height: 20, borderRadius: '50%',
                  border: 'none', background: 'var(--red)', color: '#fff', cursor: 'pointer', fontSize: 12,
                }}>×</button>
              </div>
            ))}
            <button onClick={() => photoInputRef.current?.click()}
              style={{
                width: 64, height: 64, borderRadius: 8, border: '1.5px dashed var(--border-strong)',
                background: 'var(--bg)', cursor: 'pointer', fontSize: 22, color: 'var(--muted)',
              }}>+</button>
            <input ref={photoInputRef} type="file" multiple accept="image/*" style={{ display: 'none' }} onChange={onPhotosSelected} />
          </div>
        </div>

        {/* Name & category */}
        <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 10, marginBottom: 10 }}>
          <div>
            <div style={{ fontSize: 12, fontWeight: 500, marginBottom: 4 }}>Название</div>
            <input value={form.name} onChange={e => update('name', e.target.value)}
              style={inputStyle} placeholder="Подставка для смартфона" />
          </div>
          <div>
            <div style={{ fontSize: 12, fontWeight: 500, marginBottom: 4 }}>Категория</div>
            <select value={form.category} onChange={e => update('category', e.target.value)} style={inputStyle}>
              {ACTIVE_CATEGORIES.map(c => <option key={c} value={c}>{categoryLabel(c)}</option>)}
            </select>
          </div>
        </div>

        {/* Purchased fields */}
        {mode === 'purchased' && (
          <div style={{ background: 'var(--bg)', borderRadius: 10, padding: 12, marginBottom: 10 }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 10 }}>
              <div>
                <div style={{ fontSize: 12, fontWeight: 500, marginBottom: 4 }}>Цена покупки, ₽ *</div>
                <input type="number" value={form.purchase_price} onChange={e => update('purchase_price', e.target.value)}
                  style={inputStyle} placeholder="1450" />
              </div>
              <div>
                <div style={{ fontSize: 12, fontWeight: 500, marginBottom: 4 }}>Дата покупки</div>
                <input type="date" value={form.purchase_date} onChange={e => update('purchase_date', e.target.value)} style={inputStyle} />
              </div>
            </div>
            <div style={{ marginBottom: 10 }}>
              <div style={{ fontSize: 12, fontWeight: 500, marginBottom: 4 }}>Магазин / поставщик</div>
              <input value={form.vendor} onChange={e => update('vendor', e.target.value)}
                style={inputStyle} placeholder="Леруа Мерлен" />
            </div>
            <div>
              <div style={{ fontSize: 12, fontWeight: 500, marginBottom: 4 }}>📄 Фото чека *</div>
              {receiptPreview ? (
                <div style={{ position: 'relative', display: 'inline-block' }}>
                  <img src={receiptPreview} alt="" style={{ maxWidth: 140, maxHeight: 140, borderRadius: 8, border: '1px solid var(--border)' }} />
                  <button onClick={() => { setReceiptFile(null); setReceiptPreview('') }}
                    style={{ position: 'absolute', top: -6, right: -6, width: 22, height: 22, borderRadius: '50%',
                      border: 'none', background: 'var(--red)', color: '#fff', cursor: 'pointer' }}>×</button>
                </div>
              ) : (
                <button onClick={() => receiptInputRef.current?.click()}
                  style={{ padding: '10px 16px', borderRadius: 8, border: '1.5px dashed var(--border-strong)',
                    background: 'var(--white)', cursor: 'pointer', fontSize: 13 }}>
                  📷 Прикрепить чек
                </button>
              )}
              <input ref={receiptInputRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={onReceiptSelected} />
            </div>
          </div>
        )}

        {/* Description */}
        <div style={{ marginBottom: 14 }}>
          <div style={{ fontSize: 12, fontWeight: 500, marginBottom: 4 }}>Описание</div>
          <textarea value={form.description} onChange={e => update('description', e.target.value)}
            style={{ ...inputStyle, height: 64, resize: 'vertical', fontFamily: 'inherit' }}
            placeholder="Опционально" />
        </div>

        <div style={{ display: 'flex', gap: 10 }}>
          <Button variant="secondary" fullWidth onClick={onClose}>Отмена</Button>
          <Button fullWidth disabled={!canSave || saving} onClick={handleSave}>
            {saving ? 'Сохранение...' : 'Добавить'}
          </Button>
        </div>
        {!canSave && (
          <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 8, textAlign: 'center' }}>
            {photos.length < 1 ? 'Добавьте хотя бы одно фото.'
             : mode === 'purchased' ? 'Для купленного обязательны цена и фото чека.'
             : 'Заполните название.'}
          </div>
        )}
      </div>
    </div>
  )
}

// ──────────────────────────────────────────────────────────────────────────
// Unit modal for project-kept unit — view + transfer + delete
// ──────────────────────────────────────────────────────────────────────────
function ProjectUnitModal({ unit, canEdit, onClose, onChanged }) {
  const toast = useToast()
  const [action, setAction] = useState(null)        // 'transfer' | 'delete' | null
  const [comment, setComment] = useState('')
  const [busy, setBusy] = useState(false)

  async function doTransfer() {
    setBusy(true)
    try {
      await projectUnitsApi.transfer(unit.id, comment)
      toast?.('Заявка отправлена директору склада', 'success')
      onChanged?.()
    } catch (e) { toast?.(e.message || 'Ошибка', 'error') }
    setBusy(false)
  }
  async function doDelete() {
    setBusy(true)
    try {
      await projectUnitsApi.delete(unit.id, comment)
      toast?.('Списано', 'success')
      onChanged?.()
    } catch (e) { toast?.(e.message || 'Ошибка', 'error') }
    setBusy(false)
  }

  const isPending = unit.pending_transfer

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 500,
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }} onClick={onClose}>
      <div style={{ background: 'var(--white)', borderRadius: 14, padding: 22, maxWidth: 520, width: '100%' }}
        onClick={e => e.stopPropagation()}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 12 }}>
          <div>
            <div style={{ fontSize: 17, fontWeight: 600 }}>{unit.name}</div>
            <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>{categoryLabel(unit.category)}</div>
          </div>
          {isPending && <Badge color="amber">В передаче</Badge>}
        </div>

        {unit.photo_url && (
          <img src={unit.photo_url} alt="" style={{ width: '100%', aspectRatio: '16/9', objectFit: 'cover', borderRadius: 10, marginBottom: 12 }} />
        )}

        <div style={{ background: 'var(--bg)', borderRadius: 10, padding: 12, marginBottom: 12, fontSize: 13 }}>
          {unit.purchased ? (
            <>
              <div>🛒 <strong>Куплено</strong> {unit.purchase_price ? `· ${Math.round(unit.purchase_price)} ₽` : ''}</div>
              {unit.purchase_date && <div style={{ color: 'var(--muted)', fontSize: 12, marginTop: 2 }}>Дата: {new Date(unit.purchase_date).toLocaleDateString()}</div>}
              {unit.vendor && <div style={{ color: 'var(--muted)', fontSize: 12 }}>Магазин: {unit.vendor}</div>}
              {unit.receipt_url && <a href={unit.receipt_url} target="_blank" rel="noreferrer" style={{ fontSize: 12, color: 'var(--blue)', display: 'inline-block', marginTop: 6 }}>📄 Открыть чек</a>}
            </>
          ) : (
            <div>🎁 <strong>Своё / найденное</strong> · без чека</div>
          )}
          {unit.created_by_name && <div style={{ color: 'var(--muted)', fontSize: 12, marginTop: 6 }}>Добавил: {unit.created_by_name}</div>}
        </div>

        {unit.description && (
          <div style={{ fontSize: 13, marginBottom: 12 }}>{unit.description}</div>
        )}

        {action === 'transfer' ? (
          <div style={{ background: 'rgba(59,130,246,0.07)', borderRadius: 10, padding: 12 }}>
            <div style={{ fontSize: 13, fontWeight: 500, marginBottom: 8 }}>Передать на основной склад</div>
            <textarea value={comment} onChange={e => setComment(e.target.value)}
              placeholder="Комментарий директору (опц.)"
              style={{ ...inputStyle, height: 70, resize: 'vertical', fontFamily: 'inherit' }} />
            <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
              <Button variant="secondary" fullWidth onClick={() => setAction(null)}>Отмена</Button>
              <Button fullWidth disabled={busy} onClick={doTransfer}>
                {busy ? 'Отправка...' : 'Отправить'}
              </Button>
            </div>
          </div>
        ) : action === 'delete' ? (
          <div style={{ background: 'rgba(239,68,68,0.07)', borderRadius: 10, padding: 12 }}>
            <div style={{ fontSize: 13, fontWeight: 500, marginBottom: 8 }}>Списать</div>
            <textarea value={comment} onChange={e => setComment(e.target.value)}
              placeholder="Причина (опц.)"
              style={{ ...inputStyle, height: 70, resize: 'vertical', fontFamily: 'inherit' }} />
            <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
              <Button variant="secondary" fullWidth onClick={() => setAction(null)}>Отмена</Button>
              <Button fullWidth disabled={busy} onClick={doDelete} style={{ background: 'var(--red)' }}>
                {busy ? 'Списание...' : 'Списать'}
              </Button>
            </div>
          </div>
        ) : canEdit && !isPending ? (
          <div style={{ display: 'flex', gap: 8 }}>
            <Button fullWidth onClick={() => setAction('transfer')}>
              <Send size={13} style={{ marginRight: 6 }} /> На основной склад
            </Button>
            <Button variant="secondary" onClick={() => setAction('delete')} style={{ color: 'var(--red)' }}>
              <Trash2 size={13} />
            </Button>
          </div>
        ) : null}

        {!action && (
          <div style={{ marginTop: 12 }}>
            <Button variant="secondary" fullWidth onClick={onClose}>Закрыть</Button>
          </div>
        )}
      </div>
    </div>
  )
}

const inputStyle = {
  width: '100%', height: 36, padding: '0 10px',
  border: '1px solid var(--border)', borderRadius: 8, fontSize: 13,
  boxSizing: 'border-box', background: 'var(--white)',
}
