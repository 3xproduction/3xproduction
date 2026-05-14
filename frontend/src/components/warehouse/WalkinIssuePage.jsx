// Walk-in выдача со склада: визард на 4 экрана для случая, когда сотрудник
// проекта приехал лично, ни сам он, ни вещи ещё не в БД.
//
// Экран 1 — Проект: existing autocomplete ИЛИ создать новый (+ project_director).
// Экран 2 — Получатель: роль/ФИО/телефон/email + autocomplete по людям проекта.
// Экран 3 — Корзина: фото→AI создаёт карточку→накапливаем; правка по тапу.
// Экран 4 — Подпись: deadline + SignatureCanvas получателя + штамп выдавшего.
//
// Submit → один POST /walkin/issue (multipart) который в одной транзакции
// создаёт project (если новый) + project_director (provisional) + получателя
// (provisional) + N юнитов (status='issued', is_walkin=true) + issuance + PDF.
import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Camera, Search, Trash2, X } from 'lucide-react'
import WarehouseLayout from './WarehouseLayout'
import Button from '../shared/Button'
import Input from '../shared/Input'
import SignatureCanvas from '../shared/SignatureCanvas'
import ConfirmModal from '../shared/ConfirmModal'
import { walkin as walkinApi, units as unitsApi } from '../../services/api'

const RECEIVER_ROLE_OPTIONS = [
  { value: 'production_designer',     label: 'Художник-постановщик' },
  { value: 'art_director_assistant',  label: 'Ассистент художника-постановщика' },
  { value: 'props_master',            label: 'Реквизитор' },
  { value: 'props_assistant',         label: 'Ассистент по реквизиту' },
  { value: 'costumer',                label: 'Костюмер' },
  { value: 'costume_designer',        label: 'Художник по костюмам' },
  { value: 'costume_assistant',       label: 'Ассистент по костюмам' },
  { value: 'decorator',               label: 'Декоратор' },
  { value: 'extra_worker',            label: 'Доп. рабочий' },
]

const STEPS = ['Проект', 'Получатель', 'Корзина', 'Подпись']

const MAX_PHOTO_SIDE = 1568
const PHOTO_QUALITY = 0.85

// Compress on client (Canvas: max 1568px, JPEG 85). Тот же подход что в IssuePage.
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
  // RFC4122 не нужен — нужен уникальный id для multipart-поля photos_<id>.
  return 'u_' + Math.random().toString(36).slice(2) + Date.now().toString(36)
}

function todayPlus(days) {
  const d = new Date(Date.now() + days * 86400000)
  return d.toISOString().slice(0, 10)
}

export default function WalkinIssuePage() {
  const navigate = useNavigate()
  const [step, setStep] = useState(0)
  const [submitting, setSubmitting] = useState(false)
  const [apiError, setApiError] = useState('')

  // ── Шаг 1: Проект ──
  const [projectMode, setProjectMode] = useState('new') // 'new' | 'existing'
  const [projectQuery, setProjectQuery] = useState('')
  const [projectMatches, setProjectMatches] = useState([])
  const [chosenProject, setChosenProject] = useState(null) // { id, name }
  const [newProjectName, setNewProjectName] = useState('')
  const [directorName, setDirectorName] = useState('')
  const [directorPhone, setDirectorPhone] = useState('')
  const [directorEmail, setDirectorEmail] = useState('')

  useEffect(() => {
    if (projectMode !== 'existing') return
    if (projectQuery.trim().length < 2) { setProjectMatches([]); return }
    const t = setTimeout(() => {
      walkinApi.searchProjects(projectQuery.trim())
        .then(r => setProjectMatches(r.projects || []))
        .catch(() => setProjectMatches([]))
    }, 200)
    return () => clearTimeout(t)
  }, [projectQuery, projectMode])

  // ── Шаг 2: Получатель ──
  const [receiverRole, setReceiverRole] = useState('props_master')
  const [receiverName, setReceiverName] = useState('')
  const [receiverPhone, setReceiverPhone] = useState('')
  const [receiverEmail, setReceiverEmail] = useState('')
  const [chosenReceiver, setChosenReceiver] = useState(null)
  const [userMatches, setUserMatches] = useState([])

  useEffect(() => {
    const projectId = chosenProject?.id
    if (!projectId || receiverName.trim().length < 2 || chosenReceiver) {
      setUserMatches([])
      return
    }
    const t = setTimeout(() => {
      walkinApi.searchUsers(projectId, receiverName.trim())
        .then(r => setUserMatches(r.users || []))
        .catch(() => setUserMatches([]))
    }, 200)
    return () => clearTimeout(t)
  }, [receiverName, chosenProject?.id, chosenReceiver])

  // ── Шаг 3: Корзина ──
  // Каждая позиция:
  //   • Новая (фото+AI): { temp_id, file, status, name, category, qty, ... }
  //   • Из базы:          { temp_id, existing_id, name, category, qty, photo_url, _existing: true }
  const [items, setItems] = useState([])
  const [editingId, setEditingId] = useState(null)
  const [existingPickerOpen, setExistingPickerOpen] = useState(false)
  // Подтверждение замены AI-карточки на existing-юнит из дедуп-предложения.
  // null или { tempId, unit }.
  const [confirmReplace, setConfirmReplace] = useState(null)
  const fileInputRef = useRef()

  function addPhoto(file) {
    const temp_id = makeTempId()
    setItems(arr => [...arr, {
      temp_id, file, status: 'recognizing',
      name: '', category: '', qty: 1,
      description: '', period: '', dimensions: '',
      matches: [], dedup_dismissed: false,
    }])
    // AI-распознавание + параллельный поиск дублей в базе.
    ;(async () => {
      try {
        const compressed = await compressImage(file)
        const fd = new FormData()
        fd.append('photos', compressed)
        const r = await unitsApi.recognize(fd)

        // Дедуп: ищем по AI-имени среди on_stock. Бэкенд возвращает _match:
        //   • direct  — название содержит запрос (точное вхождение)
        //   • similar — название содержит близкий синоним
        //   • related — только категория совпала (отбрасываем — слишком слабо)
        // Сначала direct, потом similar; берём топ-3 итого. Дополнительно ищем
        // по первому значимому слову — поможет когда AI вернул фразу из 2-3
        // слов, а в базе единица называется одним словом.
        let matches = []
        if (r.name) {
          try {
            const tryQueries = [r.name]
            const firstWord = r.name.split(/\s+/).find(w => w.length >= 3)
            if (firstWord && firstWord !== r.name) tryQueries.push(firstWord)

            const seen = new Set()
            const direct = [], similar = []
            for (const q of tryQueries) {
              const sr = await unitsApi.list({ search: q, status: 'on_stock' })
              for (const u of (sr.units || [])) {
                if (seen.has(u.id) || u.misplaced || u.is_project_kept) continue
                seen.add(u.id)
                if (u._match === 'direct') direct.push(u)
                else if (u._match === 'similar') similar.push(u)
              }
              if (direct.length >= 3) break
            }
            matches = [...direct, ...similar].slice(0, 3)
          } catch {
            matches = []
          }
        }

        setItems(arr => arr.map(x => x.temp_id === temp_id ? {
          ...x,
          file: compressed,
          status: 'ready',
          name: r.name || 'Без названия',
          category: r.category || 'other',
          description: r.description || '',
          period: r.period || '',
          matches,
        } : x))
      } catch {
        setItems(arr => arr.map(x => x.temp_id === temp_id
          ? { ...x, status: 'failed', name: x.name || 'Не распознано', category: x.category || 'other' }
          : x))
      }
    })()
  }

  function removeItem(id) {
    setItems(arr => arr.filter(x => x.temp_id !== id))
  }

  function updateItem(id, patch) {
    setItems(arr => arr.map(x => x.temp_id === id ? { ...x, ...patch } : x))
  }

  function addExisting(unit) {
    // Не дублируем — если уже выбран этот юнит, игнорируем тап.
    setItems(arr => arr.some(x => x.existing_id === unit.id) ? arr : [
      ...arr,
      {
        temp_id: makeTempId(),
        existing_id: unit.id,
        _existing: true,
        status: 'ready',
        file: null,
        name: unit.name,
        category: unit.category,
        qty: unit.qty || 1,
        photo_url: unit.photo_url || null,
        serial: unit.serial,
        matches: [], dedup_dismissed: true,
      },
    ])
  }

  // Заменить новую (фото-AI) карточку на existing-юнит — когда юзер
  // подтверждает что AI совпал с уже учтённым.
  function replaceWithExisting(tempId, unit) {
    setItems(arr => arr.map(x => x.temp_id === tempId ? {
      temp_id: x.temp_id,
      existing_id: unit.id,
      _existing: true,
      status: 'ready',
      file: null,
      name: unit.name,
      category: unit.category,
      qty: unit.qty || 1,
      photo_url: unit.photo_url || null,
      serial: unit.serial,
      matches: [], dedup_dismissed: true,
    } : x))
  }

  function dismissDedup(tempId) {
    setItems(arr => arr.map(x => x.temp_id === tempId ? { ...x, dedup_dismissed: true } : x))
  }

  // Сколько карточек с неразрешённым подозрением на дубль — для предупреждения на step 3.
  const unresolvedDupCount = items.filter(x =>
    !x._existing && x.status === 'ready' && (x.matches?.length || 0) > 0 && !x.dedup_dismissed
  ).length

  // ── Шаг 4: Подпись ──
  const [deadline, setDeadline] = useState(todayPlus(7))
  const [signatureData, setSignatureData] = useState(null)
  const [stamped, setStamped] = useState(false)

  // ── Валидация шагов ──
  function step0Valid() {
    if (projectMode === 'existing') return !!chosenProject
    if (projectMode === 'new') {
      return newProjectName.trim().length >= 2
        && directorName.trim().length >= 2
        && directorPhone.trim().length >= 4
        && (!directorEmail || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(directorEmail))
    }
    return false
  }
  function step1Valid() {
    if (chosenReceiver) return true
    return receiverName.trim().length >= 2
      && receiverPhone.trim().length >= 4
      && RECEIVER_ROLE_OPTIONS.some(o => o.value === receiverRole)
      && (!receiverEmail || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(receiverEmail))
  }
  function step2Valid() {
    return items.length > 0 && items.every(x => x.status !== 'recognizing')
  }
  function step3Valid() {
    return !!signatureData && stamped && deadline
  }

  function canForward() {
    if (step === 0) return step0Valid()
    if (step === 1) return step1Valid()
    if (step === 2) return step2Valid()
    return false
  }

  async function handleSubmit() {
    if (submitting) return
    setSubmitting(true)
    setApiError('')
    try {
      const fd = new FormData()
      fd.append('deadline', deadline)
      fd.append('signature_data', signatureData)
      fd.append('issuer_signature_data', 'stamp')

      if (projectMode === 'existing') {
        fd.append('project_id', chosenProject.id)
      } else {
        fd.append('project_name', newProjectName.trim())
        fd.append('director_name', directorName.trim())
        fd.append('director_phone', directorPhone.trim())
        if (directorEmail) fd.append('director_email', directorEmail.trim())
      }

      if (chosenReceiver) {
        fd.append('recipient_user_id', chosenReceiver.id)
      } else {
        fd.append('recipient_role', receiverRole)
        fd.append('recipient_name', receiverName.trim())
        fd.append('recipient_phone', receiverPhone.trim())
        if (receiverEmail) fd.append('recipient_email', receiverEmail.trim())
      }

      // Юниты. Existing — только existing_id; новые — temp_id + поля.
      // Файлы — отдельно полем photos_<temp_id> (multer.any() на бэке).
      const unitsPayload = items.map(x => x.existing_id ? ({
        existing_id: x.existing_id,
      }) : ({
        temp_id: x.temp_id,
        name: x.name,
        category: x.category,
        qty: x.qty,
        description: x.description,
        period: x.period,
        dimensions: x.dimensions,
      }))
      fd.append('units', JSON.stringify(unitsPayload))
      for (const x of items) {
        if (x.file && !x.existing_id) fd.append(`photos_${x.temp_id}`, x.file)
      }

      const result = await walkinApi.issue(fd)
      // PDF сохраняется в S3 и доступен через /acts. Не открываем сразу —
      // редиректим в раздел «Выдано» с раскрытым проектом этой выдачи.
      const projId = result.project_id || ''
      navigate(`/issued${projId ? `?project=${projId}` : ''}`)
    } catch (err) {
      setApiError(err?.message || 'Ошибка выдачи')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <WarehouseLayout>
      <div style={{ padding: '24px 32px', maxWidth: 700, margin: '0 auto' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 24 }}>
          <button
            onClick={() => step > 0 ? setStep(s => s - 1) : navigate(-1)}
            style={{ background: 'none', border: 'none', fontSize: 20, cursor: 'pointer', color: 'var(--muted)' }}
            aria-label="Назад"
          >←</button>
          <h1 style={{ fontSize: 18, fontWeight: 600 }}>Быстрая выдача</h1>
        </div>

        <StepIndicator step={step} />

        {step === 0 && (
          <Step0Project
            projectMode={projectMode} setProjectMode={setProjectMode}
            projectQuery={projectQuery} setProjectQuery={setProjectQuery}
            projectMatches={projectMatches}
            chosenProject={chosenProject} setChosenProject={setChosenProject}
            newProjectName={newProjectName} setNewProjectName={setNewProjectName}
            directorName={directorName} setDirectorName={setDirectorName}
            directorPhone={directorPhone} setDirectorPhone={setDirectorPhone}
            directorEmail={directorEmail} setDirectorEmail={setDirectorEmail}
          />
        )}

        {step === 1 && (
          <Step1Receiver
            receiverRole={receiverRole} setReceiverRole={setReceiverRole}
            receiverName={receiverName} setReceiverName={setReceiverName}
            receiverPhone={receiverPhone} setReceiverPhone={setReceiverPhone}
            receiverEmail={receiverEmail} setReceiverEmail={setReceiverEmail}
            chosenReceiver={chosenReceiver} setChosenReceiver={setChosenReceiver}
            userMatches={userMatches}
          />
        )}

        {step === 2 && (
          <Step2Cart
            items={items}
            onAdd={addPhoto}
            onRemove={removeItem}
            onEdit={(id) => setEditingId(id)}
            onReplaceWithExisting={(tempId, unit) => setConfirmReplace({ tempId, unit })}
            onDismissDedup={dismissDedup}
            onOpenExistingPicker={() => setExistingPickerOpen(true)}
            fileInputRef={fileInputRef}
          />
        )}

        {step === 3 && (
          <Step3Sign
            items={items}
            unresolvedDupCount={unresolvedDupCount}
            deadline={deadline} setDeadline={setDeadline}
            signatureData={signatureData} setSignatureData={setSignatureData}
            stamped={stamped} setStamped={setStamped}
          />
        )}

        {apiError && (
          <div style={{ color: 'var(--red)', fontSize: 13, marginTop: 16, textAlign: 'center' }}>
            {apiError}
          </div>
        )}

        <div style={{ display: 'flex', gap: 12, marginTop: 28 }}>
          {step < 3 && (
            <Button
              fullWidth
              disabled={!canForward()}
              onClick={() => setStep(s => s + 1)}
            >Далее →</Button>
          )}
          {step === 3 && (
            <Button
              fullWidth
              loading={submitting}
              disabled={!step3Valid()}
              onClick={handleSubmit}
            >Выдать ({items.length} {items.length === 1 ? 'единица' : 'ед.'})</Button>
          )}
        </div>

        {editingId && (
          <EditItemModal
            item={items.find(x => x.temp_id === editingId)}
            onClose={() => setEditingId(null)}
            onSave={(patch) => { updateItem(editingId, patch); setEditingId(null) }}
          />
        )}

        {existingPickerOpen && (
          <ExistingUnitsPicker
            alreadyChosenIds={items.map(x => x.existing_id).filter(Boolean)}
            onClose={() => setExistingPickerOpen(false)}
            onPick={(unit) => addExisting(unit)}
          />
        )}

        <ConfirmModal
          open={!!confirmReplace}
          title="Использовать единицу из базы?"
          message={confirmReplace
            ? `«${confirmReplace.unit.name}»${confirmReplace.unit.serial ? ` (${confirmReplace.unit.serial})` : ''} будет добавлен в выдачу из существующего складского учёта вместо новой карточки по фото.`
            : ''}
          confirmLabel="Да, из базы"
          cancelLabel="Отмена"
          danger={false}
          onConfirm={() => {
            if (confirmReplace) replaceWithExisting(confirmReplace.tempId, confirmReplace.unit)
            setConfirmReplace(null)
          }}
          onCancel={() => setConfirmReplace(null)}
        />
      </div>
    </WarehouseLayout>
  )
}

// ─── Step indicator ─────────────────────────────────────────────────────────

function StepIndicator({ step }) {
  return (
    <div style={{ display: 'flex', gap: 0, marginBottom: 28 }}>
      {STEPS.map((label, i) => (
        <div key={label} style={{ flex: 1, display: 'flex', alignItems: 'center' }}>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', flex: 1 }}>
            <div style={{
              width: 28, height: 28, borderRadius: '50%', display: 'flex',
              alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 600,
              background: i < step ? 'var(--green, #10b981)' : i === step ? 'var(--ink-950, #0A0A0A)' : 'var(--border)',
              color: i <= step ? '#fff' : 'var(--muted)',
            }}>{i < step ? '✓' : i + 1}</div>
            <div style={{ fontSize: 11, color: i === step ? 'var(--text)' : 'var(--muted)', marginTop: 4, fontWeight: i === step ? 600 : 400 }}>
              {label}
            </div>
          </div>
          {i < STEPS.length - 1 && (
            <div style={{ height: 2, flex: 1, background: i < step ? 'var(--green, #10b981)' : 'var(--border)', marginBottom: 18 }} />
          )}
        </div>
      ))}
    </div>
  )
}

// ─── Step 0: Project ────────────────────────────────────────────────────────

function Step0Project(p) {
  return (
    <div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 20 }}>
        <ToggleBtn active={p.projectMode === 'existing'} onClick={() => p.setProjectMode('existing')}>
          Существующий
        </ToggleBtn>
        <ToggleBtn active={p.projectMode === 'new'} onClick={() => p.setProjectMode('new')}>
          + Новый проект
        </ToggleBtn>
      </div>

      {p.projectMode === 'existing' && (
        <>
          <Input
            label="Поиск по названию"
            placeholder="Введите минимум 2 символа"
            value={p.projectQuery}
            onChange={e => { p.setProjectQuery(e.target.value); p.setChosenProject(null) }}
          />
          {p.chosenProject ? (
            <div style={{
              padding: 12, borderRadius: 'var(--radius-card)',
              background: 'var(--bg-secondary)', border: '1px solid var(--border)',
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            }}>
              <span style={{ fontWeight: 500 }}>{p.chosenProject.name}</span>
              <button
                onClick={() => { p.setChosenProject(null); p.setProjectQuery('') }}
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--muted)' }}
                aria-label="Снять выбор"
              ><X size={16} /></button>
            </div>
          ) : (
            p.projectMatches.length > 0 && (
              <div style={{
                border: '1px solid var(--border)', borderRadius: 'var(--radius-card)',
                background: 'var(--white)', maxHeight: 220, overflow: 'auto',
              }}>
                {p.projectMatches.map(m => (
                  <button
                    key={m.id}
                    onClick={() => { p.setChosenProject(m); p.setProjectQuery(m.name) }}
                    style={{
                      display: 'block', width: '100%', textAlign: 'left',
                      padding: '10px 12px', border: 'none', background: 'transparent',
                      cursor: 'pointer', borderBottom: '1px solid var(--border)',
                      fontSize: 14,
                    }}
                  >{m.name}</button>
                ))}
              </div>
            )
          )}
        </>
      )}

      {p.projectMode === 'new' && (
        <>
          <Input
            label="Название проекта"
            placeholder="Кино «Костюм 17 века»"
            value={p.newProjectName}
            onChange={e => p.setNewProjectName(e.target.value)}
          />
          <div style={{ marginTop: 8, marginBottom: 12, fontSize: 12, color: 'var(--muted)', fontWeight: 600 }}>
            ДИРЕКТОР ПРОЕКТА
          </div>
          <Input
            label="ФИО директора проекта"
            placeholder="Иванов Иван Иванович"
            value={p.directorName}
            onChange={e => p.setDirectorName(e.target.value)}
          />
          <Input
            label="Телефон"
            placeholder="+7 999 000 00 00"
            value={p.directorPhone}
            onChange={e => p.setDirectorPhone(e.target.value)}
          />
          <Input
            label="Email (опционально)"
            type="email"
            placeholder="director@example.com"
            value={p.directorEmail}
            onChange={e => p.setDirectorEmail(e.target.value)}
          />
          <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: -8, marginBottom: 16 }}>
            Если указан — директор получит письмо со ссылкой для активации управления проектом.
          </div>
        </>
      )}
    </div>
  )
}

// ─── Step 1: Receiver ───────────────────────────────────────────────────────

function Step1Receiver(p) {
  return (
    <div>
      <label style={{ display: 'block', fontSize: 13, fontWeight: 500, marginBottom: 6 }}>
        Роль
      </label>
      <select
        value={p.receiverRole}
        onChange={e => { p.setReceiverRole(e.target.value); p.setChosenReceiver(null) }}
        disabled={!!p.chosenReceiver}
        style={{
          width: '100%', height: 40, padding: '0 12px',
          border: '1px solid var(--border)', borderRadius: 'var(--radius-btn)',
          background: 'var(--white)', fontSize: 14, marginBottom: 16,
        }}
      >
        {RECEIVER_ROLE_OPTIONS.map(o => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>

      <Input
        label="ФИО"
        placeholder="Петров Пётр Петрович"
        value={p.receiverName}
        onChange={e => { p.setReceiverName(e.target.value); p.setChosenReceiver(null) }}
      />
      {p.chosenReceiver && (
        <div style={{
          padding: 10, borderRadius: 'var(--radius-card)',
          background: 'var(--bg-secondary)', border: '1px solid var(--border)',
          fontSize: 13, marginTop: -8, marginBottom: 16,
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        }}>
          <span>Используется существующий: <b>{p.chosenReceiver.name}</b></span>
          <button
            onClick={() => p.setChosenReceiver(null)}
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--muted)' }}
            aria-label="Снять выбор"
          ><X size={14} /></button>
        </div>
      )}
      {!p.chosenReceiver && p.userMatches.length > 0 && (
        <div style={{
          border: '1px solid var(--border)', borderRadius: 'var(--radius-card)',
          background: 'var(--white)', maxHeight: 180, overflow: 'auto', marginTop: -8, marginBottom: 16,
        }}>
          {p.userMatches.map(u => (
            <button
              key={u.id}
              onClick={() => p.setChosenReceiver(u)}
              style={{
                display: 'block', width: '100%', textAlign: 'left',
                padding: '8px 12px', border: 'none', background: 'transparent',
                cursor: 'pointer', borderBottom: '1px solid var(--border)', fontSize: 13,
              }}
            >
              <div style={{ fontWeight: 500 }}>{u.name}</div>
              <div style={{ color: 'var(--muted)', fontSize: 11 }}>
                {u.role} · {u.phone || u.email || '—'}
                {u.is_provisional && ' · не активирован'}
              </div>
            </button>
          ))}
        </div>
      )}

      <Input
        label="Телефон"
        placeholder="+7 999 000 00 00"
        value={p.receiverPhone}
        onChange={e => p.setReceiverPhone(e.target.value)}
        disabled={!!p.chosenReceiver}
      />
      <Input
        label="Email (опционально)"
        type="email"
        placeholder="receiver@example.com"
        value={p.receiverEmail}
        onChange={e => p.setReceiverEmail(e.target.value)}
        disabled={!!p.chosenReceiver}
      />
      {!p.chosenReceiver && (
        <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: -8 }}>
          Если указан — придёт PDF выдачи + ссылка для активации аккаунта.
        </div>
      )}
    </div>
  )
}

// ─── Step 2: Cart ───────────────────────────────────────────────────────────

function Step2Cart({ items, onAdd, onRemove, onEdit, onReplaceWithExisting, onDismissDedup, onOpenExistingPicker, fileInputRef }) {
  function handleFile(ev) {
    const files = Array.from(ev.target.files || [])
    for (const f of files) onAdd(f)
    ev.target.value = ''
  }
  return (
    <div>
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        multiple
        style={{ display: 'none' }}
        onChange={handleFile}
      />
      <div style={{ display: 'flex', gap: 8 }}>
        <Button
          fullWidth
          size="lg"
          onClick={() => fileInputRef.current?.click()}
        >
          <Camera size={18} /> Снять
        </Button>
        <Button
          fullWidth
          size="lg"
          variant="secondary"
          onClick={onOpenExistingPicker}
        >
          <Search size={18} /> Из базы
        </Button>
      </div>

      {items.length === 0 && (
        <div style={{ textAlign: 'center', color: 'var(--muted)', fontSize: 13, padding: '40px 0' }}>
          Снимите фото или выберите вещь из базы — карточка появится в корзине.
        </div>
      )}

      <div style={{ marginTop: 16, display: 'flex', flexDirection: 'column', gap: 8 }}>
        {items.map(x => {
          const hasUnresolvedDups = !x._existing && x.status === 'ready'
            && (x.matches?.length || 0) > 0 && !x.dedup_dismissed
          // Цвет рамки: жёлтая = есть нерешённые совпадения; зелёная = из базы; серая = новая.
          const borderColor = hasUnresolvedDups
            ? 'var(--gold-500, #C9A55C)'
            : x._existing ? 'var(--green, #10b981)' : 'var(--border)'
          const borderWidth = hasUnresolvedDups || x._existing ? 2 : 1
          return (
            <div
              key={x.temp_id}
              style={{
                borderRadius: 'var(--radius-card)',
                border: `${borderWidth}px solid ${borderColor}`,
                background: 'var(--white)', overflow: 'hidden',
              }}
            >
              <div
                onClick={() => !x._existing && x.status !== 'recognizing' && onEdit(x.temp_id)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 12, padding: 10,
                  cursor: !x._existing && x.status !== 'recognizing' ? 'pointer' : 'default',
                }}
              >
                <ItemThumb item={x} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  {x.status === 'recognizing' ? (
                    <div style={{ color: 'var(--muted)', fontSize: 13 }}>⏳ распознаю…</div>
                  ) : (
                    <>
                      <div style={{ fontWeight: 500, fontSize: 14, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'flex', alignItems: 'center', gap: 6 }}>
                        {hasUnresolvedDups && <span title="Возможно, дубль" style={{ fontSize: 13 }}>⚠️</span>}
                        {x._existing && <span title="Из базы" style={{ fontSize: 13, color: 'var(--green, #10b981)' }}>🔗</span>}
                        {x.name || 'Без названия'}
                      </div>
                      <div style={{ fontSize: 12, color: 'var(--muted)' }}>
                        {x.category} · ×{x.qty}
                        {x._existing && ' · из базы'}
                        {x.status === 'failed' && ' · AI не распознал — отредактируйте'}
                      </div>
                    </>
                  )}
                </div>
                <button
                  onClick={(e) => { e.stopPropagation(); onRemove(x.temp_id) }}
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
                    {x.matches.map(m => (
                      <button
                        key={m.id}
                        onClick={() => onReplaceWithExisting(x.temp_id, m)}
                        style={{
                          display: 'flex', alignItems: 'center', gap: 8,
                          padding: 6, borderRadius: 6, cursor: 'pointer',
                          border: '1px solid var(--border)', background: 'var(--white)',
                          textAlign: 'left',
                        }}
                      >
                        <div style={{
                          width: 32, height: 32, borderRadius: 4, overflow: 'hidden',
                          background: 'var(--bg-secondary)', flexShrink: 0,
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
                    onClick={() => onDismissDedup(x.temp_id)}
                    style={{
                      marginTop: 8, padding: '4px 8px', fontSize: 11,
                      background: 'transparent', border: '1px solid var(--gold-500, #C9A55C)',
                      borderRadius: 4, color: 'var(--gold-600, #C9A55C)',
                      cursor: 'pointer', fontWeight: 500,
                    }}
                  >Это новая</button>
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

// Универсальная миниатюра — для нового item'а берём из file (Blob), для
// existing — photo_url из stock-фото в БД.
function ItemThumb({ item }) {
  if (item._existing) {
    return (
      <div style={{
        width: 48, height: 48, borderRadius: 8, overflow: 'hidden',
        background: 'var(--bg-secondary)', flexShrink: 0,
      }}>
        {item.photo_url && <img src={item.photo_url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />}
      </div>
    )
  }
  return <PhotoThumb file={item.file} />
}

function PhotoThumb({ file }) {
  // useMemo вместо useState+useEffect: blob-URL вычисляется ровно при смене
  // file, без cascading render через setState (react-hooks/set-state-in-effect).
  const src = useMemo(() => file ? URL.createObjectURL(file) : null, [file])
  useEffect(() => () => { if (src) URL.revokeObjectURL(src) }, [src])
  return (
    <div style={{
      width: 48, height: 48, borderRadius: 8, overflow: 'hidden',
      background: 'var(--bg-secondary)', flexShrink: 0,
    }}>
      {src && <img src={src} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />}
    </div>
  )
}

// ─── Edit modal ────────────────────────────────────────────────────────────

function EditItemModal({ item, onClose, onSave }) {
  const [name, setName] = useState(item.name)
  const [category, setCategory] = useState(item.category || 'other')
  const [qty, setQty] = useState(item.qty)
  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)',
        display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
        zIndex: 100,
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          background: 'var(--white)', borderTopLeftRadius: 16, borderTopRightRadius: 16,
          padding: 20, width: '100%', maxWidth: 500,
        }}
      >
        <h3 style={{ fontSize: 16, fontWeight: 600, marginBottom: 16 }}>Правка карточки</h3>
        <Input label="Название" value={name} onChange={e => setName(e.target.value)} />
        <Input label="Категория" value={category} onChange={e => setCategory(e.target.value)} />
        <Input label="Количество" type="number" min="1" value={qty} onChange={e => setQty(Math.max(1, Number(e.target.value) || 1))} />
        <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
          <Button variant="secondary" fullWidth onClick={onClose}>Отмена</Button>
          <Button fullWidth onClick={() => onSave({ name, category, qty })}>Сохранить</Button>
        </div>
      </div>
    </div>
  )
}

// ─── Step 3: Sign ───────────────────────────────────────────────────────────

function Step3Sign({ items, unresolvedDupCount, deadline, setDeadline, signatureData, setSignatureData, stamped, setStamped }) {
  const presets = [
    { label: '3 дня',  days: 3 },
    { label: 'Неделя', days: 7 },
    { label: '2 недели', days: 14 },
    { label: 'Месяц',  days: 30 },
  ]
  return (
    <div>
      <div style={{
        marginBottom: 20, padding: 14, borderRadius: 'var(--radius-card)',
        border: '1px solid var(--border)', background: 'var(--white)',
      }}>
        <label style={{ display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 10 }}>
          Срок возврата
        </label>
        <input
          type="date"
          value={deadline}
          min={todayPlus(0)}
          onChange={e => setDeadline(e.target.value)}
          style={{
            width: '100%', height: 44, padding: '0 12px',
            border: '1px solid var(--border)', borderRadius: 'var(--radius-btn)',
            background: 'var(--white)', fontSize: 16, outline: 'none',
            marginBottom: 10,
          }}
        />
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {presets.map(p => {
            const target = todayPlus(p.days)
            const active = deadline === target
            return (
              <button
                key={p.days}
                onClick={() => setDeadline(target)}
                style={{
                  flex: 1, minWidth: 70, height: 32, padding: '0 10px',
                  borderRadius: 'var(--radius-btn)',
                  border: `1px solid ${active ? 'var(--ink-950, #0A0A0A)' : 'var(--border)'}`,
                  background: active ? 'var(--ink-950, #0A0A0A)' : 'var(--white)',
                  color: active ? '#fff' : 'var(--text)',
                  fontSize: 12, fontWeight: 500, cursor: 'pointer',
                }}
              >{p.label}</button>
            )
          })}
        </div>
      </div>

      {unresolvedDupCount > 0 && (
        <div style={{
          padding: 10, marginBottom: 12,
          borderRadius: 'var(--radius-card)',
          border: '1px solid var(--gold-500, #C9A55C)',
          background: 'var(--gold-100, #FFF7E0)',
          color: 'var(--gold-600, #C9A55C)',
          fontSize: 12, fontWeight: 500,
        }}>
          ⚠️ {unresolvedDupCount} {unresolvedDupCount === 1 ? 'единица' : 'единиц'} могут быть дублями уже существующих в базе. Вернитесь в корзину и проверьте.
        </div>
      )}

      <div style={{
        border: '1px solid var(--border)', borderRadius: 'var(--radius-card)',
        padding: 12, marginBottom: 20, background: 'var(--bg-secondary)',
      }}>
        <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 8, fontWeight: 600 }}>ВЫДАЁМ ({items.length})</div>
        {items.map(x => (
          <div key={x.temp_id} style={{ fontSize: 13, padding: '4px 0', display: 'flex', alignItems: 'center', gap: 6 }}>
            {x._existing && <span style={{ color: 'var(--green, #10b981)' }}>🔗</span>}
            • {x.name} <span style={{ color: 'var(--muted)' }}>×{x.qty}</span>
          </div>
        ))}
      </div>

      <div style={{ marginBottom: 20 }}>
        <div style={{ fontSize: 13, fontWeight: 500, marginBottom: 8 }}>Подпись получателя</div>
        {signatureData ? (
          <div style={{
            border: '1px solid var(--border)', borderRadius: 'var(--radius-card)',
            padding: 12, background: 'var(--white)',
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          }}>
            <img src={signatureData} alt="Подпись" style={{ height: 60 }} />
            <Button variant="secondary" size="sm" onClick={() => setSignatureData(null)}>Перерисовать</Button>
          </div>
        ) : (
          <SignatureCanvas onSave={setSignatureData} onClear={() => setSignatureData(null)} />
        )}
      </div>

      <div style={{ marginBottom: 8 }}>
        <div style={{ fontSize: 13, fontWeight: 500, marginBottom: 8 }}>Штамп выдавшего</div>
        <button
          onClick={() => setStamped(s => !s)}
          style={{
            width: '100%', height: 60, borderRadius: 'var(--radius-card)',
            border: stamped ? '2px solid var(--gold-500, #C9A55C)' : '1px dashed var(--border)',
            background: stamped ? 'var(--gold-100, #FFF7E0)' : 'var(--white)',
            cursor: 'pointer', fontSize: 13, color: stamped ? 'var(--gold-600, #C9A55C)' : 'var(--muted)',
            fontWeight: stamped ? 600 : 400,
          }}
        >
          {stamped ? '✓ Штамп проставлен' : 'Нажмите чтобы поставить штамп'}
        </button>
      </div>
    </div>
  )
}

// ─── Existing units picker ──────────────────────────────────────────────────
// Модалка выбора уже учтённых юнитов из общего склада. Search debounced на
// /units?search=&status=on_stock; misplaced/issued/долговые не показываются.
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
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)',
        display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
        zIndex: 100,
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          background: 'var(--white)', borderTopLeftRadius: 16, borderTopRightRadius: 16,
          padding: 16, width: '100%', maxWidth: 600, maxHeight: '85vh',
          display: 'flex', flexDirection: 'column',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', marginBottom: 12, gap: 8 }}>
          <h3 style={{ fontSize: 16, fontWeight: 600, flex: 1 }}>Выберите из базы</h3>
          <button
            onClick={onClose}
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--muted)' }}
            aria-label="Закрыть"
          ><X size={20} /></button>
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
                  background: 'var(--bg-secondary)', flexShrink: 0,
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

// ─── Reusable: pill toggle button ──────────────────────────────────────────

function ToggleBtn({ active, onClick, children }) {
  return (
    <button
      onClick={onClick}
      style={{
        flex: 1, height: 40, borderRadius: 'var(--radius-btn)',
        border: `1px solid ${active ? 'var(--ink-950, #0A0A0A)' : 'var(--border)'}`,
        background: active ? 'var(--ink-950, #0A0A0A)' : 'var(--white)',
        color: active ? '#fff' : 'var(--text)',
        fontSize: 13, fontWeight: 500, cursor: 'pointer',
      }}
    >{children}</button>
  )
}
