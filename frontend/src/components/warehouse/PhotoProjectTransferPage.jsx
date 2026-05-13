import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  ArrowLeft, CheckCircle2, FolderInput, ImagePlus, ListChecks, Loader2,
  PackageCheck, SearchCheck, X,
} from 'lucide-react'
import { useAuth } from '../../hooks/useAuth'
import { projectUnits as projectUnitsApi, units as unitsApi } from '../../services/api'
import UnitCardModal from '../shared/UnitCardModal'

const MAX_PHOTO_SIDE = 1568
const PHOTO_QUALITY = 0.85
const RECOGNIZE_CONCURRENCY = 2
const MAX_TRANSFER_PHOTOS = 200

const STOP_WORDS = new Set([
  'для', 'или', 'под', 'над', 'без', 'при', 'как', 'это', 'тот', 'эта', 'его', 'ее',
  'чёрный', 'черный', 'белый', 'белая', 'серый', 'серая', 'красный', 'синий',
  'малый', 'малая', 'большой', 'большая', 'новый', 'новая', 'старый', 'старая',
])

function makeTempId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

function isVideoFile(file) {
  return file?.type?.startsWith('video/')
}

function normalizeText(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[^a-zа-я0-9]+/gi, ' ')
    .trim()
}

function wordsOf(value) {
  return normalizeText(value)
    .split(/\s+/)
    .filter(w => w.length >= 3 && !STOP_WORDS.has(w))
}

function uniqueById(items) {
  const seen = new Set()
  const out = []
  for (const item of items) {
    if (!item?.id || seen.has(item.id)) continue
    seen.add(item.id)
    out.push(item)
  }
  return out
}

function buildQueries(name) {
  const words = wordsOf(name)
  return [
    normalizeText(name),
    words.slice(0, 2).join(' '),
    ...words.slice(0, 4),
  ].filter(Boolean).filter((q, idx, arr) => arr.indexOf(q) === idx)
}

function candidateScore(unit, recognized, queryIndex) {
  const unitName = normalizeText(unit.name)
  const recWords = wordsOf(recognized.name)
  const overlap = recWords.filter(w => unitName.includes(w)).length
  let score = 42 - queryIndex * 6
  if (unit._match === 'direct') score += 42
  else if (unit._match === 'similar') score += 28
  else if (unit._match === 'related') score += 8
  if (recognized.category && unit.category === recognized.category) score += 14
  score += overlap * 9
  return score
}

function matchLabel(score, match) {
  if (score >= 86 || match === 'direct') return 'точное'
  if (score >= 66 || match === 'similar') return 'похожее'
  return 'проверить'
}

async function compressImage(file) {
  if (isVideoFile(file)) return file
  return new Promise((resolve, reject) => {
    const img = new Image()
    const url = URL.createObjectURL(file)
    img.onload = () => {
      try {
        let { width, height } = img
        if (width > MAX_PHOTO_SIDE || height > MAX_PHOTO_SIDE) {
          if (width > height) {
            height = Math.round(height * MAX_PHOTO_SIDE / width)
            width = MAX_PHOTO_SIDE
          } else {
            width = Math.round(width * MAX_PHOTO_SIDE / height)
            height = MAX_PHOTO_SIDE
          }
        }
        const canvas = document.createElement('canvas')
        canvas.width = width
        canvas.height = height
        canvas.getContext('2d').drawImage(img, 0, 0, width, height)
        canvas.toBlob(
          blob => blob ? resolve(new File([blob], file.name.replace(/\.[^.]+$/, '.jpg'), { type: 'image/jpeg' })) : reject(new Error('Image compression failed')),
          'image/jpeg',
          PHOTO_QUALITY,
        )
      } catch (err) {
        reject(err)
      } finally {
        URL.revokeObjectURL(url)
      }
    }
    img.onerror = (err) => {
      URL.revokeObjectURL(url)
      reject(err)
    }
    img.src = url
  })
}

async function findCandidates(recognized) {
  const queries = buildQueries(recognized.name).slice(0, 4)
  const responses = await Promise.all(
    queries.map((query, index) =>
      unitsApi.list({ search: query, status: 'on_stock' }).then(response => ({ response, index }))
    )
  )
  const collected = []
  for (const { response, index } of responses) {
    for (const unit of response.units || []) {
      if (unit.misplaced || unit.is_project_kept || unit.status !== 'on_stock') continue
      const score = candidateScore(unit, recognized, index)
      if (score < 58) continue
      collected.push({
        ...unit,
        _photo_match_score: score,
        _photo_match_label: matchLabel(score, unit._match),
      })
    }
  }
  return uniqueById(collected)
    .sort((a, b) => b._photo_match_score - a._photo_match_score)
    .slice(0, 8)
}

export default function PhotoProjectTransferPage() {
  const navigate = useNavigate()
  const { user } = useAuth()
  const fileInputRef = useRef(null)
  const previewUrlsRef = useRef(new Set())
  const [projects, setProjects] = useState([])
  const [projectId, setProjectId] = useState('')
  const [items, setItems] = useState([])
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [cardId, setCardId] = useState(null)

  const allowed = user?.role === 'warehouse_director' || user?.role === 'warehouse_deputy'
  const selectedProject = projects.find(p => String(p.id) === String(projectId))
  const messageTone = message.startsWith('Перенесено') ? 'success'
    : message.startsWith('Не ') ? 'error'
      : 'info'
  const selectedIds = useMemo(() => {
    const ids = []
    for (const item of items) {
      for (const candidate of item.candidates || []) {
        if (candidate.selected && !ids.includes(candidate.id)) ids.push(candidate.id)
      }
    }
    return ids
  }, [items])
  const candidateIds = useMemo(() => {
    const ids = []
    const seen = new Set()
    for (const item of items) {
      for (const candidate of item.candidates || []) {
        if (!candidate?.id || seen.has(candidate.id)) continue
        seen.add(candidate.id)
        ids.push(candidate.id)
      }
    }
    return ids
  }, [items])
  const allCandidatesSelected = candidateIds.length > 0 && candidateIds.every(id => selectedIds.includes(id))

  useEffect(() => {
    if (!allowed) return
    projectUnitsApi.allProjects()
      .then(r => {
        const list = r.projects || []
        setProjects(list)
        setProjectId(prev => prev || list[0]?.id || '')
      })
      .catch(() => setProjects([]))
  }, [allowed])

  useEffect(() => () => {
    for (const url of previewUrlsRef.current) URL.revokeObjectURL(url)
    previewUrlsRef.current.clear()
  }, [])

  function patchItem(id, patch) {
    setItems(prev => prev.map(item => item.id === id ? { ...item, ...patch } : item))
  }

  async function recognizeOne(item) {
    try {
      const compressed = await compressImage(item.file)
      const fd = new FormData()
      fd.append('photos', compressed)
      const recognized = await unitsApi.recognize(fd)
      const candidates = await findCandidates(recognized)
      if (candidates.length === 0 && projectId) {
        patchItem(item.id, {
          status: 'creating',
          recognized,
          compressedFile: compressed,
          candidates: [],
        })
        await createProjectUnitFromPhoto(item.id, compressed, recognized)
        return
      }
      patchItem(item.id, {
        status: 'ready',
        recognized,
        compressedFile: compressed,
        candidates: candidates.map(c => ({ ...c, selected: false })),
      })
    } catch {
      patchItem(item.id, { status: 'failed', candidates: [] })
    }
  }

  async function createProjectUnitFromPhoto(itemId, photo, recognized) {
    try {
      const fd = new FormData()
      fd.append('project_id', projectId)
      fd.append('name', (recognized.name || 'Без названия').trim())
      fd.append('category', recognized.category || 'other')
      fd.append('qty', '1')
      fd.append('description', recognized.description || '')
      fd.append('period', recognized.period || '')
      fd.append('photo', photo)
      const result = await projectUnitsApi.createForProjectPhoto(fd)
      patchItem(itemId, {
        status: 'created',
        createdUnit: result.unit,
        createdProject: result.project,
      })
    } catch (err) {
      patchItem(itemId, {
        status: 'create_failed',
        createError: err?.message || 'Не удалось создать карточку',
      })
    }
  }

  async function runQueue(nextItems) {
    const queue = [...nextItems]
    const workers = Array.from({ length: Math.min(RECOGNIZE_CONCURRENCY, queue.length) }, async () => {
      while (queue.length) {
        const item = queue.shift()
        await recognizeOne(item)
      }
    })
    await Promise.all(workers)
  }

  function addFiles(files) {
    const remaining = Math.max(0, MAX_TRANSFER_PHOTOS - items.length)
    if (!remaining) {
      setMessage(`За один перенос можно загрузить до ${MAX_TRANSFER_PHOTOS} фото`)
      return
    }
    const sourcePhotos = Array.from(files || []).filter(f => f.type.startsWith('image/'))
    const photos = sourcePhotos.slice(0, remaining)
    if (!photos.length) return
    if (sourcePhotos.length > remaining) {
      setMessage(`Добавлено ${photos.length} фото, общий лимит ${MAX_TRANSFER_PHOTOS}`)
    } else {
      setMessage('')
    }
    const nextItems = photos.map(file => {
      const preview_url = URL.createObjectURL(file)
      previewUrlsRef.current.add(preview_url)
      return {
        id: makeTempId(),
        file,
        preview_url,
        status: 'recognizing',
        recognized: null,
        candidates: [],
      }
    })
    setItems(prev => [...prev, ...nextItems])
    runQueue(nextItems)
  }

  function removeItem(id) {
    setItems(prev => {
      const item = prev.find(x => x.id === id)
      if (item?.preview_url) {
        URL.revokeObjectURL(item.preview_url)
        previewUrlsRef.current.delete(item.preview_url)
      }
      return prev.filter(x => x.id !== id)
    })
  }

  function toggleCandidate(itemId, unitId) {
    const alreadySelectedElsewhere = items.some(item =>
      item.id !== itemId && item.candidates?.some(c => c.id === unitId && c.selected)
    )
    if (alreadySelectedElsewhere) {
      setMessage('Эта единица уже выбрана под другим фото')
      return
    }
    setMessage('')
    setItems(prev => {
      return prev.map(item => item.id === itemId
        ? {
            ...item,
            candidates: item.candidates.map(c => c.id === unitId ? { ...c, selected: !c.selected } : c),
          }
      : item)
    })
  }

  function selectAllCandidates() {
    if (!candidateIds.length) return
    const claimed = new Set(selectedIds)
    let changed = false
    const nextItems = items.map(item => ({
      ...item,
      candidates: (item.candidates || []).map(candidate => {
        if (candidate.selected || !candidate.id || claimed.has(candidate.id)) return candidate
        claimed.add(candidate.id)
        changed = true
        return { ...candidate, selected: true }
      }),
    }))
    if (changed) setItems(nextItems)
    setMessage(changed ? `Выбраны все найденные единицы: ${claimed.size}` : 'Все найденные единицы уже выбраны')
  }

  async function transferSelected() {
    if (!projectId || !selectedIds.length || busy) return
    setBusy(true)
    setMessage('')
    try {
      const result = await projectUnitsApi.moveToProject(selectedIds, projectId)
      const moved = result.moved_count || selectedIds.length
      setMessage(`Перенесено ${moved} ед. в ${selectedProject?.name || 'проект'}`)
      setItems(prev => prev.map(item => ({
        ...item,
        candidates: item.candidates.filter(c => !selectedIds.includes(c.id)),
      })))
    } catch (err) {
      setMessage(err?.message || 'Не удалось перенести выбранные единицы')
    } finally {
      setBusy(false)
    }
  }

  if (!allowed) {
    return (
      <div style={{ maxWidth: 760, margin: '0 auto', padding: '32px 16px' }}>
        <button onClick={() => navigate(-1)} className="page-back" style={{ display: 'inline-flex' }}>
          <ArrowLeft size={16} />
        </button>
        <h1 style={{ fontSize: 22, margin: '16px 0 8px' }}>Недоступно</h1>
        <p style={{ color: 'var(--muted)' }}>Функция доступна директору склада и заместителю директора склада.</p>
      </div>
    )
  }

  return (
    <div style={{ maxWidth: 1120, margin: '0 auto', padding: '28px 16px 132px' }}>
      <style>{`
        @keyframes photoTransferSpin { to { transform: rotate(360deg); } }
        .spin { animation: photoTransferSpin 0.9s linear infinite; }
        @media (max-width: 720px) {
          .photo-transfer-controls { grid-template-columns: 1fr !important; }
          .photo-transfer-result { grid-template-columns: 88px 1fr !important; }
          .photo-transfer-result > div:first-child { width: 88px !important; }
          .photo-transfer-candidate { grid-template-columns: 30px 40px 1fr !important; }
          .photo-transfer-candidate-badge { grid-column: 2 / -1; justify-self: start; }
          .photo-transfer-bottom { left: 0 !important; bottom: 64px !important; }
          .photo-transfer-bottom-inner { align-items: stretch !important; }
          .photo-transfer-bottom-summary { flex-basis: 100% !important; }
        }
      `}</style>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 22 }}>
        <button
          onClick={() => navigate(-1)}
          style={{
            width: 36, height: 36, borderRadius: 8, border: '1px solid var(--border)',
            background: 'var(--white)', display: 'inline-flex', alignItems: 'center',
            justifyContent: 'center', cursor: 'pointer',
          }}
          aria-label="Назад"
        >
          <ArrowLeft size={18} />
        </button>
        <div style={{ flex: 1, minWidth: 0 }}>
          <h1 style={{ margin: 0, fontSize: 24, lineHeight: 1.2 }}>Перенести в проект по фото</h1>
          <div style={{ color: 'var(--muted)', fontSize: 13, marginTop: 4 }}>
            Загрузите фото, отметьте найденные единицы и перенесите их на склад проекта.
          </div>
        </div>
      </div>

      <div className="photo-transfer-controls" style={{
        display: 'grid', gridTemplateColumns: 'minmax(220px, 360px) 1fr',
        gap: 14, alignItems: 'stretch', marginBottom: 18,
      }}>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <span style={{ fontSize: 12, color: 'var(--muted)', fontWeight: 600 }}>Проект</span>
          <select
            value={projectId}
            onChange={e => setProjectId(e.target.value)}
            style={{
              height: 44, border: '1px solid var(--border)', borderRadius: 8,
              background: 'var(--white)', padding: '0 12px', fontSize: 14,
            }}
          >
            {projects.map(project => (
              <option key={project.id} value={project.id}>{project.name}</option>
            ))}
          </select>
        </label>

        <button
          onClick={() => fileInputRef.current?.click()}
          style={{
            minHeight: 68, border: '1px dashed var(--border)', borderRadius: 8,
            background: 'var(--bg-secondary)', display: 'flex', alignItems: 'center',
            justifyContent: 'center', gap: 10, cursor: 'pointer', fontWeight: 600,
          }}
        >
          <ImagePlus size={20} />
          Загрузить фото
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          multiple
          hidden
          onChange={e => {
            addFiles(e.target.files)
            e.target.value = ''
          }}
        />
      </div>

      {message && (
        <div style={{
          marginBottom: 14, padding: '10px 12px', borderRadius: 8,
          background: messageTone === 'success' ? '#eef8f0' : messageTone === 'error' ? '#fff1f1' : '#f3f6fb',
          border: `1px solid ${messageTone === 'success' ? '#b7dfbf' : messageTone === 'error' ? '#f0c0c0' : '#c9d7ee'}`,
          color: messageTone === 'success' ? '#1f6b2d' : messageTone === 'error' ? '#9b1c1c' : '#24486f',
          fontSize: 13,
        }}>
          {message}
        </div>
      )}

      {items.length === 0 ? (
        <div style={{
          border: '1px solid var(--border)', borderRadius: 8, background: 'var(--white)',
          minHeight: 260, display: 'flex', flexDirection: 'column', alignItems: 'center',
          justifyContent: 'center', gap: 10, color: 'var(--muted)', textAlign: 'center',
        }}>
          <SearchCheck size={34} />
          <div style={{ fontWeight: 600, color: 'var(--text)' }}>Пока нет фото</div>
          <div style={{ fontSize: 13 }}>Можно загрузить сразу несколько предметов.</div>
        </div>
      ) : (
        <div style={{ display: 'grid', gap: 12 }}>
          {items.map(item => (
            <PhotoResult
              key={item.id}
              item={item}
              selectedIds={selectedIds}
              onRemove={() => removeItem(item.id)}
              onToggle={unitId => toggleCandidate(item.id, unitId)}
              onOpenCard={setCardId}
            />
          ))}
        </div>
      )}

      <div className="photo-transfer-bottom" style={{
        position: 'fixed', left: 'var(--rail-width, 64px)', right: 0, bottom: 0,
        background: 'rgba(255,255,255,0.92)', borderTop: '1px solid var(--border)',
        backdropFilter: 'blur(10px)', padding: '12px 18px', zIndex: 20,
      }}>
        <div
          className="photo-transfer-bottom-inner"
          style={{ maxWidth: 1120, margin: '0 auto', display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}
        >
          <div className="photo-transfer-bottom-summary" style={{ flex: '1 1 220px', minWidth: 0, fontSize: 13, color: 'var(--muted)' }}>
            {selectedProject ? selectedProject.name : 'Выберите проект'} · выбрано {selectedIds.length} ед.
          </div>
          <button
            onClick={selectAllCandidates}
            disabled={!candidateIds.length || allCandidatesSelected || busy}
            style={{
              minWidth: 148, height: 44, border: '1px solid var(--border)', borderRadius: 8,
              background: (!candidateIds.length || allCandidatesSelected || busy) ? 'var(--bg-secondary)' : 'var(--white)',
              color: (!candidateIds.length || allCandidatesSelected || busy) ? 'var(--muted)' : 'var(--text)',
              fontWeight: 700, cursor: (!candidateIds.length || allCandidatesSelected || busy) ? 'default' : 'pointer',
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8,
            }}
          >
            {allCandidatesSelected ? <CheckCircle2 size={17} /> : <ListChecks size={17} />}
            {allCandidatesSelected ? 'Все выбрано' : 'Выбрать все'}
          </button>
          <button
            onClick={transferSelected}
            disabled={!projectId || !selectedIds.length || busy}
            style={{
              minWidth: 220, height: 44, border: 0, borderRadius: 8,
              background: (!projectId || !selectedIds.length || busy) ? 'var(--border)' : '#0A0A0A',
              color: '#fff', fontWeight: 700, cursor: (!projectId || !selectedIds.length || busy) ? 'default' : 'pointer',
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8,
            }}
          >
            {busy ? <Loader2 size={17} className="spin" /> : <FolderInput size={17} />}
            Перенести {selectedIds.length} ед.
          </button>
        </div>
      </div>

      {cardId && <UnitCardModal unitId={cardId} onClose={() => setCardId(null)} />}
    </div>
  )
}

function PhotoResult({ item, selectedIds, onRemove, onToggle, onOpenCard }) {
  const isLoading = item.status === 'recognizing'
  const isCreating = item.status === 'creating'
  const isCreated = item.status === 'created'
  const isFailed = item.status === 'failed'
  const isCreateFailed = item.status === 'create_failed'

  return (
    <div style={{
      border: '1px solid var(--border)', borderRadius: 8, background: 'var(--white)',
      overflow: 'hidden',
    }}>
      <div className="photo-transfer-result" style={{ display: 'grid', gridTemplateColumns: '128px 1fr', gap: 14, padding: 12 }}>
        <div style={{
          width: 128, aspectRatio: '1 / 1', borderRadius: 8, overflow: 'hidden',
          background: 'var(--bg-secondary)', border: '1px solid var(--border)',
        }}>
          <img src={item.preview_url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
        </div>

        <div style={{ minWidth: 0 }}>
          <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 700, fontSize: 15 }}>
                {isLoading && 'Распознаю фото...'}
                {isCreating && 'Создаю карточку проекта...'}
                {isCreated && (item.createdUnit?.name || item.recognized?.name || 'Карточка создана')}
                {isFailed && 'Не удалось распознать'}
                {isCreateFailed && (item.recognized?.name || 'Не удалось создать карточку')}
                {!isLoading && !isCreating && !isCreated && !isFailed && !isCreateFailed && (item.recognized?.name || 'Без названия')}
              </div>
              {!isLoading && !isCreating && !isFailed && (
                <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 3 }}>
                  {item.recognized?.category || 'other'}
                  {isCreated
                    ? ` · создано в проекте${item.createdUnit?.serial ? ` · ${item.createdUnit.serial}` : ''}`
                    : item.candidates?.length ? ` · найдено ${item.candidates.length}` : ' · совпадений нет'}
                </div>
              )}
            </div>
            <button
              onClick={onRemove}
              style={{
                width: 30, height: 30, border: 0, background: 'transparent',
                color: 'var(--muted)', cursor: 'pointer',
              }}
              aria-label="Убрать фото"
            >
              <X size={18} />
            </button>
          </div>

          {isLoading && (
            <div style={{ marginTop: 18, display: 'flex', alignItems: 'center', gap: 8, color: 'var(--muted)', fontSize: 13 }}>
              <Loader2 size={16} className="spin" />
              Ищу совпадения на складе
            </div>
          )}

          {isCreating && (
            <div style={{ marginTop: 18, display: 'flex', alignItems: 'center', gap: 8, color: 'var(--muted)', fontSize: 13 }}>
              <Loader2 size={16} className="spin" />
              Похожего на складе нет — создаю карточку как при пополнении по фото
            </div>
          )}

          {isCreated && (
            <div style={{ marginTop: 18, color: '#1f6b2d', fontSize: 13 }}>
              Похожего на основном складе не нашлось. Новая карточка создана на складе проекта.
            </div>
          )}

          {isFailed && (
            <div style={{ marginTop: 18, color: '#9b1c1c', fontSize: 13 }}>
              Попробуйте другое фото или найдите единицу обычным поиском.
            </div>
          )}

          {isCreateFailed && (
            <div style={{ marginTop: 18, color: '#9b1c1c', fontSize: 13 }}>
              {item.createError || 'Не удалось создать карточку проекта.'}
            </div>
          )}

          {!isLoading && !isCreating && !isCreated && !isFailed && !isCreateFailed && item.candidates?.length === 0 && (
            <div style={{ marginTop: 18, display: 'grid', gap: 10 }}>
              <div style={{ color: 'var(--muted)', fontSize: 13 }}>
                На основном складе не найдено уверенных совпадений. Если выбран проект, карточка создастся автоматически.
              </div>
            </div>
          )}

          {!isLoading && !isCreating && !isCreated && !isFailed && !isCreateFailed && item.candidates?.length > 0 && (
            <div style={{ marginTop: 12, display: 'grid', gap: 8 }}>
              <div style={{ display: 'grid', gap: 6 }}>
                {item.candidates.map(candidate => {
                  const selectedElsewhere = selectedIds.includes(candidate.id) && !candidate.selected
                  return (
                    <div
                      key={candidate.id}
                      className="photo-transfer-candidate"
                      style={{
                        display: 'grid', gridTemplateColumns: '34px 46px 1fr auto', gap: 10,
                        alignItems: 'center', border: '1px solid var(--border)', borderRadius: 8,
                        padding: 8, background: candidate.selected ? '#f4fbf5' : 'var(--white)',
                        opacity: selectedElsewhere ? 0.48 : 1,
                      }}
                    >
                      <button
                        onClick={() => !selectedElsewhere && onToggle(candidate.id)}
                        disabled={selectedElsewhere}
                        style={{
                          width: 26, height: 26, borderRadius: 6,
                          border: candidate.selected ? '1px solid #2f7d3c' : '1px solid var(--border)',
                          background: candidate.selected ? '#2f7d3c' : 'var(--white)',
                          color: '#fff', display: 'inline-flex', alignItems: 'center',
                          justifyContent: 'center', cursor: selectedElsewhere ? 'default' : 'pointer',
                        }}
                        aria-label="Выбрать единицу"
                      >
                        {candidate.selected && <CheckCircle2 size={17} />}
                      </button>
                      <button
                        onClick={() => onOpenCard(candidate.id)}
                        style={{
                          width: 46, height: 46, borderRadius: 6, overflow: 'hidden',
                          border: '1px solid var(--border)', background: 'var(--bg-secondary)',
                          padding: 0, cursor: 'pointer',
                        }}
                      >
                        {candidate.photo_thumb_url || candidate.photo_url
                          ? <img src={candidate.photo_thumb_url || candidate.photo_url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                          : <PackageCheck size={20} style={{ margin: 12, color: 'var(--muted)' }} />}
                      </button>
                      <button
                        onClick={() => onOpenCard(candidate.id)}
                        style={{
                          minWidth: 0, textAlign: 'left', border: 0, background: 'transparent',
                          padding: 0, cursor: 'pointer',
                        }}
                      >
                        <div style={{ fontWeight: 600, fontSize: 14, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {candidate.name}
                        </div>
                        <div style={{ color: 'var(--muted)', fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {candidate.serial || 'без номера'}
                          {candidate.cell_custom || candidate.cell_code ? ` · ${candidate.cell_custom || candidate.cell_code}` : ''}
                          {candidate.warehouse_name ? ` · ${candidate.warehouse_name}` : ''}
                        </div>
                      </button>
                      <div className="photo-transfer-candidate-badge" style={{
                        fontSize: 11, fontWeight: 700, color: candidate._photo_match_label === 'точное' ? '#2f7d3c' : '#9a6a18',
                        background: candidate._photo_match_label === 'точное' ? '#eef8f0' : '#fff7e0',
                        borderRadius: 999, padding: '4px 8px', whiteSpace: 'nowrap',
                      }}>
                        {selectedElsewhere ? 'уже выбрано' : candidate._photo_match_label}
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
