// Карточка актёра — read + edit режимы. Используется в CastingPage и при
// открытии из глобального поиска (deep-link ?card=<id>).
//
// search_tags в UI скрыт — генерится AI, хранится в БД, индексируется
// для глобального поиска. Пользователь не редактирует.

import { useState, useEffect, useRef } from 'react'
import { X, Edit, Save, Trash2, Camera, Film, Sparkles, User, Baby, PawPrint, Plus, ChevronDown, ChevronRight } from 'lucide-react'
import Button from '../shared/Button'
import Badge from '../shared/Badge'
import { casting as castingApi } from '../../services/api'
import { useToast } from '../shared/Toast'

const STATUS_MAP = {
  considering: { label: 'Рассматривается', color: 'amber' },
  approved:    { label: 'Утверждён',       color: 'green' },
  rejected:    { label: 'Отклонён',        color: 'red' },
}

const KIND_MAP = {
  adult:  { label: 'Взрослый',  icon: User },
  child:  { label: 'Ребёнок',   icon: Baby },
  animal: { label: 'Животное',  icon: PawPrint },
}

const GENDER_LABELS = { male: 'Мужской', female: 'Женский' }

function isVideoUrl(url) {
  if (!url) return false
  const lower = url.toLowerCase()
  return lower.includes('.mp4') || lower.includes('.webm') || lower.includes('.mov')
}

export default function CastingDetailModal({ open, cardId, onClose, onUpdated, onDeleted }) {
  const toast = useToast()
  const [card, setCard] = useState(null)
  const [loading, setLoading] = useState(false)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(null)
  const [saving, setSaving] = useState(false)
  const [aiRunning, setAiRunning] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [openSection, setOpenSection] = useState({ appearance: true, skills: false, extras: false })
  const fileRef = useRef()
  const camRef = useRef()
  const videoRef = useRef()

  useEffect(() => {
    if (!open || !cardId) return
    setLoading(true); setEditing(false); setCard(null)
    castingApi.get(cardId)
      .then(setCard)
      .catch(() => setCard(null))
      .finally(() => setLoading(false))
  }, [open, cardId])

  function startEdit() { setDraft({ ...card }); setEditing(true) }
  function cancelEdit() { setDraft(null); setEditing(false) }
  function setField(k, v) { setDraft(d => ({ ...d, [k]: v })) }

  async function saveEdit() {
    if (!draft.name?.trim()) { toast?.('Укажите ФИО', 'error'); return }
    setSaving(true)
    try {
      // Передаём только редактируемые поля (search_tags оставляем как есть).
      const payload = { ...draft }
      payload.height = payload.height ? Number(payload.height) : null
      payload.weight = payload.weight ? Number(payload.weight) : null
      Object.keys(payload).forEach(k => {
        if (typeof payload[k] === 'string' && payload[k].trim() === '') payload[k] = null
      })
      const updated = await castingApi.update(card.id, payload)
      const merged = { ...updated, photos: card.photos }
      setCard(merged)
      onUpdated?.(merged)
      setEditing(false); setDraft(null)
      toast?.('Сохранено', 'success')
    } catch (err) {
      toast?.(err.message || 'Не удалось сохранить', 'error')
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete() {
    if (!confirm(`Удалить карточку «${card.name}»?`)) return
    try {
      await castingApi.delete(card.id)
      onDeleted?.(card.id)
      onClose?.()
    } catch (err) {
      toast?.(err.message || 'Не удалось удалить', 'error')
    }
  }

  async function handleStatus(status) {
    try {
      const updated = await castingApi.update(card.id, { status })
      const merged = { ...card, ...updated, photos: card.photos }
      setCard(merged)
      onUpdated?.(merged)
    } catch (err) {
      toast?.(err.message || 'Ошибка', 'error')
    }
  }

  async function onMediaSelected(e) {
    const files = Array.from(e.target.files || [])
    e.target.value = ''
    if (!files.length) return
    setUploading(true)
    let failed = 0
    for (const f of files) {
      const fd = new FormData()
      fd.append('photos', f)
      try { await castingApi.uploadPhoto(card.id, fd) } catch { failed++ }
    }
    setUploading(false)
    if (failed) toast?.(`${failed} файл(ов) не загрузились`, 'error')
    try {
      const fresh = await castingApi.get(card.id)
      setCard(fresh)
      onUpdated?.(fresh)
    } catch { /* ignore */ }
  }

  async function deletePhoto(photoId) {
    if (!confirm('Удалить файл?')) return
    try {
      await castingApi.deletePhoto(card.id, photoId)
      const fresh = await castingApi.get(card.id)
      setCard(fresh)
      onUpdated?.(fresh)
    } catch (err) {
      toast?.(err.message || 'Не удалось удалить', 'error')
    }
  }

  async function aiFillEmpty() {
    if (!card.photos?.length) { toast?.('Нет фото для распознавания', 'error'); return }
    const photoUrls = card.photos.filter(p => !isVideoUrl(p.url || p)).slice(0, 5).map(p => p.url || p)
    if (!photoUrls.length) { toast?.('Нет фото (только видео)', 'error'); return }
    setAiRunning(true)
    try {
      const fd = new FormData()
      for (const url of photoUrls) {
        try {
          const r = await fetch(url)
          const blob = await r.blob()
          fd.append('photos', new File([blob], 'photo.jpg', { type: blob.type || 'image/jpeg' }))
        } catch { /* skip */ }
      }
      const result = await castingApi.recognize(fd)
      const next = { ...draft }
      let filled = 0
      const fillIfEmpty = (k, v) => { if (v && !next[k]) { next[k] = v; filled++ } }
      if (result.kind && KIND_MAP[result.kind] && !next.kind) { next.kind = result.kind; filled++ }
      fillIfEmpty('gender', result.gender)
      fillIfEmpty('age_range', result.age_range)
      fillIfEmpty('hair_color', result.hair_color)
      fillIfEmpty('eye_color', result.eye_color)
      fillIfEmpty('body_type', result.body_type)
      fillIfEmpty('ethnicity', result.ethnicity)
      fillIfEmpty('tattoos', result.tattoos)
      fillIfEmpty('description', result.description)
      // search_tags — мерджим (AI выдаёт намного больше, мерджим уникальные)
      if (result.search_tags) {
        const existing = new Set((next.search_tags || '').split(/\s+/).filter(Boolean))
        const incoming = result.search_tags.split(/\s+/).filter(Boolean)
        let added = 0
        for (const t of incoming) if (!existing.has(t)) { existing.add(t); added++ }
        if (added) { next.search_tags = [...existing].join(' ') }
      }
      setDraft(next)
      toast?.(filled ? `AI заполнил ${filled} поле(й) и обновил теги поиска` : 'AI обновил теги поиска', 'success')
    } catch (err) {
      toast?.(err.message || 'AI недоступен', 'error')
    } finally {
      setAiRunning(false)
    }
  }

  if (!open) return null

  const data = editing ? draft : card

  return (
    <div onClick={onClose} style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 500,
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16,
    }}>
      <div onClick={e => e.stopPropagation()} style={{
        background: 'var(--white)', borderRadius: 'var(--radius-card)', padding: 24,
        maxWidth: 600, width: '100%', maxHeight: '92vh', overflowY: 'auto',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
          <div style={{ fontWeight: 600, fontSize: 16 }}>{editing ? 'Редактирование' : 'Карточка актёра'}</div>
          <div style={{ display: 'flex', gap: 6 }}>
            {!editing && card && (
              <button onClick={startEdit} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--muted)', padding: 6 }} title="Редактировать">
                <Edit size={16} />
              </button>
            )}
            <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--muted)', padding: 6 }}>
              <X size={18} />
            </button>
          </div>
        </div>

        {loading && <div style={{ textAlign: 'center', padding: '40px 0', color: 'var(--muted)', fontSize: 14 }}>Загрузка...</div>}

        {!loading && card && (
          <>
            {/* Photos gallery */}
            {card.photos && card.photos.length > 0 ? (
              <div style={{ display: 'flex', gap: 8, marginBottom: 16, overflowX: 'auto', paddingBottom: 4 }}>
                {card.photos.map((p, i) => {
                  const src = typeof p === 'string' ? p : p.url
                  const pid = typeof p === 'string' ? null : p.id
                  return (
                    <div key={i} style={{ position: 'relative', flexShrink: 0 }}>
                      {isVideoUrl(src) ? (
                        <video src={src} controls preload="metadata" style={{ width: 140, height: 180, objectFit: 'cover', borderRadius: 'var(--radius-btn)', border: '1px solid var(--border)' }} />
                      ) : (
                        <img src={src} alt="" style={{ width: 140, height: 180, objectFit: 'cover', borderRadius: 'var(--radius-btn)', border: '1px solid var(--border)' }} />
                      )}
                      {editing && pid && (
                        <button onClick={() => deletePhoto(pid)}
                          style={{ position: 'absolute', top: 6, right: 6, background: 'var(--red)', border: 'none', borderRadius: '50%', width: 24, height: 24, color: '#fff', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                          <X size={14} />
                        </button>
                      )}
                    </div>
                  )
                })}
                {editing && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6, justifyContent: 'center', flexShrink: 0 }}>
                    <button onClick={() => fileRef.current?.click()} disabled={uploading}
                      style={{ width: 60, height: 56, borderRadius: 'var(--radius-btn)', border: '2px dashed var(--border)', background: 'var(--bg)', cursor: uploading ? 'wait' : 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 2, fontSize: 10, color: 'var(--muted)' }}>
                      <Plus size={16} /> Файл
                    </button>
                    <button onClick={() => camRef.current?.click()} disabled={uploading}
                      style={{ width: 60, height: 56, borderRadius: 'var(--radius-btn)', border: '2px dashed var(--border)', background: 'var(--bg)', cursor: uploading ? 'wait' : 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 2, fontSize: 10, color: 'var(--muted)' }}>
                      <Camera size={14} /> Камера
                    </button>
                    <button onClick={() => videoRef.current?.click()} disabled={uploading}
                      style={{ width: 60, height: 56, borderRadius: 'var(--radius-btn)', border: '2px dashed var(--accent)', background: 'var(--bg)', cursor: uploading ? 'wait' : 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 2, fontSize: 10, color: 'var(--accent)' }}>
                      <Film size={14} /> Видео
                    </button>
                  </div>
                )}
              </div>
            ) : editing ? (
              <div style={{ display: 'flex', gap: 6, marginBottom: 16 }}>
                <button onClick={() => fileRef.current?.click()} disabled={uploading}
                  style={{ flex: 1, height: 80, borderRadius: 'var(--radius-btn)', border: '2px dashed var(--border)', background: 'var(--bg)', cursor: uploading ? 'wait' : 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, fontSize: 13, color: 'var(--muted)' }}>
                  <Plus size={18} /> Добавить фото или видео
                </button>
              </div>
            ) : null}
            <input ref={fileRef} type="file" accept="image/*,video/mp4,video/webm,video/quicktime" multiple style={{ display: 'none' }} onChange={onMediaSelected} />
            <input ref={camRef} type="file" accept="image/*" capture="environment" style={{ display: 'none' }} onChange={onMediaSelected} />
            <input ref={videoRef} type="file" accept="video/*" capture="environment" style={{ display: 'none' }} onChange={onMediaSelected} />

            {/* Header */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, flexWrap: 'wrap' }}>
              {editing ? (
                <input value={data.name || ''} onChange={e => setField('name', e.target.value)} placeholder="ФИО *"
                  style={{ flex: 1, minWidth: 200, height: 36, padding: '0 10px', border: '1px solid var(--border)', borderRadius: 'var(--radius-btn)', fontSize: 15, fontWeight: 600, background: 'var(--white)' }} />
              ) : (
                <div style={{ fontWeight: 600, fontSize: 18, flex: 1 }}>{data.name}</div>
              )}
              <Badge color={STATUS_MAP[data.status]?.color || 'muted'}>{STATUS_MAP[data.status]?.label || data.status}</Badge>
            </div>

            {editing ? (
              <input value={data.role_name || ''} onChange={e => setField('role_name', e.target.value)} placeholder="Роль в проекте"
                style={{ width: '100%', height: 32, padding: '0 10px', border: '1px solid var(--border)', borderRadius: 'var(--radius-btn)', fontSize: 13, marginBottom: 12, background: 'var(--white)', color: 'var(--accent)' }} />
            ) : data.role_name ? (
              <div style={{ fontSize: 14, color: 'var(--accent)', marginBottom: 12 }}>{data.role_name}</div>
            ) : null}

            {editing ? (
              <EditView data={data} setField={setField} aiFillEmpty={aiFillEmpty} aiRunning={aiRunning} openSection={openSection} setOpenSection={setOpenSection} saving={saving} onCancel={cancelEdit} onSave={saveEdit} onDelete={handleDelete} />
            ) : (
              <ReadView data={data} onStatus={handleStatus} onClose={onClose} onDelete={handleDelete} />
            )}
          </>
        )}

        {!loading && !card && (
          <div style={{ textAlign: 'center', padding: '40px 0', color: 'var(--muted)', fontSize: 14 }}>
            Не удалось загрузить карточку
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Read view ──────────────────────────────────────────────────────
function ReadView({ data, onStatus, onClose, onDelete }) {
  return (
    <>
      <div style={{ background: 'var(--bg)', borderRadius: 'var(--radius-card)', padding: '4px 14px', marginBottom: 14 }}>
        <InfoRow label="Тип" value={KIND_MAP[data.kind]?.label || data.kind} />
        {data.gender && <InfoRow label="Пол" value={GENDER_LABELS[data.gender] || data.gender} />}
        {data.age_range && <InfoRow label="Возраст" value={`${data.age_range} лет`} />}
        {data.city && <InfoRow label="Город" value={data.city} />}
        {data.height && <InfoRow label="Рост" value={`${data.height} см`} />}
        {data.weight && <InfoRow label="Вес" value={`${data.weight} кг`} />}
        {data.clothing_size && <InfoRow label="Размер одежды" value={data.clothing_size} />}
        {data.shoe_size && <InfoRow label="Размер обуви" value={data.shoe_size} />}
        {data.hair_color && <InfoRow label={data.kind === 'animal' ? 'Шерсть' : 'Волосы'} value={data.hair_color} />}
        {data.eye_color && <InfoRow label="Глаза" value={data.eye_color} />}
        {data.body_type && <InfoRow label="Телосложение" value={data.body_type} />}
        {data.ethnicity && <InfoRow label={data.kind === 'animal' ? 'Порода' : 'Типаж'} value={data.ethnicity} />}
        {data.tattoos && <InfoRow label="Особые приметы" value={data.tattoos} />}
        {data.languages && <InfoRow label="Языки" value={data.languages} />}
        {data.driver_license && <InfoRow label="Права (категории)" value={data.driver_license} />}
        {data.has_car && <InfoRow label="Личный автомобиль" value="Есть" />}
        {data.skills && <InfoRow label="Спорт / навыки" value={data.skills} />}
        {data.music_skills && <InfoRow label="Музыка" value={data.music_skills} />}
        {data.dance_skills && <InfoRow label="Танцы" value={data.dance_skills} />}
        {(data.accepts_nudity || data.accepts_stunts || data.accepts_travel || data.has_passport) && (
          <InfoRow label="Готовности" value={[
            data.accepts_nudity && 'раздевание',
            data.accepts_stunts && 'трюки',
            data.accepts_travel && 'выезды',
            data.has_passport && 'загранпаспорт',
          ].filter(Boolean).join(' · ')} />
        )}
        {data.rate && <InfoRow label="Гонорар" value={data.rate} />}
        {data.phone && <InfoRow label="Телефон" value={data.phone} />}
        {data.email && <InfoRow label="Email" value={data.email} />}
        {data.agency && <InfoRow label="Агентство" value={data.agency} />}
        {data.social_links && <InfoRow label="Портфолио" value={
          <a href={data.social_links} target="_blank" rel="noreferrer" style={{ color: 'var(--accent)', textDecoration: 'underline', wordBreak: 'break-all' }}>{data.social_links}</a>
        } last={!data.description && !data.experience && !data.notes} />}
      </div>

      {data.description && <Block label="Внешность">{data.description}</Block>}
      {data.experience && <Block label="Опыт">{data.experience}</Block>}
      {data.notes && <Block label="Заметки">{data.notes}</Block>}

      <div style={{ display: 'flex', gap: 6, marginBottom: 12, flexWrap: 'wrap' }}>
        {data.status !== 'approved' && (
          <Button onClick={() => onStatus('approved')} style={{ background: 'var(--green)', borderColor: 'var(--green)', fontSize: 13, height: 34 }}>Утвердить</Button>
        )}
        {data.status !== 'rejected' && (
          <Button variant="secondary" onClick={() => onStatus('rejected')} style={{ color: 'var(--red)', fontSize: 13, height: 34 }}>Отклонить</Button>
        )}
        {data.status !== 'considering' && (
          <Button variant="secondary" onClick={() => onStatus('considering')} style={{ fontSize: 13, height: 34 }}>На рассмотрение</Button>
        )}
      </div>

      <div style={{ display: 'flex', gap: 8 }}>
        <Button variant="secondary" fullWidth onClick={onClose}>Закрыть</Button>
        <Button variant="danger" fullWidth onClick={onDelete}><Trash2 size={14} style={{ marginRight: 4 }} />Удалить</Button>
      </div>
    </>
  )
}

// ─── Edit view ──────────────────────────────────────────────────────
function EditView({ data, setField, aiFillEmpty, aiRunning, openSection, setOpenSection, saving, onCancel, onSave }) {
  return (
    <>
      <Button onClick={aiFillEmpty} disabled={aiRunning} variant="secondary" style={{ marginBottom: 14, width: '100%' }}>
        <Sparkles size={14} style={{ marginRight: 4 }} />
        {aiRunning ? 'AI работает…' : 'AI-дозаполнить пустые поля'}
      </Button>

      <FL>Тип</FL>
      <div style={{ display: 'flex', gap: 6, marginBottom: 14 }}>
        {Object.entries(KIND_MAP).map(([v, m]) => {
          const Icon = m.icon
          const active = data.kind === v
          return (
            <button key={v} onClick={() => setField('kind', v)}
              style={{
                flex: 1, height: 40, borderRadius: 'var(--radius-btn)',
                border: active ? '2px solid var(--accent)' : '1px solid var(--border)',
                background: active ? 'var(--gold-50, #FAF6E8)' : 'var(--white)',
                color: active ? 'var(--text)' : 'var(--muted)',
                fontWeight: active ? 600 : 400, fontSize: 13, cursor: 'pointer',
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
              }}>
              <Icon size={14} /> {m.label}
            </button>
          )
        })}
      </div>

      <Row>
        <Col><FL>Пол</FL>
          <select value={data.gender || ''} onChange={e => setField('gender', e.target.value)}
            style={{ width: '100%', height: 38, padding: '0 10px', border: '1px solid var(--border)', borderRadius: 'var(--radius-btn)', fontSize: 13, marginBottom: 12, background: 'var(--white)' }}>
            <option value="">—</option>
            <option value="male">Мужской</option>
            <option value="female">Женский</option>
          </select>
        </Col>
        <Col><FL>Возраст</FL><FI value={data.age_range} onChange={v => setField('age_range', v)} placeholder="25-35" /></Col>
      </Row>
      <Row>
        <Col><FL>Город</FL><FI value={data.city} onChange={v => setField('city', v)} /></Col>
        <Col><FL>Гонорар</FL><FI value={data.rate} onChange={v => setField('rate', v)} /></Col>
      </Row>
      <Row>
        <Col><FL>Телефон</FL><FI value={data.phone} onChange={v => setField('phone', v)} /></Col>
        <Col><FL>Email</FL><FI value={data.email} onChange={v => setField('email', v)} /></Col>
      </Row>

      <Section title="Внешность" open={openSection.appearance} onToggle={() => setOpenSection(s => ({ ...s, appearance: !s.appearance }))}>
        <Row>
          <Col><FL>Рост (см)</FL><FI type="number" value={data.height} onChange={v => setField('height', v)} /></Col>
          <Col><FL>Вес (кг)</FL><FI type="number" value={data.weight} onChange={v => setField('weight', v)} /></Col>
        </Row>
        <Row>
          <Col><FL>Размер одежды</FL><FI value={data.clothing_size} onChange={v => setField('clothing_size', v)} placeholder="48 / M" /></Col>
          <Col><FL>Размер обуви</FL><FI value={data.shoe_size} onChange={v => setField('shoe_size', v)} placeholder="42" /></Col>
        </Row>
        <Row>
          <Col><FL>{data.kind === 'animal' ? 'Цвет шерсти' : 'Цвет волос'}</FL><FI value={data.hair_color} onChange={v => setField('hair_color', v)} /></Col>
          <Col><FL>Цвет глаз</FL><FI value={data.eye_color} onChange={v => setField('eye_color', v)} /></Col>
        </Row>
        <Row>
          <Col><FL>Телосложение</FL><FI value={data.body_type} onChange={v => setField('body_type', v)} /></Col>
          <Col><FL>{data.kind === 'animal' ? 'Порода' : 'Типаж'}</FL><FI value={data.ethnicity} onChange={v => setField('ethnicity', v)} /></Col>
        </Row>
        <FL>Особые приметы (татуировки/шрамы/пирсинг)</FL>
        <FI value={data.tattoos} onChange={v => setField('tattoos', v)} />
        <FL>Описание внешности</FL>
        <textarea value={data.description || ''} onChange={e => setField('description', e.target.value)}
          style={{ width: '100%', minHeight: 60, padding: '8px 10px', border: '1px solid var(--border)', borderRadius: 'var(--radius-btn)', fontSize: 13, marginBottom: 4, fontFamily: 'inherit', resize: 'vertical', boxSizing: 'border-box', background: 'var(--white)' }} />
      </Section>

      <Section title="Навыки и умения" open={openSection.skills} onToggle={() => setOpenSection(s => ({ ...s, skills: !s.skills }))}>
        <FL>Языки</FL>
        <FI value={data.languages} onChange={v => setField('languages', v)} placeholder="русский английский" />
        <Row>
          <Col><FL>Водительские права (категории)</FL><FI value={data.driver_license} onChange={v => setField('driver_license', v)} placeholder="B C" /></Col>
          <Col style={{ display: 'flex', alignItems: 'flex-end', paddingBottom: 12 }}>
            <Toggle label="Личный автомобиль" value={data.has_car} onChange={v => setField('has_car', v)} />
          </Col>
        </Row>
        <FL>Спорт / специальные навыки</FL>
        <FI value={data.skills} onChange={v => setField('skills', v)} placeholder="плавание лыжи стрельба бокс" />
        <Row>
          <Col><FL>Музыка</FL><FI value={data.music_skills} onChange={v => setField('music_skills', v)} /></Col>
          <Col><FL>Танцы</FL><FI value={data.dance_skills} onChange={v => setField('dance_skills', v)} /></Col>
        </Row>
      </Section>

      <Section title="Прочее" open={openSection.extras} onToggle={() => setOpenSection(s => ({ ...s, extras: !s.extras }))}>
        <FL>Агентство</FL>
        <FI value={data.agency} onChange={v => setField('agency', v)} />
        <FL>Опыт</FL>
        <textarea value={data.experience || ''} onChange={e => setField('experience', e.target.value)}
          style={{ width: '100%', minHeight: 50, padding: '8px 10px', border: '1px solid var(--border)', borderRadius: 'var(--radius-btn)', fontSize: 13, marginBottom: 12, fontFamily: 'inherit', resize: 'vertical', boxSizing: 'border-box', background: 'var(--white)' }} />
        <FL>Портфолио / соцсети</FL>
        <FI value={data.social_links} onChange={v => setField('social_links', v)} placeholder="https://..." />
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, marginTop: 4 }}>
          <Toggle label="Раздевание" value={data.accepts_nudity} onChange={v => setField('accepts_nudity', v)} />
          <Toggle label="Трюки" value={data.accepts_stunts} onChange={v => setField('accepts_stunts', v)} />
          <Toggle label="Выезды" value={data.accepts_travel} onChange={v => setField('accepts_travel', v)} />
          <Toggle label="Загранпаспорт" value={data.has_passport} onChange={v => setField('has_passport', v)} />
        </div>
        <FL>Заметки</FL>
        <textarea value={data.notes || ''} onChange={e => setField('notes', e.target.value)}
          style={{ width: '100%', minHeight: 50, padding: '8px 10px', border: '1px solid var(--border)', borderRadius: 'var(--radius-btn)', fontSize: 13, marginTop: 8, fontFamily: 'inherit', resize: 'vertical', boxSizing: 'border-box', background: 'var(--white)' }} />
        <FL>Статус</FL>
        <select value={data.status || 'considering'} onChange={e => setField('status', e.target.value)}
          style={{ width: '100%', height: 38, padding: '0 10px', border: '1px solid var(--border)', borderRadius: 'var(--radius-btn)', fontSize: 13, background: 'var(--white)' }}>
          <option value="considering">Рассматривается</option>
          <option value="approved">Утверждён</option>
          <option value="rejected">Отклонён</option>
        </select>
      </Section>

      <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
        <Button variant="secondary" fullWidth onClick={onCancel} disabled={saving}>Отмена</Button>
        <Button fullWidth loading={saving} onClick={onSave}><Save size={14} style={{ marginRight: 4 }} />Сохранить</Button>
      </div>
    </>
  )
}

// ─── Helpers ────────────────────────────────────────────────────────
function FL({ children }) {
  return <div style={{ fontSize: 12, fontWeight: 500, marginBottom: 4, color: 'var(--muted)' }}>{children}</div>
}

function FI({ value, onChange, placeholder, type = 'text' }) {
  return (
    <input type={type} value={value || ''} onChange={e => onChange(e.target.value)} placeholder={placeholder}
      style={{ width: '100%', height: 38, padding: '0 10px', border: '1px solid var(--border)', borderRadius: 'var(--radius-btn)', fontSize: 13, marginBottom: 12, background: 'var(--white)', outline: 'none', boxSizing: 'border-box' }} />
  )
}

function Row({ children }) {
  return <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>{children}</div>
}
function Col({ children, style }) {
  return <div style={style}>{children}</div>
}

function InfoRow({ label, value, last }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 0', borderBottom: last ? 'none' : '1px solid var(--border)', gap: 12 }}>
      <span style={{ color: 'var(--muted)', fontSize: 13, flexShrink: 0 }}>{label}</span>
      <span style={{ fontWeight: 500, fontSize: 13, textAlign: 'right', maxWidth: '65%', overflow: 'hidden', textOverflow: 'ellipsis' }}>{value}</span>
    </div>
  )
}

function Block({ label, children }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ fontSize: 12, fontWeight: 500, color: 'var(--muted)', marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 13, lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>{children}</div>
    </div>
  )
}

function Section({ title, open, onToggle, children }) {
  return (
    <div style={{ marginTop: 14, border: '1px solid var(--border)', borderRadius: 'var(--radius-btn)', background: 'var(--bg)', overflow: 'hidden' }}>
      <button type="button" onClick={onToggle}
        style={{ width: '100%', padding: '10px 12px', background: 'transparent', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>
        {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />} {title}
      </button>
      {open && (
        <div style={{ padding: '4px 12px 12px', background: 'var(--white)', borderTop: '1px solid var(--border)' }}>
          {children}
        </div>
      )}
    </div>
  )
}

function Toggle({ label, value, onChange }) {
  return (
    <label style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', borderRadius: 'var(--radius-btn)', border: `1px solid ${value ? 'var(--accent)' : 'var(--border)'}`, background: value ? 'var(--gold-50, #FAF6E8)' : 'var(--white)', cursor: 'pointer', fontSize: 12, color: 'var(--text)', fontWeight: value ? 500 : 400, width: '100%', boxSizing: 'border-box' }}>
      <input type="checkbox" checked={!!value} onChange={e => onChange(e.target.checked)}
        style={{ width: 16, height: 16, accentColor: 'var(--accent)', cursor: 'pointer', flexShrink: 0 }} />
      <span>{label}</span>
    </label>
  )
}
