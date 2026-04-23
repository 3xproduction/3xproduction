// Третий уровень каталога: сетка карточек занятых ячеек секции. Визуально —
// как /units: фото → имя → бейдж статуса. Пустые ячейки (остатки) скрыты —
// новые создаются через phantom-плитку «+ Добавить» в конце сетки.
//
// URL: /cells/:warehouseId/section/:sectionId

import { useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { Plus, X } from 'lucide-react'
import WarehouseLayout from '../WarehouseLayout'
import Button from '../../shared/Button'
import UnitCardModal from '../../shared/UnitCardModal'
import AddUnitModal from '../../shared/AddUnitModal'
import SuccessPopup from '../../shared/SuccessPopup'
import CatalogHeader from './CatalogHeader'
import PickUnitList from './PickUnitList'
import CellsGrid from './CellsGrid'
import useWarehouseData from './useWarehouseData'
import { warehouses as warehousesApi, units as unitsApi } from '../../../services/api'
import { useAuth } from '../../../hooks/useAuth'
import { useToast } from '../../shared/Toast'
import { useBodyLock } from '../../../hooks/useBodyLock'

const EDITOR_ROLES = ['warehouse_director', 'warehouse_deputy']
const TYPE_LABEL = { shelf: 'Полки', hanger: 'Вешалки', place: 'Места' }

export default function CellsSectionView() {
  const { warehouseId, sectionId } = useParams()
  const navigate = useNavigate()
  const { user } = useAuth()
  const toast = useToast()
  const canEdit = EDITOR_ROLES.includes(user?.role)

  const { warehouse, sections, loading, reload } = useWarehouseData(warehouseId)
  const section = sections.find(s => String(s.id) === String(sectionId)) || null

  // Inline rename секции
  const [editingName, setEditingName] = useState(false)
  const [nameDraft, setNameDraft] = useState('')
  const [renaming, setRenaming] = useState(false)
  const inputRef = useRef(null)
  function startRename() {
    setNameDraft(section?.name || '')
    setEditingName(true)
    setTimeout(() => inputRef.current?.focus(), 20)
  }
  async function commitRename() {
    const v = nameDraft.trim()
    if (!v || v === section?.name) { setEditingName(false); return }
    setRenaming(true)
    try {
      await warehousesApi.updateSection(sectionId, { name: v })
      toast?.('Секция переименована', 'success')
      reload()
    } catch (e) {
      toast?.(e.message || 'Ошибка', 'error')
    } finally {
      setEditingName(false); setRenaming(false)
    }
  }

  // Действия по ячейкам
  const [pickUnitTarget, setPickUnitTarget] = useState(null) // { cellId, cellLabel }
  const [addUnitTarget, setAddUnitTarget] = useState(null)   // { cellId, autoCreated }
  const [cardId, setCardId] = useState(null)                 // открытая карточка единицы
  // Phantom-клик: модалка «Добавить новое / Со склада», ячейка ещё не создана
  const [phantomAction, setPhantomAction] = useState(false)
  // Успех-попап после размещения/создания единицы.
  const [successData, setSuccessData] = useState(null)

  useBodyLock(
    !!pickUnitTarget || !!addUnitTarget || !!cardId ||
    phantomAction || editingName
  )

  async function handlePickUnit(unit) {
    if (!pickUnitTarget) return
    try {
      // Если cellId ещё не выделен (открыто из phantom «+») — создаём ячейку.
      let cellId = pickUnitTarget.cellId
      if (!cellId) {
        const r = await warehousesApi.addCell(sectionId)
        cellId = r.cell.id
      }
      await unitsApi.update(unit.id, {
        name: unit.name,
        category: unit.category,
        serial: unit.serial,
        description: unit.description,
        qty: unit.qty,
        condition: unit.condition,
        valuation: unit.valuation,
        materials: unit.materials,
        period: unit.period,
        warehouse_id: warehouseId,
        cell_id: cellId,
        pavilion_id: null,
      })
      setPickUnitTarget(null)
      setSuccessData({ title: 'Добавлено успешно', hint: unit.name })
      reload()
    } catch (e) { toast?.(e.message || 'Не удалось разместить', 'error') }
  }

  // Phantom «+»: пользователь выбирает «новое» / «со склада».
  // Для «нового» — создаём ячейку СРАЗУ и передаём в AddUnitModal.
  // Если модалка закрыта без создания единицы — ячейку удаляем обратно.
  async function handlePhantomAddNew() {
    setPhantomAction(false)
    try {
      const r = await warehousesApi.addCell(sectionId)
      setAddUnitTarget({ cellId: r.cell.id, autoCreated: true })
    } catch (e) {
      toast?.(e.message || 'Не удалось создать место', 'error')
    }
  }
  function handlePhantomPickExisting() {
    setPhantomAction(false)
    setPickUnitTarget({ cellId: null, cellLabel: 'новое место' })
  }
  async function handleAddUnitCancelled() {
    const t = addUnitTarget
    setAddUnitTarget(null)
    // Автосозданная ячейка без единицы — подчищаем.
    if (t?.autoCreated && t.cellId) {
      try { await warehousesApi.deleteCell(t.cellId) } catch { /* ignore */ }
      reload()
    }
  }

  // Секция не найдена — 404
  if (!loading && sections.length > 0 && !section) {
    return (
      <WarehouseLayout>
        <div style={{ padding: 40, textAlign: 'center', color: 'var(--muted)' }}>
          Секция не найдена.
          <div style={{ marginTop: 16 }}>
            <Button onClick={() => navigate(`/cells/${warehouseId}`)}>На главную склада</Button>
          </div>
        </div>
      </WarehouseLayout>
    )
  }

  const typeLabel = TYPE_LABEL[section?.type] || 'Зал'
  const isHall = section?.type === 'hall'
  // Приоритет back-навигации:
  //   1. Дочерняя секция зала (parent_section_id) → в сам зал.
  //   2. Hall-секция на уровне склада → на CellsIndex.
  //   3. Обычная shelf/hanger/place на уровне склада → в /type/:type.
  const parentId = section?.parent_section_id
  let backHref, backLabel
  if (parentId) {
    backHref = `/cells/${warehouseId}/hall/${parentId}`
    backLabel = 'Зал'
  } else if (isHall) {
    backHref = `/cells/${warehouseId}`
    backLabel = 'Склад'
  } else {
    backHref = `/cells/${warehouseId}/type/${section?.type || 'shelf'}`
    backLabel = typeLabel
  }
  const occupied = (section?.cells || []).filter(c =>
    c.unit_id && c.unit_status === 'on_stock').length

  return (
    <WarehouseLayout>
      <Styles />

      <div className="cs-page catalog-enter">
        <CatalogHeader
          title={
            editingName ? (
              <input
                ref={inputRef}
                value={nameDraft}
                onChange={e => setNameDraft(e.target.value)}
                onBlur={commitRename}
                onKeyDown={e => {
                  if (e.key === 'Enter') commitRename()
                  else if (e.key === 'Escape') setEditingName(false)
                }}
                disabled={renaming}
                className="cs-rename-input"
              />
            ) : canEdit && section ? (
              // Двойной клик по названию → inline-rename (замена Pencil-кнопки).
              <span className="cs-title-editable" onDoubleClick={startRename}>
                {section.name}
              </span>
            ) : (section?.name || '')
          }
          subtitle={
            loading
              ? 'Загрузка…'
              : `${warehouse?.name || ''} · ${typeLabel}${occupied ? ` · ${occupied} ${pluralUnits(occupied)}` : ''}`
          }
          backTo={backHref}
          backLabel={backLabel || 'Назад'}
          right={canEdit && section && !editingName ? (
            <button className="cs-add-cta" onClick={() => setPhantomAction(true)}>
              <Plus size={15} strokeWidth={2} />
              <span>Пополнить склад</span>
            </button>
          ) : null}
        />

        <div className="cs-body">
          {loading ? (
            <div className="cs-loader">Загрузка…</div>
          ) : section ? (
            <CellsGrid
              cells={section.cells || []}
              canAdd={canEdit}
              onOpenUnit={(unitId) => setCardId(unitId)}
              onAddNew={() => setPhantomAction(true)}
            />
          ) : null}
        </div>

        {/* Phantom «+»: выбор действия */}
        {phantomAction && (
          <ModalCard
            title="Добавить единицу"
            onClose={() => setPhantomAction(false)}
          >
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <Button fullWidth onClick={handlePhantomAddNew}>
                Добавить новое
              </Button>
              <Button variant="secondary" fullWidth onClick={handlePhantomPickExisting}>
                Добавить со склада
              </Button>
            </div>
          </ModalCard>
        )}

        {/* Модалка выбора единицы со склада */}
        {pickUnitTarget && (
          <ModalCard
            title="Добавить со склада"
            onClose={() => setPickUnitTarget(null)}
            wide
          >
            <PickUnitList onPicked={handlePickUnit} />
          </ModalCard>
        )}

        {addUnitTarget && (
          <AddUnitModal
            open={!!addUnitTarget}
            onClose={handleAddUnitCancelled}
            onCreated={(unit) => {
              setAddUnitTarget(null)
              setSuccessData({
                title: 'Добавлено успешно',
                hint: unit?.name || 'Единица создана',
              })
              reload()
            }}
            prefillCellId={addUnitTarget.cellId}
            prefillWarehouseId={warehouseId}
          />
        )}

        <SuccessPopup
          data={successData}
          onDone={() => setSuccessData(null)}
        />

        {cardId && (
          <UnitCardModal
            unitId={cardId}
            onClose={() => { setCardId(null); reload() }}
          />
        )}
      </div>
    </WarehouseLayout>
  )
}

function pluralUnits(n) {
  const mod10 = n % 10, mod100 = n % 100
  if (mod10 === 1 && mod100 !== 11) return 'единица'
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return 'единицы'
  return 'единиц'
}

function ModalCard({ title, subtitle, onClose, wide, children }) {
  return (
    <div className="cs-modal-bg" onClick={onClose}>
      <div
        className={`cs-modal${wide ? ' wide' : ''}`}
        onClick={e => e.stopPropagation()}
      >
        <div className="cs-modal-head">
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="cs-modal-title">{title}</div>
            {subtitle && <div className="cs-modal-sub">{subtitle}</div>}
          </div>
          <button className="cs-modal-close" onClick={onClose}>
            <X size={18} />
          </button>
        </div>
        <div className="cs-modal-body">{children}</div>
      </div>
    </div>
  )
}

function Styles() {
  return (
    <style>{`
      .cs-page {
        display: flex; flex-direction: column;
        min-height: calc(100vh - 60px);
        min-height: calc(100dvh - 60px);
      }
      .cs-body { padding: 22px 24px 60px; flex: 1; }
      .cs-loader {
        padding: 60px 0; text-align: center; color: var(--muted);
      }

      .cs-rename-input {
        font: inherit; font-size: 22px; font-weight: 700;
        letter-spacing: -0.01em; color: var(--text);
        border: none; border-bottom: 2px solid var(--gold-500);
        background: transparent; outline: none;
        padding: 0 2px; width: 100%;
        max-width: 360px;
      }

      .cs-title-editable {
        cursor: text;
        -webkit-user-select: text; user-select: text;
      }

      .cs-add-cta {
        display: inline-flex; align-items: center; gap: 6px;
        height: 36px; padding: 0 14px;
        border: 1px solid var(--gold-500);
        border-radius: 10px;
        background: var(--gold-500);
        color: #fff;
        font: inherit; font-size: 13px; font-weight: 600;
        cursor: pointer;
        transition: background 0.12s, border-color 0.12s, transform 0.08s;
        white-space: nowrap;
      }
      .cs-add-cta:hover {
        background: var(--gold-600);
        border-color: var(--gold-600);
      }
      .cs-add-cta:active { transform: translateY(1px); }
      @media (max-width: 520px) {
        .cs-add-cta span { display: none; }
        .cs-add-cta { width: 36px; padding: 0; justify-content: center; }
      }

      /* Общая модалка для действий на ячейке + выбора единицы */
      .cs-modal-bg {
        position: fixed; inset: 0; z-index: 500;
        background: rgba(0,0,0,0.45);
        backdrop-filter: blur(4px); -webkit-backdrop-filter: blur(4px);
        display: flex; align-items: center; justify-content: center;
        padding: 20px;
        animation: cs-modal-fade 0.14s ease-out;
      }
      @keyframes cs-modal-fade { from { opacity: 0; } to { opacity: 1; } }
      .cs-modal {
        width: 100%; max-width: 420px;
        background: var(--white);
        border-radius: 18px;
        box-shadow: 0 20px 60px rgba(0,0,0,0.25);
        max-height: 85vh; overflow: hidden;
        display: flex; flex-direction: column;
        animation: cs-modal-in 0.18s cubic-bezier(0.2, 0.8, 0.2, 1);
      }
      .cs-modal.wide { max-width: 540px; }
      @keyframes cs-modal-in {
        from { transform: translateY(12px) scale(0.98); opacity: 0; }
        to   { transform: translateY(0) scale(1); opacity: 1; }
      }
      .cs-modal-head {
        display: flex; align-items: flex-start; gap: 10px;
        padding: 16px 20px 10px;
      }
      .cs-modal-title {
        font-size: 17px; font-weight: 700; color: var(--text);
      }
      .cs-modal-sub {
        font-size: 12px; color: var(--muted); margin-top: 2px;
        text-transform: uppercase; letter-spacing: 0.4px; font-weight: 600;
      }
      .cs-modal-close {
        background: none; border: none; cursor: pointer;
        color: var(--muted); padding: 2px;
        display: inline-flex; align-items: center; justify-content: center;
      }
      .cs-modal-body { padding: 6px 20px 20px; overflow-y: auto; }

      /* np-row используется PickUnitList */
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

      @media (max-width: 768px) {
        .cs-body { padding: 16px 14px 80px; }
      }
    `}</style>
  )
}
