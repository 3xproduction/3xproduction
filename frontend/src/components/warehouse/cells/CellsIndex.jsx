// Главный экран каталога склада: выбранный склад + chips-переключатель,
// три плитки-подсклада (Полки / Вешалки / Места) с иконкой и счётчиком
// секций/ячеек. Пустые типы — серая плитка с текстом «Нет секций».
// На экране также «Без места» и edit-actions (создать склад/секцию, удалить).
//
// URL: /cells — редиректит на /cells/:warehouseId для активного склада,
// /cells/:warehouseId — этот экран.

import { useEffect, useMemo, useState } from 'react'
import { useLocation, useNavigate, useParams } from 'react-router-dom'
import {
  Package, Shirt, Truck, Plus, Store, Trash2, Pencil,
  X, ChevronDown, Check,
} from 'lucide-react'
import WarehouseLayout from '../WarehouseLayout'
import ProductionLayout from '../../production/ProductionLayout'
import Button from '../../shared/Button'
import ConfirmModal from '../../shared/ConfirmModal'
import UnitCardModal from '../../shared/UnitCardModal'
import { warehouses as warehousesApi, units as unitsApi } from '../../../services/api'
import { useAuth } from '../../../hooks/useAuth'
import { useToast } from '../../shared/Toast'
import { useBodyLock } from '../../../hooks/useBodyLock'
import useWarehouseData from './useWarehouseData'
import NoPlaceList from './NoPlaceList'
import CreateSectionModal from './CreateSectionModal'
import { sumOnStockCellQty, sumUnitQty } from '../../../utils/unitQty'

const EDITOR_ROLES = ['warehouse_director', 'warehouse_deputy']

const TILES = [
  { type: 'shelf',  label: 'Полки',    hint: 'Стеллажи и полки',     Icon: Package, gradient: 'linear-gradient(135deg, #fdf5e6 0%, #f0dfb8 100%)' },
  { type: 'hanger', label: 'Вешалки',  hint: 'Штанги с плечиками',   Icon: Shirt,   gradient: 'linear-gradient(135deg, #f2efff 0%, #dcd3f2 100%)' },
  { type: 'place',  label: 'Места',    hint: 'Крупные предметы',     Icon: Truck,   gradient: 'linear-gradient(135deg, #e7f3ed 0%, #bfe0cd 100%)' },
]

export default function CellsIndex({ world = 'warehouse' } = {}) {
  const navigate = useNavigate()
  const location = useLocation()
  const { warehouseId } = useParams()
  const { user } = useAuth()
  const toast = useToast()
  // В producer-режиме редактирование выключено всегда — продюсер только смотрит.
  const canEdit = world === 'warehouse' && EDITOR_ROLES.includes(user?.role)
  // Префикс URL: для producer — /production/cells/..., для warehouse — /cells/...
  const cellsBase = world === 'production' ? '/production/cells' : '/cells'
  const Layout = world === 'production' ? ProductionLayout : WarehouseLayout

  const {
    warehouses, warehousesLoading, warehouse, sections, loading, reload,
  } = useWarehouseData(warehouseId)

  // Bootstrap: если /cells/:warehouseId нет в списке — редиректим на первый
  // из списка (или localStorage-preferred). Работает и для legacy /cells.
  useEffect(() => {
    if (warehousesLoading) return
    if (!warehouses.length) return            // покажем empty-state ниже
    if (warehouseId && warehouses.some(w => String(w.id) === String(warehouseId))) return
    const preferredName = localStorage.getItem('warehouse')
    const target = warehouses.find(w => w.name === preferredName) || warehouses[0]
    navigate(`${cellsBase}/${target.id}`, { replace: true })
  }, [warehouseId, warehouses, warehousesLoading, navigate])

  // Мобильный bottom-sheet со списком складов — chips слишком громоздкие
  // на узких экранах, ставим одну кнопку-чип + sheet.
  const [whSheetOpen, setWhSheetOpen] = useState(false)
  useBodyLock(whSheetOpen)

  // No-place: единицы без cell_id/pavilion_id — сюда из /cells legacy-state
  const [noPlaceOpen, setNoPlaceOpen] = useState(false)
  // Автооткрытие «Без места» — например, из Dashboard (state.openNoPlace)
  useEffect(() => {
    if (location.state?.openNoPlace) {
      setNoPlaceOpen(true)
      navigate(location.pathname, { replace: true, state: {} })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.state])
  const [noPlaceUnits, setNoPlaceUnits] = useState([])
  const [noPlaceLoading, setNoPlaceLoading] = useState(false)
  useEffect(() => {
    if (!noPlaceOpen) return
    setNoPlaceLoading(true)
    unitsApi.list({ status: 'on_stock' })
      .then(d => {
        const all = (d.units || []).filter(u => u && u.id)
        setNoPlaceUnits(all.filter(u => !u.cell_id && !u.pavilion_id))
      })
      .catch(() => setNoPlaceUnits([]))
      .finally(() => setNoPlaceLoading(false))
  }, [noPlaceOpen])
  const [cardId, setCardId] = useState(null)

  // Popover-формы — добавить склад
  const [showAddWh, setShowAddWh] = useState(false)
  const [newWhName, setNewWhName] = useState('')
  const [newWhAddress, setNewWhAddress] = useState('')
  const [addingWh, setAddingWh] = useState(false)

  const [confirmDelWh, setConfirmDelWh] = useState(false)
  const [createSectionOpen, setCreateSectionOpen] = useState(false)
  // Удаление зала — подтверждение.
  const [confirmDelHall, setConfirmDelHall] = useState(null)
  // Переименование зала — модалка с инпутом (объект { id, name } или null).
  const [renameHall, setRenameHall] = useState(null)
  const [renameValue, setRenameValue] = useState('')
  const [renaming, setRenaming] = useState(false)
  // Режим просмотра залов: 'grid' (плитки) или 'list' (компактные строки).
  const [viewMode, setViewMode] = useState(() => {
    try { return localStorage.getItem('cellsViewMode') || 'grid' } catch { return 'grid' }
  })
  function setViewModePersist(m) {
    setViewMode(m)
    try { localStorage.setItem('cellsViewMode', m) } catch { /* quota */ }
  }
  // Body-lock для всех оверлеев на этой странице.
  useBodyLock(
    showAddWh || noPlaceOpen || createSectionOpen || confirmDelWh ||
    whSheetOpen || !!cardId || !!confirmDelHall || !!renameHall
  )

  async function handleRenameHall() {
    if (!renameHall) return
    const next = renameValue.trim()
    if (!next) { toast?.('Имя не может быть пустым', 'error'); return }
    if (next === renameHall.name) { setRenameHall(null); return }
    setRenaming(true)
    try {
      await warehousesApi.updateSection(renameHall.id, { name: next })
      setRenameHall(null)
      reload()
      toast?.('Имя зала обновлено', 'success')
    } catch (e) {
      toast?.(e.message || 'Ошибка', 'error')
    } finally {
      setRenaming(false)
    }
  }

  async function handleDeleteHall(id) {
    try {
      await warehousesApi.deleteSection(id)
      setConfirmDelHall(null)
      reload()
      toast?.('Зал удалён', 'success')
    } catch (e) { toast?.(e.message || 'Ошибка', 'error') }
  }

  // Подсчитываем секции по типу и ячейки (для счётчиков на плитках)
  const stats = useMemo(() => {
    const map = { shelf: { sections: 0, total: 0, occ: 0 },
                  hanger: { sections: 0, total: 0, occ: 0 },
                  place:  { sections: 0, total: 0, occ: 0 } }
    for (const s of sections) {
      // Дочерние секции зала не считаем в Полки/Вешалки/Места на уровне склада.
      if (s.parent_section_id) continue
      const t = s.type || 'shelf'
      if (!map[t]) continue
      map[t].sections += 1
      map[t].total += (s.cells || []).length
      map[t].occ += sumOnStockCellQty(s.cells)
    }
    return map
  }, [sections])

  // Залы без типа (type='hall') рендерятся отдельными плитками — это
  // созданные с уровня CellsIndex залы, которые не сводятся в Полки/Вешалки/Места.
  const halls = useMemo(
    () => sections.filter(s => s.type === 'hall'),
    [sections],
  )

  async function handleAddWarehouse() {
    if (!newWhName.trim()) return
    setAddingWh(true)
    try {
      const data = await warehousesApi.create({
        name: newWhName.trim(),
        address: newWhAddress.trim() || undefined,
      })
      const wh = data.warehouse
      toast?.(`Склад "${wh.name}" создан`, 'success')
      setShowAddWh(false)
      setNewWhName('')
      setNewWhAddress('')
      try { localStorage.setItem('warehouse', wh.name) } catch { /* ignore */ }
      navigate(`${cellsBase}/${wh.id}`, { replace: true })
    } catch (e) {
      toast?.(e.message || 'Ошибка создания склада', 'error')
    } finally {
      setAddingWh(false)
    }
  }

  async function handleDeleteWarehouse() {
    try {
      await warehousesApi.deleteWarehouse(warehouseId)
      setConfirmDelWh(false)
      // Сброс кэша sessionStorage — без этого удалённый склад ещё виден
      // на CellsIndex после reload() из-за hydrate-из-кэша.
      try {
        sessionStorage.removeItem('cells:warehouses')
        sessionStorage.removeItem(`cells:sections:${warehouseId}`)
      } catch { /* ignore */ }
      toast?.('Склад удалён', 'success')
      const rest = warehouses.filter(w => String(w.id) !== String(warehouseId))
      if (rest.length) navigate(`${cellsBase}/${rest[0].id}`, { replace: true })
      else navigate(cellsBase, { replace: true })
    } catch (e) {
      toast?.(e.message || 'Ошибка', 'error')
    }
  }

  const totalSections = sections.length

  return (
    <Layout>
      <Styles />

      <div className="ci-page catalog-enter">
        {/* Нет ни одного склада — empty-state на весь экран */}
        {!warehousesLoading && warehouses.length === 0 ? (
          <EmptyState
            icon={<Store size={48} strokeWidth={1.2} />}
            title="Пока нет ни одного склада"
            hint="Создайте первый склад, чтобы добавлять секции и места"
            cta={canEdit && {
              label: 'Создать склад',
              onClick: () => setShowAddWh(true),
            }}
          />
        ) : (
          <>
            {/* Sticky header — без back, это root каталога */}
            <div className="ci-header">
              <div className="ci-header-row">
                <div className="ci-titles">
                  <div className="ci-title">Склады</div>
                  <div className="ci-subtitle">
                    {warehouse?.name || 'Выберите склад'}
                    {warehouse?.address ? ` · ${warehouse.address}` : ''}
                  </div>
                </div>
                <div className="ci-header-actions">
                  {canEdit && (
                    <button className="ci-icon-btn" onClick={() => setShowAddWh(true)}
                            title="Добавить склад">
                      <Plus size={18} strokeWidth={2} />
                    </button>
                  )}
                </div>
              </div>

              {/* Desktop: chips-переключатель (scroll-x). Mobile: один
                  селектор-чип, клик → bottom-sheet со всеми складами. */}
              {warehouses.length > 0 && (
                <>
                  <div className="ci-chips">
                    {warehouses.map(w => (
                      <button key={w.id}
                        className={`wh-chip ${String(w.id) === String(warehouseId) ? 'active' : ''}`}
                        onClick={() => {
                          try { localStorage.setItem('warehouse', w.name) } catch { /* ignore */ }
                          navigate(`${cellsBase}/${w.id}`)
                        }}>
                        <Store size={12} strokeWidth={1.8} />
                        {w.name}
                      </button>
                    ))}
                  </div>
                  <button className="ci-wh-mobile-btn"
                    onClick={() => setWhSheetOpen(true)}
                  >
                    <Store size={14} strokeWidth={1.8} />
                    <span className="ci-wh-mobile-name">{warehouse?.name || 'Выбрать склад'}</span>
                    <span className="ci-wh-mobile-count">{warehouses.length}</span>
                    <ChevronDown size={16} strokeWidth={1.8} />
                  </button>
                </>
              )}
            </div>

            {/* Body */}
            <div className="ci-body">
              {loading ? (
                <div className="ci-loader">Загрузка…</div>
              ) : totalSections === 0 ? (
                <EmptyState
                  icon={<Package size={48} strokeWidth={1.2} />}
                  title="Нет секций"
                  hint="Создайте первую секцию, чтобы начать заполнение склада"
                  cta={canEdit && {
                    label: 'Создать зал',
                    onClick: () => setCreateSectionOpen(true),
                  }}
                />
              ) : (
                <>
                  {/* Тумблер режима просмотра залов: плитки или компактный список. */}
                  {halls.length > 0 && (
                    <div className="ci-view-toggle">
                      {[
                        { mode: 'grid', icon: '▦', title: 'Плитки' },
                        { mode: 'list', icon: '☰', title: 'Список' },
                      ].map(v => (
                        <button key={v.mode}
                          title={v.title}
                          onClick={() => setViewModePersist(v.mode)}
                          className={`ci-view-btn${viewMode === v.mode ? ' active' : ''}`}
                        >{v.icon}</button>
                      ))}
                    </div>
                  )}
                  <div className="ci-tiles">
                    {TILES.map(t => {
                      const st = stats[t.type]
                      // Пустые плитки не показываем — секции shelf/hanger/place
                      // теперь создаются только внутри залов.
                      if (st.sections === 0) return null
                      return (
                        <button key={t.type}
                          className="ci-tile"
                          onClick={() => navigate(`${cellsBase}/${warehouseId}/type/${t.type}`)}
                        >
                          <div className="ci-tile-thumb" style={{ background: t.gradient }}>
                            <t.Icon size={44} strokeWidth={1.2} color="var(--gold-600)" />
                            {st.occ > 0 && (
                              <div className="ci-tile-occ">{st.occ}</div>
                            )}
                          </div>
                          <div className="ci-tile-body">
                            <div className="ci-tile-label">{t.label}</div>
                            <div className="ci-tile-hint">
                              {`${st.sections} ${pluralSections(st.sections)}`}
                            </div>
                          </div>
                        </button>
                      )
                    })}

                    {/* Залы в grid-режиме рендерим прямо здесь как плитки. */}
                    {viewMode === 'grid' && halls.map(h => {
                      const childSections = sections.filter(
                        s => String(s.parent_section_id) === String(h.id)
                      )
                      const occ = childSections.reduce(
                        (sum, c) => sum + sumOnStockCellQty(c.cells), 0,
                      )
                      // Детализация по типам: «2 полки · 1 вешалка · 3 места».
                      // Показываем только ненулевые; если всё ноль — «Пусто».
                      const counts = { shelf: 0, hanger: 0, place: 0 }
                      for (const s of childSections) counts[s.type] = (counts[s.type] || 0) + 1
                      const parts = []
                      if (counts.shelf)  parts.push(`${counts.shelf} ${pluralShelf(counts.shelf)}`)
                      if (counts.hanger) parts.push(`${counts.hanger} ${pluralHanger(counts.hanger)}`)
                      if (counts.place)  parts.push(`${counts.place} ${pluralPlace(counts.place)}`)
                      const hintText = parts.length ? parts.join(' · ') : 'Пусто'
                      return (
                        <div key={h.id} className="ci-tile-wrap">
                          {canEdit && (
                            <>
                              <button
                                className="ci-tile-edit"
                                title="Переименовать зал"
                                onClick={(e) => { e.stopPropagation(); setRenameValue(h.name); setRenameHall(h) }}
                              >
                                <Pencil size={14} strokeWidth={1.8} />
                              </button>
                              <button
                                className="ci-tile-del"
                                title="Удалить зал"
                                onClick={(e) => { e.stopPropagation(); setConfirmDelHall(h) }}
                              >
                                <Trash2 size={14} strokeWidth={1.8} />
                              </button>
                            </>
                          )}
                          <button
                            className="ci-tile"
                            onClick={() => navigate(`${cellsBase}/${warehouseId}/hall/${h.id}`)}
                          >
                            <div className="ci-tile-thumb" style={{
                              background: 'linear-gradient(135deg, #f5efe4 0%, #e8d9c0 100%)',
                            }}>
                              <Store size={44} strokeWidth={1.2} color="var(--gold-600)" />
                              {occ > 0 && <div className="ci-tile-occ">{occ}</div>}
                            </div>
                            <div className="ci-tile-body">
                              <div className="ci-tile-label">{h.name}</div>
                              <div className="ci-tile-hint">{hintText}</div>
                            </div>
                          </button>
                        </div>
                      )
                    })}

                    {(viewMode === 'grid' || halls.length === 0) && canEdit && (
                      <button
                        className="ci-tile phantom"
                        onClick={() => setCreateSectionOpen(true)}
                      >
                        <div className="ci-tile-thumb phantom-thumb">
                          <Plus size={44} strokeWidth={1.5} />
                        </div>
                        <div className="ci-tile-body">
                          <div className="ci-tile-label ci-tile-label-phantom">Создать зал</div>
                        </div>
                      </button>
                    )}
                  </div>

                  {/* Список-режим залов: компактные строки. На мобилке удобнее
                      чем плитки — больше залов на экране, плюс кнопки изменить/
                      удалить inline. */}
                  {viewMode === 'list' && halls.length > 0 && (
                    <div className="ci-list">
                      {halls.map(h => {
                        const childSections = sections.filter(
                          s => String(s.parent_section_id) === String(h.id)
                        )
                        const occ = childSections.reduce(
                        (sum, c) => sum + sumOnStockCellQty(c.cells), 0,
                      )
                        const counts = { shelf: 0, hanger: 0, place: 0 }
                        for (const s of childSections) counts[s.type] = (counts[s.type] || 0) + 1
                        const parts = []
                        if (counts.shelf)  parts.push(`${counts.shelf} ${pluralShelf(counts.shelf)}`)
                        if (counts.hanger) parts.push(`${counts.hanger} ${pluralHanger(counts.hanger)}`)
                        if (counts.place)  parts.push(`${counts.place} ${pluralPlace(counts.place)}`)
                        const hintText = parts.length ? parts.join(' · ') : 'Пусто'
                        return (
                          <div key={h.id} className="ci-list-row"
                            onClick={() => navigate(`${cellsBase}/${warehouseId}/hall/${h.id}`)}
                          >
                            <div className="ci-list-icon">
                              <Store size={20} strokeWidth={1.6} color="var(--gold-600)" />
                            </div>
                            <div className="ci-list-main">
                              <div className="ci-list-name">{h.name}</div>
                              <div className="ci-list-hint">{hintText}{occ > 0 ? ` · ${occ} ед.` : ''}</div>
                            </div>
                            {canEdit && (
                              <div className="ci-list-actions" onClick={e => e.stopPropagation()}>
                                <button
                                  className="ci-list-act"
                                  title="Переименовать зал"
                                  onClick={() => { setRenameValue(h.name); setRenameHall(h) }}
                                >
                                  <Pencil size={16} strokeWidth={1.8} />
                                </button>
                                <button
                                  className="ci-list-act ci-list-act-del"
                                  title="Удалить зал"
                                  onClick={() => setConfirmDelHall(h)}
                                >
                                  <Trash2 size={16} strokeWidth={1.8} />
                                </button>
                              </div>
                            )}
                          </div>
                        )
                      })}
                      {canEdit && (
                        <button
                          className="ci-list-row ci-list-add"
                          onClick={() => setCreateSectionOpen(true)}
                        >
                          <div className="ci-list-icon"><Plus size={20} strokeWidth={1.6} /></div>
                          <div className="ci-list-main">
                            <div className="ci-list-name">Создать зал</div>
                          </div>
                        </button>
                      )}
                    </div>
                  )}

                  {canEdit && (
                    <div className="ci-footer-actions">
                      <Button
                        variant="secondary"
                        style={{ color: 'var(--red)', borderColor: 'var(--red-dim)' }}
                        onClick={() => setConfirmDelWh(true)}
                      >
                        <Trash2 size={14} /> Удалить склад
                      </Button>
                    </div>
                  )}
                </>
              )}
            </div>
          </>
        )}

        {/* Popover: add warehouse (fixed modal стиль) */}
        {showAddWh && (
          <ModalCard title="Новый склад" onClose={() => setShowAddWh(false)}>
            <label className="ci-label">Название</label>
            <input autoFocus value={newWhName} onChange={e => setNewWhName(e.target.value)}
              placeholder="Основной склад, Цех №2…"
              className="ci-input"
            />
            <label className="ci-label">Адрес</label>
            <input value={newWhAddress} onChange={e => setNewWhAddress(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleAddWarehouse()}
              placeholder="ул. Вирки, 22"
              className="ci-input"
            />
            <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
              <Button variant="secondary" size="sm" fullWidth onClick={() => setShowAddWh(false)}>Отмена</Button>
              <Button size="sm" fullWidth disabled={!newWhName.trim() || addingWh} onClick={handleAddWarehouse}>
                {addingWh ? 'Создание…' : 'Создать'}
              </Button>
            </div>
          </ModalCard>
        )}

        {/* Mobile warehouse sheet: вертикальный список складов. */}
        {whSheetOpen && (
          <div className="ci-wh-sheet-overlay" onClick={() => setWhSheetOpen(false)}>
            <div className="ci-wh-sheet" onClick={e => e.stopPropagation()}>
              <div className="ci-wh-sheet-handle" />
              <div className="ci-wh-sheet-title">Склады</div>
              <div className="ci-wh-sheet-list">
                {warehouses.map(w => {
                  const active = String(w.id) === String(warehouseId)
                  return (
                    <button key={w.id}
                      className={`ci-wh-sheet-item ${active ? 'active' : ''}`}
                      onClick={() => {
                        try { localStorage.setItem('warehouse', w.name) } catch { /* ignore */ }
                        setWhSheetOpen(false)
                        navigate(`${cellsBase}/${w.id}`)
                      }}
                    >
                      <div className="ci-wh-sheet-ico"><Store size={18} strokeWidth={1.8} /></div>
                      <div className="ci-wh-sheet-body">
                        <div className="ci-wh-sheet-name">{w.name}</div>
                        {w.address && <div className="ci-wh-sheet-addr">{w.address}</div>}
                      </div>
                      {active && <Check size={16} strokeWidth={2} className="ci-wh-sheet-check" />}
                    </button>
                  )
                })}
              </div>
              {canEdit && (
                <button
                  className="ci-wh-sheet-add"
                  onClick={() => { setWhSheetOpen(false); setShowAddWh(true) }}
                >
                  <Plus size={16} strokeWidth={2} /> Добавить склад
                </button>
              )}
            </div>
          </div>
        )}

        {/* No-place sheet */}
        {noPlaceOpen && (
          <ModalCard
            title="Без места"
            subtitle={noPlaceLoading ? 'Загрузка…' : `${sumUnitQty(noPlaceUnits)} единиц на складе`}
            onClose={() => setNoPlaceOpen(false)}
          >
            <NoPlaceList
              units={noPlaceUnits}
              loading={noPlaceLoading}
              onOpenCard={(id) => { setCardId(id); setNoPlaceOpen(false) }}
            />
          </ModalCard>
        )}

        {/* Confirm delete warehouse */}
        <CreateSectionModal
          open={createSectionOpen}
          warehouseId={warehouseId}
          // С этого уровня создаём «просто зал» — без выбора типа.
          // Тип принудительно 'hall' — такие секции рендерятся отдельными
          // плитками на CellsIndex, не сливаются в Полки/Вешалки/Места.
          showTypeSelector={false}
          forceType="hall"
          onClose={() => setCreateSectionOpen(false)}
          onCreated={() => {
            setCreateSectionOpen(false)
            reload?.()
          }}
        />

        <ConfirmModal
          open={confirmDelWh}
          title="Удалить склад?"
          message={`Склад "${warehouse?.name || ''}" будет удалён вместе со всеми секциями и местами.`}
          confirmLabel="Удалить"
          danger
          onConfirm={handleDeleteWarehouse}
          onCancel={() => setConfirmDelWh(false)}
        />

        <ConfirmModal
          open={!!confirmDelHall}
          title="Удалить зал?"
          message={`Зал "${confirmDelHall?.name || ''}" и все секции внутри будут удалены.`}
          confirmLabel="Удалить"
          danger
          onConfirm={() => handleDeleteHall(confirmDelHall.id)}
          onCancel={() => setConfirmDelHall(null)}
        />

        {renameHall && (
          <div
            className="ci-rename-overlay"
            onClick={() => !renaming && setRenameHall(null)}
          >
            <div className="ci-rename-modal" onClick={e => e.stopPropagation()}>
              <div className="ci-rename-title">Переименовать зал</div>
              <input
                className="ci-rename-input"
                value={renameValue}
                onChange={e => setRenameValue(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter') handleRenameHall()
                  if (e.key === 'Escape' && !renaming) setRenameHall(null)
                }}
                autoFocus
                placeholder="Имя зала"
                disabled={renaming}
              />
              <div className="ci-rename-actions">
                <Button
                  variant="secondary"
                  onClick={() => setRenameHall(null)}
                  disabled={renaming}
                >Отмена</Button>
                <Button onClick={handleRenameHall} disabled={renaming || !renameValue.trim()}>
                  {renaming ? 'Сохраняю…' : 'Сохранить'}
                </Button>
              </div>
            </div>
          </div>
        )}

        {cardId && (
          <UnitCardModal
            unitId={cardId}
            onClose={() => { setCardId(null); reload() }}
          />
        )}
      </div>
    </Layout>
  )
}

function pluralSections(n) {
  const mod10 = n % 10, mod100 = n % 100
  if (mod10 === 1 && mod100 !== 11) return 'секция'
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return 'секции'
  return 'секций'
}

function pluralShelf(n) {
  const mod10 = n % 10, mod100 = n % 100
  if (mod10 === 1 && mod100 !== 11) return 'полка'
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return 'полки'
  return 'полок'
}

function pluralHanger(n) {
  const mod10 = n % 10, mod100 = n % 100
  if (mod10 === 1 && mod100 !== 11) return 'вешалка'
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return 'вешалки'
  return 'вешалок'
}

function pluralPlace(n) {
  const mod10 = n % 10, mod100 = n % 100
  if (mod10 === 1 && mod100 !== 11) return 'место'
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return 'места'
  return 'мест'
}

function EmptyState({ icon, title, hint, cta }) {
  return (
    <div className="ci-empty">
      <div className="ci-empty-icon">{icon}</div>
      <div className="ci-empty-title">{title}</div>
      {hint && <div className="ci-empty-hint">{hint}</div>}
      {cta && <Button onClick={cta.onClick}><Plus size={14} /> {cta.label}</Button>}
    </div>
  )
}

function ModalCard({ title, subtitle, onClose, children }) {
  return (
    <div className="ci-modal-bg" onClick={onClose}>
      <div className="ci-modal" onClick={e => e.stopPropagation()}>
        <div className="ci-modal-head">
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="ci-modal-title">{title}</div>
            {subtitle && <div className="ci-modal-sub">{subtitle}</div>}
          </div>
          <button className="ci-modal-close" onClick={onClose}>✕</button>
        </div>
        <div className="ci-modal-body">{children}</div>
      </div>
    </div>
  )
}

function Styles() {
  return (
    <style>{`
      .ci-page {
        display: flex; flex-direction: column;
        min-height: calc(100vh - 60px);
        min-height: calc(100dvh - 60px);
      }
      .ci-header {
        position: sticky; top: var(--page-sticky-top, 56px); z-index: 15;
        background: rgba(255,255,255,0.85);
        backdrop-filter: saturate(180%) blur(18px);
        -webkit-backdrop-filter: saturate(180%) blur(18px);
        border-bottom: 1px solid var(--border);
        padding: 14px 24px;
      }
      .ci-header-row {
        display: flex; align-items: center; gap: 12px; min-height: 38px;
      }
      .ci-titles { flex: 1; min-width: 0; }
      .ci-title {
        font-size: 24px; font-weight: 700; letter-spacing: -0.01em;
        color: var(--text); line-height: 1.1;
      }
      .ci-subtitle {
        font-size: 13px; color: var(--muted); margin-top: 3px;
        overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
      }
      .ci-header-actions { display: flex; gap: 6px; flex-shrink: 0; }
      .ci-icon-btn {
        width: 38px; height: 38px; border-radius: 10px;
        border: 1px solid var(--border); background: var(--white);
        color: var(--text);
        display: inline-flex; align-items: center; justify-content: center;
        cursor: pointer; transition: all 0.12s;
      }
      .ci-icon-btn:hover { border-color: var(--gold-500); color: var(--gold-600); }

      .ci-chips {
        display: flex; gap: 8px; overflow-x: auto; padding-top: 12px;
        scrollbar-width: thin;
      }
      .wh-chip {
        padding: 6px 14px 6px 10px; border-radius: 18px;
        border: 1px solid var(--border-strong);
        background: transparent;
        cursor: pointer;
        font-size: 12px; font-weight: 450;
        color: var(--text);
        font-family: inherit;
        transition: all 0.15s;
        white-space: nowrap;
        display: inline-flex; align-items: center; gap: 6px; flex-shrink: 0;
      }
      .wh-chip:hover { border-color: var(--gold-500); color: var(--gold-600); }
      .wh-chip.active {
        border-color: var(--gold-500);
        background: var(--gold-100);
        color: var(--gold-600);
        font-weight: 500;
      }

      .ci-body { padding: 22px 24px 40px; flex: 1; }
      .ci-loader { text-align: center; padding: 40px 0; color: var(--muted); }

      .ci-tiles {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
        gap: 16px;
        max-width: 960px;
      }
      .ci-tile-wrap { position: relative; }
      .ci-tile-wrap .ci-tile { width: 100%; }
      .ci-tile-del,
      .ci-tile-edit {
        position: absolute;
        top: 10px;
        width: 30px; height: 30px;
        border-radius: 9px;
        border: 1px solid var(--border);
        background: rgba(255,255,255,0.94);
        display: inline-flex; align-items: center; justify-content: center;
        cursor: pointer;
        opacity: 0;
        transition: opacity 0.15s, background 0.12s, border-color 0.12s, transform 0.12s, color 0.12s;
        backdrop-filter: blur(6px); -webkit-backdrop-filter: blur(6px);
        z-index: 3;
      }
      .ci-tile-del  { left: 10px; color: var(--red); }
      .ci-tile-edit { left: 46px; color: var(--muted); }
      .ci-tile-wrap:hover .ci-tile-del,
      .ci-tile-wrap:hover .ci-tile-edit { opacity: 1; }
      .ci-tile-del:hover {
        background: var(--red); color: #fff; border-color: var(--red);
        transform: scale(1.05);
      }
      .ci-tile-edit:hover {
        background: var(--gold-500); color: #fff; border-color: var(--gold-500);
        transform: scale(1.05);
      }
      @media (max-width: 768px) {
        .ci-tile-del,
        .ci-tile-edit { opacity: 1; }
      }
      .ci-tile {
        display: flex; flex-direction: column;
        background: var(--white);
        border: 1px solid var(--border);
        border-radius: 16px;
        overflow: hidden;
        cursor: pointer;
        padding: 0; font-family: inherit;
        text-align: left;
        transition: transform 0.15s ease, box-shadow 0.15s ease, border-color 0.15s ease;
      }
      .ci-tile:not(.empty):hover {
        transform: translateY(-2px);
        box-shadow: 0 12px 28px rgba(0,0,0,0.08);
        border-color: var(--gold-500);
      }
      .ci-tile.empty {
        cursor: default;
        opacity: 0.7;
      }
      .ci-tile.phantom {
        border-style: dashed;
        border-color: var(--gold-500);
      }
      .ci-tile.phantom:hover {
        transform: translateY(-2px);
        box-shadow: 0 12px 28px rgba(0,0,0,0.08);
      }
      .ci-tile-thumb.phantom-thumb {
        background: var(--paper);
        color: var(--gold-500);
      }
      .ci-tile-label-phantom {
        color: var(--gold-600);
      }
      .ci-tile-thumb {
        position: relative;
        aspect-ratio: 16 / 10;
        display: flex; align-items: center; justify-content: center;
      }
      .ci-tile-occ {
        position: absolute; top: 10px; right: 10px;
        background: rgba(255,255,255,0.85);
        backdrop-filter: blur(8px); -webkit-backdrop-filter: blur(8px);
        padding: 4px 10px; border-radius: 999px;
        font-size: 12px; font-weight: 600;
        color: var(--text);
        box-shadow: 0 1px 4px rgba(0,0,0,0.08);
      }
      .ci-tile-body { padding: 14px 16px 16px; }
      .ci-tile-label {
        font-size: 16px; font-weight: 600; color: var(--text);
        letter-spacing: -0.005em;
      }
      .ci-tile-hint {
        font-size: 12px; color: var(--muted); margin-top: 3px;
      }

      .ci-footer-actions {
        display: flex; gap: 10px; margin-top: 28px; flex-wrap: wrap;
      }

      .ci-empty {
        flex: 1;
        display: flex; flex-direction: column; align-items: center; justify-content: center;
        padding: 80px 24px;
        text-align: center;
      }
      .ci-empty-icon {
        width: 96px; height: 96px; border-radius: 28px;
        background: var(--gold-100); color: var(--gold-600);
        display: flex; align-items: center; justify-content: center;
        margin-bottom: 22px;
      }
      .ci-empty-title {
        font-size: 22px; font-weight: 700; letter-spacing: -0.01em;
        color: var(--text); margin-bottom: 6px;
      }
      .ci-empty-hint {
        font-size: 14px; color: var(--muted); max-width: 380px;
        margin-bottom: 22px;
      }

      .ci-modal-bg {
        position: fixed; inset: 0; z-index: 500;
        background: rgba(0,0,0,0.45);
        backdrop-filter: blur(4px); -webkit-backdrop-filter: blur(4px);
        display: flex; align-items: center; justify-content: center;
        padding: 20px;
      }
      .ci-modal {
        width: 100%; max-width: 420px;
        background: var(--white);
        border-radius: 18px;
        box-shadow: 0 20px 60px rgba(0,0,0,0.25);
        max-height: 85vh; overflow: hidden;
        display: flex; flex-direction: column;
      }
      .ci-modal-head {
        display: flex; align-items: flex-start; gap: 10px;
        padding: 16px 20px 10px;
      }
      .ci-modal-title {
        font-size: 17px; font-weight: 700; color: var(--text);
      }
      .ci-modal-sub {
        font-size: 12px; color: var(--muted); margin-top: 2px;
      }
      .ci-modal-close {
        background: none; border: none; cursor: pointer;
        font-size: 20px; line-height: 1; color: var(--muted);
        padding: 0 4px;
      }
      .ci-modal-body { padding: 6px 20px 20px; overflow-y: auto; }

      .ci-label {
        display: block; font-size: 11px; font-weight: 600;
        text-transform: uppercase; letter-spacing: 0.4px;
        color: var(--muted); margin: 10px 0 4px;
      }
      .ci-input {
        width: 100%; height: 36px; padding: 0 12px;
        border: 1px solid var(--border); border-radius: 8px;
        background: var(--white); font: inherit; font-size: 14px;
        outline: none; box-sizing: border-box;
      }
      .ci-input:focus { border-color: var(--gold-500); }

      /* Shared np-row из NoPlaceList */
      .np-row {
        display: flex; align-items: center; gap: 10px;
        padding: 10px;
        border-radius: 8px;
        border: 1px solid var(--border);
        cursor: pointer;
        background: var(--card);
        margin-bottom: 8px;
        transition: border-color 0.12s;
      }
      .np-row:hover { border-color: var(--gold-500); }
      .np-thumb {
        width: 44px; height: 44px; border-radius: 6px;
        background: var(--paper); border: 1px solid var(--border);
        display: flex; align-items: center; justify-content: center;
        overflow: hidden; flex-shrink: 0;
      }
      .np-thumb img { width: 100%; height: 100%; object-fit: contain; }
      .np-name { font-size: 13.5px; font-weight: 500; color: var(--text); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .np-meta { font-size: 11px; color: var(--muted); margin-top: 2px; }

      /* ─── Mobile warehouse selector (chip-button + bottom-sheet) ─── */
      .ci-wh-mobile-btn {
        display: none;
        align-items: center;
        gap: 8px;
        width: 100%;
        height: 44px;
        margin-top: 12px;
        padding: 0 12px;
        border: 1px solid var(--border-strong);
        border-radius: 14px;
        background: var(--paper);
        color: var(--text);
        font-family: inherit;
        font-size: 14px;
        font-weight: 500;
        cursor: pointer;
        text-align: left;
      }
      .ci-wh-mobile-name {
        flex: 1;
        overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
      }
      .ci-wh-mobile-count {
        display: inline-flex; align-items: center; justify-content: center;
        height: 20px; min-width: 20px; padding: 0 7px;
        border-radius: 999px;
        background: var(--gold-100);
        color: var(--gold-600);
        font-size: 11px; font-weight: 600;
      }

      .ci-wh-sheet-overlay {
        position: fixed; inset: 0; z-index: 600;
        background: rgba(10,10,10,0.48);
        backdrop-filter: blur(4px); -webkit-backdrop-filter: blur(4px);
        display: flex; align-items: flex-end; justify-content: center;
        animation: ci-fade 0.14s ease-out;
      }
      @keyframes ci-fade { from { opacity: 0; } to { opacity: 1; } }
      .ci-wh-sheet {
        width: 100%; max-width: 520px;
        background: var(--white);
        border-radius: 20px 20px 0 0;
        padding: 6px 16px calc(20px + env(safe-area-inset-bottom, 0px));
        max-height: 75vh;
        display: flex; flex-direction: column;
        animation: ci-slide-up 0.22s cubic-bezier(0.2, 0.8, 0.2, 1);
        box-shadow: 0 -8px 30px rgba(0,0,0,0.2);
      }
      @keyframes ci-slide-up {
        from { transform: translateY(20px); opacity: 0.5; }
        to   { transform: translateY(0); opacity: 1; }
      }
      .ci-wh-sheet-handle {
        width: 40px; height: 4px; border-radius: 2px;
        background: var(--border-strong);
        margin: 8px auto 14px;
        flex-shrink: 0;
      }
      .ci-wh-sheet-title {
        font-size: 13px; font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.06em;
        color: var(--muted);
        padding: 0 4px 8px;
        flex-shrink: 0;
      }
      .ci-wh-sheet-list {
        overflow-y: auto;
        display: flex; flex-direction: column; gap: 4px;
        flex: 1; min-height: 0;
        -webkit-overflow-scrolling: touch;
      }
      .ci-wh-sheet-item {
        display: flex; align-items: center; gap: 12px;
        width: 100%; padding: 12px 10px;
        background: transparent;
        border: 1px solid transparent;
        border-radius: 12px;
        cursor: pointer;
        font-family: inherit;
        text-align: left;
        transition: background 0.12s, border-color 0.12s;
      }
      .ci-wh-sheet-item:active,
      .ci-wh-sheet-item:hover { background: var(--paper); }
      .ci-wh-sheet-item.active {
        background: var(--gold-100);
        border-color: var(--gold-500);
      }
      .ci-wh-sheet-ico {
        width: 36px; height: 36px;
        border-radius: 10px;
        background: var(--paper);
        color: var(--gold-600);
        display: inline-flex; align-items: center; justify-content: center;
        flex-shrink: 0;
      }
      .ci-wh-sheet-item.active .ci-wh-sheet-ico {
        background: var(--white);
        color: var(--gold-600);
      }
      .ci-wh-sheet-body { flex: 1; min-width: 0; }
      .ci-wh-sheet-name {
        font-size: 14px; font-weight: 600; color: var(--text);
        line-height: 1.3;
        overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
      }
      .ci-wh-sheet-addr {
        font-size: 12px; color: var(--muted); margin-top: 2px;
        overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
      }
      .ci-wh-sheet-check { color: var(--gold-600); flex-shrink: 0; }
      .ci-wh-sheet-add {
        display: inline-flex; align-items: center; justify-content: center;
        gap: 8px;
        width: 100%; height: 44px;
        margin-top: 12px;
        border: 1px dashed var(--gold-500);
        border-radius: 12px;
        background: transparent;
        color: var(--gold-600);
        font: inherit; font-size: 14px; font-weight: 600;
        cursor: pointer;
        flex-shrink: 0;
      }
      .ci-wh-sheet-add:active { background: var(--gold-100); }

      @media (max-width: 768px) {
        .ci-header { padding: 12px 14px; }
        .ci-title { font-size: 20px; }
        .ci-body { padding: 18px 14px 80px; }
        .ci-tiles { grid-template-columns: 1fr; gap: 12px; }
        /* На мобилке скрываем горизонтальные chips и показываем
           селектор-кнопку, открывающий bottom-sheet. */
        .ci-chips { display: none; }
        .ci-wh-mobile-btn { display: flex; }
      }

      /* Тумблер режима просмотра (плитки / список). */
      .ci-view-toggle {
        display: flex; gap: 4px; margin-bottom: 14px; justify-content: flex-end;
      }
      .ci-view-btn {
        width: 32px; height: 32px;
        border: 1px solid var(--border); border-radius: var(--radius-btn);
        background: var(--white, #fff); color: var(--muted);
        font-size: 16px; cursor: pointer; font-family: inherit;
        display: flex; align-items: center; justify-content: center;
        transition: background 0.12s, color 0.12s, border-color 0.12s;
      }
      .ci-view-btn:hover { color: var(--text); }
      .ci-view-btn.active {
        background: var(--accent); color: #fff; border-color: var(--accent);
      }

      /* List-режим залов. */
      .ci-list { display: flex; flex-direction: column; gap: 8px; }
      .ci-list-row {
        display: flex; align-items: center; gap: 14px;
        padding: 12px 14px;
        background: var(--white, #fff);
        border: 1px solid var(--border); border-radius: 12px;
        cursor: pointer; box-sizing: border-box; width: 100%;
        text-align: left; font-family: inherit;
        transition: border-color 0.12s, background 0.12s;
      }
      .ci-list-row:hover { border-color: var(--gold-500); }
      .ci-list-icon {
        flex-shrink: 0; width: 38px; height: 38px;
        border-radius: 10px; background: var(--bg-secondary);
        display: flex; align-items: center; justify-content: center;
      }
      .ci-list-main { flex: 1; min-width: 0; }
      .ci-list-name {
        font-size: 14px; font-weight: 600; color: var(--text);
        overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
      }
      .ci-list-hint { font-size: 12px; color: var(--muted); margin-top: 2px; }
      .ci-list-actions { display: flex; gap: 4px; flex-shrink: 0; }
      .ci-list-act {
        width: 34px; height: 34px;
        border: 1px solid var(--border); border-radius: 8px;
        background: var(--white, #fff); color: var(--muted);
        cursor: pointer;
        display: flex; align-items: center; justify-content: center;
        transition: background 0.12s, color 0.12s, border-color 0.12s;
      }
      .ci-list-act:hover { color: var(--gold-600); border-color: var(--gold-500); }
      .ci-list-act-del:hover { color: var(--red); border-color: var(--red); }
      .ci-list-add {
        background: var(--bg-secondary);
        border-style: dashed; color: var(--muted);
        justify-content: flex-start;
      }
      .ci-list-add:hover { color: var(--gold-600); }

      /* Модалка переименования зала. */
      .ci-rename-overlay {
        position: fixed; inset: 0; background: rgba(0,0,0,0.4);
        z-index: 500; display: flex; align-items: center; justify-content: center;
        padding: 20px;
      }
      .ci-rename-modal {
        background: var(--white, #fff);
        border-radius: var(--radius-card);
        padding: 24px; width: 100%; max-width: 420px;
        box-shadow: 0 12px 40px rgba(0,0,0,0.18);
      }
      .ci-rename-title { font-size: 16px; font-weight: 600; margin-bottom: 16px; }
      .ci-rename-input {
        width: 100%; height: 42px; padding: 0 14px;
        border: 1px solid var(--border); border-radius: var(--radius-input);
        background: var(--white, #fff); color: var(--text);
        font-size: 14px; font-family: inherit; box-sizing: border-box;
        transition: border-color 0.12s;
      }
      .ci-rename-input:focus { outline: none; border-color: var(--accent); }
      .ci-rename-actions {
        display: flex; gap: 10px; justify-content: flex-end; margin-top: 18px;
      }
    `}</style>
  )
}
