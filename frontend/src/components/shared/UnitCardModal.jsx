import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  X, ZoomIn, ChevronLeft, ChevronRight, Package,
  MapPin, Trash2, MoreVertical, History, Archive, Wallet,
} from 'lucide-react'
import Lightbox from './Lightbox'
import Button from './Button'
import { units as unitsApi, warehouses as warehousesApi, debts as debtsApi, writeoffs as writeoffsApi } from '../../services/api'
import { useAuth } from '../../hooks/useAuth'
import { useBodyLock } from '../../hooks/useBodyLock'
import { STATUS_LABEL } from '../../constants/statuses'
import { categoryLabel } from '../../constants/categories'
import ConfirmModal from './ConfirmModal'
import { useToast } from './Toast'
import { unitFund, FUND_LABEL } from '../../constants/funds'
import { SECTION_TYPE_LABEL } from '../../constants/storageRules'

const WAREHOUSE_ROLES = ['warehouse_director', 'warehouse_deputy', 'warehouse_staff']
const DIRECTOR_ROLES  = ['warehouse_director', 'warehouse_deputy']

// Цвет точки статуса под бренд
const STATUS_DOT = {
  on_stock:    'var(--green)',
  issued:      'var(--blue)',
  overdue:     'var(--red)',
  pending:     'var(--gold-500)',
  written_off: 'var(--muted)',
}

export default function UnitCardModal({ unitId, onClose, onChanged, debt, writeoff, onCloseDebt }) {
  const { user } = useAuth()
  const toast = useToast()
  const navigate = useNavigate()
  const [currentId, setCurrentId]     = useState(unitId)
  const [unit, setUnit]               = useState(null)
  const [loading, setLoading]         = useState(true)
  const [activePhoto, setActivePhoto] = useState(0)
  const [similar, setSimilar]         = useState([])
  const [lightbox, setLightbox]       = useState(null)
  const [tab, setTab] = useState('info') // 'info' | 'history' | 'similar'
  const [moreOpen, setMoreOpen] = useState(false)
  const [showCloseDebtChoice, setShowCloseDebtChoice] = useState(false)
  const [closingDebt, setClosingDebt] = useState(false)

  // Панель перемещения: иерархия Склад → Зал → Секция → Ячейка.
  const [showCell, setShowCell]       = useState(false)
  const [warehouses, setWarehouses]   = useState([])
  const [selWh, setSelWh]             = useState('')
  const [selHall, setSelHall]         = useState('')   // '' = без зала (legacy корневые), или hall_id
  const [selSection, setSelSection]   = useState('')
  const [selCell, setSelCell]         = useState('')
  const [cellSaving, setCellSaving]   = useState(false)
  const [creatingCell, setCreatingCell] = useState(false)

  // Панель списания
  const [showWriteoff, setShowWriteoff]     = useState(false)
  const [writeoffReason, setWriteoffReason] = useState('')
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)

  const isWarehouse = WAREHOUSE_ROLES.includes(user?.role)
  const isDirector  = DIRECTOR_ROLES.includes(user?.role)

  useBodyLock(true)

  useEffect(() => {
    setLoading(true)
    setActivePhoto(0)
    setSimilar([])
    unitsApi.get(currentId)
      .then(d => {
        setUnit(d.unit)
        setLoading(false)
        if (d.unit?.category) {
          unitsApi.list({ category: d.unit.category }).then(r => {
            setSimilar((r.units || []).filter(s => s.id !== currentId).slice(0, 8))
          }).catch(() => {})
        }
      })
      .catch(() => setLoading(false))
  }, [currentId])

  useEffect(() => {
    if (!showCell) return
    warehousesApi.list().then(d => {
      setWarehouses(d.warehouses || [])
      if (unit?.warehouse_id) setSelWh(String(unit.warehouse_id))
    })
  }, [showCell])

  const [sections, setSections] = useState([])
  useEffect(() => {
    if (!selWh) { setSections([]); setSelHall(''); setSelSection(''); setSelCell(''); return }
    warehousesApi.cells(selWh).then(d => setSections(d.sections || []))
    setSelHall(''); setSelSection(''); setSelCell('')
  }, [selWh])

  // При смене зала — сбрасываем секцию и ячейку.
  useEffect(() => { setSelSection(''); setSelCell('') }, [selHall])
  useEffect(() => { setSelCell('') }, [selSection])

  const [historyItems, setHistoryItems] = useState([])
  const [historyLoaded, setHistoryLoaded] = useState(false)
  const [descExpanded, setDescExpanded] = useState(false)
  const [mobileSlide, setMobileSlide] = useState(0)
  const galleryRef = useRef(null)
  useEffect(() => {
    if (tab === 'history' && !historyLoaded) {
      unitsApi.history(currentId)
        .then(d => setHistoryItems(d.history || []))
        .catch(() => {})
        .finally(() => setHistoryLoaded(true))
    }
  }, [tab, currentId])

  async function handleAssignCell() {
    if (!selCell) return
    setCellSaving(true)
    try {
      const u = unit
      const payload = {
        name: u.name, category: u.category, serial: u.serial,
        warehouse_id: selWh,
        cell_id: selCell,
        pavilion_id: null,
        description: u.description, qty: u.qty,
        condition: u.condition, valuation: u.valuation,
      }
      await unitsApi.update(currentId, payload)
      const d = await unitsApi.get(currentId)
      setUnit(d.unit)
      setShowCell(false)
      setSelWh(''); setSelHall(''); setSelSection(''); setSelCell('')
      toast?.('Единица размещена', 'success')
      onChanged?.()
    } catch(e) {
      toast?.(e.message || 'Не удалось сохранить место', 'error')
    }
    setCellSaving(false)
  }

  async function handleCreateCellInSection() {
    if (!selSection || creatingCell) return
    setCreatingCell(true)
    try {
      const r = await warehousesApi.addCell(selSection)
      const newCellId = r.cell?.id
      const fresh = await warehousesApi.cells(selWh)
      setSections(fresh.sections || [])
      if (newCellId) setSelCell(String(newCellId))
    } catch (e) {
      toast?.(e.message || 'Не удалось создать ячейку', 'error')
    } finally {
      setCreatingCell(false)
    }
  }

  async function handleCloseDebt(action) {
    if (!debt?.id) return
    setClosingDebt(true)
    try {
      if (action === 'writeoff') {
        if (debt._legacy) {
          const rawId = String(debt.id).replace(/^w_/, '')
          await writeoffsApi.convertToWriteoff(rawId)
        } else {
          await debtsApi.writeoff(debt.id)
        }
        toast?.('Единица списана', 'success')
      } else {
        await debtsApi.close(debt.id)
        toast?.('Долг закрыт — единица на складе', 'success')
      }
      onCloseDebt?.()
      onClose()
    } catch (e) {
      toast?.(e.message || 'Ошибка', 'error')
    }
    setClosingDebt(false)
    setShowCloseDebtChoice(false)
  }

  async function handleWriteoff() {
    if (!writeoffReason.trim()) return
    try {
      const isRequest = user?.role === 'warehouse_deputy' || user?.role === 'warehouse_staff'
      const action = isRequest
        ? unitsApi.requestWriteoff(currentId, writeoffReason)
        : unitsApi.writeoff(currentId, writeoffReason)
      await action
      toast?.(isRequest ? 'Запрос на списание отправлен' : 'Единица списана', 'success')
      onChanged?.()
      onClose()
    } catch (e) {
      toast?.(e.message || 'Ошибка при списании', 'error')
    }
  }

  if (loading) return (
    <>
      <style>{css}</style>
      <Overlay onClose={onClose}>
        <div className="uc-modal" onClick={e => e.stopPropagation()}>
          <div style={{ padding: 48, textAlign: 'center', color: 'var(--muted)', fontSize: 14 }}>Загрузка…</div>
        </div>
      </Overlay>
    </>
  )

  if (!unit) return (
    <>
      <style>{css}</style>
      <Overlay onClose={onClose}>
        <div className="uc-modal" onClick={e => e.stopPropagation()}>
          <div style={{ padding: 48, textAlign: 'center', color: 'var(--red)', fontSize: 14 }}>Единица не найдена</div>
        </div>
      </Overlay>
    </>
  )

  const photos = unit.photos || []
  const photo = photos[activePhoto]
  const isVideo = photo?.url && /\.(mp4|webm|mov)$/i.test(photo.url)
  const cellLabel = unit.cell_custom || unit.cell_code || unit.cell_name || null
  const pavLabel = unit.pavilion_id ? (unit.pavilion_name || 'Павильон') : null
  const statusDot = STATUS_DOT[unit.status] || 'var(--muted)'

  return (
    <>
      <style>{css}</style>
      <Overlay onClose={onClose}>
        <div className="uc-modal" onClick={e => e.stopPropagation()}>

          {/* Header */}
          <div className="uc-head">
            <div className="uc-head-main">
              <div className="uc-title">{unit.name}</div>
              <div className="uc-sub">
                <span>{categoryLabel(unit.category)}</span>
                <span className="uc-sep">·</span>
                <span className="uc-status"><span className="uc-dot" style={{ background: statusDot }} />{STATUS_LABEL[unit.status]}</span>
                {debt && <><span className="uc-sep">·</span><span className="uc-badge uc-badge-red">Долг</span></>}
                {writeoff && <><span className="uc-sep">·</span><span className="uc-badge uc-badge-red">Списано</span></>}
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
                {/* Фото слева (desktop) + горизонтальная галерея (mobile) */}
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

                  {/* Мобильная галерея: горизонтальный swipe со snap (как Farfetch/Я.Маркет) */}
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
                    {unit.warehouse_name && <Row label="Склад" value={unit.warehouse_name} />}
                    {cellLabel       && <Row label="Полка" value={cellLabel} />}
                    {pavLabel        && <Row label="Павильон" value={pavLabel} />}
                    {unit.qty        && <Row label="Количество" value={`${unit.qty} шт.`} />}
                    {unit.dimensions && <Row label="Размеры" value={unit.dimensions} />}
                    {unit.condition  && <Row label="Состояние" value={unit.condition} />}
                    {unit.source     && <Row label="Источник" value={unit.source} />}
                    {unit.valuation  && <Row label="Стоимость" value={`${Number(unit.valuation).toLocaleString('ru-RU')} ₽`} />}
                    <Row label="Фонд" value={FUND_LABEL[unitFund(unit)]} />
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

                  {/* Контекст долга/списания — тонкий баннер */}
                  {debt && (
                    <DebtBanner debt={debt} user={user} onClose={() => setShowCloseDebtChoice(true)} />
                  )}
                  {writeoff && <WriteoffBanner writeoff={writeoff} />}
                </div>
              </div>
            )}

            {tab === 'history' && (
              <div className="uc-history">
                {!historyLoaded ? (
                  <div className="uc-empty">Загрузка…</div>
                ) : historyItems.length === 0 ? (
                  <div className="uc-empty">История пуста</div>
                ) : (
                  historyItems.map(h => (
                    <HistoryRow key={h.id} entry={h} onPhotoClick={(urls, idx) => setLightbox({ urls, idx })} />
                  ))
                )}
              </div>
            )}

            {tab === 'similar' && (
              similar.length === 0 ? (
                <div className="uc-empty">Похожих единиц нет</div>
              ) : (
                <div className="uc-similar-grid">
                  {similar.map(s => (
                    <button key={s.id} className="uc-similar-card" onClick={() => { setCurrentId(s.id); setTab('info') }}>
                      <div className="uc-similar-photo">
                        {s.photo_url
                          ? <img src={s.photo_url} alt="" />
                          : <Package size={22} color="var(--gold-500)" strokeWidth={1.4} />}
                      </div>
                      <div className="uc-similar-name">{s.name}</div>
                    </button>
                  ))}
                </div>
              )
            )}
          </div>

          {/* Панели перемещения / списания — показываются поверх нижней части */}
          {showCell && (
            <CellPanel
              unit={unit}
              sections={sections}
              warehouses={warehouses}
              selWh={selWh} setSelWh={setSelWh}
              selHall={selHall} setSelHall={setSelHall}
              selSection={selSection} setSelSection={setSelSection}
              selCell={selCell} setSelCell={setSelCell}
              cellSaving={cellSaving}
              creatingCell={creatingCell}
              onSave={handleAssignCell}
              onCreateCell={handleCreateCellInSection}
              onClose={() => setShowCell(false)}
              onCreateSection={() => { onClose?.(); navigate(`/cells/${selWh || ''}`) }}
              currentId={currentId}
            />
          )}
          {showWriteoff && (
            <div className="uc-panel">
              <div className="uc-panel-head">Причина списания</div>
              <textarea className="uc-textarea"
                value={writeoffReason}
                onChange={e => setWriteoffReason(e.target.value)}
                placeholder="Сломано, утеряно, износ…" />
              <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
                <Button variant="secondary" fullWidth onClick={() => setShowWriteoff(false)}>Отмена</Button>
                <Button variant="danger" fullWidth onClick={handleWriteoff} disabled={!writeoffReason.trim()}>
                  Списать
                </Button>
              </div>
            </div>
          )}

          {/* Sticky actions */}
          {isWarehouse && tab === 'info' && !showCell && !showWriteoff && (
            <div className="uc-actions">
              <Button variant="primary" onClick={() => setShowCell(true)}>
                <MapPin size={14} /> {(unit.cell_id || unit.pavilion_id) ? 'Переместить' : 'Назначить место'}
              </Button>
              {(isDirector || isWarehouse) && (
                <div className="uc-more-wrap">
                  <Button variant="secondary" iconOnly onClick={() => setMoreOpen(v => !v)}>
                    <MoreVertical size={16} />
                  </Button>
                  {moreOpen && (
                    <div className="uc-more-pop" onMouseLeave={() => setMoreOpen(false)}>
                      {isDirector && (
                        <button className="uc-more-item" onClick={() => { setMoreOpen(false); setShowWriteoff(true) }}>
                          <Archive size={14} /> Списать
                        </button>
                      )}
                      {DIRECTOR_ROLES.includes(user?.role) && (
                        <button className="uc-more-item uc-more-danger" onClick={() => { setMoreOpen(false); setShowDeleteConfirm(true) }}>
                          <Trash2 size={14} /> Удалить
                        </button>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Модалка подтверждения удаления */}
          <ConfirmModal
            open={showDeleteConfirm}
            title="Удалить единицу"
            message={`Вы уверены, что хотите удалить «${unit?.name || 'позицию'}»? Это действие необратимо.`}
            confirmLabel="Удалить"
            onCancel={() => setShowDeleteConfirm(false)}
            onConfirm={async () => {
              try {
                await unitsApi.delete(currentId)
                toast?.('Единица удалена', 'success')
                onChanged?.()
                onClose()
              } catch (e) { toast?.(e.message || 'Ошибка', 'error') }
            }}
          />

          {/* Закрытие долга */}
          {showCloseDebtChoice && (
            <Overlay onClose={() => !closingDebt && setShowCloseDebtChoice(false)} zIndex={700}>
              <div className="uc-debt-modal" onClick={e => e.stopPropagation()}>
                <div className="cm-title" style={{ marginBottom: 6 }}>Закрыть долг</div>
                <div className="cm-msg">Что сделать с единицей «{unit?.name}»?</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 12 }}>
                  <button onClick={() => handleCloseDebt('return')} disabled={closingDebt} className="uc-debt-choice uc-debt-choice-green">
                    <Package size={18} />
                    <div>
                      <div className="uc-debt-choice-title">Вернуть на склад</div>
                      <div className="uc-debt-choice-sub">Предмет возвращается в доступный фонд</div>
                    </div>
                  </button>
                  <button onClick={() => handleCloseDebt('writeoff')} disabled={closingDebt} className="uc-debt-choice uc-debt-choice-red">
                    <Archive size={18} />
                    <div>
                      <div className="uc-debt-choice-title">Списать</div>
                      <div className="uc-debt-choice-sub">Помечается списанной безвозвратно</div>
                    </div>
                  </button>
                </div>
                <Button variant="secondary" fullWidth disabled={closingDebt} onClick={() => setShowCloseDebtChoice(false)}>
                  Отмена
                </Button>
              </div>
            </Overlay>
          )}

        </div>
      </Overlay>

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

// ── Вспомогательные компоненты ──

function Overlay({ children, onClose, zIndex = 500 }) {
  return (
    <div
      className="uc-overlay"
      style={{ zIndex }}
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
    >
      {children}
    </div>
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

// Заголовок действия с проектом/контрагентом, если это выдача/возврат.
// Для «Добавлено» показываем имя пользователя. Для движений — проект.
function HistoryRow({ entry, onPhotoClick }) {
  const { action, project_name, user_name, notes, photos, created_at } = entry
  const isMovement = /Выдано|Возврат|Долг|Списано/.test(action || '')
  const subject = isMovement ? (project_name || '—') : (user_name || '—')
  const photoList = Array.isArray(photos) ? photos : []
  const photoUrls = photoList.map(p => p.url)

  return (
    <div className="uc-hist-row">
      <div className="uc-hist-dot" />
      <div className="uc-hist-text">
        <div className="uc-hist-action">{action}</div>
        <div className="uc-hist-meta">
          {subject}{notes ? ` · ${notes}` : ''}
        </div>
        {photoList.length > 0 && (
          <div className="uc-hist-photos">
            {photoList.map((p, i) => (
              <button key={p.id || i} className="uc-hist-thumb"
                onClick={() => onPhotoClick(photoUrls, i)}
                title="Увеличить">
                {/\.(mp4|webm|mov)$/i.test(p.url)
                  ? <video src={p.url} muted preload="metadata" />
                  : <img src={p.url} alt="" />}
              </button>
            ))}
          </div>
        )}
      </div>
      <div className="uc-hist-time">
        {new Date(created_at).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
      </div>
    </div>
  )
}

function DebtBanner({ debt, user, onClose }) {
  const created = new Date(debt.created_at)
  const deadline = new Date(created.getTime() + 3 * 86400000)
  const canClose = ['warehouse_director', 'warehouse_deputy', 'producer'].includes(user?.role) && debt.status === 'open'
  return (
    <div className="uc-banner uc-banner-red">
      <div className="uc-banner-title">Долг</div>
      <div className="uc-banner-row"><span>Причина</span><span>{debt.reason || '—'}</span></div>
      <div className="uc-banner-row"><span>Должник</span><span>{debt.user_name || '—'}</span></div>
      <div className="uc-banner-row"><span>Вернуть до</span><span>{deadline.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })}</span></div>
      {canClose && (
        <Button variant="danger" fullWidth size="sm" style={{ marginTop: 8 }} onClick={onClose}>
          Закрыть долг
        </Button>
      )}
    </div>
  )
}

function WriteoffBanner({ writeoff }) {
  return (
    <div className="uc-banner uc-banner-dim">
      <div className="uc-banner-title">Списано</div>
      <div className="uc-banner-row"><span>Причина</span><span>{writeoff.reason || '—'}</span></div>
      {writeoff.created_by_name && <div className="uc-banner-row"><span>Кем</span><span>{writeoff.created_by_name}</span></div>}
      <div className="uc-banner-row"><span>Дата</span><span>{new Date(writeoff.created_at).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })}</span></div>
    </div>
  )
}

function CellPanel({
  unit, sections, warehouses,
  selWh, setSelWh,
  selHall, setSelHall,
  selSection, setSelSection,
  selCell, setSelCell,
  cellSaving, creatingCell,
  onSave, onCreateCell, onClose, onCreateSection, currentId,
}) {
  // Иерархия: зал (type='hall', parent_section_id=null) → дочерние секции
  // (shelf/hanger/place с parent_section_id). Также legacy-секции без зала
  // (shelf/hanger/place, parent_section_id=null) показываются в пункте «Без зала».
  const halls = sections.filter(s => s.type === 'hall' && !s.parent_section_id)
  const legacySections = sections.filter(s => s.type !== 'hall' && !s.parent_section_id)
  const hasLegacy = legacySections.length > 0

  // Секции для текущего выбора зала.
  const sectionsInHall = selHall
    ? sections.filter(s => String(s.parent_section_id) === String(selHall))
    : legacySections

  const currentSection = sections.find(s => String(s.id) === String(selSection))
  const cellsInSection = (currentSection?.cells || [])
  // Валидация категории для вешалок (из бэка): для hanger допустимы только
  // costumes/shoes/accessories/jewelry. Для shelf/place — без ограничений.
  const hangerAllowed = ['costumes', 'shoes', 'accessories', 'jewelry']
  const sectionBlocked = currentSection?.type === 'hanger'
    && !hangerAllowed.includes(unit.category)

  return (
    <div className="uc-panel">
      <div className="uc-panel-head">
        {unit.cell_id ? 'Переместить' : 'Назначить место'}
      </div>

      {/* Склад */}
      <select value={selWh} onChange={e => setSelWh(e.target.value)} className="uc-select">
        <option value="">— Склад —</option>
        {warehouses.map(w => (
          <option key={w.id} value={w.id}>
            {w.address ? `${w.name} · ${w.address}` : w.name}
          </option>
        ))}
      </select>

      {/* Зал (если есть залы или legacy-секции) */}
      {selWh && (halls.length > 0 || hasLegacy) && (
        <select value={selHall} onChange={e => setSelHall(e.target.value)} className="uc-select" style={{ marginTop: 6 }}>
          <option value="">{hasLegacy ? 'Без зала' : '— Зал —'}</option>
          {halls.map(h => <option key={h.id} value={h.id}>{h.name}</option>)}
        </select>
      )}

      {/* Секция */}
      {selWh && sectionsInHall.length > 0 && (
        <select value={selSection} onChange={e => setSelSection(e.target.value)} className="uc-select" style={{ marginTop: 6 }}>
          <option value="">— Секция —</option>
          {sectionsInHall.map(sec => (
            <option key={sec.id} value={sec.id}>
              {(SECTION_TYPE_LABEL[sec.type] || sec.type)} · {sec.name}
            </option>
          ))}
        </select>
      )}

      {/* Ячейка */}
      {selSection && !sectionBlocked && (
        <>
          <select value={selCell} onChange={e => setSelCell(e.target.value)} className="uc-select" style={{ marginTop: 6 }}>
            <option value="">— Место —</option>
            {cellsInSection.map(c => {
              const isBusy = c.unit_id && c.unit_status === 'on_stock' && String(c.unit_id) !== String(currentId)
              return (
                <option key={c.id} value={c.id} disabled={isBusy}>
                  {c.custom_name || c.code}{isBusy ? ' · занято' : ''}
                </option>
              )
            })}
          </select>
          <button
            type="button"
            onClick={onCreateCell}
            disabled={creatingCell}
            className="uc-panel-create-cell"
          >
            {creatingCell ? 'Создаём…' : '+ Создать новое место'}
          </button>
        </>
      )}

      {/* Подсказки */}
      {selWh && halls.length === 0 && !hasLegacy && (
        <div className="uc-hint">На складе ещё нет залов и секций.</div>
      )}
      {selWh && sectionsInHall.length === 0 && (halls.length > 0 || hasLegacy) && (
        <div className="uc-hint">
          {selHall ? 'В этом зале нет секций.' : 'Выберите зал для продолжения.'}
        </div>
      )}
      {sectionBlocked && (
        <div className="uc-hint">
          Вешалка допускает только костюмы / обувь / аксессуары / украшения.
        </div>
      )}

      <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
        <Button variant="secondary" fullWidth onClick={onClose}>Отмена</Button>
        {selWh && halls.length === 0 && !hasLegacy ? (
          <Button fullWidth onClick={onCreateSection}>Перейти к складу</Button>
        ) : (
          <Button fullWidth onClick={onSave} disabled={cellSaving || !selCell || sectionBlocked}>
            {cellSaving ? 'Сохранение…' : 'Сохранить'}
          </Button>
        )}
      </div>
    </div>
  )
}

// ── Стили ──
const css = `
.uc-overlay {
  position: fixed; inset: 0;
  background: rgba(10,10,10,0.55);
  backdrop-filter: blur(3px);
  display: flex; align-items: center; justify-content: center;
  padding: 20px;
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
}

/* Header */
.uc-head {
  display: flex; align-items: flex-start; justify-content: space-between;
  padding: 18px 22px 14px;
  gap: 16px;
  border-bottom: 1px solid var(--border);
}
@media (max-width: 768px) {
  /* Sticky header + tabs — заголовок не уезжает при скролле. */
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
  .uc-panel { margin: 0 14px 12px; padding: 12px 14px; }
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
.uc-badge {
  font-size: 10px; font-weight: 600;
  padding: 1px 6px; border-radius: 4px;
  letter-spacing: 0.03em; text-transform: uppercase;
}
.uc-badge-red { background: var(--red-dim); color: var(--red); }

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

/* Tabs */
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

/* Body */
.uc-body {
  flex: 1;
  overflow-y: auto;
  padding: 20px 22px;
}

/* Grid (photo + info) */
.uc-grid {
  display: grid;
  grid-template-columns: 360px 1fr;
  gap: 24px;
  align-items: start;
}
@media (max-width: 820px) {
  .uc-grid { grid-template-columns: 1fr; gap: 14px; }
}

/* Photo */
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
@media (max-width: 768px) {
  /* На мобилке фото во всю ширину-в-края, без рамки, аспект 3:4 —
     занимает меньше, чем квадрат, и на карточке видно инфу сразу.
     Галерея — horizontal swipe со scroll-snap, точки вместо thumbs. */
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
    position: relative;
  }
  .uc-gallery-slide img,
  .uc-gallery-slide video {
    width: 100%; height: 100%; object-fit: cover;
    display: block;
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
}
@media (min-width: 769px) {
  .uc-gallery-mobile, .uc-dots-mobile { display: none; }
}
.uc-photo-main img,
.uc-photo-main video {
  width: 100%; height: 100%; object-fit: contain;
  display: block;
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
  overflow-x: auto;
  scrollbar-width: none;
}
.uc-thumbs::-webkit-scrollbar { display: none; }
.uc-thumb {
  width: 52px; height: 52px; border-radius: 8px;
  overflow: hidden;
  border: 2px solid var(--border);
  background: var(--paper);
  cursor: pointer;
  flex-shrink: 0;
  padding: 0;
  display: flex; align-items: center; justify-content: center;
  transition: border-color 0.12s;
}
.uc-thumb:hover { border-color: var(--border-strong); }
.uc-thumb.active { border-color: var(--gold-500); }
.uc-thumb img, .uc-thumb video { width: 100%; height: 100%; object-fit: cover; }

/* Info */
.uc-info-col { min-width: 0; }
.uc-rows {
  display: grid;
  grid-template-columns: 1fr 1fr;
  column-gap: 20px;
  row-gap: 0;
}
@media (max-width: 560px) {
  /* Сохраняем 2 колонки для плотности — как в маркетплейсах. */
  .uc-rows { grid-template-columns: 1fr 1fr; column-gap: 12px; }
}
.uc-row {
  display: flex; align-items: center; justify-content: space-between;
  padding: 9px 0;
  gap: 10px;
  border-bottom: 1px solid var(--border);
}
@media (max-width: 768px) {
  .uc-row { padding: 7px 0; gap: 6px; }
  .uc-row-label { font-size: 11.5px; }
  .uc-row-value { font-size: 12.5px; max-width: 55%; }
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
.uc-desc-label { font-size: 11px; font-weight: 600; color: var(--muted); letter-spacing: 0.08em; text-transform: uppercase; margin-bottom: 6px; }
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
@media (max-width: 768px) {
  .uc-desc { margin-top: 12px; }
}

/* Banners */
.uc-banner { margin-top: 14px; padding: 12px 14px; border-radius: 10px; }
.uc-banner-red { background: var(--red-dim); border: 1px solid rgba(139,58,31,0.25); }
.uc-banner-dim { background: var(--bg-secondary); border: 1px solid var(--border); }
.uc-banner-title { font-size: 11px; font-weight: 600; letter-spacing: 0.08em; text-transform: uppercase; color: var(--red); margin-bottom: 6px; }
.uc-banner-dim .uc-banner-title { color: var(--muted); }
.uc-banner-row {
  display: flex; justify-content: space-between; gap: 10px;
  padding: 5px 0;
  font-size: 12.5px;
}
.uc-banner-row span:first-child { color: var(--muted); }
.uc-banner-row span:last-child { font-weight: 500; color: var(--text); }

/* History */
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

/* Similar */
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

/* Empty */
.uc-empty {
  padding: 48px 16px; text-align: center;
  font-size: 13px; color: var(--muted);
}

/* Panel (move/writeoff) */
.uc-panel {
  margin: 0 22px 16px;
  background: var(--paper);
  border: 1px solid var(--border);
  border-radius: 12px;
  padding: 14px 16px;
}
.uc-panel-head {
  font-size: 11px; font-weight: 600;
  letter-spacing: 0.08em; text-transform: uppercase;
  color: var(--muted);
  margin-bottom: 10px;
}
.uc-panel-tabs { display: flex; gap: 6px; margin-bottom: 10px; }
.uc-panel-tab {
  flex: 1;
  padding: 7px 10px;
  border-radius: 8px;
  border: 1px solid var(--border);
  background: var(--card);
  color: var(--text);
  font-size: 12.5px; font-weight: 500;
  cursor: pointer;
  display: inline-flex; align-items: center; justify-content: center; gap: 5px;
  font-family: inherit;
}
.uc-panel-tab.active {
  border-color: var(--gold-500);
  background: var(--gold-100);
  color: var(--gold-600);
  font-weight: 600;
}

.uc-select, .uc-textarea {
  width: 100%;
  padding: 9px 11px;
  border: 1px solid var(--border-strong);
  border-radius: 10px;
  font-size: 13px;
  background: var(--card);
  font-family: inherit;
  color: var(--text);
  outline: none;
  box-sizing: border-box;
}
.uc-select:focus, .uc-textarea:focus { border-color: var(--gold-500); }
.uc-textarea { min-height: 70px; resize: vertical; }

.uc-hint {
  font-size: 12px;
  color: var(--muted);
  padding: 8px 10px;
  margin-top: 8px;
  background: var(--gold-100);
  border-radius: 6px;
}

.uc-panel-create-cell {
  width: 100%;
  margin-top: 6px;
  padding: 8px 11px;
  border: 1px dashed var(--border-strong);
  border-radius: 10px;
  background: transparent;
  color: var(--gold-600);
  font-size: 12.5px; font-weight: 500;
  font-family: inherit;
  cursor: pointer;
  transition: background 0.12s, border-color 0.12s;
}
.uc-panel-create-cell:hover:not(:disabled) {
  background: var(--gold-100);
  border-color: var(--gold-500);
}
.uc-panel-create-cell:disabled { opacity: 0.6; cursor: wait; }

/* Bottom actions */
.uc-actions {
  flex-shrink: 0;
  display: flex; align-items: center; gap: 8px;
  padding: 14px 22px;
  border-top: 1px solid var(--border);
  background: var(--card);
  position: relative;
}
.uc-more-wrap { position: relative; }
.uc-more-pop {
  position: absolute; bottom: calc(100% + 6px); right: 0;
  min-width: 180px;
  background: var(--card);
  border: 1px solid var(--border);
  border-radius: 10px;
  padding: 4px;
  box-shadow: 0 8px 24px rgba(0,0,0,0.12);
  z-index: 20;
}
.uc-more-item {
  display: flex; align-items: center; gap: 8px;
  width: 100%;
  padding: 8px 10px;
  background: transparent; border: none;
  border-radius: 6px;
  font-size: 13px; color: var(--text);
  cursor: pointer;
  font-family: inherit;
  text-align: left;
}
.uc-more-item:hover { background: var(--bg-secondary); }
.uc-more-danger { color: var(--red); }
.uc-more-danger:hover { background: var(--red-dim); }

/* Debt choice modal */
.uc-debt-modal {
  background: var(--card);
  border-radius: 14px;
  padding: 22px 24px 20px;
  max-width: 420px; width: 100%;
  box-shadow: 0 16px 48px rgba(0,0,0,0.25);
}
.uc-debt-choice {
  display: flex; align-items: center; gap: 12px;
  padding: 12px 14px;
  border-radius: 10px;
  background: var(--card);
  cursor: pointer;
  font-family: inherit;
  text-align: left;
  transition: background 0.12s, border-color 0.12s;
}
.uc-debt-choice-green {
  border: 1px solid rgba(92,107,63,0.4);
  background: var(--green-dim);
  color: var(--green);
}
.uc-debt-choice-green:hover { background: rgba(92,107,63,0.15); }
.uc-debt-choice-red {
  border: 1px solid rgba(139,58,31,0.4);
  background: var(--red-dim);
  color: var(--red);
}
.uc-debt-choice-red:hover { background: rgba(139,58,31,0.15); }
.uc-debt-choice-title { font-size: 14px; font-weight: 600; }
.uc-debt-choice-sub { font-size: 12px; color: var(--muted); margin-top: 2px; font-weight: 400; }
`
