// Модалка «Редактировать состав заявки» — позволяет requester'у или складу
// поменять unit_ids активной заявки (статус new/collecting/ready):
//   • удалить ненужные позиции (delete-кнопка по каждой строке);
//   • добавить уже-существующие из каталога (поиск по складу);
//   • добавить новые позиции по фото (та же AI-распознавалка что в walk-in:
//     POST /units/recognize → Claude Sonnet → name/category/period/description).
//
// Submit одной кнопкой → POST /requests/:id/items (multipart). Бэкенд создаёт
// новые units (status='on_stock', created_via='request_edit'), пересохраняет
// массив unit_ids, шлёт уведомления второй стороне.

import { useEffect, useMemo, useRef, useState } from 'react'
import { Camera, Search, Trash2, X } from 'lucide-react'
import Button from '../shared/Button'
import Input from '../shared/Input'
import { useToast } from '../shared/Toast'
import { units as unitsApi, requests as requestsApi } from '../../services/api'
import { categoryLabel } from '../../constants/categories'

const MAX_PHOTO_SIDE = 1568
const PHOTO_QUALITY = 0.85

// Compress on client (Canvas: max 1568px, JPEG 85). Тот же приём что в walk-in.
async function compressImage(file) {
  if (file.type === 'image/jpeg' && file.size < 500_000) return file
  return await new Promise(resolve => {
    const img = new Image()
    img.onload = () => {
      const canvas = document.createElement('canvas')
      let { width, height } = img
      if (width > MAX_PHOTO_SIDE || height > MAX_PHOTO_SIDE) {
        if (width > height) { height = Math.round(height * MAX_PHOTO_SIDE / width); width = MAX_PHOTO_SIDE }
        else { width = Math.round(width * MAX_PHOTO_SIDE / height); height = MAX_PHOTO_SIDE }
      }
      canvas.width = width
      canvas.height = height
      canvas.getContext('2d').drawImage(img, 0, 0, width, height)
      canvas.toBlob(
        b => resolve(new File([b], file.name.replace(/\.[^.]+$/, '.jpg'), { type: 'image/jpeg' })),
        'image/jpeg',
        PHOTO_QUALITY,
      )
    }
    img.src = URL.createObjectURL(file)
  })
}

function makeTempId() {
  return 'u_' + Math.random().toString(36).slice(2) + Date.now().toString(36)
}

export default function EditRequestItemsModal({ requestId, initialUnits, onClose, onSaved }) {
  const toast = useToast()
  const fileInputRef = useRef(null)

  // items: смешанный массив с двумя типами:
  //   • existing — { temp_id, _existing:true, id, name, category, qty, photo_url, serial }
  //   • new      — { temp_id, file, name, category, qty, description, period, dimensions,
  //                  status: 'recognizing'|'ready'|'failed' }
  const [items, setItems] = useState(() =>
    (initialUnits || []).map(u => ({
      temp_id: makeTempId(),
      _existing: true,
      id: u.id,
      name: u.name,
      category: u.category,
      qty: u.qty || 1,
      photo_url: u.photo_url,
      serial: u.serial,
    }))
  )
  const [editingId, setEditingId] = useState(null)
  const [showPicker, setShowPicker] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [apiError, setApiError] = useState('')

  function removeItem(id) {
    setItems(items => items.filter(x => x.temp_id !== id))
  }

  async function addPhoto(rawFile) {
    const file = await compressImage(rawFile)
    const temp_id = makeTempId()
    setItems(prev => [...prev, {
      temp_id, file, status: 'recognizing',
      name: '', category: 'other', qty: 1,
      matches: [], dedup_dismissed: false,
    }])
    try {
      const fd = new FormData()
      fd.append('photos', file)
      const r = await unitsApi.recognize(fd)
      // Backend возвращает { name, category, period, description }.
      // Параллельно ищем дубли в каталоге (как в walk-in flow): /units?search=<AI-name>
      // Бэкенд маркирует _match: direct (точное вхождение), similar (синоним),
      // related (только категория). Берём direct + similar, топ-3.
      // Дополнительно прогоняем поиск по первому значимому слову — спасает
      // когда AI вернул фразу из 2-3 слов, а в базе единица одним словом.
      let matches = []
      if (r.name) {
        try {
          const tryQueries = [r.name]
          const firstWord = r.name.split(/\s+/).find(w => w.length >= 3)
          if (firstWord && firstWord !== r.name) tryQueries.push(firstWord)
          const seen = new Set()
          const direct = [], similar = []
          // Не предлагать единицы которые уже в этой заявке.
          const alreadyIn = new Set(items.filter(x => x._existing).map(x => x.id))
          for (const q of tryQueries) {
            const sr = await unitsApi.list({ search: q, status: 'on_stock' })
            for (const u of (sr.units || [])) {
              if (seen.has(u.id) || alreadyIn.has(u.id) || u.misplaced || u.is_project_kept) continue
              seen.add(u.id)
              if (u._match === 'direct') direct.push(u)
              else if (u._match === 'similar') similar.push(u)
            }
            if (direct.length >= 3) break
          }
          matches = [...direct, ...similar].slice(0, 3)
        } catch { matches = [] }
      }
      setItems(prev => prev.map(x => x.temp_id === temp_id
        ? {
            ...x,
            status: 'ready',
            name: r.name || x.name,
            category: r.category || x.category,
            description: r.description || null,
            period: r.period || null,
            matches,
          }
        : x
      ))
    } catch (e) {
      setItems(prev => prev.map(x => x.temp_id === temp_id
        ? { ...x, status: 'failed', name: x.name || 'Без названия' }
        : x
      ))
      toast?.(e.message || 'AI не распознал — отредактируйте вручную', 'error')
    }
  }

  function replaceWithExisting(tempId, unit) {
    // Юзер подтвердил что AI-карточка совпадает с уже учтённой единицей —
    // меняем new-карточку на existing-ссылку (тогда backend не создаст
    // новую запись, а добавит существующий unit_id в заявку).
    setItems(prev => prev.map(x => x.temp_id === tempId ? {
      temp_id: x.temp_id,
      _existing: true,
      id: unit.id,
      name: unit.name,
      category: unit.category,
      qty: unit.qty || 1,
      photo_url: unit.photo_url,
      serial: unit.serial,
    } : x))
  }

  function dismissDedup(tempId) {
    setItems(prev => prev.map(x => x.temp_id === tempId ? { ...x, dedup_dismissed: true } : x))
  }

  function handleFile(ev) {
    const files = Array.from(ev.target.files || [])
    for (const f of files) addPhoto(f)
    ev.target.value = ''
  }

  function pickExisting(unit) {
    setItems(prev => [...prev, {
      temp_id: makeTempId(),
      _existing: true,
      id: unit.id,
      name: unit.name,
      category: unit.category,
      qty: unit.qty || 1,
      photo_url: unit.photo_url,
      serial: unit.serial,
    }])
  }

  const editingItem = items.find(x => x.temp_id === editingId)
  const alreadyChosenIds = items.filter(x => x._existing).map(x => x.id)
  const stillRecognizing = items.some(x => x.status === 'recognizing')

  async function submit() {
    if (stillRecognizing) {
      toast?.('Дождитесь завершения распознавания', 'info')
      return
    }
    setSubmitting(true)
    setApiError('')
    try {
      const fd = new FormData()
      const existing_unit_ids = items.filter(x => x._existing).map(x => x.id)
      const new_units = items.filter(x => !x._existing).map(x => ({
        temp_id: x.temp_id,
        name: x.name,
        category: x.category,
        qty: x.qty || 1,
        description: x.description || null,
        period: x.period || null,
        dimensions: x.dimensions || null,
      }))
      fd.append('existing_unit_ids', JSON.stringify(existing_unit_ids))
      fd.append('new_units', JSON.stringify(new_units))
      for (const x of items) {
        if (!x._existing && x.file) fd.append(`photos_${x.temp_id}`, x.file)
      }
      const r = await requestsApi.updateItems(requestId, fd)
      const summary = [
        r.added ? `+${r.added}` : null,
        r.removed ? `−${r.removed}` : null,
      ].filter(Boolean).join(' / ') || 'без изменений'
      toast?.(`Состав заявки обновлён: ${summary}`, 'success')
      onSaved?.(r.request)
    } catch (e) {
      setApiError(e.message || 'Не удалось сохранить')
    }
    setSubmitting(false)
  }

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 16, zIndex: 200,
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          background: 'var(--white)', borderRadius: 14, padding: 22,
          width: '100%', maxWidth: 560, maxHeight: '90vh',
          display: 'flex', flexDirection: 'column',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', marginBottom: 12, gap: 8 }}>
          <h3 style={{ fontSize: 17, fontWeight: 600, flex: 1, margin: 0 }}>
            Редактировать состав заявки
          </h3>
          <button
            onClick={onClose}
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--muted)' }}
            aria-label="Закрыть"
          ><X size={20} /></button>
        </div>
        <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 14 }}>
          Снимите ненужное галочкой удаления. Добавьте новые — по фото или из базы.
        </div>

        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          capture="environment"
          multiple
          style={{ display: 'none' }}
          onChange={handleFile}
        />
        <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
          <Button fullWidth onClick={() => fileInputRef.current?.click()}>
            <Camera size={16} style={{ marginRight: 6 }} /> Снять фото
          </Button>
          <Button fullWidth variant="secondary" onClick={() => setShowPicker(true)}>
            <Search size={16} style={{ marginRight: 6 }} /> Из базы
          </Button>
        </div>

        <div style={{ flex: 1, overflow: 'auto', minHeight: 80, marginBottom: 14 }}>
          {items.length === 0 && (
            <div style={{ textAlign: 'center', color: 'var(--muted)', fontSize: 13, padding: '40px 0' }}>
              Заявка пустая. Добавьте позиции — по фото или из базы.
            </div>
          )}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {items.map(x => (
              <ItemRow
                key={x.temp_id}
                item={x}
                onRemove={() => removeItem(x.temp_id)}
                onEdit={() => !x._existing && x.status !== 'recognizing' && setEditingId(x.temp_id)}
                onReplaceWithExisting={(unit) => replaceWithExisting(x.temp_id, unit)}
                onDismissDedup={() => dismissDedup(x.temp_id)}
              />
            ))}
          </div>
        </div>

        {apiError && (
          <div style={{ color: 'var(--red, #dc2626)', fontSize: 12, marginBottom: 10, textAlign: 'center' }}>
            {apiError}
          </div>
        )}

        <div style={{ display: 'flex', gap: 8 }}>
          <Button variant="secondary" fullWidth onClick={onClose} disabled={submitting}>
            Отмена
          </Button>
          <Button fullWidth onClick={submit} disabled={submitting || stillRecognizing}>
            {submitting ? 'Сохранение...' : 'Сохранить'}
          </Button>
        </div>
      </div>

      {editingItem && (
        <EditItemSheet
          item={editingItem}
          onClose={() => setEditingId(null)}
          onSave={(patch) => {
            setItems(prev => prev.map(x => x.temp_id === editingId ? { ...x, ...patch } : x))
            setEditingId(null)
          }}
        />
      )}
      {showPicker && (
        <ExistingUnitsPicker
          alreadyChosenIds={alreadyChosenIds}
          onClose={() => setShowPicker(false)}
          onPick={pickExisting}
        />
      )}
    </div>
  )
}

function ItemRow({ item, onRemove, onEdit, onReplaceWithExisting, onDismissDedup }) {
  const isExisting = item._existing
  const isRecognizing = item.status === 'recognizing'
  const isFailed = item.status === 'failed'
  // Жёлтая рамка + блок «Возможно, уже на складе» — когда AI распознал и нашлись
  // direct/similar совпадения (≤3) и юзер ещё не нажал «Это новая».
  const hasUnresolvedDups = !isExisting && item.status === 'ready'
    && (item.matches?.length || 0) > 0 && !item.dedup_dismissed
  const borderColor = hasUnresolvedDups
    ? 'var(--gold-500, #C9A55C)'
    : isExisting ? 'var(--green, #10b981)'
    : isFailed ? 'var(--red, #dc2626)' : 'var(--border)'
  const borderWidth = hasUnresolvedDups || isExisting || isFailed ? 2 : 1
  return (
    <div
      style={{
        borderRadius: 'var(--radius-card)',
        border: `${borderWidth}px solid ${borderColor}`,
        background: 'var(--white)', overflow: 'hidden',
      }}
    >
      <div
        onClick={() => !isExisting && !isRecognizing && onEdit()}
        style={{
          display: 'flex', alignItems: 'center', gap: 12, padding: 10,
          cursor: !isExisting && !isRecognizing ? 'pointer' : 'default',
        }}
      >
        <Thumb item={item} />
        <div style={{ flex: 1, minWidth: 0 }}>
          {isRecognizing ? (
            <div style={{ color: 'var(--muted)', fontSize: 13 }}>⏳ распознаю…</div>
          ) : (
            <>
              <div style={{ fontWeight: 500, fontSize: 14, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'flex', alignItems: 'center', gap: 6 }}>
                {hasUnresolvedDups && <span title="Возможно, дубль" style={{ fontSize: 13 }}>⚠️</span>}
                {isExisting && <span title="Из базы" style={{ fontSize: 13, color: 'var(--green, #10b981)' }}>🔗</span>}
                {item.name || 'Без названия'}
              </div>
              <div style={{ fontSize: 12, color: 'var(--muted)' }}>
                {categoryLabel(item.category) || item.category} · ×{item.qty}
                {isExisting && item.serial ? ` · ${item.serial}` : ''}
                {isExisting ? ' · из базы' : ''}
                {isFailed ? ' · AI не распознал — отредактируйте' : ''}
              </div>
            </>
          )}
        </div>
        <button
          onClick={(e) => { e.stopPropagation(); onRemove() }}
          style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--muted)', padding: 4 }}
          aria-label="Удалить"
        ><Trash2 size={16} /></button>
      </div>

      {hasUnresolvedDups && (
        <div style={{
          borderTop: '1px solid var(--gold-500, #C9A55C)',
          background: 'var(--gold-100, #FFF7E0)', padding: 10,
        }}>
          <div style={{ fontSize: 12, color: 'var(--gold-600, #C9A55C)', fontWeight: 600, marginBottom: 6 }}>
            Возможно, уже на складе:
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {item.matches.map(m => (
              <button
                key={m.id}
                onClick={(e) => { e.stopPropagation(); onReplaceWithExisting(m) }}
                style={{
                  display: 'flex', alignItems: 'center', gap: 8,
                  padding: 6, borderRadius: 6, cursor: 'pointer',
                  border: '1px solid var(--border)', background: 'var(--white)',
                  textAlign: 'left',
                }}
              >
                <div style={{
                  width: 32, height: 32, borderRadius: 4, overflow: 'hidden',
                  background: 'var(--bg-secondary, var(--bg))', flexShrink: 0,
                }}>
                  {m.photo_url && <img src={m.photo_url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />}
                </div>
                <div style={{ flex: 1, minWidth: 0, fontSize: 12 }}>
                  <div style={{ fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m.name}</div>
                  <div style={{ color: 'var(--muted)' }}>
                    {m.serial}
                    {(m.cell_custom || m.cell_code) && ` · ${m.cell_custom || m.cell_code}`}
                  </div>
                </div>
              </button>
            ))}
          </div>
          <button
            onClick={(e) => { e.stopPropagation(); onDismissDedup() }}
            style={{
              marginTop: 8, padding: '4px 8px', fontSize: 11,
              background: 'transparent', border: '1px solid var(--gold-500, #C9A55C)',
              borderRadius: 4, color: 'var(--gold-600, #C9A55C)',
              cursor: 'pointer', fontWeight: 500,
            }}
          >Это новая — оставить как есть</button>
        </div>
      )}
    </div>
  )
}

function Thumb({ item }) {
  if (item._existing) {
    return (
      <div style={{
        width: 48, height: 48, borderRadius: 8, overflow: 'hidden',
        background: 'var(--bg-secondary, var(--bg))', flexShrink: 0,
      }}>
        {item.photo_url && <img src={item.photo_url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />}
      </div>
    )
  }
  return <PhotoThumb file={item.file} />
}

function PhotoThumb({ file }) {
  const src = useMemo(() => file ? URL.createObjectURL(file) : null, [file])
  useEffect(() => () => { if (src) URL.revokeObjectURL(src) }, [src])
  return (
    <div style={{
      width: 48, height: 48, borderRadius: 8, overflow: 'hidden',
      background: 'var(--bg-secondary, var(--bg))', flexShrink: 0,
    }}>
      {src && <img src={src} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />}
    </div>
  )
}

function EditItemSheet({ item, onClose, onSave }) {
  const [name, setName] = useState(item.name || '')
  const [category, setCategory] = useState(item.category || 'other')
  const [qty, setQty] = useState(item.qty || 1)
  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 16, zIndex: 400,
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          background: 'var(--white)', borderRadius: 14,
          padding: 22, width: '100%', maxWidth: 460,
        }}
      >
        <h3 style={{ fontSize: 16, fontWeight: 600, marginBottom: 16, marginTop: 0 }}>Правка карточки</h3>
        <Input label="Название" value={name} onChange={e => setName(e.target.value)} />
        <Input label="Категория" value={category} onChange={e => setCategory(e.target.value)} />
        <Input label="Количество" type="number" min="1" value={qty}
          onChange={e => setQty(Math.max(1, Number(e.target.value) || 1))} />
        <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
          <Button variant="secondary" fullWidth onClick={onClose}>Отмена</Button>
          <Button fullWidth onClick={() => onSave({ name, category, qty })}>Сохранить</Button>
        </div>
      </div>
    </div>
  )
}

// Компактный поиск по складу — то же что ExistingUnitsPicker в WalkinIssuePage,
// дублирован чтобы не плодить кросс-импорты между warehouse-страницами.
function ExistingUnitsPicker({ alreadyChosenIds, onClose, onPick }) {
  const [q, setQ] = useState('')
  const [results, setResults] = useState([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    const term = q.trim()
    if (term.length < 2) { setResults([]); return }
    setLoading(true)
    const t = setTimeout(() => {
      unitsApi.list({ search: term, status: 'on_stock' })
        .then(r => setResults((r.units || []).filter(u =>
          !alreadyChosenIds.includes(u.id) &&
          !u.misplaced &&
          !u.is_project_kept
        )))
        .catch(() => setResults([]))
        .finally(() => setLoading(false))
    }, 250)
    return () => clearTimeout(t)
  }, [q, alreadyChosenIds])

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 16, zIndex: 400,
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          background: 'var(--white)', borderRadius: 14,
          padding: 18, width: '100%', maxWidth: 600, maxHeight: '80vh',
          display: 'flex', flexDirection: 'column',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', marginBottom: 12, gap: 8 }}>
          <h3 style={{ fontSize: 16, fontWeight: 600, flex: 1, margin: 0 }}>Выберите из базы</h3>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--muted)' }} aria-label="Закрыть">
            <X size={20} />
          </button>
        </div>
        <div style={{ position: 'relative', marginBottom: 12 }}>
          <Search size={16} style={{ position: 'absolute', left: 12, top: 12, color: 'var(--muted)' }} />
          <input
            autoFocus
            placeholder="Название или серийник…"
            value={q}
            onChange={e => setQ(e.target.value)}
            style={{
              width: '100%', height: 40, padding: '0 12px 0 36px',
              border: '1px solid var(--border)', borderRadius: 'var(--radius-btn)',
              background: 'var(--white)', fontSize: 14, outline: 'none',
              boxSizing: 'border-box',
            }}
          />
        </div>
        <div style={{ flex: 1, overflow: 'auto', minHeight: 100 }}>
          {q.trim().length < 2 && (
            <div style={{ textAlign: 'center', color: 'var(--muted)', fontSize: 13, padding: 32 }}>
              Введите минимум 2 символа
            </div>
          )}
          {q.trim().length >= 2 && loading && (
            <div style={{ textAlign: 'center', color: 'var(--muted)', fontSize: 13, padding: 16 }}>
              Поиск…
            </div>
          )}
          {q.trim().length >= 2 && !loading && results.length === 0 && (
            <div style={{ textAlign: 'center', color: 'var(--muted)', fontSize: 13, padding: 16 }}>
              Ничего не найдено
            </div>
          )}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {results.map(u => (
              <button
                key={u.id}
                onClick={() => { onPick(u); onClose() }}
                style={{
                  display: 'flex', alignItems: 'center', gap: 12,
                  padding: 8, borderRadius: 'var(--radius-card)',
                  border: '1px solid var(--border)', background: 'var(--white)',
                  cursor: 'pointer', textAlign: 'left',
                }}
              >
                <div style={{
                  width: 44, height: 44, borderRadius: 6, overflow: 'hidden',
                  background: 'var(--bg-secondary, var(--bg))', flexShrink: 0,
                }}>
                  {u.photo_url && <img src={u.photo_url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 500, fontSize: 14, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {u.name}
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--muted)' }}>
                    {u.category} · {u.serial} · ×{u.qty}
                    {u.cell_custom || u.cell_code ? ` · ${u.cell_custom || u.cell_code}` : ''}
                  </div>
                </div>
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
