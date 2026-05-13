// Пакетное пополнение склада: выбираем сразу много фото — каждое становится
// отдельной карточкой единицы с AI-распознаванием.
//
// Слияние карточек:
//   1) Автогруппировка по identical-name (после recognize) — самый явный кейс.
//   2) Ручной мерж: drag-and-drop карточки на другую (десктоп) либо кнопка
//      «Объединить» → bottom-sheet выбора целевой (мобилка / любой size).
//   После любого мержа — undo-toast 6 сек.
//
// Что заполняется AI: name, category, period, description.
// НЕ заполняется AI: valuation, dimensions.
import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Camera, Trash2, AlertCircle, Check, Loader2, GitMerge, X, Sparkles } from 'lucide-react'
import WarehouseLayout from './WarehouseLayout'
import Button from '../shared/Button'
import { projectUnits as projectUnitsApi, units as unitsApi } from '../../services/api'
import { ACTIVE_CATEGORIES, categoryLabel } from '../../constants/categories'
import { CLOTHING_SIZES_INT, CLOTHING_SIZES_RU, SHOE_SIZES, IS_SIZED_CAT, IS_SHOES_CAT } from '../../constants/clothingSizes'
import { removeBgWhite, preloadBgModel, describeBgError, describeBgSkipped } from '../../utils/removeBg'
import { useToast } from '../shared/Toast'

const MAX_PHOTO_SIDE = 1568
const PHOTO_QUALITY = 0.85
const RECOGNIZE_CONCURRENCY = 2
const RECOGNIZE_RETRIES = 2
const MAX_PHOTOS_PER_CARD = 5
// Карточка с >1 фото считается уже сформированной — её МОЖНО ПОПОЛНЯТЬ
// (быть target слияния), но НЕЛЬЗЯ ПЕРЕТАСКИВАТЬ В ДРУГИЕ (не может быть source).
// Фото не «утекают» из карточек, в которых они уже сгруппированы — только
// добавляются.
const MAX_PHOTOS_FOR_MERGE_SOURCE = 1
const UNDO_TIMEOUT_MS = 6000

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
  return 'b_' + Math.random().toString(36).slice(2) + Date.now().toString(36)
}

function normalizeName(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, '')
    .replace(/\s+/g, ' ')
    .trim()
}

const STOP_WORDS = new Set([
  'для', 'или', 'под', 'над', 'без', 'при', 'как', 'это', 'тот', 'эта', 'его', 'ее',
  'чёрный', 'черный', 'белый', 'белая', 'серый', 'серая', 'красный', 'синий',
  'малый', 'малая', 'большой', 'большая', 'новый', 'новая', 'старый', 'старая',
])

function normalizeSearchText(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[^a-zа-я0-9]+/gi, ' ')
    .trim()
}

function wordsOf(value) {
  return normalizeSearchText(value)
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

function defaultSizeState(category) {
  return {
    size_kind: IS_SHOES_CAT(category) ? 'shoe' : 'clothing',
    size_region: 'ru',
  }
}

function buildQueries(name) {
  const words = wordsOf(name)
  return [
    normalizeSearchText(name),
    words.slice(0, 2).join(' '),
    ...words.slice(0, 4),
  ].filter(Boolean).filter((q, idx, arr) => arr.indexOf(q) === idx)
}

function candidateScore(unit, recognized, queryIndex) {
  const unitName = normalizeSearchText(unit.name)
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

async function findCandidates(recognized) {
  const queries = buildQueries(recognized.name).slice(0, 4)
  const responses = await Promise.all(
    queries.map((query, index) =>
      unitsApi.listBulkMatch({ search: query, status: 'on_stock', scope: 'common', photo_match_available: '1' }).then(response => ({ response, index }))
    )
  )
  const collected = []
  for (const { response, index } of responses) {
    for (const unit of response.units || []) {
      if (unit.misplaced || unit.is_project_kept || unit.project_id || unit.on_loan_to_project_id || unit.pending_transfer || unit.status !== 'on_stock') continue
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
    .slice(0, 3)
}
async function recognizeWithRetry(formData, retries = RECOGNIZE_RETRIES) {
  let lastError
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await unitsApi.recognizeBulk(formData)
    } catch (err) {
      lastError = err
      if (attempt >= retries) break
      await new Promise(resolve => setTimeout(resolve, 700 * (attempt + 1)))
    }
  }
  throw lastError
}

const css = `
@keyframes bulk-spin { to { transform: rotate(360deg); } }
.spin { animation: bulk-spin 0.9s linear infinite; }

.bulk-page { padding: 28px 32px; max-width: 1200px; }
.bulk-head { display: flex; align-items: center; gap: 12px; margin-bottom: 8px; }
.bulk-back {
  background: none; border: none; cursor: pointer;
  width: 32px; height: 32px;
  display: flex; align-items: center; justify-content: center;
  color: var(--muted); border-radius: 8px; font-size: 22px;
}
.bulk-back:hover { background: var(--bg-secondary); color: var(--text); }
.bulk-title { font-size: 24px; font-weight: 600; letter-spacing: -0.03em; }
.bulk-sub  { color: var(--muted); font-size: 13px; margin-bottom: 18px; padding-left: 44px; }

.bulk-actions {
  display: flex; gap: 10px; flex-wrap: wrap; align-items: center;
  margin-bottom: 14px;
}
.bulk-pick-btn {
  display: inline-flex; align-items: center; gap: 8px;
  height: 44px; padding: 0 18px;
  border-radius: var(--radius-btn);
  background: var(--ink-950); color: #fff;
  border: none; cursor: pointer;
  font-size: 14px; font-weight: 500; font-family: inherit;
  transition: background 0.12s;
}
.bulk-pick-btn:hover { background: var(--ink-800); }
.bulk-counter {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 0 12px; height: 44px;
  font-size: 13px; color: var(--muted);
}
.bulk-counter b { color: var(--text); font-weight: 600; }
.bulk-whitebg {
  display: inline-flex; align-items: center; gap: 6px;
  height: 44px; padding: 0 12px;
  font-size: 13px; color: var(--text);
  border: 1px solid var(--border);
  border-radius: var(--radius-btn);
  cursor: pointer;
  user-select: none;
}
.bulk-whitebg input { width: 16px; height: 16px; accent-color: var(--accent); cursor: pointer; }
.bulk-whitebg:has(input:checked) { background: var(--gold-50, #FAF6E8); border-color: var(--accent); }
.bulk-whitebg:has(input:disabled) { opacity: 0.55; cursor: not-allowed; }
.bulk-hint {
  font-size: 12px; color: var(--muted);
  background: var(--bg-secondary); padding: 6px 12px;
  border-radius: 8px;
}

.bulk-merge-info {
  display: flex; align-items: center; gap: 8px;
  padding: 10px 12px;
  border-radius: var(--radius-card);
  background: var(--gold-100, #FFF7E0);
  color: var(--gold-600, #C9A55C);
  border: 1px solid var(--gold-500, #C9A55C);
  font-size: 13px;
  margin-bottom: 14px;
}
.bulk-merge-info b { font-weight: 600; }
.bulk-merge-info .bulk-merge-close {
  margin-left: auto;
  background: none; border: none; cursor: pointer;
  color: inherit; padding: 4px;
  display: flex; align-items: center;
}

.bulk-empty {
  text-align: center; color: var(--muted);
  padding: 60px 20px;
  border: 1px dashed var(--border);
  border-radius: var(--radius-card);
  background: var(--card, var(--white));
}
.bulk-empty b { color: var(--text); font-weight: 600; display: block; font-size: 15px; margin-bottom: 4px; }

.bulk-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 14px;
}
@media (max-width: 1024px) { .bulk-grid { grid-template-columns: repeat(2, 1fr); } }
@media (max-width: 640px)  { .bulk-grid { grid-template-columns: 1fr; gap: 10px; } }

.bulk-card {
  position: relative;
  border-radius: var(--radius-card);
  border: 2px solid var(--border);
  background: var(--card, var(--white));
  overflow: hidden;
  display: flex; flex-direction: column;
  transition: border-color 0.12s, opacity 0.12s, transform 0.12s;
}
.bulk-card.failed { border-color: var(--red); }
.bulk-card.saved  { border-color: var(--green, #10b981); }
.bulk-card.saving { opacity: 0.85; }
.bulk-card.draggable { cursor: grab; }
.bulk-card.draggable:active { cursor: grabbing; }
.bulk-card.dragging {
  opacity: 0.5;
  transform: scale(0.97);
}
.bulk-card.drop-target {
  border-color: var(--gold-500, #C9A55C);
  box-shadow: 0 0 0 4px var(--gold-100, #FFF7E0);
}
.bulk-card.drop-blocked {
  border-color: var(--red);
  box-shadow: 0 0 0 4px var(--red-bg, rgba(239,68,68,0.08));
}

.bulk-card-thumb {
  width: 100%;
  aspect-ratio: 1;
  background: var(--bg-secondary);
  position: relative;
  overflow: hidden;
}
.bulk-card-thumb img { width: 100%; height: 100%; object-fit: cover; display: block; }
.bulk-card-status-overlay {
  position: absolute; inset: 0;
  display: flex; align-items: center; justify-content: center;
  background: rgba(255,255,255,0.7);
  backdrop-filter: blur(2px);
  color: var(--ink-900);
  font-size: 12px; font-weight: 500;
  gap: 6px;
}
.bulk-card-drop-overlay {
  position: absolute; inset: 0;
  display: flex; align-items: center; justify-content: center;
  background: rgba(201,165,92,0.18);
  color: var(--gold-600, #C9A55C);
  font-size: 13px; font-weight: 600;
  gap: 6px; pointer-events: none;
}
.bulk-card-drop-overlay.blocked {
  background: rgba(239,68,68,0.18);
  color: var(--red);
}
.bulk-match-preview {
  position: fixed;
  z-index: 10000;
  width: 220px;
  max-width: calc(100vw - 16px);
  border-radius: 10px;
  border: 1px solid var(--border);
  background: var(--white);
  box-shadow: 0 18px 48px rgba(0,0,0,0.28);
  overflow: hidden;
  pointer-events: none;
}
.bulk-match-preview img {
  width: 100%;
  aspect-ratio: 1;
  display: block;
  object-fit: cover;
  background: var(--bg-secondary);
}
.bulk-match-preview-name {
  padding: 7px 9px;
  border-top: 1px solid var(--border);
  font-size: 12px;
  font-weight: 700;
  color: var(--text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
@media (max-width: 640px) {
  .bulk-match-preview { width: 170px; }
}

.bulk-card-actions {
  position: absolute; top: 8px; right: 8px;
  display: flex; gap: 4px;
  z-index: 2;
}
.bulk-card-icon-btn {
  width: 30px; height: 30px;
  border-radius: 8px;
  background: rgba(0,0,0,0.5);
  border: none; cursor: pointer;
  color: #fff;
  display: flex; align-items: center; justify-content: center;
  transition: background 0.12s;
  padding: 0;
}
.bulk-card-icon-btn:hover { background: rgba(0,0,0,0.75); }
.bulk-card-icon-btn:disabled { opacity: 0.4; cursor: not-allowed; }

.bulk-photo-count {
  position: absolute; top: 8px; left: 8px;
  padding: 4px 8px;
  border-radius: 8px;
  background: rgba(0,0,0,0.55);
  color: #fff;
  font-size: 11px; font-weight: 600;
  letter-spacing: 0.02em;
  display: flex; align-items: center; gap: 4px;
}

.bulk-card-body {
  padding: 12px;
  display: flex; flex-direction: column; gap: 8px;
  flex: 1;
}
.bulk-field-label {
  font-size: 11px; color: var(--muted);
  text-transform: uppercase; letter-spacing: 0.04em;
  font-weight: 500;
}
.bulk-input, .bulk-select, .bulk-textarea {
  width: 100%;
  padding: 8px 10px;
  border: 1px solid var(--border);
  border-radius: var(--radius-btn);
  background: var(--white);
  font-size: 13px;
  font-family: inherit;
  outline: none;
  box-sizing: border-box;
  transition: border-color 0.12s;
}
.bulk-input:focus, .bulk-select:focus, .bulk-textarea:focus {
  border-color: var(--gold-500);
}
.bulk-textarea { resize: vertical; min-height: 56px; }
.bulk-row {
  display: grid;
  grid-template-columns: 1fr 80px;
  gap: 8px;
}

.bulk-card-error {
  margin: 0 12px 12px;
  padding: 8px 10px;
  border-radius: 6px;
  background: var(--red-bg, rgba(239,68,68,0.08));
  color: var(--red);
  font-size: 12px;
  display: flex; align-items: flex-start; gap: 6px;
}

.bulk-footer {
  position: sticky; bottom: 0;
  background: var(--paper);
  padding: 14px 0 8px;
  margin-top: 18px;
  border-top: 1px solid var(--border);
  display: flex; justify-content: space-between; align-items: center;
  gap: 12px;
}
.bulk-summary { font-size: 13px; color: var(--muted); }
.bulk-summary b { color: var(--text); font-weight: 600; }

/* Bottom-sheet выбора целевой карточки для мерджа */
.bulk-sheet-overlay {
  position: fixed; inset: 0; z-index: 400;
  background: rgba(10,10,10,0.55);
  backdrop-filter: blur(3px);
  display: flex; align-items: flex-end; justify-content: center;
}
.bulk-sheet {
  background: var(--card, var(--white));
  width: 100%; max-width: 600px;
  max-height: 80vh;
  border-radius: 18px 18px 0 0;
  padding: 8px 16px max(20px, env(safe-area-inset-bottom));
  display: flex; flex-direction: column;
}
.bulk-sheet-handle {
  width: 36px; height: 4px; border-radius: 4px;
  background: var(--border-strong); margin: 8px auto 12px;
}
.bulk-sheet-title { font-size: 15px; font-weight: 600; margin-bottom: 4px; }
.bulk-sheet-sub { font-size: 12px; color: var(--muted); margin-bottom: 12px; }
.bulk-sheet-list { overflow-y: auto; display: flex; flex-direction: column; gap: 6px; }
.bulk-sheet-item {
  display: flex; align-items: center; gap: 12px;
  padding: 10px;
  border-radius: 10px;
  border: 1px solid var(--border);
  background: var(--white);
  cursor: pointer;
  text-align: left;
  font-family: inherit;
  width: 100%;
  transition: border-color 0.12s, background 0.12s;
}
.bulk-sheet-item:hover:not(:disabled) {
  border-color: var(--gold-500);
  background: var(--gold-100, #FFF7E0);
}
.bulk-sheet-item:disabled { opacity: 0.45; cursor: not-allowed; }
.bulk-sheet-thumb {
  width: 48px; height: 48px;
  border-radius: 8px; overflow: hidden;
  background: var(--bg-secondary); flex-shrink: 0;
}
.bulk-sheet-thumb img { width: 100%; height: 100%; object-fit: cover; }
.bulk-sheet-info { flex: 1; min-width: 0; }
.bulk-sheet-name {
  font-size: 14px; font-weight: 500; color: var(--text);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.bulk-sheet-sub-text { font-size: 11px; color: var(--muted); }

/* Undo-toast */
.bulk-toast {
  position: fixed;
  bottom: 80px;
  left: 50%; transform: translateX(-50%);
  background: var(--ink-900);
  color: #fff;
  padding: 10px 14px 10px 16px;
  border-radius: 12px;
  font-size: 13px;
  display: flex; align-items: center; gap: 12px;
  box-shadow: 0 10px 32px rgba(0,0,0,0.3);
  z-index: 500;
  max-width: 90vw;
}
.bulk-toast button {
  background: transparent; border: 1px solid rgba(255,255,255,0.3);
  color: #fff; padding: 4px 10px; border-radius: 6px;
  font-size: 12px; font-weight: 600; cursor: pointer; font-family: inherit;
}
.bulk-toast button:hover { background: rgba(255,255,255,0.1); }

@media (max-width: 768px) {
  .bulk-page { padding: 14px 12px; max-width: none; }
  .bulk-head {
    position: sticky; top: var(--page-sticky-top, 52px); z-index: 12;
    background: var(--paper);
    margin: -14px -12px 8px;
    padding: 12px 14px;
    border-bottom: 1px solid var(--border);
  }
  .bulk-title { font-size: 18px; }
  .bulk-sub { padding-left: 0; padding: 0 12px 14px; }
  .bulk-footer {
    margin: 18px -12px 0;
    padding: 12px;
    bottom: calc(70px + env(safe-area-inset-bottom, 0px));
    z-index: 50;
  }
  .bulk-toast {
    bottom: calc(140px + env(safe-area-inset-bottom, 0px));
  }
}
`

export default function BulkUploadPage() {
  const navigate = useNavigate()
  const fileInputRef = useRef()
  const toast = useToast()

  // items: [{ temp_id, files: File[], status, name, category, qty, period, description, ... }]
  const [items, setItems] = useState([])
  const [submitting, setSubmitting] = useState(false)
  const [globalError, setGlobalError] = useState('')
  const [targetMode, setTargetMode] = useState('warehouse')
  const [projects, setProjects] = useState([])
  const [projectId, setProjectId] = useState('')

  useEffect(() => {
    projectUnitsApi.allProjects()
      .then(r => {
        const list = r.projects || []
        setProjects(list)
        setProjectId(prev => prev || list[0]?.id || '')
      })
      .catch(() => setProjects([]))
  }, [])

  // Тоггл «Сделать белый фон» — общий ключ localStorage с другими модалками.
  // Каждое распознанное фото перед сохранением прогоняется через rembg-sidecar.
  const [whiteBg, setWhiteBg] = useState(() => {
    try { return localStorage.getItem('whiteBgEnabled') === '1' } catch { return false }
  })
  function toggleWhiteBg() {
    const next = !whiteBg
    setWhiteBg(next)
    try { localStorage.setItem('whiteBgEnabled', next ? '1' : '0') } catch { /* private mode */ }
    if (next) preloadBgModel().catch(() => {})  // прогрев sidecar
  }
  // Прогрев при mount если тоггл уже был включён.
  useEffect(() => {
    if (whiteBg) preloadBgModel().catch(() => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  // Дедуп тостов про bg: «фон не распознан» / «не удалось обработать фон» —
  // показываем по одному за пакет, чтобы при 50 фото не было 50 одинаковых.
  // Сбрасываем когда пачка очистилась (юзер начинает заново).
  const bgToastShownRef = useRef({ skip: false, err: false })
  useEffect(() => {
    if (items.length === 0) bgToastShownRef.current = { skip: false, err: false }
  }, [items.length])

  // Авто-мерж счётчик (для плашки сверху).
  const [autoMerged, setAutoMerged] = useState(0)
  const [autoMergedDismissed, setAutoMergedDismissed] = useState(false)

  // DnD: id перетаскиваемой карточки и id целевой (для подсветки drop-target).
  const [draggingId, setDraggingId] = useState(null)
  const [dragOverId, setDragOverId] = useState(null)

  // Bottom-sheet ручного мерджа.
  const [mergeFromId, setMergeFromId] = useState(null)

  // Undo: сохраняем состояние удалённой карточки и сколько фото добавили в target.
  const [undoState, setUndoState] = useState(null)  // { item, target_id, addedCount, kind }
  const undoTimerRef = useRef(null)
  const matchTimersRef = useRef(new Map())
  const successHandledRef = useRef(false)

  function addFiles(files) {
    if (!files?.length) return
    const newItems = files.map(file => ({
      temp_id: makeTempId(),
      files: [file],
      status: 'recognizing',
      name: '',
      category: 'other',
      qty: 1,
      period: '',
      description: '',
      dimensions: '',
      size_kind: 'clothing',
      size_region: 'ru',
      valuation: '',
      matches: [],
      dedup_dismissed: false,
      existingUnit: null,
    }))
    setItems(arr => [...arr, ...newItems])
    for (const it of newItems) enqueueRecognize(it)
  }

  const queueRef = useRef({ active: 0, pending: [] })
  function enqueueRecognize(item) {
    const q = queueRef.current
    q.pending.push(item)
    drainQueue()
  }
  function drainQueue() {
    const q = queueRef.current
    while (q.active < RECOGNIZE_CONCURRENCY && q.pending.length) {
      const it = q.pending.shift()
      q.active++
      recognizeOne(it).finally(() => {
        q.active--
        drainQueue()
      })
    }
  }

  async function recognizeOne(item) {
    let finalFile = item.files[0]
    try {
      const compressed = await compressImage(item.files[0])
      // Удаление фона — между сжатием и AI-распознаванием. Распознаём и
      // сохраняем один и тот же finalFile, чтобы пользователь видел именно
      // тот файл, который потом попадёт в карточку.
      finalFile = compressed
      if (whiteBg) {
        try {
          const out = await removeBgWhite(compressed, { bulkFlow: true })
          finalFile = out
          if (out?._bgSkipped && !bgToastShownRef.current.skip) {
            bgToastShownRef.current.skip = true
            toast?.(describeBgSkipped(out._bgSkipped), 'warning')
          }
        } catch (err) {
          console.error('Bulk bg removal failed:', err?.code, err?.message)
          if (!bgToastShownRef.current.err) {
            bgToastShownRef.current.err = true
            toast?.(describeBgError(err), 'error')
          }
        }
      }
      const fd = new FormData()
      fd.append('photos', finalFile)
      const r = await recognizeWithRetry(fd)
      let matches = []
      if (r.name) {
        try { matches = await findCandidates(r) }
        catch { matches = [] }
      }
      const recognizedCategory = r.category || 'other'
      setItems(arr => arr.map(x => x.temp_id === item.temp_id ? {
        ...x,
        files: [finalFile],
        status: 'ready',
        name: r.name || '',
        category: recognizedCategory,
        period: r.period || '',
        description: r.description || '',
        dimensions: x.dimensions || '',
        ...defaultSizeState(recognizedCategory),
        valuation: x.valuation || '',
        matches,
        dedup_dismissed: matches.length === 0,
        existingUnit: null,
        _matchQuery: normalizeSearchText(r.name || ''),
      } : x))
    } catch {
      setItems(arr => arr.map(x => x.temp_id === item.temp_id
        ? { ...x, files: finalFile ? [finalFile] : x.files, status: 'failed', name: x.name || '', category: x.category || 'other' }
        : x))
    }
  }

  // Авто-мерж: одинаковое нормализованное имя + категория.
  useEffect(() => {
    if (items.length < 2) return
    if (items.some(x => x.status === 'recognizing')) return

    const groups = new Map()
    const toMerge = new Map()
    const toRemove = new Set()
    let mergedCount = 0

    for (const it of items) {
      if (it.status !== 'ready') continue
      if (!it.name || !it.name.trim()) continue
      const key = `${normalizeName(it.name)}|${it.category || 'other'}`
      const firstId = groups.get(key)
      if (!firstId) {
        groups.set(key, it.temp_id)
        continue
      }
      const firstCount = (toMerge.get(firstId)?.length || 0)
        + (items.find(x => x.temp_id === firstId)?.files.length || 0)
      if (firstCount + it.files.length > MAX_PHOTOS_PER_CARD) continue
      const prev = toMerge.get(firstId) || []
      toMerge.set(firstId, [...prev, ...it.files])
      toRemove.add(it.temp_id)
      mergedCount++
    }

    if (toRemove.size === 0) return
    setItems(arr => arr
      .map(x => {
        if (toMerge.has(x.temp_id)) {
          const extra = toMerge.get(x.temp_id)
          return { ...x, files: [...x.files, ...extra] }
        }
        return x
      })
      .filter(x => !toRemove.has(x.temp_id))
    )
    setAutoMerged(prev => prev + mergedCount)
    setAutoMergedDismissed(false)
  }, [items])

  function updateItem(temp_id, patch) {
    setItems(arr => arr.map(x => x.temp_id === temp_id ? { ...x, ...patch } : x))
  }
  useEffect(() => {
    for (const item of items) {
      const queryKey = normalizeSearchText(item.name)
      if (item.status !== 'ready') continue
      if (item.existingUnit) continue
      if (queryKey.length < 3) continue
      if (item._matchQuery === queryKey) continue

      const prevTimer = matchTimersRef.current.get(item.temp_id)
      if (prevTimer) clearTimeout(prevTimer)
      updateItem(item.temp_id, { _matchQuery: queryKey })
      const timer = setTimeout(() => {
        matchTimersRef.current.delete(item.temp_id)
        findCandidates({ name: item.name, category: item.category })
          .then(matches => {
            setItems(arr => arr.map(x => x.temp_id === item.temp_id && x._matchQuery === queryKey ? {
              ...x,
              matches,
              dedup_dismissed: matches.length === 0,
            } : x))
          })
          .catch(() => {
            setItems(arr => arr.map(x => x.temp_id === item.temp_id && x._matchQuery === queryKey ? {
              ...x,
              matches: [],
              dedup_dismissed: true,
            } : x))
          })
      }, 450)
      matchTimersRef.current.set(item.temp_id, timer)
    }
  }, [items])
  function removeCard(temp_id) {
    setItems(arr => arr.filter(x => x.temp_id !== temp_id))
  }

  // Ядро мерджа: переносим все файлы fromId → targetId, fromId-карточка
  // удаляется, target сохраняет своё имя/описание/категорию.
  // Возвращает true при успехе.
  function mergeCards(fromId, targetId) {
    if (!fromId || !targetId || fromId === targetId) return false
    let success = false
    let undoSnapshot = null
    setItems(arr => {
      const target = arr.find(x => x.temp_id === targetId)
      const from = arr.find(x => x.temp_id === fromId)
      if (!target || !from) return arr
      // Запрещаем мерж если статус не 'ready' / 'failed' (в-flight операции).
      const movableStatuses = new Set(['ready', 'failed'])
      if (!movableStatuses.has(target.status) || !movableStatuses.has(from.status)) return arr
      // Source-карточка с >1 фото — уже сформирована, перенос запрещён.
      if (from.files.length > MAX_PHOTOS_FOR_MERGE_SOURCE) {
        setGlobalError('Карточку с несколькими фото нельзя перенести — только пополнять её.')
        setTimeout(() => setGlobalError(''), 3500)
        return arr
      }
      if (target.files.length + from.files.length > MAX_PHOTOS_PER_CARD) {
        setGlobalError(`Достигнут лимит ${MAX_PHOTOS_PER_CARD} фото на карточку. Слияние отменено.`)
        setTimeout(() => setGlobalError(''), 3500)
        return arr
      }
      // Собираем undo-снимок до изменений.
      undoSnapshot = {
        item: { ...from, files: [...from.files] },
        target_id: targetId,
        addedCount: from.files.length,
        kind: 'merge',
      }
      success = true
      return arr
        .map(x => x.temp_id === targetId
          ? { ...x, files: [...x.files, ...from.files] }
          : x
        )
        .filter(x => x.temp_id !== fromId)
    })
    if (success && undoSnapshot) scheduleUndo(undoSnapshot)
    return success
  }

  function scheduleUndo(snapshot) {
    if (undoTimerRef.current) clearTimeout(undoTimerRef.current)
    setUndoState(snapshot)
    undoTimerRef.current = setTimeout(() => {
      setUndoState(null)
      undoTimerRef.current = null
    }, UNDO_TIMEOUT_MS)
  }

  function applyUndo() {
    if (!undoState) return
    const { item, target_id, addedCount } = undoState
    setItems(arr => {
      // Восстанавливаем from-карточку и убираем из target последние addedCount файлов.
      const targetIdx = arr.findIndex(x => x.temp_id === target_id)
      if (targetIdx === -1) {
        // Целевая карточка пропала (удалена) — просто восстанавливаем from.
        return [...arr, item]
      }
      const restoredTarget = {
        ...arr[targetIdx],
        files: arr[targetIdx].files.slice(0, arr[targetIdx].files.length - addedCount),
      }
      const next = [...arr]
      next[targetIdx] = restoredTarget
      next.push(item)
      return next
    })
    setUndoState(null)
    if (undoTimerRef.current) { clearTimeout(undoTimerRef.current); undoTimerRef.current = null }
  }

  useEffect(() => () => {
    if (undoTimerRef.current) clearTimeout(undoTimerRef.current)
    for (const timer of matchTimersRef.current.values()) clearTimeout(timer)
    matchTimersRef.current.clear()
  }, [])

  function handlePick(ev) {
    const files = Array.from(ev.target.files || [])
    addFiles(files)
    ev.target.value = ''
  }

  // DnD handlers
  function onDragStart(e, id) {
    setDraggingId(id)
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/plain', id)
  }
  function onDragEnd() {
    setDraggingId(null)
    setDragOverId(null)
  }
  function onDragOver(e, id) {
    if (!draggingId || draggingId === id) return
    e.preventDefault()
    setDragOverId(id)
  }
  function onDragLeave(id) {
    setDragOverId(prev => prev === id ? null : prev)
  }
  function onDrop(e, targetId) {
    e.preventDefault()
    const fromId = e.dataTransfer.getData('text/plain') || draggingId
    setDraggingId(null)
    setDragOverId(null)
    mergeCards(fromId, targetId)
  }

  const stats = useMemo(() => {
    const ready = items.filter(x => x.status === 'ready').length
    const recognizing = items.filter(x => x.status === 'recognizing').length
    const failed = items.filter(x => x.status === 'failed').length
    const saved = items.filter(x => x.status === 'saved').length
    return { total: items.length, ready, recognizing, failed, saved }
  }, [items])
  const selectedProject = projects.find(p => String(p.id) === String(projectId))
  const existingCount = items.filter(x => x.status === 'ready' && x.existingUnit).length
  const newCount = items.filter(x => x.status === 'ready' && !x.existingUnit && x.name.trim().length >= 1).length

  const canSave = !submitting
    && stats.recognizing === 0
    && (targetMode !== 'project' || Boolean(projectId))
    && items.some(x => x.status === 'ready' && (x.existingUnit || x.name.trim().length >= 1))

  async function handleSave() {
    if (!canSave) return
    successHandledRef.current = false
    setSubmitting(true)
    setGlobalError('')
    try {
      const queue = items.filter(x => x.status === 'ready' && (x.existingUnit || x.name.trim().length >= 1))
      const movedExistingIds = new Set()
      for (const it of queue) {
        updateItem(it.temp_id, { status: 'saving', _saveError: undefined })
        try {
          if (it.existingUnit) {
            if (it.files.length) {
              const fd = new FormData()
              for (const f of it.files) fd.append('photos', f)
              fd.append('type', 'stock')
              await unitsApi.uploadPhotoBulk(it.existingUnit.id, fd)
            }
            if (targetMode === 'project') {
              if (!movedExistingIds.has(it.existingUnit.id)) {
                await projectUnitsApi.moveToProjectBulk([it.existingUnit.id], projectId)
                movedExistingIds.add(it.existingUnit.id)
              }
            }
            updateItem(it.temp_id, { status: 'saved', unit_id: it.existingUnit.id })
          } else if (targetMode === 'project') {
            const fd = new FormData()
            fd.append('project_id', projectId)
            fd.append('name', it.name.trim())
            fd.append('category', it.category || 'other')
            fd.append('qty', String(Math.max(1, Number(it.qty) || 1)))
            fd.append('description', it.description?.trim() || '')
            fd.append('period', it.period?.trim() || '')
            fd.append('dimensions', it.dimensions?.trim() || '')
            fd.append('valuation', it.valuation ? String(it.valuation) : '')
            for (const f of it.files) fd.append('photos', f)
            const { unit } = await projectUnitsApi.createForProjectPhotosBulk(fd)
            updateItem(it.temp_id, { status: 'saved', unit_id: unit?.id })
          } else {
            const { unit } = await unitsApi.createBulk({
              name: it.name.trim(),
              category: it.category || 'other',
              qty: Math.max(1, Number(it.qty) || 1),
              description: it.description?.trim() || null,
              period: it.period?.trim() || null,
              dimensions: it.dimensions?.trim() || null,
              valuation: it.valuation ? Number(it.valuation) : null,
            })
            if (unit?.id && it.files.length) {
              const fd = new FormData()
              for (const f of it.files) fd.append('photos', f)
              fd.append('type', 'stock')
              try {
                await unitsApi.uploadPhotoBulk(unit.id, fd)
              } catch (e) {
                console.warn('photo upload failed for', unit.id, e)
              }
            }
            updateItem(it.temp_id, { status: 'saved', unit_id: unit?.id })
          }
        } catch (err) {
          updateItem(it.temp_id, { status: 'error', _saveError: err?.message || 'Ошибка сохранения' })
        }
      }
    } catch (err) {
      setGlobalError(err?.message || 'Не удалось сохранить пачку')
    } finally {
      setSubmitting(false)
    }
  }

  useEffect(() => {
    if (!submitting && items.length > 0
      && items.every(x => x.status === 'saved' || x.status === 'failed' || x.status === 'error')
      && items.some(x => x.status === 'saved')
      && !items.some(x => x.status === 'error')) {
      if (successHandledRef.current) return
      successHandledRef.current = true
      toast?.('Склад успешно пополнен', 'success')
      const target = targetMode === 'project'
        ? `/production/project-warehouse?tab=colleagues&project_id=${encodeURIComponent(projectId)}`
        : '/units'
      const t = setTimeout(() => navigate(target), 1200)
      return () => clearTimeout(t)
    }
  }, [items, submitting, navigate, targetMode, projectId, toast])

  const mergeFromItem = mergeFromId ? items.find(x => x.temp_id === mergeFromId) : null

  return (
    <WarehouseLayout>
      <style>{css}</style>
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        multiple
        style={{ display: 'none' }}
        onChange={handlePick}
      />

      <div className="bulk-page">
        <div className="bulk-head">
          <button className="bulk-back" onClick={() => navigate(-1)} aria-label="Назад">←</button>
          <h1 className="bulk-title">Пакетное пополнение</h1>
        </div>
        <div className="bulk-sub">
          Каждое фото — отдельная карточка. AI попытается автоматически объединить
          одинаковые предметы по названию. Если AI не справился — перетащите карточку
          на главную (на десктопе) или используйте кнопку <b>«Объединить»</b> на самой
          карточке (на телефоне). Сумма и размеры заполняются вручную потом.
        </div>

        <div className="bulk-actions">
          <button className="bulk-pick-btn" onClick={() => fileInputRef.current?.click()}>
            <Camera size={16} />
            {items.length === 0 ? 'Выбрать фото' : 'Добавить ещё'}
          </button>
          <label className="bulk-whitebg" title="При добавлении фото удалит фон вокруг предмета. Обработка на сервере, 1–3 сек на фото.">
            <input
              type="checkbox"
              checked={whiteBg}
              onChange={toggleWhiteBg}
              disabled={submitting}
            />
            <Sparkles size={14} color={whiteBg ? 'var(--accent)' : 'var(--muted)'} strokeWidth={1.6} />
            <span>Белый фон</span>
          </label>
          <div style={{
            display: 'inline-flex', alignItems: 'center', gap: 6, height: 44,
            padding: 4, border: '1px solid var(--border)', borderRadius: 'var(--radius-btn)',
            background: 'var(--white)',
          }}>
            <button
              type="button"
              onClick={() => setTargetMode('warehouse')}
              disabled={submitting}
              style={{
                height: 34, padding: '0 10px', border: 0, borderRadius: 7,
                background: targetMode === 'warehouse' ? 'var(--ink-950)' : 'transparent',
                color: targetMode === 'warehouse' ? '#fff' : 'var(--text)',
                cursor: submitting ? 'default' : 'pointer', fontWeight: 600,
              }}
            >
              Основной склад
            </button>
            <button
              type="button"
              onClick={() => setTargetMode('project')}
              disabled={submitting}
              style={{
                height: 34, padding: '0 10px', border: 0, borderRadius: 7,
                background: targetMode === 'project' ? 'var(--ink-950)' : 'transparent',
                color: targetMode === 'project' ? '#fff' : 'var(--text)',
                cursor: submitting ? 'default' : 'pointer', fontWeight: 600,
              }}
            >
              Склад проекта
            </button>
          </div>
          {targetMode === 'project' && (
            <select
              value={projectId}
              onChange={e => setProjectId(e.target.value)}
              disabled={submitting || projects.length === 0}
              style={{
                height: 44, minWidth: 220, maxWidth: 340,
                border: '1px solid var(--border)', borderRadius: 'var(--radius-btn)',
                background: 'var(--white)', padding: '0 12px', fontSize: 14,
              }}
            >
              {projects.map(project => (
                <option key={project.id} value={project.id}>{project.name}</option>
              ))}
            </select>
          )}
          {items.length > 0 && (
            <div className="bulk-counter">
              <b>{stats.ready}</b> готово
              {stats.recognizing > 0 && <> · <b>{stats.recognizing}</b> в обработке{whiteBg ? ' (фон + AI)' : ''}</>}
              {stats.failed > 0 && <> · <b>{stats.failed}</b> не распознано</>}
              {stats.saved > 0 && <> · <b>{stats.saved}</b> сохранено</>}
            </div>
          )}
        </div>

        {autoMerged > 0 && !autoMergedDismissed && (
          <div className="bulk-merge-info">
            <Check size={16} />
            <span>
              Автоматически объединено похожих фото в одну карточку: <b>{autoMerged}</b>
            </span>
            <button className="bulk-merge-close" onClick={() => setAutoMergedDismissed(true)} aria-label="Закрыть">
              <X size={14} />
            </button>
          </div>
        )}

        {globalError && (
          <div className="bulk-card-error" style={{ margin: '0 0 14px' }}>
            <AlertCircle size={14} /> {globalError}
          </div>
        )}

        {items.length === 0 ? (
          <div className="bulk-empty">
            <b>Пока пусто</b>
            Тапните «Выбрать фото» — можно сразу несколько штук. Каждая карточка появится отдельно.
          </div>
        ) : (
          <div className="bulk-grid">
            {items.map(it => (
              <BulkCard
                key={it.temp_id}
                item={it}
                onChange={(patch) => {
                  const nextName = patch.name != null ? patch.name : it.name
                  const shouldMarkReady = it.status === 'failed' && nextName.trim()
                  updateItem(it.temp_id, shouldMarkReady ? { ...patch, status: 'ready', dedup_dismissed: false } : patch)
                }}
                onPickExisting={(unit) => updateItem(it.temp_id, { existingUnit: unit })}
                onClearExisting={() => updateItem(it.temp_id, { existingUnit: null })}
                onDismissMatches={() => updateItem(it.temp_id, { dedup_dismissed: true, existingUnit: null })}
                onRemoveCard={() => removeCard(it.temp_id)}
                onOpenMergePicker={() => setMergeFromId(it.temp_id)}
                disabled={submitting}
                draggingId={draggingId}
                dragOverId={dragOverId}
                onDragStart={(e) => onDragStart(e, it.temp_id)}
                onDragEnd={onDragEnd}
                onDragOver={(e) => onDragOver(e, it.temp_id)}
                onDragLeave={() => onDragLeave(it.temp_id)}
                onDrop={(e) => onDrop(e, it.temp_id)}
              />
            ))}
          </div>
        )}

        {items.length > 0 && (
          <div className="bulk-footer">
            <div className="bulk-summary">
              {stats.ready === 0
                ? 'Дождитесь распознавания…'
                : <>
                    Будет создано <b>{newCount}</b> {pluralize(newCount, ['единица', 'единицы', 'единиц'])}
                    {existingCount > 0 ? <> · выбрано из базы <b>{existingCount}</b></> : null}
                    {targetMode === 'project' && selectedProject ? <> · {selectedProject.name}</> : null}
                  </>}
            </div>
            <Button
              size="lg"
              loading={submitting}
              disabled={!canSave}
              onClick={handleSave}
            >
              Сохранить
            </Button>
          </div>
        )}
      </div>

      {mergeFromItem && (
        <MergePickerSheet
          fromItem={mergeFromItem}
          items={items}
          onPick={(targetId) => {
            const ok = mergeCards(mergeFromItem.temp_id, targetId)
            if (ok) setMergeFromId(null)
          }}
          onClose={() => setMergeFromId(null)}
        />
      )}

      {undoState && (
        <div className="bulk-toast">
          <span>Карточки объединены</span>
          <button onClick={applyUndo}>Отменить</button>
        </div>
      )}
    </WarehouseLayout>
  )
}

function BulkCard({
  item, onChange, onPickExisting, onClearExisting, onDismissMatches, onRemoveCard, onOpenMergePicker, disabled,
  draggingId, dragOverId,
  onDragStart, onDragEnd, onDragOver, onDragLeave, onDrop,
}) {
  const previewSrc = useMemo(
    () => item.files[0] ? URL.createObjectURL(item.files[0]) : null,
    [item.files]
  )
  useEffect(() => () => { if (previewSrc) URL.revokeObjectURL(previewSrc) }, [previewSrc])
  const [hoverPreview, setHoverPreview] = useState(null)

  const isProcessing = item.status === 'recognizing' || item.status === 'saving'
  const isFinal = item.status === 'saved'
  const isExisting = Boolean(item.existingUnit)
  const showMatches = item.status === 'ready'
    && !isExisting
    && !item.dedup_dismissed
    && (item.matches?.length || 0) > 0
  // Source: только если карточка ровно с 1 фото (нельзя перетаскивать
  // карточки, в которых уже сгруппированы ракурсы).
  const canBeSource = !disabled && !isProcessing && !isFinal
    && (item.status === 'ready' || item.status === 'failed')
    && item.files.length <= 1
  // Target: любая ready/failed карточка (валидация лимита 5 — в mergeCards).
  const canBeTarget = !disabled && !isProcessing && !isFinal
    && (item.status === 'ready' || item.status === 'failed')
  const isDragging = draggingId === item.temp_id
  const isDragOver = dragOverId === item.temp_id && draggingId && draggingId !== item.temp_id
  const wouldExceedLimit = false

  const cardClass = [
    'bulk-card',
    item.status === 'failed' && 'failed',
    isFinal && 'saved',
    item.status === 'saving' && 'saving',
    canBeSource && 'draggable',
    isDragging && 'dragging',
    isDragOver && (wouldExceedLimit ? 'drop-blocked' : 'drop-target'),
  ].filter(Boolean).join(' ')

  function matchPreviewPayload(unit, event) {
    const src = unit.photo_url || unit.photo_thumb_url
    if (!src) return null
    return { src, name: unit.name || '', x: event.clientX, y: event.clientY }
  }

  function showMatchPreview(unit, event) {
    const payload = matchPreviewPayload(unit, event)
    if (payload) setHoverPreview(payload)
  }

  function moveMatchPreview(event) {
    setHoverPreview(prev => prev ? { ...prev, x: event.clientX, y: event.clientY } : prev)
  }

  function focusMatchPreview(unit, event) {
    const src = unit.photo_url || unit.photo_thumb_url
    if (!src) return
    const rect = event.currentTarget.getBoundingClientRect()
    setHoverPreview({ src, name: unit.name || '', x: rect.right, y: rect.top })
  }

  function hideMatchPreview() {
    setHoverPreview(null)
  }

  const previewLeft = hoverPreview
    ? Math.max(8, Math.min(hoverPreview.x + 16, (typeof window === 'undefined' ? hoverPreview.x + 16 : window.innerWidth - 236)))
    : 0
  const previewTop = hoverPreview
    ? Math.max(8, Math.min(hoverPreview.y + 16, (typeof window === 'undefined' ? hoverPreview.y + 16 : window.innerHeight - 260)))
    : 0

  return (
    <div
      className={cardClass}
      draggable={canBeSource}
      onDragStart={canBeSource ? onDragStart : undefined}
      onDragEnd={canBeSource ? onDragEnd : undefined}
      onDragOver={canBeTarget ? onDragOver : undefined}
      onDragLeave={canBeTarget ? onDragLeave : undefined}
      onDrop={canBeTarget ? onDrop : undefined}
    >
      <div className="bulk-card-thumb">
        {previewSrc && <img src={previewSrc} alt="" />}
        {item.files.length > 1 && (
          <div className="bulk-photo-count">{item.files.length} фото</div>
        )}
        {item.status === 'recognizing' && (
          <div className="bulk-card-status-overlay">
            <Loader2 size={14} className="spin" /> распознаю…
          </div>
        )}
        {item.status === 'saving' && (
          <div className="bulk-card-status-overlay">
            <Loader2 size={14} className="spin" /> сохраняю…
          </div>
        )}
        {isFinal && (
          <div className="bulk-card-status-overlay" style={{ background: 'rgba(16,185,129,0.15)', color: 'var(--green, #10b981)' }}>
            <Check size={16} /> сохранено
          </div>
        )}
        {isDragOver && (
          <div className="bulk-card-drop-overlay">
            <GitMerge size={18} /> объединить сюда
          </div>
        )}
        {!isProcessing && !isFinal && (
          <div className="bulk-card-actions">
            {canBeSource && (
              <button
                className="bulk-card-icon-btn"
                onClick={onOpenMergePicker}
                disabled={disabled}
                aria-label="Объединить с другой"
                title="Объединить с другой карточкой"
              ><GitMerge size={14} /></button>
            )}
            <button
              className="bulk-card-icon-btn"
              onClick={onRemoveCard}
              disabled={disabled}
              aria-label="Удалить"
            ><Trash2 size={14} /></button>
          </div>
        )}
      </div>

      <div className="bulk-card-body">
        <div>
          <div className="bulk-field-label">Название</div>
          <input
            className="bulk-input"
            placeholder={item.status === 'failed' ? 'AI не распознал — введите' : 'Название'}
            value={isExisting ? item.existingUnit.name : item.name}
            onChange={e => onChange({ name: e.target.value })}
            disabled={disabled || isProcessing || isFinal || isExisting}
          />
        </div>

        <div className="bulk-row">
          <div>
            <div className="bulk-field-label">Категория</div>
            <select
              className="bulk-select"
              value={isExisting ? item.existingUnit.category : (item.category || 'other')}
              onChange={e => {
                const category = e.target.value
                onChange({ category, dimensions: '', ...defaultSizeState(category) })
              }}
              disabled={disabled || isProcessing || isFinal || isExisting}
            >
              {ACTIVE_CATEGORIES.map(c => (
                <option key={c} value={c}>{categoryLabel(c)}</option>
              ))}
            </select>
          </div>
          <div>
            <div className="bulk-field-label">Кол-во</div>
            <input
              type="number"
              min="1"
              className="bulk-input"
              value={isExisting ? (item.existingUnit.qty || 1) : item.qty}
              onChange={e => onChange({ qty: Math.max(1, Number(e.target.value) || 1) })}
              disabled={disabled || isProcessing || isFinal || isExisting}
            />
          </div>
        </div>

        {isExisting && (
          <div style={{
            border: '1px solid #b7dfbf', background: '#eef8f0', borderRadius: 8,
            padding: 8, display: 'grid', gap: 6,
          }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: '#1f6b2d' }}>
              Выбрана похожая единица из базы
            </div>
            <div style={{ fontSize: 12, color: 'var(--muted)' }}>
              {item.existingUnit.serial || 'без номера'}
              {item.existingUnit.cell_custom || item.existingUnit.cell_code ? ` · ${item.existingUnit.cell_custom || item.existingUnit.cell_code}` : ''}
              {item.existingUnit.warehouse_name ? ` · ${item.existingUnit.warehouse_name}` : ''}
            </div>
            <button
              type="button"
              onClick={onClearExisting}
              disabled={disabled || isProcessing || isFinal}
              style={{
                justifySelf: 'start', border: '1px solid #b7dfbf', background: '#fff',
                color: '#1f6b2d', borderRadius: 6, padding: '4px 8px', cursor: 'pointer',
                fontSize: 12, fontWeight: 700,
              }}
            >
              Вернуть AI-карточку
            </button>
          </div>
        )}

        {showMatches && (
          <div style={{
            border: '1px solid var(--gold-500, #C9A55C)', background: 'var(--gold-100, #FFF7E0)',
            borderRadius: 8, padding: 8, display: 'grid', gap: 6,
          }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--gold-600, #9a6a18)' }}>
              Возможно, уже есть на складе
            </div>
            {item.matches.map(unit => (
              <button
                key={unit.id}
                type="button"
                onClick={() => { hideMatchPreview(); onPickExisting(unit) }}
                onMouseEnter={e => showMatchPreview(unit, e)}
                onMouseMove={moveMatchPreview}
                onMouseLeave={hideMatchPreview}
                onFocus={e => focusMatchPreview(unit, e)}
                onBlur={hideMatchPreview}
                disabled={disabled || isProcessing || isFinal}
                style={{
                  display: 'grid', gridTemplateColumns: '38px 1fr auto', gap: 8,
                  alignItems: 'center', border: '1px solid var(--border)', borderRadius: 7,
                  background: 'var(--white)', padding: 6, textAlign: 'left', cursor: 'pointer',
                }}
              >
                <div style={{ width: 38, height: 38, borderRadius: 5, overflow: 'hidden', background: 'var(--bg-secondary)' }}>
                  {(unit.photo_thumb_url || unit.photo_url) && (
                    <img src={unit.photo_thumb_url || unit.photo_url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                  )}
                </div>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 12, fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {unit.name}
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {unit.serial || 'без номера'}
                    {unit.cell_custom || unit.cell_code ? ` · ${unit.cell_custom || unit.cell_code}` : ''}
                  </div>
                </div>
                <span style={{
                  fontSize: 10, fontWeight: 800, color: unit._photo_match_label === 'точное' ? '#2f7d3c' : '#9a6a18',
                  whiteSpace: 'nowrap',
                }}>
                  {unit._photo_match_label}
                </span>
              </button>
            ))}
            {hoverPreview && (
              <div className="bulk-match-preview" style={{ left: previewLeft, top: previewTop }}>
                <img src={hoverPreview.src} alt="" />
                <div className="bulk-match-preview-name">{hoverPreview.name}</div>
              </div>
            )}
            <button
              type="button"
              onClick={onDismissMatches}
              disabled={disabled || isProcessing || isFinal}
              style={{
                justifySelf: 'start', border: '1px solid var(--gold-500, #C9A55C)',
                background: 'transparent', color: 'var(--gold-600, #9a6a18)',
                borderRadius: 6, padding: '4px 8px', cursor: 'pointer',
                fontSize: 12, fontWeight: 700,
              }}
            >
              Это новая карточка
            </button>
          </div>
        )}

        {!isExisting && (
          <>
            <div>
              <div className="bulk-field-label">Описание</div>
              <textarea
                className="bulk-textarea"
                rows={2}
                placeholder="Цвет, материал, состояние, детали"
                value={item.description || ''}
                onChange={e => onChange({ description: e.target.value })}
                disabled={disabled || isProcessing || isFinal}
              />
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              <div>
                <div className="bulk-field-label">Эпоха</div>
                <input
                  className="bulk-input"
                  value={item.period || ''}
                  onChange={e => onChange({ period: e.target.value })}
                  disabled={disabled || isProcessing || isFinal}
                />
              </div>
              <div>
                <div className="bulk-field-label">Стоимость</div>
                <input
                  type="number"
                  min="0"
                  className="bulk-input"
                  value={item.valuation || ''}
                  onChange={e => onChange({ valuation: e.target.value })}
                  disabled={disabled || isProcessing || isFinal}
                />
              </div>
            </div>

            <BulkSizePicker
              item={item}
              onChange={onChange}
              disabled={disabled || isProcessing || isFinal}
            />
          </>
        )}
      </div>

      {item._saveError && (
        <div className="bulk-card-error">
          <AlertCircle size={14} /> {item._saveError}
        </div>
      )}
    </div>
  )
}

function BulkSizePicker({ item, onChange, disabled }) {
  const category = item.category || 'other'
  if (!IS_SIZED_CAT(category)) return null

  const lockKind = IS_SHOES_CAT(category)
  const kind = lockKind ? 'shoe' : (item.size_kind || 'clothing')
  const region = item.size_region || 'ru'
  const options = kind === 'shoe'
    ? SHOE_SIZES
    : (region === 'ru' ? CLOTHING_SIZES_RU : CLOTHING_SIZES_INT)

  const chipStyle = (active) => ({
    padding: '6px 12px',
    fontSize: 12,
    borderRadius: 'var(--radius-btn)',
    border: '1px solid var(--border)',
    background: active ? 'var(--accent)' : 'var(--white)',
    color: active ? '#fff' : 'var(--text)',
    cursor: disabled ? 'default' : 'pointer',
    fontWeight: active ? 600 : 400,
  })

  return (
    <div>
      <div className="bulk-field-label" style={{ marginBottom: 6 }}>Размер</div>
      {!lockKind && (
        <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
          <button
            type="button"
            onClick={() => onChange({ size_kind: 'clothing', size_region: 'ru', dimensions: '' })}
            disabled={disabled}
            style={chipStyle(kind === 'clothing')}
          >
            Одежда
          </button>
          <button
            type="button"
            onClick={() => onChange({ size_kind: 'shoe', size_region: 'ru', dimensions: '' })}
            disabled={disabled}
            style={chipStyle(kind === 'shoe')}
          >
            Обувь
          </button>
        </div>
      )}
      {kind === 'clothing' && (
        <div style={{
          display: 'inline-flex', gap: 0, marginBottom: 10,
          border: '1px solid var(--border)', borderRadius: 'var(--radius-btn)',
          overflow: 'hidden', background: 'var(--bg-secondary)',
        }}>
          {['ru', 'int'].map(r => (
            <button
              key={r}
              type="button"
              onClick={() => onChange({ size_region: r, dimensions: '' })}
              disabled={disabled}
              style={{
                padding: '5px 14px', fontSize: 11.5, fontWeight: 600, border: 'none',
                background: region === r ? 'var(--white)' : 'transparent',
                color: region === r ? 'var(--gold-700, var(--gold-600))' : 'var(--muted)',
                cursor: disabled ? 'default' : 'pointer',
                boxShadow: region === r ? '0 1px 2px rgba(0,0,0,0.06)' : 'none',
              }}
            >
              {r.toUpperCase()}
            </button>
          ))}
        </div>
      )}
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {options.map(size => (
          <button
            key={size}
            type="button"
            onClick={() => onChange({ dimensions: size })}
            disabled={disabled}
            style={chipStyle(item.dimensions === size)}
          >
            {size}
          </button>
        ))}
      </div>
    </div>
  )
}

// Bottom-sheet: выбираем целевую карточку для слияния.
function MergePickerSheet({ fromItem, items, onPick, onClose }) {
  const fromPreview = useMemo(
    () => fromItem.files[0] ? URL.createObjectURL(fromItem.files[0]) : null,
    [fromItem.files]
  )
  useEffect(() => () => { if (fromPreview) URL.revokeObjectURL(fromPreview) }, [fromPreview])

  const candidates = items.filter(x =>
    x.temp_id !== fromItem.temp_id
    && (x.status === 'ready' || x.status === 'failed')
  )

  return (
    <div className="bulk-sheet-overlay" onClick={onClose}>
      <div className="bulk-sheet" onClick={e => e.stopPropagation()}>
        <div className="bulk-sheet-handle" />
        <div className="bulk-sheet-title">Объединить с какой карточкой?</div>
        <div className="bulk-sheet-sub">
          Текущая карточка <b>«{fromItem.name || 'без названия'}»</b> исчезнет, а её фото
          добавятся к выбранной (главной).
        </div>
        <div className="bulk-sheet-list">
          {candidates.length === 0 && (
            <div style={{ padding: 20, textAlign: 'center', color: 'var(--muted)', fontSize: 13 }}>
              Нет других готовых карточек для слияния.
            </div>
          )}
          {candidates.map(c => {
            const remaining = MAX_PHOTOS_PER_CARD - c.files.length
            const willFit = fromItem.files.length <= remaining
            return (
              <MergeSheetItem
                key={c.temp_id}
                item={c}
                disabled={!willFit}
                disabledReason={!willFit ? `+${fromItem.files.length} фото не влезет (лимит ${MAX_PHOTOS_PER_CARD})` : null}
                onClick={() => onPick(c.temp_id)}
              />
            )
          })}
        </div>
      </div>
    </div>
  )
}

function MergeSheetItem({ item, disabled, disabledReason, onClick }) {
  const src = useMemo(
    () => item.files[0] ? URL.createObjectURL(item.files[0]) : null,
    [item.files]
  )
  useEffect(() => () => { if (src) URL.revokeObjectURL(src) }, [src])
  return (
    <button className="bulk-sheet-item" onClick={onClick} disabled={disabled}>
      <div className="bulk-sheet-thumb">
        {src && <img src={src} alt="" />}
      </div>
      <div className="bulk-sheet-info">
        <div className="bulk-sheet-name">{item.name || 'Без названия'}</div>
        <div className="bulk-sheet-sub-text">
          {categoryLabel(item.category)} · {item.files.length} {pluralize(item.files.length, ['фото', 'фото', 'фото'])}
          {disabledReason && ` · ${disabledReason}`}
        </div>
      </div>
    </button>
  )
}

function pluralize(n, [one, few, many]) {
  const mod10 = n % 10
  const mod100 = n % 100
  if (mod10 === 1 && mod100 !== 11) return one
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few
  return many
}
