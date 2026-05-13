// Список единиц без ячейки и без павильона. Визуал — карточки-строки
// с фото 56px, pill-бейдж «Без места» (золотой градиент, как в PickUnitList).
// Клик по карточке → открывает карточку единицы для назначения места.

import { Check, Package, ChevronRight, Search as SearchIcon } from 'lucide-react'
import { useState } from 'react'
import { categoryLabel } from '../../../constants/categories'
import { sumUnitQty } from '../../../utils/unitQty'

export default function NoPlaceList({ units, loading, onOpenCard }) {
  const [search, setSearch] = useState('')

  if (loading) {
    return (
      <div style={{ textAlign: 'center', padding: '28px 0', color: 'var(--muted)', fontSize: 13 }}>
        Загрузка…
      </div>
    )
  }
  const safe = (units || []).filter(u => u && u.id)
  if (safe.length === 0) {
    return (
      <div style={{ textAlign: 'center', padding: '24px 0', color: 'var(--muted)', fontSize: 13 }}>
        <Check size={28} color="var(--green)" strokeWidth={1.5} style={{ marginBottom: 10 }} />
        <div>Все единицы размещены</div>
      </div>
    )
  }

  const q = search.trim().toLowerCase()
  const filtered = q
    ? safe.filter(u =>
        (u.name || '').toLowerCase().includes(q)
        || (u.serial || '').toLowerCase().includes(q)
        || categoryLabel(u.category || '').toLowerCase().includes(q)
      )
    : safe

  return (
    <div className="npl-root">
      <Styles />

      <div className="npl-search">
        <SearchIcon size={15} className="npl-search-icon" />
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Найти по названию, инв. номеру…"
          className="npl-search-input"
        />
      </div>

      <div className="npl-section-title">
        Без места
        <span className="npl-section-count">{sumUnitQty(safe)}</span>
      </div>

      {filtered.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '24px 0', color: 'var(--muted)', fontSize: 13 }}>
          По запросу «{search}» ничего не найдено
        </div>
      ) : (
        <div className="npl-list">
          {filtered.map(u => (
            <button
              key={u.id}
              onClick={() => onOpenCard(u.id)}
              className="npl-row"
            >
              <div className="npl-thumb">
                {u.photo_url && !/\.(mp4|webm|mov)$/i.test(u.photo_url)
                  ? <img src={u.photo_url} alt="" />
                  : <Package size={22} color="var(--subtle)" strokeWidth={1.4} />}
              </div>
              <div className="npl-main">
                <div className="npl-name">{u.name || '—'}</div>
                <div className="npl-meta">
                  {[
                    u.category ? categoryLabel(u.category) : null,
                    u.serial || null,
                  ].filter(Boolean).join(' · ') || '—'}
                </div>
              </div>
              <div className="npl-right">
                <span className="npl-pill-free">Без места</span>
                <ChevronRight size={16} strokeWidth={1.6} className="npl-chevron" />
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function Styles() {
  return (
    <style>{`
      .npl-root { display: flex; flex-direction: column; }

      .npl-search { position: relative; margin-bottom: 12px; }
      .npl-search-icon {
        position: absolute; left: 14px; top: 50%;
        transform: translateY(-50%);
        color: var(--muted); pointer-events: none;
      }
      .npl-search-input {
        width: 100%; height: 42px;
        padding: 0 14px 0 38px;
        border: 1px solid var(--border);
        border-radius: var(--radius-btn, 10px);
        font: inherit; font-size: 14px;
        background: var(--paper);
        outline: none;
        box-sizing: border-box;
        transition: border-color 0.12s, background 0.12s;
      }
      .npl-search-input:focus {
        border-color: var(--gold-500);
        background: var(--white);
      }

      .npl-section-title {
        display: flex; align-items: center; gap: 8px;
        font-size: 11px; font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.05em;
        color: var(--muted);
        padding: 8px 4px 6px;
      }
      .npl-section-count {
        display: inline-flex; align-items: center;
        height: 18px; padding: 0 8px;
        border-radius: 999px;
        background: var(--bg-secondary);
        color: var(--text);
        font-size: 10px; font-weight: 600;
      }

      .npl-list { display: flex; flex-direction: column; gap: 6px; }

      .npl-row {
        display: flex; align-items: center; gap: 12px;
        width: 100%;
        padding: 10px 12px;
        border: 1px solid var(--gold-500);
        border-radius: 12px;
        background: linear-gradient(180deg, var(--gold-100) 0%, var(--white) 100%);
        cursor: pointer;
        font-family: inherit;
        text-align: left;
        transition: border-color 0.12s, transform 0.12s, box-shadow 0.12s;
      }
      .npl-row:hover {
        transform: translateY(-1px);
        box-shadow: 0 4px 14px rgba(201,165,92,0.14);
      }

      .npl-thumb {
        width: 56px; height: 56px; flex-shrink: 0;
        border-radius: 10px;
        background: var(--paper);
        border: 1px solid var(--border);
        display: flex; align-items: center; justify-content: center;
        overflow: hidden;
      }
      .npl-thumb img { width: 100%; height: 100%; object-fit: cover; }

      .npl-main {
        flex: 1; min-width: 0;
        display: flex; flex-direction: column; gap: 3px;
      }
      .npl-name {
        font-size: 14px; font-weight: 600;
        color: var(--text);
        line-height: 1.25;
        overflow: hidden; text-overflow: ellipsis;
        white-space: nowrap;
      }
      .npl-meta {
        font-size: 12px; color: var(--muted);
        overflow: hidden; text-overflow: ellipsis;
        white-space: nowrap;
      }

      .npl-right {
        display: flex; align-items: center; gap: 8px; flex-shrink: 0;
      }
      .npl-pill-free {
        display: inline-flex; align-items: center;
        height: 22px; padding: 0 10px;
        border-radius: 999px;
        background: var(--gold-600);
        color: #fff;
        font-size: 11px; font-weight: 600;
      }
      .npl-chevron { color: var(--gold-600); }

      @media (max-width: 768px) {
        .npl-thumb { width: 48px; height: 48px; }
        .npl-name { font-size: 13.5px; }
      }
    `}</style>
  )
}
