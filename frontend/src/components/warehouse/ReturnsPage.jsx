// «Возвраты» — общий журнал возвратов на основной склад.
// Источники: returns по заявкам (issuances.returns), завершённые аренды
// (rent_deals, объединены с публичными ссылками — это одно и то же API),
// подтверждённые возвраты со склада проекта (warehouse_return_requests).

import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'
import WarehouseLayout from './WarehouseLayout'
import ProductionLayout from '../production/ProductionLayout'
import Badge from '../shared/Badge'
import { issuances as issuancesApi, projectUnits as projectUnitsApi, rent as rentApi } from '../../services/api'
import { useAuth } from '../../hooks/useAuth'
import { ROLES } from '../../constants/roles'

function formatDate(str) {
  if (!str) return '—'
  return new Date(str).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', year: 'numeric' })
}

const SOURCE_LABEL = {
  issue:   'Заявка',
  rent:    'Аренда',
  project: 'Склад проекта',
}
const SOURCE_COLOR = {
  issue:   'blue',
  rent:    'green',
  project: 'amber',
}

export default function ReturnsPage() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const Layout = ROLES[user?.role]?.world === 'production' ? ProductionLayout : WarehouseLayout

  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState('all')

  useEffect(() => {
    setLoading(true)
    // Добираем rent-сделки отдельно — /issuances/acts иногда не отдаёт
    // публичные сделки с returned_at. Берём все и фильтруем по returned_at
    // или статусам returned/completed. Публичные и ручные — одна таблица.
    Promise.all([
      projectUnitsApi.listReturnRequests('outgoing', 'confirmed').then(d => d.requests || []).catch(() => []),
      issuancesApi.acts().then(d => d).catch(() => ({ issuances: [], returns: [], rentDeals: [] })),
      rentApi.list().then(d => d.deals || []).catch(() => []),
    ]).then(([projReturns, acts, allDeals]) => {
      const returnsList = acts.returns || []

      const combined = [
        // Возвраты со склада проекта
        ...projReturns.map(r => ({
          id: 'p_' + r.id, source: 'project', title: r.unit_name,
          sub: `со склада проекта «${r.from_project_name}» · принял ${r.confirmed_by_name || '—'}`,
          when: r.confirmed_at, unitId: r.unit_id,
        })),
        // Возвраты по заявкам (returns table)
        ...returnsList.map(rt => ({
          id: 'rt_' + rt.id, source: 'issue',
          title: `Возврат по заявке · ${rt.returned_by_name || '—'}`,
          sub: `принял ${rt.accepted_by_name || '—'}${(rt.unit_ids || []).length ? ` · ${(rt.unit_ids || []).length} ед.` : ''}${rt.condition_notes ? ` · ${rt.condition_notes}` : ''}`,
          when: rt.returned_at, unitId: null,
        })),
        // Аренды: публичные (из внешней ссылки) и ручные — одна таблица.
        // Включаем завершённые по статусу ИЛИ с проставленным returned_at.
        ...allDeals
          .filter(d =>
            d.status === 'returned' ||
            d.status === 'completed' ||
            d.returned_at
          )
          .map(d => {
            const isPublic = !!d.requester_name || d.type === 'public' || d.requester_project
            return {
              id: 'r_' + d.id, source: 'rent',
              title: d.counterparty_name || d.requester_name || `Аренда #${String(d.id).slice(0, 8)}`,
              sub: `${isPublic ? 'партнёрская' : (d.type === 'out' ? 'исходящая' : 'входящая')}${(d.unit_ids || []).length ? ` · ${(d.unit_ids || []).length} ед.` : ''}`,
              when: d.returned_at || d.period_end || d.updated_at || d.created_at, unitId: null,
            }
          }),
      ].filter(x => x.when)
       .sort((a, b) => new Date(b.when) - new Date(a.when))
      setItems(combined)
      setLoading(false)
    })
  }, [])

  const filtered = filter === 'all' ? items : items.filter(i => i.source === filter)

  return (
    <Layout>
      <div style={{ padding: '28px 32px', maxWidth: 900 }}>
        <button onClick={() => navigate(-1)}
          style={{ background: 'none', border: 'none', color: 'var(--muted)', cursor: 'pointer',
                   fontSize: 13, marginBottom: 10, display: 'flex', alignItems: 'center', gap: 6 }}>
          <ArrowLeft size={14} /> Назад
        </button>
        <h1 style={{ fontSize: 22, fontWeight: 600, marginBottom: 2 }}>Возвраты</h1>
        <p style={{ color: 'var(--muted)', fontSize: 13, marginBottom: 18 }}>
          {loading ? '...' : `${items.length} возвратов — заявки, аренда, склад проекта`}
        </p>

        {/* Фильтр по источнику (аренда и публичная — одно и то же) */}
        <div style={{ display: 'flex', gap: 6, marginBottom: 16, flexWrap: 'wrap' }}>
          {[
            { k: 'all',     label: 'Все' },
            { k: 'issue',   label: 'Заявки' },
            { k: 'rent',    label: 'Аренда' },
            { k: 'project', label: 'Склад проекта' },
          ].map(f => (
            <button key={f.k} onClick={() => setFilter(f.k)}
              style={{
                padding: '6px 12px', borderRadius: 999, fontSize: 12, fontWeight: 500,
                border: filter === f.k ? '1.5px solid var(--accent)' : '1px solid var(--border)',
                background: filter === f.k ? 'rgba(var(--accent-rgb,249,115,22),0.08)' : 'var(--white)',
                cursor: 'pointer',
              }}>
              {f.label}
            </button>
          ))}
        </div>

        {loading ? (
          <div style={{ padding: 40, textAlign: 'center', color: 'var(--muted)' }}>Загрузка...</div>
        ) : filtered.length === 0 ? (
          <div style={{ padding: 40, textAlign: 'center', color: 'var(--muted)' }}>Нет возвратов</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {filtered.map(r => (
              <div key={r.id}
                onClick={() => r.unitId ? navigate(`/units/${r.unitId}`) : null}
                style={{
                  background: 'var(--white)', border: '1px solid var(--border)', borderRadius: 10,
                  padding: 12, display: 'flex', alignItems: 'center', gap: 12,
                  cursor: r.unitId ? 'pointer' : 'default',
                }}>
                <Badge color={SOURCE_COLOR[r.source]}>{SOURCE_LABEL[r.source]}</Badge>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13.5, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.title}</div>
                  <div style={{ fontSize: 12, color: 'var(--muted)' }}>{r.sub} · {formatDate(r.when)}</div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </Layout>
  )
}
