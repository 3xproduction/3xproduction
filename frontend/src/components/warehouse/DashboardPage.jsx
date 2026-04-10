import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { Bell, Plus, Package, ArrowRightLeft, AlertTriangle, Clock, MapPin } from 'lucide-react'
import WarehouseLayout from './WarehouseLayout'
import Badge from '../shared/Badge'
import Button from '../shared/Button'
import { units as unitsApi, requests as requestsApi, issuances as issuancesApi, rent as rentApi } from '../../services/api'
import { useNotifications } from '../../hooks/useNotifications'
import { useAuth } from '../../hooks/useAuth'
import { ROLES } from '../../constants/roles'

const css = `
.dash-page { padding: 28px 32px; max-width: 1100px; }
.dash-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 28px; gap: 12px; }
.dash-title { font-size: 22px; font-weight: 600; letter-spacing: -0.03em; margin-bottom: 2px; }
.dash-sub { color: var(--muted); font-size: 13px; }
.dash-header-actions { display: flex; gap: 8px; flex-shrink: 0; }

.dash-stats { display: grid; grid-template-columns: repeat(5,1fr); gap: 14px; margin-bottom: 24px; }
@media (max-width: 1100px) {
  .dash-stats { grid-template-columns: repeat(3,1fr); }
}
.dash-stat {
  background: var(--card); border: 1px solid var(--border);
  border-radius: var(--radius-card); padding: 20px;
  box-shadow: var(--shadow-sm);
}
.dash-stat-icon {
  width: 38px; height: 38px; border-radius: 10px;
  display: flex; align-items: center; justify-content: center;
  margin-bottom: 14px;
}
.dash-stat-value { font-size: 28px; font-weight: 600; line-height: 1; letter-spacing: -0.04em; }
.dash-stat-label { font-size: 12px; color: var(--muted); margin-top: 5px; font-weight: 500; }

.dash-cards { display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; }
.dash-card {
  background: var(--card); border: 1px solid var(--border);
  border-radius: var(--radius-card); padding: 20px;
  box-shadow: var(--shadow-sm);
}
.dash-card-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 14px; }
.dash-card-title { font-weight: 600; font-size: 14px; }
.dash-card-link {
  font-size: 13px; color: var(--accent); font-weight: 500;
  background: none; border: none; cursor: pointer;
  padding: 0;
}
.dash-card-empty { color: var(--muted); font-size: 13px; padding: 20px 0; text-align: center; }

.dash-req-item {
  display: flex; align-items: center; justify-content: space-between;
  padding: 11px 0; border-bottom: 1px solid var(--border);
  gap: 12px;
}
.dash-req-item:last-child { border-bottom: none; }
.dash-req-title { font-weight: 500; font-size: 14px; }
.dash-req-sub { color: var(--muted); font-size: 12px; margin-top: 2px; }

.dash-notif-item {
  display: flex; gap: 10px; align-items: flex-start;
  padding: 10px 0; border-bottom: 1px solid var(--border);
  cursor: pointer; transition: background 0.15s; border-radius: 6px;
}
.dash-notif-item:hover { background: var(--bg); }
.dash-notif-item:last-child { border-bottom: none; }
.dash-notif-dot { width: 7px; height: 7px; border-radius: 50%; margin-top: 5px; flex-shrink: 0; }
.dash-notif-text { font-size: 13px; line-height: 1.4; }
.dash-notif-time { font-size: 11px; color: var(--muted); margin-top: 3px; }

.dash-bell {
  position: relative; width: 38px; height: 38px;
  border-radius: var(--radius-btn); border: 1px solid var(--border);
  background: var(--card); display: flex; align-items: center;
  justify-content: center; cursor: pointer; color: var(--muted);
  transition: background 0.12s;
}
.dash-bell:hover { background: var(--bg-secondary); }
.dash-bell-dot {
  position: absolute; top: 7px; right: 7px;
  width: 7px; height: 7px; border-radius: 50%;
  background: var(--accent);
}

@media (max-width: 768px) {
  .dash-page { padding: 16px; }
  .dash-header { flex-direction: column; align-items: flex-start; gap: 10px; }
  .dash-header-actions { width: 100%; display: flex; justify-content: flex-start; }
  .dash-stats { grid-template-columns: repeat(2,1fr); gap: 10px; margin-bottom: 16px; }
  .dash-cards { grid-template-columns: 1fr; gap: 12px; }
  .dash-title { font-size: 18px; }
  .dash-stat { padding: 14px; }
  .dash-stat-value { font-size: 22px; }
  .dash-stat-label { font-size: 11px; }
}

@media (max-width: 400px) {
  .dash-stats { grid-template-columns: repeat(2,1fr); }
}
`

const DOT_COLOR = {
  overdue: 'var(--red)',
  damage: 'var(--amber)',
  new_request: 'var(--accent)',
  new_version: 'var(--blue)',
}

function timeAgo(dateStr) {
  const diff = (Date.now() - new Date(dateStr)) / 1000
  if (diff < 60)    return 'только что'
  if (diff < 3600)  return `${Math.floor(diff / 60)} мин назад`
  if (diff < 86400) return `${Math.floor(diff / 3600)} ч назад`
  return `${Math.floor(diff / 86400)} д назад`
}

function formatDate(str) {
  if (!str) return ''
  return new Date(str).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })
}

const today = new Date().toLocaleDateString('ru-RU', { weekday: 'long', day: 'numeric', month: 'long' })

export default function DashboardPage() {
  const navigate = useNavigate()
  const { user } = useAuth()
  const { items: notifs, unreadCount } = useNotifications()
  const [publicLink, setPublicLink] = useState('')
  const [linkCopied, setLinkCopied] = useState(false)
  const [stats, setStats] = useState({ on_stock: 0, issued: 0, overdue: 0, pending: 0, no_cell: 0 })
  const [reqs, setReqs] = useState([])
  const [activeIssuances, setActiveIssuances] = useState([])

  useEffect(() => {
    unitsApi.list().then(data => {
      const us = data.units || []
      setStats({
        on_stock: us.filter(u => u.status === 'on_stock').length,
        issued:   us.filter(u => u.status === 'issued').length,
        overdue:  us.filter(u => u.status === 'overdue').length,
        pending:  us.filter(u => u.status === 'pending').length,
        no_cell:  us.filter(u => u.status === 'on_stock' && !u.cell_id).length,
      })
    }).catch(() => {})
    requestsApi.list({ status: 'new' }).then(data => {
      setReqs((data.requests || []).slice(0, 4))
    }).catch(() => {})
    issuancesApi.active().then(data => {
      setActiveIssuances((data.issuances || []).slice(0, 4))
    }).catch(() => {})
  }, [])

  const STATS = [
    { label: 'На складе',      value: stats.on_stock, color: 'var(--green)',  bg: 'var(--green-dim)',  Icon: Package },
    { label: 'Выдано',         value: stats.issued,   color: 'var(--blue)',   bg: 'var(--blue-dim)',   Icon: ArrowRightLeft },
    { label: 'Не вернули',        value: stats.overdue,  color: 'var(--red)',    bg: 'var(--red-dim)',    Icon: AlertTriangle },
    { label: 'Принять на склад', value: stats.pending,  color: 'var(--amber)',  bg: 'var(--amber-dim)',  Icon: Clock },
    { label: 'Ждут своей полки', value: stats.no_cell,  color: 'var(--muted)',  bg: 'var(--bg)',         Icon: MapPin },
  ]

  return (
    <WarehouseLayout>
      <style>{css}</style>
      <div className="dash-page">
        <div className="dash-header">
          <div>
            <h1 className="dash-title">Офис</h1>
            <p className="dash-sub">{today}</p>
          </div>
          <div className="dash-header-actions">
            {ROLES[user?.role]?.canPublicLink && (
              <Button variant="secondary" onClick={async () => {
                try {
                  const data = await rentApi.generateLink()
                  const url = data.url || data.link
                  if (url) setPublicLink(`${window.location.origin}${url}`)
                } catch (e) { alert(e.message || 'Ошибка') }
              }}>
                Публичная ссылка
              </Button>
            )}
            <Button variant="primary" onClick={() => navigate('/units?add=1')}>
              <Plus size={15} />
              Новое
            </Button>
            <button className="dash-bell" onClick={() => navigate('/notifications')}>
              <Bell size={18} />
              {unreadCount > 0 && <span className="dash-bell-dot" />}
            </button>
          </div>
        </div>

        <div className="dash-stats">
          {STATS.map(s => (
            <div key={s.label} className="dash-stat">
              <div className="dash-stat-icon" style={{ background: s.bg, color: s.color }}>
                <s.Icon size={18} strokeWidth={1.8} />
              </div>
              <div className="dash-stat-value" style={{ color: s.color }}>{s.value}</div>
              <div className="dash-stat-label">{s.label}</div>
            </div>
          ))}
        </div>

        <div className="dash-cards">
          <div className="dash-card">
            <div className="dash-card-header">
              <span className="dash-card-title">Заявки от проектов</span>
              <button className="dash-card-link" onClick={() => navigate('/requests')}>Все →</button>
            </div>
            {reqs.length === 0
              ? <div className="dash-card-empty">Нет новых заявок</div>
              : reqs.map(r => (
                <div key={r.id} className="dash-req-item">
                  <div>
                    <div className="dash-req-title">Заявка #{r.id.slice(0, 8)}</div>
                    <div className="dash-req-sub">{r.project_name && `${r.project_name} · `}{r.requester_name && `${r.requester_name} · `}{(r.unit_ids || []).length} ед.</div>
                  </div>
                  <Button variant="secondary" style={{ height: 32, fontSize: 12, padding: '0 12px' }}
                    onClick={() => navigate(`/issue/${r.id}`)}>
                    Выдать
                  </Button>
                </div>
              ))
            }
          </div>

          <div className="dash-card">
            <div className="dash-card-header">
              <span className="dash-card-title">Выдали</span>
            </div>
            {activeIssuances.length === 0
              ? <div className="dash-card-empty">Нет активных выдач</div>
              : activeIssuances.map(iss => (
                <div key={iss.id} className="dash-req-item" style={iss.return_requested_at ? { background: 'var(--amber-dim)', borderRadius: 8, padding: '11px 10px', margin: '-11px -10px', marginBottom: 0 } : {}}>
                  <div>
                    <div className="dash-req-title">
                      {iss.receiver_name || `Выдача #${String(iss.id).slice(0, 8)}`}
                      {iss.return_requested_at && <span style={{ fontSize: 11, color: 'var(--amber)', fontWeight: 500, marginLeft: 8 }}>Запрос на возврат</span>}
                    </div>
                    <div className="dash-req-sub">{iss.project_name && `${iss.project_name} · `}{(iss.unit_ids || []).length} ед. · {iss.deadline ? formatDate(iss.deadline) : ''}</div>
                  </div>
                  <Button variant={iss.return_requested_at ? 'primary' : 'secondary'} style={{ height: 32, fontSize: 12, padding: '0 12px' }}
                    onClick={() => navigate(`/return/${iss.id}`)}>
                    Возврат
                  </Button>
                </div>
              ))
            }
          </div>

          <div className="dash-card">
            <div className="dash-card-header">
              <span className="dash-card-title">Что нового?</span>
              <button className="dash-card-link" onClick={() => navigate('/notifications')}>Все →</button>
            </div>
            {notifs.length === 0
              ? <div className="dash-card-empty">Нет уведомлений</div>
              : notifs.slice(0, 4).map(n => (
                <div key={n.id} className="dash-notif-item" onClick={() => {
                  if (n.entity_type === 'request') navigate(`/issue/${n.entity_id}`)
                  else if (n.entity_type === 'unit') navigate(`/units/${n.entity_id}`)
                  else navigate('/notifications')
                }}>
                  <div className="dash-notif-dot" style={{ background: DOT_COLOR[n.type] || 'var(--border)' }} />
                  <div style={{ flex: 1 }}>
                    <div className="dash-notif-text">{n.text}</div>
                    <div className="dash-notif-time">{timeAgo(n.created_at)}</div>
                  </div>
                  <span style={{ color: 'var(--muted)', fontSize: 14, flexShrink: 0, marginTop: 2 }}>→</span>
                </div>
              ))
            }
          </div>
        </div>
      </div>
      {publicLink && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 500, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}
          onClick={() => { setPublicLink(''); setLinkCopied(false) }}>
          <div style={{ background: 'var(--white)', borderRadius: 'var(--radius-card)', padding: 24, maxWidth: 440, width: '100%' }}
            onClick={e => e.stopPropagation()}>
            <div style={{ fontWeight: 600, fontSize: 16, marginBottom: 8 }}>Публичная ссылка на склад</div>
            <div style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 16 }}>Отправьте эту ссылку для просмотра склада и подачи заявки</div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 16 }}>
              <input readOnly value={publicLink} style={{ flex: 1, height: 38, padding: '0 10px', border: '1px solid var(--border)', borderRadius: 'var(--radius-btn)', fontSize: 12, background: 'var(--bg)', fontFamily: 'monospace' }} />
              <Button onClick={() => { navigator.clipboard.writeText(publicLink); setLinkCopied(true) }}>
                {linkCopied ? '✓ Скопировано' : 'Копировать'}
              </Button>
            </div>
            <Button variant="secondary" fullWidth onClick={() => { setPublicLink(''); setLinkCopied(false) }}>Закрыть</Button>
          </div>
        </div>
      )}
    </WarehouseLayout>
  )
}
