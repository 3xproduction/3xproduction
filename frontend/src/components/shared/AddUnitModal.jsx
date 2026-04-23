// Модалка 3-шагового визарда добавления единицы.
// Вынесена из UnitsPage, чтобы её можно было открывать с любой страницы
// (например, с карты склада — поверх самой карты, а не каталога).

import { useState, useEffect, useRef } from 'react'
import { Camera, Film } from 'lucide-react'
import Button from './Button'
import { ALL_CATEGORIES, categoryLabel } from '../../constants/categories'
import { units as unitsApi, warehouses as warehousesApi } from '../../services/api'
import { useAuth } from '../../hooks/useAuth'
import { useToast } from './Toast'

const EMPTY_FORM = {
  name: '', category: ALL_CATEGORIES[0], dimensions: '', description: '',
  source: 'покупка', qty: 1, warehouse_id: '', cell_id: '', period: '', valuation: '',
}
const CLOTHING_SIZES = ['XS', 'S', 'M', 'L', 'XL', 'XXL', 'XXXL']
const SHOE_SIZES = ['35', '36', '37', '38', '39', '40', '41', '42', '43', '44', '45', '46', '47']
const IS_CLOTHING_CAT = (cat) => ['costumes', 'clothing'].includes(cat)

function compressImage(file, maxSize = 1024, quality = 0.5) {
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
}) {
  const { user } = useAuth()
  const toast = useToast()
  const isDirector = ['warehouse_director', 'warehouse_deputy'].includes(user?.role)
  const canSeeSource = ['warehouse_director', 'warehouse_deputy', 'producer'].includes(user?.role)

  const [addStep, setAddStep] = useState(1)
  const [form, setForm] = useState(EMPTY_FORM)
  const [photos, setPhotos] = useState([])
  const [sizeType, setSizeType] = useState('clothing')
  const [adding, setAdding] = useState(false)
  const [addError, setAddError] = useState('')
  const [recognizing, setRecognizing] = useState(false)
  const [outliers, setOutliers] = useState(new Set())
  const [warehouses, setWarehouses] = useState([])
  const [cells, setCells] = useState([])
  const fileRef = useRef()
  const camRef = useRef()
  const videoRef = useRef()

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
    warehousesApi.list().then(d => setWarehouses(d.warehouses || [])).catch(() => {})
  }, [open, prefillCellId, prefillWarehouseId])

  useEffect(() => {
    if (!form.warehouse_id) { setCells([]); return }
    warehousesApi.cells(form.warehouse_id).then(d => {
      const allCells = (d.sections || []).flatMap(s => s.cells || [])
      setCells(allCells)
    }).catch(() => setCells([]))
  }, [form.warehouse_id])

  async function onFilesSelected(e) {
    const files = Array.from(e.target.files)
    const processed = await Promise.all(files.map(f => isVideoFile(f) ? f : compressImage(f)))
    setPhotos(prev => [...prev, ...processed].slice(0, 5))
    setOutliers(new Set())
  }

  async function handlePhotosReady() {
    const imagePhotoIdx = photos.map((p, i) => isVideoFile(p) ? -1 : i).filter(i => i !== -1)
    const images = imagePhotoIdx.map(i => photos[i])
    if (images.length < 2) {
      toast?.('Загрузите минимум 2 фото одного предмета', 'error')
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
        setForm(f => ({
          ...f,
          name: result.name || f.name,
          category: ALL_CATEGORIES.includes(result.category) ? result.category : f.category,
          period: result.period || f.period,
          description: result.description || f.description,
        }))
        toast?.('AI заполнил поля — проверьте и отредактируйте', 'success')
      } else {
        toast?.('AI нужна ещё попытка или заполните вручную', 'error')
      }
    } catch (err) {
      toast?.(err.message || 'AI нужна ещё попытка или заполните вручную', 'error')
    } finally {
      setRecognizing(false)
      setAddStep(2)
    }
  }

  async function handleAdd() {
    if (!form.name.trim()) return
    if (isDirector && !form.valuation) { setAddError('Укажите стоимость единицы'); return }
    setAdding(true)
    setAddError('')
    try {
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
      if (photoErrors > 0) {
        toast?.(`Единица создана, но ${photoErrors} фото не загрузилось`, 'error')
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

        {/* STEP 1 — Photos */}
        {addStep === 1 && (
          <>
            {recognizing ? (
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '48px 0', gap: 16 }}>
                <div style={{ width: 48, height: 48, border: '3px solid var(--border)', borderTopColor: 'var(--accent)', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
                <div style={{ fontSize: 14, fontWeight: 500, color: 'var(--text)' }}>AI анализирует фото...</div>
                <div style={{ fontSize: 13, color: 'var(--muted)' }}>Заполняем данные автоматически</div>
                <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
              </div>
            ) : (
              <>
                <div style={{ fontWeight: 600, fontSize: 16, marginBottom: 6 }}>Загрузите фото</div>
                <div style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 20 }}>От 2 до 5 фото одного предмета (разные ракурсы). Видео — опционально.</div>

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
                <input ref={camRef} type="file" accept="image/*,video/mp4,video/webm,video/quicktime" capture style={{ display: 'none' }} onChange={onFilesSelected} />
                <input ref={videoRef} type="file" accept="video/mp4,video/webm,video/quicktime" style={{ display: 'none' }} onChange={onFilesSelected} />

                <div style={{ display: 'flex', gap: 8 }}>
                  <Button variant="secondary" fullWidth onClick={onClose}>Отмена</Button>
                  <Button fullWidth disabled={photos.filter(f => !isVideoFile(f)).length < 2} onClick={handlePhotosReady}>
                    {photos.filter(f => !isVideoFile(f)).length < 2 ? `Нужно ещё ${2 - photos.filter(f => !isVideoFile(f)).length} фото` : 'Готово'}
                  </Button>
                </div>
              </>
            )}
          </>
        )}

        {/* STEP 2 — Description */}
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
            <select value={form.category} onChange={e => setForm(f => ({ ...f, category: e.target.value, dimensions: '' }))}
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
                <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
                  <button onClick={() => setSizeType('clothing')}
                    style={{ padding: '4px 12px', fontSize: 12, borderRadius: 'var(--radius-btn)', border: '1px solid var(--border)', background: sizeType === 'clothing' ? 'var(--accent)' : 'var(--white)', color: sizeType === 'clothing' ? '#fff' : 'var(--text)', cursor: 'pointer' }}>Одежда</button>
                  <button onClick={() => setSizeType('shoe')}
                    style={{ padding: '4px 12px', fontSize: 12, borderRadius: 'var(--radius-btn)', border: '1px solid var(--border)', background: sizeType === 'shoe' ? 'var(--accent)' : 'var(--white)', color: sizeType === 'shoe' ? '#fff' : 'var(--text)', cursor: 'pointer' }}>Обувь</button>
                </div>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 12 }}>
                  {(sizeType === 'shoe' ? SHOE_SIZES : CLOTHING_SIZES).map(s => (
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
