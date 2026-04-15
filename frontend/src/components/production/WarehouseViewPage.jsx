import { useState, useEffect } from 'react'
import ProductionLayout from './ProductionLayout'
import Badge from '../shared/Badge'
import Button from '../shared/Button'
import UnitCardModal from '../shared/UnitCardModal'
import { STATUS_LABEL, STATUS_COLOR } from '../../constants/statuses'
import { ALL_CATEGORIES, CATEGORIES_FILTER, categoryLabel } from '../../constants/categories'
import { units as unitsApi, requests as requestsApi, warehouses as warehousesApi, rent as rentApi } from '../../services/api'
import { useAuth } from '../../hooks/useAuth'

const REQUEST_STATUSES = {
  pending:    { label: 'Заявка отправлена',  color: 'amber' },
  new:        { label: 'Заявка отправлена',  color: 'amber' },
  collecting: { label: 'В работе',           color: 'amber' },
  ready:      { label: 'Готово к выдаче',   color: 'green' },
  approved:   { label: 'Одобрено',          color: 'green' },
  issued:     { label: 'Получено',           color: 'green' },
  rejected:   { label: 'Отклонено',         color: 'red' },
}

export default function WarehouseViewPage() {
  const [search, setSearch] = useState('')
  const [category, setCategory] = useState('all')
  const [requestedUnits, setRequestedUnits] = useState({})
  const [expanded, setExpanded] = useState(null)
  const [units, setUnits] = useState([])
  const [loading, setLoading] = useState(true)
  const [cardId, setCardId] = useState(null)
  const [whList, setWhList] = useState([])
  const [selectedWh, setSelectedWh] = useState('all')
  const [cart, setCart] = useState([])
  const [showCart, setShowCart] = useState(false)
  const [cartSending, setCartSending] = useState(false)
  const [successPopup, setSuccessPopup] = useState(false)
  const [viewMode, setViewMode] = useState(() => localStorage.getItem('unitsViewMode') || 'grid')
  const [publicLink, setPublicLink] = useState('')
  const [linkCopied, setLinkCopied] = useState(false)
  const { user } = useAuth()

  useEffect(() => {
    warehousesApi.list().then(d => setWhList(d.warehouses || [])).catch(() => {})
    unitsApi.list().then(d => setUnits(d.units || [])).catch(() => {}).finally(() => setLoading(false))
    if (user?.id) {
      const params = user.project_id ? { project_id: user.project_id } : { requester_id: user.id }
      requestsApi.list(params).then(d => {
        const map = {}
        for (const r of (d.requests || [])) {
          if (['cancelled', 'rejected', 'issued'].includes(r.status)) continue
          for (const uid of (r.unit_ids || [])) {
            map[uid] = r.status === 'new' ? 'pending' : r.status
          }
        }
        setRequestedUnits(map)
      }).catch(() => {})
    }
  }, [user?.id])

  function addToCart(id) {
    if (!cart.includes(id)) setCart(c => [...c, id])
  }

  function removeFromCart(id) {
    setCart(c => c.filter(x => x !== id))
  }

  async function submitCart() {
    if (!cart.length) return
    setCartSending(true)
    try {
      await requestsApi.create({ unit_ids: cart, project_id: user?.project_id || null })
      const map = { ...requestedUnits }
      for (const id of cart) map[id] = 'pending'
      setRequestedUnits(map)
      setCart([])
      setShowCart(false)
      setSuccessPopup(true)
      setTimeout(() => setSuccessPopup(false), 2500)
    } catch { alert('Ошибка отправки заявки') }
    setCartSending(false)
  }

  const filtered = units.filter(u => {
    const matchSearch = !search || u.name.toLowerCase().includes(search.toLowerCase()) || (u.serial || '').toLowerCase().includes(search.toLowerCase())
    const matchCat = category === 'all' || u.category === category
    const matchWh = selectedWh === 'all' || u.warehouse_id === selectedWh
    return matchSearch && matchCat && matchWh
  })

  return (
    <ProductionLayout>
      <style>{`
        @media (max-width: 768px) {
          .wv-row { flex-wrap: wrap !important; gap: 10px !important; padding: 12px 14px !important; }
          .wv-info { width: 100% !important; order: 2; }
          .wv-photo { order: 1; }
          .wv-right { width: 100% !important; order: 3; display: flex; align-items: center; justify-content: space-between; }
          .wv-chevron { display: none !important; }
        }
      `}</style>
      <div style={{ padding: '24px 32px', maxWidth: 900 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24, gap: 12 }}>
          <div>
            <h1 style={{ fontSize: 20, fontWeight: 600 }}>Склад</h1>
            <p style={{ fontSize: 13, color: 'var(--muted)', marginTop: 2 }}>Просмотр остатков</p>
          </div>
          {user?.role === 'producer' && (
            <div style={{ display: 'flex', gap: 8 }}>
              <Button variant="secondary" onClick={async () => {
                try {
                  const data = await rentApi.generateLink()
                  const url = data.url || data.link
                  if (url) setPublicLink(`${window.location.origin}${url}`)
                } catch { /* silent */ }
              }}>Публичная ссылка</Button>
              <Button onClick={() => window.location.href = '/production/units?add=1'}>+ Новая единица</Button>
            </div>
          )}
        </div>

        {/* Search + filter */}
        <div style={{ display: 'flex', gap: 10, marginBottom: 20, flexWrap: 'wrap', alignItems: 'center' }}>
          <div style={{ position: 'relative', flex: 1, minWidth: 200 }}>
            <span style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--muted)' }}>🔍</span>
            <input value={search} onChange={e => setSearch(e.target.value)}
              placeholder="Найдите..."
              style={{
                width: '100%', height: 40, padding: '0 12px 0 36px',
                border: '1px solid var(--border)', borderRadius: 'var(--radius-btn)',
                fontSize: 14, background: 'var(--white)', outline: 'none',
              }} />
          </div>
          <select value={category} onChange={e => setCategory(e.target.value)} style={{
            height: 40, padding: '0 12px', border: '1px solid var(--border)',
            borderRadius: 'var(--radius-btn)', fontSize: 13, background: 'var(--white)', cursor: 'pointer',
          }}>
            {CATEGORIES_FILTER.map(c => <option key={c} value={c}>{c === 'all' ? 'Выбрать категорию' : categoryLabel(c)}</option>)}
          </select>
          <select value={selectedWh} onChange={e => setSelectedWh(e.target.value)} style={{
            height: 40, padding: '0 12px', border: '1px solid var(--border)',
            borderRadius: 'var(--radius-btn)', fontSize: 13, background: 'var(--white)', cursor: 'pointer',
          }}>
            <option value="all">Выбрать склад</option>
            {whList.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
          </select>
          <span style={{ fontSize: 13, color: 'var(--muted)' }}>{filtered.length} ед.</span>
          <div style={{ display: 'flex', gap: 2 }}>
            {[
              { mode: 'grid', icon: '▦', title: 'Карточки' },
              { mode: 'rows', icon: '☰', title: 'Строки' },
              { mode: 'list', icon: '≡', title: 'Список' },
            ].map(v => (
              <button key={v.mode} title={v.title} onClick={() => { setViewMode(v.mode); localStorage.setItem('unitsViewMode', v.mode) }}
                style={{
                  width: 32, height: 32, border: '1px solid var(--border)', borderRadius: 'var(--radius-btn)',
                  background: viewMode === v.mode ? 'var(--accent)' : 'var(--white)',
                  color: viewMode === v.mode ? '#fff' : 'var(--muted)',
                  fontSize: 16, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
                }} >{v.icon}</button>
            ))}
          </div>
        </div>

        {loading && <div style={{ textAlign: 'center', padding: '40px 0', color: 'var(--muted)', fontSize: 14 }}>Загрузка...</div>}

        {!loading && filtered.length === 0 && (
          <div style={{ textAlign: 'center', padding: '40px 0', color: 'var(--muted)', fontSize: 14 }}>Ничего не найдено</div>
        )}

        {/* Grid */}
        {viewMode === 'grid' && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(170px, 1fr))', gap: 12 }}>
            {filtered.map(u => {
              const reqStatus = requestedUnits[u.id]
              return (
                <div key={u.id} onClick={() => setCardId(u.id)} style={{
                  background: 'var(--card)', borderRadius: 'var(--radius-card)',
                  border: '1px solid var(--border)', cursor: 'pointer', overflow: 'hidden',
                }}>
                  <div style={{
                    aspectRatio: '1', background: 'var(--bg)', display: 'flex',
                    alignItems: 'center', justifyContent: 'center', fontSize: 40, overflow: 'hidden',
                  }}>
                    {u.photo_url
                      ? <img src={u.photo_url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                      : <span>📦</span>}
                  </div>
                  <div style={{ padding: '10px 12px' }}>
                    <div style={{ fontWeight: 500, fontSize: 13, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{u.name}</div>
                    <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>{categoryLabel(u.category)}</div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 6 }}>
                      <Badge color={STATUS_COLOR[u.status]}>{STATUS_LABEL[u.status]}</Badge>
                      {!reqStatus && u.status === 'on_stock' && (
                        <button onClick={e => { e.stopPropagation(); cart.includes(u.id) ? removeFromCart(u.id) : addToCart(u.id) }}
                          style={{ fontSize: 11, padding: '2px 8px', borderRadius: 6, border: '1px solid var(--border)', background: cart.includes(u.id) ? 'var(--red)' : 'var(--accent)', color: '#fff', cursor: 'pointer' }}>
                          {cart.includes(u.id) ? '−' : '+'}
                        </button>
                      )}
                      {reqStatus && REQUEST_STATUSES[reqStatus] && <Badge color={REQUEST_STATUSES[reqStatus].color}>{REQUEST_STATUSES[reqStatus].label}</Badge>}
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )}

        {/* Rows */}
        {viewMode === 'rows' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {filtered.map(u => {
              const reqStatus = requestedUnits[u.id]
              const isOpen = expanded === u.id
              return (
                <div key={u.id} style={{
                  background: 'var(--white)', borderRadius: 'var(--radius-card)',
                  border: '1px solid var(--border)', overflow: 'hidden',
                }}>
                  <div className="wv-row" style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '14px 16px', cursor: 'pointer' }}
                    onClick={() => setExpanded(isOpen ? null : u.id)}>
                    <div className="wv-photo" style={{
                      width: 52, height: 52, borderRadius: 8, flexShrink: 0,
                      background: 'var(--bg)', border: '1px solid var(--border)',
                      display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22,
                      overflow: 'hidden',
                    }}>
                      {u.photo_url
                        ? <img src={u.photo_url} alt="" style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
                        : '📦'}
                    </div>
                    <div className="wv-info" style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 500, fontSize: 14, cursor: 'pointer', color: 'var(--accent)' }}
                        onClick={e => { e.stopPropagation(); setCardId(u.id) }}>{u.name}</div>
                      <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>
                        {u.serial ? `${u.serial} · ` : ''}{categoryLabel(u.category)}{(u.cell_custom || u.cell_code) ? ` · Полка ${u.cell_custom || u.cell_code}` : ''}
                      </div>
                    </div>
                    <div className="wv-right" style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
                      <Badge color={STATUS_COLOR[u.status]}>{STATUS_LABEL[u.status]}</Badge>
                      <div onClick={e => e.stopPropagation()}>
                        {!reqStatus && u.status === 'on_stock' ? (
                          cart.includes(u.id) ? (
                            <Button variant="secondary" style={{ height: 34, fontSize: 13, padding: '0 14px', color: 'var(--red)' }}
                              onClick={() => removeFromCart(u.id)}>Убрать</Button>
                          ) : (
                            <Button style={{ height: 34, fontSize: 13, padding: '0 14px' }}
                              onClick={() => addToCart(u.id)}>В корзину</Button>
                          )
                        ) : reqStatus && REQUEST_STATUSES[reqStatus] ? (
                          <Badge color={REQUEST_STATUSES[reqStatus].color}>{REQUEST_STATUSES[reqStatus].label}</Badge>
                        ) : (
                          <Badge color="muted">Недоступно</Badge>
                        )}
                      </div>
                    </div>
                    <span className="wv-chevron" style={{ color: 'var(--muted)', fontSize: 14, transition: 'transform 0.2s', transform: isOpen ? 'rotate(90deg)' : 'none' }}>›</span>
                  </div>
                  {isOpen && u.description && (
                    <div style={{ borderTop: '1px solid var(--border)', padding: '14px 16px', background: 'var(--bg)' }}>
                      <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 4 }}>Описание</div>
                      <div style={{ fontSize: 13, lineHeight: 1.5 }}>{u.description}</div>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}

        {/* List */}
        {viewMode === 'list' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            {filtered.map(u => {
              const reqStatus = requestedUnits[u.id]
              return (
                <div key={u.id} onClick={() => setCardId(u.id)} style={{
                  display: 'flex', alignItems: 'center', gap: 12, padding: '8px 12px',
                  background: 'var(--card)', borderRadius: 'var(--radius-btn)', cursor: 'pointer',
                }}>
                  <div style={{ flex: 1, minWidth: 0, fontSize: 13, fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{u.name}</div>
                  {u.serial && <span style={{ fontSize: 12, color: 'var(--muted)', flexShrink: 0 }}>{u.serial}</span>}
                  <span style={{ fontSize: 12, color: 'var(--muted)', flexShrink: 0 }}>{categoryLabel(u.category)}</span>
                  <Badge color={STATUS_COLOR[u.status]}>{STATUS_LABEL[u.status]}</Badge>
                  <div onClick={e => e.stopPropagation()}>
                    {!reqStatus && u.status === 'on_stock' && (
                      <button onClick={() => cart.includes(u.id) ? removeFromCart(u.id) : addToCart(u.id)}
                        style={{ fontSize: 11, padding: '2px 8px', borderRadius: 6, border: '1px solid var(--border)', background: cart.includes(u.id) ? 'var(--red)' : 'var(--accent)', color: '#fff', cursor: 'pointer' }}>
                        {cart.includes(u.id) ? '−' : '+'}
                      </button>
                    )}
                    {reqStatus && REQUEST_STATUSES[reqStatus] && <Badge color={REQUEST_STATUSES[reqStatus].color}>{REQUEST_STATUSES[reqStatus].label}</Badge>}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
      {cardId && <UnitCardModal unitId={cardId} onClose={() => setCardId(null)} />}

      {/* Floating cart button */}
      {cart.length > 0 && !showCart && (
        <button onClick={() => setShowCart(true)} style={{
          position: 'fixed', bottom: 24, right: 24, zIndex: 300,
          height: 52, padding: '0 24px', borderRadius: 26,
          background: 'var(--blue)', color: '#fff', border: 'none',
          fontSize: 14, fontWeight: 600, cursor: 'pointer',
          boxShadow: '0 4px 16px rgba(0,0,0,0.18)',
          display: 'flex', alignItems: 'center', gap: 8,
        }}>
          🛒 Корзина ({cart.length})
        </button>
      )}

      {/* Cart modal */}
      {showCart && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 400, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}
          onClick={() => setShowCart(false)}>
          <div style={{ background: 'var(--white)', borderRadius: 'var(--radius-card)', padding: 24, maxWidth: 500, width: '100%', maxHeight: '80vh', overflowY: 'auto' }}
            onClick={e => e.stopPropagation()}>
            <div style={{ fontWeight: 600, fontSize: 16, marginBottom: 16 }}>Корзина ({cart.length})</div>
            {cart.length === 0 ? (
              <div style={{ color: 'var(--muted)', fontSize: 13, padding: '20px 0', textAlign: 'center' }}>Корзина пуста</div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 16 }}>
                {cart.map(uid => {
                  const u = units.find(x => x.id === uid)
                  if (!u) return null
                  return (
                    <div key={uid} style={{
                      display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px',
                      borderRadius: 8, background: 'var(--bg)', border: '1px solid var(--border)',
                    }}>
                      <div style={{
                        width: 40, height: 40, borderRadius: 6, flexShrink: 0,
                        background: 'var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontSize: 16, overflow: 'hidden',
                      }}>
                        {u.photo_url
                          ? <img src={u.photo_url} alt="" style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
                          : '📦'}
                      </div>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontWeight: 500, fontSize: 13 }}>{u.name}</div>
                        <div style={{ fontSize: 11, color: 'var(--muted)' }}>{u.serial || ''}</div>
                      </div>
                      <button onClick={() => removeFromCart(uid)} style={{
                        fontSize: 18, color: 'var(--muted)', background: 'none', border: 'none', cursor: 'pointer', padding: '0 4px',
                      }}>×</button>
                    </div>
                  )
                })}
              </div>
            )}
            <div style={{ display: 'flex', gap: 8 }}>
              <Button variant="secondary" fullWidth onClick={() => setShowCart(false)}>Закрыть</Button>
              <Button fullWidth disabled={cart.length === 0 || cartSending} onClick={submitCart}>
                {cartSending ? 'Отправка...' : `Оформить заявку (${cart.length})`}
              </Button>
            </div>
          </div>
        </div>
      )}
      {successPopup && (
        <div style={{
          position: 'fixed', top: 24, left: '50%', transform: 'translateX(-50%)', zIndex: 500,
          background: 'var(--green)', color: '#fff', padding: '12px 24px', borderRadius: 12,
          fontWeight: 600, fontSize: 14, boxShadow: '0 4px 20px rgba(0,0,0,0.15)',
        }}>
          Заявка успешно оформлена
        </div>
      )}
      {publicLink && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 500, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}
          onClick={() => { setPublicLink(''); setLinkCopied(false) }}>
          <div style={{ background: 'var(--white)', borderRadius: 'var(--radius-card)', padding: 24, maxWidth: 440, width: '100%' }}
            onClick={e => e.stopPropagation()}>
            <div style={{ fontWeight: 600, fontSize: 16, marginBottom: 8 }}>Публичная ссылка на склад</div>
            <div style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 16 }}>Отправьте эту ссылку для просмотра склада и подачи заявки на аренду</div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 16 }}>
              <input readOnly value={publicLink} style={{ flex: 1, height: 38, padding: '0 10px', border: '1px solid var(--border)', borderRadius: 'var(--radius-btn)', fontSize: 12, background: 'var(--bg)', fontFamily: 'monospace' }} />
              <Button onClick={() => { navigator.clipboard.writeText(publicLink); setLinkCopied(true) }}>
                {linkCopied ? '✓ Скопировано' : 'Копировать'}
              </Button>
            </div>
            <Button variant="secondary" fullWidth onClick={() => { setPublicLink(''); setLinkCopied(false) }}>Закрыть</Button>
          </div>
        </div>
      )}
    </ProductionLayout>
  )
}
