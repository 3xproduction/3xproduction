import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { UserPlus, Copy, Check, X } from 'lucide-react'
import ProductionLayout from './ProductionLayout'
import Button from '../shared/Button'
import Badge from '../shared/Badge'
import { auth as authApi, invites as invitesApi } from '../../services/api'
import { useAuth } from '../../hooks/useAuth'
import { useToast } from '../shared/Toast'
import { ROLES } from '../../constants/roles'
import { getHomeRoute } from '../../utils/getHomeRoute'

const ROLE_GROUPS = [
  { label: 'Склад', roles: ['warehouse_director', 'warehouse_deputy', 'warehouse_staff'], color: 'blue' },
  { label: 'Режиссура', roles: ['director', 'first_assistant_director', 'assistant_director', 'project_director', 'project_deputy', 'project_deputy_upload', 'set_admin'], color: 'purple' },
  { label: 'Художники', roles: ['production_designer', 'art_director_assistant', 'decorator', 'props_master', 'props_assistant', 'costumer', 'costume_designer', 'costume_assistant', 'makeup_artist'], color: 'green' },
  { label: 'Трюки и эффекты', roles: ['stunt_coordinator', 'pyrotechnician'], color: 'orange' },
  { label: 'Камера и звук', roles: ['dop', 'gaffer', 'camera_mechanic', 'playback'], color: 'cyan' },
  { label: 'Прочие', roles: ['casting_director', 'casting_assistant', 'ams_assistant', 'location_manager', 'driver'], color: 'gray' },
]

const ALL_FILTER_ROLES = ROLE_GROUPS.flatMap(g => g.roles)

const WAREHOUSE_ROLES = ['warehouse_director', 'warehouse_deputy', 'warehouse_staff']
const PRODUCTION_ROLES = Object.keys(ROLES).filter(r => ROLES[r].world === 'production')

function getInviteRoleOptions(inviterRole) {
  if (inviterRole === 'producer') return [...WAREHOUSE_ROLES.filter(r => r !== 'warehouse_director'), ...PRODUCTION_ROLES]
  return []
}

export default function StaffPage() {
  const navigate = useNavigate()
  const { login, user } = useAuth()
  const toast = useToast()
  const [users, setUsers] = useState([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState('all')
  const [search, setSearch] = useState('')
  const [switching, setSwitching] = useState(null)

  // Invite modal
  const [showInvite, setShowInvite] = useState(false)
  const [inviteRole, setInviteRole] = useState('')
  const [generating, setGenerating] = useState(false)
  const [inviteLink, setInviteLink] = useState('')
  const [copied, setCopied] = useState(false)
  const [inviteError, setInviteError] = useState('')
  const inviteRoles = getInviteRoleOptions(user?.role)

  useEffect(() => {
    authApi.users()
      .then(data => setUsers(data.users || []))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  async function handleImpersonate(userId, role) {
    setSwitching(userId)
    try {
      // Save current producer session
      sessionStorage.setItem('producer_token', localStorage.getItem('token'))
      sessionStorage.setItem('producer_user', localStorage.getItem('user'))

      const data = await authApi.impersonate(userId)
      login(data.token, data.user)

      // Navigate to the target role's home
      const home = getHomeRoute(role)
      navigate(home)
      window.location.reload()
    } catch (e) {
      alert(e.message || 'Ошибка переключения')
      sessionStorage.removeItem('producer_token')
      sessionStorage.removeItem('producer_user')
    }
    setSwitching(null)
  }

  function openInvite() {
    setInviteRole(inviteRoles[0] || '')
    setInviteLink('')
    setCopied(false)
    setInviteError('')
    setShowInvite(true)
  }

  async function handleGenerate() {
    if (!inviteRole) return
    setGenerating(true)
    try {
      const data = await invitesApi.generate({
        role: inviteRole,
        project_id: user?.project_id || null,
        upload_rights: {},
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
      toast?.('Ссылка скопирована', 'success')
      setTimeout(() => setCopied(false), 2000)
    })
  }

  const filtered = users.filter(u => {
    if (filter !== 'all') {
      const group = ROLE_GROUPS.find(g => g.label === filter)
      if (group && !group.roles.includes(u.role)) return false
    }
    if (search) {
      const q = search.toLowerCase()
      if (!u.name?.toLowerCase().includes(q) && !u.email?.toLowerCase().includes(q)) return false
    }
    return true
  })

  return (
    <ProductionLayout>
      <div style={{ padding: '24px 32px', maxWidth: 800 }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 24, gap: 12 }}>
          <div>
            <h1 style={{ fontSize: 20, fontWeight: 600 }}>Сотрудники</h1>
            <p style={{ fontSize: 13, color: 'var(--muted)', marginTop: 2 }}>
              Переключитесь в интерфейс любого сотрудника
            </p>
          </div>
          {inviteRoles.length > 0 && (
            <Button onClick={openInvite} style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
              <UserPlus size={15} /> Пригласить
            </Button>
          )}
        </div>

        {/* Filters */}
        <div style={{ display: 'flex', gap: 6, marginBottom: 16, flexWrap: 'wrap' }}>
          {['all', ...ROLE_GROUPS.map(g => g.label)].map(f => (
            <button key={f} onClick={() => setFilter(f)} style={{
              padding: '6px 14px', borderRadius: 20, fontSize: 13, fontWeight: 500,
              border: `1px solid ${filter === f ? 'var(--accent)' : 'var(--border)'}`,
              background: filter === f ? 'var(--accent)' : 'var(--card)',
              color: filter === f ? '#fff' : 'var(--text)',
              cursor: 'pointer',
            }}>
              {f === 'all' ? 'Все' : f}
            </button>
          ))}
        </div>

        {/* Search */}
        <div style={{ position: 'relative', marginBottom: 20 }}>
          <input value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Найдите по имени или email..."
            style={{
              width: '100%', height: 40, padding: '0 14px',
              border: '1px solid var(--border)', borderRadius: 'var(--radius-btn)',
              fontSize: 13, outline: 'none', boxSizing: 'border-box',
            }} />
        </div>

        {loading ? (
          <div style={{ textAlign: 'center', padding: '40px 0', color: 'var(--muted)', fontSize: 14 }}>Загрузка...</div>
        ) : filtered.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '40px 0', color: 'var(--muted)', fontSize: 14 }}>Нет сотрудников</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {filtered.map(u => {
              const roleDef = ROLES[u.role] || {}
              const group = ROLE_GROUPS.find(g => g.roles.includes(u.role))
              return (
                <div key={u.id} style={{
                  display: 'flex', alignItems: 'center', gap: 14,
                  padding: '14px 16px', background: 'var(--card)',
                  border: '1px solid var(--border)', borderRadius: 'var(--radius-card)',
                }}>
                  {/* Avatar */}
                  <div style={{
                    width: 40, height: 40, borderRadius: '50%',
                    background: group?.color === 'blue' ? 'var(--blue-dim)' : group?.color === 'green' ? 'var(--green-dim)' : 'var(--bg)',
                    color: group?.color === 'blue' ? 'var(--blue)' : group?.color === 'green' ? 'var(--green)' : 'var(--muted)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 14, fontWeight: 600, flexShrink: 0,
                  }}>
                    {(u.name || '').split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase()}
                  </div>

                  {/* Info */}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 500, fontSize: 14 }}>{u.name}</div>
                    <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                      <span>{roleDef.label || u.role}</span>
                      {u.project_name && <span>· {u.project_name}</span>}
                    </div>
                  </div>

                  {/* Action */}
                  <Button variant="secondary"
                    style={{ height: 34, fontSize: 13, padding: '0 16px', flexShrink: 0 }}
                    disabled={switching === u.id}
                    onClick={() => handleImpersonate(u.id, u.role)}>
                    {switching === u.id ? '...' : 'Войти'}
                  </Button>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Invite Modal */}
      {showInvite && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 400, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}
          onClick={() => setShowInvite(false)}>
          <div style={{ background: 'var(--white)', borderRadius: 16, padding: 28, maxWidth: 480, width: '100%', maxHeight: '90vh', overflowY: 'auto' }}
            onClick={e => e.stopPropagation()}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
              <div style={{ fontWeight: 600, fontSize: 16 }}>Пригласить участника</div>
              <button onClick={() => setShowInvite(false)} style={{ border: 'none', background: 'none', cursor: 'pointer', color: 'var(--muted)', padding: 4 }}>
                <X size={18} />
              </button>
            </div>

            <div style={{ marginBottom: 16 }}>
              <div style={{ fontSize: 13, fontWeight: 500, marginBottom: 6 }}>Роль</div>
              <select value={inviteRole}
                onChange={e => { setInviteRole(e.target.value); setInviteLink('') }}
                style={{ width: '100%', height: 40, padding: '0 12px', border: '1px solid var(--border)', borderRadius: 'var(--radius-btn)', background: 'var(--white)', fontSize: 13, cursor: 'pointer' }}>
                {inviteRoles.map(r => (
                  <option key={r} value={r}>{ROLES[r]?.label || r}</option>
                ))}
              </select>
            </div>

            {inviteError && (
              <div style={{ color: 'var(--red)', fontSize: 13, marginBottom: 12, padding: '8px 12px', background: 'rgba(239,68,68,0.08)', borderRadius: 8 }}>
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
                  <div style={{ fontSize: 13, fontWeight: 500, marginBottom: 8 }}>Ссылка для приглашения</div>
                  <div style={{ background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 10, padding: 14, display: 'flex', alignItems: 'flex-start', gap: 10 }}>
                    <span style={{ flex: 1, fontFamily: 'monospace', fontSize: 12, color: 'var(--text)', wordBreak: 'break-all' }}>{inviteLink}</span>
                    <button onClick={copyLink} style={{
                      flexShrink: 0, width: 32, height: 32, borderRadius: 8,
                      background: 'var(--accent-dim)', color: 'var(--accent)',
                      border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
                    }}>
                      {copied ? <Check size={14} /> : <Copy size={14} />}
                    </button>
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 6 }}>Ссылка одноразовая — действует до первой регистрации</div>
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <Button variant="secondary" fullWidth onClick={() => setInviteLink('')}>Новая ссылка</Button>
                  <Button fullWidth onClick={() => setShowInvite(false)}>Готово</Button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </ProductionLayout>
  )
}
