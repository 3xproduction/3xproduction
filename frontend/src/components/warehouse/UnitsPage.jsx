import { useState, useEffect, useRef } from 'react'
import { useSearchParams, useNavigate } from 'react-router-dom'
import { Search as SearchIcon, Package, Star, Camera, Film, Link as LinkIcon, ChevronLeft, Sparkles, Boxes } from 'lucide-react'
import WarehouseLayout from './WarehouseLayout'
import ProductionLayout from '../production/ProductionLayout'
import { ROLES } from '../../constants/roles'
import UnitCardModal from '../shared/UnitCardModal'
import UnitMissingDataBadge from '../shared/UnitMissingDataBadge'
import { missingUnitCardStyle } from '../../utils/unitMissingData'
import ConfirmModal from '../shared/ConfirmModal'
import MoveToProjectModal from '../shared/MoveToProjectModal'
import Badge from '../shared/Badge'
import Button from '../shared/Button'
import TruncTip from '../shared/TruncTip'
import { STATUS_LABEL, STATUS_COLOR } from '../../constants/statuses'
import { ALL_CATEGORIES, CATEGORY_MAP, categoryLabel } from '../../constants/categories'
import { unitFund, FUND_VALUABLE, FUND_CONSUMABLE } from '../../constants/funds'
import { CLOTHING_SIZES_INT, CLOTHING_SIZES_RU, SHOE_SIZES, IS_CLOTHING_CAT, IS_SHOES_CAT } from '../../constants/clothingSizes'
import { units as unitsApi, warehouses as warehousesApi, rent as rentApi } from '../../services/api'
import { useAuth } from '../../hooks/useAuth'
import { useBodyLock } from '../../hooks/useBodyLock'
import { useToast } from '../shared/Toast'
import { removeBgWhite, preloadBgModel, describeBgError, describeBgSkipped } from '../../utils/removeBg'
import { sumUnitQty } from '../../utils/unitQty'

const SECTION_TYPE_RU = { shelf: 'Полка', hanger: 'Вешалка', place: 'Место' }

// Локация на карточке каталога: «Адрес/Склад · Зал · Полка/Вешалка/Место Имя».
// full=true возвращает развёрнутую версию для tooltip (всегда warehouse_name +
// адрес если есть). По умолчанию приоритет адреса (он короче и понятнее
// большинству пользователей), плюс зал и название секции если они известны.
function formatLocation(u, { full = false } = {}) {
  if (!u) return ''
  const parts = []
  if (full) {
    if (u.warehouse_name) parts.push(u.warehouse_name)
    if (u.warehouse_address && u.warehouse_address !== u.warehouse_name) parts.push(u.warehouse_address)
  } else {
    const wh = u.warehouse_address || u.warehouse_name
    if (wh) parts.push(wh)
  }
  if (u.hall_name) parts.push(u.hall_name)
  if (u.section_name) {
    const t = SECTION_TYPE_RU[u.section_type] || ''
    parts.push(t ? `${t} ${u.section_name}` : u.section_name)
  }
  if (
    u.status === 'on_stock'
    && !u.cell_id
    && !u.pavilion_id
    && !u.is_project_kept
    && !u.is_admin_stock
  ) {
    parts.push('Без места')
  }
  return parts.join(' · ')
}

const CATEGORIES = ['all', ...ALL_CATEGORIES]
const STATUSES = ['Фильтр', 'На складе', 'Выдано', 'Просрочено', 'На утверждении', 'Списано']
const STATUS_KEY = {
  'На складе': 'on_stock', 'Выдано': 'issued', 'Просрочено': 'overdue',
  'На утверждении': 'pending', 'Списано': 'written_off',
}

const EMPTY_FORM = { name: '', category: ALL_CATEGORIES[0], dimensions: '', description: '', source: 'покупка', qty: 1, warehouse_id: '', cell_id: '', period: '', valuation: '' }
const catOption = (key) => key === 'all' ? 'Категория' : categoryLabel(key)

export default function UnitsPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const navigate = useNavigate()
  const { user } = useAuth()
  const toast = useToast()
  const Layout = ROLES[user?.role]?.world === 'production' ? ProductionLayout : WarehouseLayout
  const [viewMode, setViewMode] = useState(() => localStorage.getItem('unitsViewMode') || 'grid')
  // Источник истины — URL ?q=. Layout-шапка пишет туда, мы читаем.
  // Локальный input (десктоп) при изменении тоже пишет в URL.
  const urlQ = searchParams.get('q') || ''
  const [search, setSearch] = useState(urlQ)
  const [debouncedSearch, setDebouncedSearch] = useState(urlQ)
  const searchTimer = useRef(null)
  // Синхронизация: когда ?q= меняется снаружи (через шапку), подтягиваем сюда.
  useEffect(() => { setSearch(urlQ) }, [urlQ])
  const [category, setCategory] = useState('all')
  const [statusFilter, setStatusFilter] = useState('Все статусы')
  // Синхронный peek в localStorage-кэш на первом рендере: если последний раз
  // юзер открывал каталог — сразу показываем тот же список без "Загрузка...".
  // Сеть в фоне обновит через .onUpdate. Это убирает 5-10 сек белого экрана
  // на холодном старте Serverless Container.
  const _cached = unitsApi.listCached({})
  const [allUnits, setAllUnits] = useState(_cached?.units || [])
  const [loading, setLoading] = useState(!_cached)

  const [showAdd, setShowAdd] = useState(false)
  const [addStep, setAddStep] = useState(1) // 1=photos, 2=details, 3=source+warehouse, 4=preview
  const [sizeType, setSizeType] = useState('clothing') // 'clothing' or 'shoe'
  const [sizeRegion, setSizeRegion] = useState('ru')   // 'ru' | 'int' — российская или международная сетка одежды
  const [form, setForm] = useState(EMPTY_FORM)
  const [photos, setPhotos] = useState([])
  const [adding, setAdding] = useState(false)
  const [addError, setAddError] = useState('')
  const [cardId, setCardId] = useState(null)
  const [recognizing, setRecognizing] = useState(false)
  // Индексы фото (в массиве photos), которые AI счёл «другим предметом».
  // Сбрасывается при любом изменении photos.
  const [outliers, setOutliers] = useState(new Set())
  const [selectionMode, setSelectionMode] = useState(false)
  const [selectedIds, setSelectedIds] = useState(new Set())
  const [showBulkConfirm, setShowBulkConfirm] = useState(false)
  // Для случая «удалить ВСЕ выбранное» (selectedIds.size === filtered.length) —
  // три ступени подтверждения вместо одной. 0 = закрыто, 1/2/3 = текущий шаг.
  const [bulkDeleteAllStep, setBulkDeleteAllStep] = useState(0)
  const [showBulkBgConfirm, setShowBulkBgConfirm] = useState(false)
  const [bulkBgRunning, setBulkBgRunning] = useState(false)
  const [showMoveToProject, setShowMoveToProject] = useState(false)
  const fileRef = useRef()
  const camRef = useRef()
  const videoRef = useRef()

  // Опция «Сделать белый фон» — opt-in, persist в localStorage.
  const [whiteBg, setWhiteBg] = useState(() => {
    try { return localStorage.getItem('whiteBgEnabled') === '1' } catch { return false }
  })
  const [bgProgress, setBgProgress] = useState(null)
  function toggleWhiteBg() {
    const next = !whiteBg
    setWhiteBg(next)
    try { localStorage.setItem('whiteBgEnabled', next ? '1' : '0') } catch { /* ignore */ }
    if (next) preloadBgModel().catch(() => {})
  }

  const canSeeSource = ['warehouse_director', 'warehouse_deputy', 'producer'].includes(user?.role)

  // Блок body-скролла пока открыт wizard «Пополнение склада» — иначе на iOS
  // (и местами на Android) фон скроллится вместе с тапами по карточке.
  useBodyLock(showAdd)

  const [warehouses, setWarehouses] = useState([])
  // sections — полные секции склада (вместе с cells). Для выбора места используем
  // иерархию Зал → Полка/Вешалка/Место → Ячейка (как в карточке UnitCardModal).
  const [sections, setSections] = useState([])
  const [selHall, setSelHall] = useState('')
  const [selSection, setSelSection] = useState('')

  useEffect(() => {
    clearTimeout(searchTimer.current)
    searchTimer.current = setTimeout(() => {
      setDebouncedSearch(search)
      // Пишем в URL только если значение реально отличается — не плодим
      // history-записи при каждом тике. Layout читает ?q= при ре-рендере.
      const cur = searchParams.get('q') || ''
      if (cur !== search) {
        const next = new URLSearchParams(searchParams)
        if (search) next.set('q', search); else next.delete('q')
        setSearchParams(next, { replace: true })
      }
    }, 300)
    return () => clearTimeout(searchTimer.current)
  }, [search])

  useEffect(() => {
    const params = {}
    if (debouncedSearch.trim()) params.search = debouncedSearch.trim()
    // Don't setLoading(true) on search — keeps current results visible while fetching.
    // cachedGet вернёт stale моментально (если есть) + .onUpdate для фонового апдейта.
    const p = unitsApi.list(params)
    p.then(data => { setAllUnits(data.units || []); setLoading(false) }).catch(() => setLoading(false))
    if (typeof p.onUpdate === 'function') {
      p.onUpdate(data => setAllUnits(data.units || []))
    }
  }, [debouncedSearch])

  useEffect(() => {
    const wp = warehousesApi.list()
    wp.then(d => setWarehouses(d.warehouses || [])).catch(() => {})
    if (typeof wp.onUpdate === 'function') {
      wp.onUpdate(d => setWarehouses(d.warehouses || []))
    }
  }, [])

  // Открытие визарда «Добавить единицу» по ?add=1 — отдельный эффект,
  // чтобы срабатывал и при первом маунте, и при навигации с уже открытой
  // /units (например, FAB → «Пополнить склад» на той же странице).
  // Открытие карточки единицы по ?open=<id> — старый роут /units/:id (UnitPage)
  // редиректит сюда, чтобы из истории/approvals/returns/rent открывалась
  // актуальная UnitCardModal вместо устаревшей страницы.
  const openParam = searchParams.get('open')
  useEffect(() => {
    if (openParam) setCardId(openParam)
  }, [openParam])

  useEffect(() => {
    if (searchParams.get('add') !== '1') return
    // Префилл склада/ячейки, если пришли с карты «Добавить единицу сюда».
    // В этом случае прыгаем сразу на шаг «Детали» (шаг 2) — фото юзер
    // добавит потом перед сохранением.
    const prefillCellId = searchParams.get('cellId') || ''
    const prefillWhId   = searchParams.get('warehouseId') || ''
    const nextForm = { ...EMPTY_FORM }
    if (prefillWhId)   nextForm.warehouse_id = prefillWhId
    if (prefillCellId) nextForm.cell_id = prefillCellId
    setForm(nextForm)
    setPhotos([]); setOutliers(new Set()); setAddError('')
    setAddStep(prefillCellId ? 2 : 1)
    setSizeType('clothing')
    setSizeRegion('ru')
    setShowAdd(true)
    setSearchParams({}, { replace: true })
  }, [searchParams])

  useEffect(() => {
    if (!form.warehouse_id) {
      setSections([]); setSelHall(''); setSelSection('')
      setForm(f => ({ ...f, cell_id: '' }))
      return
    }
    warehousesApi.cells(form.warehouse_id)
      .then(d => setSections(d.sections || []))
      .catch(() => setSections([]))
  }, [form.warehouse_id])

  // Сброс зависимых селекторов при смене зала/секции.
  useEffect(() => { setSelSection(''); setForm(f => ({ ...f, cell_id: '' })) }, [selHall])
  useEffect(() => { setForm(f => ({ ...f, cell_id: '' })) }, [selSection])

  const filtered = allUnits.filter(u => {
    const matchCat = category === 'all' || u.category === category
    const matchStatus = statusFilter === 'Все статусы' || u.status === STATUS_KEY[statusFilter]
    return matchCat && matchStatus
  })

  // Split into 3 tiers: direct → similar (close synonyms) → related (category siblings)
  const directUnits = filtered.filter(u => !u._match || u._match === 'direct')
  const similarUnits = filtered.filter(u => u._match === 'similar')
  const relatedUnits = filtered.filter(u => u._match === 'related')
  const isSearching = debouncedSearch.trim().length > 0

  function isVideoFile(file) {
    return file.type?.startsWith('video/')
  }

  async function onFilesSelected(e) {
    const files = Array.from(e.target.files)
    const compressed = await Promise.all(files.map(f => isVideoFile(f) ? f : compressImage(f)))

    let processed = compressed
    if (whiteBg) {
      const onlyImgIdx = compressed.map((f, i) => isVideoFile(f) ? -1 : i).filter(i => i !== -1)
      const total = onlyImgIdx.length
      processed = [...compressed]
      let skipReason = null
      let firstErr = null
      // Падение на одном фото не должно отменять остальные — обрабатываем
      // картинки независимо и собираем skip-причины для одного toast'а в конце.
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

    setPhotos(prev => [...prev, ...processed].slice(0, 5))
    setOutliers(new Set()) // новые фото — сбрасываем предыдущую подсветку
  }

  async function handlePhotosReady() {
    // Индексы фото-файлов (не видео) в массиве photos. Backend возвращает
    // outlier_indices в пространстве картинок (0..N-1), мапим обратно.
    const imagePhotoIdx = photos.map((p, i) => isVideoFile(p) ? -1 : i).filter(i => i !== -1)
    const images = imagePhotoIdx.map(i => photos[i])
    if (images.length < 1) {
      toast?.('Загрузите хотя бы одно фото', 'error')
      return
    }
    setRecognizing(true)
    setOutliers(new Set())
    try {
      const fd = new FormData()
      for (const img of images) fd.append('photos', img)
      const result = await unitsApi.recognize(fd)
      if (result?.same_item === false) {
        const outlierImageIdxs = Array.isArray(result.outlier_indices) ? result.outlier_indices : []
        const outlierPhotoIdxs = outlierImageIdxs
          .map(i => imagePhotoIdx[i])
          .filter(i => typeof i === 'number')
        setOutliers(new Set(outlierPhotoIdxs))
        toast?.(result.message || 'Загруженные фото относятся к разным предметам. Пожалуйста, перезагрузите фотографии одного предмета', 'error')
        return
      }
      if (result?.name || result?.category || result?.description) {
        setForm(f => {
          const nextCat = ALL_CATEGORIES.includes(result.category) ? result.category : f.category
          if (nextCat !== f.category) {
            setSizeType(IS_SHOES_CAT(nextCat) ? 'shoe' : 'clothing')
            setSizeRegion('ru')
          }
          return {
            ...f,
            name: result.name || f.name,
            category: nextCat,
            period: result.period || f.period,
            description: result.description || f.description,
          }
        })
        toast?.('AI заполнил поля — проверьте и отредактируйте', 'success')
      } else {
        toast?.('AI нужна ещё попытка или заполните вручную', 'error')
      }
    } catch (err) {
      console.error('Recognize error:', err)
      toast?.(err.message || 'AI нужна ещё попытка или заполните вручную', 'error')
    } finally {
      setRecognizing(false)
      setAddStep(2)
    }
  }

  const isDirector = ['warehouse_director', 'warehouse_deputy'].includes(user?.role)
  const canMoveToProject = ['warehouse_director', 'warehouse_deputy', 'warehouse_staff'].includes(user?.role)

  function handleMoveToProjectSuccess(res) {
    setShowMoveToProject(false)
    setSelectionMode(false)
    setSelectedIds(new Set())
    const moved = res?.moved_count ?? 0
    const errs = Array.isArray(res?.errors) ? res.errors : []
    const projectName = res?.project?.name || 'проекта'
    if (moved > 0 && errs.length === 0) {
      toast?.(`Перемещено ${moved} ед. на склад «${projectName}»`, 'success')
    } else if (moved > 0 && errs.length > 0) {
      const reasons = [...new Set(errs.map(e => e.reason))].slice(0, 2).join(', ')
      toast?.(`Перемещено ${moved} ед., пропущено ${errs.length} (${reasons})`, 'info')
    } else {
      const reasons = [...new Set(errs.map(e => e.reason))].slice(0, 2).join(', ')
      toast?.(reasons ? `Не перемещено: ${reasons}` : 'Нет подходящих единиц для перемещения', 'error')
    }
    unitsApi.list().then(d => setAllUnits(d.units || [])).catch(() => {})
  }

  function toggleSelection(id) {
    setSelectedIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }

  function toggleAll() {
    const allVisible = filtered.map(u => u.id)
    const allSelected = allVisible.every(id => selectedIds.has(id))
    setSelectedIds(allSelected ? new Set() : new Set(allVisible))
  }

  function openBulkDeleteConfirm() {
    if (!selectedIds.size) return
    if (filtered.length > 0 && selectedIds.size === filtered.length) {
      setBulkDeleteAllStep(1)
    } else {
      setShowBulkConfirm(true)
    }
  }

  async function handleBulkDelete() {
    const count = selectedIds.size
    try {
      await unitsApi.bulkDelete([...selectedIds])
      setSelectionMode(false)
      setSelectedIds(new Set())
      setShowBulkConfirm(false)
      setBulkDeleteAllStep(0)
      const d = await unitsApi.list()
      setAllUnits(d.units || [])
      toast?.(`Удалено ${count} ед.`, 'success')
    } catch (err) {
      toast?.(err.message || 'Ошибка удаления', 'error')
    }
  }

  async function handleBulkBg() {
    const count = selectedIds.size
    setShowBulkBgConfirm(false)
    setBulkBgRunning(true)
    try {
      const r = await unitsApi.bulkRegenBg([...selectedIds])
      const okN = r.ok ?? 0
      const failedN = r.failed ?? 0
      const totalN = r.total ?? 0
      if (totalN === 0) {
        toast?.('Все фото уже обработаны', 'info')
      } else if (failedN === 0) {
        toast?.(`Обелено ${okN} фото у ${count} ед.`, 'success')
      } else {
        toast?.(`Обелено ${okN}/${totalN}, ошибок: ${failedN}`, failedN === totalN ? 'error' : 'info')
      }
      setSelectionMode(false)
      setSelectedIds(new Set())
      const d = await unitsApi.list()
      setAllUnits(d.units || [])
    } catch (err) {
      toast?.(err.message || 'Ошибка обработки фона', 'error')
    } finally {
      setBulkBgRunning(false)
    }
  }

  function compressImage(file, maxSize = 1568, quality = 0.85) {
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

  async function handleAdd() {
    if (!form.name.trim()) return
    if (isDirector && !form.valuation) { setAddError('Укажите стоимость единицы'); return }
    setAdding(true)
    setAddError('')
    try {
      // Если выбрана секция (полка/вешалка/место) но не выбрана конкретная
      // ячейка — авто-создаём её, чтобы не заставлять пользователя кликать
      // лишний раз.
      let cellId = form.cell_id
      if (!cellId && selSection) {
        try {
          const r = await warehousesApi.addCell(selSection)
          cellId = r.cell?.id || null
        } catch { /* без ячейки тоже допустимо */ }
      }
      // retry once on network failure (cold start)
      const createUnit = async () => unitsApi.create({
        name: form.name,
        category: form.category,
        dimensions: form.dimensions || null,
        description: form.description || null,
        source: canSeeSource ? form.source : null,
        qty: Number(form.qty) || 1,
        valuation: form.valuation ? Number(form.valuation) : null,
        warehouse_id: form.warehouse_id || null,
        cell_id: cellId || null,
        period: form.period || null,
      })
      let data
      try { data = await createUnit() }
      catch { data = await createUnit() }
      const unitId = data.unit?.id
      let photoErrors = 0
      if (unitId && photos.length > 0) {
        for (const file of photos) {
          const fd = new FormData()
          fd.append('photos', file)
          try { await unitsApi.uploadPhoto(unitId, fd) }
          catch { photoErrors++ }
        }
      }
      setShowAdd(false)
      setForm(EMPTY_FORM)
      setPhotos([])
      const d = await unitsApi.list()
      setAllUnits(d.units || [])
      if (photoErrors > 0) {
        toast?.(`Единица создана, но ${photoErrors} фото не загрузилось`, 'error')
      } else {
        toast?.(isDirector ? 'Позиция добавлена на склад' : 'Позиция отправлена на утверждение', 'success')
      }
    } catch (err) {
      setAddError(err.message || 'Ошибка')
    } finally {
      setAdding(false)
    }
  }

  return (
    <Layout>
      <style>{`
        /* На узких экранах (≤480px — большинство Android и старых iPhone)
           принудительно 2 колонки в каталоге. minmax(170px, 1fr) на 360px-экране
           с боковыми отступами оставляет ~296px полезных и помещает только
           1 колонку → визуально пустовато. Фиксированный repeat(2, 1fr)
           решает проблему одинаково на iOS и Android. */
        @media (max-width: 480px) {
          .catalog-grid {
            grid-template-columns: repeat(2, 1fr) !important;
            gap: 10px !important;
          }
          .units-page-root { padding: 16px 12px !important; }
        }
        /* На мобильной скрываем верхние действия (Экспорт / + Новое),
           статусный фильтр и встроенный поиск — поиск живёт в шапке layout
           через ?q=, остальные фильтры в одну строку с горизонтальным скроллом. */
        @media (max-width: 768px) {
          .units-top-actions { display: none !important; }
          .units-filter-status { display: none !important; }
          .units-inline-search { display: none !important; }
          /* На мобилке: одна линия без скролла — категория растягивается,
             кнопка «Выбрать» (если есть) рядом, режимы показа справа. */
          .units-filters {
            flex-wrap: nowrap !important;
            margin-bottom: 14px;
            gap: 6px !important;
            align-items: center;
          }
          .units-filters > select { flex: 1 1 0; min-width: 0; }
          .units-filters > .units-mode-btns { flex-shrink: 0; margin-left: auto !important; }
          .units-filters > .units-bulk-btn  {
            flex-shrink: 0;
            margin-left: 0 !important;
            padding: 0 10px !important;
            font-size: 12px !important;
          }
          .units-count { display: none !important; }
          .units-sticky .page-back { display: inline-flex !important; }
          /* Sticky-обёртка прилипает под mtop+SectionTabs через --page-sticky-top.
             На страницах без SectionTabs --tabs-h=0, и липнет прямо под mtop. */
          .units-sticky {
            position: sticky;
            /* -1px перекрывает субпиксельный зазор со sticky SectionTabs над
               нами. SectionTabs (z-index 14) рисуется поверх нашего 1px. */
            top: calc(var(--page-sticky-top, 52px) - 1px);
            z-index: 12;
            background: var(--paper);
            /* box-shadow внизу — визуальный разделитель между sticky-шапкой
               и карточками каталога, чтобы при скролле они не «слипались». */
            box-shadow: 0 1px 0 var(--border);
            margin: 0 -16px;
            padding: 8px 16px 10px;
            /* GPU-композиция убирает «дёрганье»/jitter sticky-элемента при
               быстром скролле на мобиле — особенно заметно когда sticky
               содержит несколько строк (заголовок + фильтры). */
            transform: translate3d(0, 0, 0);
            will-change: transform;
          }
          .units-page-root > :nth-child(2) { margin-top: 12px; }
          /* Убираем зазор между SectionTabs и шапкой страницы — на мобилке
             24px-падинг сверху превращался в видимый разрыв. */
          .units-page-root { padding: 0 16px 16px !important; }

          /* Rows-режим: на узком экране правый блок с локацией налезал на
             серийник, бейдж «На складе» уезжал за карточку. Прячем правый
             блок локации, переносим адрес третьей строкой в info-блок,
             уменьшаем горизонтальные паддинги и стрелку убираем (вся
             карточка кликабельна). */
          .units-row {
            padding: 12px !important;
            gap: 10px !important;
          }
          .units-row-loc-side { display: none !important; }
          .units-row-loc-mobile {
            display: block !important;
            font-size: 11px;
            color: var(--muted);
            margin-top: 2px;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
          }
          .units-row-chev { display: none !important; }
          .units-row-badge > span {
            padding: 2px 7px !important;
            font-size: 11px !important;
          }
        }
        /* На десктопе третья строка локации в info-блоке скрыта —
           там адрес показан в правой колонке. */
        .units-row-loc-mobile { display: none; }
      `}</style>
      <div className="units-page-root" style={{ padding: '24px 32px' }}>
        <div className="units-sticky">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20, gap: 12, flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
            <button className="page-back" onClick={() => navigate(-1)} aria-label="Назад">
              <ChevronLeft size={20} />
            </button>
            <h1 style={{ fontSize: 20, fontWeight: 600, margin: 0 }}>Каталог</h1>
          </div>
          <div className="units-top-actions" style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            {ROLES[user?.role]?.canPublicLink && (
              <Button onClick={async () => {
                try {
                  const data = await rentApi.generateLink()
                  const url = data.url || data.link
                  if (url) {
                    const full = `${window.location.origin}${url}`
                    await navigator.clipboard.writeText(full)
                    toast?.('Ссылка скопирована', 'success')
                  }
                } catch (e) {
                  toast?.(e.message || 'Не удалось создать ссылку', 'error')
                }
              }}><LinkIcon size={14} /> Поделиться ссылкой</Button>
            )}
          </div>
        </div>

        <div className="units-inline-search" style={{ position: 'relative', marginBottom: 14 }}>
          <SearchIcon size={14} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--muted)' }} />
          <input value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Найдите по названию или серийному номеру..."
            style={{ width: '100%', height: 40, padding: '0 12px 0 36px', border: '1px solid var(--border)', borderRadius: 'var(--radius-btn)', fontSize: 14, background: 'var(--white)', outline: 'none' }}
          />
        </div>

        <div className="units-filters" style={{ display: 'flex', gap: 8, marginBottom: 20, flexWrap: 'wrap' }}>
          <div className="units-filter-status"><Select value={statusFilter} onChange={setStatusFilter} options={STATUSES} /></div>
          <select value={category} onChange={e => setCategory(e.target.value)} style={{
            height: 36, padding: '0 10px', border: '1px solid var(--border)',
            borderRadius: 'var(--radius-btn)', fontSize: 13, background: 'var(--white)', cursor: 'pointer', color: 'var(--text)',
          }}>
            {CATEGORIES.map(k => <option key={k} value={k}>{catOption(k)}</option>)}
          </select>
          {isDirector && (
            <button className="units-bulk-btn" onClick={() => { setSelectionMode(m => !m); setSelectedIds(new Set()) }}
              style={{
                marginLeft: 'auto', height: 36, padding: '0 14px', border: '1px solid var(--border)',
                borderRadius: 'var(--radius-btn)', fontSize: 13, cursor: 'pointer',
                background: selectionMode ? 'var(--accent)' : 'var(--white)',
                color: selectionMode ? '#fff' : 'var(--text)',
              }}>{selectionMode ? 'Отмена' : 'Выбрать'}</button>
          )}
          <span className="units-count" style={{ fontSize: 13, color: 'var(--muted)', alignSelf: 'center', ...(!isDirector && { marginLeft: 'auto' }) }}>{sumUnitQty(filtered)} ед.</span>
          <div className="units-mode-btns" style={{ display: 'flex', gap: 2, alignSelf: 'center' }}>
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
        </div>

        {/* Skeleton-плитки пока нет данных вообще (первый визит, LS пуст).
            Если есть кэш — показываем его сразу (allUnits.length>0), скелет
            не нужен. "Загрузка..." текст убран — юзер не должен видеть
            пустой экран минутами на холодный старт серверлесса.
            Цвета НАМЕРЕННО заметнее чем bg-secondary/border (#F0EDE6/#E5E2DC) —
            те сливались с paper-фоном до невидимости. Сейчас #D8D3C9 base
            с проездом #B8B0A2 — чётко видно на бумаге. */}
        {loading && allUnits.length === 0 && (
          <>
            <style>{`
              @keyframes unitsSkelShimmer {
                0%   { background-position: 200% 0; }
                100% { background-position: -200% 0; }
              }
              .units-skel {
                background: linear-gradient(90deg, #D8D3C9 0%, #B8B0A2 50%, #D8D3C9 100%);
                background-size: 200% 100%;
                animation: unitsSkelShimmer 1.2s linear infinite;
                border-radius: 4px;
              }
            `}</style>
            <div className="catalog-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(170px, 1fr))', gap: 12 }}>
              {Array.from({ length: 8 }).map((_, i) => (
                <div key={i} style={{ background: '#fff', borderRadius: 'var(--radius-card)', border: '1px solid var(--border)', overflow: 'hidden' }}>
                  <div className="units-skel" style={{ aspectRatio: '4/5', borderRadius: 0 }} />
                  <div style={{ padding: 10 }}>
                    <div className="units-skel" style={{ height: 13, width: '85%', marginBottom: 8 }} />
                    <div className="units-skel" style={{ height: 11, width: '55%' }} />
                  </div>
                </div>
              ))}
            </div>
          </>
        )}

        {!loading && filtered.length === 0 && (
          <div style={{ textAlign: 'center', padding: '60px 0', color: 'var(--muted)', fontSize: 14 }}>Ничего не найдено</div>
        )}

        {/* Grid — карточки-сетка */}
        {viewMode === 'grid' && (
          <div>
          <div className="catalog-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(170px, 1fr))', gap: 12 }}>
            {(isSearching ? directUnits : filtered).map(u => {
              const isWrittenOff = u.status === 'written_off' || u.misplaced
              const isSelected = selectedIds.has(u.id)
              const missingStyle = missingUnitCardStyle(u, user?.role)
              return (
                <div key={u.id} onClick={() => selectionMode ? toggleSelection(u.id) : setCardId(u.id)} style={{
                  background: isWrittenOff ? 'var(--bg-secondary)' : 'var(--card)',
                  borderRadius: 'var(--radius-card)', border: isSelected ? '2px solid var(--accent)' : (missingStyle.border || '1px solid var(--border)'),
                  boxShadow: !isSelected ? missingStyle.boxShadow : undefined,
                  filter: isWrittenOff ? 'grayscale(1)' : 'none', opacity: isWrittenOff ? 0.6 : 1,
                  cursor: 'pointer', overflow: 'hidden', position: 'relative',
                }}>
                  {selectionMode && (
                    <div onClick={e => { e.stopPropagation(); toggleSelection(u.id) }} style={{
                      position: 'absolute', top: 8, left: 8, zIndex: 2, width: 22, height: 22,
                      borderRadius: '50%', border: isSelected ? 'none' : '2px solid #ccc',
                      background: isSelected ? 'var(--accent)' : '#fff',
                      display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer',
                      boxShadow: '0 1px 3px rgba(0,0,0,0.15)',
                    }}>{isSelected && <span style={{ color: '#fff', fontSize: 13, fontWeight: 700, lineHeight: 1 }}>✓</span>}</div>
                  )}
                  <div style={{
                    aspectRatio: '1', background: 'var(--bg)', display: 'flex',
                    alignItems: 'center', justifyContent: 'center', fontSize: 40, overflow: 'hidden',
                  }}>
                    {u.photo_url
                      ? /\.(mp4|webm|mov)$/i.test(u.photo_url)
                        ? <video src={u.photo_url} muted preload="none" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                        : <img src={u.photo_thumb_url || u.photo_url} alt="" loading="lazy" decoding="async" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                      : <Package size={22} color="var(--subtle)" strokeWidth={1.4} />}
                  </div>
                  <div style={{ padding: '10px 12px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                      {unitFund(u) === FUND_VALUABLE && (
                        <Star size={12} fill="var(--gold-500)" color="var(--gold-500)" style={{ flexShrink: 0 }} />
                      )}
                      <TruncTip
                        as="div"
                        style={{ fontWeight: 500, fontSize: 13, color: isWrittenOff ? 'var(--muted)' : 'var(--text)', textDecoration: isWrittenOff ? 'line-through' : 'none' }}
                      >{u.name}</TruncTip>
                    </div>
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
                    <div style={{ marginTop: 6, display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                      <Badge color={STATUS_COLOR[u.status]}>{STATUS_LABEL[u.status]}</Badge>
                    </div>
                    <UnitMissingDataBadge unit={u} role={user?.role} />
                    {u.status === 'on_stock' && formatLocation(u) && (
                      <TruncTip
                        as="div"
                        style={{ fontSize: 10, fontWeight: 500, color: 'var(--muted)', marginTop: 4 }}
                        fullText={formatLocation(u, { full: true })}
                      >
                        {formatLocation(u)}
                      </TruncTip>
                    )}
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
                  const isWrittenOff = u.status === 'written_off' || u.misplaced
                  const missingStyle = missingUnitCardStyle(u, user?.role)
                  return (
                    <div key={u.id} onClick={() => setCardId(u.id)} style={{
                      background: isWrittenOff ? 'var(--bg-secondary)' : 'var(--card)',
                      borderRadius: 'var(--radius-card)', border: missingStyle.border || '1px solid var(--border)',
                      boxShadow: missingStyle.boxShadow,
                      filter: isWrittenOff ? 'grayscale(1)' : 'none', opacity,
                      cursor: 'pointer', overflow: 'hidden',
                    }}>
                      <div style={{ aspectRatio: '1', background: 'var(--bg)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 40, overflow: 'hidden' }}>
                        {u.photo_url
                          ? /\.(mp4|webm|mov)$/i.test(u.photo_url)
                            ? <video src={u.photo_url} muted preload="none" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                            : <img src={u.photo_thumb_url || u.photo_url} alt="" loading="lazy" decoding="async" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                          : <Package size={22} color="var(--subtle)" strokeWidth={1.4} />}
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
                        <div style={{ marginTop: 6 }}><Badge color={STATUS_COLOR[u.status]}>{STATUS_LABEL[u.status]}</Badge></div>
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

        {/* Rows — строки с иконкой (текущий вид) */}
        {viewMode === 'rows' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {filtered.map(u => {
              const isWrittenOff = u.status === 'written_off' || u.misplaced
              const photo = u.photo_thumb_url || u.photo_url
              const isSelected = selectedIds.has(u.id)
              const missingStyle = missingUnitCardStyle(u, user?.role)
              return (
                <div key={u.id} className="units-row" style={{
                  display: 'flex', alignItems: 'center', gap: 14, padding: '14px 16px',
                  background: isWrittenOff ? 'var(--bg-secondary)' : 'var(--card)',
                  borderRadius: 'var(--radius-card)', border: isSelected ? '2px solid var(--accent)' : (missingStyle.border || '1px solid var(--border)'),
                  boxShadow: !isSelected ? missingStyle.boxShadow : undefined,
                  filter: isWrittenOff ? 'grayscale(1)' : 'none', opacity: isWrittenOff ? 0.6 : 1,
                  cursor: 'pointer', position: 'relative',
                }} onClick={() => selectionMode ? toggleSelection(u.id) : setCardId(u.id)}>
                  {selectionMode && (
                    <div onClick={e => { e.stopPropagation(); toggleSelection(u.id) }} style={{
                      width: 22, height: 22, borderRadius: '50%', flexShrink: 0,
                      border: isSelected ? 'none' : '2px solid #ccc',
                      background: isSelected ? 'var(--accent)' : '#fff',
                      display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer',
                    }}>{isSelected && <span style={{ color: '#fff', fontSize: 13, fontWeight: 700, lineHeight: 1 }}>✓</span>}</div>
                  )}
                  <div style={{
                    width: 48, height: 48, borderRadius: 8, flexShrink: 0,
                    background: 'var(--bg)', border: '1px solid var(--border)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 20, overflow: 'hidden',
                  }}>
                    {photo
                      ? /\.(mp4|webm|mov)$/i.test(photo)
                        ? <video src={photo} muted preload="none" style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
                        : <img src={photo} alt="" loading="lazy" decoding="async" style={{ width: '100%', height: '100%', objectFit: 'contain', filter: isWrittenOff ? 'blur(2px)' : 'none' }} />
                      : <Package size={22} color="var(--subtle)" strokeWidth={1.4} />}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      {unitFund(u) === FUND_VALUABLE && <Star size={13} fill="var(--gold-500)" color="var(--gold-500)" />}
                      <div style={{ fontWeight: 500, fontSize: 14, textDecoration: isWrittenOff ? 'line-through' : 'none', color: isWrittenOff ? 'var(--muted)' : 'var(--text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{u.name}</div>
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{u.serial ? `${u.serial} · ` : ''}{categoryLabel(u.category)}</div>
                    <UnitMissingDataBadge unit={u} role={user?.role} compact />
                    {formatLocation(u) && (
                      <div className="units-row-loc-mobile" title={formatLocation(u, { full: true })}>
                        {formatLocation(u)}
                      </div>
                    )}
                  </div>
                  <div className="units-row-loc-side" style={{ fontSize: 12, color: 'var(--muted)', textAlign: 'right', flexShrink: 0, maxWidth: 220, overflow: 'hidden' }}>
                    {formatLocation(u) && (
                      <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                           title={formatLocation(u, { full: true })}>
                        {formatLocation(u)}
                      </div>
                    )}
                  </div>
                  <div className="units-row-badge" style={{ flexShrink: 0 }}>
                    <Badge color={STATUS_COLOR[u.status]}>{STATUS_LABEL[u.status]}</Badge>
                  </div>
                  <span className="units-row-chev" style={{ color: 'var(--muted)', fontSize: 16, flexShrink: 0 }}>›</span>
                </div>
              )
            })}
          </div>
        )}

        {/* List — компактный список без фото */}
        {viewMode === 'list' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            {filtered.map(u => {
              const isWrittenOff = u.status === 'written_off' || u.misplaced
              const isSelected = selectedIds.has(u.id)
              return (
                <div key={u.id} onClick={() => selectionMode ? toggleSelection(u.id) : setCardId(u.id)} style={{
                  display: 'flex', alignItems: 'center', gap: 12, padding: '8px 12px',
                  background: isWrittenOff ? 'var(--bg-secondary)' : isSelected ? 'rgba(59,130,246,0.06)' : 'var(--card)',
                  borderRadius: 'var(--radius-btn)', cursor: 'pointer',
                  filter: isWrittenOff ? 'grayscale(1)' : 'none', opacity: isWrittenOff ? 0.6 : 1,
                }}>
                  {selectionMode && (
                    <div onClick={e => { e.stopPropagation(); toggleSelection(u.id) }} style={{
                      width: 20, height: 20, borderRadius: '50%', flexShrink: 0,
                      border: isSelected ? 'none' : '2px solid #ccc',
                      background: isSelected ? 'var(--accent)' : '#fff',
                      display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer',
                    }}>{isSelected && <span style={{ color: '#fff', fontSize: 12, fontWeight: 700, lineHeight: 1 }}>✓</span>}</div>
                  )}
                  {unitFund(u) === FUND_VALUABLE && <Star size={12} fill="var(--gold-500)" color="var(--gold-500)" style={{ flexShrink: 0 }} />}
                  <div style={{ flex: 1, minWidth: 0, fontSize: 13, fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', color: isWrittenOff ? 'var(--muted)' : 'var(--text)', textDecoration: isWrittenOff ? 'line-through' : 'none' }}>{u.name}</div>
                  {u.serial && <span style={{ fontSize: 12, color: 'var(--muted)', flexShrink: 0 }}>{u.serial}</span>}
                  <span style={{ fontSize: 12, color: 'var(--muted)', flexShrink: 0 }}>{categoryLabel(u.category)}</span>
                  {u.status === 'on_stock' && formatLocation(u) && (
                    <span style={{ fontSize: 11, color: 'var(--muted)', flexShrink: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 220 }}
                          title={formatLocation(u, { full: true })}>
                      {formatLocation(u)}
                    </span>
                  )}
                  <Badge color={STATUS_COLOR[u.status]}>{STATUS_LABEL[u.status]}</Badge>
                </div>
              )
            })}
          </div>
        )}
        {/* Floating action bar.
            На мобилке снизу есть .wl-mnav (~76px + safe-area, z-index: 200).
            Ставимся выше навбара через calc(...) и поднимаем z-index — иначе
            попап перекрывается. */}
        {selectionMode && (() => {
          const hasSel = selectedIds.size > 0
          const allSelected = filtered.length > 0 && filtered.length === selectedIds.size
          const actionsDisabled = !hasSel || bulkBgRunning
          return (
            <div style={{
              position: 'fixed',
              bottom: 'calc(76px + env(safe-area-inset-bottom, 0px) + 12px)',
              left: '50%', transform: 'translateX(-50%)', zIndex: 250,
              background: '#fff', borderRadius: 16, padding: '12px 20px',
              boxShadow: '0 4px 24px rgba(0,0,0,0.15)', display: 'flex', alignItems: 'center', gap: 14,
              border: '1px solid var(--border)',
              maxWidth: 'calc(100vw - 24px)',
            }}>
              <span style={{ fontSize: 14, fontWeight: 500, whiteSpace: 'nowrap' }}>Выбрано: {selectedIds.size}</span>
              <button onClick={toggleAll} disabled={bulkBgRunning || filtered.length === 0} style={{
                height: 34, padding: '0 14px', border: '1px solid var(--border)',
                borderRadius: 'var(--radius-btn)', fontSize: 13,
                cursor: (bulkBgRunning || filtered.length === 0) ? 'not-allowed' : 'pointer',
                background: 'var(--white)', color: 'var(--text)',
                opacity: (bulkBgRunning || filtered.length === 0) ? 0.6 : 1,
              }}>{allSelected ? 'Снять все' : 'Выбрать все'}</button>
              <button onClick={() => setShowBulkBgConfirm(true)} disabled={actionsDisabled} style={{
                height: 34, padding: '0 12px', border: '1px solid var(--border)',
                borderRadius: 'var(--radius-btn)', fontSize: 13,
                cursor: actionsDisabled ? 'not-allowed' : 'pointer',
                background: 'var(--white)', color: 'var(--text)', display: 'inline-flex',
                alignItems: 'center', gap: 6, opacity: actionsDisabled ? 0.5 : 1,
              }} title="Обелить фон у выбранных единиц">
                <Sparkles size={14} />
                {bulkBgRunning ? 'Обеляю…' : 'Обелить фон'}
              </button>
              {canMoveToProject && (
                <button onClick={() => setShowMoveToProject(true)} disabled={actionsDisabled} style={{
                  height: 34, padding: '0 12px', border: '1px solid var(--border)',
                  borderRadius: 'var(--radius-btn)', fontSize: 13,
                  cursor: actionsDisabled ? 'not-allowed' : 'pointer',
                  background: 'var(--white)', color: 'var(--text)', display: 'inline-flex',
                  alignItems: 'center', gap: 6, opacity: actionsDisabled ? 0.5 : 1,
                }} title="Переместить выбранные единицы на склад проекта">
                  <Boxes size={14} />
                  В проект
                </button>
              )}
              <button onClick={openBulkDeleteConfirm} disabled={actionsDisabled} style={{
                height: 34, padding: '0 14px', border: 'none',
                borderRadius: 'var(--radius-btn)', fontSize: 13,
                cursor: actionsDisabled ? 'not-allowed' : 'pointer',
                background: 'var(--red)', color: '#fff', fontWeight: 500,
                opacity: actionsDisabled ? 0.5 : 1,
              }}>Удалить</button>
            </div>
          )
        })()}
      </div>

      {/* Bulk delete confirm — обычный путь (выбрана не вся выборка) */}
      <ConfirmModal
        open={showBulkConfirm}
        message={`Удалить ${selectedIds.size} единиц?`}
        onConfirm={handleBulkDelete}
        onCancel={() => setShowBulkConfirm(false)}
      />

      {/* Удалить ВСЕ — трёхступенчатое подтверждение. Срабатывает когда
          выбрано всё видимое (selectedIds.size === filtered.length). */}
      <ConfirmModal
        open={bulkDeleteAllStep === 1}
        title="Удалить все выбранные?"
        message={`Будет удалено ${selectedIds.size} ед. — это все позиции в текущем списке.`}
        confirmLabel="Продолжить"
        onConfirm={() => setBulkDeleteAllStep(2)}
        onCancel={() => setBulkDeleteAllStep(0)}
      />
      <ConfirmModal
        open={bulkDeleteAllStep === 2}
        title="Внимание"
        message={`Вместе с единицами потеряются их фото, история и связи с выдачами. Восстановить будет невозможно.`}
        confirmLabel="Понимаю, дальше"
        onConfirm={() => setBulkDeleteAllStep(3)}
        onCancel={() => setBulkDeleteAllStep(0)}
      />
      <ConfirmModal
        open={bulkDeleteAllStep === 3}
        title="Последнее предупреждение"
        message={`Удалить ${selectedIds.size} ед. безвозвратно? Отменить это действие нельзя.`}
        confirmLabel="Удалить безвозвратно"
        onConfirm={handleBulkDelete}
        onCancel={() => setBulkDeleteAllStep(0)}
      />

      {/* Bulk regen-bg confirm modal */}
      <ConfirmModal
        open={showBulkBgConfirm}
        title={`Обелить фон у ${selectedIds.size} ед.`}
        message={'Уже обработанные фото пропустим. Обработка на сервере (~1–3 сек на фото), при большом наборе займёт несколько минут — не закрывайте вкладку.'}
        confirmLabel="Обелить"
        danger={false}
        onConfirm={handleBulkBg}
        onCancel={() => setShowBulkBgConfirm(false)}
      />

      {/* Add unit wizard — bottom-sheet на мобиле, центральная модалка на десктопе.
          Стиль соответствует Quick Action sheet («+» в нав-баре): лист
          выезжает снизу, ручка-полоска сверху, скруглены только верхние
          углы. На десктопе — обычная модалка по центру. */}
      {showAdd && (
        <>
          <style>{`
            @keyframes addUnitSheetFadeIn { from { opacity: 0; } to { opacity: 1; } }
            @keyframes addUnitSheetSlideUp {
              from { transform: translateY(100%); }
              to   { transform: translateY(0); }
            }
            .add-unit-overlay {
              position: fixed; inset: 0;
              background: rgba(0,0,0,0.5);
              backdrop-filter: blur(2px);
              z-index: 400;
              display: flex; align-items: flex-end; justify-content: center;
              animation: addUnitSheetFadeIn 0.18s ease-out;
            }
            .add-unit-sheet {
              background: #fff;
              width: 100%;
              border-radius: 18px 18px 0 0;
              padding: 6px 16px max(20px, env(safe-area-inset-bottom));
              max-height: 90vh;
              overflow-y: auto;
              -webkit-overflow-scrolling: touch;
              animation: addUnitSheetSlideUp 0.24s cubic-bezier(.22,.61,.36,1);
            }
            .add-unit-handle {
              width: 40px; height: 4px; border-radius: 4px;
              background: var(--border-strong, #D5D2CC);
              margin: 8px auto 14px;
            }
            .add-unit-content { padding: 0 4px 4px; }
            @media (min-width: 769px) {
              .add-unit-overlay { align-items: center; padding: 16px; }
              .add-unit-sheet {
                max-width: 520px;
                border-radius: var(--radius-card);
                padding: 24px;
                max-height: 92vh;
                animation: addUnitSheetFadeIn 0.18s ease-out;
              }
              .add-unit-handle { display: none; }
              .add-unit-content { padding: 0; }
            }
          `}</style>
          <div className="add-unit-overlay"
            onClick={() => setShowAdd(false)}>
            <div className="add-unit-sheet"
              onClick={e => e.stopPropagation()}>
              <div className="add-unit-handle" />
              <div className="add-unit-content">

            {/* Step indicator */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 20 }}>
              {[1,2,3].map(s => (
                <div key={s} style={{ display: 'flex', alignItems: 'center', flex: s < 3 ? 1 : 'none', gap: 6 }}>
                  <div style={{ width: 24, height: 24, borderRadius: '50%', background: addStep >= s ? 'var(--accent)' : 'var(--border)', color: addStep >= s ? '#fff' : 'var(--muted)', fontSize: 11, fontWeight: 600, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>{s}</div>
                  {s < 3 && <div style={{ flex: 1, height: 2, background: addStep > s ? 'var(--accent)' : 'var(--border)', borderRadius: 1 }} />}
                </div>
              ))}
            </div>

            {/* STEP 1 — Photos */}
            {addStep === 1 && (
              <>
                {recognizing || bgProgress ? (
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '48px 0', gap: 16 }}>
                    <div style={{ width: 48, height: 48, border: '3px solid var(--border)', borderTopColor: 'var(--accent)', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
                    {bgProgress ? (
                      <>
                        <div style={{ fontSize: 14, fontWeight: 500, color: 'var(--text)' }}>
                          {`Делаю белый фон ${bgProgress.idx}/${bgProgress.total}…`}
                        </div>
                        <div style={{ fontSize: 13, color: 'var(--muted)' }}>
                          {bgProgress.idx === 1
                            ? 'Первое фото — до 15 секунд (прогрев), дальше быстрее'
                            : 'Обработка на сервере, ~1–3 секунды на фото'}
                        </div>
                      </>
                    ) : (
                      <>
                        <div style={{ fontSize: 14, fontWeight: 500, color: 'var(--text)' }}>AI анализирует фото...</div>
                        <div style={{ fontSize: 13, color: 'var(--muted)' }}>Заполняем данные автоматически</div>
                      </>
                    )}
                    <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
                  </div>
                ) : (
                  <>
                    <div style={{ fontWeight: 600, fontSize: 16, marginBottom: 6 }}>Загрузите фото</div>
                    <div style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 12 }}>От 1 до 5 фото одного предмета (разные ракурсы). Видео — опционально.</div>

                    {/* Чекбокс «Белый фон» — opt-in, persist в localStorage. */}
                    <label style={{
                      display: 'flex', alignItems: 'center', gap: 10,
                      padding: '10px 12px', marginBottom: 16,
                      background: whiteBg ? 'var(--gold-50, #FAF6E8)' : 'var(--bg)',
                      border: `1px solid ${whiteBg ? 'var(--accent)' : 'var(--border)'}`,
                      borderRadius: 'var(--radius-btn)', cursor: 'pointer',
                      transition: 'background .15s, border-color .15s',
                    }}>
                      <input
                        type="checkbox"
                        checked={whiteBg}
                        onChange={toggleWhiteBg}
                        style={{ width: 18, height: 18, accentColor: 'var(--accent)', cursor: 'pointer' }}
                      />
                      <Sparkles size={16} color={whiteBg ? 'var(--accent)' : 'var(--muted)'} strokeWidth={1.6} />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>Сделать белый фон</div>
                        <div style={{ fontSize: 11, color: 'var(--muted)', lineHeight: 1.3 }}>
                          Удалит фон вокруг предмета. Обработка на сервере — 1–3 секунды на фото.
                        </div>
                      </div>
                    </label>

                    {outliers.size > 0 && (
                      <div style={{
                        background: 'var(--red-dim)', color: 'var(--red)',
                        border: '1px solid var(--red)', borderRadius: 'var(--radius-btn)',
                        padding: '10px 12px', marginBottom: 16, fontSize: 13, lineHeight: 1.4,
                      }}>
                        Загруженные фото относятся к разным предметам. Удалите лишние (подсвечены красным) и загрузите фотографии одного предмета.
                      </div>
                    )}

                    <div style={{ display: 'flex', gap: 10, marginBottom: 20, flexWrap: 'wrap' }}>
                      {photos.map((f, i) => {
                        const isOutlier = outliers.has(i)
                        const border = isOutlier ? '2px solid var(--red)' : '1px solid var(--border)'
                        return (
                        <div key={i} style={{ position: 'relative', width: 100, height: 100 }}>
                          {isVideoFile(f) ? (
                            <video src={URL.createObjectURL(f)} muted preload="metadata" style={{ width: 100, height: 100, objectFit: 'cover', borderRadius: 'var(--radius-btn)', border }} />
                          ) : (
                            <img src={URL.createObjectURL(f)} alt="" style={{ width: 100, height: 100, objectFit: 'cover', borderRadius: 'var(--radius-btn)', border }} />
                          )}
                          {isOutlier && (
                            <div style={{ position: 'absolute', bottom: 4, left: 4, right: 4, background: 'var(--red)', color: '#fff', fontSize: 10, fontWeight: 600, textAlign: 'center', borderRadius: 4, padding: '1px 0' }}>
                              Другой предмет
                            </div>
                          )}
                          <button onClick={() => { setPhotos(p => p.filter((_, j) => j !== i)); setOutliers(new Set()) }}
                            style={{ position: 'absolute', top: -6, right: -6, background: 'var(--red)', border: 'none', borderRadius: '50%', width: 20, height: 20, color: '#fff', fontSize: 12, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>×</button>
                        </div>
                      )})}
                      {photos.length < 5 && (
                        <>
                          <button onClick={() => fileRef.current?.click()}
                            style={{ width: 100, height: 100, borderRadius: 'var(--radius-btn)', border: '2px dashed var(--border)', background: 'var(--bg)', cursor: 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 4, color: 'var(--muted)', fontSize: 12 }}>
                            <span style={{ fontSize: 24 }}>+</span>
                            Файл
                          </button>
                          <button onClick={() => camRef.current?.click()}
                            style={{ width: 100, height: 100, borderRadius: 'var(--radius-btn)', border: '2px dashed var(--border)', background: 'var(--bg)', cursor: 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 4, color: 'var(--muted)', fontSize: 12 }}>
                            <Camera size={22} color="var(--muted)" strokeWidth={1.4} />
                            Камера
                          </button>
                          <button onClick={() => videoRef.current?.click()}
                            style={{ width: 100, height: 100, borderRadius: 'var(--radius-btn)', border: '2px dashed var(--accent)', background: 'var(--bg)', cursor: 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 4, color: 'var(--accent)', fontSize: 12 }}>
                            <Film size={22} color="var(--muted)" strokeWidth={1.4} />
                            Видео
                          </button>
                        </>
                      )}
                    </div>
                    <input ref={fileRef} type="file" accept="image/*,video/mp4,video/webm,video/quicktime" multiple style={{ display: 'none' }} onChange={onFilesSelected} />
                    <input ref={camRef} type="file" accept="image/*" capture="environment" style={{ display: 'none' }} onChange={onFilesSelected} />
                    <input ref={videoRef} type="file" accept="video/*" capture="environment" style={{ display: 'none' }} onChange={onFilesSelected} />

                    <div style={{ display: 'flex', gap: 8 }}>
                      <Button variant="secondary" fullWidth onClick={() => setShowAdd(false)}>Отмена</Button>
                      <Button fullWidth disabled={photos.filter(f => !isVideoFile(f)).length < 1} onClick={handlePhotosReady}>
                        {photos.filter(f => !isVideoFile(f)).length < 1 ? 'Добавь фото' : 'Готово'}
                      </Button>
                    </div>
                  </>
                )}
              </>
            )}

            {/* STEP 2 — Description: photos, category, name, description, size (if clothing), qty */}
            {addStep === 2 && (
              <>
                <div style={{ fontWeight: 600, fontSize: 16, marginBottom: 6 }}>Описание единицы</div>
                <div style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 16 }}>Проверьте и отредактируйте</div>

                <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
                  {photos.map((f, i) => (
                    isVideoFile(f) ? (
                      <video key={i} src={URL.createObjectURL(f)} muted style={{ width: 56, height: 56, objectFit: 'cover', borderRadius: 'var(--radius-btn)', border: '1px solid var(--border)' }} />
                    ) : (
                      <img key={i} src={URL.createObjectURL(f)} alt="" style={{ width: 56, height: 56, objectFit: 'cover', borderRadius: 'var(--radius-btn)', border: '1px solid var(--border)' }} />
                    )
                  ))}
                </div>

                <FL>Категория *</FL>
                <select value={form.category} onChange={e => {
                  const next = e.target.value
                  setForm(f => ({ ...f, category: next, dimensions: '' }))
                  setSizeType(IS_SHOES_CAT(next) ? 'shoe' : 'clothing')
                  setSizeRegion('ru')
                }}
                  style={{ width: '100%', height: 38, padding: '0 10px', border: '1px solid var(--border)', borderRadius: 'var(--radius-btn)', fontSize: 13, marginBottom: 12, background: 'var(--white)' }}>
                  {ALL_CATEGORIES.map(c => <option key={c} value={c}>{categoryLabel(c)}</option>)}
                </select>

                <FL>Название *</FL>
                <FI value={form.name} onChange={v => setForm(f => ({ ...f, name: v }))} placeholder="Кресло Честерфилд" />

                <FL>Комментарий</FL>
                <textarea value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} placeholder="Цвет, состояние, материал, особенности..."
                  style={{ width: '100%', height: 72, padding: '8px 10px', border: '1px solid var(--border)', borderRadius: 'var(--radius-btn)', fontSize: 13, resize: 'vertical', marginBottom: 12, fontFamily: 'inherit' }} />

                {IS_CLOTHING_CAT(form.category) && (
                  <>
                    <FL>Размер</FL>
                    {!IS_SHOES_CAT(form.category) && (
                      <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
                        <button onClick={() => { setSizeType('clothing'); setForm(f => ({ ...f, dimensions: '' })) }}
                          style={{ padding: '4px 12px', fontSize: 12, borderRadius: 'var(--radius-btn)', border: '1px solid var(--border)', background: sizeType === 'clothing' ? 'var(--accent)' : 'var(--white)', color: sizeType === 'clothing' ? '#fff' : 'var(--text)', cursor: 'pointer' }}>Одежда</button>
                        <button onClick={() => { setSizeType('shoe'); setForm(f => ({ ...f, dimensions: '' })) }}
                          style={{ padding: '4px 12px', fontSize: 12, borderRadius: 'var(--radius-btn)', border: '1px solid var(--border)', background: sizeType === 'shoe' ? 'var(--accent)' : 'var(--white)', color: sizeType === 'shoe' ? '#fff' : 'var(--text)', cursor: 'pointer' }}>Обувь</button>
                      </div>
                    )}
                    {sizeType === 'clothing' && (
                      <div style={{ display: 'inline-flex', gap: 0, marginBottom: 10, border: '1px solid var(--border)', borderRadius: 'var(--radius-btn)', overflow: 'hidden', background: 'var(--bg-secondary)' }}>
                        <button onClick={() => { setSizeRegion('ru'); setForm(f => ({ ...f, dimensions: '' })) }}
                          style={{ padding: '5px 14px', fontSize: 11.5, fontWeight: 600, border: 'none', background: sizeRegion === 'ru' ? 'var(--white)' : 'transparent', color: sizeRegion === 'ru' ? 'var(--gold-700, var(--gold-600))' : 'var(--muted)', cursor: 'pointer', boxShadow: sizeRegion === 'ru' ? '0 1px 2px rgba(0,0,0,0.06)' : 'none' }}>RU</button>
                        <button onClick={() => { setSizeRegion('int'); setForm(f => ({ ...f, dimensions: '' })) }}
                          style={{ padding: '5px 14px', fontSize: 11.5, fontWeight: 600, border: 'none', background: sizeRegion === 'int' ? 'var(--white)' : 'transparent', color: sizeRegion === 'int' ? 'var(--gold-700, var(--gold-600))' : 'var(--muted)', cursor: 'pointer', boxShadow: sizeRegion === 'int' ? '0 1px 2px rgba(0,0,0,0.06)' : 'none' }}>INT</button>
                      </div>
                    )}
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 12 }}>
                      {(sizeType === 'shoe'
                        ? SHOE_SIZES
                        : (sizeRegion === 'ru' ? CLOTHING_SIZES_RU : CLOTHING_SIZES_INT)
                      ).map(s => (
                        <button key={s} onClick={() => setForm(f => ({ ...f, dimensions: s }))}
                          style={{ padding: '6px 12px', fontSize: 12, borderRadius: 'var(--radius-btn)', border: '1px solid var(--border)', background: form.dimensions === s ? 'var(--accent)' : 'var(--white)', color: form.dimensions === s ? '#fff' : 'var(--text)', cursor: 'pointer', fontWeight: form.dimensions === s ? 600 : 400 }}>{s}</button>
                      ))}
                    </div>
                  </>
                )}

                <FL>Количество</FL>
                <FI type="number" value={form.qty} onChange={v => setForm(f => ({ ...f, qty: v }))} placeholder="1" />

                <div style={{ display: 'flex', gap: 8 }}>
                  <Button variant="secondary" fullWidth onClick={() => setAddStep(1)}>Назад</Button>
                  <Button fullWidth disabled={!form.name.trim() || !form.category} onClick={() => setAddStep(3)}>Готово</Button>
                </div>
              </>
            )}

            {/* STEP 3 — Source, cost, warehouse */}
            {addStep === 3 && (
              <>
                <div style={{ fontWeight: 600, fontSize: 16, marginBottom: 6 }}>Размещение</div>
                <div style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 16 }}>Источник и место хранения</div>

                {canSeeSource && (
                  <>
                    <FL>Источник</FL>
                    <select value={form.source} onChange={e => setForm(f => ({ ...f, source: e.target.value }))}
                      style={{ width: '100%', height: 38, padding: '0 10px', border: '1px solid var(--border)', borderRadius: 'var(--radius-btn)', fontSize: 13, marginBottom: 12, background: 'var(--white)' }}>
                      <option value="покупка">Покупка</option>
                      <option value="дарение">Дарение</option>
                      <option value="аренда">Аренда</option>
                    </select>
                  </>
                )}

                {(isDirector || user?.role === 'producer') && (
                  <>
                    <FL>Стоимость единицы, руб {isDirector ? '*' : ''}</FL>
                    <FI type="number" value={form.valuation} onChange={v => setForm(f => ({ ...f, valuation: v }))} placeholder="0.00" />
                  </>
                )}

                <FL>Временное понятие</FL>
                <FI value={form.period} onChange={v => setForm(f => ({ ...f, period: v }))} placeholder="Советское, XVIII век, современное..." />

                {(() => {
                  // Иерархия выбора места: Склад → Зал → Секция (полка/вешалка/
                  // место) → Ячейка. Идентично логике UnitCardModal Cell-panel:
                  // hall = section type='hall', secs внутри hall имеют
                  // parent_section_id=hall.id. Для legacy-складов без залов
                  // показываем секции напрямую без шага зал.
                  const halls = sections.filter(s => s.type === 'hall' && !s.parent_section_id)
                  const legacySections = sections.filter(s => s.type !== 'hall' && !s.parent_section_id)
                  const hasLegacy = legacySections.length > 0
                  const sectionsInHall = selHall
                    ? sections.filter(s => String(s.parent_section_id) === String(selHall) && s.type !== 'hall')
                    : legacySections
                  const SECTION_TYPE_LABEL = { shelf: 'Полка', hanger: 'Вешалка', place: 'Место' }
                  const inputStyle = { width: '100%', height: 38, padding: '0 10px', border: '1px solid var(--border)', borderRadius: 'var(--radius-btn)', fontSize: 13, background: 'var(--white)' }
                  return (
                    <>
                      <FL>Склад</FL>
                      <select
                        value={form.warehouse_id}
                        onChange={e => { setForm(f => ({ ...f, warehouse_id: e.target.value, cell_id: '' })); setSelHall(''); setSelSection('') }}
                        style={{ ...inputStyle, marginBottom: 10 }}
                      >
                        <option value="">— Склад —</option>
                        {warehouses.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
                      </select>
                      {form.warehouse_id && (halls.length > 0 || hasLegacy) && (
                        <>
                          <FL>Зал</FL>
                          <select value={selHall} onChange={e => setSelHall(e.target.value)} style={{ ...inputStyle, marginBottom: 10 }}>
                            <option value="">{hasLegacy ? 'Без зала' : '— Зал —'}</option>
                            {halls.map(h => <option key={h.id} value={h.id}>{h.name}</option>)}
                          </select>
                        </>
                      )}
                      {form.warehouse_id && sectionsInHall.length > 0 && (
                        <>
                          <FL>Полка / Вешалка / Место</FL>
                          <select value={selSection} onChange={e => setSelSection(e.target.value)} style={{ ...inputStyle, marginBottom: 12 }}>
                            <option value="">— Полка / Вешалка / Место —</option>
                            {sectionsInHall.map(sec => (
                              <option key={sec.id} value={sec.id}>
                                {(SECTION_TYPE_LABEL[sec.type] || sec.type)} · {sec.name}
                              </option>
                            ))}
                          </select>
                        </>
                      )}
                      {form.warehouse_id && halls.length === 0 && !hasLegacy && (
                        <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 12 }}>
                          На складе ещё нет залов и секций. Можно сохранить без места — добавить позже.
                        </div>
                      )}
                      {form.warehouse_id && selHall && sectionsInHall.length === 0 && (
                        <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 12 }}>
                          В этом зале нет секций. Сохраните без места — добавите позже.
                        </div>
                      )}
                    </>
                  )
                })()}

                {addError && <div style={{ color: 'var(--red)', fontSize: 13, marginBottom: 12 }}>{addError}</div>}

                <div style={{ display: 'flex', gap: 8 }}>
                  <Button variant="secondary" fullWidth onClick={() => setAddStep(2)}>Назад</Button>
                  <Button fullWidth disabled={(isDirector && !form.valuation) || adding} onClick={handleAdd}>
                    {adding ? 'Сохранение...' : 'Добавить'}
                  </Button>
                </div>
              </>
            )}
              </div>
            </div>
          </div>
        </>
      )}
      {cardId && <UnitCardModal unitId={cardId} onClose={() => {
        setCardId(null)
        if (searchParams.get('open')) {
          const next = new URLSearchParams(searchParams)
          next.delete('open')
          setSearchParams(next, { replace: true })
        }
      }} onChanged={() => {
        unitsApi.list().then(d => setAllUnits(d.units || [])).catch(() => {})
      }} />}

      <MoveToProjectModal
        open={showMoveToProject}
        count={selectedIds.size}
        unitIds={selectedIds}
        onCancel={() => setShowMoveToProject(false)}
        onSuccess={handleMoveToProjectSuccess}
      />
    </Layout>
  )
}

function FL({ children }) {
  return <div style={{ fontSize: 12, fontWeight: 500, marginBottom: 4, color: 'var(--muted)' }}>{children}</div>
}
function FI({ value, onChange, placeholder, type = 'text' }) {
  return (
    <input type={type} value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder}
      style={{ width: '100%', height: 38, padding: '0 10px', border: '1px solid var(--border)', borderRadius: 'var(--radius-btn)', fontSize: 13, marginBottom: 12, background: 'var(--white)', outline: 'none', boxSizing: 'border-box' }} />
  )
}

function Select({ value, onChange, options }) {
  return (
    <select value={value} onChange={e => onChange(e.target.value)} style={{
      height: 36, padding: '0 10px', border: '1px solid var(--border)',
      borderRadius: 'var(--radius-btn)', fontSize: 13, background: 'var(--white)', cursor: 'pointer', color: 'var(--text)',
    }}>
      {options.map(o => <option key={o}>{o}</option>)}
    </select>
  )
}
