import { useState, useEffect } from 'react'
import { useNavigate, useParams, useLocation } from 'react-router-dom'
import { Check, Pencil } from 'lucide-react'
import WarehouseLayout from '../warehouse/WarehouseLayout'
import Button from '../shared/Button'
import ConfirmModal from '../shared/ConfirmModal'
import MultiPhotoPicker from '../shared/MultiPhotoPicker'
import SignatureCanvas from '../shared/SignatureCanvas'
import EditRequestItemsModal from '../warehouse/EditRequestItemsModal'
import { useToast } from '../shared/Toast'
import { requests as requestsApi, issuances as issuancesApi, units as unitsApi, rent as rentApi } from '../../services/api'

const STEPS = ['Сборка', 'Фото', 'Подпись']

function getAgreementText(receiverName, deadline) {
  const today = new Date().toLocaleDateString('ru-RU')
  return `СОГЛАШЕНИЕ ОБ ОТВЕТСТВЕННОСТИ

г. Москва                                          ${today}

Я, ${receiverName}, принимая имущество склада компании 3XMedia Production, обязуюсь:

1. Обеспечить сохранность переданного имущества.
2. Использовать имущество только в целях производства.
3. Вернуть имущество в надлежащем состоянии в установленный срок.
4. Возместить ущерб в случае повреждения или утраты имущества.

Срок возврата: ${deadline ? new Date(deadline).toLocaleDateString('ru-RU') : '—'}`
}

export default function IssuePage() {
  const navigate = useNavigate()
  const location = useLocation()
  const toast = useToast()
  const { id: paramId } = useParams()
  // Публичная выдача — URL вида /issue/rent/:id. Аренда использует rent_deal
  // вместо request и имеет свой endpoint для финального issue.
  const isPublicRent = location.pathname.startsWith('/issue/rent/')
  const requestId = isPublicRent ? null : paramId
  const rentDealId = isPublicRent ? paramId : null
  const [step, setStep] = useState(0)
  const [units, setUnits] = useState([])
  const [selected, setSelected] = useState(new Set())
  const [photos, setPhotos] = useState({})          // { [unitId]: File[] }
  const MIN_PHOTOS_PER_UNIT = 2
  const [deadline, setDeadline] = useState('')
  const [issueDate, setIssueDate] = useState(new Date().toISOString().split('T')[0])
  const [receiverName, setReceiverName] = useState('')
  const [receiverId, setReceiverId] = useState('')
  const [gathered, setGathered] = useState({})
  const [missing, setMissing] = useState(new Set())
  const [loading, setLoading] = useState(false)
  const [initLoading, setInitLoading] = useState(true)
  const [success, setSuccess] = useState(false)
  const [receiverSig, setReceiverSig] = useState(null)
  const [issuerStamped, setIssuerStamped] = useState(false)
  const [missingTarget, setMissingTarget] = useState(null)    // unit id pending missing-confirm
  // Залог — только для партнёрской выдачи, отправляется в rent_deal.deposit.
  const [showDeposit, setShowDeposit] = useState(false)
  const [depositAmount, setDepositAmount] = useState('')
  // Открыта ли модалка «Доложить состав» (POST /requests/:id/items).
  // Доступна только для проектных заявок (не rent_deal) на шаге Сборки.
  const [editingItems, setEditingItems] = useState(false)

  // Перезагружает заявку и её состав. Дёргается из useEffect и после
  // EditRequestItemsModal.onSaved — после правки состава нужно подтянуть
  // свежий unit_ids (могли добавиться новые/удалиться старые).
  async function reloadRequestUnits() {
    if (!requestId) return
    const data = await requestsApi.list().catch(() => ({ requests: [] }))
    const req = (data.requests || []).find(r => String(r.id) === String(requestId))
    if (!req) return
    setReceiverId(req.requester_id)
    setReceiverName(req.requester_name || 'Пользователь')
    const ids = req.unit_ids || []
    const ud = await unitsApi.list().catch(() => ({ units: [] }))
    const us = (ud.units || []).filter(u => ids.includes(u.id))
    setUnits(us)
    // Сохраняем уже-собранные галочки и пользовательский выбор, если позиции
    // не были удалены. Новые позиции по умолчанию выбраны (как при первой загрузке).
    setSelected(prev => {
      const keep = new Set([...prev].filter(id => ids.includes(id)))
      for (const u of us) keep.add(u.id)
      return keep
    })
  }

  useEffect(() => {
    if (rentDealId) {
      // Публичная — грузим rent_deal, period_end → deadline, period_start → issueDate.
      rentApi.get(rentDealId).then(({ deal }) => {
        if (!deal) return
        setReceiverName(deal.counterparty_name || 'Контрагент')
        setReceiverId('') // нет user_id у публичного контрагента
        if (deal.period_end) setDeadline(deal.period_end.slice(0, 10))
        if (deal.period_start) setIssueDate(deal.period_start.slice(0, 10))
        // Prefill залога, если был указан при cart-request.
        if (deal.deposit != null && deal.deposit !== '' && Number(deal.deposit) > 0) {
          setDepositAmount(String(deal.deposit))
          setShowDeposit(true)
        }
        const ids = deal.unit_ids || []
        unitsApi.list().then(ud => {
          const us = (ud.units || []).filter(u => ids.includes(u.id))
          setUnits(us)
          setSelected(new Set(us.map(u => u.id)))
        })
      }).finally(() => setInitLoading(false))
    } else if (requestId) {
      reloadRequestUnits().finally(() => setInitLoading(false))
    } else {
      unitsApi.list({ status: 'on_stock' }).then(data => {
        setUnits(data.units || [])
      }).finally(() => setInitLoading(false))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requestId, rentDealId])

  const selectedUnits = units.filter(u => selected.has(u.id) && !missing.has(u.id))

  async function confirmMissing() {
    if (!missingTarget) return
    const unitId = missingTarget
    try {
      await unitsApi.markMissing(unitId, 'Не найдено при сборке заявки')
      toast?.('Отмечено как отсутствующее — единица в списке «Пересорт»', 'success')
      setMissing(s => { const n = new Set(s); n.add(unitId); return n })
      setSelected(s => { const n = new Set(s); n.delete(unitId); return n })
      setGathered(g => { const n = { ...g }; delete n[unitId]; return n })
    } catch (e) {
      toast?.(e.message || 'Ошибка', 'error')
    }
    setMissingTarget(null)
  }

  function toggleGathered(id) {
    setGathered(g => ({ ...g, [id]: !g[id] }))
    setSelected(s => { const n = new Set(s); n.add(id); return n })
  }

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
        canvas.toBlob(blob => resolve(new File([blob], file.name.replace(/\.[^.]+$/, '.jpg'), { type: 'image/jpeg' })), 'image/jpeg', quality)
      }
      img.src = URL.createObjectURL(file)
    })
  }

  async function setUnitPhotos(unitId, files) {
    const processed = await Promise.all(
      files.map(f => f.type?.startsWith('video/') || f.type === 'image/jpeg' && f.size < 500_000 ? f : compressImage(f))
    )
    setPhotos(p => ({ ...p, [unitId]: processed }))
  }

  async function handleIssue(signatureData) {
    setLoading(true)
    try {
      const fd = new FormData()
      const finalDeadline = deadline || new Date(Date.now() + 7 * 86400000).toISOString().split('T')[0]
      fd.append('deadline', finalDeadline)
      fd.append('signature_data', signatureData)
      fd.append('issuer_signature_data', 'stamp')

      for (const uid of selected) {
        const files = photos[uid] || []
        for (const f of files) fd.append(`photos_${uid}`, f)
      }

      if (rentDealId) {
        // Публичная: отдельный endpoint + issue_date + залог (опционально).
        fd.append('issue_date', issueDate)
        if (showDeposit && depositAmount) fd.append('deposit', String(depositAmount))
        await rentApi.issuePublic(rentDealId, fd)
      } else {
        if (requestId) fd.append('request_id', requestId)
        fd.append('received_by', receiverId)
        await issuancesApi.issue(fd)
      }
      setSuccess(true)
      // Акт сохраняется автоматически в /acts. Редирект — в раздел «Выдано»,
      // где пользователь сразу видит свежую выдачу под нужным проектом.
      setTimeout(() => navigate('/issued'), 1600)
    } catch (err) {
      toast?.(err.message || 'Ошибка выдачи', 'error')
    } finally {
      setLoading(false)
    }
  }

  const allGathered = selectedUnits.length > 0 && selectedUnits.every(u => gathered[u.id])
  const allPhotos = selectedUnits.every(u => (photos[u.id] || []).length >= MIN_PHOTOS_PER_UNIT)

  return (
    <WarehouseLayout>
      <div style={{ padding: '24px 32px', maxWidth: 700 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 28 }}>
          <button onClick={() => step > 0 ? setStep(s => s - 1) : navigate(-1)}
            style={{ background: 'none', border: 'none', fontSize: 20, cursor: 'pointer', color: 'var(--muted)' }}>
            ←
          </button>
          <div>
            <h1 style={{ fontSize: 18, fontWeight: 600 }}>Выдача имущества</h1>
            {receiverName && <p style={{ fontSize: 13, color: 'var(--muted)' }}>{receiverName}</p>}
          </div>
        </div>

        {/* Step indicator */}
        <div style={{ display: 'flex', gap: 0, marginBottom: 28 }}>
          {STEPS.map((s, i) => (
            <div key={s} style={{ flex: 1, display: 'flex', alignItems: 'center' }}>
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', flex: 1 }}>
                <div style={{
                  width: 28, height: 28, borderRadius: '50%', display: 'flex',
                  alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 600,
                  background: i < step ? 'var(--green)' : i === step ? 'var(--blue)' : 'var(--border)',
                  color: i <= step ? 'var(--white)' : 'var(--muted)', transition: 'all 0.2s',
                }}>
                  {i < step ? '✓' : i + 1}
                </div>
                <div style={{ fontSize: 11, color: i === step ? 'var(--blue)' : 'var(--muted)', marginTop: 4, fontWeight: i === step ? 600 : 400 }}>
                  {s}
                </div>
              </div>
              {i < STEPS.length - 1 && (
                <div style={{ height: 2, flex: 1, background: i < step ? 'var(--green)' : 'var(--border)', marginBottom: 18, transition: 'background 0.2s' }} />
              )}
            </div>
          ))}
        </div>

        {/* Step 0 — Сборка (объединено: список + сбор + даты) */}
        {step === 0 && (
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 4 }}>
              <div style={{ fontWeight: 600, flex: 1 }}>Сборка</div>
              {/* «Доложить состав» — открывает EditRequestItemsModal,
                  переиспользует backend POST /requests/:id/items.
                  Доступно только для проектных заявок (не rent_deal). */}
              {requestId && !rentDealId && (
                <button onClick={() => setEditingItems(true)} style={{
                  display: 'flex', alignItems: 'center', gap: 6,
                  padding: '6px 12px', fontSize: 12, fontWeight: 500,
                  background: 'var(--bg)', color: 'var(--text)',
                  border: '1px solid var(--border)', borderRadius: 'var(--radius-btn)',
                  cursor: 'pointer', fontFamily: 'inherit',
                }}>
                  <Pencil size={13} /> Состав
                </button>
              )}
            </div>
            <div style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 16 }}>
              Отметьте каждую единицу по мере сбора. Если чего-то нет — кликните «Нет в наличии».
              {requestId && !rentDealId && ' Хотите доложить ещё — кнопка «Состав» сверху.'}
            </div>
            {initLoading && <div style={{ color: 'var(--muted)', fontSize: 13 }}>Загрузка...</div>}
            {!initLoading && selectedUnits.length > 0 && (
              <div style={{
                fontSize: 13, fontWeight: 600, marginBottom: 12,
                color: allGathered ? 'var(--green)' : 'var(--amber)',
              }}>
                {allGathered ? '✓ Всё собрано' : `Собираю... (${selectedUnits.filter(u => gathered[u.id]).length}/${selectedUnits.length})`}
              </div>
            )}
            {units.filter(u => !missing.has(u.id)).map(u => {
              const done = !!gathered[u.id]
              return (
                <div key={u.id} onClick={() => toggleGathered(u.id)} style={{
                  display: 'flex', alignItems: 'center', gap: 12, padding: '14px 16px',
                  borderRadius: 'var(--radius-card)',
                  border: `2px solid ${done ? 'var(--green)' : 'var(--border)'}`,
                  background: done ? 'var(--green-dim)' : 'var(--white)',
                  marginBottom: 10, cursor: 'pointer', transition: 'all 0.15s',
                }}>
                  <div style={{
                    width: 22, height: 22, borderRadius: 4, flexShrink: 0,
                    border: `2px solid ${done ? 'var(--green)' : 'var(--border)'}`,
                    background: done ? 'var(--green)' : 'transparent',
                    display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'white', fontSize: 13,
                  }}>
                    {done ? '✓' : ''}
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 500 }}>{u.name}</div>
                    <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>{u.serial} · {u.category}</div>
                  </div>
                  {!done && (
                    <button onClick={e => { e.stopPropagation(); setMissingTarget(u.id) }} style={{
                      fontSize: 11, color: 'var(--red)', background: 'rgba(239,68,68,0.08)',
                      border: '1px solid var(--red)', borderRadius: 6,
                      padding: '5px 11px', cursor: 'pointer', fontWeight: 500,
                    }}>Нет в наличии</button>
                  )}
                  {done && <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--green)' }}>Собрано</div>}
                </div>
              )
            })}

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginTop: 16, marginBottom: 16 }}>
              <div>
                <div style={{ fontSize: 13, fontWeight: 500, marginBottom: 6 }}>Дата выдачи</div>
                <input type="date" value={issueDate} onChange={e => setIssueDate(e.target.value)}
                  style={{ width: '100%', height: 40, padding: '0 10px', border: '1px solid var(--border)', borderRadius: 'var(--radius-btn)', fontSize: 13, outline: 'none', boxSizing: 'border-box' }} />
              </div>
              <div>
                <div style={{ fontSize: 13, fontWeight: 500, marginBottom: 6 }}>Срок возврата</div>
                <input type="date" value={deadline} onChange={e => setDeadline(e.target.value)}
                  style={{ width: '100%', height: 40, padding: '0 10px', border: '1px solid var(--border)', borderRadius: 'var(--radius-btn)', fontSize: 13, outline: 'none', boxSizing: 'border-box' }} />
              </div>
            </div>

            {/* Залог — только для партнёрской выдачи. Кнопка-toggle как в NewDeal RentPage. */}
            {rentDealId && (
              <div style={{ marginBottom: 16, display: 'flex', alignItems: 'center', gap: 8 }}>
                <button type="button" onClick={() => setShowDeposit(v => !v)} style={{
                  padding: '8px 14px', borderRadius: 'var(--radius-btn)', fontSize: 13, fontWeight: 500, cursor: 'pointer',
                  border: '1px solid var(--border)',
                  background: showDeposit ? 'var(--green-dim)' : 'var(--white)',
                  color: showDeposit ? 'var(--green)' : 'var(--text)',
                  fontFamily: 'inherit',
                }}>
                  {showDeposit ? '✓ Залог' : '+ Залог'}
                </button>
                {showDeposit && (
                  <input type="number" placeholder="Сумма залога ₽" value={depositAmount}
                    onChange={e => setDepositAmount(e.target.value)}
                    style={{
                      flex: 1, height: 38, padding: '0 10px',
                      border: '2px solid var(--green)', borderRadius: 'var(--radius-btn)',
                      fontSize: 13, outline: 'none', background: 'var(--green-dim)', boxSizing: 'border-box',
                    }} />
                )}
              </div>
            )}

            <Button fullWidth disabled={selectedUnits.length === 0 || !allGathered || !deadline} style={{ marginTop: 8 }}
              onClick={() => setStep(1)}>
              Далее — Фото ({selectedUnits.length} ед.)
            </Button>
          </div>
        )}

        {/* Step 1 — Фото + Соглашение (объединено) */}
        {step === 1 && (
          <div>
            <div style={{ fontWeight: 600, marginBottom: 4 }}>Фото и соглашение</div>
            <div style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 16 }}>Минимум {MIN_PHOTOS_PER_UNIT} фото к каждой единице</div>

            {selectedUnits.map(u => (
              <div key={u.id} style={{
                padding: '14px 16px', marginBottom: 10,
                border: '1px solid var(--border)', borderRadius: 'var(--radius-card)',
                background: 'var(--white)',
              }}>
                <div style={{ marginBottom: 10 }}>
                  <div style={{ fontWeight: 500 }}>{u.name}</div>
                  <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>{u.serial} · {u.category}</div>
                </div>
                <MultiPhotoPicker files={photos[u.id] || []} min={MIN_PHOTOS_PER_UNIT}
                  onChange={files => setUnitPhotos(u.id, files)} />
              </div>
            ))}

            <div style={{
              background: 'var(--bg)', border: '1px solid var(--border)',
              borderRadius: 'var(--radius-card)', padding: 20, margin: '18px 0',
              fontSize: 13, lineHeight: 1.7, whiteSpace: 'pre-line',
              maxHeight: 280, overflowY: 'auto',
            }}>
              {getAgreementText(receiverName, deadline)}
              <div style={{ marginTop: 14, paddingTop: 14, borderTop: '1px solid var(--border)' }}>
                <div style={{ fontWeight: 600, marginBottom: 8 }}>Перечень имущества:</div>
                {selectedUnits.map((u, i) => (
                  <div key={u.id} style={{ marginBottom: 3 }}>{i + 1}. {u.name} — {u.serial}</div>
                ))}
              </div>
            </div>

            <Button fullWidth disabled={!allPhotos} onClick={() => setStep(2)}>
              {allPhotos ? 'Далее — Подпись' : 'Загрузите фото ко всем единицам'}
            </Button>
          </div>
        )}

        {/* Step 2 — Подписи (получатель + штамп склада) */}
        {step === 2 && (
          <div>
            {!receiverSig ? (
              <>
                <div style={{ fontWeight: 600, marginBottom: 4 }}>Подпись получателя</div>
                {receiverName && <div style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 16 }}>{receiverName}</div>}
                <SignatureCanvas
                  onSave={data => setReceiverSig(data)}
                  onClear={() => {}}
                />
              </>
            ) : (
              <>
                <div style={{ fontWeight: 600, marginBottom: 4 }}>Подпись выдавшего</div>
                <div style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 16 }}>Нажмите на поле — штамп склада</div>
                <div
                  onClick={() => setIssuerStamped(true)}
                  style={{
                    width: '100%', height: 100, border: '2px dashed var(--border)',
                    borderRadius: 'var(--radius-card)', display: 'flex', alignItems: 'center',
                    justifyContent: 'center', cursor: 'pointer', marginBottom: 16,
                    background: issuerStamped ? 'var(--accent-dim)' : 'var(--bg)',
                    borderColor: issuerStamped ? 'var(--accent)' : 'var(--border)',
                  }}
                >
                  {issuerStamped ? (
                    <div style={{ textAlign: 'center' }}>
                      <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--accent)' }}>Штамп / Подпись</div>
                      <div style={{ fontSize: 12, color: 'var(--accent)', marginTop: 4 }}>Сотрудник склада</div>
                    </div>
                  ) : (
                    <div style={{ color: 'var(--muted)', fontSize: 13 }}>Нажмите для подтверждения</div>
                  )}
                </div>
                <Button fullWidth disabled={!issuerStamped || loading} onClick={() => handleIssue(receiverSig)}>
                  {loading ? 'Сохранение...' : 'Оформить выдачу'}
                </Button>
                <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 12, textAlign: 'center' }}>
                  После подтверждения будет сформирован PDF акт
                </div>
              </>
            )}
          </div>
        )}
      </div>

      <ConfirmModal
        open={!!missingTarget}
        title="Отметить предмет как отсутствующий"
        message={missingTarget ? `Единица «${units.find(u => u.id === missingTarget)?.name || ''}» попадёт в список «Пересорт» и заблюрится на складе. Это можно отменить, найдя предмет.` : ''}
        confirmLabel="Отметить"
        cancelLabel="Отмена"
        onConfirm={confirmMissing}
        onCancel={() => setMissingTarget(null)}
      />

      {editingItems && requestId && (
        <EditRequestItemsModal
          requestId={requestId}
          initialUnits={units.map(u => ({
            id: u.id, name: u.name, category: u.category,
            qty: u.qty || 1, serial: u.serial,
            photo_url: (u.photos && u.photos[0]?.url) || u.photo_url || null,
          }))}
          onClose={() => setEditingItems(false)}
          onSaved={async () => {
            setEditingItems(false)
            // Перечитываем заявку — backend переписал unit_ids, могли появиться
            // новые units (созданные через фото) или удалиться старые.
            await reloadRequestUnits()
          }}
        />
      )}

      {success && (
        <div style={{
          position: 'fixed', inset: 0,
          background: 'rgba(10,10,10,0.55)',
          backdropFilter: 'blur(3px)',
          zIndex: 500, display: 'flex',
          alignItems: 'center', justifyContent: 'center',
        }}>
          <div style={{
            background: 'var(--card)', borderRadius: 16,
            padding: '36px 40px 32px', maxWidth: 360,
            textAlign: 'center',
            border: '1px solid var(--border)',
            boxShadow: '0 24px 60px rgba(0,0,0,0.22), 0 2px 8px rgba(0,0,0,0.08)',
            animation: 'iss-pop 0.22s ease',
          }}>
            <div style={{
              width: 58, height: 58, borderRadius: '50%',
              background: 'var(--gold-100)',
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              marginBottom: 16,
              boxShadow: '0 0 0 6px rgba(184,147,90,0.12)',
            }}>
              <Check size={28} color="var(--gold-600)" strokeWidth={1.8} />
            </div>
            <div style={{ fontWeight: 600, fontSize: 18, marginBottom: 8, letterSpacing: '-0.01em' }}>
              Выдача оформлена
            </div>
            <div style={{ fontSize: 13, color: 'var(--muted)', lineHeight: 1.5 }}>
              Акт сформирован и подписан обеими сторонами
            </div>
          </div>
          <style>{`@keyframes iss-pop{from{transform:scale(0.9);opacity:0}to{transform:scale(1);opacity:1}}`}</style>
        </div>
      )}
    </WarehouseLayout>
  )
}
