import { useState, useCallback, createContext, useContext } from 'react'
import { Check, X, AlertTriangle, Info } from 'lucide-react'

const ToastContext = createContext(null)

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([])

  const addToast = useCallback((message, type = 'success', duration = 3000) => {
    const id = Date.now() + Math.random()
    setToasts(prev => [...prev, { id, message, type }])
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), duration)
  }, [])

  return (
    <ToastContext.Provider value={addToast}>
      {children}
      <style>{css}</style>
      <div className="toast-stack">
        {toasts.map(t => (
          <div key={t.id} className={`toast toast-${t.type}`}>
            <span className="toast-ico">
              {t.type === 'success' && <Check size={14} strokeWidth={2.4} />}
              {t.type === 'error'   && <X size={14} strokeWidth={2.4} />}
              {t.type === 'warning' && <AlertTriangle size={14} strokeWidth={2} />}
              {t.type !== 'success' && t.type !== 'error' && t.type !== 'warning' && <Info size={14} strokeWidth={2} />}
            </span>
            <span className="toast-msg">{t.message}</span>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  )
}

export function useToast() {
  return useContext(ToastContext)
}

const css = `
@keyframes toast-in {
  from { opacity: 0; transform: translateY(-8px); }
  to   { opacity: 1; transform: none; }
}
.toast-stack {
  position: fixed; top: 76px; right: 20px; z-index: 9999;
  display: flex; flex-direction: column; gap: 8px;
  pointer-events: none;
}
.toast {
  display: inline-flex; align-items: center; gap: 10px;
  padding: 10px 14px 10px 12px;
  border-radius: 10px;
  font-size: 13px; font-weight: 500;
  background: var(--ink-950);
  color: #fff;
  border: 1px solid rgba(255,255,255,0.08);
  box-shadow: 0 8px 28px rgba(0,0,0,0.25);
  animation: toast-in 0.22s ease-out;
  max-width: 380px;
  pointer-events: auto;
  letter-spacing: -0.005em;
}
.toast-ico {
  width: 22px; height: 22px; border-radius: 6px;
  display: inline-flex; align-items: center; justify-content: center;
  flex-shrink: 0;
}
.toast-success .toast-ico { background: rgba(92,107,63,0.3);  color: #b8c99c; }
.toast-error   .toast-ico { background: rgba(180,35,24,0.3);  color: #f5baab; }
.toast-warning .toast-ico { background: rgba(184,147,90,0.3); color: var(--gold-400); }
.toast-msg { line-height: 1.4; }

@media (max-width: 768px) {
  .toast-stack { top: auto; bottom: 92px; right: 16px; left: 16px; align-items: stretch; }
  .toast { max-width: none; }
}
`
