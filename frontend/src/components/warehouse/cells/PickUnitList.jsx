// Список on_stock-единиц для размещения в свободной ячейке.
// Свободные («без места») показываются сверху, дальше — по алфавиту.
// Клиентский поиск по имени/инв.номеру/категории.
//
// Визуал: карточка-строка с фото 56px, именем и меташкой, chevron-стрелкой
// справа. «Без места» выделяется золотым пэджем.

import { useEffect, useState } from 'react'
import { Package, Search as SearchIcon, ChevronRight } from 'lucide-react'
import { units as unitsApi } from '../../../services/api'
import { categoryLabel } from '../../../constants/categories'
import { sumUnitQty } from '../../../utils/unitQty'

export default function PickUnitList({ onPicked }) {
  const [units, setUnits] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [assigning, setAssigning] = useState(null)

  useEffect(() => {
    setLoading(true)
    unitsApi.list({ status: 'on_stock' })
      .then(d => {
        const all = (d.units || []).filter(u => u?.id)
        all.sort((a, b) => {
          const aFree = !a.cell_id && !a.pavilion_id ? 0 : 1
          const bFree = !b.cell_id && !b.pavilion_id ? 0 : 1
          if (aFree !== bFree) return aFree - bFree
          return (a.name || '').localeCompare(b.name || '')
        })
        setUnits(all)
      })
      .catch(() => setUnits([]))
      .finally(() => setLoading(false))
  }, [])

  const q = search.trim().toLowerCase()
  const filtered = q
    ? units.filter(u =>
        (u.name || '').toLowerCase().includes(q)
        || (u.serial || '').toLowerCase().includes(q)
        || categoryLabel(u.category || '').toLowerCase().includes(q)
      )
    : units

  const freeUnits = units.filter(u => !u.cell_id && !u.pavilion_id)
  const freeCount = sumUnitQty(freeUnits)
  const placedCount = sumUnitQty(units) - freeCount

  return (
    <div className="pul-root">
      <Styles />

      <div className="pul-search">
        <SearchIcon size={15} className="pul-search-icon" />
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Найти по названию, инв. номеру…"
          className="pul-search-input"
          autoFocus
        />
      </div>

      {!loading && !q && freeCount > 0 && (
        <div className="pul-section-title">
          Без места
          <span className="pul-section-count">{freeCount}</span>
        </div>
      )}

      {loading ? (
        <div className="pul-status">Загрузка…</div>
      ) : filtered.length === 0 ? (
        <div className="pul-status">
          {q ? `По запросу «${search}» ничего не найдено` : 'На складе нет свободных единиц'}
        </div>
      ) : (
        <div className="pul-list">
          {filtered.map((u, idx) => {
            const noPlace = !u.cell_id && !u.pavilion_id
            const placedAt = u.cell_custom || u.cell_code
            const isBusy = assigning === u.id
            const prevNoPlace = idx > 0 && (!filtered[idx - 1].cell_id && !filtered[idx - 1].pavilion_id)
            const showPlacedHeader = !q && !noPlace && prevNoPlace

            return (
              <div key={u.id} style={{ width: '100%' }}>
                {showPlacedHeader && (
                  <div className="pul-section-title pul-section-title-second">
                    Уже размещены
                    <span className="pul-section-count">{placedCount}</span>
                  </div>
                )}
                <button
                  disabled={!!assigning}
                  onClick={async () => {
                    setAssigning(u.id)
                    try { await onPicked?.(u) } finally { setAssigning(null) }
                  }}
                  className={`pul-row ${noPlace ? 'free' : ''} ${isBusy ? 'busy' : ''} ${assigning && !isBusy ? 'dim' : ''}`}
                >
                  <div className="pul-thumb">
                    {u.photo_url && !/\.(mp4|webm|mov)$/i.test(u.photo_url)
                      ? <img src={u.photo_url} alt="" />
                      : <Package size={22} color="var(--subtle)" strokeWidth={1.4} />}
                  </div>
                  <div className="pul-main">
                    <div className="pul-name">{u.name || '—'}</div>
                    <div className="pul-meta">
                      {[
                        u.category ? categoryLabel(u.category) : null,
                        u.serial || null,
                      ].filter(Boolean).join(' · ') || '—'}
                    </div>
                  </div>
                  <div className="pul-right">
                    {noPlace
                      ? <span className="pul-pill-free">Без места</span>
                      : placedAt && <span className="pul-pill-placed">{placedAt}</span>}
                    {isBusy
                      ? <span className="pul-busy-text">Размещаем…</span>
                      : <ChevronRight size={16} strokeWidth={1.6} className="pul-chevron" />}
                  </div>
                </button>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

function Styles() {
  return (
    <style>{`
      .pul-root { display: flex; flex-direction: column; }

      .pul-search {
        position: relative;
        margin-bottom: 12px;
      }
      .pul-search-icon {
        position: absolute; left: 14px; top: 50%;
        transform: translateY(-50%);
        color: var(--muted); pointer-events: none;
      }
      .pul-search-input {
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
      .pul-search-input:focus {
        border-color: var(--gold-500);
        background: var(--white);
      }

      .pul-section-title {
        display: flex; align-items: center; gap: 8px;
        font-size: 11px; font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.05em;
        color: var(--muted);
        padding: 8px 4px 6px;
      }
      .pul-section-title-second { margin-top: 10px; }
      .pul-section-count {
        display: inline-flex; align-items: center;
        height: 18px; padding: 0 8px;
        border-radius: 999px;
        background: var(--bg-secondary);
        color: var(--text);
        font-size: 10px; font-weight: 600;
        letter-spacing: 0;
      }

      .pul-status {
        text-align: center; padding: 32px 0;
        color: var(--muted); font-size: 13px;
      }

      .pul-list {
        display: flex; flex-direction: column; gap: 6px;
      }

      .pul-row {
        display: flex; align-items: center; gap: 12px;
        width: 100%;
        padding: 10px 12px;
        border: 1px solid var(--border);
        border-radius: 12px;
        background: var(--white);
        cursor: pointer;
        font-family: inherit;
        text-align: left;
        transition: border-color 0.12s, transform 0.12s, box-shadow 0.12s;
      }
      .pul-row:hover:not(:disabled) {
        border-color: var(--gold-500);
        transform: translateY(-1px);
        box-shadow: 0 4px 14px rgba(201,165,92,0.14);
      }
      .pul-row.free {
        border-color: var(--gold-500);
        background: linear-gradient(180deg, var(--gold-100) 0%, var(--white) 100%);
      }
      .pul-row.busy {
        cursor: wait;
        border-color: var(--gold-500);
      }
      .pul-row.dim { opacity: 0.45; pointer-events: none; }

      .pul-thumb {
        width: 56px; height: 56px;
        flex-shrink: 0;
        border-radius: 10px;
        background: var(--paper);
        border: 1px solid var(--border);
        display: flex; align-items: center; justify-content: center;
        overflow: hidden;
      }
      .pul-thumb img {
        width: 100%; height: 100%;
        object-fit: cover;
      }

      .pul-main {
        flex: 1; min-width: 0;
        display: flex; flex-direction: column; gap: 3px;
      }
      .pul-name {
        font-size: 14px; font-weight: 600;
        color: var(--text);
        line-height: 1.25;
        overflow: hidden; text-overflow: ellipsis;
        white-space: nowrap;
      }
      .pul-meta {
        font-size: 12px; color: var(--muted);
        overflow: hidden; text-overflow: ellipsis;
        white-space: nowrap;
      }

      .pul-right {
        display: flex; align-items: center; gap: 8px;
        flex-shrink: 0;
      }
      .pul-pill-free {
        display: inline-flex; align-items: center;
        height: 22px; padding: 0 10px;
        border-radius: 999px;
        background: var(--gold-600);
        color: #fff;
        font-size: 11px; font-weight: 600;
        letter-spacing: 0.01em;
      }
      .pul-pill-placed {
        display: inline-flex; align-items: center;
        height: 22px; padding: 0 10px;
        border-radius: 999px;
        background: var(--bg-secondary);
        color: var(--muted);
        font-size: 11px; font-weight: 500;
        max-width: 140px;
        overflow: hidden; text-overflow: ellipsis;
        white-space: nowrap;
      }
      .pul-chevron { color: var(--border-strong); }
      .pul-row:hover:not(:disabled) .pul-chevron { color: var(--gold-600); }
      .pul-busy-text {
        font-size: 11px; font-weight: 500;
        color: var(--gold-600);
        white-space: nowrap;
      }

      @media (max-width: 768px) {
        .pul-thumb { width: 48px; height: 48px; }
        .pul-name { font-size: 13.5px; }
        .pul-pill-placed { display: none; }
      }
    `}</style>
  )
}
