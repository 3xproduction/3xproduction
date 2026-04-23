// Вью зала (type='hall'): показывает дочерние секции (shelf/hanger/place),
// которые лежат внутри этого зала через parent_section_id.
//
// URL: /cells/:warehouseId/hall/:hallId
//
// Из зала создаём полку/вешалку/место (с селектором типа), и дальше
// клик по полке/вешалке/месту ведёт в обычный CellsSectionView (сетка
// ячеек). Единицы добавляются только на уровне полки/вешалки/места.

import { useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { Package, Shirt, Truck, Plus, Trash2 } from 'lucide-react'
import WarehouseLayout from '../WarehouseLayout'
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
const TYPE_ICON  = { shelf: Package, hanger: Shirt, place: Truck }
const TYPE_LABEL = { shelf: 'Полка', hanger: 'Вешалка', place: 'Место' }

export default function CellsHallView() {
  const { warehouseId, hallId } = useParams()
  const navigate = useNavigate()
  const { user } = useAuth()
  const toast = useToast()
  const canEdit = EDITOR_ROLES.includes(user?.role)

  const { warehouse, sections, loading, reload } = useWarehouseData(warehouseId)
  const hall = sections.find(s => String(s.id) === String(hallId) && s.type === 'hall') || null

  const children = useMemo(
    () => sections.filter(s => String(s.parent_section_id) === String(hallId)),
    [sections, hallId],
  )

  const [createOpen, setCreateOpen] = useState(false)
  const [confirmDel, setConfirmDel] = useState(null)
  useBodyLock(createOpen || !!confirmDel)

  async function handleDelete(id) {
    try {
      await warehousesApi.deleteSection(id)
      toast?.('Секция удалена', 'success')
      setConfirmDel(null)
      reload()
    } catch (e) {
      toast?.(e.message || 'Ошибка', 'error')
    }
  }

  const occupied = children.reduce(
    (sum, c) => sum + (c.cells || []).filter(x => x.unit_id && x.unit_status === 'on_stock').length,
    0,
  )

  return (
    <WarehouseLayout>
      <Styles />

      <div className="ch-page catalog-enter">
        <CatalogHeader
          title={hall?.name || 'Зал'}
          subtitle={
            loading
              ? 'Загрузка…'
              : `${warehouse?.name || ''} · ${children.length} ${pluralSections(children.length)}${occupied ? ` · ${occupied} ${pluralUnits(occupied)}` : ''}`
          }
          backTo={`/cells/${warehouseId}`}
          backLabel="Склад"
          right={canEdit ? (
            <button className="ch-add-cta" onClick={() => setCreateOpen(true)}>
              <Plus size={15} strokeWidth={2} />
              <span>Создать</span>
            </button>
          ) : null}
        />

        <div className="ch-body">
          {loading ? (
            <div className="ch-loader">Загрузка…</div>
          ) : (
            <div className="ch-grid">
              {children.map(s => {
                const Icon = TYPE_ICON[s.type] || Package
                const occCells = (s.cells || []).filter(c => c.unit_id && c.unit_status === 'on_stock').length
                return (
                  <button key={s.id}
                    className="ch-card"
                    onClick={() => navigate(`/cells/${warehouseId}/section/${s.id}`)}
                  >
                    <div className="ch-cover">
                      <SectionCover section={s} />
                      {occCells > 0 && <div className="ch-badge">{occCells}</div>}
                      <div className="ch-type-pill">
                        <Icon size={12} strokeWidth={1.8} />
                        {TYPE_LABEL[s.type] || 'Секция'}
                      </div>
                    </div>
                    <div className="ch-name">{s.name}</div>
                    <div className="ch-hint">{occCells ? `${occCells} ${pluralUnits(occCells)}` : 'Пусто'}</div>
                    {canEdit && (
                      <button className="ch-card-del"
                        onClick={(e) => { e.stopPropagation(); setConfirmDel(s) }}
                        title="Удалить"
                      >
                        <Trash2 size={14} strokeWidth={1.8} />
                      </button>
                    )}
                  </button>
                )
              })}

              {canEdit && (
                <button className="ch-card phantom"
                  onClick={() => setCreateOpen(true)}
                >
                  <div className="ch-cover phantom-cover">
                    <Plus size={40} strokeWidth={1.3} />
                  </div>
                  <div className="ch-name ch-name-phantom">Создать</div>
                  <div className="ch-hint">Полку · Вешалку · Место</div>
                </button>
              )}
            </div>
          )}
        </div>

        <CreateSectionModal
          open={createOpen}
          warehouseId={warehouseId}
          parentSectionId={hallId}
          // Внутри зала — выбор типа Полка / Вешалка / Место.
          showTypeSelector={true}
          prefillType="shelf"
          onClose={() => setCreateOpen(false)}
          onCreated={(section) => {
            setCreateOpen(false)
            navigate(`/cells/${warehouseId}/section/${section.id}`)
          }}
        />

        <ConfirmModal
          open={!!confirmDel}
          title="Удалить секцию?"
          message={`Секция "${confirmDel?.name || ''}" и все её места будут удалены.`}
          confirmLabel="Удалить"
          danger
          onConfirm={() => handleDelete(confirmDel.id)}
          onCancel={() => setConfirmDel(null)}
        />
      </div>
    </WarehouseLayout>
  )
}

function pluralSections(n) {
  const mod10 = n % 10, mod100 = n % 100
  if (mod10 === 1 && mod100 !== 11) return 'секция'
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return 'секции'
  return 'секций'
}

function pluralUnits(n) {
  const mod10 = n % 10, mod100 = n % 100
  if (mod10 === 1 && mod100 !== 11) return 'единица'
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return 'единицы'
  return 'единиц'
}

function Styles() {
  return (
    <style>{`
      .ch-page { display: flex; flex-direction: column; }
      .ch-body { padding: 22px 24px 40px; }
      .ch-loader { text-align: center; padding: 40px 0; color: var(--muted); }

      .ch-grid {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
        gap: 16px;
      }
      .ch-card {
        position: relative;
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
      .ch-card:hover {
        transform: translateY(-2px);
        box-shadow: 0 12px 28px rgba(0,0,0,0.08);
        border-color: var(--gold-500);
      }
      .ch-card.phantom {
        border-style: dashed;
        border-color: var(--gold-500);
        background: transparent;
      }
      .ch-cover {
        position: relative;
        aspect-ratio: 4 / 3;
        display: flex; align-items: center; justify-content: center;
        background: var(--paper);
        overflow: hidden;
      }
      .ch-cover.phantom-cover {
        background: var(--paper);
        color: var(--gold-500);
      }
      .ch-badge {
        position: absolute; top: 8px; right: 8px;
        background: rgba(255,255,255,0.88);
        backdrop-filter: blur(8px); -webkit-backdrop-filter: blur(8px);
        padding: 3px 9px; border-radius: 999px;
        font-size: 11px; font-weight: 600; color: var(--text);
        box-shadow: 0 1px 4px rgba(0,0,0,0.08);
      }
      .ch-type-pill {
        position: absolute; bottom: 8px; left: 8px;
        display: inline-flex; align-items: center; gap: 4px;
        background: rgba(255,255,255,0.88);
        backdrop-filter: blur(8px); -webkit-backdrop-filter: blur(8px);
        padding: 3px 8px; border-radius: 999px;
        font-size: 11px; font-weight: 500; color: var(--text);
        box-shadow: 0 1px 4px rgba(0,0,0,0.08);
      }
      .ch-name {
        padding: 10px 12px 2px;
        font-size: 14px; font-weight: 600;
        color: var(--text);
        overflow: hidden; text-overflow: ellipsis;
        white-space: nowrap;
      }
      .ch-name-phantom { color: var(--gold-600); }
      .ch-hint {
        padding: 0 12px 12px;
        font-size: 12px; color: var(--muted);
      }
      .ch-card-del {
        position: absolute; top: 8px; left: 8px;
        width: 30px; height: 30px; border-radius: 9px;
        background: rgba(255,255,255,0.94);
        border: 1px solid var(--border);
        color: var(--red);
        cursor: pointer;
        display: inline-flex; align-items: center; justify-content: center;
        opacity: 0;
        backdrop-filter: blur(6px); -webkit-backdrop-filter: blur(6px);
        transition: opacity 0.15s, background 0.12s, border-color 0.12s, transform 0.12s;
        z-index: 2;
      }
      .ch-card:hover .ch-card-del { opacity: 1; }
      .ch-card-del:hover {
        background: var(--red); color: #fff; border-color: var(--red);
        transform: scale(1.05);
      }

      .ch-add-cta {
        display: inline-flex; align-items: center; gap: 6px;
        height: 36px; padding: 0 14px;
        border: 1px solid var(--gold-500);
        border-radius: 10px;
        background: var(--gold-500);
        color: #fff;
        font: inherit; font-size: 13px; font-weight: 600;
        cursor: pointer;
        white-space: nowrap;
        transition: background 0.12s, border-color 0.12s, transform 0.08s;
      }
      .ch-add-cta:hover {
        background: var(--gold-600); border-color: var(--gold-600);
      }
      .ch-add-cta:active { transform: translateY(1px); }
      @media (max-width: 520px) {
        .ch-add-cta span { display: none; }
        .ch-add-cta { width: 36px; padding: 0; justify-content: center; }
      }

      @media (max-width: 768px) {
        .ch-body { padding: 16px 14px 80px; }
        .ch-grid { grid-template-columns: repeat(auto-fill, minmax(160px, 1fr)); gap: 12px; }
        .ch-card-del { opacity: 1; }
      }
    `}</style>
  )
}
