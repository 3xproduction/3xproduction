import { useEffect } from 'react'

export default function ConfirmModal({ open, title, message, confirmLabel = 'Удалить', cancelLabel = 'Отмена', onConfirm, onCancel }) {
  useEffect(() => {
    if (!open) return
    function onKey(e) { if (e.key === 'Escape') onCancel() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onCancel])

  if (!open) return null

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)',
      zIndex: 600, display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: 24, animation: 'cm-fade 0.15s ease',
    }} onClick={onCancel}>
      <style>{`@keyframes cm-fade { from { opacity: 0; } to { opacity: 1; } }`}</style>
      <div onClick={e => e.stopPropagation()} style={{
        background: 'var(--white)', borderRadius: 'var(--radius-card)',
        padding: '28px 28px 22px', maxWidth: 380, width: '100%',
        boxShadow: '0 20px 60px rgba(0,0,0,0.2)',
      }}>
        {title && <div style={{ fontWeight: 600, fontSize: 16, marginBottom: 8 }}>{title}</div>}
        {message && <div style={{ fontSize: 14, color: 'var(--muted)', lineHeight: 1.5, marginBottom: 24 }}>{message}</div>}
        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
          <button onClick={onCancel} style={{
            padding: '9px 20px', borderRadius: 'var(--radius-btn)', border: '1px solid var(--border)',
            background: 'var(--white)', color: 'var(--text)', fontSize: 14, fontWeight: 500,
            cursor: 'pointer', fontFamily: 'inherit',
          }}>{cancelLabel}</button>
          <button onClick={onConfirm} style={{
            padding: '9px 20px', borderRadius: 'var(--radius-btn)', border: 'none',
            background: 'var(--red)', color: '#fff', fontSize: 14, fontWeight: 500,
            cursor: 'pointer', fontFamily: 'inherit',
          }}>{confirmLabel}</button>
        </div>
      </div>
    </div>
  )
}
