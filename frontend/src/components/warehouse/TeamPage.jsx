import { useState, useEffect, useRef } from 'react'
import { Search, UserPlus, Copy, Check, X } from 'lucide-react'
import WarehouseLayout from './WarehouseLayout'
import ProductionLayout from '../production/ProductionLayout'
import Button from '../shared/Button'
import { team as teamApi, invites as invitesApi } from '../../services/api'
import { useAuth } from '../../hooks/useAuth'
import { ROLES } from '../../constants/roles'

const css = `
.team-page { padding: 28px 32px; max-width: 900px; }
.team-title { font-size: 22px; font-weight: 600; letter-spacing: -0.03em; margin-bottom: 2px; }
.team-sub { color: var(--muted); font-size: 13px; margin-bottom: 20px; }
.team-search-wrap { position: relative; flex: 1; min-width: 200px; }
.team-search-icon { position: absolute; left: 12px; top: 50%; transform: translateY(-50%); color: var(--muted); pointer-events: none; }
.team-search {
  width: 100%; height: 40px; padding: 0 14px 0 38px;
  border: 1px solid var(--border); border-radius: var(--radius-input);
  background: var(--card); color: var(--text); font-size: 14px;
  transition: border-color 0.15s;
}
.team-search:focus { border-color: var(--accent); outline: none; }
.team-list { display: flex; flex-direction: column; gap: 8px; }
.team-item {
  background: var(--card); border: 1px solid var(--border);
  border-radius: var(--radius-card); padding: 14px 18px;
  display: flex; align-items: center; gap: 14px;
  box-shadow: var(--shadow-sm);
}
.team-avatar {
  width: 40px; height: 40px; border-radius: 50%;
  display: flex; align-items: center; justify-content: center;
  font-size: 14px; font-weight: 600; color: #fff; flex-shrink: 0;
}
.team-name { font-weight: 600; font-size: 14px; }
.team-email { font-size: 12px; color: var(--muted); margin-top: 2px; }
.team-role-badge {
  display: inline-block; padding: 3px 10px;
  background: var(--accent-dim); color: var(--accent);
  border-radius: 20px; font-size: 12px; font-weight: 500;
}
.team-zone { font-size: 11px; color: var(--muted); margin-top: 3px; }
.team-date { font-size: 11px; color: var(--muted); margin-top: 3px; }
.team-empty { color: var(--muted); font-size: 14px; padding: 60px 0; text-align: center; }

/* Invite modal */
.invite-modal-overlay {
  position: fixed; inset: 0; background: rgba(0,0,0,0.4);
  z-index: 400; display: flex; align-items: center; justify-content: center;
  padding: 24px;
}
.invite-modal {
  background: var(--white, #fff); border-radius: var(--radius-card);
  padding: 28px; max-width: 480px; width: 100%;
  max-height: 90vh; overflow-y: auto;
}
.invite-modal-title { font-size: 16px; font-weight: 600; margin-bottom: 20px; }
.invite-label { font-size: 13px; font-weight: 500; margin-bottom: 6px; color: var(--text); }
.invite-select {
  width: 100%; height: 40px; padding: 0 12px;
  border: 1px solid var(--border); border-radius: var(--radius-btn);
  background: var(--white, #fff); color: var(--text); font-size: 13px; cursor: pointer;
}
.invite-select:focus { outline: none; border-color: var(--accent); }
.invite-check-row {
  display: flex; align-items: flex-start; gap: 10px;
  padding: 12px 14px; border-radius: 10px;
  background: var(--bg); border: 1px solid var(--border);
  cursor: pointer; margin-bottom: 0;
}
.invite-check-row input[type=checkbox] { margin-top: 2px; accent-color: var(--accent); cursor: pointer; }
.invite-check-label { font-size: 13px; line-height: 1.5; }
.invite-check-sub { font-size: 11px; color: var(--muted); margin-top: 2px; }
.invite-link-box {
  background: var(--bg); border: 1px solid var(--border);
  border-radius: 10px; padding: 14px;
  font-size: 12px; color: var(--muted); word-break: break-all;
  display: flex; align-items: flex-start; gap: 10px;
}
.invite-link-text { flex: 1; font-family: monospace; font-size: 12px; color: var(--text); }
.invite-copy-btn {
  flex-shrink: 0; width: 32px; height: 32px; border-radius: 8px;
  background: var(--accent-dim); color: var(--accent);
  border: none; cursor: pointer;
  display: flex; align-items: center; justify-content: center;
}

@media (max-width: 768px) {
  .team-page { padding: 16px; }
  .team-title { font-size: 18px; }
  .team-item { padding: 12px 14px; }
  .invite-modal { padding: 20px; }
}
`

const WAREHOUSE_ROLES = ['warehouse_director', 'warehouse_deputy', 'warehouse_staff']
const PRODUCTION_ROLES = Object.keys(ROLES).filter(r => ROLES[r].world === 'production')

function getRoleOptions(inviterRole) {
  if (inviterRole === 'warehouse_director') return WAREHOUSE_ROLES.filter(r => r !== 'warehouse_director')
  if (inviterRole === 'project_director') return PRODUCTION_ROLES
  if (inviterRole === 'producer') return [...WAREHOUSE_ROLES, ...PRODUCTION_ROLES]
  return []
}

const COLORS = ['#d97757', '#2563eb', '#16a34a', '#8b5cf6', '#ec4899', '#14b8a6']
function colorFor(id) {
  let n = 0
  for (let i = 0; i < (id || '').length; i++) n += id.charCodeAt(i)
  return COLORS[n % COLORS.length]
}
function getInitials(name) {
  return (name || '').split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase()
}
function formatDate(str) {
  if (!str) return ''
  return new Date(str).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' })
}

export default function TeamPage() {
  const { user } = useAuth()
  const [members, setMembers] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const searchTimer = useRef(null)

  // Invite modal state
  const [showInvite, setShowInvite] = useState(false)
  const [inviteRole, setInviteRole] = useState('')
  const [uploadKpp, setUploadKpp] = useState(false)
  const [uploadCallsheet, setUploadCallsheet] = useState(false)
  const [generating, setGenerating] = useState(false)
  const [inviteLink, setInviteLink] = useState('')
  const [copied, setCopied] = useState(false)
  const [inviteError, setInviteError] = useState('')

  const canInvite = ROLES[user?.role]?.canInvite?.length > 0
  const canRemove = ['warehouse_director', 'warehouse_deputy', 'project_director', 'producer'].includes(user?.role)
  const roleOptions = getRoleOptions(user?.role)

  useEffect(() => {
    clearTimeout(searchTimer.current)
    searchTimer.current = setTimeout(() => setDebouncedSearch(search), 300)
    return () => clearTimeout(searchTimer.current)
  }, [search])

  useEffect(() => {
    const params = {}
    if (debouncedSearch.trim()) params.search = debouncedSearch.trim()
    setLoading(true)
    teamApi.list(params)
      .then(data => setMembers(data.team || []))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [debouncedSearch])

  const filtered = members.filter(m => m.id !== user?.id)

  function openInvite() {
    setInviteRole(roleOptions[0] || '')
    setUploadKpp(false)
    setUploadCallsheet(false)
    setInviteLink('')
    setCopied(false)
    setInviteError('')
    setShowInvite(true)
  }

  // Determine which checkboxes to show
  const showKppCheck = inviteRole === 'project_deputy'
  const showCallsheetCheck = inviteRole === 'project_deputy' ||
    inviteRole === 'set_admin' || inviteRole === 'assistant_director'
  // For set_admin and assistant_director callsheet is default ON
  const isCallsheetDefault = inviteRole === 'set_admin' || inviteRole === 'assistant_director'

  async function handleGenerate() {
    if (!inviteRole) return
    setGenerating(true)
    try {
      const upload_rights = {}
      if (showKppCheck && uploadKpp) {
        upload_rights.kpp = true
        upload_rights.scenario = true
      }
      if ((showCallsheetCheck && uploadCallsheet) || isCallsheetDefault) {
        upload_rights.callsheet = true
      }

      const data = await invitesApi.generate({
        role: inviteRole,
        project_id: user?.project_id || null,
        upload_rights,
      })
      const token = data?.invite?.token
      if (!token) { setInviteError('Сервер не вернул токен'); return }
      setInviteLink(`${window.location.origin}/invite/${token}`)
      setInviteError('')
    } catch (err) {
      setInviteError(err.message || 'Ошибка генерации ссылки')
    } finally {
      setGenerating(false)
    }
  }

  function copyLink() {
    navigator.clipboard.writeText(inviteLink).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

  function closeInvite() {
    setShowInvite(false)
    setInviteLink('')
  }

  const Layout = ROLES[user?.role]?.world === 'production' ? ProductionLayout : WarehouseLayout

  return (
    <Layout>
      <style>{css}</style>
      <div className="team-page">
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 20 }}>
          <div>
            <h1 className="team-title">Наша команда</h1>
            <p className="team-sub">{loading ? '...' : `${members.length} участников`}</p>
          </div>
          {canInvite && (
            <Button onClick={openInvite} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <UserPlus size={15} />
              Пригласить
            </Button>
          )}
        </div>

        <div style={{ display: 'flex', gap: 10, marginBottom: 20 }}>
          <div className="team-search-wrap">
            <Search size={15} className="team-search-icon" />
            <input
              className="team-search"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Найдите по имени, email или роли..."
            />
          </div>
        </div>

        {loading ? (
          <div className="team-empty">Загрузка...</div>
        ) : filtered.length === 0 ? (
          <div className="team-empty">Никого не найдено</div>
        ) : (
          <div className="team-list">
            {filtered.map(m => (
              <div key={m.id} className="team-item">
                <div className="team-avatar" style={{ background: colorFor(m.id) }}>
                  {getInitials(m.name)}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="team-name">{m.name}</div>
                  <div className="team-email">{m.email}</div>
                </div>
                <div style={{ textAlign: 'right', flexShrink: 0 }}>
                  <div className="team-role-badge">{ROLES[m.role]?.label || m.role}</div>
                  {m.warehouse_zone && <div className="team-zone">Зона: {m.warehouse_zone}</div>}
                  <div className="team-date">с {formatDate(m.created_at)}</div>
                  {canRemove && (
                    <button
                      onClick={() => {
                        if (window.confirm(`Удалить ${m.name} из команды?`)) {
                          teamApi.remove(m.id).then(() => setMembers(prev => prev.filter(p => p.id !== m.id)))
                        }
                      }}
                      style={{ marginTop: 6, padding: '3px 10px', fontSize: 11, color: 'var(--red)', background: 'none', border: '1px solid var(--red)', borderRadius: 6, cursor: 'pointer' }}>
                      Удалить
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Invite Modal */}
      {showInvite && (
        <div className="invite-modal-overlay" onClick={closeInvite}>
          <div className="invite-modal" onClick={e => e.stopPropagation()}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
              <div className="invite-modal-title" style={{ margin: 0 }}>Пригласить участника</div>
              <button onClick={closeInvite} style={{ border: 'none', background: 'none', cursor: 'pointer', color: 'var(--muted)', padding: 4 }}>
                <X size={18} />
              </button>
            </div>

            <div style={{ marginBottom: 16 }}>
              <div className="invite-label">Роль</div>
              <select
                className="invite-select"
                value={inviteRole}
                onChange={e => { setInviteRole(e.target.value); setUploadKpp(false); setUploadCallsheet(false); setInviteLink('') }}
              >
                {roleOptions.map(r => (
                  <option key={r} value={r}>{ROLES[r]?.label || r}</option>
                ))}
              </select>
            </div>

            {(showKppCheck || showCallsheetCheck) && (
              <div style={{ marginBottom: 16, display: 'flex', flexDirection: 'column', gap: 8 }}>
                <div className="invite-label">Права доступа</div>

                {showKppCheck && (
                  <label className="invite-check-row" onClick={() => { setUploadKpp(v => !v); setInviteLink('') }}>
                    <input type="checkbox" checked={uploadKpp} readOnly />
                    <div>
                      <div className="invite-check-label">Загрузка КПП и сценариев</div>
                      <div className="invite-check-sub">Сможет загружать КПП и сценарии в раздел Документы</div>
                    </div>
                  </label>
                )}

                {showCallsheetCheck && (
                  <label className="invite-check-row" onClick={isCallsheetDefault ? undefined : () => { setUploadCallsheet(v => !v); setInviteLink('') }}
                    style={isCallsheetDefault ? { opacity: 0.7, cursor: 'default' } : {}}>
                    <input type="checkbox" checked={isCallsheetDefault ? true : uploadCallsheet} readOnly disabled={isCallsheetDefault} />
                    <div>
                      <div className="invite-check-label">Загрузка вызывного листа</div>
                      <div className="invite-check-sub">
                        {isCallsheetDefault
                          ? 'Входит в стандартные права роли'
                          : 'Сможет загружать вызывные листы'}
                      </div>
                    </div>
                  </label>
                )}
              </div>
            )}

            {inviteError && (
              <div style={{ color: 'var(--red)', fontSize: 13, marginBottom: 12, padding: '8px 12px', background: 'var(--red-dim)', borderRadius: 8 }}>
                {inviteError}
              </div>
            )}
            {!inviteLink ? (
              <Button fullWidth disabled={!inviteRole || generating} onClick={handleGenerate}>
                {generating ? 'Генерация...' : 'Создать ссылку'}
              </Button>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                <div>
                  <div className="invite-label" style={{ marginBottom: 8 }}>Ссылка для приглашения</div>
                  <div className="invite-link-box">
                    <span className="invite-link-text">{inviteLink}</span>
                    <button className="invite-copy-btn" onClick={copyLink}>
                      {copied ? <Check size={14} /> : <Copy size={14} />}
                    </button>
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 6 }}>
                    Ссылка одноразовая — действует до первой регистрации
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <Button variant="secondary" fullWidth onClick={() => { setInviteLink(''); setUploadKpp(false); setUploadCallsheet(false) }}>
                    Новая ссылка
                  </Button>
                  <Button fullWidth onClick={closeInvite}>Готово</Button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </Layout>
  )
}
