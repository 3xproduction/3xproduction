// Склад проекта — каталог в стиле общего каталога директора склада.
// Объединяет три источника:
//   • own            — свои купленные/найденные единицы
//   • from_warehouse — взятые с общего склада по выдаче
//   • from_project   — одолженные у другого проекта
// Бэкенд: GET /project-units возвращает UNION ALL с полем `source`.

import React, { useState, useEffect } from 'react'
import { Plus, Send, Trash2, MoreVertical, Package } from 'lucide-react'
import ProductionLayout from './ProductionLayout'
import Badge from '../shared/Badge'
import Button from '../shared/Button'
import UnitCardModal from '../shared/UnitCardModal'
import AddUnitModal from '../shared/AddUnitModal'
import TruncTip from '../shared/TruncTip'
import UnitMissingDataBadge from '../shared/UnitMissingDataBadge'
import { missingUnitCardStyle } from '../../utils/unitMissingData'
import { useToast } from '../shared/Toast'
import { projectUnits as projectUnitsApi } from '../../services/api'
import { CATEGORIES_FILTER, categoryLabel } from '../../constants/categories'
import { IS_CLOTHING_CAT } from '../../constants/clothingSizes'
import { useAuth } from '../../hooks/useAuth'

const ROLES_CAN_ADD = new Set([
  'producer', 'project_director', 'director',
  'production_designer', 'art_director_assistant',
  'first_assistant_director', 'assistant_director',
  'props_master', 'props_assistant',
  'costumer', 'costume_assistant',
  'decorator', 'makeup_artist',
])
// Роли, которые могут переключаться между складами всех проектов.
const ANY_PROJECT_VIEWER_ROLES = new Set(['warehouse_director', 'warehouse_deputy', 'producer'])

const SOURCE_FILTERS = [
  { key: 'all',            label: 'Все источники' },
  { key: 'own',            label: 'На хранении' },
  { key: 'from_warehouse', label: 'Со склада' },
  { key: 'from_project',   label: 'От других проектов' },
]

function SourceBadge({ unit }) {
  const s = unit.source
  if (s === 'own')
    return <Badge color={unit.purchased ? 'green' : 'muted'}>{unit.purchased ? '🛒 Куплено' : '📦 На хранении'}</Badge>
  if (s === 'from_warehouse')
    return <Badge color="blue">📤 Со склада</Badge>
  if (s === 'from_project')
    return <Badge color="amber">🤝 {unit.loan_from_project_name || 'Из проекта'}</Badge>
  return null
}

export default function ProjectWarehousePage({ embedded = false }) {
  const { user } = useAuth()
  const toast = useToast()
  const [units, setUnits] = useState([])
  const [loading, setLoading] = useState(true)
  const [category, setCategory] = useState('all')
  const [sourceFilter, setSourceFilter] = useState('all')
  const [viewMode, setViewMode] = useState(() => localStorage.getItem('unitsViewMode') || 'grid')
  const [showAdd, setShowAdd] = useState(false)
  const [cardId, setCardId] = useState(null)
  const [actionUnit, setActionUnit] = useState(null) // { unit, kind: 'transfer'|'delete' }
  const [actionComment, setActionComment] = useState('')
  const [actionBusy, setActionBusy] = useState(false)
  const [menuOpenFor, setMenuOpenFor] = useState(null)
  // Селектор проекта для wh-director/deputy/producer (видят склад любого проекта).
  const canViewAnyProject = ANY_PROJECT_VIEWER_ROLES.has(user?.role)
  const [allProjects, setAllProjects] = useState([]) // [{id,name}]
  const [activeProjectId, setActiveProjectId] = useState(user?.project_id || null)

  const isViewingOwnProject = !!user?.project_id && String(activeProjectId) === String(user?.project_id)
  // Добавлять — только в свой проект (создание в чужой не поддержано на бэке).
  const canAdd = ROLES_CAN_ADD.has(user?.role) && isViewingOwnProject
  // Передавать на общий склад / списывать — для своих единиц.
  // wh-director/deputy/producer могут передавать кросс-проект; списывать — только владелец.
  const canTransferAcross = ANY_PROJECT_VIEWER_ROLES.has(user?.role)

  async function reload(projectId = activeProjectId) {
    setLoading(true)
    try {
      const params = projectId && projectId !== user?.project_id ? { project_id: projectId } : {}
      const d = await projectUnitsApi.list(params)
      setUnits(d.units || [])
    } catch (err) {
      toast?.(err.message || 'Не удалось загрузить склад проекта', 'error')
    }
    setLoading(false)
  }

  // Список всех проектов — только для тех, кто может смотреть любой склад.
  useEffect(() => {
    if (!canViewAnyProject) return
    projectUnitsApi.allProjects()
      .then(d => {
        const list = d.projects || []
        setAllProjects(list)
        // Если у юзера нет project_id (warehouse-director/deputy) — берём первый из списка.
        if (!activeProjectId && list.length > 0) setActiveProjectId(list[0].id)
      })
      .catch(() => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canViewAnyProject])

  useEffect(() => { if (activeProjectId) reload(activeProjectId) }, [activeProjectId])

  // Закрыть мини-меню при клике вне
  useEffect(() => {
    if (!menuOpenFor) return
    const close = () => setMenuOpenFor(null)
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [menuOpenFor])

  const filtered = units.filter(u =>
    (category === 'all' || u.category === category) &&
    (sourceFilter === 'all' || u.source === sourceFilter)
  )

  async function doTransfer() {
    if (!actionUnit) return
    setActionBusy(true)
    try {
      if (isViewingOwnProject) {
        // Свой проект — прямая передача (production-сторона физически отдаёт)
        await projectUnitsApi.transfer(actionUnit.unit.id, actionComment)
        toast?.('Передано на основной склад', 'success')
      } else {
        // Чужой проект — 3-дневный запрос возврата (даём проекту принести физически)
        await projectUnitsApi.requestReturn(actionUnit.unit.id, actionComment)
        toast?.('Запрос возврата отправлен — у проекта 3 дня', 'success')
      }
      setActionUnit(null); setActionComment('')
      reload(activeProjectId)
    } catch (e) { toast?.(e.message || 'Ошибка', 'error') }
    setActionBusy(false)
  }

  async function doDelete() {
    if (!actionUnit) return
    setActionBusy(true)
    try {
      await projectUnitsApi.delete(actionUnit.unit.id, actionComment)
      toast?.('Списано', 'success')
      setActionUnit(null); setActionComment('')
      reload(activeProjectId)
    } catch (e) { toast?.(e.message || 'Ошибка', 'error') }
    setActionBusy(false)
  }

  const Wrapper = embedded ? React.Fragment : ProductionLayout
  return (
    <Wrapper>
      <style>{`
        .pw-grid {
          transform: translate3d(0, 0, 0);
          will-change: transform;
          contain: paint;
        }
        .pw-grid img {
          backface-visibility: hidden;
          transform: translateZ(0);
        }
        @media (max-width: 480px) {
          .pw-grid { grid-template-columns: repeat(2, 1fr) !important; gap: 10px !important; }
          .pw-page { padding: 16px 12px !important; }
        }
        @media (max-width: 768px) {
          .pw-top-add { display: none !important; }
        }
      `}</style>
      <div className="pw-page" style={{ padding: embedded ? 0 : '24px 32px' }}>
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20, gap: 12, flexWrap: 'wrap' }}>
          <div>
            <h1 style={{ fontSize: 20, fontWeight: 600 }}>Склад проекта</h1>
            <p style={{ fontSize: 13, color: 'var(--muted)', marginTop: 2 }}>На хранении + взятые со склада + от других проектов</p>
          </div>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
            {canViewAnyProject && allProjects.length > 0 && (
              <select value={activeProjectId || ''} onChange={e => setActiveProjectId(e.target.value)}
                style={{
                  height: 40, padding: '0 12px', border: '1px solid var(--border)',
                  borderRadius: 'var(--radius-btn)', fontSize: 13, background: 'var(--white)',
                  cursor: 'pointer', maxWidth: 320,
                }}>
                {allProjects.map(p => (
                  <option key={p.id} value={p.id}>
                    🎬 {p.name}{String(p.id) === String(user?.project_id) ? ' (мой)' : ''} · {p.available_count ?? 0}
                  </option>
                ))}
              </select>
            )}
            {canAdd && (
              <div className="pw-top-add">
                <Button onClick={() => setShowAdd(true)}><Plus size={14} style={{ marginRight: 6 }} /> Добавить</Button>
              </div>
            )}
          </div>
        </div>

        {/* Filters row */}
        <div style={{ display: 'flex', gap: 10, marginBottom: 18, flexWrap: 'wrap', alignItems: 'center' }}>
          <select value={category} onChange={e => setCategory(e.target.value)} style={{
            height: 40, padding: '0 12px', border: '1px solid var(--border)',
            borderRadius: 'var(--radius-btn)', fontSize: 13, background: 'var(--white)', cursor: 'pointer',
          }}>
            {CATEGORIES_FILTER.map(c => <option key={c} value={c}>{c === 'all' ? 'Категория' : categoryLabel(c)}</option>)}
          </select>
          <select value={sourceFilter} onChange={e => setSourceFilter(e.target.value)} style={{
            height: 40, padding: '0 12px', border: '1px solid var(--border)',
            borderRadius: 'var(--radius-btn)', fontSize: 13, background: 'var(--white)', cursor: 'pointer',
          }}>
            {SOURCE_FILTERS.map(s => <option key={s.key} value={s.key}>{s.label}</option>)}
          </select>
          <span style={{ fontSize: 13, color: 'var(--muted)' }}>{filtered.length} ед.</span>
          <div style={{ display: 'flex', gap: 2, marginLeft: 'auto' }}>
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

        {loading && <div style={{ textAlign: 'center', padding: '40px 0', color: 'var(--muted)', fontSize: 14 }}>Загрузка...</div>}

        {!loading && filtered.length === 0 && (
          <EmptyState canAdd={canAdd} onAdd={() => setShowAdd(true)} />
        )}

        {/* Grid */}
        {!loading && viewMode === 'grid' && filtered.length > 0 && (
          <div className="pw-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(170px, 1fr))', gap: 12 }}>
            {filtered.map(u => (
              <GridTile
                key={`${u.source}-${u.id}`}
                unit={u}
                canTransfer={isViewingOwnProject || canTransferAcross}
                canDelete={isViewingOwnProject}
                userRole={user?.role}
                onOpen={() => setCardId(u.id)}
                menuOpen={menuOpenFor === `${u.source}-${u.id}`}
                onMenuToggle={(open) => setMenuOpenFor(open ? `${u.source}-${u.id}` : null)}
                onAction={(kind) => { setActionUnit({ unit: u, kind }); setMenuOpenFor(null) }}
              />
            ))}
          </div>
        )}

        {/* Rows */}
        {!loading && viewMode === 'rows' && filtered.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {filtered.map(u => (
              <RowTile
                key={`${u.source}-${u.id}`}
                unit={u}
                canTransfer={isViewingOwnProject || canTransferAcross}
                canDelete={isViewingOwnProject}
                userRole={user?.role}
                onOpen={() => setCardId(u.id)}
                onAction={(kind) => setActionUnit({ unit: u, kind })}
              />
            ))}
          </div>
        )}

        {/* List */}
        {!loading && viewMode === 'list' && filtered.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            {filtered.map(u => (
              <div key={`${u.source}-${u.id}`} onClick={() => setCardId(u.id)} style={{
                display: 'flex', alignItems: 'center', gap: 12, padding: '8px 12px',
                background: 'var(--card)', borderRadius: 'var(--radius-btn)', cursor: 'pointer',
              }}>
                <div style={{ flex: 1, minWidth: 0, fontSize: 13, fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{u.name}</div>
                <span style={{ fontSize: 12, color: 'var(--muted)', flexShrink: 0 }}>{categoryLabel(u.category)}</span>
                <SourceBadge unit={u} />
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Card — для чужого проекта добавляем «Запросить возврат на склад» / «Запросить на проект» */}
      {cardId && (() => {
        const u = units.find(x => x.id === cardId)
        const actions = []
        if (u && !isViewingOwnProject) {
          if (u.source === 'own') {
            // Чужой own → wh/producer просят возврат
            if (canTransferAcross) {
              actions.push({
                label: 'Запросить возврат на склад',
                variant: 'primary',
                onClick: () => { setActionUnit({ unit: u, kind: 'transfer' }); setCardId(null) },
              })
            }
          }
        }
        return <UnitCardModal unitId={cardId}
          onClose={() => setCardId(null)}
          onChanged={() => { setCardId(null); reload(activeProjectId) }}
          extraActions={actions} />
      })()}

      {/* Add */}
      <AddUnitModal
        open={showAdd}
        mode="project"
        onClose={() => setShowAdd(false)}
        onCreated={() => { setShowAdd(false); reload(activeProjectId) }}
      />

      {/* Action panel — для own единиц (transfer / delete) */}
      {actionUnit && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 600,
          display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}
          onClick={() => { setActionUnit(null); setActionComment('') }}>
          <div style={{ background: 'var(--white)', borderRadius: 'var(--radius-card)', padding: 22, maxWidth: 460, width: '100%' }}
            onClick={e => e.stopPropagation()}>
            <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 4 }}>
              {actionUnit.kind === 'transfer'
                ? (isViewingOwnProject ? 'Передать на основной склад' : 'Запросить возврат на основной склад')
                : 'Списать единицу'}
            </div>
            <div style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 14 }}>{actionUnit.unit.name}</div>
            <textarea value={actionComment} onChange={e => setActionComment(e.target.value)}
              placeholder={actionUnit.kind === 'transfer' ? 'Комментарий (опц.)' : 'Причина (опц.)'}
              style={{ width: '100%', height: 80, padding: '8px 10px', border: '1px solid var(--border)',
                borderRadius: 'var(--radius-btn)', fontSize: 13, resize: 'vertical', fontFamily: 'inherit', boxSizing: 'border-box' }} />
            <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
              <Button variant="secondary" fullWidth onClick={() => { setActionUnit(null); setActionComment('') }}>Отмена</Button>
              <Button fullWidth disabled={actionBusy}
                onClick={actionUnit.kind === 'transfer' ? doTransfer : doDelete}
                style={actionUnit.kind === 'delete' ? { background: 'var(--red)' } : {}}>
                {actionBusy ? '...' : actionUnit.kind === 'transfer'
                  ? (isViewingOwnProject ? 'Передать' : 'Запросить возврат')
                  : 'Списать'}
              </Button>
            </div>
          </div>
        </div>
      )}
    </Wrapper>
  )
}

// ────────────────────────────────────────────────────────────────────────────
function EmptyState({ canAdd, onAdd }) {
  return (
    <div style={{
      textAlign: 'center', padding: '48px 20px', color: 'var(--muted)',
      background: 'var(--bg)', borderRadius: 12,
    }}>
      <div style={{ fontSize: 40, marginBottom: 12 }}>📦</div>
      <div style={{ fontSize: 15, fontWeight: 500, color: 'var(--text)', marginBottom: 4 }}>
        На складе проекта пусто
      </div>
      <div style={{ fontSize: 13, marginBottom: 14, maxWidth: 400, marginLeft: 'auto', marginRight: 'auto' }}>
        Сюда попадут купленные/найденные для проекта вещи, выданное со склада и одолженное у других проектов.
      </div>
      {canAdd && <Button onClick={onAdd}><Plus size={14} style={{ marginRight: 6 }} /> Добавить первую</Button>}
    </div>
  )
}

function GridTile({ unit, onOpen, menuOpen, onMenuToggle, onAction, canTransfer = true, canDelete = true, userRole }) {
  const isOwn = unit.source === 'own'
  const showMenu = isOwn && (canTransfer || canDelete)
  const missingStyle = missingUnitCardStyle(unit, userRole)
  return (
    <div style={{
      background: 'var(--card)', borderRadius: 'var(--radius-card)',
      border: missingStyle.border || '1px solid var(--border)', cursor: 'pointer', overflow: 'hidden', position: 'relative',
      boxShadow: missingStyle.boxShadow,
    }} onClick={onOpen}>
      <div style={{
        aspectRatio: '1', background: 'var(--bg)', display: 'flex',
        alignItems: 'center', justifyContent: 'center', fontSize: 40, overflow: 'hidden',
      }}>
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
            <>
              {' · '}<span style={{ color: 'var(--text)', fontWeight: 500 }}>{unit.dimensions.split('/')[0].trim()}</span>
            </>
          )}
        </TruncTip>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 6, flexWrap: 'wrap' }}>
          <SourceBadge unit={unit} />
          {unit.purchased && unit.purchase_price && (
            <span style={{ fontSize: 11, color: 'var(--muted)' }}>{Math.round(unit.purchase_price)} ₽</span>
          )}
        </div>
        <UnitMissingDataBadge unit={unit} role={userRole} />
      </div>

      {/* Overflow menu — только для own (transfer/writeoff) */}
      {showMenu && !unit.pending_transfer && (
        <div style={{ position: 'absolute', top: 6, right: 6 }} onClick={e => e.stopPropagation()}>
          <button onClick={() => onMenuToggle(!menuOpen)}
            style={{
              width: 28, height: 28, borderRadius: '50%', border: 'none',
              background: 'rgba(255,255,255,0.92)', cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              boxShadow: '0 1px 3px rgba(0,0,0,0.15)',
            }}>
            <MoreVertical size={16} color="var(--text)" />
          </button>
          {menuOpen && (
            <div style={{
              position: 'absolute', top: 32, right: 0, zIndex: 50,
              background: 'var(--white)', borderRadius: 'var(--radius-btn)',
              border: '1px solid var(--border)', boxShadow: '0 4px 16px rgba(0,0,0,0.12)',
              minWidth: 180, overflow: 'hidden',
            }}>
              {canTransfer && (
                <button onClick={() => onAction('transfer')} style={menuItemStyle}>
                  <Send size={13} /> На основной склад
                </button>
              )}
              {canDelete && (
                <button onClick={() => onAction('delete')} style={{ ...menuItemStyle, color: 'var(--red)' }}>
                  <Trash2 size={13} /> Списать
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function RowTile({ unit, onOpen, onAction, canTransfer = true, canDelete = true, userRole }) {
  const isOwn = unit.source === 'own'
  const showActions = isOwn && (canTransfer || canDelete)
  const missingStyle = missingUnitCardStyle(unit, userRole)
  return (
    <div style={{
      background: 'var(--white)', borderRadius: 'var(--radius-card)',
      border: missingStyle.border || '1px solid var(--border)', overflow: 'hidden',
      boxShadow: missingStyle.boxShadow,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '14px 16px', cursor: 'pointer' }}
        onClick={onOpen}>
        <div style={{
          width: 52, height: 52, borderRadius: 8, flexShrink: 0,
          background: 'var(--bg)', border: '1px solid var(--border)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden',
        }}>
          {unit.photo_url
            ? <img src={unit.photo_thumb_url || unit.photo_url} alt="" loading="lazy" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
            : <Package size={22} color="var(--muted)" />}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 500, fontSize: 14, color: 'var(--accent)' }}>{unit.name}</div>
          <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>
            {unit.serial ? `${unit.serial} · ` : ''}{categoryLabel(unit.category)}
            {unit.purchased && unit.purchase_price ? ` · ${Math.round(unit.purchase_price)} ₽` : ''}
          </div>
          <UnitMissingDataBadge unit={unit} role={userRole} compact />
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }} onClick={e => e.stopPropagation()}>
          <SourceBadge unit={unit} />
          {showActions && !unit.pending_transfer && (
            <>
              {canTransfer && (
                <Button variant="secondary" style={{ height: 32, fontSize: 12, padding: '0 10px' }}
                  onClick={() => onAction('transfer')}>
                  <Send size={12} style={{ marginRight: 4 }} /> На склад
                </Button>
              )}
              {canDelete && (
                <Button variant="secondary" style={{ height: 32, fontSize: 12, padding: '0 10px', color: 'var(--red)' }}
                  onClick={() => onAction('delete')}>
                  <Trash2 size={12} />
                </Button>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}

const menuItemStyle = {
  width: '100%', padding: '10px 14px', border: 'none', background: 'none',
  display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, cursor: 'pointer',
  textAlign: 'left',
}
