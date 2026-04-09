import { useState, useEffect } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import WarehouseLayout from '../warehouse/WarehouseLayout'
import Button from '../shared/Button'
import PhotoUpload from '../shared/PhotoUpload'
import SignatureCanvas from '../shared/SignatureCanvas'
import { issuances as issuancesApi, units as unitsApi } from '../../services/api'
import { useAuth } from '../../hooks/useAuth'

const CONDITIONS = [
  { value: 'excellent', label: 'Отлично',   color: 'var(--green)' },
  { value: 'good',      label: 'Хорошее',   color: 'var(--blue)' },
  { value: 'damaged',   label: 'Повреждено', color: 'var(--red)' },
]

const STEPS = ['Список', 'Фото и состояние', 'Подпись сдающего', 'Подпись принимающего']

export default function ReturnPage() {
  const navigate = useNavigate()
  const { id: issuanceId } = useParams()
  const { user } = useAuth()
  const [step, setStep] = useState(0)
  const [issuance, setIssuance] = useState(null)
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
  }, [issuanceId])

  function toggleUnit(id) {
    setSelected(s => {
      const next = new Set(s)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

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
      fd.append('issuance_id', issuanceId)
      fd.append('items_condition', JSON.stringify(condMap))
      fd.append('signature_data', returnerSignature || '')
      fd.append('acceptor_signature_data', signatureData)
      // merge all damage notes
      const allNotes = Object.entries(damages)
        .filter(([, v]) => v)
        .map(([id, v]) => `#${id}: ${v}`)
        .join('; ')
      if (allNotes) fd.append('condition_notes', allNotes)

      for (const uid of selected) {
        for (const file of photos[uid] || []) {
          if (file) fd.append('photos', file)
        }
      }

      await issuancesApi.return(fd)
      setSuccess(true)
      setTimeout(() => navigate('/dashboard'), 2000)
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
            <h1 style={{ fontSize: 18, fontWeight: 600 }}>Возврат имущества</h1>
            {issuance && <p style={{ fontSize: 13, color: 'var(--muted)' }}>{issuance.receiver_name || `Выдача #${issuanceId}`}</p>}
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
                  color: i <= step ? 'var(--white)' : 'var(--muted)',
                }}>
                  {i < step ? '✓' : i + 1}
                </div>
                <div style={{ fontSize: 11, color: i === step ? 'var(--blue)' : 'var(--muted)', marginTop: 4, fontWeight: i === step ? 600 : 400 }}>
                  {s}
                </div>
              </div>
              {i < STEPS.length - 1 && (
                <div style={{ height: 2, flex: 1, background: i < step ? 'var(--green)' : 'var(--border)', marginBottom: 18 }} />
              )}
            </div>
          ))}
        </div>

        {/* Step 0 — list */}
        {step === 0 && (
          <div>
            <div style={{ fontWeight: 600, marginBottom: 14 }}>Единицы на возврат</div>
            {initLoading && <div style={{ color: 'var(--muted)', fontSize: 13 }}>Загрузка...</div>}
            {units.map(u => (
              <div key={u.id} onClick={() => toggleUnit(u.id)} style={{
                display: 'flex', alignItems: 'center', gap: 12, padding: '14px 16px',
                borderRadius: 'var(--radius-card)',
                border: `2px solid ${selected.has(u.id) ? 'var(--blue)' : 'var(--border)'}`,
                background: selected.has(u.id) ? 'var(--blue-dim)' : 'var(--white)',
                marginBottom: 10, cursor: 'pointer', transition: 'all 0.15s',
              }}>
                <div style={{
                  width: 20, height: 20, borderRadius: 4, flexShrink: 0,
                  border: `2px solid ${selected.has(u.id) ? 'var(--blue)' : 'var(--border)'}`,
                  background: selected.has(u.id) ? 'var(--blue)' : 'transparent',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'white', fontSize: 13,
                }}>
                  {selected.has(u.id) ? '✓' : ''}
                </div>
                <div>
                  <div style={{ fontWeight: 500 }}>{u.name}</div>
                  {u.serial && <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>{u.serial}</div>}
                </div>
              </div>
            ))}
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
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10, marginBottom: 14 }}>
                  {[0, 1, 2].map(i => (
                    <PhotoUpload key={i} label={`Фото ${i + 1}`} onChange={f => setPhoto(u.id, i, f)} />
                  ))}
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

                {conditions[u.id] === 'damaged' && (
                  <textarea
                    placeholder="Опишите повреждение..."
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

        {/* Step 2 — returner signature */}
        {step === 2 && (
          <div>
            <div style={{ fontWeight: 600, marginBottom: 4 }}>Подпись сдающего</div>
            {issuance?.receiver_name && <div style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 16 }}>{issuance.receiver_name}</div>}
            <SignatureCanvas
              onSave={data => { setReturnerSignature(data); setStep(3) }}
              onClear={() => {}}
            />
            <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 12, textAlign: 'center' }}>
              Подпись лица, возвращающего имущество
            </div>
          </div>
        )}

        {/* Step 3 — acceptor stamp */}
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
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 500,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <div style={{
            background: 'var(--white)', borderRadius: 16, padding: '32px 40px',
            textAlign: 'center', boxShadow: '0 8px 32px rgba(0,0,0,0.15)',
          }}>
            <div style={{ fontSize: 40, marginBottom: 12 }}>✅</div>
            <div style={{ fontWeight: 600, fontSize: 18, marginBottom: 6, color: 'var(--green)' }}>Успешно</div>
            <div style={{ fontSize: 13, color: 'var(--muted)' }}>Акт возврата сформирован, подписан обеими сторонами</div>
          </div>
        </div>
      )}
    </WarehouseLayout>
  )
}
