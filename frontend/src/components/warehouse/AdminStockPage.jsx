import React, { useEffect, useState } from 'react'
import { useLocation, useSearchParams } from 'react-router-dom'
import { Plus, Package, Receipt } from 'lucide-react'
import WarehouseLayout from './WarehouseLayout'
import ProductionLayout from '../production/ProductionLayout'
import Button from '../shared/Button'
import Badge from '../shared/Badge'
import TruncTip from '../shared/TruncTip'
import UnitCardModal from '../shared/UnitCardModal'
import AddUnitModal from '../shared/AddUnitModal'
import { useToast } from '../shared/Toast'
import { useAuth } from '../../hooks/useAuth'
import { adminUnits as adminUnitsApi } from '../../services/api'
import { CATEGORIES_FILTER, categoryLabel } from '../../constants/categories'
import { IS_CLOTHING_CAT } from '../../constants/clothingSizes'

const ADMIN_STOCK_ROLES = new Set([
  'warehouse_director', 'warehouse_deputy', 'warehouse_staff',
  'project_director', 'set_admin',
])

export default function AdminStockPage() {
  const { user } = useAuth()
  const location = useLocation()
  const [searchParams] = useSearchParams()
  const toast = useToast()

  const [units, setUnits] = useState([])
  const [loading, setLoading] = useState(true)
  const [category, setCategory] = useState('all')
  const [viewMode, setViewMode] = useState(() => localStorage.getItem('unitsViewMode') || 'grid')
  const [showAdd, setShowAdd] = useState(false)
  const [cardId, setCardId] = useState(null)

  const canUseAdminStock = ADMIN_STOCK_ROLES.has(user?.role)
  const isProduction = location.pathname.startsWith('/production/')
  const Layout = isProduction ? ProductionLayout : WarehouseLayout
  const query = searchParams.get('q') || ''

  async function reload() {
    if (!canUseAdminStock) return
    setLoading(true)
    try {
      const params = {}
      if (category !== 'all') params.category = category
      if (query.trim()) params.search = query.trim()
      const d = await adminUnitsApi.list(params)
      setUnits(d.units || [])
    } catch (err) {
      toast?.(err.message || 'Не удалось загрузить Админку', 'error')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    reload()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [category, query, canUseAdminStock])

  if (!canUseAdminStock) {
    return (
      <Layout>
        <div style={{ padding: '32px', color: 'var(--muted)' }}>Нет доступа к Админке.</div>
      </Layout>
    )
  }

  return (
    <Layout>
      <style>{`
        .as-grid {
          transform: translate3d(0, 0, 0);
          will-change: transform;
          contain: paint;
        }
        .as-grid img {
          backface-visibility: hidden;
          transform: translateZ(0);
        }
        @media (max-width: 480px) {
          .as-grid { grid-template-columns: repeat(2, 1fr) !important; gap: 10px !important; }
          .as-page { padding: 16px 12px !important; }
        }
      `}</style>

      <div className="as-page" style={{ padding: '24px 32px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', marginBottom: 20 }}>
          <div>
            <h1 style={{ fontSize: 20, fontWeight: 600 }}>Админка</h1>
            <p style={{ fontSize: 13, color: 'var(--muted)', marginTop: 2 }}>
              Запасы административного цеха и покупки для площадки
            </p>
          </div>
          <div className="as-top-add">
            <Button onClick={() => setShowAdd(true)}>
              <Plus size={14} style={{ marginRight: 6 }} /> Пополнить
            </Button>
          </div>
        </div>

        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', marginBottom: 18 }}>
          <select
            value={category}
            onChange={e => setCategory(e.target.value)}
            style={{
              height: 40, padding: '0 12px', border: '1px solid var(--border)',
              borderRadius: 'var(--radius-btn)', fontSize: 13, background: 'var(--white)', cursor: 'pointer',
            }}
          >
            {CATEGORIES_FILTER.map(c => <option key={c} value={c}>{c === 'all' ? 'Категория' : categoryLabel(c)}</option>)}
          </select>
          <span style={{ fontSize: 13, color: 'var(--muted)' }}>{units.length} ед.</span>
          <div style={{ display: 'flex', gap: 2, marginLeft: 'auto' }}>
            {[
              { mode: 'grid', icon: '▦', title: 'Карточки' },
              { mode: 'rows', icon: '☰', title: 'Строки' },
              { mode: 'list', icon: '≡', title: 'Список' },
            ].map(v => (
              <button
                key={v.mode}
                title={v.title}
                onClick={() => { setViewMode(v.mode); localStorage.setItem('unitsViewMode', v.mode) }}
                style={{
                  width: 32, height: 32, border: '1px solid var(--border)', borderRadius: 'var(--radius-btn)',
                  background: viewMode === v.mode ? 'var(--accent)' : 'var(--white)',
                  color: viewMode === v.mode ? '#fff' : 'var(--muted)',
                  fontSize: 16, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}
              >{v.icon}</button>
            ))}
          </div>
        </div>

        {loading && <div style={{ textAlign: 'center', padding: '40px 0', color: 'var(--muted)', fontSize: 14 }}>Загрузка...</div>}

        {!loading && units.length === 0 && (
          <div style={{ textAlign: 'center', padding: '48px 20px', background: 'var(--bg)', borderRadius: 12, color: 'var(--muted)' }}>
            <Package size={40} color="var(--muted)" strokeWidth={1.4} style={{ marginBottom: 12 }} />
            <div style={{ fontSize: 15, fontWeight: 500, color: 'var(--text)', marginBottom: 4 }}>Админка пока пустая</div>
            <div style={{ fontSize: 13, marginBottom: 14 }}>Здесь появятся покупки и запасы административного цеха.</div>
            <Button onClick={() => setShowAdd(true)}><Plus size={14} style={{ marginRight: 6 }} /> Пополнить</Button>
          </div>
        )}

        {!loading && viewMode === 'grid' && units.length > 0 && (
          <div className="as-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(170px, 1fr))', gap: 12 }}>
            {units.map(u => <AdminGridTile key={u.id} unit={u} onOpen={() => setCardId(u.id)} />)}
          </div>
        )}

        {!loading && viewMode === 'rows' && units.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {units.map(u => <AdminRowTile key={u.id} unit={u} onOpen={() => setCardId(u.id)} />)}
          </div>
        )}

        {!loading && viewMode === 'list' && units.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            {units.map(u => (
              <div
                key={u.id}
                onClick={() => setCardId(u.id)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 12, padding: '8px 12px',
                  background: 'var(--card)', borderRadius: 'var(--radius-btn)', cursor: 'pointer',
                }}
              >
                <div style={{ flex: 1, minWidth: 0, fontSize: 13, fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{u.name}</div>
                <span style={{ fontSize: 12, color: 'var(--muted)', flexShrink: 0 }}>{categoryLabel(u.category)}</span>
                <AdminStockBadge unit={u} />
              </div>
            ))}
          </div>
        )}
      </div>

      {cardId && (
        <UnitCardModal
          unitId={cardId}
          onClose={() => setCardId(null)}
          onChanged={() => { setCardId(null); reload() }}
        />
      )}

      <AddUnitModal
        open={showAdd}
        mode="admin"
        onClose={() => setShowAdd(false)}
        onCreated={() => { setShowAdd(false); reload() }}
      />
    </Layout>
  )
}

function AdminStockBadge({ unit }) {
  if (unit.purchased) return <Badge color="green"><Receipt size={11} /> Куплено</Badge>
  return <Badge color="muted">Запас</Badge>
}

function AdminGridTile({ unit, onOpen }) {
  return (
    <div
      onClick={onOpen}
      style={{
        background: 'var(--card)', borderRadius: 'var(--radius-card)',
        border: '1px solid var(--border)', cursor: 'pointer', overflow: 'hidden', position: 'relative',
      }}
    >
      <div style={{ aspectRatio: '1', background: 'var(--bg)', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
        {unit.photo_url
          ? <img src={unit.photo_thumb_url || unit.photo_url} alt="" loading="lazy" decoding="async" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
          : <Package size={36} color="var(--muted)" strokeWidth={1.4} />}
      </div>
      <div style={{ padding: '10px 12px' }}>
        <TruncTip as="div" style={{ fontWeight: 500, fontSize: 13 }}>{unit.name}</TruncTip>
        <TruncTip as="div" style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}
          fullText={`${categoryLabel(unit.category)}${IS_CLOTHING_CAT(unit.category) && unit.dimensions ? ` · ${unit.dimensions.split('/')[0].trim()}` : ''}`}>
          {categoryLabel(unit.category)}
          {IS_CLOTHING_CAT(unit.category) && unit.dimensions && (
            <>{' · '}<span style={{ color: 'var(--text)', fontWeight: 500 }}>{unit.dimensions.split('/')[0].trim()}</span></>
          )}
        </TruncTip>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', marginTop: 6 }}>
          <AdminStockBadge unit={unit} />
          {unit.purchase_price && <span style={{ fontSize: 11, color: 'var(--muted)' }}>{Math.round(unit.purchase_price)} ₽</span>}
        </div>
      </div>
    </div>
  )
}

function AdminRowTile({ unit, onOpen }) {
  return (
    <div style={{ background: 'var(--white)', borderRadius: 'var(--radius-card)', border: '1px solid var(--border)', overflow: 'hidden' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '14px 16px', cursor: 'pointer' }} onClick={onOpen}>
        <div style={{
          width: 52, height: 52, borderRadius: 8, flexShrink: 0, background: 'var(--bg)',
          border: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden',
        }}>
          {unit.photo_url
            ? <img src={unit.photo_thumb_url || unit.photo_url} alt="" loading="lazy" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
            : <Package size={22} color="var(--muted)" />}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 500, fontSize: 14, color: 'var(--accent)' }}>{unit.name}</div>
          <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>
            {unit.serial ? `${unit.serial} · ` : ''}{categoryLabel(unit.category)}
            {unit.purchase_price ? ` · ${Math.round(unit.purchase_price)} ₽` : ''}
          </div>
        </div>
        <AdminStockBadge unit={unit} />
      </div>
    </div>
  )
}
