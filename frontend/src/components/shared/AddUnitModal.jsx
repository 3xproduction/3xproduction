// Модалка 3-шагового визарда добавления единицы.
// Вынесена из UnitsPage, чтобы её можно было открывать с любой страницы
// (например, с карты склада — поверх самой карты, а не каталога).

import { useState, useEffect, useRef } from 'react'
import { Camera, Film, Sparkles, Receipt, Gift, AlertTriangle } from 'lucide-react'
import Button from './Button'
import { ALL_CATEGORIES, categoryLabel } from '../../constants/categories'
import { CLOTHING_SIZES_INT, CLOTHING_SIZES_RU, SHOE_SIZES, IS_SIZED_CAT, IS_SHOES_CAT } from '../../constants/clothingSizes'
import { units as unitsApi, warehouses as warehousesApi, projectUnits as projectUnitsApi, adminUnits as adminUnitsApi } from '../../services/api'
import { useAuth } from '../../hooks/useAuth'
import { useToast } from './Toast'
import { removeBgWhite, preloadBgModel, describeBgError, describeBgSkipped } from '../../utils/removeBg'
import { findSimilarUnits } from '../../utils/similarUnits'

const EMPTY_FORM = {
  name: '', category: ALL_CATEGORIES[0], dimensions: '', description: '',
  source: 'покупка', qty: 1, warehouse_id: '', cell_id: '', period: '', valuation: '',
  // project-mode fields
  purchase_mode: 'purchased', // 'purchased' | 'own'
  purchase_price: '', purchase_date: new Date().toISOString().slice(0, 10), vendor: '',
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

function isVideoFile(file) { return file.type?.startsWith('video/') }

export default function AddUnitModal({
  open,
  onClose,
  onCreated,           // (unit) => void, вызывается после успешного создания
  prefillCellId = '',
  prefillWarehouseId = '',
  mode = 'warehouse',  // 'warehouse' | 'project' | 'admin' — куда сохраняем
}) {
  const { user } = useAuth()
  const toast = useToast()
  const isProjectMode = mode === 'project'
  const isAdminMode = mode === 'admin'
  const isDetachedStockMode = isProjectMode || isAdminMode
  const isCostumeDesigner = user?.role === 'costume_designer'
  const hideProjectPurchaseProof = isProjectMode && isCostumeDesigner
  const isDirector = ['warehouse_director', 'warehouse_deputy'].includes(user?.role)
  const canSeeSource = ['warehouse_director', 'warehouse_deputy', 'producer'].includes(user?.role)

  // Порядок экранов визарда. Для площадки (project) — источник идёт ПЕРВЫМ
  // шагом, остальные в той же последовательности. Админка и обычный склад
  // не меняются.
  const SCREENS = isProjectMode
    ? ['source', 'photos', 'desc']
    : (isAdminMode ? ['photos', 'desc', 'source'] : ['photos', 'desc', 'place'])

  const [addStep, setAddStep] = useState(1)
  const screen = SCREENS[addStep - 1]
  const [form, setForm] = useState(EMPTY_FORM)
  const [photos, setPhotos] = useState([])
  const [sizeType, setSizeType] = useState('clothing')
  const [sizeRegion, setSizeRegion] = useState('ru') // 'ru' | 'int' — российская или международная сетка одежды
  const [adding, setAdding] = useState(false)
  const [addError, setAddError] = useState('')
  const [recognizing, setRecognizing] = useState(false)
  const [outliers, setOutliers] = useState(new Set())
  const [warehouses, setWarehouses] = useState([])
  const [cells, setCells] = useState([])
  const [receiptFile, setReceiptFile] = useState(null)
  const [receiptPreview, setReceiptPreview] = useState('')
  // Похожие единицы с общего склада — предупреждение о возможном дубле
  // (только для площадки при «С общего склада»).
  const [similar, setSimilar] = useState([])
  const [similarLoading, setSimilarLoading] = useState(false)
  const fileRef = useRef()
  const camRef = useRef()
  const videoRef = useRef()
  const receiptRef = useRef()

  // «Белый фон» — opt-in. Persist в localStorage чтобы юзер не переключал каждый раз.
  const [whiteBg, setWhiteBg] = useState(() => {
    try { return localStorage.getItem('whiteBgEnabled') === '1' } catch { return false }
  })
  // Прогресс удаления фона: { idx, total, phase, percent? }
  const [bgProgress, setBgProgress] = useState(null)

  function toggleWhiteBg() {
    const next = !whiteBg
    setWhiteBg(next)
    try { localStorage.setItem('whiteBgEnabled', next ? '1' : '0') } catch { /* localStorage can be unavailable in private mode */ }
    // Прогрев модели в фоне — чтобы первое фото обрабатывалось без ожидания.
    if (next) preloadBgModel().catch(() => {})
  }

  // Reset и префилл каждый раз при открытии.
  useEffect(() => {
    if (!open) return
    const nextForm = { ...EMPTY_FORM }
    if (prefillWarehouseId) nextForm.warehouse_id = prefillWarehouseId
    if (prefillCellId) nextForm.cell_id = prefillCellId
    setForm(nextForm)
    setPhotos([])
    setOutliers(new Set())
    setAddError('')
    setAddStep(1)
    setSizeType('clothing')
    setSizeRegion('ru')
    setReceiptFile(null)
    setReceiptPreview('')
    setSimilar([])
    setSimilarLoading(false)
    if (!isDetachedStockMode || isAdminMode) {
      warehousesApi.list().then(d => setWarehouses(d.warehouses || [])).catch(() => {})
    }
  }, [open, prefillCellId, prefillWarehouseId, isDetachedStockMode, isAdminMode])

  useEffect(() => {
    if (!form.warehouse_id) { setCells([]); return }
    warehousesApi.cells(form.warehouse_id).then(d => {
      const allCells = (d.sections || []).flatMap(s => s.cells || [])
      setCells(allCells)
    }).catch(() => setCells([]))
  }, [form.warehouse_id])

  async function onFilesSelected(e) {
    const files = Array.from(e.target.files)
    // Сжимаем картинки сразу (видео — пропускаем).
    const compressed = await Promise.all(files.map(f => isVideoFile(f) ? f : compressImage(f)))

    let processed = compressed
    if (whiteBg) {
      // Удаление фона — последовательно с прогрессом, видео пропускаем.
      const onlyImgIdx = compressed.map((f, i) => isVideoFile(f) ? -1 : i).filter(i => i !== -1)
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

    setPhotos(prev => [...prev, ...processed].slice(0, 5))
    setOutliers(new Set())
  }

  async function handlePhotosReady() {
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
        const nextCat = ALL_CATEGORIES.includes(result.category) ? result.category : form.category
        setForm(f => {
          const cat = ALL_CATEGORIES.includes(result.category) ? result.category : f.category
          if (cat !== f.category) {
            // Синхронизируем тип размерной сетки с распознанной категорией.
            setSizeType(IS_SHOES_CAT(cat) ? 'shoe' : 'clothing')
            setSizeRegion('ru')
          }
          return {
            ...f,
            name: result.name || f.name,
            category: cat,
            period: result.period || f.period,
            description: result.description || f.description,
          }
        })
        toast?.('AI заполнил поля — проверьте и отредактируйте', 'success')
        // Для площадки при «С общего склада» — показать похожие единицы
        // (проверка на дубль), по принципу пакетного пополнения.
        if (isProjectMode && form.purchase_mode === 'own' && result.name) {
          setSimilarLoading(true)
          findSimilarUnits({ name: result.name, category: nextCat })
            .then(list => setSimilar(list))
            .catch(() => setSimilar([]))
            .finally(() => setSimilarLoading(false))
        }
      } else {
        toast?.('AI нужна ещё попытка или заполните вручную', 'error')
      }
    } catch (err) {
      toast?.(err.message || 'AI нужна ещё попытка или заполните вручную', 'error')
    } finally {
      setRecognizing(false)
      setAddStep(s => Math.min(s + 1, SCREENS.length))
    }
  }

  async function handleAdd() {
    if (!form.name.trim()) return
    if (!isDetachedStockMode && isDirector && !form.valuation) { setAddError('Укажите стоимость единицы'); return }
    if (isProjectMode && form.purchase_mode === 'purchased') {
      if (!form.purchase_price) { setAddError('Укажите цену покупки'); return }
      if (!hideProjectPurchaseProof && !receiptFile) { setAddError('Прикрепите фото чека'); return }
    }
    setAdding(true)
    setAddError('')
    try {
      let data, unitId
      if (isDetachedStockMode) {
        // 1. Загрузка чека (для purchased). В админке чек опциональный.
        let receiptUrl = null
        if (form.purchase_mode === 'purchased' && receiptFile && !hideProjectPurchaseProof) {
          const fd = new FormData()
          fd.append('receipt', receiptFile)
          const r = isAdminMode
            ? await adminUnitsApi.uploadReceipt(fd)
            : await projectUnitsApi.uploadReceipt(fd)
          receiptUrl = r.url
        }
        // 2. Создание единицы в отдельном каталоге без физической полки.
        const purchasePrice = form.purchase_price ? Number(form.purchase_price) : null
        const payload = {
          name: form.name,
          category: form.category,
          dimensions: form.dimensions || null,
          description: form.description || null,
          qty: Number(form.qty) || 1,
          period: form.period || null,
          source: form.purchase_mode === 'purchased' ? 'Покупка' : 'С общего склада',
          purchased: form.purchase_mode === 'purchased',
          purchase_price: form.purchase_mode === 'purchased' ? purchasePrice : null,
          purchase_date:  form.purchase_mode === 'purchased' ? form.purchase_date : null,
          vendor:         form.purchase_mode === 'purchased' && !hideProjectPurchaseProof ? (form.vendor || null) : null,
          receipt_url:    receiptUrl,
          valuation: form.purchase_mode === 'purchased' && purchasePrice ? purchasePrice : null,
        }
        data = isAdminMode ? await adminUnitsApi.create(payload) : await projectUnitsApi.create(payload)
        unitId = data.unit?.id
      } else {
        const createUnit = async () => unitsApi.create({
          name: form.name,
          category: form.category,
          dimensions: form.dimensions || null,
          description: form.description || null,
          source: canSeeSource ? form.source : null,
          qty: Number(form.qty) || 1,
          valuation: form.valuation ? Number(form.valuation) : null,
          warehouse_id: form.warehouse_id || null,
          cell_id: form.cell_id || null,
          period: form.period || null,
        })
        try { data = await createUnit() }
        catch { data = await createUnit() }
        unitId = data.unit?.id
      }

      let photoErrors = 0
      if (unitId && photos.length > 0) {
        for (const file of photos) {
          const fd = new FormData()
          fd.append('photos', file)
          try { await unitsApi.uploadPhoto(unitId, fd) }
          catch { photoErrors++ }
        }
      }
      if (photoErrors > 0) {
        toast?.(`Единица создана, но ${photoErrors} фото не загрузилось`, 'error')
      } else if (isAdminMode) {
        toast?.('Добавлено в Админку', 'success')
      } else if (isProjectMode) {
        toast?.('Добавлено на склад проекта', 'success')
      } else {
        toast?.(isDirector ? 'Позиция добавлена на склад' : 'Позиция отправлена на утверждение', 'success')
      }
      onCreated?.(data.unit)
      onClose?.()
    } catch (err) {
      setAddError(err.message || 'Ошибка')
    } finally {
      setAdding(false)
    }
  }

  function onReceiptSelected(e) {
    const f = e.target.files?.[0]
    if (!f) return
    setReceiptFile(f)
    setReceiptPreview(URL.createObjectURL(f))
  }

  if (!open) return null

  return (
    <div
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 500, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}
      onClick={onClose}
    >
      <div style={{ background: 'var(--white)', borderRadius: 'var(--radius-card)', padding: 24, maxWidth: 480, width: '100%', maxHeight: '92vh', overflowY: 'auto' }}
        onClick={e => e.stopPropagation()}>

        {/* Step indicator */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 20 }}>
          {[1,2,3].map(s => (
            <div key={s} style={{ display: 'flex', alignItems: 'center', flex: s < 3 ? 1 : 'none', gap: 6 }}>
              <div style={{ width: 24, height: 24, borderRadius: '50%', background: addStep >= s ? 'var(--accent)' : 'var(--border)', color: addStep >= s ? '#fff' : 'var(--muted)', fontSize: 11, fontWeight: 600, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>{s}</div>
              {s < 3 && <div style={{ flex: 1, height: 2, background: addStep > s ? 'var(--accent)' : 'var(--border)', borderRadius: 1 }} />}
            </div>
          ))}
        </div>

        {/* Photos screen */}
        {screen === 'photos' && (
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
                    )
                  })}
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
              </>
            )}
          </>
        )}

        {/* Description screen */}
        {screen === 'desc' && (
          <>
            <div style={{ fontWeight: 600, fontSize: 16, marginBottom: 6 }}>Описание единицы</div>
            <div style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 16 }}>Проверьте и отредактируйте</div>

            {isProjectMode && form.purchase_mode === 'own' && (similarLoading || similar.length > 0) && (
              <div style={{
                background: 'var(--gold-100, #FFF7E0)', border: '1px solid var(--gold-500, #C9A55C)',
                borderRadius: 'var(--radius-card)', padding: 12, marginBottom: 16,
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, fontWeight: 600, color: 'var(--gold-600, #C9A55C)', marginBottom: similar.length > 0 ? 10 : 0 }}>
                  <AlertTriangle size={15} />
                  {similarLoading ? 'Проверяю, нет ли такого на общем складе…' : 'Похоже, такое уже есть на общем складе — проверьте, не дубль ли это'}
                </div>
                {similar.length > 0 && (
                  <div style={{ display: 'flex', gap: 8, overflowX: 'auto' }}>
                    {similar.map(u => (
                      <div key={u.id} style={{ width: 92, flexShrink: 0 }}>
                        <div style={{ width: 92, height: 92, borderRadius: 'var(--radius-btn)', overflow: 'hidden', border: '1px solid var(--border)', background: 'var(--bg)' }}>
                          {u.photo_url
                            ? <img src={u.photo_url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                            : <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, color: 'var(--muted)' }}>нет фото</div>}
                        </div>
                        <div style={{ fontSize: 11, color: 'var(--text)', marginTop: 4, lineHeight: 1.25, overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>{u.name}</div>
                        <div style={{ fontSize: 10, color: 'var(--muted)' }}>{u._photo_match_label}</div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

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
              // Для обуви сразу переключаемся на сетку обуви — Одежда/Обувь
              // переключатель в этой категории не имеет смысла. Для остальных
              // sized-категорий (одежда, костюмы, аксессуары) — сетка одежды.
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

            {IS_SIZED_CAT(form.category) && (
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

            {isProjectMode && (
              <>
                {form.purchase_mode === 'purchased' && (
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                    <div>
                      <FL>Цена покупки, ₽ *</FL>
                      <FI type="number" value={form.purchase_price} onChange={v => setForm(f => ({ ...f, purchase_price: v }))} placeholder="1450" />
                    </div>
                    <div>
                      <FL>Дата покупки</FL>
                      <input type="date" value={form.purchase_date} onChange={e => setForm(f => ({ ...f, purchase_date: e.target.value }))}
                        style={{ width: '100%', height: 38, padding: '0 10px', border: '1px solid var(--border)', borderRadius: 'var(--radius-btn)', fontSize: 13, background: 'var(--white)', boxSizing: 'border-box', marginBottom: 12 }} />
                    </div>
                  </div>
                )}
                <FL>Временное понятие</FL>
                <FI value={form.period} onChange={v => setForm(f => ({ ...f, period: v }))} placeholder="Советское, XVIII век, современное..." />
              </>
            )}
          </>
        )}

        {/* Placement screen (обычный склад) */}
        {screen === 'place' && !isDetachedStockMode && (
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

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 12 }}>
              <div>
                <FL>Склад</FL>
                <select value={form.warehouse_id} onChange={e => setForm(f => ({ ...f, warehouse_id: e.target.value, cell_id: '' }))}
                  style={{ width: '100%', height: 38, padding: '0 10px', border: '1px solid var(--border)', borderRadius: 'var(--radius-btn)', fontSize: 13, background: 'var(--white)' }}>
                  <option value="">-- не выбран --</option>
                  {warehouses.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
                </select>
              </div>
              <div>
                <FL>Полка</FL>
                <select value={form.cell_id} onChange={e => setForm(f => ({ ...f, cell_id: e.target.value }))}
                  disabled={!form.warehouse_id || cells.length === 0}
                  style={{ width: '100%', height: 38, padding: '0 10px', border: '1px solid var(--border)', borderRadius: 'var(--radius-btn)', fontSize: 13, background: 'var(--white)' }}>
                  <option value="">-- не выбрана --</option>
                  {cells.map(c => <option key={c.id} value={c.id}>{c.custom_name || c.code}</option>)}
                </select>
              </div>
            </div>

          </>
        )}

        {/* Source screen (площадка / админка) */}
        {screen === 'source' && isDetachedStockMode && (
          <>
            <div style={{ fontWeight: 600, fontSize: 16, marginBottom: 6 }}>Источник</div>
            <div style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 16 }}>
              {isAdminMode ? 'Покупка для административного цеха или запас без чека' : 'Куплено для проекта или с общего склада'}
            </div>

            <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
              {[
                { k: 'purchased', icon: <Receipt size={14} />, label: isAdminMode ? 'Куплено в Админку' : 'Куплено для проекта', hint: isAdminMode ? 'Чек можно приложить' : 'С чеком' },
                { k: 'own',       icon: <Gift size={14} />,    label: isAdminMode ? 'Запас без покупки' : 'С общего склада', hint: 'Без чека' },
              ].map(opt => (
                <button key={opt.k} onClick={() => setForm(f => ({ ...f, purchase_mode: opt.k }))}
                  style={{
                    flex: 1, padding: '10px 12px', borderRadius: 'var(--radius-btn)',
                    border: form.purchase_mode === opt.k ? '1.5px solid var(--accent)' : '1px solid var(--border)',
                    background: form.purchase_mode === opt.k ? 'var(--gold-50, #FAF6E8)' : 'var(--white)',
                    textAlign: 'left', cursor: 'pointer',
                  }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontWeight: 600, fontSize: 13 }}>
                    {opt.icon} {opt.label}
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>{opt.hint}</div>
                </button>
              ))}
            </div>

            {form.purchase_mode === 'purchased' && (isAdminMode || !hideProjectPurchaseProof) && (
              <div style={{ background: 'var(--bg)', borderRadius: 'var(--radius-btn)', padding: 12, marginBottom: 12 }}>
                {isAdminMode && (
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 10 }}>
                    <div>
                      <FL>Цена покупки, ₽</FL>
                      <FI type="number" value={form.purchase_price} onChange={v => setForm(f => ({ ...f, purchase_price: v }))} placeholder="1450" />
                    </div>
                    <div>
                      <FL>Дата покупки</FL>
                      <input type="date" value={form.purchase_date} onChange={e => setForm(f => ({ ...f, purchase_date: e.target.value }))}
                        style={{ width: '100%', height: 38, padding: '0 10px', border: '1px solid var(--border)', borderRadius: 'var(--radius-btn)', fontSize: 13, background: 'var(--white)', boxSizing: 'border-box' }} />
                    </div>
                  </div>
                )}
                {!hideProjectPurchaseProof && (
                  <>
                    <FL>Магазин / поставщик</FL>
                    <FI value={form.vendor} onChange={v => setForm(f => ({ ...f, vendor: v }))} placeholder="Леруа Мерлен" />
                    <FL>Фото чека {isAdminMode ? '' : '*'}</FL>
                    {receiptPreview ? (
                      <div style={{ position: 'relative', display: 'inline-block', marginBottom: 4 }}>
                        <img src={receiptPreview} alt="" style={{ maxWidth: 140, maxHeight: 140, borderRadius: 8, border: '1px solid var(--border)' }} />
                        <button onClick={() => { setReceiptFile(null); setReceiptPreview('') }}
                          style={{ position: 'absolute', top: -6, right: -6, width: 22, height: 22, borderRadius: '50%',
                            border: 'none', background: 'var(--red)', color: '#fff', cursor: 'pointer' }}>×</button>
                      </div>
                    ) : (
                      <button onClick={() => receiptRef.current?.click()}
                        style={{ padding: '10px 16px', borderRadius: 8, border: '1.5px dashed var(--border)',
                          background: 'var(--white)', cursor: 'pointer', fontSize: 13 }}>
                        📷 Прикрепить чек
                      </button>
                    )}
                    <input ref={receiptRef} type="file" accept="image/*" capture="environment" style={{ display: 'none' }} onChange={onReceiptSelected} />
                  </>
                )}
              </div>
            )}

            {isAdminMode && (
              <>
                <FL>Адрес хранения</FL>
                <select
                  value={warehouses.some(w => w.name === form.period) ? form.period : ''}
                  onChange={e => setForm(f => ({ ...f, period: e.target.value }))}
                  style={{ width: '100%', height: 38, padding: '0 10px', border: '1px solid var(--border)', borderRadius: 'var(--radius-btn)', fontSize: 13, marginBottom: 8, background: 'var(--white)' }}
                >
                  <option value="">Вписать свой адрес</option>
                  {warehouses.map(w => <option key={w.id} value={w.name}>{w.name}</option>)}
                </select>
                <FI value={form.period} onChange={v => setForm(f => ({ ...f, period: v }))} placeholder="Например: офис, шкаф реквизита, склад на площадке" />
              </>
            )}
            {/* Для площадки «Временное понятие» и цена/дата покупки — на шаге
                «Описание» (шаг 3): период заполняет AI, цену удобнее править
                рядом с деталями. */}
          </>
        )}

        {/* Shared bottom action bar — навигация зависит от позиции экрана */}
        {!recognizing && !bgProgress && (() => {
          const isFirstScreen = addStep === 1
          const isLastScreen = addStep === SCREENS.length
          const photosCount = photos.filter(f => !isVideoFile(f)).length
          const submitDisabled = adding
            || (!isDetachedStockMode && isDirector && !form.valuation)
            || (isProjectMode && form.purchase_mode === 'purchased'
                && (!form.purchase_price || (!hideProjectPurchaseProof && !receiptFile)))
          const nextDisabled =
            (screen === 'desc' && (!form.name.trim() || !form.category))
            // Цена покупки переехала на шаг «Описание», поэтому со шага
            // «Источник» уходим только при наличии чека (если он требуется).
            || (screen === 'source' && isProjectMode && form.purchase_mode === 'purchased'
                && !hideProjectPurchaseProof && !receiptFile)
          return (
            <>
              {addError && <div style={{ color: 'var(--red)', fontSize: 13, marginBottom: 12 }}>{addError}</div>}
              <div style={{ display: 'flex', gap: 8 }}>
                <Button variant="secondary" fullWidth onClick={isFirstScreen ? onClose : () => setAddStep(addStep - 1)}>
                  {isFirstScreen ? 'Отмена' : 'Назад'}
                </Button>
                {screen === 'photos' ? (
                  <Button fullWidth disabled={photosCount < 1} onClick={handlePhotosReady}>
                    {photosCount < 1 ? 'Добавь фото' : 'Готово'}
                  </Button>
                ) : isLastScreen ? (
                  <Button fullWidth disabled={submitDisabled} onClick={handleAdd}>
                    {adding ? 'Сохранение...' : 'Добавить'}
                  </Button>
                ) : (
                  <Button fullWidth disabled={nextDisabled} onClick={() => setAddStep(addStep + 1)}>
                    Далее
                  </Button>
                )}
              </div>
            </>
          )
        })()}
      </div>
    </div>
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
