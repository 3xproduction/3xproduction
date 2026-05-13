import { useState, useEffect } from 'react'
import { useNavigate, useParams, useLocation } from 'react-router-dom'
import { Check } from 'lucide-react'
import WarehouseLayout from '../warehouse/WarehouseLayout'
import Button from '../shared/Button'
import PhotoUpload from '../shared/PhotoUpload'
import MultiPhotoPicker from '../shared/MultiPhotoPicker'
import SignatureCanvas from '../shared/SignatureCanvas'
import { issuances as issuancesApi, units as unitsApi, writeoffs as writeoffsApi, debts as debtsApi, rent as rentApi } from '../../services/api'
import { useAuth } from '../../hooks/useAuth'

const CONDITIONS = [
  { value: 'excellent', label: 'Отлично',   color: 'var(--green)' },
  { value: 'good',      label: 'Хорошее',   color: 'var(--blue)' },
  { value: 'damaged',   label: 'Повреждено', color: 'var(--red)' },
  { value: 'writeoff',  label: 'Списать',   color: 'var(--red)' },
  { value: 'debt',      label: 'В долг',    color: 'var(--amber, #d97706)' },
]

const STEPS = ['Список', 'Фото и состояние', 'Подписи']

export default function ReturnPage() {
  const navigate = useNavigate()
  const location = useLocation()
  const { id: paramId } = useParams()
  const { user } = useAuth()
  // Публичная аренда использует тот же визард под маршрутом /return/rent/:id
  // (по аналогии с /issue/rent/:id). Идентифицируем режим по URL.
  const isRent = location.pathname.startsWith('/return/rent/')
  const issuanceId = isRent ? null : paramId
  const rentDealId = isRent ? paramId : null
  const [step, setStep] = useState(0)
  const [issuance, setIssuance] = useState(null)
  const [rentDeal, setRentDeal] = useState(null)
  const [units, setUnits] = useState([])
  const [selected, setSelected] = useState(new Set())
  const [conditions, setConditions] = useState({})
  const [damages, setDamages] = useState({})
  const [photos, setPhotos] = useState({})
  const [loading, setLoading] = useState(false)
  const [initLoading, setInitLoading] = useState(true)
  const [returnerSignature, setReturnerSignature] = useState(null)
  const [acceptorStamped, setAcceptorStamped] = useState(false)
  const [success, setSuccess] = useState(false)

  useEffect(() => {
    if (isRent) {
      rentApi.get(rentDealId).then(({ deal }) => {
        if (!deal) return
        setRentDeal(deal)
        const unitIds = deal.unit_ids || []
        setSelected(new Set(unitIds))
        unitsApi.list().then(ud => {
          const ids = unitIds.map(String)
          const us = (ud.units || []).filter(u => ids.includes(String(u.id)))
          setUnits(us.length ? us : unitIds.map(id => ({ id, name: `Единица #${id}`, serial: '', photos: [] })))
        }).catch(() => {
          setUnits(unitIds.map(id => ({ id, name: `Единица #${id}`, serial: '', photos: [] })))
        })
      }).finally(() => setInitLoading(false))
      return
    }
    issuancesApi.active().then(data => {
      const iss = (data.issuances || []).find(i => String(i.id) === String(issuanceId))
      if (iss) {
        setIssuance(iss)
        const unitIds = iss.unit_ids || []
        setSelected(new Set(unitIds))
        unitsApi.list().then(ud => {
          const ids = unitIds.map(String)
          const us = (ud.units || []).filter(u => ids.includes(String(u.id)))
          setUnits(us.length ? us : unitIds.map(id => ({ id, name: `Единица #${id}`, serial: '', photos: [] })))
        }).catch(() => {
          setUnits(unitIds.map(id => ({ id, name: `Единица #${id}`, serial: '', photos: [] })))
        })
      }
    }).finally(() => setInitLoading(false))
  }, [issuanceId, rentDealId, isRent])

  function toggleUnit(id) {
    setSelected(s => {
      const next = new Set(s)
      if (next.has(id)) {
        next.delete(id)
      } else {
        next.add(id)
      }
      return next
    })
    // При снятии галочки сбрасываем ранее проставленное состояние (writeoff/debt).
    setConditions(prev => {
      if (prev[id] == null) return prev
      const next = { ...prev }
      delete next[id]
      return next
    })
  }

  // Быстрая отметка «Списать»/«В долг» прямо со списка — единица попадает
  // в выбранные и её condition сразу выставлен, чтобы на шаге «Состояние»
  // нужное уже было выбрано.
  function quickMark(id, kind) {
    setSelected(s => {
      const next = new Set(s)
      next.add(id)
      return next
    })
    setConditions(prev => {
      if (prev[id] === kind) {
        const next = { ...prev }
        delete next[id]
        return next
      }
      return { ...prev, [id]: kind }
    })
  }

  const canWriteoff = ['warehouse_director', 'warehouse_deputy', 'warehouse_staff'].includes(user?.role)

  function setPhoto(unitId, idx, file) {
    setPhotos(p => {
      const arr = [...(p[unitId] || [null, null, null])]
      arr[idx] = file
      return { ...p, [unitId]: arr }
    })
  }

  const selectedUnits = units.filter(u => selected.has(u.id))

  async function handleReturn(signatureData) {
    setLoading(true)
    try {
      const condMap = {}
      for (const uid of selected) {
        condMap[uid] = conditions[uid] || 'good'
      }
      const fd = new FormData()
      if (isRent) fd.append('rent_deal_id', rentDealId)
      else fd.append('issuance_id', issuanceId)
      fd.append('items_condition', JSON.stringify(condMap))
      fd.append('signature_data', returnerSignature || '')
      fd.append('returner_signature_data', returnerSignature || '')
      fd.append('acceptor_signature_data', signatureData)
      // merge all damage notes
      const allNotes = Object.entries(damages)
        .filter(([, v]) => v)
        .map(([id, v]) => {
          const u = units.find(u => String(u.id) === String(id))
          return `${u?.name || id}: ${v}`
        })
        .join('; ')
      if (allNotes) fd.append('condition_notes', allNotes)

      for (const uid of selected) {
        for (const file of photos[uid] || []) {
          if (file) fd.append(`photos_${uid}`, file)
        }
      }

      if (isRent) {
        // Партнёрская: бэкенд сам обрабатывает writeoff/debt по items_condition
        // и пишет PDF акта, статус сделки done.
        await rentApi.finalizeReturn(rentDealId, fd)
      } else {
        await issuancesApi.return(fd)
        // После подтверждения возврата: «Списать» → writeoffs (status=written_off,
        // виден в WriteoffsPage); «В долг» → debts (status=debt, виден в DebtsPage,
        // закрытие долга возвращает единицу на склад).
        for (const uid of selected) {
          const c = conditions[uid]
          if (c === 'writeoff') {
            await writeoffsApi.create({
              unit_id: uid,
              source: 'issue',
              source_ref: issuanceId,
              project_id: issuance?.project_id || null,
              reason: damages[uid] || null,
              kind: 'writeoff',
            }).catch(() => {})
          } else if (c === 'debt') {
            await debtsApi.create({
              user_id: issuance?.received_by,
              unit_id: uid,
              issuance_id: issuanceId,
              project_id: issuance?.project_id || null,
              reason: damages[uid] || null,
            }).catch(() => {})
          }
        }
      }

      setSuccess(true)
      // PDF акта автоматически уходит в /acts. Возвращаем юзера в раздел
      // «Выдано» — там он видит итог операции в общем списке.
      setTimeout(() => navigate('/issued'), 2000)
    } catch (err) {
      alert(err.message || 'Ошибка возврата')
    } finally {
      setLoading(false)
    }
  }

  return (
    <WarehouseLayout>
      <div style={{ padding: '24px 32px', maxWidth: 700 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 28 }}>
          <button onClick={() => step > 0 ? setStep(s => s - 1) : navigate(-1)}
            style={{ background: 'none', border: 'none', fontSize: 20, cursor: 'pointer', color: 'var(--muted)' }}>
            ←
          </button>
          <div>
            <h1 style={{ fontSize: 18, fontWeight: 600 }}>
              {isRent ? 'Возврат от партнёров' : 'Возврат имущества'}
            </h1>
            {isRent && rentDeal && <p style={{ fontSize: 13, color: 'var(--muted)' }}>{rentDeal.counterparty_name || 'Партнёр'}</p>}
            {!isRent && issuance && <p style={{ fontSize: 13, color: 'var(--muted)' }}>{issuance.receiver_name || `Выдача #${issuanceId}`}</p>}
          </div>
        </div>

        {/* Step indicator — внутри шага «Подписи» два подшага (2 → 3),
            но пользователь видит единый шаг Подписи активным в обоих случаях. */}
        {(() => {
          const visualStep = Math.min(step, 2)
          return (
            <div style={{ display: 'flex', gap: 0, marginBottom: 28 }}>
              {STEPS.map((s, i) => (
                <div key={s} style={{ flex: 1, display: 'flex', alignItems: 'center' }}>
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', flex: 1 }}>
                    <div style={{
                      width: 28, height: 28, borderRadius: '50%', display: 'flex',
                      alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 600,
                      background: i < visualStep ? 'var(--green)' : i === visualStep ? 'var(--blue)' : 'var(--border)',
                      color: i <= visualStep ? 'var(--white)' : 'var(--muted)',
                    }}>
                      {i < visualStep ? '✓' : i + 1}
                    </div>
                    <div style={{ fontSize: 11, color: i === visualStep ? 'var(--blue)' : 'var(--muted)', marginTop: 4, fontWeight: i === visualStep ? 600 : 400 }}>
                      {s}
                    </div>
                  </div>
                  {i < STEPS.length - 1 && (
                    <div style={{ height: 2, flex: 1, background: i < visualStep ? 'var(--green)' : 'var(--border)', marginBottom: 18 }} />
                  )}
                </div>
              ))}
            </div>
          )
        })()}

        {/* Step 0 — list */}
        {step === 0 && (
          <div>
            <div style={{ fontWeight: 600, marginBottom: 14 }}>Единицы на возврат</div>
            {initLoading && <div style={{ color: 'var(--muted)', fontSize: 13 }}>Загрузка...</div>}
            {units.map(u => {
              const cond = conditions[u.id]
              const isSelected = selected.has(u.id)
              const borderColor = cond === 'writeoff' ? 'var(--red)'
                : cond === 'debt' ? 'var(--amber, #d97706)'
                : isSelected ? 'var(--blue)' : 'var(--border)'
              const bgColor = cond === 'writeoff' ? 'var(--red-dim, rgba(239,68,68,0.08))'
                : cond === 'debt' ? 'rgba(217,119,6,0.08)'
                : isSelected ? 'var(--blue-dim)' : 'var(--white)'
              return (
                <div key={u.id} style={{
                  display: 'flex', alignItems: 'center', gap: 12, padding: '14px 16px',
                  borderRadius: 'var(--radius-card)',
                  border: `2px solid ${borderColor}`,
                  background: bgColor,
                  marginBottom: 10, transition: 'all 0.15s',
                }}>
                  <div onClick={() => toggleUnit(u.id)} style={{
                    width: 20, height: 20, borderRadius: 4, flexShrink: 0, cursor: 'pointer',
                    border: `2px solid ${isSelected ? 'var(--blue)' : 'var(--border)'}`,
                    background: isSelected ? 'var(--blue)' : 'transparent',
                    display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'white', fontSize: 13,
                  }}>
                    {isSelected ? '✓' : ''}
                  </div>
                  <div onClick={() => toggleUnit(u.id)} style={{ flex: 1, minWidth: 0, cursor: 'pointer' }}>
                    <div style={{ fontWeight: 500 }}>{u.name}</div>
                    {u.serial && <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>{u.serial}</div>}
                    {cond === 'writeoff' && <div style={{ fontSize: 11, color: 'var(--red)', fontWeight: 600, marginTop: 2 }}>К списанию</div>}
                    {cond === 'debt' && <div style={{ fontSize: 11, color: 'var(--amber, #d97706)', fontWeight: 600, marginTop: 2 }}>В долг</div>}
                  </div>
                  {canWriteoff && (
                    <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                      <button onClick={() => quickMark(u.id, 'writeoff')} style={{
                        padding: '6px 10px', borderRadius: 'var(--radius-btn)', fontSize: 12, fontWeight: 500,
                        border: `1.5px solid ${cond === 'writeoff' ? 'var(--red)' : 'var(--border)'}`,
                        background: cond === 'writeoff' ? 'var(--red)' : 'var(--white)',
                        color: cond === 'writeoff' ? '#fff' : 'var(--red)',
                        cursor: 'pointer', transition: 'all 0.15s',
                      }}>Списать</button>
                      <button onClick={() => quickMark(u.id, 'debt')} style={{
                        padding: '6px 10px', borderRadius: 'var(--radius-btn)', fontSize: 12, fontWeight: 500,
                        border: `1.5px solid ${cond === 'debt' ? 'var(--amber, #d97706)' : 'var(--border)'}`,
                        background: cond === 'debt' ? 'var(--amber, #d97706)' : 'var(--white)',
                        color: cond === 'debt' ? '#fff' : 'var(--amber, #d97706)',
                        cursor: 'pointer', transition: 'all 0.15s',
                      }}>В долг</button>
                    </div>
                  )}
                </div>
              )
            })}
            <Button fullWidth disabled={selected.size === 0} style={{ marginTop: 8 }}
              onClick={() => setStep(1)}>
              Далее ({selected.size} ед.)
            </Button>
          </div>
        )}

        {/* Step 1 — photos + condition */}
        {step === 1 && (
          <div>
            <div style={{ fontWeight: 600, marginBottom: 4 }}>Фото и состояние при возврате</div>
            <div style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 20 }}>Минимум 2 фото на каждую единицу</div>
            {selectedUnits.map(u => (
              <div key={u.id} style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius-card)', padding: 16, marginBottom: 20 }}>
                <div style={{ fontWeight: 600, marginBottom: 14 }}>{u.name}</div>

                {(u.photos || []).length > 0 && (
                  <div style={{ marginBottom: 12 }}>
                    <div style={{ fontSize: 12, color: 'var(--muted)', fontWeight: 500, marginBottom: 6 }}>Фото при выдаче</div>
                    <div style={{ display: 'flex', gap: 8 }}>
                      {(u.photos || []).slice(0, 3).map((p, i) => (
                        <img key={i} src={p.url || p} alt="" style={{ width: 72, height: 72, objectFit: 'contain', borderRadius: 6, border: '1px solid var(--border)' }} />
                      ))}
                    </div>
                  </div>
                )}
                <div style={{ fontSize: 12, color: 'var(--muted)', fontWeight: 500, marginBottom: 6 }}>Фото при возврате</div>
                <div style={{ marginBottom: 14 }}>
                  <MultiPhotoPicker files={Array.isArray(photos[u.id]) ? photos[u.id] : []}
                    min={2}
                    onChange={files => setPhotos(p => ({ ...p, [u.id]: files }))} />
                </div>

                <div style={{ marginBottom: 10 }}>
                  <div style={{ fontSize: 13, fontWeight: 500, marginBottom: 8 }}>Состояние</div>
                  <div style={{ display: 'flex', gap: 8 }}>
                    {CONDITIONS.map(c => (
                      <button key={c.value} onClick={() => setConditions(p => ({ ...p, [u.id]: c.value }))} style={{
                        flex: 1, height: 36, borderRadius: 'var(--radius-btn)',
                        border: `2px solid ${conditions[u.id] === c.value ? c.color : 'var(--border)'}`,
                        background: conditions[u.id] === c.value ? c.color + '15' : 'var(--white)',
                        color: conditions[u.id] === c.value ? c.color : 'var(--muted)',
                        fontSize: 13, fontWeight: 500, cursor: 'pointer', transition: 'all 0.15s',
                      }}>
                        {c.label}
                      </button>
                    ))}
                  </div>
                </div>

                {(conditions[u.id] === 'damaged' || conditions[u.id] === 'writeoff' || conditions[u.id] === 'debt') && (
                  <textarea
                    placeholder={
                      conditions[u.id] === 'writeoff' ? 'Причина списания...'
                        : conditions[u.id] === 'debt' ? 'Причина перевода в долг...'
                        : 'Опишите повреждение...'
                    }
                    value={damages[u.id] || ''}
                    onChange={e => setDamages(p => ({ ...p, [u.id]: e.target.value }))}
                    style={{
                      width: '100%', minHeight: 72, padding: '10px 12px',
                      border: '1px solid var(--red)', borderRadius: 'var(--radius-btn)',
                      fontSize: 13, resize: 'vertical', outline: 'none',
                    }}
                  />
                )}
              </div>
            ))}
            <Button fullWidth onClick={() => setStep(2)}>Далее — Подпись</Button>
          </div>
        )}

        {/* Step 2 — подпись сдающего */}
        {step === 2 && (
          <div>
            <div style={{ fontWeight: 600, marginBottom: 4 }}>Подпись сдающего</div>
            {(isRent ? rentDeal?.counterparty_name : issuance?.receiver_name) && (
              <div style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 16 }}>
                {isRent ? rentDeal.counterparty_name : issuance.receiver_name}
              </div>
            )}
            <SignatureCanvas
              onSave={data => { setReturnerSignature(data); setStep(3) }}
              onClear={() => {}}
            />
            <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 12, textAlign: 'center' }}>
              Подпись лица, возвращающего имущество
            </div>
          </div>
        )}

        {/* Step 3 — подпись принимающего (визуально остаётся на этапе «Подписи»). */}
        {step === 3 && (
          <div>
            <div style={{ fontWeight: 600, marginBottom: 4 }}>Подпись принимающего</div>
            <div style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 16 }}>Нажмите на поле чтобы поставить штамп сотрудника склада</div>
            <div
              onClick={() => setAcceptorStamped(true)}
              style={{
                width: '100%', height: 100, border: '2px dashed var(--border)',
                borderRadius: 'var(--radius-card)', display: 'flex', alignItems: 'center',
                justifyContent: 'center', cursor: 'pointer', marginBottom: 16,
                background: acceptorStamped ? 'var(--accent-dim)' : 'var(--bg)',
                borderColor: acceptorStamped ? 'var(--accent)' : 'var(--border)',
              }}
            >
              {acceptorStamped ? (
                <div style={{ textAlign: 'center' }}>
                  <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--accent)' }}>Штамп / Подпись</div>
                  <div style={{ fontSize: 12, color: 'var(--accent)', marginTop: 4 }}>{user?.name || 'Сотрудник склада'}</div>
                </div>
              ) : (
                <div style={{ color: 'var(--muted)', fontSize: 13 }}>Нажмите для подтверждения</div>
              )}
            </div>
            <Button fullWidth disabled={!acceptorStamped || loading} onClick={() => handleReturn('stamp')}>
              {loading ? 'Сохранение...' : 'Оформить возврат'}
            </Button>
          </div>
        )}
      </div>

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
            animation: 'ret-pop 0.22s ease',
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
              Возврат оформлен
            </div>
            <div style={{ fontSize: 13, color: 'var(--muted)', lineHeight: 1.5 }}>
              Акт сформирован и подписан обеими сторонами
            </div>
          </div>
          <style>{`@keyframes ret-pop{from{transform:scale(0.9);opacity:0}to{transform:scale(1);opacity:1}}`}</style>
        </div>
      )}
    </WarehouseLayout>
  )
}
