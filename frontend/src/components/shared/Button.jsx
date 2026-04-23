import { Loader2 } from 'lucide-react'

// Унифицированная кнопка для всего приложения.
// Стиль — под бренд Триикс Медиа: Inter, тонкие линии, золото как primary,
// тёмная обводка у secondary, бургунди для danger (без ярко-красного).

const styles = `
.btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  height: 34px;
  padding: 0 14px;
  border-radius: var(--radius-btn);
  font-weight: 450;
  font-size: 13px;
  font-family: inherit;
  border: 1px solid transparent;
  cursor: pointer;
  transition: background 0.15s, color 0.15s, border-color 0.15s, opacity 0.15s, transform 0.08s;
  white-space: nowrap;
  letter-spacing: -0.005em;
}
.btn > svg { flex-shrink: 0; stroke-width: 1.8 !important; }
.btn:active:not(:disabled) { transform: scale(0.98); }
.btn:disabled { cursor: not-allowed; opacity: 0.5; }

/* Primary — чёрный фон */
.btn-primary {
  background: var(--ink-950);
  color: #fff;
  border-color: var(--ink-950);
}
.btn-primary:hover:not(:disabled) {
  background: var(--ink-800);
  border-color: var(--ink-800);
}

/* Secondary — прозрачный, тонкая рамка */
.btn-secondary {
  background: transparent;
  color: var(--text);
  border-color: var(--border-strong);
}
.btn-secondary:hover:not(:disabled) {
  background: var(--bg-secondary);
  border-color: var(--ink-500);
}

/* Accent — золото (для редких CTA на светлом) */
.btn-accent {
  background: var(--gold-500);
  color: var(--ink-950);
  border-color: var(--gold-500);
}
.btn-accent:hover:not(:disabled) {
  background: var(--gold-400);
  border-color: var(--gold-400);
}

/* Danger — приглушённый бургунди */
.btn-danger {
  background: var(--red);
  color: #fff;
  border-color: var(--red);
}
.btn-danger:hover:not(:disabled) {
  background: var(--red-hover);
  border-color: var(--red-hover);
}

/* Ghost — прозрачный с золотым текстом */
.btn-ghost {
  background: transparent;
  color: var(--gold-600);
  border-color: transparent;
}
.btn-ghost:hover:not(:disabled) {
  background: var(--gold-100);
  color: var(--gold-600);
}

.btn-full { width: 100%; }

/* Размеры */
.btn-sm { height: 28px; padding: 0 10px; font-size: 12px; gap: 5px; }
.btn-lg { height: 42px; padding: 0 20px; font-size: 14px; }

/* Icon-only (квадратная) */
.btn-icon { padding: 0; width: 34px; }
.btn-sm.btn-icon { width: 28px; }
.btn-lg.btn-icon { width: 42px; }

@keyframes spin { to { transform: rotate(360deg); } }
.btn-spinner { animation: spin 0.7s linear infinite; }
`

export default function Button({
  children,
  variant = 'primary',
  size,
  loading,
  fullWidth,
  iconOnly,
  className = '',
  ...props
}) {
  const cls = [
    'btn',
    `btn-${variant}`,
    size && `btn-${size}`,
    fullWidth && 'btn-full',
    iconOnly && 'btn-icon',
    className,
  ].filter(Boolean).join(' ')

  return (
    <>
      <style>{styles}</style>
      <button
        {...props}
        disabled={props.disabled || loading}
        className={cls}
        style={props.style}
      >
        {loading ? <Loader2 size={15} className="btn-spinner" /> : children}
      </button>
    </>
  )
}
