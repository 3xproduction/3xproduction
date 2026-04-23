import { useEffect, useState, useRef } from 'react'
import { X, ZoomIn, ChevronLeft, ChevronRight, Package, Archive, Plus, Minus, History } from 'lucide-react'
import Lightbox from './Lightbox'
import Button from './Button'
import { categoryLabel } from '../../constants/categories'
import { STATUS_LABEL } from '../../constants/statuses'
import { useBodyLock } from '../../hooks/useBodyLock'

// Публичный аналог UnitCardModal — визуально 1-в-1 с директором склада
// (тот же набор `.uc-*`-классов), но без вызовов авторизованных API:
// unit передаётся из уже загруженного каталога, «Похожие» тянутся через
// публичный endpoint по category. История показывается с фото движений и
// названием проекта/контрагента (user_name намеренно не раскрываем).

const BASE = import.meta.env.VITE_API_URL || ''

const STATUS_DOT = {
  on_stock:    'var(--green)',
  issued:      'var(--blue)',
  overdue:     'var(--red)',
  pending:     'var(--gold-500)',
  written_off: 'var(--muted)',
}

export default function PublicUnitCardModal({ unit: initialUnit, token, onClose, inCart, onToggleCart, onSwitchUnit }) {
  const [unit, setUnit] = useState(initialUnit)
  const [tab, setTab] = useState('info') // 'info' | 'history' | 'similar'
  const [activePhoto, setActivePhoto] = useState(0)
  const [lightbox, setLightbox] = useState(null)
  const [similar, setSimilar] = useState([])
  const [similarLoaded, setSimilarLoaded] = useState(false)
  const [history, setHistory] = useState([])
  const [historyLoaded, setHistoryLoaded] = useState(false)
  const [descExpanded, setDescExpanded] = useState(false)
  const [mobileSlide, setMobileSlide] = useState(0)
  const galleryRef = useRef(null)

  useBodyLock(true)

  useEffect(() => {
    setUnit(initialUnit)
    setActivePhoto(0)
    setTab('info')
    setSimilar([])
    setSimilarLoaded(false)
    setHistory([])
    setHistoryLoaded(false)
  }, [initialUnit?.id])

  useEffect(() => {
    if (tab !== 'similar' || similarLoaded) return
    if (!unit?.category) { setSimilarLoaded(true); return }
    const params = new URLSearchParams({ category: unit.category })
    fetch(`${BASE}/public/warehouse/${token}?${params.toString()}`)
      .then(r => r.json())
      .then(d => {
        const list = (d.units || []).filter(s => s.id !== unit.id).slice(0, 8)
        setSimilar(list)
      })
      .catch(() => {})
      .finally(() => setSimilarLoaded(true))
  }, [tab, unit?.id, token])

  useEffect(() => {
    if (tab !== 'history' || historyLoaded || !unit?.id) return
    fetch(`${BASE}/public/warehouse/${token}/units/${unit.id}/history`)
      .then(r => r.json())
      .then(d => setHistory(d.history || []))
      .catch(() => {})
      .finally(() => setHistoryLoaded(true))
  }, [tab, unit?.id, token])

  if (!unit) return null

  const photos = (unit.photos || []).map(p => typeof p === 'string' ? { url: p } : p)
  const photo = photos[activePhoto]
  const isVideo = photo?.url && /\.(mp4|webm|mov)$/i.test(photo.url)
  const statusDot = STATUS_DOT[unit.status] || 'var(--muted)'
  const available = unit.status === 'on_stock'
  const added = !!inCart

  return (
    <>
      <style>{css}</style>
      <div className="uc-overlay" onClick={e => { if (e.target === e.currentTarget) onClose() }}>
        <div className="uc-modal" onClick={e => e.stopPropagation()}>

          {/* Header */}
          <div className="uc-head">
            <div className="uc-head-main">
              <div className="uc-title">{unit.name}</div>
              <div className="uc-sub">
                <span>{categoryLabel(unit.category)}</span>
                <span className="uc-sep">·</span>
                <span className="uc-status">
                  <span className="uc-dot" style={{ background: statusDot }} />
                  {STATUS_LABEL[unit.status] || (available ? 'Доступно' : 'Занято')}
                </span>
              </div>
            </div>
            <button className="uc-close" onClick={onClose} aria-label="Закрыть"><X size={18} /></button>
          </div>

          {/* Tabs */}
          <div className="uc-tabs">
            <button className={`uc-tab${tab === 'info' ? ' active' : ''}`} onClick={() => setTab('info')}>
              <Package size={13} /> Карточка
            </button>
            <button className={`uc-tab${tab === 'history' ? ' active' : ''}`} onClick={() => setTab('history')}>
              <History size={13} /> История
            </button>
            <button className={`uc-tab${tab === 'similar' ? ' active' : ''}`} onClick={() => setTab('similar')}>
              <Archive size={13} /> Похожие {similar.length > 0 && <span className="uc-tab-count">{similar.length}</span>}
            </button>
          </div>

          {/* Body */}
          <div className="uc-body">
            {tab === 'info' && (
              <div className="uc-grid">
                {/* Фото слева */}
                <div className="uc-photo-col">
                  <div className="uc-photo-main" onClick={() => photo?.url && !isVideo && setLightbox(activePhoto)}>
                    {photo?.url ? (
                      isVideo ? (
                        <video src={photo.url} controls preload="metadata" />
                      ) : (
                        <>
                          <img src={photo.url} alt="" />
                          <span className="uc-zoom"><ZoomIn size={12} color="#fff" /></span>
                        </>
                      )
                    ) : (
                      <Package size={48} color="var(--gold-500)" strokeWidth={1.2} />
                    )}
                    {photos.length > 1 && (
                      <>
                        <button className="uc-nav uc-nav-prev" onClick={e => { e.stopPropagation(); setActivePhoto(p => (p - 1 + photos.length) % photos.length) }}>
                          <ChevronLeft size={16} />
                        </button>
                        <button className="uc-nav uc-nav-next" onClick={e => { e.stopPropagation(); setActivePhoto(p => (p + 1) % photos.length) }}>
                          <ChevronRight size={16} />
                        </button>
                      </>
                    )}
                  </div>
                  {photos.length > 1 && (
                    <div className="uc-thumbs">
                      {photos.map((p, i) => (
                        <button key={i} onClick={() => setActivePhoto(i)}
                          className={`uc-thumb${i === activePhoto ? ' active' : ''}`}>
                          {p.url
                            ? /\.(mp4|webm|mov)$/i.test(p.url)
                              ? <video src={p.url} muted preload="metadata" />
                              : <img src={p.url} alt="" />
                            : <Package size={18} color="var(--subtle)" />}
                        </button>
                      ))}
                    </div>
                  )}

                  {/* Мобильная галерея swipe+snap */}
                  <div
                    className="uc-gallery-mobile"
                    ref={galleryRef}
                    onScroll={e => {
                      const el = e.currentTarget
                      const w = el.clientWidth
                      if (!w) return
                      const idx = Math.round(el.scrollLeft / w)
                      if (idx !== mobileSlide) setMobileSlide(idx)
                    }}
                  >
                    {(photos.length ? photos : [{}]).map((p, i) => (
                      <div key={i} className="uc-gallery-slide"
                        onClick={() => p.url && !/\.(mp4|webm|mov)$/i.test(p.url) && setLightbox(i)}>
                        {p.url
                          ? /\.(mp4|webm|mov)$/i.test(p.url)
                            ? <video src={p.url} muted playsInline preload="metadata" controls />
                            : <img src={p.url} alt="" />
                          : <Package size={48} color="var(--gold-500)" strokeWidth={1.2} />}
                      </div>
                    ))}
                  </div>
                  {photos.length > 1 && (
                    <div className="uc-dots-mobile">
                      {photos.map((_, i) => (
                        <div key={i} className={`uc-dot${i === mobileSlide ? ' active' : ''}`} />
                      ))}
                    </div>
                  )}
                </div>

                {/* Инфо справа */}
                <div className="uc-info-col">
                  <div className="uc-rows">
                    {unit.serial     && <Row label="Серийный" value={unit.serial} />}
                    {unit.qty        && <Row label="Количество" value={`${unit.qty} шт.`} />}
                    {unit.dimensions && <Row label="Размеры" value={unit.dimensions} />}
                    {unit.period     && <Row label="Период" value={unit.period} />}
                  </div>

                  {unit.description && (
                    <div className="uc-desc">
                      <div className="uc-desc-label">Описание</div>
                      <div className={`uc-desc-text${!descExpanded ? ' collapsed' : ''}`}>{unit.description}</div>
                      {unit.description.length > 140 && (
                        <button className="uc-desc-toggle" onClick={() => setDescExpanded(v => !v)}>
                          {descExpanded ? 'Свернуть' : 'Показать полностью'}
                        </button>
                      )}
                    </div>
                  )}
                </div>
              </div>
            )}

            {tab === 'history' && (
              <div className="uc-history">
                {!historyLoaded ? (
                  <div className="uc-empty">Загрузка…</div>
                ) : history.length === 0 ? (
                  <div className="uc-empty">История пуста</div>
                ) : (
                  history.map(h => {
                    const isMovement = /Выдано|Возврат|Долг|Списано/.test(h.action || '')
                    const subject = isMovement ? (h.project_name || '—') : '—'
                    const photos = Array.isArray(h.photos) ? h.photos : []
                    const urls = photos.map(p => p.url)
                    return (
                      <div key={h.id} className="uc-hist-row">
                        <div className="uc-hist-dot" />
                        <div className="uc-hist-text">
                          <div className="uc-hist-action">{h.action}</div>
                          <div className="uc-hist-meta">{subject}{h.notes ? ` · ${h.notes}` : ''}</div>
                          {photos.length > 0 && (
                            <div className="uc-hist-photos">
                              {photos.map((p, i) => (
                                <button key={p.id || i} className="uc-hist-thumb"
                                  onClick={() => setLightbox({ urls, idx: i })}>
                                  {/\.(mp4|webm|mov)$/i.test(p.url)
                                    ? <video src={p.url} muted preload="metadata" />
                                    : <img src={p.url} alt="" />}
                                </button>
                              ))}
                            </div>
                          )}
                        </div>
                        <div className="uc-hist-time">
                          {new Date(h.created_at).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                        </div>
                      </div>
                    )
                  })
                )}
              </div>
            )}

            {tab === 'similar' && (
              !similarLoaded ? (
                <div className="uc-empty">Загрузка…</div>
              ) : similar.length === 0 ? (
                <div className="uc-empty">Похожих единиц нет</div>
              ) : (
                <div className="uc-similar-grid">
                  {similar.map(s => (
                    <button key={s.id} className="uc-similar-card" onClick={() => onSwitchUnit?.(s)}>
                      <div className="uc-similar-photo">
                        {s.photos?.[0]
                          ? <img src={typeof s.photos[0] === 'string' ? s.photos[0] : s.photos[0].url} alt="" />
                          : <Package size={22} color="var(--gold-500)" strokeWidth={1.4} />}
                      </div>
                      <div className="uc-similar-name">{s.name}</div>
                    </button>
                  ))}
                </div>
              )
            )}
          </div>

          {/* Sticky actions — В корзину / Убрать */}
          {available && onToggleCart && tab === 'info' && (
            <div className="uc-actions">
              {added ? (
                <Button variant="secondary" fullWidth onClick={() => onToggleCart(unit.id)}>
                  <Minus size={14} /> Убрать из корзины
                </Button>
              ) : (
                <Button fullWidth onClick={() => onToggleCart(unit.id)}>
                  <Plus size={14} /> В корзину
                </Button>
              )}
            </div>
          )}
        </div>
      </div>

      {lightbox !== null && (
        <Lightbox
          photos={typeof lightbox === 'object' ? lightbox.urls : photos.map(p => p.url)}
          startIndex={typeof lightbox === 'object' ? lightbox.idx : lightbox}
          onClose={() => setLightbox(null)}
        />
      )}
    </>
  )
}

function Row({ label, value }) {
  return (
    <div className="uc-row">
      <span className="uc-row-label">{label}</span>
      <span className="uc-row-value">{value}</span>
    </div>
  )
}

// Стили 1-в-1 с UnitCardModal (префикс uc-*). Дублирование намеренное —
// чтобы публичный модальный не тащил авторизованный компонент целиком.
const css = `
.uc-overlay {
  position: fixed; inset: 0;
  background: rgba(10,10,10,0.55);
  backdrop-filter: blur(3px);
  display: flex; align-items: center; justify-content: center;
  padding: 20px;
  z-index: 500;
}
.uc-modal {
  background: var(--card);
  border-radius: 16px;
  width: 100%; max-width: 880px;
  max-height: 92vh;
  display: flex; flex-direction: column;
  overflow: hidden;
  box-shadow: 0 20px 60px rgba(0,0,0,0.3);
}
@media (max-width: 768px) {
  .uc-overlay { padding: 0; align-items: stretch; }
  .uc-modal {
    max-height: 100vh;
    height: 100dvh;
    border-radius: 0;
  }
  .uc-head {
    padding: 12px 14px 8px;
    position: sticky; top: 0; z-index: 2;
    background: var(--card);
  }
  .uc-title { font-size: 16px; -webkit-line-clamp: 2; }
  .uc-sub { font-size: 12px; margin-top: 3px; }
  .uc-tabs {
    padding: 0 10px;
    position: sticky; top: 0; z-index: 1;
    background: var(--card);
  }
  .uc-tab { padding: 9px 12px 8px; font-size: 12px; }
  .uc-body { padding: 12px 14px 16px; }
  .uc-actions {
    padding: 10px 14px max(10px, env(safe-area-inset-bottom));
  }
}
.uc-head {
  display: flex; align-items: flex-start; justify-content: space-between;
  padding: 18px 22px 14px;
  gap: 16px;
  border-bottom: 1px solid var(--border);
}
.uc-head-main { flex: 1; min-width: 0; }
.uc-title {
  font-size: 18px; font-weight: 600;
  color: var(--text);
  letter-spacing: -0.015em;
  line-height: 1.25;
  overflow: hidden; text-overflow: ellipsis;
  display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical;
}
.uc-sub {
  font-size: 12.5px; color: var(--muted);
  margin-top: 5px;
  display: flex; align-items: center; flex-wrap: wrap; gap: 6px;
}
.uc-sep { opacity: 0.5; }
.uc-status { display: inline-flex; align-items: center; gap: 5px; }
.uc-dot { width: 7px; height: 7px; border-radius: 50%; display: inline-block; }
.uc-close {
  background: transparent; border: none;
  width: 32px; height: 32px; border-radius: 8px;
  color: var(--muted);
  cursor: pointer;
  display: flex; align-items: center; justify-content: center;
  flex-shrink: 0;
  transition: background 0.12s, color 0.12s;
}
.uc-close:hover { background: var(--bg-secondary); color: var(--text); }
.uc-tabs {
  display: flex; gap: 2px;
  padding: 0 20px;
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
}
.uc-tab {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 10px 14px 9px;
  background: none; border: none;
  font-size: 12.5px; font-weight: 500;
  color: var(--muted);
  cursor: pointer;
  border-bottom: 2px solid transparent;
  margin-bottom: -1px;
  font-family: inherit;
  transition: color 0.12s;
}
.uc-tab:hover { color: var(--text); }
.uc-tab.active {
  color: var(--gold-600);
  border-bottom-color: var(--gold-500);
  font-weight: 600;
}
.uc-tab-count {
  background: var(--gold-100);
  color: var(--gold-600);
  font-size: 10px;
  padding: 1px 6px;
  border-radius: 8px;
}
.uc-body { flex: 1; overflow-y: auto; padding: 20px 22px; }
.uc-grid {
  display: grid;
  grid-template-columns: 360px 1fr;
  gap: 24px;
  align-items: start;
}
@media (max-width: 820px) {
  .uc-grid { grid-template-columns: 1fr; gap: 14px; }
}
@media (max-width: 768px) {
  .uc-photo-col { margin: 0 -14px; }
  .uc-photo-main { display: none !important; }
  .uc-thumbs { display: none !important; }
  .uc-gallery-mobile {
    display: flex !important;
    overflow-x: auto;
    scroll-snap-type: x mandatory;
    scroll-behavior: smooth;
    scrollbar-width: none;
    -webkit-overflow-scrolling: touch;
  }
  .uc-gallery-mobile::-webkit-scrollbar { display: none; }
  .uc-gallery-slide {
    flex: 0 0 100%;
    aspect-ratio: 3 / 4;
    max-height: 42vh;
    scroll-snap-align: center;
    background: var(--paper);
    border-top: 1px solid var(--border);
    border-bottom: 1px solid var(--border);
    display: flex; align-items: center; justify-content: center;
    overflow: hidden;
  }
  .uc-gallery-slide img,
  .uc-gallery-slide video {
    width: 100%; height: 100%; object-fit: cover;
  }
  .uc-dots-mobile {
    display: flex !important; justify-content: center; gap: 5px;
    padding: 8px 0 2px;
  }
  .uc-dot {
    width: 6px; height: 6px; border-radius: 50%;
    background: var(--border-strong);
    transition: background 0.15s, width 0.15s;
  }
  .uc-dot.active {
    background: var(--gold-500);
    width: 18px; border-radius: 3px;
  }
  .uc-row { padding: 7px 0; gap: 6px; }
  .uc-row-label { font-size: 11.5px; }
  .uc-row-value { font-size: 12.5px; max-width: 55%; }
}
@media (min-width: 769px) {
  .uc-gallery-mobile, .uc-dots-mobile { display: none; }
}
.uc-photo-col { position: relative; }
.uc-photo-main {
  position: relative;
  width: 100%; aspect-ratio: 4 / 5;
  background: var(--paper);
  border-radius: 12px;
  border: 1px solid var(--border);
  display: flex; align-items: center; justify-content: center;
  overflow: hidden;
  cursor: zoom-in;
}
.uc-photo-main img,
.uc-photo-main video {
  width: 100%; height: 100%; object-fit: contain; display: block;
}
.uc-zoom {
  position: absolute; top: 10px; right: 10px;
  background: rgba(0,0,0,0.55);
  border-radius: 50%;
  width: 26px; height: 26px;
  display: flex; align-items: center; justify-content: center;
}
.uc-nav {
  position: absolute; top: 50%; transform: translateY(-50%);
  width: 32px; height: 32px; border-radius: 50%;
  background: rgba(10,10,10,0.55);
  color: #fff; border: none;
  display: flex; align-items: center; justify-content: center;
  cursor: pointer;
  opacity: 0;
  transition: opacity 0.12s, background 0.12s;
}
.uc-photo-main:hover .uc-nav { opacity: 1; }
.uc-nav:hover { background: rgba(10,10,10,0.75); }
.uc-nav-prev { left: 8px; }
.uc-nav-next { right: 8px; }
.uc-thumbs {
  display: flex; gap: 6px; margin-top: 8px;
  overflow-x: auto; scrollbar-width: none;
}
.uc-thumbs::-webkit-scrollbar { display: none; }
.uc-thumb {
  width: 52px; height: 52px; border-radius: 8px;
  overflow: hidden;
  border: 2px solid var(--border);
  background: var(--paper);
  cursor: pointer;
  flex-shrink: 0; padding: 0;
  display: flex; align-items: center; justify-content: center;
  transition: border-color 0.12s;
}
.uc-thumb:hover { border-color: var(--border-strong); }
.uc-thumb.active { border-color: var(--gold-500); }
.uc-thumb img, .uc-thumb video { width: 100%; height: 100%; object-fit: cover; }
.uc-info-col { min-width: 0; }
.uc-rows {
  display: grid;
  grid-template-columns: 1fr 1fr;
  column-gap: 20px;
  row-gap: 0;
}
@media (max-width: 560px) {
  /* Сохраняем 2 колонки для плотности. */
  .uc-rows { grid-template-columns: 1fr 1fr; column-gap: 12px; }
}
.uc-row {
  display: flex; align-items: center; justify-content: space-between;
  padding: 9px 0;
  gap: 10px;
  border-bottom: 1px solid var(--border);
}
.uc-row-label { color: var(--muted); font-size: 12px; letter-spacing: 0.01em; }
.uc-row-value {
  font-size: 13px; font-weight: 500;
  color: var(--text);
  text-align: right;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  max-width: 60%;
}
.uc-desc { margin-top: 16px; }
.uc-desc-label {
  font-size: 11px; font-weight: 600; color: var(--muted);
  letter-spacing: 0.08em; text-transform: uppercase;
  margin-bottom: 6px;
}
.uc-desc-text { font-size: 13px; line-height: 1.55; color: var(--text); }
.uc-desc-text.collapsed {
  display: -webkit-box;
  -webkit-line-clamp: 3;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.uc-desc-toggle {
  background: none; border: none; padding: 4px 0 0;
  color: var(--gold-600); font-size: 12px; font-weight: 500;
  font-family: inherit; cursor: pointer;
}
.uc-similar-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(130px, 1fr));
  gap: 10px;
}
.uc-similar-card {
  background: var(--card);
  border: 1px solid var(--border);
  border-radius: 10px;
  padding: 0;
  cursor: pointer;
  overflow: hidden;
  font-family: inherit;
  transition: border-color 0.12s, transform 0.08s;
}
.uc-similar-card:hover { border-color: var(--border-strong); }
.uc-similar-card:active { transform: scale(0.98); }
.uc-similar-photo {
  width: 100%; aspect-ratio: 1 / 1;
  background: var(--paper);
  display: flex; align-items: center; justify-content: center;
}
.uc-similar-photo img { width: 100%; height: 100%; object-fit: contain; }
.uc-similar-name {
  padding: 8px 10px;
  font-size: 12px; font-weight: 500;
  color: var(--text);
  text-align: left;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.uc-empty {
  padding: 48px 16px; text-align: center;
  font-size: 13px; color: var(--muted);
}
.uc-history { display: flex; flex-direction: column; }
.uc-hist-row {
  display: flex; align-items: flex-start; gap: 12px;
  padding: 12px 0;
  border-bottom: 1px solid var(--border);
}
.uc-hist-row:last-child { border-bottom: none; }
.uc-hist-dot {
  width: 8px; height: 8px; border-radius: 50%;
  background: var(--gold-500);
  margin-top: 6px;
  flex-shrink: 0;
}
.uc-hist-text { flex: 1; min-width: 0; }
.uc-hist-action { font-size: 13.5px; font-weight: 500; color: var(--text); }
.uc-hist-meta { font-size: 12px; color: var(--muted); margin-top: 2px; }
.uc-hist-time { font-size: 11px; color: var(--subtle); flex-shrink: 0; white-space: nowrap; }
.uc-hist-photos {
  display: flex; flex-wrap: wrap; gap: 6px;
  margin-top: 8px;
}
.uc-hist-thumb {
  width: 44px; height: 44px; border-radius: 6px;
  overflow: hidden;
  border: 1px solid var(--border);
  background: var(--paper);
  padding: 0;
  cursor: zoom-in;
  flex-shrink: 0;
  display: flex; align-items: center; justify-content: center;
  transition: border-color 0.12s, transform 0.08s;
}
.uc-hist-thumb:hover { border-color: var(--gold-500); }
.uc-hist-thumb:active { transform: scale(0.96); }
.uc-hist-thumb img, .uc-hist-thumb video { width: 100%; height: 100%; object-fit: cover; }
.uc-actions {
  flex-shrink: 0;
  display: flex; align-items: center; gap: 8px;
  padding: 14px 22px;
  border-top: 1px solid var(--border);
  background: var(--card);
}
`
