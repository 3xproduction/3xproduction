import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import WarehouseLayout from '../warehouse/WarehouseLayout'
import ProductionLayout from '../production/ProductionLayout'
import { useAuth } from '../../hooks/useAuth'
import { ROLES } from '../../constants/roles'
import Badge from '../shared/Badge'
import Button from '../shared/Button'
import Input from '../shared/Input'
import SignatureCanvas from '../shared/SignatureCanvas'
import PhotoUpload from '../shared/PhotoUpload'
import { categoryLabel, CATEGORIES_FILTER } from '../../constants/categories'
import { rent as rentApi, units as unitsApi, warehouses as warehousesApi } from '../../services/api'

const DEAL_FILTERS = ['Все', 'Активные', 'Завершённые', 'Сдали']

export default function RentPage() {
  const { user } = useAuth()
  const Layout = ROLES[user?.role]?.world === 'production' ? ProductionLayout : WarehouseLayout
  const [tab, setTab] = useState('list')
  const [dealFilter, setDealFilter] = useState('Все')
  const [deals, setDeals] = useState([])
  const [loading, setLoading] = useState(true)

  function loadDeals() {
    rentApi.list().then(data => setDeals(data.deals || [])).finally(() => setLoading(false))
  }

  useEffect(() => { loadDeals() }, [])

  const filtered = deals.filter(d => {
    if (dealFilter === 'Все') return true
    if (dealFilter === 'Активные') return d.status === 'active' || d.status === 'overdue'
    if (dealFilter === 'Завершённые') return d.status === 'done'
    if (dealFilter === 'Сдали') return d.type === 'out'
    return true
  })

  return (
    <Layout>
      <div style={{ padding: '24px 32px', maxWidth: 900 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 }}>
          <h1 style={{ fontSize: 20, fontWeight: 600 }}>Аренда</h1>
        </div>

        <div style={{ display: 'flex', gap: 0, marginBottom: 24, borderBottom: '2px solid var(--border)' }}>
          {[['list', 'Все сделки'], ['new', 'Новая сделка']].map(([key, label]) => (
            <button key={key} onClick={() => setTab(key)} style={{
              padding: '10px 20px', border: 'none', background: 'none',
              fontWeight: 500, fontSize: 14, cursor: 'pointer',
              color: tab === key ? 'var(--blue)' : 'var(--muted)',
              borderBottom: `2px solid ${tab === key ? 'var(--blue)' : 'transparent'}`,
              marginBottom: -2,
            }}>{label}</button>
          ))}
        </div>

        {tab === 'list' && <DealsList deals={filtered} allDeals={deals} filter={dealFilter} setFilter={setDealFilter} loading={loading} onRefresh={loadDeals} />}
        {tab === 'new' && <NewDeal onDone={() => { setTab('list'); loadDeals() }} />}
      </div>
    </Layout>
  )
}

function DealsList({ deals, allDeals, filter, setFilter, loading, onRefresh }) {
  const activeCount = allDeals.filter(d => d.status === 'active').length
  const monthSum = allDeals.filter(d => d.status !== 'cancelled').reduce((a, d) => a + (Number(d.price_total) || 0), 0)
  const overdueCount = allDeals.filter(d => d.status === 'overdue').length
  const [returnDeal, setReturnDeal] = useState(null)

  return (
    <div>
      <div className="resp-3-col" style={{ marginBottom: 24 }}>
        <StatCard icon="🤝" label="Активных сделок" value={activeCount} color="blue" />
        <StatCard icon="💰" label="Выручка" value={monthSum.toLocaleString('ru-RU') + ' ₽'} color="green" />
        <StatCard icon="⚠️" label="Просрочено" value={overdueCount} color="red" />
      </div>

      <div style={{ display: 'flex', gap: 6, marginBottom: 20, flexWrap: 'wrap' }}>
        {DEAL_FILTERS.map(f => (
          <button key={f} onClick={() => setFilter(f)} style={{
            height: 32, padding: '0 14px', borderRadius: 'var(--radius-badge)',
            border: `1px solid ${filter === f ? 'var(--blue)' : 'var(--border)'}`,
            background: filter === f ? 'var(--blue-dim)' : 'var(--white)',
            color: filter === f ? 'var(--blue)' : 'var(--muted)',
            fontSize: 13, fontWeight: filter === f ? 500 : 400, cursor: 'pointer',
          }}>{f}</button>
        ))}
      </div>

      {loading && <div style={{ color: 'var(--muted)', fontSize: 13, padding: '20px 0' }}>Загрузка...</div>}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {deals.map(d => (
          <div key={d.id} style={{
            background: 'var(--white)', borderRadius: 'var(--radius-card)',
            border: '1px solid var(--border)', padding: '16px',
            display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap',
            cursor: 'pointer',
          }}
            onMouseEnter={e => e.currentTarget.style.boxShadow = '0 2px 8px rgba(0,0,0,0.07)'}
            onMouseLeave={e => e.currentTarget.style.boxShadow = 'none'}
          >
            <div style={{
              width: 40, height: 40, borderRadius: '50%', flexShrink: 0,
              background: d.type === 'out' ? 'var(--blue-dim)' : 'var(--green-dim)',
              display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18,
            }}>
              {d.type === 'out' ? '↗' : '↙'}
            </div>

            <div style={{ flex: 1, minWidth: 140 }}>
              <div style={{ fontWeight: 500, fontSize: 14 }}>{d.counterparty_name}</div>
              <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>
                {d.counterparty_type === 'company' ? 'Компания' : 'Физлицо'} · {d.type === 'out' ? 'Сдаём' : 'Берём'}
              </div>
            </div>

            <div style={{ fontSize: 12, color: 'var(--muted)', flexShrink: 0 }}>
              {new Date(d.period_start).toLocaleDateString('ru-RU')} — {new Date(d.period_end).toLocaleDateString('ru-RU')}
            </div>

            {d.price_total && (
              <div style={{ fontWeight: 600, fontSize: 14, flexShrink: 0 }}>
                {Number(d.price_total).toLocaleString('ru-RU')} ₽
              </div>
            )}

            <Badge color={d.status === 'active' ? 'blue' : d.status === 'done' ? 'green' : 'red'}>
              {d.status === 'active' ? 'Активна' : d.status === 'done' ? 'Завершена' : d.status === 'overdue' ? 'Просрочено' : 'Отменена'}
            </Badge>
            {d.sign_token && (
              <Badge color={d.sign_status === 'signed' ? 'green' : 'amber'}>
                {d.sign_status === 'signed' ? '✓ Подписано' : 'Ожидает подписи'}
              </Badge>
            )}
            {(d.status === 'active' || d.status === 'overdue') && (
              <button
                onClick={(e) => { e.stopPropagation(); setReturnDeal(d) }}
                style={{
                  padding: '5px 12px', fontSize: 12, fontWeight: 500,
                  color: 'var(--green)', background: 'var(--green-dim)',
                  border: '1px solid var(--green)', borderRadius: 6, cursor: 'pointer',
                }}>
                Возврат
              </button>
            )}
          </div>
        ))}
        {!loading && deals.length === 0 && (
          <div style={{ textAlign: 'center', padding: '60px 0', color: 'var(--muted)', fontSize: 14 }}>Нет сделок</div>
        )}
      </div>

      {returnDeal && (
        <RentReturnModal deal={returnDeal} onClose={() => setReturnDeal(null)} onDone={() => { setReturnDeal(null); onRefresh() }} />
      )}
    </div>
  )
}

const CONDITIONS = [
  { value: 'excellent', label: 'Отлично', color: 'var(--green)' },
  { value: 'good', label: 'Хорошее', color: 'var(--blue)' },
  { value: 'damaged', label: 'Повреждено', color: 'var(--red)' },
]

const RETURN_STEPS = ['Детали сделки', 'Фото и состояние', 'Подпись арендатора', 'Штамп принимающего']

function RentReturnModal({ deal, onClose, onDone }) {
  const [step, setStep] = useState(0)
  const [units, setUnits] = useState([])
  const [conditions, setConditions] = useState({})
  const [damages, setDamages] = useState({})
  const [photos, setPhotos] = useState({})
  const [renterSignature, setRenterSignature] = useState(null)
  const [acceptorStamped, setAcceptorStamped] = useState(false)
  const [returnSuccess, setReturnSuccess] = useState(false)
  const [loading, setLoading] = useState(false)
  const [unitsLoading, setUnitsLoading] = useState(true)

  useEffect(() => {
    if (!deal.unit_ids?.length) { setUnitsLoading(false); return }
    unitsApi.list().then(d => {
      const ids = deal.unit_ids.map(String)
      const found = (d.units || []).filter(u => ids.includes(String(u.id)))
      setUnits(found.length ? found : deal.unit_ids.map(id => ({ id, name: `Единица #${String(id).slice(0, 8)}` })))
    }).catch(() => {
      setUnits(deal.unit_ids.map(id => ({ id, name: `Единица #${String(id).slice(0, 8)}` })))
    }).finally(() => setUnitsLoading(false))
  }, [deal])

  function setPhoto(unitId, idx, file) {
    setPhotos(p => {
      const arr = [...(p[unitId] || [null, null])]
      arr[idx] = file
      return { ...p, [unitId]: arr }
    })
  }

  async function handleReturn(acceptorSignature) {
    setLoading(true)
    try {
      const allNotes = Object.entries(damages)
        .filter(([, v]) => v)
        .map(([id, v]) => {
          const u = units.find(u => String(u.id) === String(id))
          return `${u?.name || id}: ${v}`
        })
        .join('; ')
      await rentApi.return(deal.id, { condition_notes: allNotes || undefined })
      setReturnSuccess(true)
      setTimeout(() => onDone(), 2000)
    } catch (err) {
      alert(err.message || 'Ошибка возврата')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 500, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}
      onClick={onClose}>
      <div style={{ background: 'var(--white)', borderRadius: 'var(--radius-card)', padding: 28, maxWidth: 600, width: '100%', maxHeight: '90vh', overflowY: 'auto' }}
        onClick={e => e.stopPropagation()}>

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
          <div style={{ fontWeight: 600, fontSize: 16 }}>Возврат по аренде</div>
          <button onClick={onClose} style={{ border: 'none', background: 'none', cursor: 'pointer', color: 'var(--muted)', fontSize: 18 }}>✕</button>
        </div>

        {/* Step indicator */}
        <div style={{ display: 'flex', gap: 0, marginBottom: 24 }}>
          {RETURN_STEPS.map((s, i) => (
            <div key={s} style={{ flex: 1, display: 'flex', alignItems: 'center' }}>
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', flex: 1 }}>
                <div style={{
                  width: 26, height: 26, borderRadius: '50%', display: 'flex',
                  alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 600,
                  background: i < step ? 'var(--green)' : i === step ? 'var(--blue)' : 'var(--border)',
                  color: i <= step ? '#fff' : 'var(--muted)',
                }}>{i < step ? '✓' : i + 1}</div>
                <div style={{ fontSize: 10, color: i === step ? 'var(--blue)' : 'var(--muted)', marginTop: 3, fontWeight: i === step ? 600 : 400, textAlign: 'center' }}>{s}</div>
              </div>
              {i < RETURN_STEPS.length - 1 && <div style={{ height: 2, flex: 1, background: i < step ? 'var(--green)' : 'var(--border)', marginBottom: 16 }} />}
            </div>
          ))}
        </div>

        {/* Step 0 — deal details */}
        {step === 0 && (
          <div>
            <div style={{ background: 'var(--bg)', borderRadius: 10, padding: 16, marginBottom: 16 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                <span style={{ color: 'var(--muted)', fontSize: 13 }}>Контрагент</span>
                <span style={{ fontWeight: 500, fontSize: 13 }}>{deal.counterparty_name}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                <span style={{ color: 'var(--muted)', fontSize: 13 }}>Период</span>
                <span style={{ fontSize: 13 }}>{new Date(deal.period_start).toLocaleDateString('ru-RU')} — {new Date(deal.period_end).toLocaleDateString('ru-RU')}</span>
              </div>
              {deal.price_total && (
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: deal.deposit ? 8 : 0 }}>
                  <span style={{ color: 'var(--muted)', fontSize: 13 }}>Сумма</span>
                  <span style={{ fontWeight: 600, fontSize: 13 }}>{Number(deal.price_total).toLocaleString('ru-RU')} ₽</span>
                </div>
              )}
              {deal.deposit && (
                <div style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderTop: '1px solid var(--border)' }}>
                  <span style={{ color: 'var(--green)', fontSize: 13, fontWeight: 500 }}>Залог</span>
                  <span style={{ fontWeight: 600, fontSize: 13, color: 'var(--green)' }}>{Number(deal.deposit).toLocaleString('ru-RU')} ₽</span>
                </div>
              )}
            </div>
            <div style={{ fontWeight: 500, fontSize: 13, marginBottom: 8 }}>Единицы ({units.length})</div>
            {unitsLoading ? (
              <div style={{ color: 'var(--muted)', fontSize: 13 }}>Загрузка...</div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 16 }}>
                {units.map(u => (
                  <div key={u.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', border: '1px solid var(--border)', borderRadius: 8 }}>
                    <div style={{ width: 36, height: 36, borderRadius: 6, background: 'var(--bg)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16, flexShrink: 0, overflow: 'hidden' }}>
                      {u.photo_url ? <img src={u.photo_url} alt="" style={{ width: '100%', height: '100%', objectFit: 'contain' }} /> : '📦'}
                    </div>
                    <div>
                      <div style={{ fontWeight: 500, fontSize: 13 }}>{u.name}</div>
                      {u.serial && <div style={{ fontSize: 11, color: 'var(--muted)' }}>{u.serial}</div>}
                    </div>
                  </div>
                ))}
              </div>
            )}
            <Button fullWidth onClick={() => setStep(1)}>Далее — Фото и состояние</Button>
          </div>
        )}

        {/* Step 1 — photos + condition */}
        {step === 1 && (
          <div>
            <div style={{ fontWeight: 600, marginBottom: 4 }}>Фото и состояние при возврате</div>
            <div style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 16 }}>Зафиксируйте состояние каждой единицы</div>
            {units.map(u => (
              <div key={u.id} style={{ border: '1px solid var(--border)', borderRadius: 10, padding: 14, marginBottom: 14 }}>
                <div style={{ fontWeight: 500, fontSize: 13, marginBottom: 10 }}>{u.name}</div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 12 }}>
                  {[0, 1].map(i => (
                    <PhotoUpload key={i} label={`Фото ${i + 1}`} onChange={f => setPhoto(u.id, i, f)} />
                  ))}
                </div>
                <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
                  {CONDITIONS.map(c => (
                    <button key={c.value} onClick={() => setConditions(p => ({ ...p, [u.id]: c.value }))} style={{
                      flex: 1, height: 34, borderRadius: 'var(--radius-btn)',
                      border: `2px solid ${conditions[u.id] === c.value ? c.color : 'var(--border)'}`,
                      background: conditions[u.id] === c.value ? c.color + '15' : 'var(--white)',
                      color: conditions[u.id] === c.value ? c.color : 'var(--muted)',
                      fontSize: 12, fontWeight: 500, cursor: 'pointer',
                    }}>{c.label}</button>
                  ))}
                </div>
                {conditions[u.id] === 'damaged' && (
                  <textarea placeholder="Опишите повреждение..." value={damages[u.id] || ''}
                    onChange={e => setDamages(p => ({ ...p, [u.id]: e.target.value }))}
                    style={{ width: '100%', minHeight: 60, padding: '8px 10px', border: '1px solid var(--red)', borderRadius: 'var(--radius-btn)', fontSize: 12, resize: 'vertical', outline: 'none' }} />
                )}
              </div>
            ))}
            <div style={{ display: 'flex', gap: 8 }}>
              <Button variant="secondary" onClick={() => setStep(0)}>Назад</Button>
              <Button fullWidth onClick={() => setStep(2)}>Далее — Подпись</Button>
            </div>
          </div>
        )}

        {/* Step 2 — renter signature */}
        {step === 2 && (
          <div>
            <div style={{ fontWeight: 600, marginBottom: 4 }}>Подпись арендатора</div>
            <div style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 16 }}>{deal.counterparty_name}</div>
            <SignatureCanvas onSave={data => { setRenterSignature(data); setStep(3) }} />
            <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 10, textAlign: 'center' }}>Подпись лица, возвращающего имущество</div>
            <Button variant="secondary" fullWidth style={{ marginTop: 12 }} onClick={() => setStep(1)}>Назад</Button>
          </div>
        )}

        {/* Step 3 — acceptor stamp */}
        {step === 3 && !returnSuccess && (
          <div>
            <div style={{ fontWeight: 600, marginBottom: 4 }}>Подпись принимающего</div>
            <div style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 16 }}>Нажмите на поле чтобы поставить штамп сотрудника склада</div>
            <div onClick={() => setAcceptorStamped(true)} style={{
              width: '100%', height: 100, border: '2px dashed var(--border)',
              borderRadius: 'var(--radius-card)', display: 'flex', alignItems: 'center',
              justifyContent: 'center', cursor: 'pointer', marginBottom: 16,
              background: acceptorStamped ? 'var(--accent-dim)' : 'var(--bg)',
              borderColor: acceptorStamped ? 'var(--accent)' : 'var(--border)',
            }}>
              {acceptorStamped ? (
                <div style={{ textAlign: 'center' }}>
                  <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--accent)' }}>Штамп / Подпись</div>
                  <div style={{ fontSize: 12, color: 'var(--accent)', marginTop: 4 }}>Сотрудник склада</div>
                </div>
              ) : (
                <div style={{ color: 'var(--muted)', fontSize: 13 }}>Нажмите для подтверждения</div>
              )}
            </div>
            <Button fullWidth disabled={!acceptorStamped || loading} onClick={() => handleReturn('stamp')}>
              {loading ? 'Оформление...' : 'Оформить возврат'}
            </Button>
            <Button variant="secondary" fullWidth style={{ marginTop: 8 }} onClick={() => setStep(2)}>Назад</Button>
          </div>
        )}

        {returnSuccess && (
          <div style={{ textAlign: 'center', padding: '40px 0' }}>
            <div style={{ fontSize: 40, marginBottom: 12 }}>✅</div>
            <div style={{ fontWeight: 600, fontSize: 18, marginBottom: 6, color: 'var(--green)' }}>Успешно</div>
            <div style={{ fontSize: 13, color: 'var(--muted)' }}>Возврат оформлен, подписан обеими сторонами</div>
          </div>
        )}
      </div>
    </div>
  )
}

function NewDeal({ onDone }) {
  const [dealType, setDealType] = useState('out')
  const [cpType, setCpType] = useState('person')
  const [form, setForm] = useState({ name: '', contact: '', email: '' })
  const [availableUnits, setAvailableUnits] = useState([])
  const [selectedUnits, setSelectedUnits] = useState([])
  const [prices, setPrices] = useState({})
  const [dateStart, setDateStart] = useState('')
  const [dateEnd, setDateEnd] = useState('')
  const [step, setStep] = useState(1)
  const [loading, setLoading] = useState(false)
  const [signLink, setSignLink] = useState('')
  const [copied, setCopied] = useState(false)
  const [warehouseList, setWarehouseList] = useState([])
  const [whFilter, setWhFilter] = useState('')
  const [unitSearch, setUnitSearch] = useState('')
  const [unitCat, setUnitCat] = useState('all')
  const [dealPhotos, setDealPhotos] = useState([null, null])
  const [renterSig, setRenterSig] = useState(null)
  const [issuerStamped, setIssuerStamped] = useState(false)
  const [showDeposit, setShowDeposit] = useState(false)
  const [depositAmount, setDepositAmount] = useState('')

  useEffect(() => {
    unitsApi.list({ status: 'on_stock' }).then(data => setAvailableUnits(data.units || []))
    warehousesApi.list().then(d => setWarehouseList(d.warehouses || []))
  }, [])

  function setDealPhoto(i, file) {
    setDealPhotos(p => { const a = [...p]; a[i] = file; return a })
  }

  const filteredUnits = availableUnits.filter(u => {
    const matchWh = !whFilter || String(u.warehouse_id) === whFilter
    const matchSearch = !unitSearch || u.name.toLowerCase().includes(unitSearch.toLowerCase()) || (u.serial || '').toLowerCase().includes(unitSearch.toLowerCase())
    const matchCat = unitCat === 'all' || u.category === unitCat
    return matchWh && matchSearch && matchCat
  })

  function set(f) { return e => setForm(p => ({ ...p, [f]: e.target.value })) }

  function toggleUnit(id) {
    setSelectedUnits(s => s.includes(id) ? s.filter(x => x !== id) : [...s, id])
  }

  const days = dateStart && dateEnd ? Math.max(1, Math.ceil((new Date(dateEnd) - new Date(dateStart)) / 86400000)) : 0

  function calcTotal() {
    return selectedUnits.reduce((sum, id) => sum + (Number(prices[id]) || 0) * days, 0)
  }

  async function handleSign(signatureData) {
    setLoading(true)
    try {
      const data = await rentApi.create({
        type: dealType,
        counterparty_name: form.name,
        counterparty_type: cpType,
        counterparty_contact: form.contact,
        counterparty_email: form.email,
        inn: form.inn,
        legal_address: form.legal_address,
        extra_contact: form.extra_contact,
        unit_ids: selectedUnits,
        period_start: dateStart,
        period_end: dateEnd,
        price_total: calcTotal() || null,
        deposit: depositAmount || null,
        signature_data: signatureData,
      })
      const dealId = data.deal?.id
      if (dealId) {
        const firstUnitId = selectedUnits[0]
        if (firstUnitId) {
          for (const file of dealPhotos) {
            if (file) {
              const fd = new FormData()
              fd.append('photos', file)
              unitsApi.uploadPhoto(firstUnitId, fd).catch(() => {})
            }
          }
        }
      }
      setStep(6)
    } catch (err) {
      alert(err.message || 'Ошибка создания сделки')
    } finally {
      setLoading(false)
    }
  }

  function copyLink() {
    navigator.clipboard.writeText(signLink).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

  return (
    <div style={{ maxWidth: 560 }}>

      {step === 1 && (
        <div>
          <div style={{ fontWeight: 600, marginBottom: 14 }}>Данные контрагента</div>
          <div style={{ display: 'flex', gap: 6, marginBottom: 16 }}>
            {[['person', 'Физлицо'], ['company', 'Компания']].map(([key, label]) => (
              <button key={key} onClick={() => setCpType(key)} style={{
                padding: '6px 14px', borderRadius: 'var(--radius-badge)',
                border: `1px solid ${cpType === key ? 'var(--blue)' : 'var(--border)'}`,
                background: cpType === key ? 'var(--blue-dim)' : 'var(--white)',
                color: cpType === key ? 'var(--blue)' : 'var(--muted)',
                fontSize: 13, cursor: 'pointer',
              }}>{label}</button>
            ))}
          </div>
          <Input label={cpType === 'person' ? 'ФИО' : 'Название компании'} placeholder={cpType === 'person' ? 'Иванов Иван Иванович' : 'ООО «Реквизит+»'} value={form.name} onChange={set('name')} />
          {cpType === 'company' && (
            <>
              <Input label="ИНН" placeholder="1234567890" value={form.inn || ''} onChange={set('inn')} />
              <Input label="Юридический адрес" placeholder="г. Москва, ул. Примерная, д. 1" value={form.legal_address || ''} onChange={set('legal_address')} />
            </>
          )}
          <Input label="Контакт (телефон)" placeholder="+7 900 000 00 00" value={form.contact} onChange={set('contact')} />
          <Input label="Email" type="email" placeholder="client@example.com" value={form.email} onChange={set('email')} />
          <Input label="Дополнительный контакт" placeholder="Имя, телефон или email" value={form.extra_contact || ''} onChange={set('extra_contact')} />
          <Button fullWidth disabled={!form.name} onClick={() => setStep(2)} style={{ marginTop: 8 }}>
            Далее — Единицы
          </Button>
        </div>
      )}

      {step === 2 && (
        <div>
          <div style={{ fontWeight: 600, marginBottom: 14 }}>Единицы и период</div>

          {/* Search */}
          <div style={{ position: 'relative', marginBottom: 14 }}>
            <span style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--muted)', fontSize: 14 }}>🔍</span>
            <input value={unitSearch} onChange={e => setUnitSearch(e.target.value)}
              placeholder="Найдите по названию или серийному №..."
              style={{ width: '100%', height: 38, padding: '0 10px 0 32px', border: '1px solid var(--border)', borderRadius: 'var(--radius-btn)', fontSize: 13, outline: 'none', boxSizing: 'border-box' }} />
          </div>

          {/* Selected units bar */}
          {selectedUnits.length > 0 && (
            <div style={{ padding: '8px 12px', marginBottom: 12, borderRadius: 8, background: 'var(--blue-dim)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--blue)' }}>Выбрано: {selectedUnits.length} ед.</span>
              <button onClick={() => setSelectedUnits([])} style={{ fontSize: 12, color: 'var(--muted)', background: 'none', border: 'none', cursor: 'pointer' }}>Очистить</button>
            </div>
          )}

          {/* Units list — only show search results or selected */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 360, overflowY: 'auto', marginBottom: 14 }}>
            {(unitSearch ? filteredUnits : availableUnits.filter(u => selectedUnits.includes(u.id))).map(u => {
              const isSel = selectedUnits.includes(u.id)
              return (
                <div key={u.id} style={{
                  background: 'var(--white)', borderRadius: 'var(--radius-card)',
                  border: `1px solid ${isSel ? 'var(--blue)' : 'var(--border)'}`, overflow: 'hidden',
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 14px', cursor: 'pointer' }}
                    onClick={() => toggleUnit(u.id)}>
                    <div style={{
                      width: 44, height: 44, borderRadius: 6, flexShrink: 0,
                      background: 'var(--bg)', border: '1px solid var(--border)',
                      display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18, overflow: 'hidden',
                    }}>
                      {u.photo_url
                        ? <img src={u.photo_url} alt="" style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
                        : '📦'}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 500, fontSize: 13 }}>{u.name}</div>
                      <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 1 }}>
                        {u.serial && `${u.serial} · `}{categoryLabel(u.category)}
                      </div>
                    </div>
                    <div style={{
                      width: 22, height: 22, borderRadius: 4, flexShrink: 0,
                      border: `2px solid ${isSel ? 'var(--blue)' : 'var(--border)'}`,
                      background: isSel ? 'var(--blue)' : 'transparent',
                      display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: 12,
                    }}>{isSel ? '✓' : ''}</div>
                  </div>
                  {isSel && (
                    <div style={{ padding: '6px 14px 10px', display: 'flex', alignItems: 'center', gap: 8, borderTop: '1px solid var(--border)', background: 'var(--bg)' }}>
                      <input type="number" placeholder="Цена/сутки ₽" min="0"
                        value={prices[u.id] || ''}
                        onChange={e => setPrices(p => ({ ...p, [u.id]: e.target.value }))}
                        onClick={e => e.stopPropagation()}
                        style={{ width: 140, height: 32, padding: '0 10px', border: '1px solid var(--border)', borderRadius: 'var(--radius-btn)', fontSize: 12, outline: 'none' }}
                      />
                      <span style={{ fontSize: 11, color: 'var(--muted)' }}>₽ / сутки</span>
                    </div>
                  )}
                </div>
              )
            })}
            {unitSearch && filteredUnits.length === 0 && (
              <div style={{ textAlign: 'center', padding: '30px 0', color: 'var(--muted)', fontSize: 13 }}>Ничего не найдено</div>
            )}
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div>
              <div style={{ fontSize: 13, fontWeight: 500, marginBottom: 6 }}>Дата выдачи</div>
              <input type="date" value={dateStart} onChange={e => setDateStart(e.target.value)}
                style={{ width: '100%', height: 40, padding: '0 10px', border: '1px solid var(--border)', borderRadius: 'var(--radius-btn)', fontSize: 13, outline: 'none', boxSizing: 'border-box' }} />
            </div>
            <div>
              <div style={{ fontSize: 13, fontWeight: 500, marginBottom: 6 }}>Плановый возврат</div>
              <input type="date" value={dateEnd} onChange={e => setDateEnd(e.target.value)}
                style={{ width: '100%', height: 40, padding: '0 10px', border: '1px solid var(--border)', borderRadius: 'var(--radius-btn)', fontSize: 13, outline: 'none', boxSizing: 'border-box' }} />
            </div>
          </div>

          {days > 0 && selectedUnits.length > 0 && (
            <div style={{ marginTop: 12, padding: '14px 16px', borderRadius: 8, background: 'var(--green-dim)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: 13, color: 'var(--muted)' }}>{days} дн. · {selectedUnits.length} ед.</span>
              <span style={{ fontWeight: 700, color: 'var(--green)', fontSize: 16 }}>{calcTotal().toLocaleString('ru-RU')} ₽</span>
            </div>
          )}

          {/* Deposit */}
          <div style={{ marginTop: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
            <button onClick={() => setShowDeposit(v => !v)} style={{
              padding: '8px 14px', borderRadius: 'var(--radius-btn)', fontSize: 13, fontWeight: 500, cursor: 'pointer',
              border: '1px solid var(--border)', background: showDeposit ? 'var(--green-dim)' : 'var(--white)', color: showDeposit ? 'var(--green)' : 'var(--text)',
            }}>
              {showDeposit ? '✓ Залог' : '+ Залог'}
            </button>
            {showDeposit && (
              <input type="number" placeholder="Сумма залога ₽" value={depositAmount}
                onChange={e => setDepositAmount(e.target.value)}
                style={{ flex: 1, height: 38, padding: '0 10px', border: '2px solid var(--green)', borderRadius: 'var(--radius-btn)', fontSize: 13, outline: 'none', background: 'var(--green-dim)', boxSizing: 'border-box' }} />
            )}
          </div>

          <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
            <Button variant="secondary" onClick={() => setStep(1)}>Назад</Button>
            <Button fullWidth disabled={selectedUnits.length === 0 || !dateStart || !dateEnd || calcTotal() === 0} onClick={() => setStep(3)}>
              Далее — Фото
            </Button>
          </div>
        </div>
      )}

      {step === 3 && (
        <div>
          <div style={{ fontWeight: 600, marginBottom: 4 }}>Фото к сделке</div>
          <div style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 20 }}>Минимум 2 фото — состояние имущества при передаче</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 12, marginBottom: 24 }}>
            {[0, 1].map(i => (
              <PhotoUpload key={i} label={`Фото ${i + 1}`} onChange={f => setDealPhoto(i, f)} />
            ))}
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <Button variant="secondary" onClick={() => setStep(2)}>Назад</Button>
            <Button fullWidth onClick={() => setStep(4)}>Далее — Подпись</Button>
          </div>
        </div>
      )}

      {step === 4 && (
        <div>
          <div style={{ fontWeight: 600, marginBottom: 4 }}>Подпись арендатора</div>
          <div style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 16 }}>{form.name}</div>
          <SignatureCanvas onSave={data => { setRenterSig(data); setStep(5) }} />
          <Button variant="secondary" fullWidth style={{ marginTop: 12 }} onClick={() => setStep(3)}>Назад</Button>
        </div>
      )}

      {step === 5 && (
        <div>
          <div style={{ fontWeight: 600, marginBottom: 4 }}>Подпись выдавшего</div>
          <div style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 16 }}>Нажмите на поле чтобы поставить штамп сотрудника склада</div>
          <div onClick={() => setIssuerStamped(true)} style={{
            width: '100%', height: 100, border: '2px dashed var(--border)',
            borderRadius: 'var(--radius-card)', display: 'flex', alignItems: 'center',
            justifyContent: 'center', cursor: 'pointer', marginBottom: 16,
            background: issuerStamped ? 'var(--accent-dim)' : 'var(--bg)',
            borderColor: issuerStamped ? 'var(--accent)' : 'var(--border)',
          }}>
            {issuerStamped ? (
              <div style={{ textAlign: 'center' }}>
                <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--accent)' }}>Штамп / Подпись</div>
                <div style={{ fontSize: 12, color: 'var(--accent)', marginTop: 4 }}>Сотрудник склада</div>
              </div>
            ) : (
              <div style={{ color: 'var(--muted)', fontSize: 13 }}>Нажмите для подтверждения</div>
            )}
          </div>
          <Button fullWidth disabled={!issuerStamped || loading} onClick={() => handleSign(renterSig)}>
            {loading ? 'Создание сделки...' : 'Оформить сделку'}
          </Button>
          <Button variant="secondary" fullWidth style={{ marginTop: 8 }} onClick={() => setStep(4)}>Назад</Button>
        </div>
      )}

      {step === 6 && (
        <div style={{ textAlign: 'center', padding: '40px 0' }}>
          <div style={{ fontSize: 40, marginBottom: 12 }}>✅</div>
          <div style={{ fontWeight: 600, fontSize: 18, marginBottom: 6, color: 'var(--green)' }}>Успешно</div>
          <div style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 24 }}>Договор аренды подписан обеими сторонами и сформирован</div>
          <Button fullWidth onClick={onDone}>К списку сделок</Button>
        </div>
      )}
    </div>
  )
}

function StatCard({ icon, label, value, color }) {
  const bg = { blue: 'var(--blue-dim)', green: 'var(--green-dim)', red: 'var(--red-dim)' }
  const clr = { blue: 'var(--blue)', green: 'var(--green)', red: 'var(--red)' }
  return (
    <div style={{ background: 'var(--white)', border: '1px solid var(--border)', borderRadius: 'var(--radius-card)', padding: 16 }}>
      <div style={{ width: 36, height: 36, borderRadius: 8, background: bg[color], display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16, marginBottom: 10 }}>{icon}</div>
      <div style={{ fontSize: 20, fontWeight: 700, color: clr[color] }}>{value}</div>
      <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>{label}</div>
    </div>
  )
}
