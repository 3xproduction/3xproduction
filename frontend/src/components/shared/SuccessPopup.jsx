// Унифицированный popup «Успешно». Паттерн из PublicWarehousePage —
// золотой круг с галочкой + заголовок + подсказка. Автоскрытие по таймеру.
//
// Использование:
//   const [ok, setOk] = useState(null)                // { title, hint? } | null
//   <SuccessPopup data={ok} onDone={() => setOk(null)} />

import { useEffect } from 'react'
import { CheckCircle } from 'lucide-react'
import { useBodyLock } from '../../hooks/useBodyLock'

export default function SuccessPopup({ data, onDone, durationMs = 1500 }) {
  useBodyLock(!!data)
  useEffect(() => {
    if (!data) return
    const t = setTimeout(() => onDone?.(), durationMs)
    return () => clearTimeout(t)
  }, [data, onDone, durationMs])

  if (!data) return null

  return (
    <>
      <style>{`@keyframes sp-pop{from{transform:scale(0.9);opacity:0}to{transform:scale(1);opacity:1}}`}</style>
      <div style={{
        position: 'fixed', inset: 0,
        background: 'rgba(10,10,10,0.45)',
        backdropFilter: 'blur(3px)', WebkitBackdropFilter: 'blur(3px)',
        zIndex: 900, display: 'flex',
        alignItems: 'center', justifyContent: 'center',
        padding: 20,
      }}>
        <div style={{
          background: 'var(--white)', borderRadius: 16,
          padding: '36px 32px 28px', maxWidth: 360,
          minWidth: 260,
          textAlign: 'center',
          border: '1px solid var(--border)',
          boxShadow: '0 24px 60px rgba(0,0,0,0.22), 0 2px 8px rgba(0,0,0,0.08)',
          animation: 'sp-pop 0.25s cubic-bezier(0.2, 0.8, 0.2, 1)',
        }}>
          <div style={{
            width: 62, height: 62, borderRadius: '50%',
            background: 'var(--gold-100)',
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            marginBottom: 18,
            boxShadow: '0 0 0 6px rgba(184,147,90,0.12)',
          }}>
            <CheckCircle size={30} style={{ color: 'var(--gold-600)' }} strokeWidth={1.8} />
          </div>
          <div style={{
            fontSize: 18, fontWeight: 600,
            marginBottom: data.hint ? 8 : 0,
            letterSpacing: '-0.01em',
            color: 'var(--text)',
          }}>
            {data.title}
          </div>
          {data.hint && (
            <div style={{ fontSize: 13, color: 'var(--muted)', lineHeight: 1.5 }}>
              {data.hint}
            </div>
          )}
        </div>
      </div>
    </>
  )
}
