import { useState, useEffect, useCallback, useRef } from 'react'
import { useParams } from 'react-router-dom'
import { ShoppingCart, X, Minus, Plus, ChevronDown, ChevronUp, Package, Clock, CheckCircle, RotateCcw, User, FileText } from 'lucide-react'
import Badge from '../shared/Badge'
import Button from '../shared/Button'
import { categoryLabel } from '../../constants/categories'

const BASE = import.meta.env.VITE_API_URL || ''

const CABINET_TABS = [
  { key: 'catalog', label: 'Каталог', icon: Package },
  { key: 'pending', label: 'Заявки', icon: Clock },
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

function loadSession(token) {
  try {
    const raw = sessionStorage.getItem(`pub_session_${token}`)
    if (raw) return JSON.parse(raw)
  } catch { /* ignore */ }
  return null
}

function saveSession(token, data) {
  try { sessionStorage.setItem(`pub_session_${token}`, JSON.stringify(data)) } catch { /* ignore */ }
}

export default function PublicWarehousePage() {
  const { token } = useParams()
  const saved = loadSession(token)

  const [step, setStep] = useState(saved ? 'cabinet' : 'auth')
  const [cpType, setCpType] = useState(saved?.cpType || 'person')
  const [form, setForm] = useState(saved?.form || { name: '', phone: '', email: '', project_name: '', inn: '', legal_address: '', extra_contact: '' })
  const [units, setUnits] = useState([])
  const [loadError, setLoadError] = useState(null)
  const [search, setSearch] = useState('')
  const [category, setCategory] = useState('Все')

  const [cabTab, setCabTab] = useState('catalog')
  const [deals, setDeals] = useState([])
  const [dealsLoading, setDealsLoading] = useState(false)

  const [cart, setCart] = useState([])
  const [showCart, setShowCart] = useState(false)
  const [cartMessage, setCartMessage] = useState('')
  const [periodStart, setPeriodStart] = useState('')
  const [periodEnd, setPeriodEnd] = useState('')
  const [sending, setSending] = useState(false)

  const [showConfirm, setShowConfirm] = useState(false)
  const [showSuccess, setShowSuccess] = useState(false)
  const [authError, setAuthError] = useState('')

  const phoneValid = /^\+7\s?\d{3}\s?\d{3}\s?\d{2}\s?\d{2}$/.test(form.phone.trim()) || /^\+7\d{10}$/.test(form.phone.replace(/\s/g, ''))
  const emailValid = !form.email || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)
  const innValid = cpType !== 'company' || (form.inn.length === 10 || form.inn.length === 12)
  const canEnter = form.name && form.phone && phoneValid && emailValid && innValid

  useEffect(() => {
    fetch(`${BASE}/public/warehouse/${token}`)
      .then(r => r.json())
      .then(d => {
        if (d.error) { setLoadError(d.error); return }
        setUnits(d.units || [])
      })
      .catch(() => setLoadError('Не удалось загрузить каталог'))
  }, [token])

  const loadDeals = useCallback(() => {
    if (!form.phone) return
    setDealsLoading(true)
    fetch(`${BASE}/public/warehouse/${token}/my-deals?phone=${encodeURIComponent(form.phone)}`)
      .then(r => r.json())
      .then(d => setDeals(d.deals || []))
      .catch(() => {})
      .finally(() => setDealsLoading(false))
  }, [token, form.phone])

  useEffect(() => {
    if (step === 'cabinet') loadDeals()
  }, [step, cabTab, loadDeals])

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
    if (!form.name) { setAuthError('Укажите имя'); return }
    if (!phoneValid) { setAuthError('Формат телефона: +7 XXX XXX XX XX'); return }
    if (!emailValid) { setAuthError('Некорректный email'); return }
    if (cpType === 'company' && !innValid) { setAuthError('ИНН должен содержать 10 или 12 цифр'); return }
    setAuthError('')
    saveSession(token, { form, cpType })
    setStep('cabinet')
  }

  function logout() {
    sessionStorage.removeItem(`pub_session_${token}`)
    setStep('auth')
    setDeals([])
    setCabTab('catalog')
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
          unit_ids: cart, period_start: periodStart || undefined, period_end: periodEnd || undefined,
          message: cartMessage || undefined,
        }),
      })
      if (!res.ok) throw new Error()
      setShowConfirm(false)
      setShowSuccess(true)
      setTimeout(() => {
        setShowSuccess(false)
        setCart([]); setCartMessage(''); setPeriodStart(''); setPeriodEnd('')
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
      {/* ─── Header ─── */}
      <div style={{ background: 'var(--black)', padding: '14px 24px', display: 'flex', alignItems: 'center', gap: 12 }}>
        <div style={{ fontSize: 18, fontWeight: 600, color: 'var(--white)' }}>
          <span style={{ color: 'var(--blue)' }}>3X</span>Media
        </div>
        <div style={{ fontSize: 9, letterSpacing: '1.4px', textTransform: 'uppercase', color: 'rgba(255,255,255,0.3)' }}>Production</div>
        {step === 'cabinet' && (
          <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 12 }}>
            <span style={{ fontSize: 13, color: 'rgba(255,255,255,0.5)' }}>{form.name}</span>
            <button onClick={logout} style={{ fontSize: 12, color: 'rgba(255,255,255,0.3)', background: 'none', border: 'none', cursor: 'pointer' }}>Выйти</button>
          </div>
        )}
      </div>

      {loadError && (
        <div style={{ textAlign: 'center', padding: '80px 24px' }}>
          <div style={{ fontSize: 52, marginBottom: 16 }}>❌</div>
          <h2 style={{ fontSize: 18, fontWeight: 600, marginBottom: 8 }}>Ссылка недействительна</h2>
          <p style={{ color: 'var(--muted)', fontSize: 14 }}>{loadError}</p>
        </div>
      )}

      {/* ─── AUTH ─── */}
      {!loadError && step === 'auth' && (
        <div style={{ maxWidth: 440, margin: '0 auto', padding: '48px 24px' }}>
          <div style={{ background: 'var(--white)', borderRadius: 'var(--radius-card)', border: '1px solid var(--border)', padding: '36px 32px' }}>
            <div style={{ textAlign: 'center', marginBottom: 28 }}>
              <div style={{ width: 56, height: 56, borderRadius: '50%', background: 'var(--blue-dim)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', marginBottom: 12 }}>
                <User size={28} style={{ color: 'var(--blue)' }} />
              </div>
              <h1 style={{ fontSize: 18, fontWeight: 600, marginBottom: 6 }}>Каталог склада</h1>
              <p style={{ fontSize: 13, color: 'var(--muted)' }}>Введите данные для просмотра и оформления заявок</p>
            </div>

            <div style={{ display: 'flex', gap: 0, marginBottom: 20 }}>
              {[['person', 'Физлицо'], ['company', 'Компания']].map(([val, label]) => (
                <button key={val} onClick={() => setCpType(val)} style={{
                  flex: 1, padding: '9px 0', fontSize: 13, fontWeight: 500, cursor: 'pointer',
                  border: `1px solid ${cpType === val ? 'var(--accent)' : 'var(--border)'}`,
                  background: cpType === val ? 'var(--accent)' : 'var(--white)',
                  color: cpType === val ? '#fff' : 'var(--muted)',
                  borderRadius: val === 'person' ? 'var(--radius-btn) 0 0 var(--radius-btn)' : '0 var(--radius-btn) var(--radius-btn) 0',
                }}>{label}</button>
              ))}
            </div>

            <FI label={cpType === 'company' ? 'Название компании *' : 'ФИО *'} value={form.name} onChange={set('name')} placeholder={cpType === 'company' ? 'ООО Рога и Копыта' : 'Иван Иванов'} />
            <PhoneInput label="Телефон *" value={form.phone} onChange={v => setForm(p => ({ ...p, phone: v }))} />
            <FI label="Email" value={form.email} onChange={set('email')} placeholder="email@example.com" type="email" error={form.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email) ? 'Некорректный email' : ''} />
            <FI label="Название проекта" value={form.project_name} onChange={set('project_name')} placeholder="Мой проект" />

            {cpType === 'company' && (
              <>
                <InnInput
                  value={form.inn}
                  onChange={v => setForm(p => ({ ...p, inn: v }))}
                  onCompanyFound={data => {
                    if (data.name) setForm(p => ({ ...p, name: data.name, legal_address: data.address || p.legal_address }))
                  }}
                />
                <FI label="Юридический адрес" value={form.legal_address} onChange={set('legal_address')} placeholder="г. Москва, ул. ..." />
                <FI label="Дополнительный контакт" value={form.extra_contact} onChange={set('extra_contact')} placeholder="Имя, телефон или email" />
              </>
            )}

            {authError && <div style={{ color: 'var(--red)', fontSize: 13, marginBottom: 8 }}>{authError}</div>}

            <Button fullWidth disabled={!canEnter} onClick={enterCabinet} style={{ marginTop: 8 }}>
              Войти в каталог
            </Button>
          </div>
        </div>
      )}

      {/* ─── CABINET ─── */}
      {step === 'cabinet' && (
        <div style={{ display: 'flex', minHeight: 'calc(100vh - 50px)' }}>
          {/* Sidebar */}
          <div style={{ width: 220, background: 'var(--white)', borderRight: '1px solid var(--border)', display: 'flex', flexDirection: 'column', flexShrink: 0 }}>
            <div style={{ padding: '20px 16px 12px', fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px', color: 'var(--muted)' }}>Каталогизатор</div>
            {CABINET_TABS.map(t => {
              const Icon = t.icon
              const active = cabTab === t.key
              const count = t.key === 'pending' ? deals.filter(d => d.status === 'pending_review').length
                : t.key === 'active' ? deals.filter(d => d.status === 'active' || d.status === 'overdue').length
                : t.key === 'done' ? deals.filter(d => d.status === 'done' || d.status === 'cancelled').length : 0
              return (
                <button key={t.key} onClick={() => setCabTab(t.key)} style={{
                  display: 'flex', alignItems: 'center', gap: 10, padding: '10px 16px', width: '100%',
                  border: 'none', background: active ? 'var(--bg)' : 'transparent',
                  color: active ? 'var(--text)' : 'var(--muted)', cursor: 'pointer',
                  fontWeight: active ? 500 : 400, fontSize: 14, textAlign: 'left',
                  borderLeft: `3px solid ${active ? 'var(--accent)' : 'transparent'}`,
                }}>
                  <Icon size={16} />
                  <span style={{ flex: 1 }}>{t.label}</span>
                  {count > 0 && t.key !== 'catalog' && (
                    <span style={{ background: 'var(--accent)', color: '#fff', borderRadius: 10, padding: '1px 7px', fontSize: 11, fontWeight: 600 }}>{count}</span>
                  )}
                </button>
              )
            })}

            {/* Profile at bottom */}
            <div style={{ marginTop: 'auto', padding: '16px', borderTop: '1px solid var(--border)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <div style={{ width: 32, height: 32, borderRadius: '50%', background: 'var(--accent)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, fontWeight: 600, flexShrink: 0 }}>
                  {form.name.charAt(0).toUpperCase()}
                </div>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ fontSize: 13, fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{form.name}</div>
                  <div style={{ fontSize: 11, color: 'var(--muted)' }}>{form.phone}</div>
                </div>
              </div>
            </div>
          </div>

          {/* Main content */}
          <div style={{ flex: 1, padding: '24px 32px', maxWidth: 900, overflow: 'auto' }}>

            {/* ── Catalog ── */}
            {cabTab === 'catalog' && (
              <div>
                <h1 style={{ fontSize: 20, fontWeight: 600, marginBottom: 4 }}>Каталог</h1>
                <p style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 20 }}>Выберите позиции и добавьте в корзину</p>

                <div style={{ display: 'flex', gap: 10, marginBottom: 20, flexWrap: 'wrap' }}>
                  <div style={{ position: 'relative', flex: 1, minWidth: 180 }}>
                    <span style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--muted)', fontSize: 14 }}>🔍</span>
                    <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Поиск..."
                      style={{ width: '100%', height: 38, padding: '0 12px 0 36px', border: '1px solid var(--border)', borderRadius: 'var(--radius-btn)', fontSize: 13, background: 'var(--white)', outline: 'none' }} />
                  </div>
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    {categories.map(c => (
                      <button key={c} onClick={() => setCategory(c)} style={{
                        height: 38, padding: '0 12px', borderRadius: 'var(--radius-btn)',
                        border: `1px solid ${category === c ? 'var(--accent)' : 'var(--border)'}`,
                        background: category === c ? 'var(--accent)' : 'var(--white)',
                        color: category === c ? '#fff' : 'var(--muted)',
                        fontSize: 12, cursor: 'pointer',
                      }}>{c === 'Все' ? 'Все' : categoryLabel(c)}</button>
                    ))}
                  </div>
                </div>

                {filtered.length === 0 && <div style={{ textAlign: 'center', padding: '60px 0', color: 'var(--muted)', fontSize: 14 }}>Нет позиций</div>}

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 14 }}>
                  <style>{`@media(max-width:900px){.pub-grid{grid-template-columns:repeat(2,1fr)!important}}@media(max-width:560px){.pub-grid{grid-template-columns:1fr!important}}`}</style>
                  {filtered.map(u => {
                    const added = inCart(u.id)
                    const available = u.status === 'on_stock'
                    return (
                      <div key={u.id} className="pub-grid" style={{
                        background: 'var(--white)', borderRadius: 'var(--radius-card)',
                        border: `1px solid ${added ? 'var(--accent)' : 'var(--border)'}`,
                        overflow: 'hidden', transition: 'border-color 0.15s, box-shadow 0.15s',
                      }}
                        onMouseEnter={e => e.currentTarget.style.boxShadow = '0 2px 8px rgba(0,0,0,0.06)'}
                        onMouseLeave={e => e.currentTarget.style.boxShadow = 'none'}
                      >
                        <div style={{ aspectRatio: '1', background: 'var(--bg)', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
                          {u.photos?.[0]
                            ? <img src={u.photos[0]} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                            : <Package size={36} style={{ color: 'var(--muted)', opacity: 0.3 }} />}
                        </div>
                        <div style={{ padding: '12px 14px' }}>
                          <div style={{ fontWeight: 500, fontSize: 14, marginBottom: 2 }}>{u.name}</div>
                          <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 8 }}>{categoryLabel(u.category)}</div>
                          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                            <Badge color={available ? 'green' : 'muted'}>{available ? 'Доступно' : 'Занято'}</Badge>
                            {available && (
                              <button onClick={() => toggleCart(u.id)} style={{
                                display: 'flex', alignItems: 'center', gap: 4,
                                fontSize: 12, color: added ? 'var(--red)' : 'var(--accent)', background: 'none',
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

                {cart.length > 0 && (
                  <button onClick={() => setShowCart(true)} style={{
                    position: 'fixed', bottom: 24, right: 24, zIndex: 100,
                    width: 56, height: 56, borderRadius: '50%',
                    background: 'var(--accent)', border: 'none', color: '#fff',
                    cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
                    boxShadow: '0 4px 16px rgba(0,0,0,0.2)',
                  }}>
                    <ShoppingCart size={22} />
                    <span style={{ position: 'absolute', top: -4, right: -4, background: 'var(--red)', color: '#fff', borderRadius: '50%', width: 22, height: 22, fontSize: 11, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{cart.length}</span>
                  </button>
                )}
              </div>
            )}

            {/* ── Deals tabs ── */}
            {cabTab !== 'catalog' && (
              <div>
                <h1 style={{ fontSize: 20, fontWeight: 600, marginBottom: 4 }}>
                  {cabTab === 'pending' ? 'Заявки' : cabTab === 'active' ? 'Получено' : 'Возвращено'}
                </h1>
                <p style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 20 }}>
                  {cabTab === 'pending' ? 'Заявки ожидающие подтверждения склада' : cabTab === 'active' ? 'Имущество на руках' : 'История возвратов'}
                </p>

                {dealsLoading && <div style={{ textAlign: 'center', padding: '40px 0', color: 'var(--muted)', fontSize: 14 }}>Загрузка...</div>}
                {!dealsLoading && filteredDeals.length === 0 && (
                  <div style={{ textAlign: 'center', padding: '60px 0' }}>
                    <FileText size={40} style={{ color: 'var(--muted)', opacity: 0.3, marginBottom: 12 }} />
                    <div style={{ color: 'var(--muted)', fontSize: 14 }}>
                      {cabTab === 'pending' ? 'Нет заявок на рассмотрении' : cabTab === 'active' ? 'Нет полученного имущества' : 'Нет возвращённых заявок'}
                    </div>
                  </div>
                )}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {filteredDeals.map(d => <DealCard key={d.id} deal={d} />)}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ─── CART MODAL ─── */}
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
                    <div style={{ fontSize: 11, color: 'var(--muted)' }}>{categoryLabel(u.category)}</div>
                  </div>
                  <button onClick={() => toggleCart(u.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--red)', padding: 4 }}><X size={16} /></button>
                </div>
              ))}
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 12 }}>
              <FI label="Дата начала" type="date" value={periodStart} onChange={e => setPeriodStart(e.target.value)} />
              <FI label="Дата окончания" type="date" value={periodEnd} onChange={e => setPeriodEnd(e.target.value)} />
            </div>

            <div style={{ marginBottom: 16 }}>
              <div style={{ fontSize: 12, fontWeight: 500, marginBottom: 4, color: 'var(--muted)' }}>Комментарий</div>
              <textarea placeholder="Уточните детали..." value={cartMessage} onChange={e => setCartMessage(e.target.value)}
                style={{ width: '100%', minHeight: 70, padding: '10px 12px', border: '1px solid var(--border)', borderRadius: 'var(--radius-btn)', fontSize: 13, resize: 'vertical', outline: 'none', fontFamily: 'inherit', boxSizing: 'border-box' }} />
            </div>

            <Button fullWidth onClick={openConfirm}>Далее</Button>
          </div>
        </div>
      )}

      {/* ─── CONFIRM MODAL ─── */}
      {showConfirm && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 600, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}
          onClick={() => setShowConfirm(false)}>
          <div style={{ background: 'var(--white)', borderRadius: 'var(--radius-card)', padding: '28px', maxWidth: 420, width: '100%', boxShadow: '0 20px 60px rgba(0,0,0,0.15)' }}
            onClick={e => e.stopPropagation()}>
            <div style={{ textAlign: 'center', marginBottom: 20 }}>
              <div style={{ width: 52, height: 52, borderRadius: '50%', background: 'var(--accent)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', marginBottom: 12, opacity: 0.9 }}>
                <ShoppingCart size={24} style={{ color: '#fff' }} />
              </div>
              <h2 style={{ fontSize: 17, fontWeight: 600, marginBottom: 6 }}>Подтвердите заявку</h2>
              <p style={{ fontSize: 13, color: 'var(--muted)' }}>Проверьте данные перед отправкой</p>
            </div>

            <div style={{ background: 'var(--bg)', borderRadius: 'var(--radius-btn)', padding: '14px 16px', marginBottom: 12 }}>
              <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 8 }}>Единицы ({cartUnits.length})</div>
              {cartUnits.map(u => (
                <div key={u.id} style={{ fontSize: 13, fontWeight: 500, padding: '3px 0' }}>{u.name}</div>
              ))}
            </div>

            {(periodStart || periodEnd) && (
              <div style={{ background: 'var(--bg)', borderRadius: 'var(--radius-btn)', padding: '10px 16px', marginBottom: 12, fontSize: 13, color: 'var(--muted)' }}>
                Сроки: {periodStart ? new Date(periodStart).toLocaleDateString('ru-RU') : '—'} — {periodEnd ? new Date(periodEnd).toLocaleDateString('ru-RU') : '—'}
              </div>
            )}

            <div style={{ background: 'var(--bg)', borderRadius: 'var(--radius-btn)', padding: '10px 16px', marginBottom: 20, fontSize: 13 }}>
              <div style={{ fontWeight: 500 }}>{form.name}</div>
              <div style={{ color: 'var(--muted)', fontSize: 12 }}>{form.phone}{form.email ? ` · ${form.email}` : ''}</div>
            </div>

            <div style={{ display: 'flex', gap: 10 }}>
              <Button variant="secondary" fullWidth onClick={() => setShowConfirm(false)}>Назад</Button>
              <Button fullWidth loading={sending} onClick={submitCart}>Подтвердить</Button>
            </div>
          </div>
        </div>
      )}

      {/* ─── SUCCESS ─── */}
      {showSuccess && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 700, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ background: 'var(--white)', borderRadius: 'var(--radius-card)', padding: '40px 32px', maxWidth: 340, textAlign: 'center', boxShadow: '0 20px 60px rgba(0,0,0,0.15)', animation: 'pub-pop 0.3s ease' }}>
            <div style={{ width: 64, height: 64, borderRadius: '50%', background: 'var(--green-dim)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', marginBottom: 16 }}>
              <CheckCircle size={32} style={{ color: 'var(--green)' }} />
            </div>
            <h2 style={{ fontSize: 17, fontWeight: 600, marginBottom: 8 }}>Заявка отправлена</h2>
            <p style={{ fontSize: 13, color: 'var(--muted)' }}>Мы свяжемся с вами в ближайшее время</p>
          </div>
        </div>
      )}

      <style>{`@keyframes pub-pop{from{transform:scale(0.9);opacity:0}to{transform:scale(1);opacity:1}}@media(max-width:768px){.pub-sidebar{display:none!important}}`}</style>
    </div>
  )
}

/* ─── Deal Card ─── */
function DealCard({ deal }) {
  const [open, setOpen] = useState(false)
  const st = DEAL_STATUS[deal.status] || DEAL_STATUS.pending_review
  const dateStr = deal.period_start && deal.period_end
    ? `${new Date(deal.period_start).toLocaleDateString('ru-RU')} — ${new Date(deal.period_end).toLocaleDateString('ru-RU')}`
    : null

  return (
    <div style={{ background: 'var(--white)', borderRadius: 'var(--radius-card)', border: '1px solid var(--border)', overflow: 'hidden' }}>
      <button onClick={() => setOpen(v => !v)} style={{
        padding: '14px 16px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 12,
        width: '100%', border: 'none', background: 'var(--white)', textAlign: 'left', fontSize: 'inherit', fontFamily: 'inherit',
      }}>
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
        {open ? <ChevronUp size={18} style={{ color: 'var(--muted)', flexShrink: 0 }} /> : <ChevronDown size={18} style={{ color: 'var(--muted)', flexShrink: 0 }} />}
      </button>

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
              <div style={{ fontSize: 13, fontWeight: 500, marginTop: 8 }}>Сумма: {Number(deal.price_total).toLocaleString('ru-RU')} ₽</div>
            )}
            {deal.contract_pdf_url && (
              <a href={deal.contract_pdf_url} target="_blank" rel="noreferrer" style={{ fontSize: 12, color: 'var(--accent)', marginTop: 6, display: 'inline-block' }}>Скачать договор</a>
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

function FI({ label, value, onChange, placeholder, type = 'text', error }) {
  return (
    <div style={{ marginBottom: 14 }}>
      {label && <div style={{ fontSize: 12, fontWeight: 500, marginBottom: 4, color: 'var(--muted)' }}>{label}</div>}
      <input type={type} value={value} onChange={onChange} placeholder={placeholder}
        style={{ width: '100%', height: 38, padding: '0 12px', border: `1px solid ${error ? 'var(--red)' : 'var(--border)'}`, borderRadius: 'var(--radius-btn)', fontSize: 13, background: 'var(--white)', outline: 'none', boxSizing: 'border-box' }} />
      {error && <div style={{ fontSize: 11, color: 'var(--red)', marginTop: 2 }}>{error}</div>}
    </div>
  )
}

function PhoneInput({ label, value, onChange }) {
  function handleChange(e) {
    let v = e.target.value.replace(/[^\d+\s]/g, '')
    if (v && !v.startsWith('+')) v = '+' + v
    if (v.length > 0 && !v.startsWith('+7')) {
      v = '+7' + v.replace(/^\+/, '')
    }
    // Auto-format: +7 XXX XXX XX XX
    const digits = v.replace(/\D/g, '')
    if (digits.length <= 1) { onChange(v); return }
    let formatted = '+7'
    if (digits.length > 1) formatted += ' ' + digits.slice(1, 4)
    if (digits.length > 4) formatted += ' ' + digits.slice(4, 7)
    if (digits.length > 7) formatted += ' ' + digits.slice(7, 9)
    if (digits.length > 9) formatted += ' ' + digits.slice(9, 11)
    onChange(formatted)
  }

  const isValid = !value || /^\+7\s?\d{3}\s?\d{3}\s?\d{2}\s?\d{2}$/.test(value.trim())

  return (
    <div style={{ marginBottom: 14 }}>
      {label && <div style={{ fontSize: 12, fontWeight: 500, marginBottom: 4, color: 'var(--muted)' }}>{label}</div>}
      <input value={value} onChange={handleChange} placeholder="+7 900 000 00 00" maxLength={16}
        style={{ width: '100%', height: 38, padding: '0 12px', border: `1px solid ${value && !isValid ? 'var(--red)' : 'var(--border)'}`, borderRadius: 'var(--radius-btn)', fontSize: 13, background: 'var(--white)', outline: 'none', boxSizing: 'border-box' }} />
      {value && !isValid && <div style={{ fontSize: 11, color: 'var(--red)', marginTop: 2 }}>Формат: +7 XXX XXX XX XX</div>}
    </div>
  )
}

function InnInput({ value, onChange, onCompanyFound }) {
  const [loading, setLoading] = useState(false)
  const [info, setInfo] = useState(null) // { name, address, kpp, ogrn, director }
  const [error, setError] = useState('')
  const lastQueried = useRef('')

  const valid = value.length === 0 || value.length === 10 || value.length === 12

  useEffect(() => {
    if ((value.length === 10 || value.length === 12) && value !== lastQueried.current) {
      lastQueried.current = value
      lookup(value)
    }
    if (value.length < 10) {
      setInfo(null)
      setError('')
    }
  }, [value]) // eslint-disable-line react-hooks/exhaustive-deps

  async function lookup(inn) {
    setLoading(true)
    setError('')
    setInfo(null)
    try {
      const res = await fetch(`${BASE}/public/inn/${inn}`)
      const data = await res.json()
      if (data.found) {
        const found = {
          name: data.name || data.fullName || '',
          fullName: data.fullName || '',
          address: data.region || '',
          kpp: data.kpp || '',
          ogrn: data.ogrn || '',
          director: data.director || '',
        }
        setInfo(found)
        onCompanyFound?.(found)
      } else {
        setError('Организация не найдена')
      }
    } catch {
      setError('Ошибка поиска')
    } finally {
      setLoading(false)
    }
  }

  function handleChange(e) {
    const v = e.target.value.replace(/\D/g, '').slice(0, 12)
    onChange(v)
  }

  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ fontSize: 12, fontWeight: 500, marginBottom: 4, color: 'var(--muted)' }}>ИНН *</div>
      <div style={{ position: 'relative' }}>
        <input value={value} onChange={handleChange} placeholder="1234567890" maxLength={12}
          style={{ width: '100%', height: 38, padding: '0 12px', border: `1px solid ${!valid ? 'var(--red)' : info ? 'var(--green)' : 'var(--border)'}`, borderRadius: 'var(--radius-btn)', fontSize: 13, background: 'var(--white)', outline: 'none', boxSizing: 'border-box' }} />
        {loading && <span style={{ position: 'absolute', right: 12, top: 10, fontSize: 12, color: 'var(--muted)' }}>...</span>}
      </div>
      {!valid && value.length > 0 && <div style={{ fontSize: 11, color: 'var(--red)', marginTop: 2 }}>ИНН: 10 или 12 цифр</div>}
      {error && <div style={{ fontSize: 11, color: 'var(--red)', marginTop: 2 }}>{error}</div>}
      {info && (
        <div style={{ marginTop: 6, padding: '8px 10px', background: 'var(--bg)', borderRadius: 'var(--radius-btn)', fontSize: 12 }}>
          <div style={{ fontWeight: 500, color: 'var(--green)', marginBottom: 2 }}>{info.name}</div>
          {info.director && <div style={{ color: 'var(--muted)' }}>Руководитель: {info.director}</div>}
          {info.address && <div style={{ color: 'var(--muted)', marginTop: 1 }}>{info.address}</div>}
          {(info.kpp || info.ogrn) && <div style={{ color: 'var(--muted)', marginTop: 1 }}>{info.kpp && `КПП: ${info.kpp}`}{info.kpp && info.ogrn && ' · '}{info.ogrn && `ОГРН: ${info.ogrn}`}</div>}
        </div>
      )}
    </div>
  )
}
