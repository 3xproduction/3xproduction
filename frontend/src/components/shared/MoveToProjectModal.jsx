import { useEffect, useState } from 'react'
import { Boxes, Loader2 } from 'lucide-react'
import { useBodyLock } from '../../hooks/useBodyLock'
import { projectUnits as projectUnitsApi } from '../../services/api'

// Модалка batch-перемещения единиц на склад выбранного проекта.
// Используется в каталоге склада (UnitsPage) при выборе нескольких единиц.
// При успехе вызывает onSuccess({ moved_count, errors, project }).
export default function MoveToProjectModal({ open, count, unitIds, onCancel, onSuccess }) {
  useBodyLock(open)

  const [projects, setProjects] = useState([])
  const [loadingProjects, setLoadingProjects] = useState(false)
  const [projectId, setProjectId] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!open) return
    setError('')
    setProjectId('')
    setLoadingProjects(true)
    projectUnitsApi.allProjects()
      .then(d => setProjects(d.projects || []))
      .catch(err => setError(err.message || 'Не удалось загрузить список проектов'))
      .finally(() => setLoadingProjects(false))
  }, [open])

  useEffect(() => {
    if (!open) return
    function onKey(e) { if (e.key === 'Escape' && !submitting) onCancel?.() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, submitting, onCancel])

  if (!open) return null

  async function handleSubmit() {
    if (!projectId || submitting) return
    setSubmitting(true)
    setError('')
    try {
      const res = await projectUnitsApi.moveToProject([...unitIds], projectId)
      onSuccess?.(res)
    } catch (err) {
      setError(err.message || 'Не удалось переместить')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <>
      <style>{`
        @keyframes mtp-fade { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: none; } }
        .mtp-overlay { position: fixed; inset: 0; background: rgba(10,10,10,0.55); backdrop-filter: blur(3px);
          z-index: 600; display: flex; align-items: center; justify-content: center; padding: 16px; }
        .mtp-modal { animation: mtp-fade 0.15s ease; background: var(--card); border-radius: 14px;
          padding: 22px 24px 20px; max-width: 440px; width: 100%; box-shadow: 0 16px 48px rgba(0,0,0,0.25); box-sizing: border-box; }
        @media (max-width: 480px) { .mtp-modal { padding: 20px 18px 18px; } }
        .mtp-head { display: flex; align-items: center; gap: 12px; margin-bottom: 14px; }
        .mtp-icon { width: 36px; height: 36px; border-radius: 10px; background: var(--gold-100);
          color: var(--gold-600); display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
        .mtp-title { font-size: 16px; font-weight: 600; color: var(--text); letter-spacing: -0.01em; }
        .mtp-sub { font-size: 13px; color: var(--muted); margin-bottom: 14px; line-height: 1.5; }
        .mtp-label { font-size: 12px; font-weight: 500; color: var(--muted); margin-bottom: 6px; display: block; }
        .mtp-select { width: 100%; height: 38px; padding: 0 10px; border: 1px solid var(--border);
          border-radius: var(--radius-btn); font-size: 13px; background: var(--white); margin-bottom: 14px; }
        .mtp-error { font-size: 13px; color: var(--red); margin-bottom: 12px; line-height: 1.4; }
        .mtp-actions { display: flex; gap: 8px; justify-content: flex-end; }
        .mtp-btn { height: 36px; padding: 0 16px; border-radius: 10px; font-size: 13px; font-weight: 500;
          font-family: inherit; cursor: pointer; border: 1px solid transparent; transition: background 0.12s, border-color 0.12s;
          display: inline-flex; align-items: center; gap: 6px; }
        .mtp-btn:disabled { opacity: 0.5; cursor: not-allowed; }
        .mtp-btn-cancel { background: transparent; color: var(--text); border-color: var(--border-strong); }
        .mtp-btn-cancel:hover { background: var(--bg-secondary); border-color: var(--ink-500); }
        .mtp-btn-primary { background: var(--ink-950); color: #fff; border-color: var(--ink-950); }
        .mtp-btn-primary:hover:not(:disabled) { background: var(--ink-800); }
      `}</style>
      <div className="mtp-overlay" onClick={() => !submitting && onCancel?.()}>
        <div className="mtp-modal" onClick={e => e.stopPropagation()}>
          <div className="mtp-head">
            <div className="mtp-icon"><Boxes size={18} strokeWidth={1.8} /></div>
            <div className="mtp-title">Переместить на склад проекта</div>
          </div>
          <div className="mtp-sub">
            Выбрано {count} ед. — будут перемещены с центрального склада на склад указанного проекта.
            Единицы со статусом «Выдано», «В долге» или «Списано» пропускаются.
          </div>

          <label className="mtp-label">Проект *</label>
          <select className="mtp-select" value={projectId} disabled={loadingProjects || submitting}
                  onChange={e => setProjectId(e.target.value)}>
            <option value="">{loadingProjects ? 'Загрузка проектов…' : '— выбрать проект —'}</option>
            {projects.map(p => (
              <option key={p.id} value={p.id}>
                {p.name} ({p.available_count} ед.)
              </option>
            ))}
          </select>

          {error && <div className="mtp-error">{error}</div>}

          <div className="mtp-actions">
            <button className="mtp-btn mtp-btn-cancel" onClick={onCancel} disabled={submitting}>Отмена</button>
            <button className="mtp-btn mtp-btn-primary" onClick={handleSubmit} disabled={!projectId || submitting}>
              {submitting && <Loader2 size={14} className="mtp-spin" style={{ animation: 'mtp-spin 0.9s linear infinite' }} />}
              {submitting ? 'Перемещение…' : 'Переместить'}
            </button>
          </div>
        </div>
      </div>
      <style>{`@keyframes mtp-spin { to { transform: rotate(360deg); } }`}</style>
    </>
  )
}
