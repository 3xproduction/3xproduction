// Claim-flow: provisional-юзер (заведён складом через walk-in выдачу) ставит
// пароль и получает JWT для работы в системе.
//
// Шаг 1: GET /auth/claim/:token → показываем имя/роль/проект юзеру (read-only),
//        даём поле для пароля + поле для email (если склад его не указал).
// Шаг 2: POST /auth/claim/:token { password, email? } → JWT, login, redirect home.
import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import AuthLayout from './AuthLayout'
import Input from '../shared/Input'
import Button from '../shared/Button'
import { ROLES } from '../../constants/roles'
import { auth as authApi } from '../../services/api'
import { useAuth } from '../../hooks/useAuth'
import { getHomeRoute } from '../../utils/getHomeRoute'

export default function ClaimPage() {
  const { token } = useParams()
  const navigate = useNavigate()
  const { login } = useAuth()

  const [info, setInfo] = useState(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')

  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [email, setEmail] = useState('')
  const [errors, setErrors] = useState({})
  const [submitting, setSubmitting] = useState(false)
  const [apiError, setApiError] = useState('')

  useEffect(() => {
    authApi.claimGet(token)
      .then(setInfo)
      .catch(err => setLoadError(err?.message || 'Ссылка недействительна или истекла'))
      .finally(() => setLoading(false))
  }, [token])

  if (loading) {
    return <AuthLayout><div style={{ textAlign: 'center', padding: '40px 0', color: 'var(--muted)' }}>Загрузка…</div></AuthLayout>
  }

  if (loadError || !info) {
    return (
      <AuthLayout>
        <div style={{ textAlign: 'center', padding: '20px 0', color: 'var(--red)', fontSize: 14 }}>
          {loadError || 'Ссылка недействительна'}
        </div>
        <Button fullWidth variant="secondary" onClick={() => navigate('/login')} style={{ marginTop: 12 }}>
          На страницу входа
        </Button>
      </AuthLayout>
    )
  }

  function validate() {
    const e = {}
    if (password.length < 8) e.password = 'Минимум 8 символов'
    if (password !== confirm) e.confirm = 'Пароли не совпадают'
    if (!info.email && (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))) {
      e.email = 'Введите корректный email'
    }
    return e
  }

  async function handleSubmit(ev) {
    ev.preventDefault()
    const e = validate()
    if (Object.keys(e).length) { setErrors(e); return }
    setErrors({})
    setApiError('')
    setSubmitting(true)
    try {
      const data = await authApi.claimSet(token, password, info.email ? undefined : email)
      login(data.token, data.user)
      navigate(getHomeRoute(data.user.role))
    } catch (err) {
      setApiError(err?.message || 'Не удалось активировать аккаунт')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <AuthLayout>
      <h2 style={{ fontSize: 18, fontWeight: 600, marginBottom: 8, textAlign: 'center' }}>
        Активация аккаунта
      </h2>
      <p style={{ fontSize: 13, color: 'var(--muted)', textAlign: 'center', marginBottom: 24 }}>
        Установите пароль чтобы войти в систему
      </p>

      <div style={{
        background: 'var(--bg-secondary, #f7f7f7)',
        borderRadius: 'var(--radius-card)',
        padding: 14,
        marginBottom: 20,
      }}>
        <Row label="ФИО"     value={info.name} />
        <Row label="Роль"    value={ROLES[info.role]?.label || info.role} />
        {info.project_name && <Row label="Проект" value={info.project_name} />}
        {info.email && <Row label="Email" value={info.email} last />}
      </div>

      <form onSubmit={handleSubmit}>
        {!info.email && (
          <Input
            label="Email"
            type="email"
            placeholder="you@example.com"
            value={email}
            onChange={e => setEmail(e.target.value)}
            error={errors.email}
          />
        )}
        <Input
          label="Пароль"
          type="password"
          placeholder="••••••••"
          value={password}
          onChange={e => setPassword(e.target.value)}
          error={errors.password}
        />
        <Input
          label="Подтверждение пароля"
          type="password"
          placeholder="••••••••"
          value={confirm}
          onChange={e => setConfirm(e.target.value)}
          error={errors.confirm}
        />

        {apiError && (
          <div style={{ color: 'var(--red)', fontSize: 13, marginBottom: 12, textAlign: 'center' }}>
            {apiError}
          </div>
        )}

        <Button type="submit" fullWidth loading={submitting} style={{ marginTop: 4 }}>
          Активировать
        </Button>
      </form>
    </AuthLayout>
  )
}

function Row({ label, value, last }) {
  return (
    <div style={{
      display: 'flex', justifyContent: 'space-between', alignItems: 'center',
      paddingBottom: last ? 0 : 8, marginBottom: last ? 0 : 8,
      borderBottom: last ? 'none' : '1px solid var(--border)',
    }}>
      <span style={{ color: 'var(--muted)', fontSize: 13 }}>{label}</span>
      <span style={{ fontWeight: 500, fontSize: 13 }}>{value}</span>
    </div>
  )
}
