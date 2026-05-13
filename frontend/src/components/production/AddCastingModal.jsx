// 3-шаговый визард добавления карточки в кастинг АМС.
// Шаг 1: фото + видео (AI распознаёт по фото).
// Шаг 2: данные. Базовые поля видны всегда, дополнительные секции
//        (Внешность / Навыки / Прочее) свернуты — раскрываются по клику.
//        Поле «теги для поиска» в UI скрыто (генерится AI и хранится в БД).
// Шаг 3: подтверждение → сохранение. Статус устанавливается дефолт «считается».

import { useState, useRef, useEffect } from 'react'
import { Camera, Film, Sparkles, X, User, Baby, PawPrint, ChevronDown, ChevronRight } from 'lucide-react'
import Button from '../shared/Button'
import { casting as castingApi } from '../../services/api'
import { useToast } from '../shared/Toast'

const KIND_OPTIONS = [
  { value: 'adult',  label: 'Взрослый', icon: User },
  { value: 'child',  label: 'Ребёнок',  icon: Baby },
  { value: 'animal', label: 'Животное', icon: PawPrint },
]

const EMPTY = {
  // базовые
  name: '', role_name: '', kind: 'adult',
  gender: '', age_range: '', phone: '', email: '',
  // внешность
  height: '', weight: '', hair_color: '', eye_color: '', body_type: '', ethnicity: '',
  clothing_size: '', shoe_size: '', tattoos: '', description: '',
  // навыки
  languages: '', driver_license: '', has_car: false,
  skills: '', music_skills: '', dance_skills: '',
  // прочее
  city: '', agency: '', experience: '', social_links: '', rate: '',
  accepts_nudity: false, accepts_stunts: false, accepts_travel: false, has_passport: false,
  notes: '',
  // скрытые
  search_tags: '',
  status: 'considering',
}

function isVideoFile(file) { return file.type?.startsWith('video/') }

function compressImage(file, maxSize = 1568, quality = 0.85) {
  return new Promise(resolve => {
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

export default function AddCastingModal({ open, onClose, onCreated }) {
  const toast = useToast()
  const [step, setStep] = useState(1)
  const [media, setMedia] = useState([])
  const [form, setForm] = useState(EMPTY)
  const [aiFields, setAiFields] = useState(new Set())
  const [recognizing, setRecognizing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [openSection, setOpenSection] = useState({ appearance: false, skills: false, extras: false })
  const fileRef = useRef()
  const camRef = useRef()
  const videoRef = useRef()

  useEffect(() => {
    if (!open) return
    setStep(1); setMedia([]); setForm(EMPTY); setAiFields(new Set()); setError('')
    setOpenSection({ appearance: false, skills: false, extras: false })
  }, [open])

  async function onFiles(e) {
    const files = Array.from(e.target.files || [])
    e.target.value = ''
    const photoCount = media.filter(f => !isVideoFile(f)).length
    const videoCount = media.filter(f => isVideoFile(f)).length
    const next = []
    for (const f of files) {
      if (isVideoFile(f)) {
        if (videoCount + next.filter(x => isVideoFile(x)).length >= 3) continue
        next.push(f)
      } else {
        if (photoCount + next.filter(x => !isVideoFile(x)).length >= 10) continue
        next.push(await compressImage(f))
      }
    }
    setMedia(prev => [...prev, ...next])
  }

  async function handlePhotosReady() {
    const photos = media.filter(f => !isVideoFile(f))
    if (!photos.length) {
      toast?.('Добавьте хотя бы одно фото', 'error')
      return
    }
    setRecognizing(true)
    try {
      const fd = new FormData()
      for (const p of photos.slice(0, 5)) fd.append('photos', p)
      const r = await castingApi.recognize(fd)
      const aiSet = new Set()
      const next = { ...form }
      const apply = (k, v) => { if (v) { next[k] = v; aiSet.add(k) } }
      if (KIND_OPTIONS.find(o => o.value === r.kind)) { next.kind = r.kind; aiSet.add('kind') }
      apply('gender', r.gender)
      apply('age_range', r.age_range)
      apply('hair_color', r.hair_color)
      apply('eye_color', r.eye_color)
      apply('body_type', r.body_type)
      apply('ethnicity', r.ethnicity)
      apply('tattoos', r.tattoos)
      apply('description', r.description)
      // search_tags сохраняем но в UI не показываем
      if (r.search_tags) next.search_tags = r.search_tags
      setForm(next)
      setAiFields(aiSet)
      const tagCount = (r.search_tags || '').split(/\s+/).filter(Boolean).length
      if (aiSet.size === 0) toast?.('AI не смог распознать — заполните вручную', 'info')
      else toast?.(`AI заполнил ${aiSet.size} ${aiSet.size === 1 ? 'поле' : 'полей'} и сгенерил ${tagCount} тегов для поиска`, 'success')
    } catch (err) {
      toast?.(err.message || 'AI недоступен — заполните вручную', 'error')
    } finally {
      setRecognizing(false)
      setStep(2)
    }
  }

  function clearAi(k) {
    setAiFields(prev => {
      const next = new Set(prev)
      next.delete(k)
      return next
    })
  }

  function setField(k, v) {
    setForm(f => ({ ...f, [k]: v }))
    clearAi(k)
  }

  async function handleSave() {
    if (!form.name.trim()) { setError('Укажите ФИО'); return }
    setSaving(true)
    setError('')
    try {
      const body = { ...form }
      // числовые поля из строк
      body.height = body.height ? Number(body.height) : null
      body.weight = body.weight ? Number(body.weight) : null
      // убираем пустоту
      Object.keys(body).forEach(k => {
        if (typeof body[k] === 'string' && body[k].trim() === '') body[k] = null
      })
      const card = await castingApi.create(body)
      let failed = 0
      for (const f of media) {
        const fd = new FormData()
        fd.append('photos', f)
        try { await castingApi.uploadPhoto(card.id, fd) } catch { failed++ }
      }
      if (failed > 0) toast?.(`Карточка создана, но ${failed} файл(ов) не загрузились`, 'error')
      else toast?.('Карточка добавлена', 'success')
      onCreated?.(card)
      onClose?.()
    } catch (err) {
      setError(err.message || 'Ошибка сохранения')
    } finally {
      setSaving(false)
    }
  }

  if (!open) return null

  const photoCount = media.filter(f => !isVideoFile(f)).length
  const videoCount = media.filter(f => isVideoFile(f)).length
  const aiBorder = (k) => aiFields.has(k) ? '1px solid var(--accent)' : '1px solid var(--border)'
  const aiBg = (k) => aiFields.has(k) ? 'var(--gold-50, #FAF6E8)' : 'var(--white)'

  return (
    <div onClick={onClose} style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 500,
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16,
    }}>
      <div onClick={e => e.stopPropagation()} style={{
        background: 'var(--white)', borderRadius: 'var(--radius-card)', padding: 24,
        maxWidth: 540, width: '100%', maxHeight: '92vh', overflowY: 'auto',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 20 }}>
          {[1,2,3].map(s => (
            <div key={s} style={{ display: 'flex', alignItems: 'center', flex: s < 3 ? 1 : 'none', gap: 6 }}>
              <div style={{ width: 24, height: 24, borderRadius: '50%', background: step >= s ? 'var(--accent)' : 'var(--border)', color: step >= s ? '#fff' : 'var(--muted)', fontSize: 11, fontWeight: 600, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>{s}</div>
              {s < 3 && <div style={{ flex: 1, height: 2, background: step > s ? 'var(--accent)' : 'var(--border)', borderRadius: 1 }} />}
            </div>
          ))}
        </div>

        {/* STEP 1 — медиа */}
        {step === 1 && (
          <>
            {recognizing ? (
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '48px 0', gap: 16 }}>
                <div style={{ width: 48, height: 48, border: '3px solid var(--border)', borderTopColor: 'var(--accent)', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
                <div style={{ fontSize: 14, fontWeight: 500 }}>AI анализирует фото…</div>
                <div style={{ fontSize: 13, color: 'var(--muted)' }}>Заполняем тип, возраст, описание и теги</div>
                <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
              </div>
            ) : (
              <>
                <div style={{ fontWeight: 600, fontSize: 16, marginBottom: 6 }}>Фото и видео</div>
                <div style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 12 }}>
                  До 10 фото и до 3 видео. AI распознаёт только по фото.
                </div>

                <div style={{ display: 'flex', gap: 10, marginBottom: 16, flexWrap: 'wrap' }}>
                  {media.map((f, i) => (
                    <div key={i} style={{ position: 'relative', width: 100, height: 100 }}>
                      {isVideoFile(f) ? (
                        <video src={URL.createObjectURL(f)} muted preload="metadata" style={{ width: 100, height: 100, objectFit: 'cover', borderRadius: 'var(--radius-btn)', border: '1px solid var(--border)' }} />
                      ) : (
                        <img src={URL.createObjectURL(f)} alt="" style={{ width: 100, height: 100, objectFit: 'cover', borderRadius: 'var(--radius-btn)', border: '1px solid var(--border)' }} />
                      )}
                      {isVideoFile(f) && (
                        <div style={{ position: 'absolute', bottom: 4, left: 4, background: 'rgba(0,0,0,0.7)', color: '#fff', fontSize: 10, fontWeight: 600, padding: '1px 6px', borderRadius: 3 }}>VIDEO</div>
                      )}
                      <button onClick={() => setMedia(p => p.filter((_, j) => j !== i))}
                        style={{ position: 'absolute', top: -6, right: -6, background: 'var(--red)', border: 'none', borderRadius: '50%', width: 20, height: 20, color: '#fff', fontSize: 12, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        <X size={12} />
                      </button>
                    </div>
                  ))}
                  {(photoCount < 10 || videoCount < 3) && (
                    <>
                      <button onClick={() => fileRef.current?.click()}
                        style={{ width: 100, height: 100, borderRadius: 'var(--radius-btn)', border: '2px dashed var(--border)', background: 'var(--bg)', cursor: 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 4, color: 'var(--muted)', fontSize: 12 }}>
                        <span style={{ fontSize: 24 }}>+</span> Файл
                      </button>
                      <button onClick={() => camRef.current?.click()}
                        style={{ width: 100, height: 100, borderRadius: 'var(--radius-btn)', border: '2px dashed var(--border)', background: 'var(--bg)', cursor: 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 4, color: 'var(--muted)', fontSize: 12 }}>
                        <Camera size={22} strokeWidth={1.4} /> Камера
                      </button>
                      {videoCount < 3 && (
                        <button onClick={() => videoRef.current?.click()}
                          style={{ width: 100, height: 100, borderRadius: 'var(--radius-btn)', border: '2px dashed var(--accent)', background: 'var(--bg)', cursor: 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 4, color: 'var(--accent)', fontSize: 12 }}>
                          <Film size={22} strokeWidth={1.4} /> Видео
                        </button>
                      )}
                    </>
                  )}
                </div>
                <input ref={fileRef} type="file" accept="image/*,video/mp4,video/webm,video/quicktime" multiple style={{ display: 'none' }} onChange={onFiles} />
                <input ref={camRef} type="file" accept="image/*" capture="environment" style={{ display: 'none' }} onChange={onFiles} />
                <input ref={videoRef} type="file" accept="video/*" capture="environment" style={{ display: 'none' }} onChange={onFiles} />

                <div style={{ display: 'flex', gap: 8 }}>
                  <Button variant="secondary" fullWidth onClick={onClose}>Отмена</Button>
                  <Button fullWidth disabled={photoCount < 1} onClick={handlePhotosReady}>
                    {photoCount < 1 ? 'Добавьте фото' : 'Готово'}
                  </Button>
                </div>
              </>
            )}
          </>
        )}

        {/* STEP 2 — данные с секциями */}
        {step === 2 && (
          <>
            <div style={{ fontWeight: 600, fontSize: 16, marginBottom: 6 }}>Данные актёра</div>
            <div style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 12 }}>
              <Sparkles size={12} style={{ display: 'inline', verticalAlign: -2, color: 'var(--accent)' }} /> золотым выделены поля от AI — проверьте.
            </div>

            {/* preview thumbnails */}
            {media.length > 0 && (
              <div style={{ display: 'flex', gap: 6, marginBottom: 12, overflowX: 'auto', paddingBottom: 4 }}>
                {media.map((f, i) => (
                  isVideoFile(f) ? (
                    <video key={i} src={URL.createObjectURL(f)} muted style={{ width: 48, height: 48, objectFit: 'cover', borderRadius: 6, border: '1px solid var(--border)', flexShrink: 0 }} />
                  ) : (
                    <img key={i} src={URL.createObjectURL(f)} alt="" style={{ width: 48, height: 48, objectFit: 'cover', borderRadius: 6, border: '1px solid var(--border)', flexShrink: 0 }} />
                  )
                ))}
              </div>
            )}

            {/* === Базовая (всегда видна) === */}
            <FL>Тип{aiFields.has('kind') && <AiBadge />}</FL>
            <div style={{ display: 'flex', gap: 6, marginBottom: 12 }}>
              {KIND_OPTIONS.map(k => {
                const Icon = k.icon
                const active = form.kind === k.value
                return (
                  <button key={k.value} onClick={() => setField('kind', k.value)}
                    style={{
                      flex: 1, height: 40, borderRadius: 'var(--radius-btn)',
                      border: active ? '2px solid var(--accent)' : '1px solid var(--border)',
                      background: active ? 'var(--gold-50, #FAF6E8)' : 'var(--white)',
                      color: active ? 'var(--text)' : 'var(--muted)',
                      fontWeight: active ? 600 : 400, fontSize: 13, cursor: 'pointer',
                      display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                    }}>
                    <Icon size={14} strokeWidth={1.6} /> {k.label}
                  </button>
                )
              })}
            </div>

            <FL>ФИО *</FL>
            <FI value={form.name} onChange={v => setField('name', v)} placeholder="Иванов Иван Иванович" />

            <Row>
              <Col>
                <FL>Роль в проекте</FL>
                <FI value={form.role_name} onChange={v => setField('role_name', v)} placeholder="Главный герой / массовка" />
              </Col>
              {form.kind !== 'animal' && (
                <Col>
                  <FL>Пол{aiFields.has('gender') && <AiBadge />}</FL>
                  <select value={form.gender} onChange={e => setField('gender', e.target.value)}
                    style={{ width: '100%', height: 38, padding: '0 10px', borderRadius: 'var(--radius-btn)', fontSize: 13, marginBottom: 12, background: aiBg('gender'), border: aiBorder('gender') }}>
                    <option value="">—</option>
                    <option value="male">Мужской</option>
                    <option value="female">Женский</option>
                  </select>
                </Col>
              )}
            </Row>

            <Row>
              <Col><FL>Возраст{aiFields.has('age_range') && <AiBadge />}</FL>
                <FI value={form.age_range} onChange={v => setField('age_range', v)} placeholder="25-35" highlight={aiFields.has('age_range')} />
              </Col>
              <Col><FL>Город</FL><FI value={form.city} onChange={v => setField('city', v)} placeholder="Москва" /></Col>
            </Row>

            <Row>
              <Col><FL>Телефон</FL><FI value={form.phone} onChange={v => setField('phone', v)} placeholder="+7 999 ..." /></Col>
              <Col><FL>Email</FL><FI value={form.email} onChange={v => setField('email', v)} placeholder="actor@mail.ru" /></Col>
            </Row>

            {/* === Внешность === */}
            <Section title="Внешность" open={openSection.appearance} onToggle={() => setOpenSection(s => ({ ...s, appearance: !s.appearance }))} hasAi={['hair_color','eye_color','body_type','ethnicity','description','tattoos'].some(k => aiFields.has(k))}>
              <Row>
                <Col><FL>Рост (см)</FL><FI type="number" value={form.height} onChange={v => setField('height', v)} placeholder="175" /></Col>
                <Col><FL>Вес (кг)</FL><FI type="number" value={form.weight} onChange={v => setField('weight', v)} placeholder="70" /></Col>
              </Row>
              <Row>
                <Col><FL>Размер одежды</FL><FI value={form.clothing_size} onChange={v => setField('clothing_size', v)} placeholder="48 / M" /></Col>
                <Col><FL>Размер обуви</FL><FI value={form.shoe_size} onChange={v => setField('shoe_size', v)} placeholder="42" /></Col>
              </Row>
              <Row>
                <Col><FL>{form.kind === 'animal' ? 'Цвет шерсти' : 'Цвет волос'}{aiFields.has('hair_color') && <AiBadge />}</FL>
                  <FI value={form.hair_color} onChange={v => setField('hair_color', v)} highlight={aiFields.has('hair_color')} />
                </Col>
                <Col><FL>Цвет глаз{aiFields.has('eye_color') && <AiBadge />}</FL>
                  <FI value={form.eye_color} onChange={v => setField('eye_color', v)} highlight={aiFields.has('eye_color')} />
                </Col>
              </Row>
              <Row>
                <Col><FL>Телосложение{aiFields.has('body_type') && <AiBadge />}</FL>
                  <FI value={form.body_type} onChange={v => setField('body_type', v)} highlight={aiFields.has('body_type')} />
                </Col>
                <Col><FL>{form.kind === 'animal' ? 'Порода' : 'Типаж'}{aiFields.has('ethnicity') && <AiBadge />}</FL>
                  <FI value={form.ethnicity} onChange={v => setField('ethnicity', v)} highlight={aiFields.has('ethnicity')} />
                </Col>
              </Row>
              <FL>Особые приметы (татуировки/шрамы/пирсинг){aiFields.has('tattoos') && <AiBadge />}</FL>
              <FI value={form.tattoos} onChange={v => setField('tattoos', v)} placeholder="Татуировка на левом предплечье" highlight={aiFields.has('tattoos')} />

              <FL>Описание внешности{aiFields.has('description') && <AiBadge />}</FL>
              <textarea value={form.description} onChange={e => setField('description', e.target.value)}
                placeholder="Внешние особенности..."
                style={{ width: '100%', minHeight: 60, padding: '8px 10px', borderRadius: 'var(--radius-btn)', fontSize: 13, marginBottom: 4, fontFamily: 'inherit', resize: 'vertical', boxSizing: 'border-box', background: aiBg('description'), border: aiBorder('description') }} />
            </Section>

            {/* === Навыки === */}
            <Section title="Навыки и умения" open={openSection.skills} onToggle={() => setOpenSection(s => ({ ...s, skills: !s.skills }))}>
              <FL>Языки</FL>
              <FI value={form.languages} onChange={v => setField('languages', v)} placeholder="русский английский немецкий" />
              <Row>
                <Col><FL>Водительские права (категории)</FL><FI value={form.driver_license} onChange={v => setField('driver_license', v)} placeholder="B C" /></Col>
                <Col style={{ display: 'flex', alignItems: 'flex-end', paddingBottom: 12 }}>
                  <Toggle label="Личный автомобиль" value={form.has_car} onChange={v => setField('has_car', v)} />
                </Col>
              </Row>
              <FL>Спорт / специальные навыки</FL>
              <FI value={form.skills} onChange={v => setField('skills', v)} placeholder="плавание лыжи верховая езда стрельба бокс" />
              <Row>
                <Col><FL>Музыка</FL><FI value={form.music_skills} onChange={v => setField('music_skills', v)} placeholder="вокал гитара" /></Col>
                <Col><FL>Танцы</FL><FI value={form.dance_skills} onChange={v => setField('dance_skills', v)} placeholder="современный бальные" /></Col>
              </Row>
            </Section>

            {/* === Прочее === */}
            <Section title="Прочее" open={openSection.extras} onToggle={() => setOpenSection(s => ({ ...s, extras: !s.extras }))}>
              <FL>Агентство</FL>
              <FI value={form.agency} onChange={v => setField('agency', v)} placeholder="Кастинг-агентство" />
              <FL>Опыт</FL>
              <textarea value={form.experience} onChange={e => setField('experience', e.target.value)}
                placeholder="Фильмография, театральный опыт..."
                style={{ width: '100%', minHeight: 50, padding: '8px 10px', border: '1px solid var(--border)', borderRadius: 'var(--radius-btn)', fontSize: 13, marginBottom: 12, fontFamily: 'inherit', resize: 'vertical', boxSizing: 'border-box', background: 'var(--white)' }} />
              <FL>Портфолио / соцсети</FL>
              <FI value={form.social_links} onChange={v => setField('social_links', v)} placeholder="https://..." />
              <FL>Гонорар</FL>
              <FI value={form.rate} onChange={v => setField('rate', v)} placeholder="Свободно / договорной / 5000₽ за смену" />
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, marginTop: 4 }}>
                <Toggle label="Готов к раздеванию" value={form.accepts_nudity} onChange={v => setField('accepts_nudity', v)} />
                <Toggle label="Готов к трюкам" value={form.accepts_stunts} onChange={v => setField('accepts_stunts', v)} />
                <Toggle label="Готов к выездам" value={form.accepts_travel} onChange={v => setField('accepts_travel', v)} />
                <Toggle label="Загранпаспорт" value={form.has_passport} onChange={v => setField('has_passport', v)} />
              </div>
              <FL>Заметки</FL>
              <textarea value={form.notes} onChange={e => setField('notes', e.target.value)}
                placeholder="Свободный комментарий, договорённости..."
                style={{ width: '100%', minHeight: 50, padding: '8px 10px', border: '1px solid var(--border)', borderRadius: 'var(--radius-btn)', fontSize: 13, marginTop: 8, fontFamily: 'inherit', resize: 'vertical', boxSizing: 'border-box', background: 'var(--white)' }} />
            </Section>

            <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
              <Button variant="secondary" fullWidth onClick={() => setStep(1)}>Назад</Button>
              <Button fullWidth disabled={!form.name.trim()} onClick={() => setStep(3)}>Далее</Button>
            </div>
          </>
        )}

        {/* STEP 3 — подтверждение (без выбора статуса) */}
        {step === 3 && (
          <>
            <div style={{ fontWeight: 600, fontSize: 16, marginBottom: 6 }}>Подтверждение</div>
            <div style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 16 }}>Проверьте и сохраните карточку</div>

            <div style={{ display: 'flex', gap: 12, marginBottom: 16, padding: 12, background: 'var(--bg)', borderRadius: 'var(--radius-card)' }}>
              {media.find(f => !isVideoFile(f)) ? (
                <img src={URL.createObjectURL(media.find(f => !isVideoFile(f)))} alt="" style={{ width: 80, height: 100, objectFit: 'cover', borderRadius: 'var(--radius-btn)', border: '1px solid var(--border)' }} />
              ) : (
                <div style={{ width: 80, height: 100, background: 'var(--white)', borderRadius: 'var(--radius-btn)', border: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--muted)' }}>—</div>
              )}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 600, fontSize: 15 }}>{form.name}</div>
                {form.role_name && <div style={{ fontSize: 12, color: 'var(--accent)', marginTop: 2 }}>{form.role_name}</div>}
                <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 6, display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  <span style={{ background: 'var(--white)', padding: '2px 8px', borderRadius: 10, border: '1px solid var(--border)' }}>
                    {KIND_OPTIONS.find(k => k.value === form.kind)?.label}
                  </span>
                  {form.gender && <span>{form.gender === 'male' ? 'М' : form.gender === 'female' ? 'Ж' : form.gender}</span>}
                  {form.age_range && <span>{form.age_range} лет</span>}
                  {form.height && <span>{form.height} см</span>}
                  {form.city && <span>· {form.city}</span>}
                </div>
                {/* Доступность-флажки */}
                {(form.has_car || form.has_passport || form.accepts_travel || form.accepts_stunts || form.accepts_nudity) && (
                  <div style={{ marginTop: 6, fontSize: 11, color: 'var(--muted)' }}>
                    {form.has_car && '🚗 авто '}
                    {form.has_passport && '🌐 загран '}
                    {form.accepts_travel && '✈️ выезды '}
                    {form.accepts_stunts && '🎬 трюки '}
                    {form.accepts_nudity && '🔞 раздевание '}
                  </div>
                )}
              </div>
            </div>

            {error && <div style={{ color: 'var(--red)', fontSize: 13, marginBottom: 10 }}>{error}</div>}
            <div style={{ display: 'flex', gap: 8 }}>
              <Button variant="secondary" fullWidth onClick={() => setStep(2)}>Назад</Button>
              <Button fullWidth loading={saving} onClick={handleSave}>Сохранить</Button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

function FL({ children }) {
  return <div style={{ fontSize: 12, fontWeight: 500, marginBottom: 4, color: 'var(--muted)', display: 'flex', alignItems: 'center', gap: 6 }}>{children}</div>
}

function FI({ value, onChange, placeholder, type = 'text', highlight = false }) {
  return (
    <input type={type} value={value || ''} onChange={e => onChange(e.target.value)} placeholder={placeholder}
      style={{
        width: '100%', height: 38, padding: '0 10px',
        border: highlight ? '1px solid var(--accent)' : '1px solid var(--border)',
        background: highlight ? 'var(--gold-50, #FAF6E8)' : 'var(--white)',
        borderRadius: 'var(--radius-btn)', fontSize: 13, marginBottom: 12,
        outline: 'none', boxSizing: 'border-box',
      }} />
  )
}

function AiBadge() {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, color: 'var(--accent)', fontSize: 10, fontWeight: 600, marginLeft: 4 }}>
      <Sparkles size={10} /> AI
    </span>
  )
}

function Row({ children }) {
  return <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>{children}</div>
}
function Col({ children, style }) {
  return <div style={style}>{children}</div>
}

function Section({ title, open, onToggle, hasAi, children }) {
  return (
    <div style={{ marginTop: 14, border: '1px solid var(--border)', borderRadius: 'var(--radius-btn)', background: 'var(--bg)', overflow: 'hidden' }}>
      <button type="button" onClick={onToggle}
        style={{ width: '100%', padding: '10px 12px', background: 'transparent', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          {title}
          {hasAi && <span style={{ background: 'var(--gold-50, #FAF6E8)', color: 'var(--accent)', fontSize: 10, fontWeight: 600, padding: '1px 6px', borderRadius: 8 }}>AI</span>}
        </span>
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
    <label style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', borderRadius: 'var(--radius-btn)', border: `1px solid ${value ? 'var(--accent)' : 'var(--border)'}`, background: value ? 'var(--gold-50, #FAF6E8)' : 'var(--white)', cursor: 'pointer', fontSize: 12, color: 'var(--text)', fontWeight: value ? 500 : 400 }}>
      <input type="checkbox" checked={!!value} onChange={e => onChange(e.target.checked)}
        style={{ width: 16, height: 16, accentColor: 'var(--accent)', cursor: 'pointer', flexShrink: 0 }} />
      <span>{label}</span>
    </label>
  )
}
