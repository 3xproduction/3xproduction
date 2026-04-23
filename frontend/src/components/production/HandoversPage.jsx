// Акты приёма-передачи склада проекта.
// MVP: список актов + создание + чеклист + подпись.

import React, { useState, useEffect } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import ProductionLayout from './ProductionLayout'

// Вспомогательная обёртка: при embedded=true рендерит дочерний контент без layout
// (используется, когда страница встраивается в хаб-страницу «Склад проекта»).
function PageWrap({ embedded, children }) {
  return embedded ? <>{children}</> : <ProductionLayout>{children}</ProductionLayout>
}
import Button from '../shared/Button'
import Badge from '../shared/Badge'
import { useToast } from '../shared/Toast'
import { handovers as handoversApi, team as teamApi } from '../../services/api'
import { categoryLabel } from '../../constants/categories'
import { Plus, Check, X, AlertTriangle } from 'lucide-react'

const STATUS_LABEL = { draft: 'Черновик', checking: 'Приёмка', signed: 'Подписан', disputed: 'Оспорен' }
const STATUS_COLOR = { draft: 'muted', checking: 'amber', signed: 'green', disputed: 'red' }
const SCOPE_LABEL = { all: 'Всё', props: 'Реквизит', costumes: 'Костюмы' }

export default function HandoversPage({ embedded = false }) {
  const params = useParams()
  return params.id
    ? <HandoverDetails id={params.id} embedded={embedded} />
    : <HandoverList embedded={embedded} />
}

function HandoverList({ embedded = false }) {
  const navigate = useNavigate()
  const toast = useToast()
  const [list, setList] = useState([])
  const [loading, setLoading] = useState(true)
  const [showNew, setShowNew] = useState(false)
  const [teamList, setTeamList] = useState([])
  const [toUser, setToUser] = useState('')
  const [scope, setScope] = useState('all')
  const [creating, setCreating] = useState(false)

  function reload() {
    setLoading(true)
    handoversApi.list().then(d => setList(d.handovers || [])).finally(() => setLoading(false))
  }
  useEffect(reload, [])
  useEffect(() => {
    if (showNew) teamApi.list().then(d => setTeamList(d.team || d.members || [])).catch(() => {})
  }, [showNew])

  async function create() {
    setCreating(true)
    try {
      const d = await handoversApi.create({ to_user_id: toUser || null, scope })
      toast?.('Акт создан, начинайте приёмку', 'success')
      navigate(`/production/handovers/${d.handover.id}`)
    } catch (e) { toast?.(e.message || 'Ошибка', 'error') }
    setCreating(false)
  }

  return (
    <PageWrap embedded={embedded}>
      <div style={{ padding: embedded ? 0 : '24px 32px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 18 }}>
          <h1 style={{ fontSize: 22, fontWeight: 700 }}>Акты передачи</h1>
          <Button onClick={() => setShowNew(true)}>
            <Plus size={14} style={{ marginRight: 6 }} /> Новый акт
          </Button>
        </div>

        {loading ? (
          <div style={{ textAlign: 'center', padding: 40, color: 'var(--muted)' }}>Загрузка...</div>
        ) : list.length === 0 ? (
          <div style={{ textAlign: 'center', padding: 40, color: 'var(--muted)' }}>Актов пока нет</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {list.map(h => (
              <div key={h.id}
                onClick={() => navigate(`/production/handovers/${h.id}`)}
                style={{
                  background: 'var(--white)', border: '1px solid var(--border)', borderRadius: 12,
                  padding: 14, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 12,
                }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 4 }}>
                    {h.from_user_name || 'Без имени'} → {h.to_user_name || 'не указан'}
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--muted)' }}>
                    {SCOPE_LABEL[h.scope]} · {h.items_checked}/{h.items_total} проверено · {new Date(h.created_at).toLocaleDateString()}
                  </div>
                </div>
                <Badge color={STATUS_COLOR[h.status]}>{STATUS_LABEL[h.status]}</Badge>
              </div>
            ))}
          </div>
        )}
      </div>

      {showNew && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 500,
          display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }} onClick={() => setShowNew(false)}>
          <div style={{ background: 'var(--white)', borderRadius: 14, padding: 22, maxWidth: 440, width: '100%' }} onClick={e => e.stopPropagation()}>
            <div style={{ fontSize: 17, fontWeight: 600, marginBottom: 14 }}>Новый акт передачи</div>
            <div style={{ fontSize: 12, fontWeight: 500, marginBottom: 4 }}>Кому передаём</div>
            <select value={toUser} onChange={e => setToUser(e.target.value)} style={inputStyle}>
              <option value="">— выберите сотрудника —</option>
              {teamList.map(m => <option key={m.id} value={m.id}>{m.name} · {m.role}</option>)}
            </select>
            <div style={{ fontSize: 12, fontWeight: 500, marginTop: 10, marginBottom: 4 }}>Охват</div>
            <div style={{ display: 'flex', gap: 6 }}>
              {['all', 'props', 'costumes'].map(s => (
                <button key={s} onClick={() => setScope(s)}
                  style={{
                    flex: 1, padding: '8px 10px', borderRadius: 8, fontSize: 12, fontWeight: 500,
                    border: scope === s ? '1.5px solid var(--accent)' : '1px solid var(--border)',
                    background: scope === s ? 'rgba(var(--accent-rgb,249,115,22),0.08)' : 'var(--white)',
                    cursor: 'pointer',
                  }}>{SCOPE_LABEL[s]}</button>
              ))}
            </div>
            <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
              <Button variant="secondary" fullWidth onClick={() => setShowNew(false)}>Отмена</Button>
              <Button fullWidth disabled={creating} onClick={create}>{creating ? '...' : 'Создать'}</Button>
            </div>
          </div>
        </div>
      )}
    </PageWrap>
  )
}

function HandoverDetails({ id, embedded = false }) {
  const navigate = useNavigate()
  const toast = useToast()
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [signing, setSigning] = useState(false)
  const [filter, setFilter] = useState('all')

  function reload() {
    setLoading(true)
    handoversApi.get(id).then(d => setData(d)).finally(() => setLoading(false))
  }
  useEffect(reload, [id])

  async function checkItem(item, check_status) {
    let note = null
    if (check_status === 'missing' || check_status === 'damaged') {
      note = window.prompt(check_status === 'missing' ? 'Что именно отсутствует?' : 'Что повреждено?')
      if (note === null) return
    }
    try {
      await handoversApi.check(id, item.id, { check_status, note })
      reload()
    } catch (e) { toast?.(e.message || 'Ошибка', 'error') }
  }

  async function sign() {
    setSigning(true)
    try {
      await handoversApi.sign(id)
      toast?.('Акт подписан', 'success')
      reload()
    } catch (e) { toast?.(e.message || 'Ошибка', 'error') }
    setSigning(false)
  }

  if (loading || !data) return <PageWrap embedded={embedded}><div style={{ padding: 40, textAlign: 'center', color: 'var(--muted)' }}>Загрузка...</div></PageWrap>

  const { handover, items } = data
  const stats = {
    ok: items.filter(i => i.check_status === 'ok').length,
    missing: items.filter(i => i.check_status === 'missing').length,
    damaged: items.filter(i => i.check_status === 'damaged').length,
    pending: items.filter(i => i.check_status === 'pending').length,
  }
  const filtered = filter === 'all' ? items : items.filter(i => i.check_status === filter)
  const allChecked = stats.pending === 0

  return (
    <PageWrap embedded={embedded}>
      <div style={{ padding: embedded ? 0 : '24px 32px' }}>
        <button onClick={() => navigate('/production/handovers')}
          style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--muted)', fontSize: 13, marginBottom: 10 }}>
          ← Все акты
        </button>

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
          <h1 style={{ fontSize: 20, fontWeight: 700 }}>
            {handover.from_user_name || '—'} → {handover.to_user_name || '—'}
          </h1>
          <Badge color={STATUS_COLOR[handover.status]}>{STATUS_LABEL[handover.status]}</Badge>
        </div>
        <div style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 16 }}>
          Проект: {handover.project_name || '—'} · Охват: {SCOPE_LABEL[handover.scope]}
        </div>

        {/* Filter chips */}
        <div style={{ display: 'flex', gap: 6, marginBottom: 16, flexWrap: 'wrap' }}>
          {[
            { k: 'all',     label: `Все · ${items.length}` },
            { k: 'pending', label: `Необработано · ${stats.pending}` },
            { k: 'ok',      label: `✓ · ${stats.ok}` },
            { k: 'missing', label: `Нет · ${stats.missing}` },
            { k: 'damaged', label: `Повреждено · ${stats.damaged}` },
          ].map(c => (
            <button key={c.k} onClick={() => setFilter(c.k)}
              style={{
                padding: '6px 12px', borderRadius: 999, fontSize: 12, fontWeight: 500,
                border: filter === c.k ? '1.5px solid var(--accent)' : '1px solid var(--border)',
                background: filter === c.k ? 'rgba(var(--accent-rgb,249,115,22),0.08)' : 'var(--white)',
                cursor: 'pointer',
              }}>{c.label}</button>
          ))}
        </div>

        {/* Items list */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 20 }}>
          {filtered.map(item => (
            <HandoverItemRow key={item.id} item={item}
              readOnly={handover.status !== 'checking'}
              onCheck={(status) => checkItem(item, status)} />
          ))}
        </div>

        {handover.status === 'checking' && (
          <div style={{ background: allChecked ? 'rgba(34,197,94,0.08)' : 'var(--bg)', padding: 14, borderRadius: 10 }}>
            {!allChecked && <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 8 }}>
              Подпишите акт после проверки всех позиций.
            </div>}
            <Button fullWidth onClick={sign} disabled={!allChecked || signing}>
              {signing ? '...' : allChecked ? 'Подписать акт' : `Осталось ${stats.pending}`}
            </Button>
          </div>
        )}
      </div>
    </PageWrap>
  )
}

function HandoverItemRow({ item, onCheck, readOnly }) {
  const colorMap = { ok: 'var(--green)', missing: 'var(--red)', damaged: 'var(--amber)', pending: 'var(--muted)' }
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 10,
      padding: 10, border: '1px solid var(--border)', borderRadius: 10,
      background: 'var(--white)',
    }}>
      {item.unit_photo_url ? (
        <img src={item.unit_photo_url} alt="" style={{ width: 44, height: 44, objectFit: 'cover', borderRadius: 6 }} />
      ) : (
        <div style={{ width: 44, height: 44, borderRadius: 6, background: 'var(--bg)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--muted)', fontSize: 20 }}>📦</div>
      )}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 500 }}>{item.unit_name}</div>
        <div style={{ fontSize: 11, color: 'var(--muted)' }}>
          {categoryLabel(item.unit_category)} · кол-во {item.qty_expected}
        </div>
        {item.note && <div style={{ fontSize: 11, color: colorMap[item.check_status], marginTop: 2 }}>• {item.note}</div>}
      </div>
      {readOnly ? (
        <Badge color={item.check_status === 'ok' ? 'green' : item.check_status === 'missing' ? 'red' : item.check_status === 'damaged' ? 'amber' : 'muted'}>
          {item.check_status === 'ok' ? '✓' : item.check_status === 'missing' ? 'Нет' : item.check_status === 'damaged' ? 'Повреждено' : '...'}
        </Badge>
      ) : (
        <div style={{ display: 'flex', gap: 4 }}>
          <CheckBtn active={item.check_status === 'ok'}  color="var(--green)" onClick={() => onCheck('ok')}><Check size={16} /></CheckBtn>
          <CheckBtn active={item.check_status === 'damaged'} color="var(--amber)" onClick={() => onCheck('damaged')}><AlertTriangle size={16} /></CheckBtn>
          <CheckBtn active={item.check_status === 'missing'} color="var(--red)" onClick={() => onCheck('missing')}><X size={16} /></CheckBtn>
        </div>
      )}
    </div>
  )
}

function CheckBtn({ active, color, children, onClick }) {
  return (
    <button onClick={onClick} style={{
      width: 32, height: 32, borderRadius: 8, cursor: 'pointer',
      border: active ? `1.5px solid ${color}` : '1px solid var(--border)',
      background: active ? color : 'var(--white)',
      color: active ? '#fff' : color,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    }}>{children}</button>
  )
}

const inputStyle = {
  width: '100%', height: 36, padding: '0 10px',
  border: '1px solid var(--border)', borderRadius: 8, fontSize: 13,
  boxSizing: 'border-box', background: 'var(--white)',
}
