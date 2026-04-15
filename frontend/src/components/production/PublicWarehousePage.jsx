import { useState, useEffect } from 'react'
import { useParams } from 'react-router-dom'
import { ShoppingCart, X, Minus, Plus } from 'lucide-react'
import Badge from '../shared/Badge'
import Button from '../shared/Button'
import Input from '../shared/Input'

const BASE = import.meta.env.VITE_API_URL || ''

export default function PublicWarehousePage() {
  const { token } = useParams()
  const [step, setStep] = useState('auth') // auth | browse | done
  const [form, setForm] = useState({ name: '', phone: '', project_name: '' })
  const [units, setUnits] = useState([])
  const [loadError, setLoadError] = useState(null)
  const [search, setSearch] = useState('')
  const [category, setCategory] = useState('Все')

  // Cart
  const [cart, setCart] = useState([])
  const [showCart, setShowCart] = useState(false)
  const [cartMessage, setCartMessage] = useState('')
  const [sending, setSending] = useState(false)

  useEffect(() => {
    fetch(`${BASE}/public/warehouse/${token}`)
      .then(r => r.json())
      .then(d => {
        if (d.error) { setLoadError(d.error); return }
        setUnits(d.units || [])
      })
      .catch(() => setLoadError('Не удалось загрузить каталог'))
  }, [token])

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

  async function submitCart() {
    setSending(true)
    try {
      const res = await fetch(`${BASE}/public/warehouse/${token}/cart-request`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: form.name,
          phone: form.phone,
          project_name: form.project_name,
          unit_ids: cart,
          message: cartMessage,
        }),
      })
      if (!res.ok) throw new Error('Request failed')
      setShowCart(false)
      setStep('done')
    } catch {
      alert('Ошибка при отправке заявки')
    } finally {
      setSending(false)
    }
  }

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg)', fontFamily: 'Inter, sans-serif' }}>
      {/* Header */}
      <div style={{ background: 'var(--black)', padding: '16px 24px', display: 'flex', alignItems: 'center', gap: 12 }}>
        <div style={{ fontSize: 18, fontWeight: 600, color: 'var(--white)' }}>
          <span style={{ color: 'var(--blue)' }}>3X</span>Media
        </div>
        <div style={{ fontSize: 9, letterSpacing: '1.4px', textTransform: 'uppercase', color: 'rgba(255,255,255,0.3)' }}>
          Production
        </div>
        <div style={{ marginLeft: 'auto', fontSize: 13, color: 'rgba(255,255,255,0.4)' }}>
          Публичный каталог склада
        </div>
      </div>

      <div style={{ maxWidth: 800, margin: '0 auto', padding: '32px 24px' }}>

        {loadError && (
          <div style={{ textAlign: 'center', padding: '80px 0' }}>
            <div style={{ fontSize: 52, marginBottom: 16 }}>❌</div>
            <h2 style={{ fontSize: 18, fontWeight: 600, marginBottom: 8 }}>Ссылка недействительна</h2>
            <p style={{ color: 'var(--muted)', fontSize: 14 }}>{loadError}</p>
          </div>
        )}

        {/* Step: auth */}
        {!loadError && step === 'auth' && (
          <div style={{ maxWidth: 400, margin: '0 auto' }}>
            <div style={{
              background: 'var(--white)', borderRadius: 'var(--radius-card)',
              border: '1px solid var(--border)', padding: '36px 32px',
            }}>
              <div style={{ textAlign: 'center', marginBottom: 28 }}>
                <div style={{ fontSize: 36, marginBottom: 12 }}>🏪</div>
                <h1 style={{ fontSize: 18, fontWeight: 600, marginBottom: 8 }}>Каталог склада</h1>
                <p style={{ fontSize: 13, color: 'var(--muted)' }}>
                  Введите ваши данные для просмотра доступного имущества
                </p>
              </div>
              <Input label="Имя" placeholder="Иван Иванов" value={form.name} onChange={set('name')} />
              <Input label="Телефон" placeholder="+7 900 000 00 00" value={form.phone} onChange={set('phone')} />
              <Input label="Название проекта" placeholder="Мой проект" value={form.project_name} onChange={set('project_name')} />
              <Button fullWidth disabled={!form.name || !form.phone}
                onClick={() => setStep('browse')}>
                Просмотреть каталог
              </Button>
            </div>
          </div>
        )}

        {/* Step: browse */}
        {step === 'browse' && (
          <div>
            <div style={{ marginBottom: 24 }}>
              <h1 style={{ fontSize: 20, fontWeight: 600 }}>Каталог имущества</h1>
              <p style={{ fontSize: 13, color: 'var(--muted)', marginTop: 2 }}>
                Здравствуйте, {form.name}! Выберите интересующие позиции и добавьте в корзину.
              </p>
            </div>

            {/* Search + filter */}
            <div style={{ display: 'flex', gap: 10, marginBottom: 20, flexWrap: 'wrap' }}>
              <div style={{ position: 'relative', flex: 1, minWidth: 180 }}>
                <span style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--muted)' }}>🔍</span>
                <input value={search} onChange={e => setSearch(e.target.value)}
                  placeholder="Найдите..."
                  style={{
                    width: '100%', height: 40, padding: '0 12px 0 36px',
                    border: '1px solid var(--border)', borderRadius: 'var(--radius-btn)',
                    fontSize: 14, background: 'var(--white)', outline: 'none',
                  }} />
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

            {/* Grid */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 14 }}>
              {filtered.map(u => {
                const added = inCart(u.id)
                const available = u.status === 'on_stock'
                return (
                  <div key={u.id} style={{
                    background: 'var(--white)', borderRadius: 'var(--radius-card)',
                    border: `1px solid ${added ? 'var(--blue)' : 'var(--border)'}`, overflow: 'hidden',
                    transition: 'border-color 0.15s',
                  }}>
                    <div style={{
                      height: 140, background: 'var(--bg)',
                      display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden',
                    }}>
                      {u.photos?.[0]
                        ? <img src={u.photos[0]} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                        : <span style={{ fontSize: 40 }}>📦</span>
                      }
                    </div>
                    <div style={{ padding: '14px' }}>
                      <div style={{ fontWeight: 500, marginBottom: 4 }}>{u.name}</div>
                      {u.description && (
                        <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 10, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{u.description}</div>
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

            {/* Floating cart button */}
            {cart.length > 0 && (
              <button
                onClick={() => setShowCart(true)}
                style={{
                  position: 'fixed', bottom: 24, right: 24, zIndex: 100,
                  width: 56, height: 56, borderRadius: '50%',
                  background: 'var(--accent)', border: 'none', color: '#fff',
                  cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
                  boxShadow: '0 4px 16px rgba(0,0,0,0.2)',
                }}
              >
                <ShoppingCart size={22} />
                <span style={{
                  position: 'absolute', top: -4, right: -4,
                  background: 'var(--red)', color: '#fff', borderRadius: '50%',
                  width: 22, height: 22, fontSize: 11, fontWeight: 700,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>{cart.length}</span>
              </button>
            )}

            {/* Cart modal */}
            {showCart && (
              <div
                style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 400, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}
                onClick={() => setShowCart(false)}
              >
                <div
                  style={{ background: 'var(--white)', borderRadius: 'var(--radius-card)', padding: 24, maxWidth: 480, width: '100%', maxHeight: '80vh', overflowY: 'auto' }}
                  onClick={e => e.stopPropagation()}
                >
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
                    <div style={{ fontWeight: 600, fontSize: 16 }}>Корзина ({cart.length})</div>
                    <button onClick={() => setShowCart(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--muted)', padding: 4 }}>
                      <X size={18} />
                    </button>
                  </div>

                  {cartUnits.length === 0 ? (
                    <div style={{ textAlign: 'center', padding: '24px 0', color: 'var(--muted)', fontSize: 14 }}>Корзина пуста</div>
                  ) : (
                    <>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 20 }}>
                        {cartUnits.map(u => (
                          <div key={u.id} style={{
                            display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px',
                            border: '1px solid var(--border)', borderRadius: 'var(--radius-btn)',
                          }}>
                            <div style={{
                              width: 40, height: 40, borderRadius: 6, background: 'var(--bg)',
                              display: 'flex', alignItems: 'center', justifyContent: 'center',
                              overflow: 'hidden', flexShrink: 0,
                            }}>
                              {u.photos?.[0]
                                ? <img src={u.photos[0]} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                                : <span style={{ fontSize: 16 }}>📦</span>
                              }
                            </div>
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <div style={{ fontSize: 13, fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{u.name}</div>
                              <div style={{ fontSize: 11, color: 'var(--muted)' }}>{u.category}</div>
                            </div>
                            <button onClick={() => toggleCart(u.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--red)', padding: 4 }}>
                              <X size={16} />
                            </button>
                          </div>
                        ))}
                      </div>

                      <div style={{ marginBottom: 16 }}>
                        <div style={{ fontSize: 13, fontWeight: 500, marginBottom: 6 }}>Комментарий к заявке</div>
                        <textarea
                          placeholder="Уточните детали: даты, условия, пожелания..."
                          value={cartMessage}
                          onChange={e => setCartMessage(e.target.value)}
                          style={{
                            width: '100%', minHeight: 80, padding: '10px 12px',
                            border: '1px solid var(--border)', borderRadius: 'var(--radius-btn)',
                            fontSize: 13, resize: 'vertical', outline: 'none', fontFamily: 'inherit',
                            boxSizing: 'border-box',
                          }}
                        />
                      </div>

                      <Button fullWidth loading={sending} onClick={submitCart}>
                        Отправить заявку ({cart.length} ед.)
                      </Button>
                    </>
                  )}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Step: done */}
        {step === 'done' && (
          <div style={{ textAlign: 'center', padding: '80px 0' }}>
            <div style={{ fontSize: 52, marginBottom: 16 }}>✅</div>
            <h2 style={{ fontSize: 18, fontWeight: 600, marginBottom: 8 }}>Заявка отправлена</h2>
            <p style={{ color: 'var(--muted)', fontSize: 14, marginBottom: 8 }}>
              Ваша заявка на {cart.length} ед. принята в обработку.
            </p>
            <p style={{ color: 'var(--muted)', fontSize: 14, marginBottom: 28 }}>
              Мы свяжемся с вами по номеру {form.phone} в ближайшее время
            </p>
            <Button variant="secondary" onClick={() => { setCart([]); setCartMessage(''); setStep('browse') }}>
              Вернуться к каталогу
            </Button>
          </div>
        )}
      </div>
    </div>
  )
}
