import { useState, useEffect } from 'react'
import { useParams } from 'react-router-dom'
import { ShoppingCart, X, Minus, Plus, ChevronDown, ChevronUp, Package, Clock, CheckCircle, RotateCcw } from 'lucide-react'
import Badge from '../shared/Badge'
import Button from '../shared/Button'

const BASE = import.meta.env.VITE_API_URL || ''

const CABINET_TABS = [
  { key: 'catalog', label: 'Каталог', icon: Package },
  { key: 'pending', label: 'На рассмотрении', icon: Clock },
  { key: 'active', label: 'Получено', icon: CheckCircle },
  { key: 'done', label: 'Возвращено', icon: RotateCcw },
]

const DEAL_STATUS = {
  pending_review: { label: 'На рассмотрении', color: 'amber' },
  active:         { label: 'Получено',        color: 'green' },
  done:           { label: 'Возвращено',      color: 'blue' },
  cancelled:      { label: 'Отклонено',       color: 'red' },
  overdue:        { label: 'Просрочено',      color: 'red' },
}

export default function PublicWarehousePage() {
  const { token } = useParams()
  const [step, setStep] = useState('auth') // auth | cabinet
  const [cpType, setCpType] = useState('person')
  const [form, setForm] = useState({ name: '', phone: '', email: '', project_name: '', inn: '', legal_address: '', extra_contact: '' })
  const [units, setUnits] = useState([])
  const [loadError, setLoadError] = useState(null)
  const [search, setSearch] = useState('')
  const [category, setCategory] = useState('Все')

  // Cabinet
  const [cabTab, setCabTab] = useState('catalog')
  const [deals, setDeals] = useState([])
  const [dealsLoading, setDealsLoading] = useState(false)

  // Cart
  const [cart, setCart] = useState([])
  const [showCart, setShowCart] = useState(false)
  const [cartMessage, setCartMessage] = useState('')
  const [periodStart, setPeriodStart] = useState('')
  const [periodEnd, setPeriodEnd] = useState('')
  const [sending, setSending] = useState(false)

  // Confirm modal
  const [showConfirm, setShowConfirm] = useState(false)
  const [showSuccess, setShowSuccess] = useState(false)

  useEffect(() => {
    fetch(`${BASE}/public/warehouse/${token}`)
      .then(r => r.json())
      .then(d => {
        if (d.error) { setLoadError(d.error); return }
        setUnits(d.units || [])
      })
      .catch(() => setLoadError('Не удалось загрузить каталог'))
  }, [token])

  function loadDeals() {
    if (!form.phone) return
    setDealsLoading(true)
    fetch(`${BASE}/public/warehouse/${token}/my-deals?phone=${encodeURIComponent(form.phone)}`)
      .then(r => r.json())
      .then(d => setDeals(d.deals || []))
      .catch(() => {})
      .finally(() => setDealsLoading(false))
  }

  useEffect(() => {
    if (step === 'cabinet') loadDeals()
  }, [step, cabTab]) // eslint-disable-line react-hooks/exhaustive-deps

  const categories = ['Все', ...new Set(units.map(u => u.category).filter(Boolean))]
  const filtered = units.filter(u => {
    const matchSearch = !search || u.name.toLowerCase().includes(search.toLowerCase())
    const matchCat = category === 'Все' || u.category === category
    return matchSearch && matchCat
  })

  const inCart = id => cart.includes(id)
  const toggleCart = id => setCart(prev => inCart(id) ? prev.filter(x => x !== id) : [...prev, id])
  const cartUnits = units.filter(u => cart.includes(u.id))

  function set(f) { return e => setForm(p => ({ ...p, [f]: e.target.value })) }

  function enterCabinet() {
    if (!form.name || !form.phone) return
    setStep('cabinet')
  }

  function openConfirm() {
    setShowCart(false)
    setShowConfirm(true)
  }

  async function submitCart() {
    setSending(true)
    try {
      const res = await fetch(`${BASE}/public/warehouse/${token}/cart-request`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: form.name, phone: form.phone, email: form.email || undefined,
          project_name: form.project_name || undefined,
          counterparty_type: cpType,
          inn: cpType === 'company' ? form.inn : undefined,
          legal_address: cpType === 'company' ? form.legal_address : undefined,
          extra_contact: form.extra_contact || undefined,
          unit_ids: cart,
          period_start: periodStart || undefined,
          period_end: periodEnd || undefined,
          message: cartMessage || undefined,
        }),
      })
      if (!res.ok) throw new Error()
      setShowConfirm(false)
      setShowSuccess(true)
      setTimeout(() => {
        setShowSuccess(false)
        setCart([])
        setCartMessage('')
        setPeriodStart('')
        setPeriodEnd('')
        setCabTab('pending')
        loadDeals()
      }, 2000)
    } catch {
      alert('Ошибка при отправке заявки')
    } finally {
      setSending(false)
    }
  }

  const filteredDeals = deals.filter(d => {
    if (cabTab === 'pending') return d.status === 'pending_review'
    if (cabTab === 'active') return d.status === 'active' || d.status === 'overdue'
    if (cabTab === 'done') return d.status === 'done' || d.status === 'cancelled'
    return false
  })

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg)', fontFamily: 'Inter, sans-serif' }}>
      {/* Header */}
      <div style={{ background: 'var(--black)', padding: '14px 24px', display: 'flex', alignItems: 'center', gap: 12 }}>
        <div style={{ fontSize: 18, fontWeight: 600, color: 'var(--white)' }}>
          <span style={{ color: 'var(--blue)' }}>3X</span>Media
        </div>
        <div style={{ fontSize: 9, letterSpacing: '1.4px', textTransform: 'uppercase', color: 'rgba(255,255,255,0.3)' }}>Production</div>
        {step === 'cabinet' && (
          <div style={{ marginLeft: 'auto', fontSize: 13, color: 'rgba(255,255,255,0.5)' }}>
            {form.name} · {form.phone}
          </div>
        )}
      </div>

      {/* Error */}
      {loadError && (
        <div style={{ textAlign: 'center', padding: '80px 24px' }}>
          <div style={{ fontSize: 52, marginBottom: 16 }}>❌</div>
          <h2 style={{ fontSize: 18, fontWeight: 600, marginBottom: 8 }}>Ссылка недействительна</h2>
          <p style={{ color: 'var(--muted)', fontSize: 14 }}>{loadError}</p>
        </div>
      )}

      {/* ─── AUTH ──────────────────────────────────────── */}
      {!loadError && step === 'auth' && (
        <div style={{ maxWidth: 440, margin: '0 auto', padding: '48px 24px' }}>
          <div style={{ background: 'var(--white)', borderRadius: 'var(--radius-card)', border: '1px solid var(--border)', padding: '36px 32px' }}>
            <div style={{ textAlign: 'center', marginBottom: 28 }}>
              <div style={{ fontSize: 36, marginBottom: 12 }}>🏪</div>
              <h1 style={{ fontSize: 18, fontWeight: 600, marginBottom: 8 }}>Каталог склада</h1>
              <p style={{ fontSize: 13, color: 'var(--muted)' }}>Введите данные для просмотра и оформления заявок</p>
            </div>

            {/* Type toggle */}
            <div style={{ display: 'flex', gap: 0, marginBottom: 20 }}>
              {[['person', 'Физлицо'], ['company', 'Компания']].map(([val, label]) => (
                <button key={val} onClick={() => setCpType(val)} style={{
                  flex: 1, padding: '9px 0', fontSize: 13, fontWeight: 500, cursor: 'pointer',
                  border: `1px solid ${cpType === val ? 'var(--blue)' : 'var(--border)'}`,
                  background: cpType === val ? 'var(--blue-dim)' : 'var(--white)',
                  color: cpType === val ? 'var(--blue)' : 'var(--muted)',
                  borderRadius: val === 'person' ? 'var(--radius-btn) 0 0 var(--radius-btn)' : '0 var(--radius-btn) var(--radius-btn) 0',
                }}>{label}</button>
              ))}
            </div>

            <FI label={cpType === 'company' ? 'Название компании *' : 'ФИО *'} value={form.name} onChange={set('name')} placeholder={cpType === 'company' ? 'ООО Рога и Копыта' : 'Иван Иванов'} />
            <FI label="Телефон *" value={form.phone} onChange={set('phone')} placeholder="+7 900 000 00 00" />
            <FI label="Email" value={form.email} onChange={set('email')} placeholder="email@example.com" type="email" />
            <FI label="Название проекта" value={form.project_name} onChange={set('project_name')} placeholder="Мой проект" />

            {cpType === 'company' && (
              <>
                <FI label="ИНН" value={form.inn} onChange={set('inn')} placeholder="1234567890" />
                <FI label="Юридический адрес" value={form.legal_address} onChange={set('legal_address')} placeholder="г. Москва, ул. ..." />
                <FI label="Дополнительный контакт" value={form.extra_contact} onChange={set('extra_contact')} placeholder="Имя, телефон или email" />
              </>
            )}

            <Button fullWidth disabled={!form.name || !form.phone} onClick={enterCabinet} style={{ marginTop: 8 }}>
              Войти в каталог
            </Button>
          </div>
        </div>
      )}

      {/* ─── CABINET ──────────────────────────────────── */}
      {step === 'cabinet' && (
        <div style={{ maxWidth: 860, margin: '0 auto', padding: '24px 24px' }}>
          {/* Tabs */}
          <div style={{ display: 'flex', gap: 0, marginBottom: 24, borderBottom: '2px solid var(--border)', overflowX: 'auto' }}>
            {CABINET_TABS.map(t => {
              const Icon = t.icon
              const active = cabTab === t.key
              const count = t.key === 'pending' ? deals.filter(d => d.status === 'pending_review').length
                : t.key === 'active' ? deals.filter(d => d.status === 'active' || d.status === 'overdue').length
                : t.key === 'done' ? deals.filter(d => d.status === 'done' || d.status === 'cancelled').length
                : 0
              return (
                <button key={t.key} onClick={() => setCabTab(t.key)} style={{
                  padding: '10px 18px', border: 'none', background: 'none',
                  fontWeight: 500, fontSize: 13, cursor: 'pointer', whiteSpace: 'nowrap',
                  color: active ? 'var(--blue)' : 'var(--muted)',
                  borderBottom: `2px solid ${active ? 'var(--blue)' : 'transparent'}`,
                  marginBottom: -2, display: 'flex', alignItems: 'center', gap: 6,
                }}>
                  <Icon size={15} />
                  {t.label}
                  {count > 0 && t.key !== 'catalog' && (
                    <span style={{ background: active ? 'var(--blue)' : 'var(--border)', color: active ? '#fff' : 'var(--muted)', borderRadius: 10, padding: '1px 7px', fontSize: 11, fontWeight: 600 }}>{count}</span>
                  )}
                </button>
              )
            })}
          </div>

          {/* ─── Tab: Catalog ─── */}
          {cabTab === 'catalog' && (
            <div>
              <div style={{ display: 'flex', gap: 10, marginBottom: 20, flexWrap: 'wrap' }}>
                <div style={{ position: 'relative', flex: 1, minWidth: 180 }}>
                  <span style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--muted)' }}>🔍</span>
                  <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Поиск..."
                    style={{ width: '100%', height: 40, padding: '0 12px 0 36px', border: '1px solid var(--border)', borderRadius: 'var(--radius-btn)', fontSize: 14, background: 'var(--white)', outline: 'none' }} />
                </div>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  {categories.map(c => (
                    <button key={c} onClick={() => setCategory(c)} style={{
                      height: 40, padding: '0 14px', borderRadius: 'var(--radius-btn)',
                      border: `1px solid ${category === c ? 'var(--blue)' : 'var(--border)'}`,
                      background: category === c ? 'var(--blue-dim)' : 'var(--white)',
                      color: category === c ? 'var(--blue)' : 'var(--muted)',
                      fontSize: 13, cursor: 'pointer',
                    }}>{c}</button>
                  ))}
                </div>
              </div>

              {filtered.length === 0 && (
                <div style={{ textAlign: 'center', padding: '60px 0', color: 'var(--muted)', fontSize: 14 }}>Нет позиций</div>
              )}

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 14 }}>
                {filtered.map(u => {
                  const added = inCart(u.id)
                  const available = u.status === 'on_stock'
                  return (
                    <div key={u.id} style={{
                      background: 'var(--white)', borderRadius: 'var(--radius-card)',
                      border: `1px solid ${added ? 'var(--blue)' : 'var(--border)'}`,
                      overflow: 'hidden', transition: 'border-color 0.15s, box-shadow 0.15s',
                    }}
                      onMouseEnter={e => e.currentTarget.style.boxShadow = '0 2px 8px rgba(0,0,0,0.06)'}
                      onMouseLeave={e => e.currentTarget.style.boxShadow = 'none'}
                    >
                      <div style={{ height: 140, background: 'var(--bg)', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
                        {u.photos?.[0]
                          ? <img src={u.photos[0]} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                          : <Package size={36} style={{ color: 'var(--muted)', opacity: 0.3 }} />
                        }
                      </div>
                      <div style={{ padding: '12px 14px' }}>
                        <div style={{ fontWeight: 500, fontSize: 14, marginBottom: 4 }}>{u.name}</div>
                        {u.description && (
                          <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 8, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{u.description}</div>
                        )}
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                          <Badge color={available ? 'green' : 'muted'}>
                            {available ? 'Доступно' : 'Занято'}
                          </Badge>
                          {available && (
                            <button onClick={() => toggleCart(u.id)} style={{
                              display: 'flex', alignItems: 'center', gap: 4,
                              fontSize: 13, color: added ? 'var(--red)' : 'var(--blue)', background: 'none',
                              border: 'none', cursor: 'pointer', fontWeight: 500,
                            }}>
                              {added ? <><Minus size={14} /> Убрать</> : <><Plus size={14} /> В корзину</>}
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>

              {/* Floating cart */}
              {cart.length > 0 && (
                <button onClick={() => setShowCart(true)} style={{
                  position: 'fixed', bottom: 24, right: 24, zIndex: 100,
                  width: 56, height: 56, borderRadius: '50%',
                  background: 'var(--accent)', border: 'none', color: '#fff',
                  cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
                  boxShadow: '0 4px 16px rgba(0,0,0,0.2)',
                }}>
                  <ShoppingCart size={22} />
                  <span style={{
                    position: 'absolute', top: -4, right: -4,
                    background: 'var(--red)', color: '#fff', borderRadius: '50%',
                    width: 22, height: 22, fontSize: 11, fontWeight: 700,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                  }}>{cart.length}</span>
                </button>
              )}
            </div>
          )}

          {/* ─── Tab: Deals ─── */}
          {cabTab !== 'catalog' && (
            <div>
              {dealsLoading && <div style={{ textAlign: 'center', padding: '40px 0', color: 'var(--muted)', fontSize: 14 }}>Загрузка...</div>}
              {!dealsLoading && filteredDeals.length === 0 && (
                <div style={{ textAlign: 'center', padding: '60px 0', color: 'var(--muted)', fontSize: 14 }}>
                  {cabTab === 'pending' ? 'Нет заявок на рассмотрении' : cabTab === 'active' ? 'Нет полученного имущества' : 'Нет возвращённых заявок'}
                </div>
              )}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {filteredDeals.map(d => <DealCard key={d.id} deal={d} />)}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ─── CART MODAL ──────────────────────────────── */}
      {showCart && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 400, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}
          onClick={() => setShowCart(false)}>
          <div style={{ background: 'var(--white)', borderRadius: 'var(--radius-card)', padding: 24, maxWidth: 480, width: '100%', maxHeight: '85vh', overflowY: 'auto' }}
            onClick={e => e.stopPropagation()}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
              <div style={{ fontWeight: 600, fontSize: 16 }}>Корзина ({cart.length})</div>
              <button onClick={() => setShowCart(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--muted)', padding: 4 }}><X size={18} /></button>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 20 }}>
              {cartUnits.map(u => (
                <div key={u.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', border: '1px solid var(--border)', borderRadius: 'var(--radius-btn)' }}>
                  <div style={{ width: 40, height: 40, borderRadius: 6, background: 'var(--bg)', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', flexShrink: 0 }}>
                    {u.photos?.[0] ? <img src={u.photos[0]} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : <Package size={16} style={{ color: 'var(--muted)' }} />}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{u.name}</div>
                    <div style={{ fontSize: 11, color: 'var(--muted)' }}>{u.category}</div>
                  </div>
                  <button onClick={() => toggleCart(u.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--red)', padding: 4 }}><X size={16} /></button>
                </div>
              ))}
            </div>

            {/* Dates */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 12 }}>
              <div>
                <div style={{ fontSize: 12, fontWeight: 500, marginBottom: 4, color: 'var(--muted)' }}>Дата начала</div>
                <input type="date" value={periodStart} onChange={e => setPeriodStart(e.target.value)}
                  style={{ width: '100%', height: 38, padding: '0 10px', border: '1px solid var(--border)', borderRadius: 'var(--radius-btn)', fontSize: 13, background: 'var(--white)', outline: 'none', boxSizing: 'border-box' }} />
              </div>
              <div>
                <div style={{ fontSize: 12, fontWeight: 500, marginBottom: 4, color: 'var(--muted)' }}>Дата окончания</div>
                <input type="date" value={periodEnd} onChange={e => setPeriodEnd(e.target.value)}
                  style={{ width: '100%', height: 38, padding: '0 10px', border: '1px solid var(--border)', borderRadius: 'var(--radius-btn)', fontSize: 13, background: 'var(--white)', outline: 'none', boxSizing: 'border-box' }} />
              </div>
            </div>

            <div style={{ marginBottom: 16 }}>
              <div style={{ fontSize: 12, fontWeight: 500, marginBottom: 4, color: 'var(--muted)' }}>Комментарий</div>
              <textarea placeholder="Уточните детали: условия, пожелания..." value={cartMessage} onChange={e => setCartMessage(e.target.value)}
                style={{ width: '100%', minHeight: 70, padding: '10px 12px', border: '1px solid var(--border)', borderRadius: 'var(--radius-btn)', fontSize: 13, resize: 'vertical', outline: 'none', fontFamily: 'inherit', boxSizing: 'border-box' }} />
            </div>

            <Button fullWidth onClick={openConfirm}>
              Далее
            </Button>
          </div>
        </div>
      )}

      {/* ─── CONFIRM MODAL ───────────────────────────── */}
      {showConfirm && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 600, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}
          onClick={() => setShowConfirm(false)}>
          <div style={{ background: 'var(--white)', borderRadius: 16, padding: '28px 28px 22px', maxWidth: 420, width: '100%', boxShadow: '0 20px 60px rgba(0,0,0,0.15)' }}
            onClick={e => e.stopPropagation()}>
            <div style={{ textAlign: 'center', marginBottom: 20 }}>
              <div style={{ width: 52, height: 52, borderRadius: '50%', background: 'var(--blue-dim)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', marginBottom: 12 }}>
                <ShoppingCart size={24} style={{ color: 'var(--blue)' }} />
              </div>
              <h2 style={{ fontSize: 17, fontWeight: 600, marginBottom: 6 }}>Подтвердите заявку</h2>
              <p style={{ fontSize: 13, color: 'var(--muted)' }}>Проверьте данные перед отправкой</p>
            </div>

            {/* Summary */}
            <div style={{ background: 'var(--bg)', borderRadius: 'var(--radius-btn)', padding: '14px 16px', marginBottom: 16 }}>
              <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 8 }}>Единицы ({cartUnits.length})</div>
              {cartUnits.map(u => (
                <div key={u.id} style={{ fontSize: 13, fontWeight: 500, padding: '3px 0' }}>{u.name}</div>
              ))}
              {(periodStart || periodEnd) && (
                <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 8, paddingTop: 8, borderTop: '1px solid var(--border)' }}>
                  Сроки: {periodStart || '—'} — {periodEnd || '—'}
                </div>
              )}
              {cartMessage && (
                <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 4, fontStyle: 'italic' }}>{cartMessage}</div>
              )}
            </div>

            <div style={{ background: 'var(--bg)', borderRadius: 'var(--radius-btn)', padding: '12px 16px', marginBottom: 20, fontSize: 13 }}>
              <div style={{ fontWeight: 500 }}>{form.name}</div>
              <div style={{ color: 'var(--muted)', fontSize: 12 }}>{form.phone}{form.email ? ` · ${form.email}` : ''}</div>
              {form.project_name && <div style={{ color: 'var(--muted)', fontSize: 12 }}>Проект: {form.project_name}</div>}
            </div>

            <div style={{ display: 'flex', gap: 10 }}>
              <button onClick={() => setShowConfirm(false)} style={{
                flex: 1, padding: '11px 0', borderRadius: 'var(--radius-btn)', fontSize: 14, fontWeight: 500,
                border: '1px solid var(--border)', background: 'var(--white)', color: 'var(--text)', cursor: 'pointer',
              }}>Назад</button>
              <button onClick={submitCart} disabled={sending} style={{
                flex: 1, padding: '11px 0', borderRadius: 'var(--radius-btn)', fontSize: 14, fontWeight: 500,
                border: 'none', background: 'var(--accent)', color: '#fff', cursor: sending ? 'wait' : 'pointer',
                opacity: sending ? 0.7 : 1,
              }}>{sending ? 'Отправка...' : 'Подтвердить'}</button>
            </div>
          </div>
        </div>
      )}

      {/* ─── SUCCESS MODAL ───────────────────────────── */}
      {showSuccess && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 700, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ background: 'var(--white)', borderRadius: 16, padding: '40px 32px', maxWidth: 340, textAlign: 'center', boxShadow: '0 20px 60px rgba(0,0,0,0.15)', animation: 'pub-pop 0.3s ease' }}>
            <div style={{ width: 64, height: 64, borderRadius: '50%', background: 'var(--green-dim)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', marginBottom: 16 }}>
              <CheckCircle size={32} style={{ color: 'var(--green)' }} />
            </div>
            <h2 style={{ fontSize: 17, fontWeight: 600, marginBottom: 8 }}>Заявка отправлена</h2>
            <p style={{ fontSize: 13, color: 'var(--muted)' }}>Мы свяжемся с вами в ближайшее время</p>
          </div>
        </div>
      )}

      <style>{`
        @keyframes pub-pop {
          from { transform: scale(0.9); opacity: 0; }
          to { transform: scale(1); opacity: 1; }
        }
      `}</style>
    </div>
  )
}

/* ─── Deal Card ──────────────────────────────────── */
function DealCard({ deal }) {
  const [open, setOpen] = useState(false)
  const st = DEAL_STATUS[deal.status] || DEAL_STATUS.pending_review
  const dateStr = deal.period_start && deal.period_end
    ? `${new Date(deal.period_start).toLocaleDateString('ru-RU')} — ${new Date(deal.period_end).toLocaleDateString('ru-RU')}`
    : null

  return (
    <div style={{ background: 'var(--white)', borderRadius: 'var(--radius-card)', border: '1px solid var(--border)', overflow: 'hidden' }}>
      <div onClick={() => setOpen(!open)} style={{
        padding: '14px 16px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 12,
        transition: 'background 0.1s',
      }}
        onMouseEnter={e => e.currentTarget.style.background = 'var(--bg)'}
        onMouseLeave={e => e.currentTarget.style.background = 'var(--white)'}
      >
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
            <span style={{ fontWeight: 500, fontSize: 14 }}>Заявка #{String(deal.id).slice(0, 8)}</span>
            <Badge color={st.color}>{st.label}</Badge>
          </div>
          <div style={{ fontSize: 12, color: 'var(--muted)' }}>
            {(deal.unit_names || []).length} ед. · {new Date(deal.created_at).toLocaleDateString('ru-RU')}
            {dateStr && ` · ${dateStr}`}
          </div>
        </div>
        {open ? <ChevronUp size={18} style={{ color: 'var(--muted)' }} /> : <ChevronDown size={18} style={{ color: 'var(--muted)' }} />}
      </div>

      {open && (
        <div style={{ padding: '0 16px 14px', borderTop: '1px solid var(--border)' }}>
          <div style={{ paddingTop: 12 }}>
            {(deal.unit_names || []).map((name, i) => (
              <div key={i} style={{ fontSize: 13, padding: '4px 0', display: 'flex', alignItems: 'center', gap: 6 }}>
                <Package size={13} style={{ color: 'var(--muted)' }} /> {name}
              </div>
            ))}
            {deal.requester_message && (
              <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 8, fontStyle: 'italic', paddingTop: 8, borderTop: '1px solid var(--border)' }}>
                {deal.requester_message}
              </div>
            )}
            {deal.price_total && (
              <div style={{ fontSize: 13, fontWeight: 500, marginTop: 8 }}>
                Сумма: {Number(deal.price_total).toLocaleString('ru-RU')} ₽
              </div>
            )}
            {deal.contract_pdf_url && (
              <a href={deal.contract_pdf_url} target="_blank" rel="noreferrer" style={{ fontSize: 12, color: 'var(--blue)', marginTop: 6, display: 'inline-block' }}>
                Скачать договор
              </a>
            )}
            {deal.sign_token && deal.sign_status === 'pending' && (
              <div style={{ marginTop: 8 }}>
                <a href={`/sign/${deal.sign_token}`} style={{
                  display: 'inline-block', padding: '6px 14px', borderRadius: 'var(--radius-btn)',
                  background: 'var(--accent)', color: '#fff', fontSize: 13, fontWeight: 500, textDecoration: 'none',
                }}>Подписать договор</a>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

/* ─── Helpers ──────────────────────────────────── */
function FI({ label, value, onChange, placeholder, type = 'text' }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ fontSize: 12, fontWeight: 500, marginBottom: 4, color: 'var(--muted)' }}>{label}</div>
      <input type={type} value={value} onChange={onChange} placeholder={placeholder}
        style={{ width: '100%', height: 40, padding: '0 12px', border: '1px solid var(--border)', borderRadius: 'var(--radius-btn)', fontSize: 14, background: 'var(--white)', outline: 'none', boxSizing: 'border-box' }} />
    </div>
  )
}
