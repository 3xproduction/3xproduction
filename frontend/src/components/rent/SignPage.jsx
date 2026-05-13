import { useState, useEffect } from 'react'
import { useParams } from 'react-router-dom'
import SignatureCanvas from '../shared/SignatureCanvas'

const BASE = import.meta.env.VITE_API_URL || (['5173', '4173'].includes(location.port) ? `${location.protocol}//${location.hostname}:3000` : '')

export default function SignPage() {
  const { token } = useParams()
  const [deal, setDeal] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [signing, setSigning] = useState(false)
  const [done, setDone] = useState(false)

  useEffect(() => {
    fetch(`${BASE}/rent/sign/${token}`)
      .then(r => r.json())
      .then(data => {
        if (data.error) throw new Error(data.error)
        setDeal(data.deal)
        if (data.deal.sign_status === 'signed') setDone(true)
      })
      .catch(err => setError(err.message || 'Ошибка загрузки'))
      .finally(() => setLoading(false))
  }, [token])

  async function handleSign(signatureData) {
    setSigning(true)
    try {
      const res = await fetch(`${BASE}/rent/sign/${token}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ signature_data: signatureData }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      setDone(true)
    } catch (err) {
      alert(err.message || 'Ошибка подписания')
    } finally {
      setSigning(false)
    }
  }

  return (
    <div style={{
      minHeight: '100vh', background: 'var(--bg)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: '24px 16px', fontFamily: 'Inter, sans-serif',
    }}>
      <div style={{ maxWidth: 520, width: '100%' }}>
        {/* Logo */}
        <div style={{ textAlign: 'center', marginBottom: 28 }}>
          <div style={{ fontSize: 20, fontWeight: 600, letterSpacing: '-0.02em' }}>
            <span style={{ color: 'var(--accent)' }}>3X</span>Media Production
          </div>
        </div>

        <div style={{
          background: 'var(--white)', borderRadius: 'var(--radius-card)',
          border: '1px solid var(--border)', padding: '28px',
          boxShadow: '0 4px 24px rgba(0,0,0,0.06)',
        }}>
          {loading && (
            <div style={{ textAlign: 'center', color: 'var(--muted)', padding: '40px 0', fontSize: 14 }}>
              Загрузка...
            </div>
          )}

          {error && (
            <div style={{ textAlign: 'center', padding: '40px 0' }}>
              <div style={{ fontSize: 32, marginBottom: 12 }}>⚠️</div>
              <div style={{ color: 'var(--red)', fontSize: 15, fontWeight: 500 }}>Ссылка недействительна</div>
              <div style={{ color: 'var(--muted)', fontSize: 13, marginTop: 6 }}>{error}</div>
            </div>
          )}

          {done && (
            <div style={{ textAlign: 'center', padding: '40px 0' }}>
              <div style={{ fontSize: 48, marginBottom: 16 }}>✅</div>
              <div style={{ fontSize: 18, fontWeight: 600, marginBottom: 8, color: 'var(--green)' }}>Подписано успешно</div>
              <div style={{ color: 'var(--muted)', fontSize: 13 }}>Спасибо! Документы направлены организатору аренды.</div>
            </div>
          )}

          {deal && !done && (
            <>
              <div style={{ marginBottom: 24 }}>
                <div style={{ fontSize: 17, fontWeight: 600, marginBottom: 4 }}>Договор аренды</div>
                <div style={{ fontSize: 13, color: 'var(--muted)' }}>Ознакомьтесь и подпишите</div>
              </div>

              {/* Deal info */}
              <div style={{
                background: 'var(--bg)', borderRadius: 10,
                padding: '16px', marginBottom: 20, fontSize: 13,
              }}>
                <Row label="Арендатор" value={deal.counterparty_name} />
                <Row label="Период" value={`${fmt(deal.period_start)} — ${fmt(deal.period_end)}`} />
                {deal.price_total && (
                  <Row label="Сумма" value={`${Number(deal.price_total).toLocaleString('ru-RU')} ₽`} />
                )}
                {deal.unit_names?.length > 0 && (
                  <Row label="Имущество" value={deal.unit_names.join(', ')} last />
                )}
              </div>

              {deal.contract_pdf_url && (
                <a href={deal.contract_pdf_url} target="_blank" rel="noreferrer"
                  style={{ display: 'block', textAlign: 'center', fontSize: 13, color: 'var(--blue)', marginBottom: 20 }}>
                  📄 Скачать PDF договора
                </a>
              )}

              <div style={{ fontWeight: 500, fontSize: 14, marginBottom: 10 }}>Ваша подпись</div>
              {signing && (
                <div style={{ textAlign: 'center', color: 'var(--muted)', fontSize: 13, padding: '8px 0' }}>
                  Сохранение подписи...
                </div>
              )}
              {!signing && <SignatureCanvas onSave={handleSign} />}
            </>
          )}
        </div>
      </div>
    </div>
  )
}

function fmt(d) {
  if (!d) return '—'
  return new Date(d).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', year: 'numeric' })
}

function Row({ label, value, last }) {
  return (
    <div style={{
      display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12,
      paddingBottom: last ? 0 : 10, marginBottom: last ? 0 : 10,
      borderBottom: last ? 'none' : '1px solid var(--border)',
    }}>
      <span style={{ color: 'var(--muted)', flexShrink: 0 }}>{label}</span>
      <span style={{ fontWeight: 500, textAlign: 'right' }}>{value}</span>
    </div>
  )
}
