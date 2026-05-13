import { useState, useEffect, useRef } from 'react'
import { ShoppingCart, X, Package, Plus, Minus } from 'lucide-react'
import ProductionLayout from './ProductionLayout'
import Badge from '../shared/Badge'
import Button from '../shared/Button'
import ConfirmModal from '../shared/ConfirmModal'
import UnitCardModal from '../shared/UnitCardModal'
import TruncTip from '../shared/TruncTip'
import UnitMissingDataBadge from '../shared/UnitMissingDataBadge'
import { missingUnitCardStyle } from '../../utils/unitMissingData'
import { STATUS_LABEL, STATUS_COLOR } from '../../constants/statuses'
import { ALL_CATEGORIES, CATEGORIES_FILTER, categoryLabel } from '../../constants/categories'
import { IS_CLOTHING_CAT } from '../../constants/clothingSizes'
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
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const searchTimer = useRef(null)
  const [category, setCategory] = useState('all')
  const [requestedUnits, setRequestedUnits] = useState({})
  const [expanded, setExpanded] = useState(null)
  // Синхронный peek в localStorage-кэш — даёт мгновенный показ старого
  // списка вместо "Загрузка..." на холодном старте Serverless Container.
  const _cached = unitsApi.listCached({})
  const [units, setUnits] = useState(_cached?.units || [])
  const [loading, setLoading] = useState(!_cached)
  const [cardId, setCardId] = useState(null)
  const [whList, setWhList] = useState([])
  const [selectedWh, setSelectedWh] = useState('all')
  const [cart, setCart] = useState([])
  const [showCart, setShowCart] = useState(false)
  const [cartDateStart, setCartDateStart] = useState('')
  const [cartDateEnd, setCartDateEnd] = useState('')
  const [cartSending, setCartSending] = useState(false)
  const [successPopup, setSuccessPopup] = useState(false)
  const [confirmCart, setConfirmCart] = useState(false)
  const [viewMode, setViewMode] = useState(() => localStorage.getItem('unitsViewMode') || 'grid')
  const [publicLink, setPublicLink] = useState('')
  const [linkCopied, setLinkCopied] = useState(false)
  const { user } = useAuth()

  // Debounce search input — same as warehouse UnitsPage
  useEffect(() => {
    clearTimeout(searchTimer.current)
    searchTimer.current = setTimeout(() => setDebouncedSearch(search), 300)
    return () => clearTimeout(searchTimer.current)
  }, [search])

  // Server-side search — calls GET /units?search=... (same API as warehouse)
  useEffect(() => {
    const params = {}
    if (debouncedSearch.trim()) params.search = debouncedSearch.trim()
    unitsApi.list(params)
      .then(d => setUnits(d.units || []))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [debouncedSearch])

  useEffect(() => {
    warehousesApi.list().then(d => setWhList(d.warehouses || [])).catch(() => {})
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
    if (!cartDateStart || !cartDateEnd) return
    setCartSending(true)
    try {
      const periodNote = `Период аренды: ${new Date(cartDateStart).toLocaleDateString('ru-RU')} — ${new Date(cartDateEnd).toLocaleDateString('ru-RU')}`
      await requestsApi.create({
        unit_ids: cart,
        project_id: user?.project_id || null,
        deadline: cartDateEnd,
        notes: periodNote,
      })
      const map = { ...requestedUnits }
      for (const id of cart) map[id] = 'pending'
      setRequestedUnits(map)
      setCart([])
      setCartDateStart('')
      setCartDateEnd('')
      setShowCart(false)
      setSuccessPopup(true)
      setTimeout(() => setSuccessPopup(false), 2500)
    } catch { alert('Ошибка отправки заявки') }
    setCartSending(false)
  }

  const filtered = units.filter(u => {
    const matchCat = category === 'all' || u.category === category
    const matchWh = selectedWh === 'all' || u.warehouse_id === selectedWh
    return matchCat && matchWh
  })

  // Split into 3 tiers: direct → similar (close synonyms) → related (category siblings)
  const directUnits = filtered.filter(u => !u._match || u._match === 'direct')
  const similarUnits = filtered.filter(u => u._match === 'similar')
  const relatedUnits = filtered.filter(u => u._match === 'related')
  const isSearching = debouncedSearch.trim().length > 0

  return (
    <ProductionLayout>
      <style>{`
        /* 2 карточки в ряд на узких экранах (Android ~360px, старые iPhone).
           См. комментарий в UnitsPage — auto-fill уходит в 1 колонку при
           горизонтальных отступах, поэтому фиксируем явно. */
        @media (max-width: 480px) {
          .catalog-grid {
            grid-template-columns: repeat(2, 1fr) !important;
            gap: 10px !important;
          }
          .wv-page { padding: 16px 12px !important; }
        }
        @media (max-width: 768px) {
          .wv-row { flex-wrap: wrap !important; gap: 10px !important; padding: 12px 14px !important; }
          .wv-info { width: 100% !important; order: 2; }
          .wv-photo { order: 1; }
          .wv-right { width: 100% !important; order: 3; display: flex; align-items: center; justify-content: space-between; }
          .wv-chevron { display: none !important; }
        }
      `}</style>
      <div className="wv-page" style={{ padding: '24px 32px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24, gap: 12 }}>
          <div>
            <h1 style={{ fontSize: 20, fontWeight: 600 }}>Каталог</h1>
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
              }}>Партнёрская ссылка</Button>
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
            {CATEGORIES_FILTER.map(c => <option key={c} value={c}>{c === 'all' ? 'Категория' : categoryLabel(c)}</option>)}
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
          <div>
          <div className="catalog-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(170px, 1fr))', gap: 12 }}>
            {(isSearching ? directUnits : filtered).map(u => {
              const reqStatus = requestedUnits[u.id]
              const isWrittenOff = u.status === 'written_off' || u.misplaced
              const missingStyle = missingUnitCardStyle(u, user?.role)
              return (
                <div key={u.id} onClick={() => setCardId(u.id)} style={{
                  background: isWrittenOff ? 'var(--bg-secondary)' : 'var(--card)',
                  borderRadius: 'var(--radius-card)',
                  border: missingStyle.border || '1px solid var(--border)', cursor: 'pointer', overflow: 'hidden',
                  boxShadow: missingStyle.boxShadow,
                  filter: isWrittenOff ? 'grayscale(1)' : 'none', opacity: isWrittenOff ? 0.6 : 1,
                }}>
                  <div style={{
                    aspectRatio: '1', background: 'var(--bg)', display: 'flex',
                    alignItems: 'center', justifyContent: 'center', fontSize: 40, overflow: 'hidden',
                  }}>
                    {u.photo_url
                      ? <img src={u.photo_url} alt="" loading="lazy" decoding="async" style={{ width: '100%', height: '100%', objectFit: 'cover', filter: isWrittenOff ? 'blur(6px)' : 'none' }} />
                      : <span>📦</span>}
                  </div>
                  <div style={{ padding: '10px 12px' }}>
                    <TruncTip as="div" style={{ fontWeight: 500, fontSize: 13, textDecoration: isWrittenOff ? 'line-through' : 'none', color: isWrittenOff ? 'var(--muted)' : 'var(--text)' }}>{u.name}</TruncTip>
                    <TruncTip
                      as="div"
                      style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}
                      fullText={`${categoryLabel(u.category)}${IS_CLOTHING_CAT(u.category) && u.dimensions ? ` · ${u.dimensions.split('/')[0].trim()}` : ''}`}
                    >
                      {categoryLabel(u.category)}
                      {IS_CLOTHING_CAT(u.category) && u.dimensions && (
                        <>
                          {' · '}
                          <span style={{ color: 'var(--text)', fontWeight: 500 }}>
                            {u.dimensions.split('/')[0].trim()}
                          </span>
                        </>
                      )}
                    </TruncTip>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 6 }}>
                      <Badge color={STATUS_COLOR[u.status]}>{STATUS_LABEL[u.status]}</Badge>
                      {!reqStatus && u.status === 'on_stock' && (
                        <button onClick={e => { e.stopPropagation(); cart.includes(u.id) ? removeFromCart(u.id) : addToCart(u.id) }} style={{
                          display: 'inline-flex', alignItems: 'center', gap: 4,
                          fontSize: 12, fontWeight: 500,
                          color: cart.includes(u.id) ? 'var(--red)' : 'var(--accent)',
                          background: 'none', border: 'none', padding: 0, cursor: 'pointer',
                        }}>
                          {cart.includes(u.id) ? <><Minus size={14} /> Убрать</> : <><Plus size={14} /> В корзину</>}
                        </button>
                      )}
                      {reqStatus && REQUEST_STATUSES[reqStatus] && <Badge color={REQUEST_STATUSES[reqStatus].color}>{REQUEST_STATUSES[reqStatus].label}</Badge>}
                    </div>
                    <UnitMissingDataBadge unit={u} role={user?.role} />
                  </div>
                </div>
              )
            })}
          </div>
          {isSearching && [
            { items: similarUnits, label: 'Похожее', opacity: 0.85 },
            { items: relatedUnits, label: 'Из категории', opacity: 0.65 },
          ].map(({ items, label, opacity }) => items.length > 0 && (
            <div key={label}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, margin: '20px 0 12px', color: 'var(--muted)' }}>
                <div style={{ flex: 1, height: 1, background: 'var(--border)' }} />
                <span style={{ fontSize: 13, fontWeight: 500, whiteSpace: 'nowrap' }}>{label}</span>
                <div style={{ flex: 1, height: 1, background: 'var(--border)' }} />
              </div>
              <div className="catalog-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(170px, 1fr))', gap: 12 }}>
                {items.map(u => {
                  const reqStatus = requestedUnits[u.id]
                  const missingStyle = missingUnitCardStyle(u, user?.role)
                  return (
                    <div key={u.id} onClick={() => setCardId(u.id)} style={{
                      background: 'var(--card)', borderRadius: 'var(--radius-card)',
                      border: missingStyle.border || '1px solid var(--border)', cursor: 'pointer', overflow: 'hidden', opacity,
                      boxShadow: missingStyle.boxShadow,
                    }}>
                      <div style={{ aspectRatio: '1', background: 'var(--bg)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 40, overflow: 'hidden' }}>
                        {u.photo_url ? <img src={u.photo_url} alt="" loading="lazy" decoding="async" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : <span>📦</span>}
                      </div>
                      <div style={{ padding: '10px 12px' }}>
                        <TruncTip as="div" style={{ fontWeight: 500, fontSize: 13 }}>{u.name}</TruncTip>
                        <TruncTip
                          as="div"
                          style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}
                          fullText={`${categoryLabel(u.category)}${IS_CLOTHING_CAT(u.category) && u.dimensions ? ` · ${u.dimensions.split('/')[0].trim()}` : ''}`}
                        >
                          {categoryLabel(u.category)}
                          {IS_CLOTHING_CAT(u.category) && u.dimensions && (
                            <>
                              {' · '}
                              <span style={{ color: 'var(--text)', fontWeight: 500 }}>
                                {u.dimensions.split('/')[0].trim()}
                              </span>
                            </>
                          )}
                        </TruncTip>
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
                        <UnitMissingDataBadge unit={u} role={user?.role} />
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          ))}
          </div>
        )}

        {/* Rows */}
        {viewMode === 'rows' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {filtered.map(u => {
              const reqStatus = requestedUnits[u.id]
              const isOpen = expanded === u.id
              const isWrittenOff = u.status === 'written_off' || u.misplaced
              const missingStyle = missingUnitCardStyle(u, user?.role)
              return (
                <div key={u.id} style={{
                  background: isWrittenOff ? 'var(--bg-secondary)' : 'var(--white)', borderRadius: 'var(--radius-card)',
                  border: missingStyle.border || '1px solid var(--border)', overflow: 'hidden',
                  boxShadow: missingStyle.boxShadow,
                  filter: isWrittenOff ? 'grayscale(1)' : 'none', opacity: isWrittenOff ? 0.6 : 1,
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
                        ? <img src={u.photo_url} alt="" loading="lazy" decoding="async" style={{ width: '100%', height: '100%', objectFit: 'contain', filter: isWrittenOff ? 'blur(4px)' : 'none' }} />
                        : '📦'}
                    </div>
                    <div className="wv-info" style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 500, fontSize: 14, cursor: 'pointer', color: isWrittenOff ? 'var(--muted)' : 'var(--accent)', textDecoration: isWrittenOff ? 'line-through' : 'none' }}
                        onClick={e => { e.stopPropagation(); setCardId(u.id) }}>{u.name}</div>
                      <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>
                        {u.serial ? `${u.serial} · ` : ''}{categoryLabel(u.category)}{(u.cell_custom || u.cell_code) ? ` · Полка ${u.cell_custom || u.cell_code}` : ''}
                    </div>
                    <UnitMissingDataBadge unit={u} role={user?.role} compact />
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
              const isWrittenOff = u.status === 'written_off' || u.misplaced
              return (
                <div key={u.id} onClick={() => setCardId(u.id)} style={{
                  display: 'flex', alignItems: 'center', gap: 12, padding: '8px 12px',
                  background: isWrittenOff ? 'var(--bg-secondary)' : 'var(--card)', borderRadius: 'var(--radius-btn)', cursor: 'pointer',
                  filter: isWrittenOff ? 'grayscale(1)' : 'none', opacity: isWrittenOff ? 0.6 : 1,
                }}>
                  <div style={{ flex: 1, minWidth: 0, fontSize: 13, fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', textDecoration: isWrittenOff ? 'line-through' : 'none', color: isWrittenOff ? 'var(--muted)' : 'var(--text)' }}>{u.name}</div>
                  {u.serial && <span style={{ fontSize: 12, color: 'var(--muted)', flexShrink: 0 }}>{u.serial}</span>}
                  <span style={{ fontSize: 12, color: 'var(--muted)', flexShrink: 0 }}>{categoryLabel(u.category)}</span>
                  <Badge color={STATUS_COLOR[u.status]}>{STATUS_LABEL[u.status]}</Badge>
                  <div onClick={e => e.stopPropagation()}>
                    {!reqStatus && u.status === 'on_stock' && (
                      <button onClick={() => cart.includes(u.id) ? removeFromCart(u.id) : addToCart(u.id)} style={{
                        display: 'inline-flex', alignItems: 'center', gap: 4,
                        fontSize: 12, fontWeight: 500,
                        color: cart.includes(u.id) ? 'var(--red)' : 'var(--accent)',
                        background: 'none', border: 'none', padding: 0, cursor: 'pointer',
                      }}>
                        {cart.includes(u.id) ? <><Minus size={14} /> Убрать</> : <><Plus size={14} /> В корзину</>}
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

      {/* Floating cart — бренд-стиль партнёрского кабинета (gold FAB на ink-900) */}
      {cart.length > 0 && !showCart && (
        <button onClick={() => setShowCart(true)} style={{
          position: 'fixed', bottom: 26, right: 26, zIndex: 300,
          width: 58, height: 58, borderRadius: '50%',
          background: 'var(--ink-900)', border: '2px solid var(--gold-500)',
          color: 'var(--gold-400)', cursor: 'pointer',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          boxShadow: '0 8px 24px rgba(0,0,0,0.25), 0 2px 6px rgba(184,147,90,0.2)',
          transition: 'transform 0.12s',
        }}
          onMouseEnter={e => e.currentTarget.style.transform = 'scale(1.06)'}
          onMouseLeave={e => e.currentTarget.style.transform = 'scale(1)'}
        >
          <ShoppingCart size={22} strokeWidth={1.8} />
          <span style={{
            position: 'absolute', top: -4, right: -4,
            background: 'var(--gold-500)', color: 'var(--ink-900)',
            borderRadius: '50%', width: 22, height: 22,
            fontSize: 11, fontWeight: 700,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontVariantNumeric: 'tabular-nums',
            boxShadow: '0 2px 6px rgba(0,0,0,0.2)',
          }}>{cart.length}</span>
        </button>
      )}

      {/* Cart modal — бренд-стиль партнёрского кабинета */}
      {showCart && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(10,10,10,0.55)', backdropFilter: 'blur(3px)', zIndex: 400, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}
          onClick={() => setShowCart(false)}>
          <div style={{ background: 'var(--white)', borderRadius: 14, padding: 24, maxWidth: 500, width: '100%', maxHeight: '85vh', overflowY: 'auto', boxShadow: '0 16px 48px rgba(0,0,0,0.25)' }}
            onClick={e => e.stopPropagation()}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
              <div style={{ fontWeight: 600, fontSize: 16 }}>Корзина ({cart.length})</div>
              <button onClick={() => setShowCart(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--muted)', padding: 4 }}><X size={18} /></button>
            </div>
            {cart.length === 0 ? (
              <div style={{ color: 'var(--muted)', fontSize: 13, padding: '20px 0', textAlign: 'center' }}>Корзина пуста</div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 20 }}>
                {cart.map(uid => {
                  const u = units.find(x => x.id === uid)
                  if (!u) return null
                  return (
                    <div key={uid} style={{
                      display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px',
                      border: '1px solid var(--border)', borderRadius: 'var(--radius-btn)',
                    }}>
                      <div style={{
                        width: 40, height: 40, borderRadius: 6, flexShrink: 0,
                        background: 'var(--bg)',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        overflow: 'hidden',
                      }}>
                        {u.photo_url
                          ? <img src={u.photo_url} alt="" loading="lazy" decoding="async" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                          : <Package size={16} style={{ color: 'var(--muted)' }} />}
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 13, fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{u.name}</div>
                        <div style={{ fontSize: 11, color: 'var(--muted)' }}>{categoryLabel(u.category)}</div>
                      </div>
                      <button onClick={() => removeFromCart(uid)} style={{
                        background: 'none', border: 'none', cursor: 'pointer', color: 'var(--red)', padding: 4,
                      }}><X size={16} /></button>
                    </div>
                  )
                })}
              </div>
            )}
            {/* Период аренды — обязательно, как в публичной ссылке */}
            {cart.length > 0 && (
              <div style={{ marginBottom: 14 }}>
                <div style={{ fontSize: 12, fontWeight: 500, marginBottom: 6, color: 'var(--text)' }}>Период использования *</div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 10, color: 'var(--muted)', marginBottom: 4 }}>С</div>
                    <input type="date" value={cartDateStart} onChange={e => setCartDateStart(e.target.value)}
                      min={new Date().toISOString().slice(0, 10)}
                      style={{ width: '100%', height: 36, padding: '0 10px', border: '1px solid var(--border)', borderRadius: 8, fontSize: 13, boxSizing: 'border-box' }} />
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 10, color: 'var(--muted)', marginBottom: 4 }}>По</div>
                    <input type="date" value={cartDateEnd} onChange={e => setCartDateEnd(e.target.value)}
                      min={cartDateStart || new Date().toISOString().slice(0, 10)}
                      style={{ width: '100%', height: 36, padding: '0 10px', border: '1px solid var(--border)', borderRadius: 8, fontSize: 13, boxSizing: 'border-box' }} />
                  </div>
                </div>
              </div>
            )}

            <div style={{ display: 'flex', gap: 8 }}>
              <Button variant="secondary" fullWidth onClick={() => setShowCart(false)}>Закрыть</Button>
              <Button fullWidth disabled={cart.length === 0 || cartSending || !cartDateStart || !cartDateEnd} onClick={() => setConfirmCart(true)}>
                {cartSending ? 'Отправка...' : `Оформить заявку (${cart.length})`}
              </Button>
            </div>
            {cart.length > 0 && (!cartDateStart || !cartDateEnd) && (
              <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 8, textAlign: 'center' }}>
                Укажите даты начала и окончания использования
              </div>
            )}
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
      <ConfirmModal
        open={confirmCart}
        title="Подтвердить заявку"
        message={cart.length > 0 && cartDateStart && cartDateEnd
          ? `Отправить заявку на ${cart.length} ед. на период ${new Date(cartDateStart).toLocaleDateString('ru-RU')} — ${new Date(cartDateEnd).toLocaleDateString('ru-RU')}?`
          : ''}
        confirmLabel="Подтвердить"
        cancelLabel="Отмена"
        onConfirm={() => { setConfirmCart(false); submitCart() }}
        onCancel={() => setConfirmCart(false)}
      />
      {publicLink && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 500, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}
          onClick={() => { setPublicLink(''); setLinkCopied(false) }}>
          <div style={{ background: 'var(--white)', borderRadius: 'var(--radius-card)', padding: 24, maxWidth: 440, width: '100%' }}
            onClick={e => e.stopPropagation()}>
            <div style={{ fontWeight: 600, fontSize: 16, marginBottom: 8 }}>Партнёрская ссылка на склад</div>
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
