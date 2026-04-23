// Второй уровень каталога: карточки секций выбранного типа внутри
// склада. URL: /cells/:warehouseId/type/:type (shelf | hanger | place).
// Edit-mode: стрелки ⬆⬇ для изменения порядка, корзина на карточке.

import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import {
  Package, Shirt, Truck, Plus, Trash2,
} from 'lucide-react'
import WarehouseLayout from '../WarehouseLayout'
import Button from '../../shared/Button'
import ConfirmModal from '../../shared/ConfirmModal'
import CatalogHeader from './CatalogHeader'
import SectionCover from './SectionCover'
import useWarehouseData from './useWarehouseData'
import CreateSectionModal from './CreateSectionModal'
import { warehouses as warehousesApi } from '../../../services/api'
import { useAuth } from '../../../hooks/useAuth'
import { useToast } from '../../shared/Toast'
import { useBodyLock } from '../../../hooks/useBodyLock'

const EDITOR_ROLES = ['warehouse_director', 'warehouse_deputy']

const TYPE_LABEL = { shelf: 'Полки', hanger: 'Вешалки', place: 'Места' }
const TYPE_ICON  = { shelf: Package, hanger: Shirt, place: Truck }

export default function CellsTypeView() {
  const { warehouseId, type } = useParams()
  const navigate = useNavigate()
  const { user } = useAuth()
  const toast = useToast()
  const canEdit = EDITOR_ROLES.includes(user?.role)

  const { warehouse, sections, loading, reload } = useWarehouseData(warehouseId)

  const typeSections = useMemo(() => {
    // Только секции на уровне склада (без parent_section_id). Секции,
    // лежащие внутри залов, показываются в CellsHallView.
    const list = sections.filter(
      s => (s.type || 'shelf') === type && !s.parent_section_id
    )
    // sort_order — главный ключ сортировки; fallback на имя.
    return [...list].sort((a, b) => {
      const oa = a.sort_order ?? 1e9
      const ob = b.sort_order ?? 1e9
      if (oa !== ob) return oa - ob
      return (a.name || '').localeCompare(b.name || '')
    })
  }, [sections, type])

  const [confirmDel, setConfirmDel] = useState(null)     // section to delete
  const [createSectionOpen, setCreateSectionOpen] = useState(false)
  useBodyLock(!!confirmDel || createSectionOpen)

  async function handleDeleteSection(id) {
    try {
      await warehousesApi.deleteSection(id)
      setConfirmDel(null)
      reload()
      toast?.('Секция удалена', 'success')
    } catch (e) { toast?.(e.message || 'Ошибка', 'error') }
  }

  // Валидация параметра type
  useEffect(() => {
    if (!['shelf', 'hanger', 'place'].includes(type)) {
      navigate(`/cells/${warehouseId}`, { replace: true })
    }
  }, [type, warehouseId, navigate])

  const Icon = TYPE_ICON[type] || Package

  return (
    <WarehouseLayout>
      <Styles />

      <div className="ct-page catalog-enter">
        <CatalogHeader
          title={TYPE_LABEL[type] || type}
          subtitle={
            loading
              ? 'Загрузка…'
              : `${warehouse?.name || ''} · ${typeSections.length} ${pluralSections(typeSections.length)}`
          }
          backTo={`/cells/${warehouseId}`}
          backLabel={warehouse?.name || 'Склад'}
          right={canEdit ? (
            <button
              className="ct-add-cta"
              onClick={() => setCreateSectionOpen(true)}
              title="Добавить зал"
            >
              <Plus size={15} strokeWidth={2} />
              <span>Добавить зал</span>
            </button>
          ) : null}
        />

        <div className="ct-body">
          {loading ? (
            <div className="ct-loader">Загрузка…</div>
          ) : typeSections.length === 0 ? (
            <div className="ct-empty">
              <div className="ct-empty-icon"><Icon size={48} strokeWidth={1.2} /></div>
              <div className="ct-empty-title">Нет секций типа «{TYPE_LABEL[type]}»</div>
              <div className="ct-empty-hint">
                {canEdit
                  ? 'Создайте первую секцию этого типа'
                  : 'Попросите директора склада создать секцию'}
              </div>
              {canEdit && (
                <Button onClick={() => setCreateSectionOpen(true)}>
                  <Plus size={14} /> Создать секцию
                </Button>
              )}
            </div>
          ) : (
            <>
              <div className="ct-grid">
                {typeSections.map(s => (
                  <SectionCard
                    key={s.id}
                    section={s}
                    canEdit={canEdit}
                    onOpen={() => navigate(`/cells/${warehouseId}/section/${s.id}`)}
                    onDelete={() => setConfirmDel(s)}
                  />
                ))}
                {canEdit && (
                  <button
                    className="ct-card phantom"
                    onClick={() => setCreateSectionOpen(true)}
                  >
                    <div className="ct-phantom-cover">
                      <Plus size={44} strokeWidth={1.5} />
                    </div>
                    <div className="ct-card-body">
                      <div className="ct-phantom-label">Создать</div>
                    </div>
                  </button>
                )}
              </div>
            </>
          )}
        </div>

        <CreateSectionModal
          open={createSectionOpen}
          warehouseId={warehouseId}
          prefillType={type}
          // Внутри зала создаём полку/вешалку/место — селектор типа нужен.
          showTypeSelector={true}
          onClose={() => setCreateSectionOpen(false)}
          onCreated={(section) => {
            setCreateSectionOpen(false)
            navigate(`/cells/${warehouseId}/section/${section.id}`)
          }}
        />

        <ConfirmModal
          open={!!confirmDel}
          title="Удалить секцию?"
          message={`Секция "${confirmDel?.name || ''}" и все её места будут удалены.`}
          confirmLabel="Удалить"
          danger
          onConfirm={() => handleDeleteSection(confirmDel.id)}
          onCancel={() => setConfirmDel(null)}
        />
      </div>
    </WarehouseLayout>
  )
}

function SectionCard({ section, canEdit, onOpen, onDelete }) {
  return (
    <div className="ct-card-wrap">
      <button className="ct-card" onClick={onOpen}>
        <SectionCover section={section} />
        <div className="ct-card-body">
          <div className="ct-card-name">{section.name}</div>
          <div className="ct-card-meta">
            {(() => {
              const n = (section.cells || []).filter(
                c => c.unit_id && c.unit_status === 'on_stock'
              ).length
              if (n === 0) return 'Пусто'
              const mod10 = n % 10, mod100 = n % 100
              const word = (mod10 === 1 && mod100 !== 11) ? 'единица'
                : (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) ? 'единицы'
                : 'единиц'
              return `${n} ${word}`
            })()}
          </div>
        </div>
      </button>

      {canEdit && (
        <button
          className="ct-del-btn"
          onClick={(e) => { e.stopPropagation(); onDelete?.() }}
          title="Удалить"
        >
          <Trash2 size={14} strokeWidth={1.8} />
        </button>
      )}
    </div>
  )
}

function pluralSections(n) {
  const mod10 = n % 10, mod100 = n % 100
  if (mod10 === 1 && mod100 !== 11) return 'секция'
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return 'секции'
  return 'секций'
}

function Styles() {
  return (
    <style>{`
      .ct-page {
        display: flex; flex-direction: column;
        min-height: calc(100vh - 60px);
        min-height: calc(100dvh - 60px);
      }
      .ct-body { padding: 20px 24px 40px; flex: 1; }
      .ct-loader { text-align: center; padding: 40px 0; color: var(--muted); }

      .ct-add-cta {
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
      .ct-add-cta:hover {
        background: var(--gold-600); border-color: var(--gold-600);
      }
      .ct-add-cta:active { transform: translateY(1px); }
      @media (max-width: 520px) {
        .ct-add-cta span { display: none; }
        .ct-add-cta { width: 36px; padding: 0; justify-content: center; }
      }

      .ct-del-btn {
        position: absolute;
        top: 8px; right: 8px;
        width: 30px; height: 30px;
        border-radius: 9px;
        border: 1px solid var(--border);
        background: rgba(255,255,255,0.94);
        color: var(--red);
        display: inline-flex; align-items: center; justify-content: center;
        cursor: pointer;
        opacity: 0;
        transition: opacity 0.15s, background 0.12s, border-color 0.12s, transform 0.12s;
        backdrop-filter: blur(6px); -webkit-backdrop-filter: blur(6px);
        z-index: 2;
      }
      .ct-card-wrap:hover .ct-del-btn { opacity: 1; }
      .ct-del-btn:hover {
        background: var(--red); color: #fff; border-color: var(--red);
        transform: scale(1.05);
      }
      @media (max-width: 768px) {
        .ct-del-btn { opacity: 1; }
      }

      .ct-grid {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
        gap: 16px;
        max-width: 1280px;
      }
      .ct-card-wrap { position: relative; }
      .ct-card {
        width: 100%;
        display: flex; flex-direction: column;
        background: var(--white);
        border: 1px solid var(--border);
        border-radius: 14px;
        overflow: hidden;
        cursor: pointer;
        padding: 0; font-family: inherit;
        text-align: left;
        transition: transform 0.15s ease, box-shadow 0.15s ease, border-color 0.15s ease;
      }
      .ct-card:hover {
        transform: translateY(-2px);
        box-shadow: 0 10px 24px rgba(0,0,0,0.08);
        border-color: var(--gold-500);
      }
      .ct-card.phantom {
        background: var(--paper);
        border-style: dashed;
        border-color: var(--gold-500);
      }
      .ct-card.phantom:hover {
        background: var(--gold-100);
      }
      .ct-phantom-cover {
        width: 100%;
        aspect-ratio: 4 / 3;
        display: flex; align-items: center; justify-content: center;
        color: var(--gold-500);
      }
      .ct-phantom-label {
        font-size: 14px; font-weight: 600; color: var(--gold-600);
      }
      .ct-card-body { padding: 10px 12px 12px; }
      .ct-card-name {
        font-size: 14px; font-weight: 600; color: var(--text);
        overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
      }
      .ct-card-meta {
        font-size: 11px; color: var(--muted); margin-top: 2px;
      }

      .ct-card-actions {
        position: absolute; top: 8px; left: 8px;
        display: flex; gap: 4px;
        background: rgba(255,255,255,0.92);
        backdrop-filter: blur(8px); -webkit-backdrop-filter: blur(8px);
        padding: 4px; border-radius: 10px;
        box-shadow: 0 2px 8px rgba(0,0,0,0.1);
      }
      .ct-act-btn {
        width: 30px; height: 30px; border-radius: 7px;
        border: none; background: transparent;
        cursor: pointer; color: var(--text);
        display: inline-flex; align-items: center; justify-content: center;
        transition: background 0.12s, color 0.12s;
      }
      .ct-act-btn:hover { background: var(--gold-100); color: var(--gold-600); }
      .ct-act-btn:disabled { opacity: 0.35; cursor: not-allowed; }
      .ct-act-btn:disabled:hover { background: transparent; color: var(--text); }
      .ct-act-btn.danger { color: var(--red); }
      .ct-act-btn.danger:hover { background: var(--red-dim); color: var(--red); }

      .ct-footer-actions {
        display: flex; gap: 10px; margin-top: 28px; flex-wrap: wrap;
      }
      .ct-saving {
        margin-top: 16px; font-size: 12px; color: var(--muted);
        text-align: right;
      }

      .ct-empty {
        display: flex; flex-direction: column; align-items: center;
        padding: 80px 20px; text-align: center;
      }
      .ct-empty-icon {
        width: 96px; height: 96px; border-radius: 28px;
        background: var(--gold-100); color: var(--gold-600);
        display: flex; align-items: center; justify-content: center;
        margin-bottom: 20px;
      }
      .ct-empty-title { font-size: 20px; font-weight: 700; margin-bottom: 6px; }
      .ct-empty-hint { font-size: 13px; color: var(--muted); margin-bottom: 20px; max-width: 340px; }

      @media (max-width: 768px) {
        .ct-body { padding: 14px 14px 80px; }
        .ct-grid { grid-template-columns: repeat(2, 1fr); gap: 12px; }
      }
      @media (max-width: 480px) {
        .ct-grid { grid-template-columns: 1fr; }
      }
    `}</style>
  )
}
