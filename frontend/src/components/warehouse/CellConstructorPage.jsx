import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import WarehouseLayout from './WarehouseLayout'
import Button from '../shared/Button'
import Input from '../shared/Input'
import { warehouses as warehousesApi } from '../../services/api'
import { ALL_CATEGORIES, categoryLabel } from '../../constants/categories'

const CATEGORIES = [...ALL_CATEGORIES, 'custom']

const STEPS = ['Секция', 'Размер', 'Коды', 'Просмотр', 'Готово']

let _cellIdx = 0
function genCells(rows, shelves) {
  const cells = []
  for (let r = 0; r < rows; r++) {
    for (let s = 0; s < shelves; s++) {
      const row = String.fromCharCode(65 + r)
      cells.push({ _idx: ++_cellIdx, id: `${row}-${s + 1}`, custom: '' })
    }
  }
  return cells
}

export default function CellConstructorPage() {
  const navigate = useNavigate()
  const [step, setStep] = useState(0)
  const [name, setName] = useState('')
  const [selectedCats, setSelectedCats] = useState([])
  const [customCat, setCustomCat] = useState('')
  const [rows, setRows] = useState(3)
  const [shelves, setShelves] = useState(6)
  const [cells, setCells] = useState([])
  const [warehouseList, setWarehouseList] = useState([])
  const [warehouseId, setWarehouseId] = useState('')
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState('')
  const [created, setCreated] = useState(null)
  const [sectionType, setSectionType] = useState('shelf') // shelf | hanger
  const [showNewWh, setShowNewWh] = useState(false)
  const [newWhName, setNewWhName] = useState('')
  const [newWhAddress, setNewWhAddress] = useState('')
  const [newWhSaving, setNewWhSaving] = useState(false)

  useEffect(() => {
    warehousesApi.list().then(d => {
      setWarehouseList(d.warehouses || [])
      if (d.warehouses?.length) setWarehouseId(String(d.warehouses[0].id))
    }).catch(() => {})
  }, [])

  function toggleCat(c) {
    setSelectedCats(prev =>
      prev.includes(c) ? prev.filter(x => x !== c) : [...prev, c]
    )
  }

  function handleNext() {
    if (step === 1) setCells(genCells(rows, shelves))
    setStep(s => s + 1)
  }

  function updateCellCode(idx, value) {
    setCells(cs => cs.map(c => c._idx === idx ? { ...c, id: value || c.id } : c))
  }

  const finalCategories = selectedCats.includes('Своя категория')
    ? [...selectedCats.filter(c => c !== 'Своя категория'), customCat].filter(Boolean)
    : selectedCats

  async function handleCreate() {
    setSaving(true)
    setSaveError('')
    try {
      const data = await warehousesApi.createSection({
        warehouse_id: warehouseId,
        name,
        category: finalCategories.join(', '),
        rows,
        shelves,
        cells,
        type: sectionType,
      })
      setCreated(data.section)
      setStep(4)
    } catch (err) {
      setSaveError(err.message || 'Ошибка')
    } finally {
      setSaving(false)
    }
  }

  const canProceedStep0 = name && selectedCats.length > 0 && warehouseId &&
    (!selectedCats.includes('custom') || customCat.trim())

  return (
    <WarehouseLayout>
      <div style={{ padding: '24px 32px', maxWidth: 680 }}>
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 28 }}>
          <button onClick={() => step > 0 ? setStep(s => s - 1) : navigate('/cells')}
            style={{ background: 'none', border: 'none', fontSize: 20, cursor: 'pointer', color: 'var(--muted)' }}>
            ←
          </button>
          <h1 style={{ fontSize: 18, fontWeight: 600 }}>Конструктор секции</h1>
        </div>

        {/* Steps */}
        <div style={{ display: 'flex', gap: 0, marginBottom: 32 }}>
          {STEPS.map((s, i) => (
            <div key={s} style={{ flex: 1, display: 'flex', alignItems: 'center' }}>
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', flex: 1 }}>
                <div style={{
                  width: 26, height: 26, borderRadius: '50%',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 11, fontWeight: 600,
                  background: i < step ? 'var(--green)' : i === step ? 'var(--blue)' : 'var(--border)',
                  color: i <= step ? '#fff' : 'var(--muted)',
                  transition: 'all 0.2s',
                }}>
                  {i < step ? '✓' : i + 1}
                </div>
                <div style={{ fontSize: 10, marginTop: 4, color: i === step ? 'var(--blue)' : 'var(--muted)', fontWeight: i === step ? 600 : 400 }}>
                  {s}
                </div>
              </div>
              {i < STEPS.length - 1 && (
                <div style={{ height: 2, flex: 1, background: i < step ? 'var(--green)' : 'var(--border)', marginBottom: 18, transition: 'background 0.2s' }} />
              )}
            </div>
          ))}
        </div>

        {/* Step 0 — name + categories + warehouse */}
        {step === 0 && (
          <div>
            <div style={{ marginBottom: 16 }}>
              <div style={{ fontSize: 12, fontWeight: 500, marginBottom: 6, color: 'var(--muted)' }}>Склад</div>
              <div style={{ display: 'flex', gap: 8 }}>
                <select value={warehouseId} onChange={e => setWarehouseId(e.target.value)}
                  style={{ flex: 1, height: 38, padding: '0 10px', border: '1px solid var(--border)', borderRadius: 'var(--radius-btn)', fontSize: 13, background: 'var(--white)' }}>
                  {warehouseList.map(w => <option key={w.id} value={w.id}>{w.name}{w.address ? ` — ${w.address}` : ''}</option>)}
                </select>
                <button onClick={() => setShowNewWh(true)} style={{
                  height: 38, padding: '0 14px', border: '1px solid var(--border)',
                  borderRadius: 'var(--radius-btn)', fontSize: 13, background: 'var(--white)',
                  cursor: 'pointer', color: 'var(--blue)', fontWeight: 500, whiteSpace: 'nowrap',
                }}>+ Новый</button>
              </div>
            </div>
            <div style={{ marginBottom: 16 }}>
              <div style={{ fontSize: 13, fontWeight: 500, marginBottom: 8 }}>Тип хранения</div>
              <div style={{ display: 'flex', gap: 8 }}>
                {[{ key: 'shelf', label: 'Полка / Стеллаж' }, { key: 'hanger', label: 'Вешалка' }].map(t => (
                  <button key={t.key} onClick={() => setSectionType(t.key)} style={{
                    padding: '8px 18px', borderRadius: 'var(--radius-badge)',
                    border: `1px solid ${sectionType === t.key ? 'var(--blue)' : 'var(--border)'}`,
                    background: sectionType === t.key ? 'var(--blue-dim)' : 'var(--white)',
                    color: sectionType === t.key ? 'var(--blue)' : 'var(--text)',
                    fontSize: 13, cursor: 'pointer', fontWeight: 500, transition: 'all 0.15s',
                  }}>{t.label}</button>
                ))}
              </div>
            </div>
            <Input label="Название секции" placeholder="А · Реквизит" value={name} onChange={e => setName(e.target.value)} />
            <div style={{ marginBottom: 16 }}>
              <div style={{ fontSize: 13, fontWeight: 500, marginBottom: 8 }}>Категории <span style={{ color: 'var(--muted)', fontSize: 11 }}>(выберите одну или несколько)</span></div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                {CATEGORIES.map(c => {
                  const sel = selectedCats.includes(c)
                  return (
                    <button key={c} onClick={() => toggleCat(c)} style={{
                      padding: '6px 14px', borderRadius: 'var(--radius-badge)',
                      border: `1px solid ${sel ? 'var(--blue)' : 'var(--border)'}`,
                      background: sel ? 'var(--blue-dim)' : 'var(--white)',
                      color: sel ? 'var(--blue)' : 'var(--text)',
                      fontSize: 13, cursor: 'pointer', transition: 'all 0.15s',
                    }}>{c === 'custom' ? 'Своя категория' : categoryLabel(c)}</button>
                  )
                })}
              </div>
              {selectedCats.includes('custom') && (
                <input
                  value={customCat} onChange={e => setCustomCat(e.target.value)}
                  placeholder="Введите название категории"
                  style={{
                    marginTop: 10, width: '100%', height: 40, padding: '0 12px',
                    border: '1px solid var(--border)', borderRadius: 'var(--radius-btn)',
                    fontSize: 14, outline: 'none',
                  }}
                />
              )}
            </div>
            <Button fullWidth disabled={!canProceedStep0} onClick={handleNext}>
              Далее — Размер
            </Button>
          </div>
        )}

        {/* Step 1 — rows + shelves */}
        {step === 1 && (
          <div>
            <div style={{ fontWeight: 600, marginBottom: 20 }}>Количество рядов и полок</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 24 }}>
              <div>
                <div style={{ fontSize: 13, fontWeight: 500, marginBottom: 8 }}>Рядов (строк)</div>
                <NumberStepper value={rows} min={1} max={26} onChange={setRows} />
              </div>
              <div>
                <div style={{ fontSize: 13, fontWeight: 500, marginBottom: 8 }}>Полок (столбцов)</div>
                <NumberStepper value={shelves} min={1} max={20} onChange={setShelves} />
              </div>
            </div>

            <div style={{ marginBottom: 20 }}>
              <div style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 10 }}>
                Предпросмотр — {rows * shelves} полок
              </div>
              <div style={{
                display: 'grid',
                gridTemplateColumns: `repeat(${Math.min(shelves, 10)}, 1fr)`,
                gap: 4,
              }}>
                {genCells(rows, shelves).slice(0, rows * Math.min(shelves, 10)).map((c, i) => (
                  <div key={i} style={{
                    aspectRatio: '1', borderRadius: 6,
                    background: 'var(--bg)', border: '1px solid var(--border)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 9, color: 'var(--muted)',
                  }}>{c.id}</div>
                ))}
              </div>
            </div>

            <Button fullWidth onClick={handleNext}>Далее — Коды полок</Button>
          </div>
        )}

        {/* Step 2 — cell codes */}
        {step === 2 && (
          <div>
            <div style={{ fontWeight: 600, marginBottom: 4 }}>Коды полок</div>
            <div style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 20 }}>
              Измените коды если нужно — буква, цифра или комбинация
            </div>
            <div style={{
              display: 'grid',
              gridTemplateColumns: `repeat(${Math.min(shelves, 6)}, 1fr)`,
              gap: 8, marginBottom: 24,
            }}>
              {cells.map(c => (
                <input key={c._idx}
                  value={c.id}
                  onChange={e => updateCellCode(c._idx, e.target.value)}
                  style={{
                    height: 36, textAlign: 'center', fontSize: 12, fontWeight: 500,
                    border: '1px solid var(--border)', borderRadius: 6,
                    background: 'var(--white)', outline: 'none',
                  }}
                />
              ))}
            </div>
            <Button fullWidth onClick={handleNext}>Далее — Просмотр</Button>
          </div>
        )}

        {/* Step 3 — Просмотр (view only) */}
        {step === 3 && (
          <div>
            <div style={{ fontWeight: 600, marginBottom: 4 }}>Просмотр секции</div>
            <div style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 16 }}>
              {name} · {finalCategories.join(', ')} · {cells.length} полок
            </div>
            <div style={{
              display: 'grid',
              gridTemplateColumns: `repeat(${Math.min(shelves, 8)}, 1fr)`,
              gap: 6, marginBottom: 24,
            }}>
              {cells.map(c => (
                <div key={c.id} style={{
                  aspectRatio: '1', borderRadius: 8,
                  border: '1px solid var(--border)',
                  background: 'var(--bg)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 9, color: 'var(--muted)', fontWeight: 500,
                }}>
                  {c.id}
                </div>
              ))}
            </div>
            {saveError && <div style={{ color: 'var(--red)', fontSize: 13, marginBottom: 12 }}>{saveError}</div>}
            <Button fullWidth disabled={saving} onClick={handleCreate}>
              {saving ? 'Создание...' : 'Создать секцию'}
            </Button>
          </div>
        )}

        {/* Step 4 — done */}
        {step === 4 && (
          <div style={{ textAlign: 'center', padding: '40px 0' }}>
            <div style={{ fontSize: 48, marginBottom: 16 }}>✅</div>
            <div style={{ fontWeight: 600, fontSize: 18, marginBottom: 8 }}>Секция создана</div>
            <div style={{ color: 'var(--muted)', fontSize: 14, marginBottom: 8 }}>
              {name} · {finalCategories.join(', ')}
            </div>
            <div style={{ color: 'var(--muted)', fontSize: 13, marginBottom: 32 }}>
              {cells.length} полок · {rows} рядов × {shelves} полок
            </div>

            <div style={{
              display: 'grid',
              gridTemplateColumns: `repeat(${Math.min(shelves, 8)}, 1fr)`,
              gap: 6, marginBottom: 32,
            }}>
              {cells.map(c => (
                <div key={c.id} style={{
                  aspectRatio: '1', borderRadius: 6,
                  background: 'var(--green-dim)', border: '1px solid var(--green)',
                  display: 'flex', flexDirection: 'column',
                  alignItems: 'center', justifyContent: 'center',
                  fontSize: 9, color: 'var(--green)',
                }}>
                  {c.custom || c.id}
                </div>
              ))}
            </div>

            <Button fullWidth onClick={() => navigate('/cells')}>Перейти к карте полок</Button>
          </div>
        )}
      </div>

      {showNewWh && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 400, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}
          onClick={() => setShowNewWh(false)}>
          <div style={{ background: 'var(--white)', borderRadius: 'var(--radius-card)', padding: 24, maxWidth: 400, width: '100%' }}
            onClick={e => e.stopPropagation()}>
            <div style={{ fontWeight: 600, fontSize: 16, marginBottom: 16 }}>Новый склад</div>
            <div style={{ fontSize: 12, fontWeight: 500, marginBottom: 6, color: 'var(--muted)' }}>Название</div>
            <input value={newWhName} onChange={e => setNewWhName(e.target.value)}
              placeholder="Например: Вирки 22"
              style={{ width: '100%', height: 38, padding: '0 10px', border: '1px solid var(--border)', borderRadius: 'var(--radius-btn)', fontSize: 13, marginBottom: 12, outline: 'none', boxSizing: 'border-box' }} />
            <div style={{ fontSize: 12, fontWeight: 500, marginBottom: 6, color: 'var(--muted)' }}>Адрес</div>
            <input value={newWhAddress} onChange={e => setNewWhAddress(e.target.value)}
              placeholder="ул. Вирки 22, г. Москва"
              style={{ width: '100%', height: 38, padding: '0 10px', border: '1px solid var(--border)', borderRadius: 'var(--radius-btn)', fontSize: 13, marginBottom: 16, outline: 'none', boxSizing: 'border-box' }} />
            <div style={{ display: 'flex', gap: 8 }}>
              <Button variant="secondary" fullWidth onClick={() => setShowNewWh(false)}>Отмена</Button>
              <Button fullWidth disabled={!newWhName.trim() || newWhSaving} onClick={async () => {
                setNewWhSaving(true)
                try {
                  const data = await warehousesApi.create({ name: newWhName.trim(), address: newWhAddress.trim() || undefined })
                  const wh = data.warehouse
                  setWarehouseList(prev => [...prev, wh])
                  setWarehouseId(String(wh.id))
                  setShowNewWh(false)
                  setNewWhName('')
                  setNewWhAddress('')
                } catch (e) { alert(e.message || 'Ошибка') }
                setNewWhSaving(false)
              }}>{newWhSaving ? 'Создание...' : 'Создать'}</Button>
            </div>
          </div>
        </div>
      )}
    </WarehouseLayout>
  )
}

function NumberStepper({ value, min, max, onChange }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 0, border: '1px solid var(--border)', borderRadius: 'var(--radius-btn)', overflow: 'hidden', width: 'fit-content' }}>
      <button onClick={() => onChange(Math.max(min, value - 1))} style={{
        width: 40, height: 40, border: 'none', background: 'var(--bg)',
        fontSize: 18, cursor: 'pointer', color: 'var(--muted)',
      }}>−</button>
      <span style={{ width: 48, textAlign: 'center', fontWeight: 600, fontSize: 16 }}>{value}</span>
      <button onClick={() => onChange(Math.min(max, value + 1))} style={{
        width: 40, height: 40, border: 'none', background: 'var(--bg)',
        fontSize: 18, cursor: 'pointer', color: 'var(--muted)',
      }}>+</button>
    </div>
  )
}
