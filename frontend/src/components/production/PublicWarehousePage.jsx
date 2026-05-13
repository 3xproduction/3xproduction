import { useState, useEffect, useCallback, useRef } from 'react'
import { useParams } from 'react-router-dom'
import { ShoppingCart, X, Minus, Plus, ChevronDown, ChevronUp, Package, Clock, CheckCircle, RotateCcw, User, FileText, ZoomIn, ClipboardList, LayoutGrid, Settings, LogOut } from 'lucide-react'
import Badge from '../shared/Badge'
import Button from '../shared/Button'
import Lightbox from '../shared/Lightbox'
import TriixLogo from '../shared/TriixLogo'
import PublicUnitCardModal from '../shared/PublicUnitCardModal'
import { categoryLabel } from '../../constants/categories'
import { STATUS_LABEL, STATUS_COLOR } from '../../constants/statuses'

const BASE = import.meta.env.VITE_API_URL || (['5173', '4173'].includes(location.port) ? `${location.protocol}//${location.hostname}:3000` : '')

// Вкладки кабинета — зеркалят фильтры RequestsProductionPage у директора площадки.
const CABINET_TABS = [
  { key: 'catalog',  label: 'Каталог',       icon: LayoutGrid },
  { key: 'all',      label: 'Все',           icon: ClipboardList },
  { key: 'new',      label: 'Новые заявки',  icon: Clock },
  { key: 'received', label: 'Получили',      icon: CheckCircle },
  { key: 'returned', label: 'Вернули',       icon: RotateCcw },
  { key: 'profile',  label: 'Профиль',       icon: Settings },
]

// Статусы сделки → бренд-бейдж.
const DEAL_STATUS = {
  pending_review: { label: 'Новый',        color: 'blue' },
  active:         { label: 'Получен',      color: 'green' },
  done:           { label: 'Вернули',      color: 'muted' },
  cancelled:      { label: 'Отклонён',     color: 'red' },
  overdue:        { label: 'Просрочено',   color: 'red' },
}

// Статус workflow_stage внутри pending_review — для показа этапа обработки
// со стороны склада. null = только что поступила, collecting = собирается,
// ready = готово к выдаче.
const STAGE_STATUS = {
  null:       { label: 'Новый',    color: 'blue' },
  collecting: { label: 'Собирают', color: 'amber' },
  ready:      { label: 'Готов',    color: 'green' },
}

function loadSession(token) {
  try {
    const raw = sessionStorage.getItem(`pub_session_${token}`)
    if (raw) return JSON.parse(raw)
  } catch { /* ignore */ }
  return null
}

function saveSession(token, data) {
  try { sessionStorage.setItem(`pub_session_${token}`, JSON.stringify(data)) } catch { /* ignore */ }
}

export default function PublicWarehousePage() {
  const { token } = useParams()
  const saved = loadSession(token)

  // auth: login | register | recover-request | recover-reset
  const [step, setStep] = useState(saved ? 'cabinet' : 'auth')
  const [authMode, setAuthMode] = useState('login')
  const [cpType, setCpType] = useState(saved?.cpType || 'person')
  const [form, setForm] = useState(saved?.form || { name: '', phone: '', email: '', password: '', project_name: '', inn: '', legal_address: '', extra_contact: '' })
  const [passwordConfirm, setPasswordConfirm] = useState('')
  const [recoverEmail, setRecoverEmail] = useState('')
  const [recoverCode, setRecoverCode] = useState('')
  const [recoverNewPassword, setRecoverNewPassword] = useState('')
  const [recoverNewPasswordConfirm, setRecoverNewPasswordConfirm] = useState('')
  const [recoverSent, setRecoverSent] = useState(false)
  const [authLoading, setAuthLoading] = useState(false)
  const [units, setUnits] = useState([])
  const [loadError, setLoadError] = useState(null)
  const [search, setSearch] = useState('')
  const [category, setCategory] = useState('Все')

  // Сохраняем активную вкладку в sessionStorage, чтобы при обновлении страницы
  // пользователя не перекидывало со страницы «Получены» на каталог.
  const [cabTab, setCabTab] = useState(() => {
    try {
      const v = sessionStorage.getItem(`public_tab_${token}`)
      if (v && ['catalog', 'all', 'new', 'received', 'returned', 'profile'].includes(v)) return v
    } catch {}
    return 'catalog'
  })
  useEffect(() => {
    try { sessionStorage.setItem(`public_tab_${token}`, cabTab) } catch {}
  }, [cabTab, token])
  const [deals, setDeals] = useState([])
  const [dealsLoading, setDealsLoading] = useState(false)

  const [cart, setCart] = useState([])
  const [showCart, setShowCart] = useState(false)
  const [cartMessage, setCartMessage] = useState('')
  const [periodStart, setPeriodStart] = useState('')
  const [periodEnd, setPeriodEnd] = useState('')
  const [sending, setSending] = useState(false)

  const [showConfirm, setShowConfirm] = useState(false)
  const [showSuccess, setShowSuccess] = useState(false)
  const [authError, setAuthError] = useState('')
  const [selectedUnit, setSelectedUnit] = useState(null)
  const [activePhoto, setActivePhoto] = useState(0)
  const [lightbox, setLightbox] = useState(null)
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [allCategories, setAllCategories] = useState([])
  const searchTimer = useRef(null)
  // Режим просмотра каталога — как у директора площадки (grid/rows/list).
  const [viewMode, setViewMode] = useState(() => localStorage.getItem('unitsViewMode') || 'grid')

  const phoneValid = /^\+7\s?\d{3}\s?\d{3}\s?\d{2}\s?\d{2}$/.test(form.phone.trim()) || /^\+7\d{10}$/.test(form.phone.replace(/\s/g, ''))
  const emailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)
  const innValid = cpType !== 'company' || (form.inn.length === 10 || form.inn.length === 12)
  const passwordValid = form.password.length >= 6
  const passwordsMatch = form.password === passwordConfirm && passwordValid
  const canRegister = form.name && emailValid && passwordValid && passwordsMatch && form.phone && phoneValid && innValid
  const canLogin = emailValid && passwordValid

  // Debounce search
  useEffect(() => {
    clearTimeout(searchTimer.current)
    searchTimer.current = setTimeout(() => setDebouncedSearch(search), 300)
    return () => clearTimeout(searchTimer.current)
  }, [search])

  // Fetch units from server with search/category params
  useEffect(() => {
    const params = new URLSearchParams()
    if (debouncedSearch.trim()) params.set('search', debouncedSearch.trim())
    if (category && category !== 'Все') params.set('category', category)
    const qs = params.toString()
    fetch(`${BASE}/public/warehouse/${token}${qs ? '?' + qs : ''}`)
      .then(r => {
        if (r.status === 404) throw new Error('invalid_token')
        return r.json()
      })
      .then(d => {
        if (d.error && !debouncedSearch && category === 'Все') { setLoadError(d.error); return }
        if (d.error) { setUnits([]); return }
        setUnits(d.units || [])
        if (!debouncedSearch && category === 'Все') {
          setAllCategories(['Все', ...new Set((d.units || []).map(u => u.category).filter(Boolean))])
        }
      })
      .catch(e => {
        if (e.message === 'invalid_token') setLoadError('Invalid or expired link')
        else if (!debouncedSearch) setLoadError('Не удалось загрузить каталог')
      })
  }, [token, debouncedSearch, category])

  const loadDeals = useCallback(() => {
    if (!form.phone) return
    setDealsLoading(true)
    fetch(`${BASE}/public/warehouse/${token}/my-deals?phone=${encodeURIComponent(form.phone)}`)
      .then(r => r.json())
      .then(d => setDeals(d.deals || []))
      .catch(() => {})
      .finally(() => setDealsLoading(false))
  }, [token, form.phone])

  useEffect(() => {
    if (step === 'cabinet') loadDeals()
  }, [step, cabTab, loadDeals])

  const categories = allCategories.length > 0 ? allCategories : ['Все', ...new Set(units.map(u => u.category).filter(Boolean))]
  const filtered = units

  const inCart = id => cart.includes(id)
  const toggleCart = id => setCart(prev => inCart(id) ? prev.filter(x => x !== id) : [...prev, id])
  const cartUnits = units.filter(u => cart.includes(u.id))

  function set(f) { return e => setForm(p => ({ ...p, [f]: e.target.value })) }

  async function doLogin() {
    setAuthError('')
    setAuthLoading(true)
    try {
      const res = await fetch(`${BASE}/public/warehouse/${token}/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: form.email, password: form.password }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Ошибка входа')
      const merged = {
        ...form,
        name: data.user.name, phone: data.user.phone || form.phone,
        email: data.user.email, project_name: data.user.project_name || form.project_name,
        inn: data.user.inn || '', legal_address: data.user.legal_address || '',
        extra_contact: data.user.extra_contact || '',
      }
      setForm(merged)
      setCpType(data.user.counterparty_type || 'person')
      saveSession(token, { form: merged, cpType: data.user.counterparty_type || 'person' })
      setStep('cabinet')
    } catch (err) {
      setAuthError(err.message)
    } finally {
      setAuthLoading(false)
    }
  }

  async function doRegister() {
    if (!canRegister) {
      if (!form.name) setAuthError('Укажите имя')
      else if (!emailValid) setAuthError('Некорректный email')
      else if (!passwordValid) setAuthError('Пароль — минимум 6 символов')
      else if (!passwordsMatch) setAuthError('Пароли не совпадают')
      else if (!phoneValid) setAuthError('Формат телефона: +7 XXX XXX XX XX')
      else if (!innValid) setAuthError('ИНН должен содержать 10 или 12 цифр')
      return
    }
    setAuthError('')
    setAuthLoading(true)
    try {
      const res = await fetch(`${BASE}/public/warehouse/${token}/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: form.email, password: form.password, name: form.name,
          phone: form.phone, counterparty_type: cpType,
          inn: cpType === 'company' ? form.inn : null,
          legal_address: cpType === 'company' ? form.legal_address : null,
          project_name: form.project_name || null,
          extra_contact: form.extra_contact || null,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Ошибка регистрации')
      saveSession(token, { form, cpType })
      setStep('cabinet')
    } catch (err) {
      setAuthError(err.message)
    } finally {
      setAuthLoading(false)
    }
  }

  async function doRecoverRequest() {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recoverEmail)) {
      setAuthError('Некорректный email'); return
    }
    setAuthError('')
    setAuthLoading(true)
    try {
      await fetch(`${BASE}/public/warehouse/${token}/recover/request`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: recoverEmail }),
      })
      setRecoverSent(true)
      setAuthMode('recover-reset')
    } catch (err) {
      setAuthError(err.message || 'Ошибка')
    } finally {
      setAuthLoading(false)
    }
  }

  async function doRecoverReset() {
    if (recoverCode.length !== 6) { setAuthError('Код — 6 цифр'); return }
    if (recoverNewPassword.length < 6) { setAuthError('Пароль — минимум 6 символов'); return }
    if (recoverNewPassword !== recoverNewPasswordConfirm) { setAuthError('Пароли не совпадают'); return }
    setAuthError('')
    setAuthLoading(true)
    try {
      const res = await fetch(`${BASE}/public/warehouse/${token}/recover/reset`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: recoverEmail, code: recoverCode, password: recoverNewPassword }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Ошибка')
      // Автологин после сброса
      setForm(p => ({ ...p, email: recoverEmail, password: recoverNewPassword }))
      setAuthMode('login')
      setRecoverCode(''); setRecoverNewPassword(''); setRecoverSent(false)
      setAuthError('Пароль обновлён — войдите с новым паролем')
    } catch (err) {
      setAuthError(err.message)
    } finally {
      setAuthLoading(false)
    }
  }

  function logout() {
    sessionStorage.removeItem(`pub_session_${token}`)
    setStep('auth')
    setDeals([])
    setCabTab('catalog')
  }

  function openConfirm() {
    setShowCart(false)
    setShowConfirm(true)
  }

  async function submitCart() {
    setSending(true)
    try {
      const res = await fetch(`${BASE}/public/warehouse/${token}/cart-request`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: form.name, phone: form.phone, email: form.email || undefined,
          project_name: form.project_name || undefined,
          counterparty_type: cpType,
          inn: cpType === 'company' ? form.inn : undefined,
          legal_address: cpType === 'company' ? form.legal_address : undefined,
          extra_contact: form.extra_contact || undefined,
          unit_ids: cart, period_start: periodStart || undefined, period_end: periodEnd || undefined,
          message: cartMessage || undefined,
        }),
      })
      if (!res.ok) throw new Error()
      setShowConfirm(false)
      setShowSuccess(true)
      setTimeout(() => {
        setShowSuccess(false)
        setCart([]); setCartMessage(''); setPeriodStart(''); setPeriodEnd('')
        // После отправки → вкладка «Новые заявки» (ключ 'new' в CABINET_TABS).
        // Раньше переключали на 'pending' — такого ключа нет, получали белый экран.
        setCabTab('new')
        loadDeals()
      }, 2000)
    } catch {
      alert('Ошибка при отправке заявки')
    } finally {
      setSending(false)
    }
  }

  const filteredDeals = deals.filter(d => {
    if (cabTab === 'all')      return true
    if (cabTab === 'new')      return d.status === 'pending_review'
    if (cabTab === 'received') return d.status === 'active' || d.status === 'overdue'
    if (cabTab === 'returned') return d.status === 'done' || d.status === 'cancelled'
    return false
  })

  const currentTabTitle = CABINET_TABS.find(t => t.key === cabTab)?.label || 'Кабинет'

  return (
    <div style={{ minHeight: '100vh', background: 'var(--paper)', fontFamily: 'Inter, sans-serif' }}>
      {/* Header только на шагах авторизации — в кабинете работает rail+topbar */}
      {step === 'auth' && (
        <div style={{
          background: 'var(--ink-950)',
          padding: '12px 24px', display: 'flex', alignItems: 'center', gap: 14,
          borderBottom: '1px solid rgba(184,147,90,0.22)',
        }}>
          <TriixLogo size={36} variant="icon" />
          <div style={{
            fontSize: 11, letterSpacing: '0.18em', textTransform: 'uppercase',
            color: 'var(--gold-400)', fontWeight: 600,
          }}>
            ТРИИКС МЕДИА · ПАРТНЁРСКАЯ
          </div>
        </div>
      )}

      {loadError && (
        <div style={{ textAlign: 'center', padding: '80px 24px' }}>
          <div style={{ fontSize: 52, marginBottom: 16 }}>❌</div>
          <h2 style={{ fontSize: 18, fontWeight: 600, marginBottom: 8 }}>Ссылка недействительна</h2>
          <p style={{ color: 'var(--muted)', fontSize: 14 }}>{loadError}</p>
        </div>
      )}

      {/* ─── AUTH ─── */}
      {!loadError && step === 'auth' && (
        <div style={{ maxWidth: 440, margin: '0 auto', padding: '48px 24px' }}>
          <div style={{
            background: 'var(--white)', borderRadius: 14,
            border: '1px solid var(--border)',
            padding: '36px 32px',
            boxShadow: '0 16px 40px rgba(0,0,0,0.06), 0 2px 8px rgba(0,0,0,0.04)',
          }}>
            <div style={{ textAlign: 'center', marginBottom: 24 }}>
              <div style={{ display: 'inline-block', marginBottom: 12 }}>
                <TriixLogo size={56} variant="full" />
              </div>
              <h1 style={{ fontSize: 18, fontWeight: 600, marginBottom: 6 }}>
                {authMode === 'login' && 'Вход в каталог'}
                {authMode === 'register' && 'Регистрация'}
                {authMode === 'recover-request' && 'Восстановление пароля'}
                {authMode === 'recover-reset' && 'Новый пароль'}
              </h1>
              <p style={{ fontSize: 13, color: 'var(--muted)' }}>
                {authMode === 'login' && 'Введите email и пароль для входа в личный кабинет'}
                {authMode === 'register' && 'Создайте аккаунт, чтобы подавать заявки на аренду'}
                {authMode === 'recover-request' && 'Введите email — отправим код для сброса пароля'}
                {authMode === 'recover-reset' && `Введите код из письма${recoverSent ? ' (отправили на ' + recoverEmail + ')' : ''}`}
              </p>
            </div>

            {/* LOGIN */}
            {authMode === 'login' && (
              <>
                <FI label="Email *" value={form.email} onChange={set('email')} placeholder="email@example.com" type="email" />
                <FI label="Пароль *" value={form.password} onChange={set('password')} placeholder="Минимум 6 символов" type="password" />
                {authError && <div style={{ color: 'var(--red)', fontSize: 13, marginBottom: 8 }}>{authError}</div>}
                <Button fullWidth disabled={!canLogin || authLoading} onClick={doLogin} style={{ marginTop: 8 }}>
                  {authLoading ? 'Вход...' : 'Войти'}
                </Button>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 14, fontSize: 13 }}>
                  <button onClick={() => { setAuthMode('register'); setAuthError('') }}
                    style={{ background: 'none', border: 'none', color: 'var(--accent)', cursor: 'pointer', padding: 0, fontFamily: 'inherit' }}>
                    Создать аккаунт
                  </button>
                  <button onClick={() => { setAuthMode('recover-request'); setAuthError(''); setRecoverEmail(form.email) }}
                    style={{ background: 'none', border: 'none', color: 'var(--muted)', cursor: 'pointer', padding: 0, fontFamily: 'inherit' }}>
                    Забыли пароль?
                  </button>
                </div>
              </>
            )}

            {/* REGISTER */}
            {authMode === 'register' && (
              <>
                <div style={{ display: 'flex', gap: 0, marginBottom: 16 }}>
                  {[['person', 'Физлицо'], ['company', 'Компания']].map(([val, label]) => (
                    <button key={val} onClick={() => setCpType(val)} style={{
                      flex: 1, padding: '9px 0', fontSize: 13, fontWeight: 500, cursor: 'pointer',
                      border: `1px solid ${cpType === val ? 'var(--accent)' : 'var(--border)'}`,
                      background: cpType === val ? 'var(--accent)' : 'var(--white)',
                      color: cpType === val ? '#fff' : 'var(--muted)',
                      borderRadius: val === 'person' ? 'var(--radius-btn) 0 0 var(--radius-btn)' : '0 var(--radius-btn) var(--radius-btn) 0',
                    }}>{label}</button>
                  ))}
                </div>

                <FI label="Email *" value={form.email} onChange={set('email')} placeholder="email@example.com" type="email" />
                <FI label="Пароль *" value={form.password} onChange={set('password')} placeholder="Минимум 6 символов" type="password" />
                <FI label="Повторите пароль *" value={passwordConfirm} onChange={e => setPasswordConfirm(e.target.value)} placeholder="Повторите тот же пароль" type="password"
                  error={passwordConfirm && form.password !== passwordConfirm ? 'Пароли не совпадают' : ''} />
                <FI label={cpType === 'company' ? 'Название компании *' : 'ФИО *'} value={form.name} onChange={set('name')} placeholder={cpType === 'company' ? 'ООО Рога и Копыта' : 'Иван Иванов'} />
                <PhoneInput label="Телефон *" value={form.phone} onChange={v => setForm(p => ({ ...p, phone: v }))} />
                <FI label="Название проекта" value={form.project_name} onChange={set('project_name')} placeholder="Мой проект" />
                {cpType === 'company' && (
                  <>
                    <InnInput value={form.inn}
                      onChange={v => setForm(p => ({ ...p, inn: v }))}
                      onCompanyFound={data => {
                        if (data.name) setForm(p => ({ ...p, name: data.name, legal_address: data.address || p.legal_address }))
                      }} />
                    <FI label="Юридический адрес" value={form.legal_address} onChange={set('legal_address')} placeholder="г. Москва, ул. ..." />
                  </>
                )}
                {authError && <div style={{ color: 'var(--red)', fontSize: 13, marginBottom: 8 }}>{authError}</div>}
                <Button fullWidth disabled={!canRegister || authLoading} onClick={doRegister} style={{ marginTop: 8 }}>
                  {authLoading ? 'Регистрация...' : 'Создать аккаунт'}
                </Button>
                <div style={{ textAlign: 'center', marginTop: 14, fontSize: 13, color: 'var(--muted)' }}>
                  Уже есть аккаунт?{' '}
                  <button onClick={() => { setAuthMode('login'); setAuthError('') }}
                    style={{ background: 'none', border: 'none', color: 'var(--accent)', cursor: 'pointer', padding: 0, fontFamily: 'inherit' }}>
                    Войти
                  </button>
                </div>
              </>
            )}

            {/* RECOVER REQUEST */}
            {authMode === 'recover-request' && (
              <>
                <FI label="Email *" value={recoverEmail} onChange={e => setRecoverEmail(e.target.value)} placeholder="email@example.com" type="email" />
                {authError && <div style={{ color: 'var(--red)', fontSize: 13, marginBottom: 8 }}>{authError}</div>}
                <Button fullWidth disabled={authLoading} onClick={doRecoverRequest} style={{ marginTop: 8 }}>
                  {authLoading ? 'Отправка...' : 'Отправить код'}
                </Button>
                <div style={{ textAlign: 'center', marginTop: 14, fontSize: 13 }}>
                  <button onClick={() => { setAuthMode('login'); setAuthError('') }}
                    style={{ background: 'none', border: 'none', color: 'var(--accent)', cursor: 'pointer', padding: 0, fontFamily: 'inherit' }}>
                    Назад ко входу
                  </button>
                </div>
              </>
            )}

            {/* RECOVER RESET */}
            {authMode === 'recover-reset' && (
              <>
                <FI label="Email *" value={recoverEmail} onChange={e => setRecoverEmail(e.target.value)} placeholder="email@example.com" type="email" />
                <FI label="Код из письма (6 цифр) *" value={recoverCode} onChange={e => setRecoverCode(e.target.value.replace(/\D/g, '').slice(0, 6))} placeholder="123456" />
                <FI label="Новый пароль *" value={recoverNewPassword} onChange={e => setRecoverNewPassword(e.target.value)} placeholder="Минимум 6 символов" type="password" />
                <FI label="Повторите пароль *" value={recoverNewPasswordConfirm} onChange={e => setRecoverNewPasswordConfirm(e.target.value)} placeholder="Повторите тот же пароль" type="password"
                  error={recoverNewPasswordConfirm && recoverNewPassword !== recoverNewPasswordConfirm ? 'Пароли не совпадают' : ''} />
                {authError && <div style={{ color: 'var(--red)', fontSize: 13, marginBottom: 8 }}>{authError}</div>}
                <Button fullWidth disabled={authLoading} onClick={doRecoverReset} style={{ marginTop: 8 }}>
                  {authLoading ? 'Обновление...' : 'Установить пароль'}
                </Button>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 14, fontSize: 13 }}>
                  <button onClick={() => { setAuthMode('recover-request'); setAuthError('') }}
                    style={{ background: 'none', border: 'none', color: 'var(--muted)', cursor: 'pointer', padding: 0, fontFamily: 'inherit' }}>
                    Получить новый код
                  </button>
                  <button onClick={() => { setAuthMode('login'); setAuthError('') }}
                    style={{ background: 'none', border: 'none', color: 'var(--accent)', cursor: 'pointer', padding: 0, fontFamily: 'inherit' }}>
                    Ко входу
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* ─── CABINET (rail + topbar один-в-один с WarehouseLayout) ─── */}
      {step === 'cabinet' && (
        <>
          {/* Rail (64px) — TriixLogo, иконки вкладок, аватар внизу */}
          <aside style={{
            position: 'fixed', top: 0, left: 0, bottom: 0, width: 64,
            background: 'var(--ink-950)',
            display: 'flex', flexDirection: 'column', alignItems: 'center',
            padding: '12px 0 10px', zIndex: 100,
            borderRight: '1px solid rgba(184,147,90,0.22)',
          }}>
            <div style={{
              width: 44, height: 44,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              marginBottom: 14, cursor: 'pointer', borderRadius: 10,
            }} onClick={() => setCabTab('catalog')} title="Каталог">
              <TriixLogo size={30} variant="icon" />
            </div>
            <nav style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, width: '100%' }}>
              {CABINET_TABS.map(t => {
                const Icon = t.icon
                const active = cabTab === t.key
                const count = t.key === 'all' ? deals.length
                  : t.key === 'new' ? deals.filter(d => d.status === 'pending_review').length
                  : t.key === 'received' ? deals.filter(d => d.status === 'active' || d.status === 'overdue').length
                  : t.key === 'returned' ? deals.filter(d => d.status === 'done' || d.status === 'cancelled').length : 0
                return (
                  <button key={t.key} onClick={() => setCabTab(t.key)}
                    className={`pub-rail-btn${active ? ' active' : ''}`}>
                    <Icon size={20} strokeWidth={1.8} />
                    {active && <span className="pub-rail-accent" />}
                    {count > 0 && (t.key === 'new' || t.key === 'received' || t.key === 'returned') && (
                      <span className="pub-rail-count">{count}</span>
                    )}
                    <span className="pub-rail-tip">{t.label}</span>
                  </button>
                )
              })}
            </nav>
            <div style={{
              width: 36, height: 36, borderRadius: '50%',
              background: 'var(--gold-500)', color: 'var(--ink-900)',
              fontSize: 13, fontWeight: 700,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              cursor: 'pointer',
            }} onClick={() => setCabTab('profile')} title={form.name || 'Профиль'}>
              {(form.name || '?').charAt(0).toUpperCase()}
            </div>
          </aside>

          {/* Topbar (56px) — как у директора склада */}
          <div style={{
            position: 'fixed', top: 0, left: 64, right: 0, height: 56,
            background: 'var(--ink-950)',
            borderBottom: '1px solid rgba(184,147,90,0.22)',
            display: 'flex', alignItems: 'center',
            padding: '0 24px', gap: 16, zIndex: 90,
          }}>
            <div style={{
              fontSize: 14, fontWeight: 600, color: '#fff',
              letterSpacing: '-0.01em',
            }}>
              {currentTabTitle}
            </div>
            <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 14 }}>
              <span style={{ fontSize: 13, color: 'rgba(255,255,255,0.6)' }}>{form.name}</span>
              <button onClick={logout} style={{
                fontSize: 12, color: 'var(--gold-400)', background: 'none',
                border: '1px solid rgba(184,147,90,0.4)', borderRadius: 8,
                cursor: 'pointer', padding: '6px 12px', fontFamily: 'inherit',
                display: 'inline-flex', alignItems: 'center', gap: 6,
              }}>
                <LogOut size={13} strokeWidth={1.8} /> Выйти
              </button>
            </div>
          </div>

          <style>{`
            .pub-rail-btn {
              position: relative;
              width: 44px; height: 44px;
              display: flex; align-items: center; justify-content: center;
              background: transparent; border: none; border-radius: 10px;
              color: rgba(255,255,255,0.55);
              cursor: pointer; font-family: inherit;
              transition: background 0.12s, color 0.12s;
            }
            .pub-rail-btn:hover { background: rgba(255,255,255,0.06); color: #fff; }
            .pub-rail-btn.active {
              background: rgba(184,147,90,0.14);
              color: var(--gold-400);
            }
            .pub-rail-btn.active:hover { background: rgba(184,147,90,0.2); color: var(--gold-400); }
            .pub-rail-accent {
              position: absolute; left: -10px; top: 12px; bottom: 12px;
              width: 3px; background: var(--gold-500);
              border-radius: 0 3px 3px 0;
            }
            .pub-rail-count {
              position: absolute; top: 5px; right: 5px;
              background: var(--gold-500); color: var(--ink-900);
              border-radius: 10px; padding: 1px 5px;
              font-size: 10px; font-weight: 700; min-width: 14px; text-align: center;
              font-variant-numeric: tabular-nums;
            }
            .pub-rail-tip {
              position: absolute; left: calc(100% + 10px); top: 50%;
              transform: translateY(-50%);
              background: var(--ink-800); color: #fff;
              font-size: 12px; font-weight: 500; padding: 6px 10px;
              border-radius: 6px; white-space: nowrap;
              opacity: 0; pointer-events: none;
              transition: opacity 0.12s; z-index: 300;
              box-shadow: 0 4px 12px rgba(0,0,0,0.3);
            }
            .pub-rail-btn:hover .pub-rail-tip { opacity: 1; }
            @media (max-width: 768px) {
              .pub-rail-tip { display: none; }
            }
          `}</style>

          {/* Main content — сдвинут на 64px rail + 56px topbar */}
          <div style={{
            marginLeft: 64, paddingTop: 56,
            minHeight: '100vh',
          }}>
            <div style={{ padding: '24px 32px' }}>

            {/* ── Catalog — 1-в-1 с WarehouseViewPage (поиск + селект категорий
                   + счётчик + режимы просмотра grid/rows/list) ── */}
            {cabTab === 'catalog' && (
              <div>
                <h1 style={{ fontSize: 26, fontWeight: 600, marginBottom: 6, letterSpacing: '-0.02em' }}>Каталог</h1>
                <p style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 20 }}>Выберите позиции и добавьте в корзину</p>

                {/* Поисково-фильтровая панель в стиле WarehouseViewPage */}
                <div style={{ display: 'flex', gap: 10, marginBottom: 20, flexWrap: 'wrap', alignItems: 'center' }}>
                  <div style={{ position: 'relative', flex: 1, minWidth: 200 }}>
                    <span style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--muted)' }}>🔍</span>
                    <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Найдите..."
                      style={{
                        width: '100%', height: 40, padding: '0 12px 0 36px',
                        border: '1px solid var(--border)', borderRadius: 'var(--radius-btn)',
                        fontSize: 14, background: 'var(--white)', outline: 'none', boxSizing: 'border-box',
                      }} />
                  </div>
                  <select value={category} onChange={e => setCategory(e.target.value)} style={{
                    height: 40, padding: '0 12px', border: '1px solid var(--border)',
                    borderRadius: 'var(--radius-btn)', fontSize: 13, background: 'var(--white)', cursor: 'pointer',
                  }}>
                    {categories.map(c => (
                      <option key={c} value={c}>{c === 'Все' ? 'Категория' : categoryLabel(c)}</option>
                    ))}
                  </select>
                  <span style={{ fontSize: 13, color: 'var(--muted)' }}>{filtered.length} ед.</span>
                  <div style={{ display: 'flex', gap: 2 }}>
                    {[
                      { mode: 'grid', icon: '▦', title: 'Карточки' },
                      { mode: 'rows', icon: '☰', title: 'Строки' },
                      { mode: 'list', icon: '≡', title: 'Список' },
                    ].map(v => (
                      <button key={v.mode} title={v.title}
                        onClick={() => { setViewMode(v.mode); localStorage.setItem('unitsViewMode', v.mode) }}
                        style={{
                          width: 32, height: 32, border: '1px solid var(--border)', borderRadius: 'var(--radius-btn)',
                          background: viewMode === v.mode ? 'var(--accent)' : 'var(--white)',
                          color: viewMode === v.mode ? '#fff' : 'var(--muted)',
                          fontSize: 16, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
                        }}>{v.icon}</button>
                    ))}
                  </div>
                </div>

                {filtered.length === 0 && (
                  <div style={{ textAlign: 'center', padding: '40px 0', color: 'var(--muted)', fontSize: 14 }}>Ничего не найдено</div>
                )}

                {/* Grid — как у директора площадки */}
                {viewMode === 'grid' && (
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(170px, 1fr))', gap: 12 }}>
                    {filtered.map(u => {
                      const added = inCart(u.id)
                      const available = u.status === 'on_stock'
                      return (
                        <div key={u.id} onClick={() => setSelectedUnit(u)} style={{
                          background: 'var(--card)', borderRadius: 'var(--radius-card)',
                          border: '1px solid var(--border)', cursor: 'pointer', overflow: 'hidden',
                        }}>
                          <div style={{ aspectRatio: '1', background: 'var(--bg)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 40, overflow: 'hidden' }}>
                            {u.photos?.[0]
                              ? /\.(mp4|webm|mov)$/i.test(u.photos[0])
                                ? <video src={u.photos[0]} muted preload="metadata" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                                : <img src={u.photos[0]} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                              : <Package size={36} style={{ color: 'var(--muted)', opacity: 0.3 }} />}
                          </div>
                          <div style={{ padding: '10px 12px' }}>
                            <div style={{ fontWeight: 500, fontSize: 13, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{u.name}</div>
                            <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>{categoryLabel(u.category)}</div>
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6, marginTop: 6 }}>
                              <Badge color={available ? 'green' : 'muted'}>{available ? 'Доступно' : 'Занято'}</Badge>
                              {available && (
                                <button onClick={e => { e.stopPropagation(); toggleCart(u.id) }} style={{
                                  display: 'inline-flex', alignItems: 'center', gap: 4,
                                  fontSize: 12, fontWeight: 500,
                                  color: added ? 'var(--red)' : 'var(--accent)',
                                  background: 'none', border: 'none', padding: 0, cursor: 'pointer',
                                }}>
                                  {added ? <><Minus size={14} /> Убрать</> : <><Plus size={14} /> В корзину</>}
                                </button>
                              )}
                            </div>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}

                {/* Rows */}
                {viewMode === 'rows' && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                    {filtered.map(u => {
                      const added = inCart(u.id)
                      const available = u.status === 'on_stock'
                      return (
                        <div key={u.id} style={{
                          background: 'var(--white)', borderRadius: 'var(--radius-card)',
                          border: '1px solid var(--border)', overflow: 'hidden',
                        }}>
                          <div onClick={() => setSelectedUnit(u)} style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '14px 16px', cursor: 'pointer' }}>
                            <div style={{
                              width: 52, height: 52, borderRadius: 8, flexShrink: 0,
                              background: 'var(--bg)', border: '1px solid var(--border)',
                              display: 'flex', alignItems: 'center', justifyContent: 'center',
                              overflow: 'hidden',
                            }}>
                              {u.photos?.[0]
                                ? /\.(mp4|webm|mov)$/i.test(u.photos[0])
                                  ? <video src={u.photos[0]} muted preload="metadata" style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
                                  : <img src={u.photos[0]} alt="" style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
                                : <Package size={20} style={{ color: 'var(--muted)', opacity: 0.4 }} />}
                            </div>
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <div style={{ fontWeight: 500, fontSize: 14, color: 'var(--accent)' }}>{u.name}</div>
                              <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>
                                {u.serial ? `${u.serial} · ` : ''}{categoryLabel(u.category)}
                              </div>
                            </div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
                              <Badge color={available ? 'green' : 'muted'}>{available ? 'Доступно' : 'Занято'}</Badge>
                              <div onClick={e => e.stopPropagation()}>
                                {available && (
                                  added ? (
                                    <Button variant="secondary" style={{ height: 34, fontSize: 13, padding: '0 14px', color: 'var(--red)' }}
                                      onClick={() => toggleCart(u.id)}>Убрать</Button>
                                  ) : (
                                    <Button style={{ height: 34, fontSize: 13, padding: '0 14px' }}
                                      onClick={() => toggleCart(u.id)}>В корзину</Button>
                                  )
                                )}
                              </div>
                            </div>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}

                {/* List */}
                {viewMode === 'list' && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                    {filtered.map(u => {
                      const added = inCart(u.id)
                      const available = u.status === 'on_stock'
                      return (
                        <div key={u.id} onClick={() => setSelectedUnit(u)} style={{
                          display: 'flex', alignItems: 'center', gap: 12, padding: '8px 12px',
                          background: 'var(--card)', borderRadius: 'var(--radius-btn)', cursor: 'pointer',
                        }}>
                          <div style={{ flex: 1, minWidth: 0, fontSize: 13, fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{u.name}</div>
                          {u.serial && <span style={{ fontSize: 12, color: 'var(--muted)', flexShrink: 0 }}>{u.serial}</span>}
                          <span style={{ fontSize: 12, color: 'var(--muted)', flexShrink: 0 }}>{categoryLabel(u.category)}</span>
                          <Badge color={available ? 'green' : 'muted'}>{available ? 'Доступно' : 'Занято'}</Badge>
                          <div onClick={e => e.stopPropagation()}>
                            {available && (
                              <button onClick={() => toggleCart(u.id)} style={{
                                display: 'inline-flex', alignItems: 'center', gap: 4,
                                fontSize: 12, fontWeight: 500,
                                color: added ? 'var(--red)' : 'var(--accent)',
                                background: 'none', border: 'none', padding: 0, cursor: 'pointer',
                              }}>
                                {added ? <><Minus size={14} /> Убрать</> : <><Plus size={14} /> В корзину</>}
                              </button>
                            )}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}

                {/* FAB корзины — бренд-стиль, золото на ink-900 */}
                {cart.length > 0 && (
                  <button onClick={() => setShowCart(true)} style={{
                    position: 'fixed', bottom: 26, right: 26, zIndex: 100,
                    width: 58, height: 58, borderRadius: '50%',
                    background: 'var(--ink-900)',
                    border: '2px solid var(--gold-500)',
                    color: 'var(--gold-400)',
                    cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
                    boxShadow: '0 8px 24px rgba(0,0,0,0.25), 0 2px 6px rgba(184,147,90,0.2)',
                    transition: 'transform 0.12s',
                  }}
                  onMouseEnter={e => e.currentTarget.style.transform = 'scale(1.06)'}
                  onMouseLeave={e => e.currentTarget.style.transform = 'scale(1)'}
                  >
                    <ShoppingCart size={22} strokeWidth={1.8} />
                    <span style={{
                      position: 'absolute', top: -4, right: -4,
                      background: 'var(--gold-500)', color: 'var(--ink-900)',
                      borderRadius: '50%', width: 22, height: 22,
                      fontSize: 11, fontWeight: 700,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontVariantNumeric: 'tabular-nums',
                      boxShadow: '0 2px 6px rgba(0,0,0,0.2)',
                    }}>{cart.length}</span>
                  </button>
                )}
              </div>
            )}

            {/* ── Deals tabs (Все / Новые / Получены / Вернули) ── */}
            {['all', 'new', 'received', 'returned'].includes(cabTab) && (() => {
              const titles = {
                all:      { h: 'Все заявки',   sub: 'История всех ваших заявок' },
                new:      { h: 'Новые',        sub: 'Заявки на рассмотрении и в работе' },
                received: { h: 'Получены',     sub: 'Имущество у вас на руках' },
                returned: { h: 'Вернули',      sub: 'История возвратов' },
              }
              const empty = {
                all:      'Заявок пока нет',
                new:      'Нет новых заявок',
                received: 'Нет полученного имущества',
                returned: 'Нет возвращённых заявок',
              }
              return (
                <div>
                  <h1 style={{ fontSize: 26, fontWeight: 600, marginBottom: 6, letterSpacing: '-0.02em' }}>
                    {titles[cabTab].h}
                  </h1>
                  <p style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 20 }}>
                    {titles[cabTab].sub}
                  </p>

                  {dealsLoading && <div style={{ textAlign: 'center', padding: '40px 0', color: 'var(--muted)', fontSize: 14 }}>Загрузка...</div>}
                  {!dealsLoading && filteredDeals.length === 0 && (
                    <div style={{ textAlign: 'center', padding: '60px 0' }}>
                      <FileText size={40} style={{ color: 'var(--muted)', opacity: 0.3, marginBottom: 12 }} strokeWidth={1.4} />
                      <div style={{ color: 'var(--muted)', fontSize: 14 }}>{empty[cabTab]}</div>
                    </div>
                  )}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                    {filteredDeals.map(d => (
                      <DealCard
                        key={d.id}
                        deal={d}
                        token={token}
                        phone={form.phone}
                        onChanged={loadDeals}
                      />
                    ))}
                  </div>
                </div>
              )
            })()}

            {/* ── Profile tab ── */}
            {cabTab === 'profile' && (
              <ProfileTab
                token={token}
                form={form}
                setForm={setForm}
                cpType={cpType}
                setCpType={setCpType}
              />
            )}
            </div>
          </div>
        </>
      )}

      {/* Unit detail modal — визуально 1-в-1 с UnitCardModal (директор склада) */}
      {selectedUnit && (
        <PublicUnitCardModal
          unit={selectedUnit}
          token={token}
          onClose={() => setSelectedUnit(null)}
          inCart={inCart(selectedUnit.id)}
          onToggleCart={toggleCart}
          onSwitchUnit={(u) => setSelectedUnit(u)}
        />
      )}

      {/* ─── CART MODAL ─── */}
      {showCart && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 400, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}
          onClick={() => setShowCart(false)}>
          <div style={{ background: 'var(--white)', borderRadius: 'var(--radius-card)', padding: 24, maxWidth: 480, width: '100%', maxHeight: '85vh', overflowY: 'auto' }}
            onClick={e => e.stopPropagation()}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
              <div style={{ fontWeight: 600, fontSize: 16 }}>Корзина ({cart.length})</div>
              <button onClick={() => setShowCart(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--muted)', padding: 4 }}><X size={18} /></button>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 20 }}>
              {cartUnits.map(u => (
                <div key={u.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', border: '1px solid var(--border)', borderRadius: 'var(--radius-btn)' }}>
                  <div style={{ width: 40, height: 40, borderRadius: 6, background: 'var(--bg)', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', flexShrink: 0 }}>
                    {u.photos?.[0]
                      ? /\.(mp4|webm|mov)$/i.test(u.photos[0])
                        ? <video src={u.photos[0]} muted preload="metadata" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                        : <img src={u.photos[0]} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                      : <Package size={16} style={{ color: 'var(--muted)' }} />}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{u.name}</div>
                    <div style={{ fontSize: 11, color: 'var(--muted)' }}>{categoryLabel(u.category)}</div>
                  </div>
                  <button onClick={() => toggleCart(u.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--red)', padding: 4 }}><X size={16} /></button>
                </div>
              ))}
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 12 }}>
              <FI label="Дата начала" type="date" value={periodStart} onChange={e => setPeriodStart(e.target.value)} />
              <FI label="Дата окончания" type="date" value={periodEnd} onChange={e => setPeriodEnd(e.target.value)} />
            </div>

            <div style={{ marginBottom: 16 }}>
              <div style={{ fontSize: 12, fontWeight: 500, marginBottom: 4, color: 'var(--muted)' }}>Комментарий</div>
              <textarea placeholder="Уточните детали..." value={cartMessage} onChange={e => setCartMessage(e.target.value)}
                style={{ width: '100%', minHeight: 70, padding: '10px 12px', border: '1px solid var(--border)', borderRadius: 'var(--radius-btn)', fontSize: 13, resize: 'vertical', outline: 'none', fontFamily: 'inherit', boxSizing: 'border-box' }} />
            </div>

            <Button fullWidth onClick={openConfirm}>Далее</Button>
          </div>
        </div>
      )}

      {/* ─── CONFIRM MODAL ─── */}
      {showConfirm && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 600, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}
          onClick={() => setShowConfirm(false)}>
          <div style={{ background: 'var(--white)', borderRadius: 'var(--radius-card)', padding: '28px', maxWidth: 420, width: '100%', boxShadow: '0 20px 60px rgba(0,0,0,0.15)' }}
            onClick={e => e.stopPropagation()}>
            <div style={{ textAlign: 'center', marginBottom: 20 }}>
              <div style={{ width: 52, height: 52, borderRadius: '50%', background: 'var(--accent)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', marginBottom: 12, opacity: 0.9 }}>
                <ShoppingCart size={24} style={{ color: '#fff' }} />
              </div>
              <h2 style={{ fontSize: 17, fontWeight: 600, marginBottom: 6 }}>Подтвердите заявку</h2>
              <p style={{ fontSize: 13, color: 'var(--muted)' }}>Проверьте данные перед отправкой</p>
            </div>

            <div style={{ background: 'var(--bg)', borderRadius: 'var(--radius-btn)', padding: '14px 16px', marginBottom: 12 }}>
              <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 8 }}>Единицы ({cartUnits.length})</div>
              {cartUnits.map(u => (
                <div key={u.id} style={{ fontSize: 13, fontWeight: 500, padding: '3px 0' }}>{u.name}</div>
              ))}
            </div>

            {(periodStart || periodEnd) && (
              <div style={{ background: 'var(--bg)', borderRadius: 'var(--radius-btn)', padding: '10px 16px', marginBottom: 12, fontSize: 13, color: 'var(--muted)' }}>
                Сроки: {periodStart ? new Date(periodStart).toLocaleDateString('ru-RU') : '—'} — {periodEnd ? new Date(periodEnd).toLocaleDateString('ru-RU') : '—'}
              </div>
            )}

            <div style={{ background: 'var(--bg)', borderRadius: 'var(--radius-btn)', padding: '10px 16px', marginBottom: 20, fontSize: 13 }}>
              <div style={{ fontWeight: 500 }}>{form.name}</div>
              <div style={{ color: 'var(--muted)', fontSize: 12 }}>{form.phone}{form.email ? ` · ${form.email}` : ''}</div>
            </div>

            <div style={{ display: 'flex', gap: 10 }}>
              <Button variant="secondary" fullWidth onClick={() => setShowConfirm(false)}>Назад</Button>
              <Button fullWidth loading={sending} onClick={submitCart}>Подтвердить</Button>
            </div>
          </div>
        </div>
      )}

      {/* ─── SUCCESS (в бренд-стиле) ─── */}
      {showSuccess && (
        <div style={{
          position: 'fixed', inset: 0,
          background: 'rgba(10,10,10,0.55)',
          backdropFilter: 'blur(3px)',
          zIndex: 700, display: 'flex',
          alignItems: 'center', justifyContent: 'center',
        }}>
          <div style={{
            background: 'var(--white)', borderRadius: 16,
            padding: '36px 32px 32px', maxWidth: 360, textAlign: 'center',
            border: '1px solid var(--border)',
            boxShadow: '0 24px 60px rgba(0,0,0,0.22), 0 2px 8px rgba(0,0,0,0.08)',
            animation: 'pub-pop 0.25s ease',
          }}>
            <div style={{
              width: 62, height: 62, borderRadius: '50%',
              background: 'var(--gold-100)',
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              marginBottom: 18,
              boxShadow: '0 0 0 6px rgba(184,147,90,0.12)',
            }}>
              <CheckCircle size={30} style={{ color: 'var(--gold-600)' }} strokeWidth={1.8} />
            </div>
            <h2 style={{ fontSize: 18, fontWeight: 600, marginBottom: 8, letterSpacing: '-0.01em' }}>
              Заявка отправлена
            </h2>
            <p style={{ fontSize: 13, color: 'var(--muted)', lineHeight: 1.5 }}>
              Мы свяжемся с вами в ближайшее время
            </p>
          </div>
        </div>
      )}

      <style>{`@keyframes pub-pop{from{transform:scale(0.9);opacity:0}to{transform:scale(1);opacity:1}}@media(max-width:768px){.pub-sidebar{display:none!important}}`}</style>
    </div>
  )
}

/* ─── Info Row (mirrors UnitCardModal) ─── */
function PubInfoRow({ label, value, last, hidden }) {
  if (hidden) return null
  return (
    <div style={{
      display: 'flex', justifyContent: 'space-between', alignItems: 'center',
      padding: '10px 0',
      borderBottom: last ? 'none' : '1px solid var(--border)',
    }}>
      <span style={{ color: 'var(--muted)', fontSize: 13 }}>{label}</span>
      <span style={{ fontWeight: 500, fontSize: 13, textAlign: 'right', maxWidth: '60%' }}>{value}</span>
    </div>
  )
}

/* ─── Deal Card ───
   Раскрытие 1-в-1 как у директора площадки (RequestsProductionPage):
   позиции с фото/названием/категорией + бейдж статуса единицы.
   Для активных сделок — «Запросить возврат» (симметрично /requests у склада).
   «Подписать договор» намеренно скрыто в полученных/возвращённых — пользователь
   уже получил имущество, подписание выполняется одним флоу при выдаче. */
function DealCard({ deal, token, phone, onChanged }) {
  const [open, setOpen] = useState(false)
  const [confirmReturn, setConfirmReturn] = useState(false)
  const [sending, setSending] = useState(false)
  // Для pending_review показываем этап workflow (null/collecting/ready)
  // как основной бейдж — пользователь видит прогресс обработки складом.
  let st = DEAL_STATUS[deal.status] || DEAL_STATUS.pending_review
  if (deal.status === 'pending_review') {
    const key = deal.workflow_stage || 'null'
    st = STAGE_STATUS[key] || DEAL_STATUS.pending_review
  }
  const dateStr = deal.period_start && deal.period_end
    ? `${new Date(deal.period_start).toLocaleDateString('ru-RU')} — ${new Date(deal.period_end).toLocaleDateString('ru-RU')}`
    : null

  const units = Array.isArray(deal.unit_items) && deal.unit_items.length
    ? deal.unit_items
    : (deal.unit_names || []).map(name => ({ name }))
  const unitCount = (deal.unit_ids || deal.unit_names || units).length

  const isActive = deal.status === 'active' || deal.status === 'overdue'
  const isPending = deal.status === 'pending_review'

  async function doRequestReturn() {
    if (sending) return
    setSending(true)
    try {
      const res = await fetch(`${BASE}/public/warehouse/${token}/deals/${deal.id}/request-return`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || 'Ошибка')
      setConfirmReturn(false)
      onChanged?.()
    } catch (e) {
      alert(e.message || 'Не удалось запросить возврат')
    } finally {
      setSending(false)
    }
  }

  return (
    <div style={{
      background: 'var(--card)',
      borderRadius: 12,
      border: '1px solid var(--border)',
      overflow: 'hidden',
      boxShadow: '0 1px 2px rgba(0,0,0,0.03)',
      transition: 'box-shadow 0.15s, border-color 0.15s',
    }}>
      <button onClick={() => setOpen(v => !v)} style={{
        padding: '16px 18px',
        cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 12,
        width: '100%', border: 'none',
        background: 'transparent', textAlign: 'left',
        fontSize: 'inherit', fontFamily: 'inherit',
      }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6, flexWrap: 'wrap' }}>
            <span style={{
              fontWeight: 600, fontSize: 14,
              letterSpacing: '-0.005em',
            }}>Заявка #{String(deal.id).slice(0, 8)}</span>
            <Badge color={st.color}>{st.label}</Badge>
            {isActive && deal.return_requested_at && <Badge color="amber">Готовы вернуть</Badge>}
          </div>
          <div style={{
            fontSize: 12, color: 'var(--muted)',
            display: 'flex', gap: 8, flexWrap: 'wrap',
          }}>
            <span>{unitCount} ед.</span>
            <span>·</span>
            <span>{new Date(deal.created_at).toLocaleDateString('ru-RU')}</span>
            {dateStr && <><span>·</span><span>{dateStr}</span></>}
          </div>
        </div>
        {open
          ? <ChevronUp size={18} style={{ color: 'var(--gold-600)', flexShrink: 0 }} strokeWidth={1.8} />
          : <ChevronDown size={18} style={{ color: 'var(--muted)', flexShrink: 0 }} strokeWidth={1.8} />}
      </button>

      {open && (
        <div style={{
          padding: '14px 18px 18px',
          borderTop: '1px solid var(--border)',
          background: 'var(--paper)',
        }}>
          <div style={{
            fontSize: 10, fontWeight: 600, color: 'var(--muted)',
            letterSpacing: '0.08em', textTransform: 'uppercase',
            marginBottom: 8,
          }}>Позиции ({unitCount})</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {units.map((u, i) => (
              <div key={u.id || i} style={{
                display: 'flex', alignItems: 'center', gap: 10,
                padding: '8px 10px', borderRadius: 8,
                background: 'var(--card)', border: '1px solid var(--border)',
              }}>
                {u.photo ? (
                  <img src={u.photo} alt="" style={{
                    width: 44, height: 44, borderRadius: 6,
                    objectFit: 'contain', flexShrink: 0,
                  }} />
                ) : (
                  <div style={{
                    width: 44, height: 44, borderRadius: 6,
                    background: 'var(--paper)', border: '1px solid var(--border)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                  }}>
                    <Package size={18} style={{ color: 'var(--muted)', opacity: 0.6 }} strokeWidth={1.4} />
                  </div>
                )}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 500, fontSize: 13 }}>{u.name}</div>
                  {(u.serial || u.category) && (
                    <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 1 }}>
                      {u.serial && `${u.serial} · `}{u.category ? categoryLabel(u.category) : ''}
                    </div>
                  )}
                </div>
                {u.status && (
                  <Badge color={u.status === 'on_stock' ? 'green' : u.status === 'issued' ? 'amber' : 'muted'}>
                    {u.status === 'on_stock' ? 'На складе' : u.status === 'issued' ? 'Получено' : u.status}
                  </Badge>
                )}
              </div>
            ))}
          </div>

          {deal.requester_message && (
            <div style={{
              fontSize: 12, color: 'var(--muted)',
              marginTop: 12,
              padding: '10px 12px',
              background: 'var(--card)',
              borderLeft: '3px solid var(--gold-500)',
              borderRadius: 6,
              lineHeight: 1.5,
            }}>
              {deal.requester_message}
            </div>
          )}
          {deal.price_total && (
            <div style={{
              fontSize: 14, fontWeight: 600, marginTop: 14,
              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
              padding: '10px 12px',
              background: 'var(--card)',
              borderRadius: 6,
            }}>
              <span style={{ color: 'var(--muted)', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 600 }}>Сумма</span>
              <span>{Number(deal.price_total).toLocaleString('ru-RU')} ₽</span>
            </div>
          )}
          <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
            {deal.contract_pdf_url && (
              <a href={deal.contract_pdf_url} target="_blank" rel="noreferrer" style={{
                fontSize: 12, color: 'var(--gold-600)',
                display: 'inline-flex', alignItems: 'center', gap: 4,
                padding: '7px 12px',
                border: '1px solid var(--border)',
                borderRadius: 8,
                textDecoration: 'none',
                fontWeight: 500,
              }}>
                <FileText size={13} strokeWidth={1.6} /> Скачать договор
              </a>
            )}
            {/* «Подписать договор» — только когда заявка ещё в обработке (pending_review),
                но имеется активный sign_token. На активных/завершённых подписание уже
                не требуется — имущество выдано/возвращено. */}
            {isPending && deal.sign_token && deal.sign_status === 'pending' && (
              <a href={`/sign/${deal.sign_token}`} style={{
                display: 'inline-flex', alignItems: 'center', gap: 6,
                padding: '8px 14px', borderRadius: 8,
                background: 'var(--ink-900)', color: 'var(--gold-400)',
                fontSize: 13, fontWeight: 500, textDecoration: 'none',
                border: '1px solid var(--gold-500)',
              }}>Подписать договор →</a>
            )}
            {/* Получены: «Запросить возврат» или «Готовы вернуть» badge, как у
                директора площадки (RequestsProductionPage). */}
            {isActive && !deal.return_requested_at && (
              <Button
                variant="primary"
                style={{ height: 36, fontSize: 13 }}
                onClick={() => setConfirmReturn(true)}
              >
                Запросить возврат
              </Button>
            )}
          </div>
        </div>
      )}

      {confirmReturn && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(10,10,10,0.55)', backdropFilter: 'blur(3px)', zIndex: 600, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}
          onClick={() => !sending && setConfirmReturn(false)}>
          <div style={{ background: 'var(--white)', borderRadius: 14, padding: 24, maxWidth: 420, width: '100%', boxShadow: '0 24px 60px rgba(0,0,0,0.22)' }}
            onClick={e => e.stopPropagation()}>
            <h2 style={{ fontSize: 17, fontWeight: 600, marginBottom: 6 }}>Запросить возврат</h2>
            <p style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 20 }}>
              Склад получит уведомление и подтвердит фактический возврат имущества.
            </p>
            <div style={{ display: 'flex', gap: 10 }}>
              <Button variant="secondary" fullWidth disabled={sending} onClick={() => setConfirmReturn(false)}>Отмена</Button>
              <Button fullWidth loading={sending} onClick={doRequestReturn}>Запросить</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function ProfileTab({ token, form, setForm, cpType, setCpType }) {
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [err, setErr] = useState('')

  async function save() {
    setSaving(true); setErr(''); setSaved(false)
    try {
      const r = await fetch(`${BASE}/public/warehouse/${token}/profile`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: form.email,
          name: form.name,
          phone: form.phone,
          counterparty_type: cpType,
          project_name: form.project_name || null,
          inn: form.inn || null,
          legal_address: form.legal_address || null,
          extra_contact: form.extra_contact || null,
        }),
      })
      const data = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(data.error || 'Ошибка сохранения')
      // Обновим sessionStorage
      try {
        const key = `pub_session_${token}`
        const prev = JSON.parse(sessionStorage.getItem(key) || '{}')
        sessionStorage.setItem(key, JSON.stringify({ ...prev, form, cpType }))
      } catch {}
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    } catch (e) {
      setErr(e.message || 'Ошибка')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div>
      <h1 style={{ fontSize: 26, fontWeight: 600, marginBottom: 6, letterSpacing: '-0.02em' }}>Профиль</h1>
      <p style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 24 }}>
        Ваши контактные данные для заявок
      </p>

      <div style={{
        background: 'var(--card)', borderRadius: 12,
        border: '1px solid var(--border)',
        padding: '20px 22px', maxWidth: 520,
        boxShadow: '0 1px 2px rgba(0,0,0,0.03)',
      }}>
        {/* Тип контрагента */}
        <div style={{ marginBottom: 16 }}>
          <div style={{
            fontSize: 10, fontWeight: 600, color: 'var(--muted)',
            letterSpacing: '0.08em', textTransform: 'uppercase',
            marginBottom: 8,
          }}>Тип</div>
          <div style={{ display: 'flex', gap: 6 }}>
            {[{ v: 'person', l: 'Физлицо' }, { v: 'company', l: 'Компания' }].map(o => (
              <button key={o.v} onClick={() => setCpType(o.v)} style={{
                flex: 1, padding: '8px 10px',
                borderRadius: 8, fontSize: 13, fontWeight: 500,
                border: `1px solid ${cpType === o.v ? 'var(--gold-500)' : 'var(--border)'}`,
                background: cpType === o.v ? 'var(--gold-100)' : 'var(--card)',
                color: cpType === o.v ? 'var(--gold-600)' : 'var(--text)',
                cursor: 'pointer', fontFamily: 'inherit',
                transition: 'all 0.12s',
              }}>{o.l}</button>
            ))}
          </div>
        </div>

        <FI label="Имя" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
        <FI label="Email" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} />
        <FI label="Телефон" value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} placeholder="+7 999 123 45 67" />

        {cpType === 'company' && (
          <>
            <FI label="Название компании" value={form.project_name || ''} onChange={e => setForm(f => ({ ...f, project_name: e.target.value }))} />
            <FI label="ИНН" value={form.inn || ''} onChange={e => setForm(f => ({ ...f, inn: e.target.value.replace(/\D/g, '').slice(0, 12) }))} />
            <FI label="Юр. адрес" value={form.legal_address || ''} onChange={e => setForm(f => ({ ...f, legal_address: e.target.value }))} />
          </>
        )}
        <FI label="Доп. контакт" value={form.extra_contact || ''} onChange={e => setForm(f => ({ ...f, extra_contact: e.target.value }))} placeholder="Telegram, WhatsApp, etc." />

        {err && (
          <div style={{
            fontSize: 12, color: 'var(--red)',
            padding: '8px 12px',
            background: 'rgba(139,58,31,0.08)',
            borderRadius: 6, marginBottom: 12,
          }}>{err}</div>
        )}

        <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginTop: 6 }}>
          <Button disabled={saving} onClick={save}>
            {saving ? 'Сохранение…' : 'Сохранить'}
          </Button>
          {saved && (
            <span style={{
              fontSize: 12, color: 'var(--green)',
              display: 'inline-flex', alignItems: 'center', gap: 4,
            }}>
              <CheckCircle size={14} strokeWidth={1.8} /> Сохранено
            </span>
          )}
        </div>
      </div>
    </div>
  )
}

function FI({ label, value, onChange, placeholder, type = 'text', error }) {
  return (
    <div style={{ marginBottom: 14 }}>
      {label && <div style={{ fontSize: 12, fontWeight: 500, marginBottom: 4, color: 'var(--muted)' }}>{label}</div>}
      <input type={type} value={value} onChange={onChange} placeholder={placeholder}
        style={{ width: '100%', height: 38, padding: '0 12px', border: `1px solid ${error ? 'var(--red)' : 'var(--border)'}`, borderRadius: 'var(--radius-btn)', fontSize: 13, background: 'var(--white)', outline: 'none', boxSizing: 'border-box' }} />
      {error && <div style={{ fontSize: 11, color: 'var(--red)', marginTop: 2 }}>{error}</div>}
    </div>
  )
}

function PhoneInput({ label, value, onChange }) {
  function handleChange(e) {
    let v = e.target.value.replace(/[^\d+\s]/g, '')
    if (v && !v.startsWith('+')) v = '+' + v
    if (v.length > 0 && !v.startsWith('+7')) {
      v = '+7' + v.replace(/^\+/, '')
    }
    // Auto-format: +7 XXX XXX XX XX
    const digits = v.replace(/\D/g, '')
    if (digits.length <= 1) { onChange(v); return }
    let formatted = '+7'
    if (digits.length > 1) formatted += ' ' + digits.slice(1, 4)
    if (digits.length > 4) formatted += ' ' + digits.slice(4, 7)
    if (digits.length > 7) formatted += ' ' + digits.slice(7, 9)
    if (digits.length > 9) formatted += ' ' + digits.slice(9, 11)
    onChange(formatted)
  }

  const isValid = !value || /^\+7\s?\d{3}\s?\d{3}\s?\d{2}\s?\d{2}$/.test(value.trim())

  return (
    <div style={{ marginBottom: 14 }}>
      {label && <div style={{ fontSize: 12, fontWeight: 500, marginBottom: 4, color: 'var(--muted)' }}>{label}</div>}
      <input value={value} onChange={handleChange} placeholder="+7 900 000 00 00" maxLength={16}
        style={{ width: '100%', height: 38, padding: '0 12px', border: `1px solid ${value && !isValid ? 'var(--red)' : 'var(--border)'}`, borderRadius: 'var(--radius-btn)', fontSize: 13, background: 'var(--white)', outline: 'none', boxSizing: 'border-box' }} />
      {value && !isValid && <div style={{ fontSize: 11, color: 'var(--red)', marginTop: 2 }}>Формат: +7 XXX XXX XX XX</div>}
    </div>
  )
}

function InnInput({ value, onChange, onCompanyFound }) {
  const [loading, setLoading] = useState(false)
  const [info, setInfo] = useState(null) // { name, address, kpp, ogrn, director }
  const [error, setError] = useState('')
  const lastQueried = useRef('')

  const valid = value.length === 0 || value.length === 10 || value.length === 12

  useEffect(() => {
    if ((value.length === 10 || value.length === 12) && value !== lastQueried.current) {
      lastQueried.current = value
      lookup(value)
    }
    if (value.length < 10) {
      setInfo(null)
      setError('')
    }
  }, [value]) // eslint-disable-line react-hooks/exhaustive-deps

  async function lookup(inn) {
    setLoading(true)
    setError('')
    setInfo(null)
    try {
      const res = await fetch(`${BASE}/public/inn/${inn}`)
      const data = await res.json()
      if (data.found) {
        const found = {
          name: data.name || data.fullName || '',
          fullName: data.fullName || '',
          address: data.region || '',
          kpp: data.kpp || '',
          ogrn: data.ogrn || '',
          director: data.director || '',
        }
        setInfo(found)
        onCompanyFound?.(found)
      } else {
        setError('Организация не найдена')
      }
    } catch {
      setError('Ошибка поиска')
    } finally {
      setLoading(false)
    }
  }

  function handleChange(e) {
    const v = e.target.value.replace(/\D/g, '').slice(0, 12)
    onChange(v)
  }

  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ fontSize: 12, fontWeight: 500, marginBottom: 4, color: 'var(--muted)' }}>ИНН *</div>
      <div style={{ position: 'relative' }}>
        <input value={value} onChange={handleChange} placeholder="1234567890" maxLength={12}
          style={{ width: '100%', height: 38, padding: '0 12px', border: `1px solid ${!valid ? 'var(--red)' : info ? 'var(--green)' : 'var(--border)'}`, borderRadius: 'var(--radius-btn)', fontSize: 13, background: 'var(--white)', outline: 'none', boxSizing: 'border-box' }} />
        {loading && <span style={{ position: 'absolute', right: 12, top: 10, fontSize: 12, color: 'var(--muted)' }}>...</span>}
      </div>
      {!valid && value.length > 0 && <div style={{ fontSize: 11, color: 'var(--red)', marginTop: 2 }}>ИНН: 10 или 12 цифр</div>}
      {error && <div style={{ fontSize: 11, color: 'var(--red)', marginTop: 2 }}>{error}</div>}
      {info && (
        <div style={{ marginTop: 6, padding: '8px 10px', background: 'var(--bg)', borderRadius: 'var(--radius-btn)', fontSize: 12 }}>
          <div style={{ fontWeight: 500, color: 'var(--green)', marginBottom: 2 }}>{info.name}</div>
          {info.director && <div style={{ color: 'var(--muted)' }}>Руководитель: {info.director}</div>}
          {info.address && <div style={{ color: 'var(--muted)', marginTop: 1 }}>{info.address}</div>}
          {(info.kpp || info.ogrn) && <div style={{ color: 'var(--muted)', marginTop: 1 }}>{info.kpp && `КПП: ${info.kpp}`}{info.kpp && info.ogrn && ' · '}{info.ogrn && `ОГРН: ${info.ogrn}`}</div>}
        </div>
      )}
    </div>
  )
}
