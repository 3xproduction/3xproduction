import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { FileText, FileCheck, Handshake, ChevronLeft } from 'lucide-react'
import WarehouseLayout from './WarehouseLayout'
import ProductionLayout from '../production/ProductionLayout'
import { issuances as issuancesApi } from '../../services/api'
import { useAuth } from '../../hooks/useAuth'
import { ROLES } from '../../constants/roles'

const css = `
.acts-page { padding: 28px 32px; max-width: 900px; }
/* Embed: вкладка внутри IssuedByProjectsPage. Шапку и паддинги задаёт родитель. */
.acts-page-embed { padding: 0 !important; max-width: none !important; }
.acts-title { font-size: 22px; font-weight: 600; letter-spacing: -0.03em; margin-bottom: 2px; }
.acts-sub { color: var(--muted); font-size: 13px; }
.acts-tabs { display: flex; gap: 0; border-bottom: 1px solid var(--border); margin: 20px 0 20px; }
.acts-tab {
  padding: 9px 20px; font-size: 14px; font-weight: 500;
  background: none; border: none; cursor: pointer;
  color: var(--muted); border-bottom: 2px solid transparent;
  margin-bottom: -1px; transition: color 0.12s;
  display: flex; align-items: center; gap: 7px;
}
.acts-tab.active { color: var(--accent); border-bottom-color: var(--accent); }
.acts-tab-count {
  font-size: 11px; font-weight: 600;
  padding: 1px 6px; border-radius: 10px;
  background: var(--bg-secondary); color: var(--muted);
}
.acts-tab.active .acts-tab-count { background: var(--accent-dim); color: var(--accent); }
.acts-list { display: flex; flex-direction: column; gap: 10px; }
.acts-item {
  background: var(--card); border: 1px solid var(--border);
  border-radius: var(--radius-card); padding: 16px 20px;
  display: flex; align-items: center; gap: 14px;
  box-shadow: var(--shadow-sm);
}
.acts-icon {
  width: 40px; height: 40px; border-radius: 10px;
  background: var(--accent-dim); color: var(--accent);
  display: flex; align-items: center; justify-content: center;
  flex-shrink: 0;
}
.acts-item-body { flex: 1; min-width: 0; }
.acts-item-title { font-weight: 600; font-size: 14px; margin-bottom: 5px; }
.acts-item-meta { font-size: 12px; color: var(--muted); display: flex; gap: 14px; flex-wrap: wrap; }
.acts-pdf-btn {
  padding: 7px 14px; border-radius: var(--radius-btn);
  background: var(--accent-dim); color: var(--accent);
  font-size: 13px; font-weight: 500;
  text-decoration: none; flex-shrink: 0;
  transition: background 0.12s;
}
.acts-pdf-btn:hover { background: var(--accent); color: #fff; }
.acts-no-pdf { font-size: 12px; color: var(--muted); flex-shrink: 0; }
.acts-returned { color: var(--green); font-weight: 500; }
.acts-damage { color: var(--amber); }
.acts-empty { color: var(--muted); font-size: 14px; padding: 60px 0; text-align: center; }

.acts-sticky {}

@media (max-width: 768px) {
  .acts-page { padding: 16px; }
  .acts-page-embed { padding: 0 !important; }
  .acts-title { font-size: 18px; }
  .acts-item { flex-wrap: wrap; padding: 14px 16px; }
  .acts-item-meta { gap: 8px; }
  .acts-pdf-btn { width: 100%; text-align: center; margin-top: 4px; }
  .acts-sticky {
    position: sticky; top: var(--page-sticky-top, 52px); z-index: 12;
    background: var(--paper);
    margin: -16px -16px 0;
    padding: 12px 16px 0;
  }
  /* Табы Заявки/Аренда — горизонтальный скролл, без отдельного отступа сверху. */
  .acts-sticky .acts-tabs { margin: 12px 0 0; overflow-x: auto; scrollbar-width: none; }
  .acts-sticky .acts-tabs::-webkit-scrollbar { display: none; }
}
`

function formatDate(str) {
  if (!str) return '—'
  return new Date(str).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', year: 'numeric' })
}

export default function ActsPage({ embed = false }) {
  const { user } = useAuth()
  const navigate = useNavigate()
  // В embed-режиме шапка задаётся родителем (IssuedByProjectsPage),
  // оборачивающего Layout не нужно — рендерим только контент актов.
  const Layout = embed
    ? 'div'
    : (ROLES[user?.role]?.world === 'production' ? ProductionLayout : WarehouseLayout)
  const [tab, setTab] = useState('requests')
  const [data, setData] = useState({ issuances: [], returns: [], rentDeals: [] })
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    issuancesApi.acts()
      .then(d => setData(d))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  const requestsCount = data.issuances.length + data.returns.length

  return (
    <Layout>
      <style>{css}</style>
      <div className={embed ? 'acts-page acts-page-embed' : 'acts-page'}>
        <div className="acts-sticky">
          {!embed && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <button className="page-back" onClick={() => navigate(-1)} aria-label="Назад">
                <ChevronLeft size={20} />
              </button>
              <div>
                <h1 className="acts-title" style={{ margin: 0 }}>Акты</h1>
                <p className="acts-sub" style={{ margin: 0 }}>Акты по заявкам и аренде</p>
              </div>
            </div>
          )}

        <div className="acts-tabs">
          <button className={`acts-tab${tab === 'requests' ? ' active' : ''}`} onClick={() => setTab('requests')}>
            <FileText size={15} strokeWidth={1.8} />
            Заявки
            <span className="acts-tab-count">{requestsCount}</span>
          </button>
          <button className={`acts-tab${tab === 'rent' ? ' active' : ''}`} onClick={() => setTab('rent')}>
            <Handshake size={15} strokeWidth={1.8} />
            Аренда
            <span className="acts-tab-count">{(data.rentDeals || []).length}</span>
          </button>
        </div>
        </div>

        {loading ? (
          <div className="acts-empty">Загрузка...</div>
        ) : tab === 'requests' ? (
          requestsCount === 0
            ? <div className="acts-empty">Нет актов</div>
            : <div className="acts-list">
                {data.issuances.map(i => (
                  <div key={'i-' + i.id} className="acts-item">
                    <div className="acts-icon"><FileText size={18} strokeWidth={1.8} /></div>
                    <div className="acts-item-body">
                      <div className="acts-item-title">Выдача · {formatDate(i.issued_at)}</div>
                      <div className="acts-item-meta">
                        <span>Выдал: {i.issued_by_name}</span>
                        <span>Получил: {i.received_by_name}</span>
                        <span>{(i.unit_ids || []).length} ед.</span>
                        <span>До: {formatDate(i.deadline)}</span>
                        {i.returned && <span className="acts-returned">✓ Возвращено</span>}
                      </div>
                    </div>
                    {i.act_pdf_url
                      ? <a href={i.act_pdf_url} target="_blank" rel="noreferrer" className="acts-pdf-btn">PDF →</a>
                      : <span className="acts-no-pdf">Нет PDF</span>}
                  </div>
                ))}
                {data.returns.map(r => (
                  <div key={'r-' + r.id} className="acts-item">
                    <div className="acts-icon" style={{ background: 'var(--green-dim)', color: 'var(--green)' }}>
                      <FileCheck size={18} strokeWidth={1.8} />
                    </div>
                    <div className="acts-item-body">
                      <div className="acts-item-title">Возврат · {formatDate(r.returned_at)}</div>
                      <div className="acts-item-meta">
                        <span>Вернул: {r.returned_by_name}</span>
                        <span>Принял: {r.accepted_by_name}</span>
                        <span>{(r.unit_ids || []).length} ед.</span>
                        {r.condition_notes && <span className="acts-damage">⚠ {r.condition_notes}</span>}
                      </div>
                    </div>
                    {r.act_pdf_url
                      ? <a href={r.act_pdf_url} target="_blank" rel="noreferrer" className="acts-pdf-btn">PDF →</a>
                      : <span className="acts-no-pdf">Нет PDF</span>}
                  </div>
                ))}
              </div>
        ) : tab === 'rent' ? (
          (data.rentDeals || []).length === 0
            ? <div className="acts-empty">Нет актов аренды</div>
            : <div className="acts-list">
                {(data.rentDeals || []).map(d => (<>
                  <div key={'ri-' + d.id} className="acts-item">
                    <div className="acts-icon" style={{ background: 'var(--amber-dim)', color: 'var(--amber)' }}>
                      <Handshake size={18} strokeWidth={1.8} />
                    </div>
                    <div className="acts-item-body">
                      <div className="acts-item-title">
                        Выдача · {d.type === 'out' ? 'Сдача в аренду' : 'Аренда'} · {formatDate(d.created_at)}
                      </div>
                      <div className="acts-item-meta">
                        <span>Контрагент: {d.counterparty_name || '—'}</span>
                        <span>{(d.unit_ids || []).length} ед.</span>
                        <span>{formatDate(d.period_start)} — {formatDate(d.period_end)}</span>
                        {d.deposit && <span style={{ color: 'var(--green)', fontWeight: 500 }}>Залог: {Number(d.deposit).toLocaleString('ru-RU')} ₽</span>}
                      </div>
                    </div>
                    {d.contract_pdf_url
                      ? <a href={d.contract_pdf_url} target="_blank" rel="noreferrer" className="acts-pdf-btn">PDF →</a>
                      : <span className="acts-no-pdf">Нет PDF</span>}
                  </div>
                  {d.status === 'done' && (
                    <div key={'rr-' + d.id} className="acts-item">
                      <div className="acts-icon" style={{ background: 'var(--green-dim)', color: 'var(--green)' }}>
                        <FileCheck size={18} strokeWidth={1.8} />
                      </div>
                      <div className="acts-item-body">
                        <div className="acts-item-title">Возврат · {d.counterparty_name} · {formatDate(d.period_end)}</div>
                        <div className="acts-item-meta">
                          <span>{(d.unit_ids || []).length} ед.</span>
                          <span className="acts-returned">✓ Возвращено</span>
                          {d.deposit && <span style={{ color: 'var(--green)', fontWeight: 500 }}>Залог: {Number(d.deposit).toLocaleString('ru-RU')} ₽</span>}
                        </div>
                      </div>
                      {d.return_pdf_url
                        ? <a href={d.return_pdf_url} target="_blank" rel="noreferrer" className="acts-pdf-btn">PDF →</a>
                        : <span className="acts-no-pdf">Нет PDF</span>}
                    </div>
                  )}
                </>))}
              </div>
        ) : null}
      </div>
    </Layout>
  )
}
