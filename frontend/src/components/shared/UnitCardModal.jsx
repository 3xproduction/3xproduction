import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  X, ZoomIn, ChevronLeft, ChevronRight, Package, Edit2,
  MapPin, Trash2, MoreVertical, History, Archive, Wallet,
  Plus, ImagePlus, Sparkles, Loader2,
  Hash, Clock, Bookmark, Truck, RussianRuble,
} from 'lucide-react'
import Lightbox from './Lightbox'
import Button from './Button'
import TruncTip from './TruncTip'
import UnitMissingDataBadge from './UnitMissingDataBadge'
import { getUnitMissingFields } from '../../utils/unitMissingData'
import { units as unitsApi, warehouses as warehousesApi, debts as debtsApi, writeoffs as writeoffsApi } from '../../services/api'
import { useAuth } from '../../hooks/useAuth'
import { useBodyLock } from '../../hooks/useBodyLock'
import { STATUS_LABEL } from '../../constants/statuses'
import { categoryLabel } from '../../constants/categories'
import { CLOTHING_SIZES_INT, CLOTHING_SIZES_RU, SHOE_SIZES, IS_SIZED_CAT, IS_SHOES_CAT, guessSizeMode } from '../../constants/clothingSizes'
import ConfirmModal from './ConfirmModal'
import { useToast } from './Toast'
import { unitFund, FUND_LABEL } from '../../constants/funds'
import { SECTION_TYPE_LABEL } from '../../constants/storageRules'
import { removeBgWhite, preloadBgModel, describeBgError, describeBgSkipped } from '../../utils/removeBg'

const WAREHOUSE_ROLES = ['warehouse_director', 'warehouse_deputy', 'warehouse_staff']
const DIRECTOR_ROLES  = ['warehouse_director', 'warehouse_deputy']

// Однопроходное сжатие фото при добавлении в существующую карточку.
// Параметры совпадают с `compressImage` в AddUnitModal (1568px, JPEG q85),
// чтобы серверный Sharp-pipeline отрабатывал одинаково.
function compressImageForCard(file, maxSize = 1568, quality = 0.85) {
  return new Promise((resolve) => {
    const img = new Image()
    img.onload = () => {
      const canvas = document.createElement('canvas')
      let { width, height } = img
      if (width > maxSize || height > maxSize) {
        if (width > height) { height = Math.round(height * maxSize / width); width = maxSize }
        else { width = Math.round(width * maxSize / height); height = maxSize }
      }
      canvas.width = width
      canvas.height = height
      canvas.getContext('2d').drawImage(img, 0, 0, width, height)
      canvas.toBlob(blob => resolve(new File([blob], file.name, { type: 'image/jpeg' })), 'image/jpeg', quality)
    }
    img.src = URL.createObjectURL(file)
  })
}

// Цвет точки статуса под бренд
const STATUS_DOT = {
  on_stock:    'var(--green)',
  issued:      'var(--blue)',
  overdue:     'var(--red)',
  pending:     'var(--gold-500)',
  written_off: 'var(--muted)',
}

// Роли, которым видна закупочная информация (цена/магазин/чек) — фин-ответственные.
const PURCHASE_INFO_ROLES = new Set([
  'warehouse_director', 'warehouse_deputy', 'producer', 'project_director', 'director',
])
const ADMIN_STOCK_VIEW_ROLES = new Set([
  'warehouse_director', 'warehouse_deputy', 'warehouse_staff', 'project_director', 'set_admin',
])

function tokensOf(value) {
  return String(value || '').toLowerCase().match(/[a-zа-яё0-9]+/gi) || []
}

const SIMILAR_GROUPS = [
  ['оруж', 'пистолет', 'пулемет', 'пулемёт', 'автомат', 'винтов', 'руж', 'револьвер', 'карабин', 'глок', 'glock', 'ak', 'пневмат', 'глушител', 'обойм', 'ствол'],
  ['телефон', 'смартфон', 'iphone', 'айфон', 'android', 'samsung', 'xiaomi', 'мобильн'],
  ['бутыл', 'фляг', 'термос', 'стакан', 'кружк', 'посуда'],
  ['мыш', 'клавиат', 'монитор', 'компьютер', 'ноутбук', 'кабель', 'asus', 'usb'],
  ['стул', 'кресл', 'диван', 'стол', 'тумб', 'шкаф', 'мебел'],
]

function hasFragment(tokens, fragment) {
  return tokens.some(t => t.includes(fragment) || fragment.includes(t))
}

function matchingGroups(tokens) {
  return SIMILAR_GROUPS
    .map((group, idx) => group.some(fragment => hasFragment(tokens, fragment)) ? idx : -1)
    .filter(idx => idx >= 0)
}

function rankSimilarUnits(base, candidates) {
  const baseTokens = new Set(tokensOf(`${base?.name || ''} ${base?.description || ''}`).filter(t => t.length > 2))
  const baseTokenList = [...baseTokens]
  const baseGroups = matchingGroups(baseTokenList)
  return [...candidates]
    .map(item => {
      let score = 0
      const itemTokens = tokensOf(`${item.name || ''} ${item.description || ''}`).filter(t => t.length > 2)
      const itemGroups = matchingGroups(itemTokens)
      const sharesDomain = baseGroups.length > 0 && itemGroups.some(g => baseGroups.includes(g))
      for (const token of itemTokens) {
        if (baseTokens.has(token)) score += 10
        else if (baseTokenList.some(baseToken => token.includes(baseToken) || baseToken.includes(token))) score += 6
      }
      if (sharesDomain) score += 30
      if (item.period && base?.period && item.period === base.period) score += 6
      if (item.dimensions && base?.dimensions && item.dimensions === base.dimensions) score += 6
      if (item.status === base?.status) score += 3
      if (item.photo_url || item.photo_thumb_url) score += 1
      return { item, score, sharesDomain }
    })
    .filter(({ score, sharesDomain }) => score >= 10 || sharesDomain)
    .sort((a, b) => b.score - a.score || String(a.item.name || '').localeCompare(String(b.item.name || ''), 'ru'))
    .map(x => ({ ...x.item, _similar_score: x.score }))
}

export default function UnitCardModal({ unitId, onClose, onChanged, debt, writeoff, onCloseDebt, extraActions }) {
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

  // Панель списания
  const [showWriteoff, setShowWriteoff]     = useState(false)
  const [writeoffReason, setWriteoffReason] = useState('')
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)

  // Zoom-on-hover для главной фотографии (десктоп). При движении мыши над
  // фото масштабируем картинку в позиции курсора — как hover-лупа на
  // маркетплейсах (Wildberries/Lamoda). На клик по-прежнему открывается
  // Lightbox, на тач-устройствах работает pinch внутри Lightbox.
  const [zoom, setZoom] = useState(null) // { x, y } в %, либо null
  function handlePhotoMove(e) {
    const rect = e.currentTarget.getBoundingClientRect()
    const x = ((e.clientX - rect.left) / rect.width) * 100
    const y = ((e.clientY - rect.top) / rect.height) * 100
    setZoom({ x: Math.max(0, Math.min(100, x)), y: Math.max(0, Math.min(100, y)) })
  }
  function handlePhotoLeave() { setZoom(null) }

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
            const candidates = (r.units || []).filter(s => s.id !== currentId)
            setSimilar(rankSimilarUnits(d.unit, candidates).slice(0, 8))
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
  }, [showCell, unit?.warehouse_id])

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
  // Единый режим редактирования карточки (только директор/зам).
  // Один карандаш на 4 поля: Размеры, Источник, Стоимость, Описание.
  const [editAll, setEditAll] = useState(false)
  const [editForm, setEditForm] = useState({ dimensions: '', source: '', valuation: '', description: '', qty: '' })
  const [editAllSaving, setEditAllSaving] = useState(false)
  // В edit-mode: тип сетки размеров для одежды/обуви.
  // sizeKind: 'clothing' | 'shoe' | 'free'  (free — свободный input для не-одежды или нестандартного значения)
  // sizeRegion: 'ru' | 'int'                (только для clothing)
  const [sizeKind, setSizeKind]     = useState('clothing')
  const [sizeRegion, setSizeRegion] = useState('ru')
  // Управление фото: режим редактирования галереи (крестики на превью + слот «+»).
  const [photoEdit, setPhotoEdit] = useState(false)
  const [photoBusy, setPhotoBusy] = useState(false) // true пока идёт upload/delete
  const photoFileRef = useRef(null)

  // Опция «Сделать белый фон» при добавлении фото в существующую карточку.
  const [whiteBgCard, setWhiteBgCard] = useState(() => {
    try { return localStorage.getItem('whiteBgEnabled') === '1' } catch { return false }
  })
  const [bgProgress, setBgProgress] = useState(null)
  function toggleWhiteBgCard() {
    const next = !whiteBgCard
    setWhiteBgCard(next)
    try { localStorage.setItem('whiteBgEnabled', next ? '1' : '0') } catch { /* localStorage unavailable */ }
    if (next) preloadBgModel().catch(() => {})
  }
  const [mobileSlide, setMobileSlide] = useState(0)
  const galleryRef = useRef(null)
  useEffect(() => {
    if (tab === 'history' && !historyLoaded) {
      unitsApi.history(currentId)
        .then(d => setHistoryItems(d.history || []))
        .catch(() => {})
        .finally(() => setHistoryLoaded(true))
    }
  }, [tab, currentId, historyLoaded])

  function handleStartEditAll() {
    if (!unit) return
    setEditForm({
      dimensions: unit.dimensions || '',
      source: unit.source || '',
      valuation: unit.valuation != null ? String(unit.valuation) : '',
      description: unit.description || '',
      qty: unit.qty != null ? String(unit.qty) : '',
    })
    const guess = guessSizeMode(unit.dimensions, unit.category)
    setSizeKind(IS_SIZED_CAT(unit.category) ? guess.kind : 'free')
    setSizeRegion(guess.region)
    setEditAll(true)
  }

  function handleCancelEditAll() {
    setEditAll(false)
  }

  async function handleSaveAll() {
    if (editAllSaving) return
    const valStr = editForm.valuation.trim()
    if (valStr && Number.isNaN(Number(valStr))) {
      toast?.('Стоимость должна быть числом', 'error')
      return
    }
    const qtyStr = String(editForm.qty ?? '').trim()
    const qtyNum = qtyStr ? Number(qtyStr) : NaN
    if (!qtyStr || !Number.isFinite(qtyNum) || !Number.isInteger(qtyNum) || qtyNum < 1) {
      toast?.('Количество должно быть целым числом ≥ 1', 'error')
      return
    }
    setEditAllSaving(true)
    try {
      const payload = {
        name: unit.name, category: unit.category, serial: unit.serial,
        warehouse_id: unit.warehouse_id, cell_id: unit.cell_id, pavilion_id: unit.pavilion_id,
        qty: qtyNum, condition: unit.condition,
        materials: unit.materials, period: unit.period,
        dimensions: editForm.dimensions.trim() || null,
        source: editForm.source.trim() || null,
        valuation: valStr ? Number(valStr) : null,
        description: editForm.description.trim() || null,
      }
      await unitsApi.update(currentId, payload)
      const d = await unitsApi.get(currentId)
      setUnit(d.unit)
      setEditAll(false)
      toast?.('Сохранено', 'success')
      onChanged?.()
    } catch (e) {
      toast?.(e.message || 'Не удалось сохранить', 'error')
    } finally {
      setEditAllSaving(false)
    }
  }

  async function handleAddPhotos(fileList) {
    if (!fileList?.length || photoBusy) return
    setPhotoBusy(true)
    try {
      const files = Array.from(fileList)
      const compressed = await Promise.all(files.map(f =>
        f.type?.startsWith('video/') ? f : compressImageForCard(f)
      ))

      let processed = compressed
      if (whiteBgCard) {
        const onlyImgIdx = compressed.map((f, i) => f.type?.startsWith('video/') ? -1 : i).filter(i => i !== -1)
        const total = onlyImgIdx.length
        processed = [...compressed]
        let skipReason = null
        let firstErr = null
        for (let n = 0; n < onlyImgIdx.length; n++) {
          const i = onlyImgIdx[n]
          setBgProgress({ idx: n + 1, total })
          try {
            const out = await removeBgWhite(compressed[i])
            processed[i] = out
            if (out?._bgSkipped && !skipReason) skipReason = out._bgSkipped
          } catch (err) {
            console.error('Background removal failed:', err?.code, err?.message)
            if (!firstErr) firstErr = err
            processed[i] = compressed[i]
          }
        }
        setBgProgress(null)
        if (firstErr) toast?.(describeBgError(firstErr), 'error')
        else if (skipReason) toast?.(describeBgSkipped(skipReason), 'warning')
      }

      const fd = new FormData()
      for (const f of processed) fd.append('photos', f)
      fd.append('type', 'stock')
      await unitsApi.uploadPhoto(currentId, fd)
      const d = await unitsApi.get(currentId)
      setUnit(d.unit)
      // Перейти на только что добавленное фото
      const newIdx = (d.unit.photos || []).length - 1
      if (newIdx >= 0) setActivePhoto(newIdx)
      toast?.(processed.length > 1 ? 'Фото добавлены' : 'Фото добавлено', 'success')
      onChanged?.()
    } catch (e) {
      toast?.(e.message || 'Не удалось загрузить фото', 'error')
    } finally {
      setPhotoBusy(false)
      if (photoFileRef.current) photoFileRef.current.value = ''
    }
  }

  async function handleDeletePhoto(photoId) {
    if (photoBusy) return
    setPhotoBusy(true)
    // Optimistic remove — сразу убираем превью из галереи, не дожидаясь
    // повторного GET. Иначе при медленной сети или проблемах с кешем юзер
    // видит «пустой» thumbnail с битой картинкой пока запрос летит.
    setUnit(prev => prev ? { ...prev, photos: (prev.photos || []).filter(p => p.id !== photoId) } : prev)
    setActivePhoto(0)
    try {
      await unitsApi.deletePhoto(currentId, photoId)
      // Подтверждающий refetch — синхронизирует state с сервером (на случай
      // если фото удалилось/добавилось из другой вкладки).
      const d = await unitsApi.get(currentId)
      setUnit(d.unit)
      toast?.('Фото удалено', 'success')
      onChanged?.()
    } catch (e) {
      // Если бэк отказал — откатываем optimistic remove обратно.
      try {
        const d = await unitsApi.get(currentId)
        setUnit(d.unit)
      } catch { /* network down — лучше оставить как есть, refresh решит */ }
      toast?.(e.message || 'Не удалось удалить фото', 'error')
    } finally {
      setPhotoBusy(false)
    }
  }

  // Per-photo «обелить фон»: бэкенд скачивает оригинал, прогоняет через
  // rembg-sidecar (model=u2net) и заменяет url. Старый файл S3 не удаляется,
  // повторное нажатие переобработает заново. Не вызываем onChanged() —
  // родитель может сбросить photoEdit/activePhoto, и метка «управлять фото»
  // снимется. Фото в самой карточке мы и так перезагружаем через setUnit.
  const [regenPhotoId, setRegenPhotoId] = useState(null)
  async function handleRegenBg(photoId) {
    if (regenPhotoId) return
    setRegenPhotoId(photoId)
    try {
      const result = await unitsApi.regenPhotoBg(currentId, photoId)
      // Обновляем локально только URL у затронутой фотки, чтобы не дёргать
      // get(unit) и не задеть другие части состояния. Cache-buster на конец
      // URL — на случай если CDN/браузер закешировал старый файл по новому
      // ключу (бывает при повторном нажатии).
      const newUrl = result?.url ? result.url + '?t=' + Date.now() : null
      if (newUrl) {
        setUnit(u => u ? ({
          ...u,
          photos: (u.photos || []).map(ph => ph.id === photoId ? { ...ph, url: newUrl } : ph),
        }) : u)
      } else {
        // На всякий — fallback на полный refresh
        const d = await unitsApi.get(currentId)
        setUnit(d.unit)
      }
      toast?.('Фон обелён', 'success')
    } catch (e) {
      toast?.(e?.message || 'Не удалось обелить фон', 'error')
    } finally {
      setRegenPhotoId(null)
    }
  }

  async function handleAssignCell() {
    if (!selSection) return
    setCellSaving(true)
    try {
      // Если конкретное место не выбрано — авто-создаём ячейку в выбранной секции.
      let cellId = selCell
      if (!cellId) {
        const r = await warehousesApi.addCell(selSection)
        cellId = r.cell?.id
        if (!cellId) throw new Error('Не удалось создать место')
      }
      const u = unit
      const payload = {
        name: u.name, category: u.category, serial: u.serial,
        warehouse_id: selWh,
        cell_id: cellId,
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
  // Тип секции на русском: «Полка» / «Вешалка» / «Место».
  const SECTION_TYPE_RU = { shelf: 'Полка', hanger: 'Вешалка', place: 'Место' }
  const sectionTypeRu = unit.section_type ? SECTION_TYPE_RU[unit.section_type] || null : null
  // Локация — собранный путь «Зал · Полка/Вешалка/Место (имя секции) · Ячейка».
  // Имя зала из hall_name (родительский section type='hall'). Section name —
  // имя самой полки/вешалки, затем конкретная ячейка из unit.cell_*.
  const sectionLabel = unit.section_name
    ? `${sectionTypeRu ? sectionTypeRu + ' ' : ''}«${unit.section_name}»`
    : null
  const pavLabel = unit.pavilion_id ? (unit.pavilion_name || 'Павильон') : null
  const statusDot = STATUS_DOT[unit.status] || 'var(--muted)'
  const missingDataFields = getUnitMissingFields(unit, user?.role)

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
                  {isDirector && (
                    <div className="uc-photo-toolbar">
                      <button
                        type="button"
                        className={`uc-photo-manage${photoEdit ? ' active' : ''}`}
                        onClick={() => setPhotoEdit(v => !v)}
                        disabled={photoBusy}
                        title={photoEdit ? 'Готово' : 'Управлять фото'}
                      >
                        {photoEdit ? <>Готово</> : <><ImagePlus size={13} /> Управлять фото</>}
                      </button>
                      {photoEdit && (
                        <button
                          type="button"
                          className={`uc-photo-bg-toggle${whiteBgCard ? ' active' : ''}`}
                          onClick={toggleWhiteBgCard}
                          disabled={photoBusy}
                          title="При добавлении новых фото удалит фон вокруг предмета. Обработка на сервере, 1–3 сек на фото."
                        >
                          <Sparkles size={13} />
                          <span>Белый фон</span>
                          <span className={`uc-photo-bg-dot${whiteBgCard ? ' on' : ''}`} />
                        </button>
                      )}
                      {bgProgress && (
                        <span className="uc-photo-bg-progress">
                          {`Делаю фон ${bgProgress.idx}/${bgProgress.total}…`}
                        </span>
                      )}
                      <input
                        ref={photoFileRef}
                        type="file"
                        accept="image/*,video/*"
                        multiple
                        style={{ display: 'none' }}
                        onChange={(e) => handleAddPhotos(e.target.files)}
                      />
                    </div>
                  )}
                  <div
                    className={`uc-photo-main${zoom && !isVideo && photo?.url ? ' zooming' : ''}`}
                    onClick={() => photo?.url && !isVideo && !regenPhotoId && setLightbox(activePhoto)}
                    onMouseMove={photo?.url && !isVideo ? handlePhotoMove : undefined}
                    onMouseLeave={handlePhotoLeave}
                  >
                    {regenPhotoId === photo?.id && (
                      <div className="uc-bg-overlay">
                        <Loader2 size={36} className="uc-spin" color="#fff" />
                        <div className="uc-bg-overlay-text">Обеляю фон...</div>
                      </div>
                    )}
                    {photo?.url ? (
                      isVideo ? (
                        <video src={photo.url} controls preload="metadata" />
                      ) : (
                        <>
                          <img
                            src={photo.url}
                            alt=""
                            style={zoom ? {
                              transformOrigin: `${zoom.x}% ${zoom.y}%`,
                              transform: 'scale(2.5)',
                            } : undefined}
                          />
                          <button
                            type="button"
                            className="uc-zoom"
                            aria-label="Открыть фото"
                            onClick={(e) => { e.stopPropagation(); setLightbox(activePhoto) }}
                          >
                            <ZoomIn size={12} color="#fff" />
                          </button>
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
                  {(photos.length > 1 || photoEdit) && (
                    <div className="uc-thumbs">
                      {photos.map((p, i) => (
                        <div key={p.id || i} className={`uc-thumb-wrap${i === activePhoto ? ' active' : ''}`}>
                          <button onClick={() => setActivePhoto(i)}
                            className={`uc-thumb${i === activePhoto ? ' active' : ''}`}>
                            {p.url
                              ? /\.(mp4|webm|mov)$/i.test(p.url)
                                ? <video src={p.url} muted preload="metadata" onError={e => { e.currentTarget.style.display = 'none' }} />
                                : <img src={p.url} alt="" onError={e => { e.currentTarget.style.display = 'none' }} />
                              : <Package size={18} color="var(--subtle)" />}
                          </button>
                          {photoEdit && p.id && (
                            <>
                              <button
                                type="button"
                                className="uc-thumb-del"
                                aria-label="Удалить фото"
                                disabled={photoBusy || regenPhotoId === p.id}
                                onClick={(e) => { e.stopPropagation(); handleDeletePhoto(p.id) }}
                              >
                                <X size={11} />
                              </button>
                              {p.url && !/\.(mp4|webm|mov)$/i.test(p.url) && (
                                <button
                                  type="button"
                                  className={`uc-thumb-bg${regenPhotoId === p.id ? ' busy' : ''}`}
                                  aria-label="Обелить фон"
                                  title="Обелить фон у этого фото"
                                  disabled={photoBusy || !!regenPhotoId}
                                  onClick={(e) => { e.stopPropagation(); handleRegenBg(p.id) }}
                                >
                                  {regenPhotoId === p.id
                                    ? <Loader2 size={11} className="uc-spin" />
                                    : <Sparkles size={11} />}
                                </button>
                              )}
                            </>
                          )}
                        </div>
                      ))}
                      {photoEdit && (
                        <button
                          type="button"
                          className="uc-thumb uc-thumb-add"
                          disabled={photoBusy}
                          onClick={() => photoFileRef.current?.click()}
                          title="Добавить фото"
                        >
                          <Plus size={18} color="var(--gold-600)" />
                        </button>
                      )}
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
                    {(photos.length ? photos : [{}]).map((p, i) => {
                      const isVid = p.url && /\.(mp4|webm|mov)$/i.test(p.url)
                      return (
                        <div key={p.id || i} className="uc-gallery-slide"
                          onClick={() => p.url && !isVid && !regenPhotoId && setLightbox(i)}>
                          {regenPhotoId === p.id && (
                            <div className="uc-bg-overlay">
                              <Loader2 size={36} className="uc-spin" color="#fff" />
                              <div className="uc-bg-overlay-text">Обеляю фон...</div>
                            </div>
                          )}
                          {p.url
                            ? isVid
                              ? <video src={p.url} muted playsInline preload="metadata" controls />
                              : (
                                <>
                                  <img src={p.url} alt="" />
                                  <button
                                    type="button"
                                    className="uc-zoom uc-zoom-mobile"
                                    aria-label="Открыть фото"
                                    onClick={(e) => { e.stopPropagation(); setLightbox(i) }}
                                  >
                                    <ZoomIn size={14} color="#fff" />
                                  </button>
                                </>
                              )
                            : <Package size={48} color="var(--gold-500)" strokeWidth={1.2} />}
                          {photoEdit && p.id && (
                            <>
                              <button
                                type="button"
                                className="uc-slide-del"
                                aria-label="Удалить фото"
                                disabled={photoBusy || regenPhotoId === p.id}
                                onClick={(e) => { e.stopPropagation(); handleDeletePhoto(p.id) }}
                              >
                                <X size={14} />
                              </button>
                              {p.url && !/\.(mp4|webm|mov)$/i.test(p.url) && (
                                <button
                                  type="button"
                                  className={`uc-slide-bg${regenPhotoId === p.id ? ' busy' : ''}`}
                                  aria-label="Обелить фон"
                                  title="Обелить фон у этого фото"
                                  disabled={photoBusy || !!regenPhotoId}
                                  onClick={(e) => { e.stopPropagation(); handleRegenBg(p.id) }}
                                >
                                  {regenPhotoId === p.id
                                    ? <Loader2 size={14} className="uc-spin" />
                                    : <Sparkles size={14} />}
                                </button>
                              )}
                            </>
                          )}
                        </div>
                      )
                    })}
                    {photoEdit && (
                      <div
                        className="uc-gallery-slide uc-gallery-add"
                        onClick={() => !photoBusy && photoFileRef.current?.click()}
                      >
                        <Plus size={36} color="var(--gold-600)" strokeWidth={1.5} />
                        <span className="uc-gallery-add-label">Добавить фото</span>
                      </div>
                    )}
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
                  {/* Активный pending-запрос на заём этой единицы. Сам факт виден всем,
                      а детали backend отдаёт только запрашивающему проекту и складу. */}
                  {unit.pending_loan_request && (
                    <div style={{
                      display: 'flex', alignItems: 'center', gap: 8,
                      marginBottom: 12, padding: '10px 12px',
                      background: 'rgba(217, 119, 6, 0.08)',
                      border: '1px solid rgba(217, 119, 6, 0.4)',
                      borderRadius: 'var(--radius-btn)',
                      fontSize: 13, color: 'var(--text)',
                    }}>
                      <span style={{ fontSize: 16 }}>⏳</span>
                      <div style={{ minWidth: 0, flex: 1 }}>
                        <div style={{ fontWeight: 600 }}>
                          {unit.pending_loan_request.to_project_name
                            ? <>Запрошена проектом «{unit.pending_loan_request.to_project_name}»</>
                            : 'Запрошено'}
                        </div>
                        <div style={{ fontSize: 12, color: 'var(--muted)' }}>
                          {unit.pending_loan_request.requested_by_name
                            ? <>Ожидает ответа · просит {unit.pending_loan_request.requested_by_name}</>
                            : 'Ожидает ответа владельца'}
                          {unit.pending_loan_request.deadline && (
                            <> · до {new Date(unit.pending_loan_request.deadline).toLocaleDateString()}</>
                          )}
                        </div>
                      </div>
                    </div>
                  )}
                  {/* Доп.действия — заметная сверху, чтобы кнопка «Запросить» / «Запросить возврат»
                      не пряталась внизу за длинным контентом. */}
                  {extraActions && extraActions.length > 0 && (
                    <div style={{
                      display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap',
                      padding: 12, background: 'rgba(var(--accent-rgb, 249,115,22), 0.08)',
                      borderRadius: 'var(--radius-btn)', border: '1px solid var(--accent)',
                    }}>
                      {extraActions.map((a, i) => (
                        <Button key={i} variant={a.variant || 'primary'} onClick={a.onClick}
                          disabled={a.disabled} fullWidth={extraActions.length === 1}>
                          {a.icon} {a.label}
                        </Button>
                      ))}
                    </div>
                  )}
                  {missingDataFields.length > 0 && (
                    <div style={{ marginBottom: 12 }}>
                      <UnitMissingDataBadge unit={unit} role={user?.role} />
                    </div>
                  )}
                  {isDirector && !editAll && (
                    <div className="uc-info-toolbar">
                      <button type="button" className="uc-edit-toggle" onClick={handleStartEditAll} title="Редактировать">
                        <Edit2 size={13} /> Редактировать
                      </button>
                    </div>
                  )}
                  <div className="uc-rows">
                    {unit.warehouse_name && <Row label="Склад" value={unit.warehouse_name} />}
                    {unit.hall_name  && <Row label="Зал" value={unit.hall_name} />}
                    {sectionLabel    && <Row label={sectionTypeRu || 'Секция'} value={unit.section_name} />}
                    {pavLabel        && <Row label="Павильон" value={pavLabel} />}
                    {editAll ? (
                      <>
                        <FormRow label="Количество">
                          <input
                            className="uc-edit-input"
                            type="number"
                            min="1"
                            step="1"
                            value={editForm.qty}
                            placeholder="1"
                            disabled={editAllSaving}
                            onChange={e => setEditForm(f => ({ ...f, qty: e.target.value }))}
                          />
                        </FormRow>
                        {IS_SIZED_CAT(unit.category) ? (
                          <SizeEditRow
                            kind={sizeKind}
                            region={sizeRegion}
                            value={editForm.dimensions}
                            disabled={editAllSaving}
                            lockKind={IS_SHOES_CAT(unit.category)}
                            onKindChange={(k) => { setSizeKind(k); setEditForm(f => ({ ...f, dimensions: '' })) }}
                            onRegionChange={(r) => { setSizeRegion(r); setEditForm(f => ({ ...f, dimensions: '' })) }}
                            onValueChange={(v) => setEditForm(f => ({ ...f, dimensions: v }))}
                          />
                        ) : (
                          <FormRow label="Размеры">
                            <input
                              className="uc-edit-input"
                              value={editForm.dimensions}
                              placeholder="50×30×20 см"
                              disabled={editAllSaving}
                              onChange={e => setEditForm(f => ({ ...f, dimensions: e.target.value }))}
                            />
                          </FormRow>
                        )}
                        {unit.condition && <Row label="Состояние" value={unit.condition} />}
                        <FormRow label="Источник">
                          <select
                            className="uc-edit-input"
                            value={editForm.source}
                            disabled={editAllSaving}
                            onChange={e => setEditForm(f => ({ ...f, source: e.target.value }))}
                          >
                            <option value="">—</option>
                            <option value="покупка">Покупка</option>
                            <option value="дарение">Дарение</option>
                            <option value="аренда">Аренда</option>
                          </select>
                        </FormRow>
                        <FormRow label="Стоимость">
                          <input
                            className="uc-edit-input"
                            type="number"
                            value={editForm.valuation}
                            placeholder="0"
                            disabled={editAllSaving}
                            onChange={e => setEditForm(f => ({ ...f, valuation: e.target.value }))}
                          />
                        </FormRow>
                      </>
                    ) : (
                      <>
                        {unit.qty        && <Row label="Количество" value={`${unit.qty} шт.`} />}
                        {unit.dimensions && <Row label="Размер" value={unit.dimensions.split('/')[0].trim()} />}
                        {unit.condition  && <Row label="Состояние" value={unit.condition} />}
                      </>
                    )}
                  </div>

                  {/* Чип-ряд с быстрыми фактами: иконка → тултип на hover (desktop) /
                      tap (mobile). Освобождает узкую правую колонку от длинных
                      лейблов вроде «Временное понятие». */}
                  {!editAll && (
                    <FactChipsRow
                      facts={[
                        unit.serial    && { key: 'serial', icon: Hash,          label: 'Серийный',          value: unit.serial },
                        unit.period    && {
                          key: 'period',
                          icon: unit.is_admin_stock ? MapPin : Clock,
                          label: unit.is_admin_stock ? 'Адрес хранения' : 'Временное понятие',
                          value: unit.period,
                        },
                        { key: 'fund', icon: Bookmark, label: 'Фонд', value: FUND_LABEL[unitFund(unit)] },
                        unit.source    && { key: 'source', icon: Truck,         label: 'Источник',          value: unit.source[0].toUpperCase() + unit.source.slice(1) },
                        unit.valuation && { key: 'value',  icon: RussianRuble,  label: 'Стоимость',         value: `${Number(unit.valuation).toLocaleString('ru-RU')} ₽` },
                      ].filter(Boolean)}
                    />
                  )}

                  {/* Закупочная информация — только для фин-ответственных и только если предмет купленный. */}
                  {unit.purchased && (PURCHASE_INFO_ROLES.has(user?.role) || (unit.is_admin_stock && ADMIN_STOCK_VIEW_ROLES.has(user?.role))) && (
                    <div style={{
                      background: 'var(--bg)', borderRadius: 'var(--radius-btn)',
                      padding: '12px 14px', marginTop: 12, marginBottom: 12,
                      border: '1px solid var(--border)',
                    }}>
                      <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 8 }}>
                        🛒 Закупка
                      </div>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, fontSize: 13 }}>
                        {unit.purchase_price != null && (
                          <div>
                            <div style={{ fontSize: 11, color: 'var(--muted)' }}>Цена</div>
                            <div style={{ fontWeight: 600 }}>{Number(unit.purchase_price).toLocaleString('ru-RU')} ₽</div>
                          </div>
                        )}
                        {unit.purchase_date && (
                          <div>
                            <div style={{ fontSize: 11, color: 'var(--muted)' }}>Дата</div>
                            <div>{new Date(unit.purchase_date).toLocaleDateString('ru-RU')}</div>
                          </div>
                        )}
                        {unit.vendor && (
                          <div style={{ gridColumn: '1 / -1' }}>
                            <div style={{ fontSize: 11, color: 'var(--muted)' }}>Где куплено</div>
                            <div>{unit.vendor}</div>
                          </div>
                        )}
                      </div>
                      {unit.receipt_url && (
                        <div style={{ marginTop: 10, display: 'flex', alignItems: 'center', gap: 10 }}>
                          <button
                            type="button"
                            onClick={() => setLightbox({ urls: [unit.receipt_url], idx: 0 })}
                            style={{
                              width: 56, height: 56, borderRadius: 8, border: '1px solid var(--border)',
                              padding: 0, overflow: 'hidden', cursor: 'pointer', background: 'var(--white)',
                            }}>
                            <img src={unit.receipt_url} alt="Чек" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                          </button>
                          <a href={unit.receipt_url} target="_blank" rel="noreferrer"
                            style={{ fontSize: 12, color: 'var(--accent)', textDecoration: 'none' }}>
                            📄 Открыть оригинал чека
                          </a>
                        </div>
                      )}
                    </div>
                  )}

                  {(unit.description || editAll || isDirector) && (
                    <div className="uc-desc">
                      <div className="uc-desc-label">Описание</div>
                      {editAll ? (
                        <textarea
                          className="uc-desc-textarea"
                          value={editForm.description}
                          rows={4}
                          placeholder="Описание единицы"
                          disabled={editAllSaving}
                          onChange={e => setEditForm(f => ({ ...f, description: e.target.value }))}
                        />
                      ) : unit.description ? (
                        <>
                          <div className={`uc-desc-text${!descExpanded ? ' collapsed' : ''}`}>{unit.description}</div>
                          {unit.description.length > 140 && (
                            <button className="uc-desc-toggle" onClick={() => setDescExpanded(v => !v)}>
                              {descExpanded ? 'Свернуть' : 'Показать полностью'}
                            </button>
                          )}
                        </>
                      ) : (
                        <div className="uc-desc-empty">Описание не заполнено</div>
                      )}
                    </div>
                  )}

                  {editAll && (
                    <div className="uc-edit-actions">
                      <button type="button" className="uc-desc-btn-cancel"
                        onClick={handleCancelEditAll} disabled={editAllSaving}>Отмена</button>
                      <button type="button" className="uc-desc-btn-save"
                        onClick={handleSaveAll} disabled={editAllSaving}>
                        {editAllSaving ? 'Сохраняю…' : 'Сохранить'}
                      </button>
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
                      <div className="uc-similar-meta">
                        {[s.serial, s.period, s.status === 'on_stock' ? 'На складе' : s.status === 'issued' ? 'Выдано' : null]
                          .filter(Boolean).join(' · ')}
                      </div>
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
              cellSaving={cellSaving}
              onSave={handleAssignCell}
              onClose={() => setShowCell(false)}
              onCreateSection={() => { onClose?.(); navigate(`/cells/${selWh || ''}`) }}
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
      <TruncTip
        as="span"
        className="uc-row-value"
        fullText={typeof value === 'string' ? value : String(value ?? '')}
      >{value}</TruncTip>
    </div>
  )
}

// Чип-ряд с фактами: на десктопе тултип по hover, на мобиле — по tap.
// Tap на чипе открывает поповер; tap по другому чипу или по фону закрывает.
function FactChipsRow({ facts }) {
  const [openKey, setOpenKey] = useState(null)
  const wrapRef = useRef(null)

  // Закрытие по клику вне
  useEffect(() => {
    if (!openKey) return
    function handler(e) {
      if (!wrapRef.current?.contains(e.target)) setOpenKey(null)
    }
    document.addEventListener('mousedown', handler)
    document.addEventListener('touchstart', handler, { passive: true })
    return () => {
      document.removeEventListener('mousedown', handler)
      document.removeEventListener('touchstart', handler)
    }
  }, [openKey])

  if (!facts.length) return null
  return (
    <div className="uc-fact-chips" ref={wrapRef}>
      {facts.map(f => {
        const Icon = f.icon
        const open = openKey === f.key
        return (
          <button
            key={f.key}
            type="button"
            className={`uc-fact-chip${open ? ' open' : ''}`}
            onClick={() => setOpenKey(prev => (prev === f.key ? null : f.key))}
            aria-label={`${f.label}: ${f.value}`}
          >
            <Icon size={14} strokeWidth={1.8} />
            <span className="uc-fact-tip" role="tooltip">
              <span className="uc-fact-tip-label">{f.label}</span>
              <span className="uc-fact-tip-value">{f.value}</span>
            </span>
          </button>
        )
      })}
    </div>
  )
}

function FormRow({ label, children }) {
  return (
    <div className="uc-row uc-row-form">
      <span className="uc-row-label">{label}</span>
      <span className="uc-row-form-control">{children}</span>
    </div>
  )
}

// Редактор размера для одежды/костюмов/обуви: переключатель Одежда↔Обувь,
// под-переключатель RU/INT для одежды, чипы значений. Растягивается на обе
// колонки .uc-rows, чтобы чипы не зажимались в 60% ширины.
function SizeEditRow({ kind, region, value, disabled, lockKind, onKindChange, onRegionChange, onValueChange }) {
  const list = kind === 'shoe'
    ? SHOE_SIZES
    : (region === 'ru' ? CLOTHING_SIZES_RU : CLOTHING_SIZES_INT)
  return (
    <div className="uc-row uc-size-row">
      <div className="uc-size-head">
        <span className="uc-row-label">Размер</span>
        {!lockKind && (
          <div className="uc-size-tabs">
            <button type="button" disabled={disabled}
              className={`uc-size-tab${kind === 'clothing' ? ' active' : ''}`}
              onClick={() => onKindChange('clothing')}>Одежда</button>
            <button type="button" disabled={disabled}
              className={`uc-size-tab${kind === 'shoe' ? ' active' : ''}`}
              onClick={() => onKindChange('shoe')}>Обувь</button>
          </div>
        )}
      </div>
      {kind === 'clothing' && (
        <div className="uc-size-region">
          <button type="button" disabled={disabled}
            className={`uc-size-region-btn${region === 'ru' ? ' active' : ''}`}
            onClick={() => onRegionChange('ru')}>RU</button>
          <button type="button" disabled={disabled}
            className={`uc-size-region-btn${region === 'int' ? ' active' : ''}`}
            onClick={() => onRegionChange('int')}>INT</button>
        </div>
      )}
      <div className="uc-size-chips">
        {list.map(s => (
          <button key={s} type="button" disabled={disabled}
            className={`uc-size-chip${value === s ? ' active' : ''}`}
            onClick={() => onValueChange(s)}>{s}</button>
        ))}
      </div>
    </div>
  )
}

// Заголовок действия с проектом/контрагентом, если это выдача/возврат.
// Для «Добавлено» показываем имя пользователя. Для движений — проект.
function HistoryRow({ entry, onPhotoClick }) {
  const { action, project_name, receiver_name, user_name, notes, photos, created_at } = entry
  const isMovement = /Выдано|Возврат|Долг|Списано|Перемещено|Передано|Запрос возврата/.test(action || '')
  const subject = isMovement
    ? [project_name, receiver_name].filter(Boolean).join(' · ') || user_name || '—'
    : (user_name || '—')
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
  cellSaving,
  onSave, onClose, onCreateSection,
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

  // Категорийные ограничения убраны — любую единицу можно положить в любое место.
  const sectionBlocked = false

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

      {/* Место (полка/вешалка/место) */}
      {selWh && sectionsInHall.length > 0 && (
        <select value={selSection} onChange={e => setSelSection(e.target.value)} className="uc-select" style={{ marginTop: 6 }}>
          <option value="">— Место —</option>
          {sectionsInHall.map(sec => (
            <option key={sec.id} value={sec.id}>
              {(SECTION_TYPE_LABEL[sec.type] || sec.type)} · {sec.name}
            </option>
          ))}
        </select>
      )}

      {/* Подсказки */}
      {selWh && halls.length === 0 && !hasLegacy && (
        <div className="uc-hint">На складе ещё нет залов и мест.</div>
      )}
      {selWh && sectionsInHall.length === 0 && (halls.length > 0 || hasLegacy) && (
        <div className="uc-hint">
          {selHall ? 'В этом зале нет мест.' : 'Выберите зал для продолжения.'}
        </div>
      )}
      <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
        <Button variant="secondary" fullWidth onClick={onClose}>Отмена</Button>
        {selWh && halls.length === 0 && !hasLegacy ? (
          <Button fullWidth onClick={onCreateSection}>Перейти к складу</Button>
        ) : (
          <Button fullWidth onClick={onSave} disabled={cellSaving || !selSection || sectionBlocked}>
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
  .uc-photo-toolbar { padding: 0 14px; }
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
    cursor: zoom-in;
  }
  .uc-zoom-mobile {
    position: absolute; top: 10px; right: 10px;
    width: 36px; height: 36px;
    background: rgba(0,0,0,0.55);
    border-radius: 50%;
    border: none;
    display: flex; align-items: center; justify-content: center;
    cursor: pointer;
    z-index: 2;
  }
  .uc-gallery-slide img,
  .uc-gallery-slide video {
    width: 100%; height: 100%; object-fit: contain;
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
  transition: transform 0.05s linear;
}
/* Hover-лупа: при движении мыши над .uc-photo-main картинка масштабируется
   через inline transform-origin/scale (см. handlePhotoMove). Курсор —
   crosshair, как на маркетплейсах. Активна только на тач-неактивных
   устройствах (десктоп) — на тач-устройствах работает Lightbox по тапу. */
@media (hover: hover) and (pointer: fine) {
  .uc-photo-main.zooming { cursor: crosshair; }
  .uc-photo-main.zooming img { transition: none; }
  .uc-photo-main.zooming .uc-nav,
  .uc-photo-main.zooming .uc-zoom { opacity: 0; pointer-events: none; }
}
.uc-zoom {
  position: absolute; top: 10px; right: 10px;
  background: rgba(0,0,0,0.55);
  border-radius: 50%;
  width: 30px; height: 30px;
  border: none;
  display: flex; align-items: center; justify-content: center;
  cursor: pointer;
  z-index: 2;
}
.uc-zoom:hover { background: rgba(0,0,0,0.75); }
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

/* Управление фото в карточке: тулбар, крестики на превью, слот «+» */
.uc-photo-toolbar {
  display: flex; justify-content: flex-end;
  margin-bottom: 8px;
}
.uc-photo-manage {
  display: inline-flex; align-items: center; gap: 5px;
  padding: 4px 10px; border-radius: 8px;
  background: var(--white, #fff); border: 1px solid var(--border);
  color: var(--muted); font-family: inherit; font-size: 12px; font-weight: 500;
  cursor: pointer; transition: color 0.12s, border-color 0.12s, background 0.12s;
}
.uc-photo-manage:hover:not(:disabled) {
  color: var(--gold-600); border-color: var(--gold-500);
  background: var(--bg-secondary);
}
.uc-photo-manage.active {
  color: var(--gold-700, var(--gold-600));
  border-color: var(--gold-500);
  background: var(--bg-secondary);
}
.uc-photo-manage:disabled { opacity: 0.55; cursor: default; }

/* Toggle «Белый фон» — рядом с «Управлять фото» в edit-режиме. */
.uc-photo-bg-toggle {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 4px 10px; border-radius: 8px;
  background: var(--white, #fff); border: 1px solid var(--border);
  color: var(--text-secondary, var(--muted)); font-size: 12px; font-weight: 500;
  cursor: pointer; transition: all 0.15s ease;
}
.uc-photo-bg-toggle:hover:not(:disabled) {
  color: var(--gold-600); border-color: var(--gold-500);
  background: var(--bg-secondary);
}
.uc-photo-bg-toggle.active {
  color: var(--gold-700, var(--gold-600));
  border-color: var(--gold-500);
  background: var(--gold-50, var(--bg-secondary));
}
.uc-photo-bg-toggle:disabled { opacity: 0.55; cursor: default; }
.uc-photo-bg-dot {
  width: 8px; height: 8px; border-radius: 50%;
  background: var(--border); transition: background 0.15s ease;
}
.uc-photo-bg-dot.on { background: var(--gold-500, var(--accent)); }
.uc-photo-bg-progress {
  display: inline-flex; align-items: center; gap: 6px;
  font-size: 11px; color: var(--gold-700, var(--accent));
  font-weight: 500;
}

.uc-thumb-wrap {
  position: relative;
  width: 52px; height: 52px;
  flex-shrink: 0;
}
.uc-thumb-wrap .uc-thumb { width: 100%; height: 100%; }
.uc-thumb-del {
  position: absolute;
  top: -5px; right: -5px;
  width: 18px; height: 18px;
  border-radius: 50%;
  background: var(--red, #B14B3D);
  color: #fff;
  border: 2px solid var(--white, #fff);
  padding: 0;
  display: flex; align-items: center; justify-content: center;
  cursor: pointer;
  box-shadow: 0 1px 3px rgba(0,0,0,0.18);
  transition: transform 0.08s, background 0.12s;
  z-index: 2;
}
.uc-thumb-del:hover:not(:disabled) { background: #962F22; transform: scale(1.05); }
.uc-thumb-del:disabled { opacity: 0.55; cursor: default; }

.uc-thumb-bg {
  position: absolute;
  bottom: -5px; right: -5px;
  width: 18px; height: 18px;
  border-radius: 50%;
  background: var(--gold-500, var(--accent));
  color: #fff;
  border: 2px solid var(--white, #fff);
  padding: 0;
  display: flex; align-items: center; justify-content: center;
  cursor: pointer;
  box-shadow: 0 1px 3px rgba(0,0,0,0.18);
  transition: transform 0.08s, background 0.12s;
  z-index: 2;
}
.uc-thumb-bg:hover:not(:disabled) { background: var(--gold-600, var(--accent-dark)); transform: scale(1.05); }
.uc-thumb-bg:disabled { opacity: 0.55; cursor: default; }
.uc-thumb-bg.busy { opacity: 1; background: var(--gold-600, var(--accent-dark)); }
.uc-spin { animation: uc-spin-anim 0.9s linear infinite; }
@keyframes uc-spin-anim { to { transform: rotate(360deg); } }

.uc-bg-overlay {
  position: absolute;
  inset: 0;
  background: rgba(0,0,0,0.55);
  display: flex; flex-direction: column;
  align-items: center; justify-content: center;
  gap: 12px;
  z-index: 4;
  backdrop-filter: blur(4px);
  -webkit-backdrop-filter: blur(4px);
  border-radius: inherit;
}
.uc-bg-overlay-text {
  color: #fff;
  font-size: 14px;
  font-weight: 500;
  letter-spacing: -0.005em;
}

.uc-thumb-add {
  background: var(--bg-secondary);
  border: 1px dashed var(--gold-500);
  color: var(--gold-600);
}
.uc-thumb-add:hover:not(:disabled) {
  background: var(--white, #fff);
  border-style: solid;
}
.uc-thumb-add:disabled { opacity: 0.55; cursor: default; }

/* Мобильная галерея: крестик на слайде + слайд-«добавить» */
.uc-slide-del {
  position: absolute;
  top: 10px; right: 10px;
  width: 28px; height: 28px;
  border-radius: 50%;
  background: rgba(0,0,0,0.55);
  color: #fff;
  border: none;
  padding: 0;
  display: flex; align-items: center; justify-content: center;
  cursor: pointer;
  z-index: 3;
  backdrop-filter: blur(6px);
  -webkit-backdrop-filter: blur(6px);
}
.uc-slide-del:hover:not(:disabled) { background: rgba(0,0,0,0.75); }
.uc-slide-del:disabled { opacity: 0.55; cursor: default; }

.uc-slide-bg {
  position: absolute;
  top: 10px; right: 50px;
  width: 28px; height: 28px;
  border-radius: 50%;
  background: var(--gold-500, var(--accent));
  color: #fff;
  border: none;
  padding: 0;
  display: flex; align-items: center; justify-content: center;
  cursor: pointer;
  z-index: 3;
  backdrop-filter: blur(6px);
  -webkit-backdrop-filter: blur(6px);
  box-shadow: 0 2px 6px rgba(0,0,0,0.18);
}
.uc-slide-bg:hover:not(:disabled) { background: var(--gold-600, var(--accent-dark)); }
.uc-slide-bg:disabled { opacity: 0.55; cursor: default; }
.uc-slide-bg.busy { opacity: 1; background: var(--gold-600, var(--accent-dark)); }

.uc-gallery-add {
  display: flex !important;
  flex-direction: column;
  align-items: center; justify-content: center;
  gap: 8px;
  background: var(--bg-secondary) !important;
  border: 1px dashed var(--gold-500) !important;
  cursor: pointer;
}
.uc-gallery-add-label {
  font-size: 13px; font-weight: 500; color: var(--gold-600);
}

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

/* Чип-ряд с быстрыми фактами (Серийный/Период/Фонд/Источник/Стоимость).
   Иконки 32×32, тултип всплывает на hover (desktop) или после клика (mobile).
   На mobile тултип «прилипает» — закрытие через повторный тап или клик вне. */
.uc-fact-chips {
  display: flex; flex-wrap: wrap; gap: 6px;
  margin-top: 14px; padding-top: 12px;
  border-top: 1px solid var(--border);
}
.uc-fact-chip {
  position: relative;
  width: 32px; height: 32px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--bg-secondary, #F0EDE6);
  color: var(--muted);
  display: inline-flex; align-items: center; justify-content: center;
  cursor: pointer; padding: 0;
  font-family: inherit;
  transition: border-color 0.12s, color 0.12s, background 0.12s;
  -webkit-tap-highlight-color: transparent;
}
.uc-fact-chip:hover,
.uc-fact-chip.open {
  border-color: var(--accent);
  color: var(--accent);
  background: var(--accent-dim);
}
.uc-fact-tip {
  position: absolute; bottom: calc(100% + 8px); left: 50%;
  transform: translateX(-50%);
  background: #1a1a1a; color: #fff;
  padding: 7px 11px; border-radius: 8px;
  font-size: 11.5px; font-weight: 500;
  white-space: nowrap;
  display: none;
  pointer-events: none;
  box-shadow: 0 6px 18px rgba(0,0,0,0.22);
  z-index: 30;
  letter-spacing: 0.01em;
  line-height: 1.35;
  text-align: left;
}
.uc-fact-tip::after {
  content: ''; position: absolute; top: 100%; left: 50%;
  transform: translateX(-50%);
  border: 5px solid transparent; border-top-color: #1a1a1a;
}
.uc-fact-tip-label {
  display: block; font-size: 10px; font-weight: 500;
  color: rgba(255,255,255,0.55); text-transform: uppercase;
  letter-spacing: 0.06em; margin-bottom: 1px;
}
.uc-fact-tip-value {
  display: block; font-size: 12.5px; font-weight: 600;
  color: #fff; max-width: 240px;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
/* Hover на десктопе показывает тултип. На сенсорных — hover не триггерится,
   используется .open класс который ставится по клику. */
@media (hover: hover) {
  .uc-fact-chip:hover .uc-fact-tip { display: block; }
}
.uc-fact-chip.open .uc-fact-tip { display: block; }
/* На очень узких экранах прижимаем тултип к краям если он широкий. */
@media (max-width: 480px) {
  .uc-fact-tip-value { max-width: min(200px, 60vw); white-space: normal; }
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
.uc-desc-edit {
  display: inline-flex; align-items: center; gap: 4px;
  background: none; border: none; padding: 2px 6px;
  color: var(--muted); font-size: 11px; font-family: inherit;
  cursor: pointer; border-radius: 6px;
  text-transform: none; letter-spacing: normal; font-weight: 500;
}
.uc-desc-edit:hover { color: var(--gold-600); background: var(--bg-secondary); }
.uc-desc-textarea {
  width: 100%; min-height: 80px; padding: 10px 12px;
  border: 1px solid var(--border); border-radius: 10px;
  font-family: inherit; font-size: 13px; line-height: 1.5;
  color: var(--text); background: var(--white, #fff);
  resize: vertical; box-sizing: border-box;
}
.uc-desc-textarea:focus { outline: none; border-color: var(--accent); }

/* Edit-mode для карточки: один карандаш на 4 поля */
.uc-info-toolbar { display: flex; justify-content: flex-end; margin-bottom: 4px; }
.uc-edit-toggle {
  display: inline-flex; align-items: center; gap: 5px;
  padding: 4px 10px; border-radius: 8px;
  background: none; border: 1px solid var(--border);
  color: var(--muted); font-family: inherit; font-size: 12px; font-weight: 500;
  cursor: pointer;
}
.uc-edit-toggle:hover { color: var(--gold-600); border-color: var(--gold-500); background: var(--bg-secondary); }
.uc-row-form { gap: 12px; }
.uc-row-form-control { display: flex; flex: 1; min-width: 0; max-width: 60%; }
.uc-edit-input {
  width: 100%; min-width: 0;
  height: 32px; padding: 0 10px;
  border: 1px solid var(--accent); border-radius: 8px;
  font-family: inherit; font-size: 13px;
  background: var(--white, #fff); color: var(--text);
  outline: none; box-sizing: border-box;
}
select.uc-edit-input { padding: 0 8px; cursor: pointer; }
.uc-edit-input:focus { border-color: var(--gold-600); }

/* Размер — растянуть на обе колонки .uc-rows (grid 1fr 1fr) */
.uc-size-row {
  grid-column: 1 / -1;
  display: block;
  padding: 12px 0;
  gap: 0;
}
.uc-size-head {
  display: flex; align-items: center; justify-content: space-between;
  margin-bottom: 8px;
}
.uc-size-tabs { display: flex; gap: 6px; }
.uc-size-tab {
  padding: 4px 12px; font-size: 12px; font-family: inherit;
  border-radius: var(--radius-btn); border: 1px solid var(--border);
  background: var(--white, #fff); color: var(--text);
  cursor: pointer; transition: background 0.12s, color 0.12s, border-color 0.12s;
}
.uc-size-tab.active { background: var(--accent); color: #fff; border-color: var(--accent); }
.uc-size-tab:disabled { opacity: 0.5; cursor: default; }
.uc-size-region {
  display: inline-flex; gap: 0; margin-bottom: 10px;
  border: 1px solid var(--border); border-radius: var(--radius-btn);
  overflow: hidden; background: var(--bg-secondary);
}
.uc-size-region-btn {
  padding: 5px 14px; font-size: 11.5px; font-weight: 600; font-family: inherit;
  border: none; background: transparent; color: var(--muted);
  cursor: pointer; transition: background 0.12s, color 0.12s;
}
.uc-size-region-btn.active {
  background: var(--white, #fff);
  color: var(--gold-700, var(--gold-600));
  box-shadow: 0 1px 2px rgba(0,0,0,0.06);
}
.uc-size-region-btn:disabled { opacity: 0.5; cursor: default; }
.uc-size-chips {
  display: flex; flex-wrap: wrap; gap: 6px;
}
.uc-size-chip {
  padding: 6px 12px; font-size: 12px; font-family: inherit;
  border-radius: var(--radius-btn); border: 1px solid var(--border);
  background: var(--white, #fff); color: var(--text);
  cursor: pointer; transition: background 0.12s, color 0.12s, border-color 0.12s;
}
.uc-size-chip:hover:not(:disabled) { border-color: var(--gold-500); }
.uc-size-chip.active {
  background: var(--accent); color: #fff;
  border-color: var(--accent); font-weight: 600;
}
.uc-size-chip:disabled { opacity: 0.5; cursor: default; }

.uc-edit-actions {
  display: flex; gap: 8px; margin-top: 14px;
  padding-top: 12px; border-top: 1px solid var(--border);
}
.uc-edit-actions .uc-desc-btn-cancel,
.uc-edit-actions .uc-desc-btn-save { flex: 1; }
.uc-desc-btn-cancel,
.uc-desc-btn-save {
  height: 32px; padding: 0 14px; border-radius: 8px; font-size: 13px;
  font-family: inherit; cursor: pointer; font-weight: 500;
}
.uc-desc-btn-cancel { background: var(--white, #fff); border: 1px solid var(--border); color: var(--text); }
.uc-desc-btn-cancel:hover:not(:disabled) { background: var(--bg-secondary); }
.uc-desc-btn-save { background: var(--accent); color: #fff; border: 1px solid var(--accent); }
.uc-desc-btn-save:hover:not(:disabled) { filter: brightness(1.05); }
.uc-desc-btn-cancel:disabled,
.uc-desc-btn-save:disabled { opacity: 0.55; cursor: default; }
.uc-desc-empty { font-size: 12px; color: var(--muted); font-style: italic; }
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
.uc-similar-meta {
  padding: 0 10px 9px;
  font-size: 11px;
  color: var(--muted);
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
