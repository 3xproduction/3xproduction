import { useState } from 'react'
import { useNavigate } from 'react-router-dom'

const BASE = import.meta.env.VITE_API_URL || (['5173', '4173'].includes(location.port) ? `${location.protocol}//${location.hostname}:3000` : '')

const ROLE_LABELS = {
  warehouse_director:  'Директор склада',
  project_director:    'Директор площадки',
  producer:            'Продюсер',
  warehouse_deputy:    'Зам директора склада',
  warehouse_staff:     'Сотрудник склада',
  production_designer: 'Художник-постановщик',
  props_master:        'Реквизитор',
  costumer:            'Костюмер',
}

export default function SeedPage() {
  const navigate = useNavigate()
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState(null)
  const [error, setError] = useState('')
  const [copied, setCopied] = useState(null)

  async function handleSeed() {
    setLoading(true)
    setError('')
    try {
      const res = await fetch(`${BASE}/auth/seed-test`, { method: 'POST' })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      setResult(data)
    } catch (err) {
      setError(err.message || 'Ошибка')
    } finally {
      setLoading(false)
    }
  }

  function copyAll() {
    if (!result) return
    const lines = result.users.map(u =>
      `${ROLE_LABELS[u.role] || u.role}\n  Email: ${u.email}\n  Пароль: ${result.password}`
    ).join('\n\n')
    navigator.clipboard.writeText(lines)
    setCopied('all')
    setTimeout(() => setCopied(null), 2000)
  }

  return (
    <div style={{
      minHeight: '100vh', background: 'var(--bg)',
      display: 'flex', alignItems: 'flex-start', justifyContent: 'center',
      padding: '40px 16px', fontFamily: 'Inter, sans-serif',
    }}>
      <div style={{ maxWidth: 560, width: '100%' }}>
        <div style={{ marginBottom: 24 }}>
          <button onClick={() => navigate(-1)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--muted)', fontSize: 13 }}>← Назад</button>
        </div>

        <div style={{ background: 'var(--white)', borderRadius: 'var(--radius-card)', border: '1px solid var(--border)', padding: 28 }}>
          <div style={{ fontWeight: 700, fontSize: 18, marginBottom: 4 }}>
            <span style={{ color: 'var(--accent)' }}>Dev</span> · Тестовые аккаунты
          </div>
          <div style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 24 }}>
            Создаёт 7 тестовых аккаунтов с паролем <strong>Test1234</strong>. Идемпотентно — повторный запуск безопасен.
          </div>

          {!result && (
            <button
              onClick={handleSeed}
              disabled={loading}
              style={{
                width: '100%', padding: '12px', borderRadius: 'var(--radius-btn)',
                background: loading ? 'var(--bg)' : 'var(--accent)', border: 'none',
                color: loading ? 'var(--muted)' : '#fff', fontWeight: 600,
                fontSize: 14, cursor: loading ? 'default' : 'pointer',
              }}
            >
              {loading ? 'Создаю аккаунты...' : 'Создать тестовые аккаунты'}
            </button>
          )}

          {error && (
            <div style={{ color: 'var(--red)', fontSize: 13, marginTop: 12 }}>{error}</div>
          )}

          {result && (
            <>
              <div style={{
                background: 'var(--green-dim)', border: '1px solid rgba(22,163,74,0.2)',
                borderRadius: 8, padding: '10px 14px', fontSize: 13, marginBottom: 20,
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              }}>
                <span>✓ Готово · пароль для всех: <strong>{result.password}</strong></span>
                <button onClick={copyAll} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 12, color: 'var(--green)', fontWeight: 600 }}>
                  {copied === 'all' ? '✓ Скопировано' : 'Копировать всё'}
                </button>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {result.users.map(u => (
                  <div key={u.email} style={{
                    background: u.status === 'already_exists' ? 'var(--bg)' : 'var(--white)',
                    border: '1px solid var(--border)', borderRadius: 10, padding: '12px 14px',
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  }}>
                    <div>
                      <div style={{ fontWeight: 600, fontSize: 13 }}>{ROLE_LABELS[u.role] || u.role}</div>
                      <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>{u.email}</div>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      {u.status === 'already_exists' && (
                        <span style={{ fontSize: 11, color: 'var(--muted)' }}>уже существует</span>
                      )}
                      {u.status === 'created' && (
                        <span style={{ fontSize: 11, color: 'var(--green)', fontWeight: 500 }}>создан</span>
                      )}
                      <button
                        onClick={() => {
                          navigator.clipboard.writeText(u.email)
                          setCopied(u.email)
                          setTimeout(() => setCopied(null), 1500)
                        }}
                        style={{ background: 'none', border: '1px solid var(--border)', borderRadius: 6, padding: '3px 8px', fontSize: 11, cursor: 'pointer', color: 'var(--muted)' }}
                      >
                        {copied === u.email ? '✓' : 'email'}
                      </button>
                    </div>
                  </div>
                ))}
              </div>

              <div style={{ marginTop: 20, padding: '12px 14px', background: 'var(--bg)', borderRadius: 8, fontSize: 12, color: 'var(--muted)' }}>
                Тестовый проект ID: <code style={{ fontSize: 11 }}>{result.project_id}</code>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
