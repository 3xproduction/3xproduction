import { useEffect } from 'react'
import { AlertTriangle } from 'lucide-react'
import { useBodyLock } from '../../hooks/useBodyLock'

export default function ConfirmModal({
  open,
  title,
  message,
  confirmLabel = 'Удалить',
  cancelLabel = 'Отмена',
  danger = true,
  onConfirm,
  onCancel,
}) {
  useBodyLock(open)
  useEffect(() => {
    if (!open) return
    function onKey(e) { if (e.key === 'Escape') onCancel?.() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onCancel])

  if (!open) return null

  return (
    <>
      <style>{`
        @keyframes cm-fade { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: none; } }
        .cm-overlay {
          position: fixed; inset: 0;
          background: rgba(10,10,10,0.55);
          backdrop-filter: blur(3px);
          z-index: 600;
          display: flex; align-items: center; justify-content: center;
          padding: 16px;
        }
        .cm-modal {
          animation: cm-fade 0.15s ease;
          background: var(--card);
          border-radius: 14px;
          padding: 22px 24px 20px;
          max-width: 400px; width: 100%;
          box-shadow: 0 16px 48px rgba(0,0,0,0.25);
          box-sizing: border-box;
        }
        @media (max-width: 480px) {
          .cm-modal { padding: 20px 18px 18px; }
        }
        .cm-head { display: flex; align-items: center; gap: 12px; margin-bottom: 12px; }
        .cm-icon {
          width: 36px; height: 36px; border-radius: 10px;
          background: ${danger ? 'var(--red-dim)' : 'var(--gold-100)'};
          color: ${danger ? 'var(--red)' : 'var(--gold-600)'};
          display: flex; align-items: center; justify-content: center;
          flex-shrink: 0;
        }
        .cm-title { font-size: 16px; font-weight: 600; color: var(--text); letter-spacing: -0.01em; }
        .cm-msg { font-size: 13.5px; color: var(--muted); line-height: 1.5; margin-bottom: 20px; }
        .cm-actions { display: flex; gap: 8px; justify-content: flex-end; }
        .cm-btn {
          height: 36px; padding: 0 16px;
          border-radius: 10px;
          font-size: 13px; font-weight: 500;
          font-family: inherit;
          cursor: pointer;
          border: 1px solid transparent;
          transition: background 0.12s, border-color 0.12s;
        }
        .cm-btn-cancel {
          background: transparent;
          color: var(--text);
          border-color: var(--border-strong);
        }
        .cm-btn-cancel:hover { background: var(--bg-secondary); border-color: var(--ink-500); }
        .cm-btn-confirm {
          background: ${danger ? 'var(--red)' : 'var(--ink-950)'};
          color: #fff;
          border-color: ${danger ? 'var(--red)' : 'var(--ink-950)'};
        }
        .cm-btn-confirm:hover {
          background: ${danger ? 'var(--red-hover)' : 'var(--ink-800)'};
        }
      `}</style>
      <div className="cm-overlay" onClick={onCancel}>
        <div className="cm-modal" onClick={e => e.stopPropagation()}>
          <div className="cm-head">
            {danger && (
              <div className="cm-icon">
                <AlertTriangle size={18} strokeWidth={1.8} />
              </div>
            )}
            {title && <div className="cm-title">{title}</div>}
          </div>
          {message && <div className="cm-msg">{message}</div>}
          <div className="cm-actions">
            <button className="cm-btn cm-btn-cancel" onClick={onCancel}>{cancelLabel}</button>
            <button className="cm-btn cm-btn-confirm" onClick={onConfirm}>{confirmLabel}</button>
          </div>
        </div>
      </div>
    </>
  )
}
