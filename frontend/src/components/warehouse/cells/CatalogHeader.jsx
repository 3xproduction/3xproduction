// Sticky header для 3-уровневого каталога склада. Apple-style:
// back-стрелка с лейблом предыдущего уровня слева, крупный title +
// счётчик/подзаголовок, опциональные действия справа. На мобилке лейбл
// у back-стрелки скрывается, остаётся только chevron.
//
// Также хранит @keyframes slide-in — любая страница каталога может
// добавить класс `catalog-enter` на свой корневой элемент, чтобы получить
// входную анимацию (180ms translateX+fade).

import { ChevronLeft } from 'lucide-react'
import { useNavigate } from 'react-router-dom'

export default function CatalogHeader({
  title,
  subtitle,
  backTo,        // строка URL или () => navigate(...)
  backLabel,
  right,         // React-нода с кнопками действий
  children,      // опциональный блок под заголовком (chips, edit-toolbar и т.п.)
}) {
  const navigate = useNavigate()
  const onBack = () => {
    if (!backTo) return
    if (typeof backTo === 'function') backTo()
    else navigate(backTo)
  }

  return (
    <>
      <style>{`
        .catalog-header {
          position: sticky; top: 0; z-index: 15;
          background: rgba(255,255,255,0.85);
          backdrop-filter: saturate(180%) blur(18px);
          -webkit-backdrop-filter: saturate(180%) blur(18px);
          border-bottom: 1px solid var(--border);
          padding: 14px 24px 14px;
        }
        .catalog-header-row {
          display: flex; align-items: center; gap: 12px; min-height: 38px;
        }
        .catalog-back {
          display: inline-flex; align-items: center; gap: 4px;
          background: none; border: none;
          color: var(--gold-600);
          font: inherit; font-size: 14px; font-weight: 500;
          cursor: pointer;
          padding: 6px 10px 6px 4px;
          border-radius: 8px;
          transition: background 0.12s;
          white-space: nowrap;
        }
        .catalog-back:hover { background: var(--gold-100); }
        .catalog-back-label {
          overflow: hidden; text-overflow: ellipsis;
          max-width: 180px;
        }
        .catalog-titles { flex: 1; min-width: 0; }
        .catalog-title {
          font-size: 22px; font-weight: 700; letter-spacing: -0.01em;
          color: var(--text);
          overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
          line-height: 1.15;
        }
        .catalog-subtitle {
          font-size: 12px; color: var(--muted); margin-top: 2px;
          overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
        }
        .catalog-right { display: flex; gap: 8px; align-items: center; flex-shrink: 0; }

        .catalog-children { margin-top: 10px; }

        @media (max-width: 768px) {
          .catalog-header { padding: 10px 14px; }
          .catalog-title  { font-size: 18px; }
          .catalog-back-label { display: none; }
          .catalog-back { padding: 6px 4px; }
        }

        @keyframes catalog-slide-in {
          from { opacity: 0; transform: translateX(18px); }
          to   { opacity: 1; transform: translateX(0); }
        }
        .catalog-enter {
          animation: catalog-slide-in 0.22s cubic-bezier(0.2, 0.8, 0.2, 1);
        }
      `}</style>

      <div className="catalog-header">
        <div className="catalog-header-row">
          {backTo && (
            <button className="catalog-back" onClick={onBack} aria-label="Назад">
              <ChevronLeft size={18} strokeWidth={2.2} />
              {backLabel && <span className="catalog-back-label">{backLabel}</span>}
            </button>
          )}
          <div className="catalog-titles">
            <div className="catalog-title">{title}</div>
            {subtitle && <div className="catalog-subtitle">{subtitle}</div>}
          </div>
          {right && <div className="catalog-right">{right}</div>}
        </div>
        {children && <div className="catalog-children">{children}</div>}
      </div>
    </>
  )
}
