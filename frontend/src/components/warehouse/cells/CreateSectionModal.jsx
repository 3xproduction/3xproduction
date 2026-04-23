// Модалка создания зала (секции). Поле — только название. Тип хранения
// определяется из контекста (prefillType из URL-типа или shelf по дефолту).
// Количество ячеек/полок/штанг не запрашивается — зал стартует пустым,
// места создаются автоматически при добавлении единиц.

import { useEffect, useState } from 'react'
import { X, Package, Shirt, Truck } from 'lucide-react'
import Button from '../../shared/Button'
import { warehouses as warehousesApi } from '../../../services/api'
import { useToast } from '../../shared/Toast'

const TYPE_OPTIONS = [
  { value: 'shelf',  label: 'Полки',    Icon: Package },
  { value: 'hanger', label: 'Вешалки',  Icon: Shirt },
  { value: 'place',  label: 'Места',    Icon: Truck },
]

export default function CreateSectionModal({
  open,
  warehouseId,
  prefillType,          // 'shelf'|'hanger'|'place'|'hall' — начальное значение
  showTypeSelector = false, // если true — рендерим 3-кнопочный селектор (только shelf/hanger/place).
  forceType,            // если задано — используем этот type (игнорируем prefillType/selector). Напр. 'hall' из CellsIndex.
  parentSectionId,      // если задано — создаётся дочерняя секция (внутри зала).
  onClose,
  onCreated,            // (section) => void
}) {
  const toast = useToast()
  const [name, setName] = useState('')
  const [saving, setSaving] = useState(false)
  const initialType = ['shelf', 'hanger', 'place'].includes(prefillType) ? prefillType : 'shelf'
  const [type, setType] = useState(initialType)
  const effectiveType = forceType || type

  useEffect(() => {
    if (open) {
      setName('')
      setType(initialType)
    }
  }, [open, initialType])

  async function handleCreate() {
    if (!name.trim() || !warehouseId) return
    setSaving(true)
    try {
      const data = await warehousesApi.createSection({
        warehouse_id: warehouseId,
        name: name.trim(),
        type: effectiveType,
        category: 'props',   // дефолт; категория при создании не спрашивается
        parent_section_id: parentSectionId || undefined,
        // cells не передаём — секция стартует пустой
      })
      toast?.(`Секция "${data.section.name}" создана`, 'success')
      onCreated?.(data.section)
    } catch (e) {
      toast?.(e.message || 'Ошибка создания секции', 'error')
    } finally {
      setSaving(false)
    }
  }

  if (!open) return null

  return (
    <>
      <style>{`
        .csm-bg {
          position: fixed; inset: 0; z-index: 500;
          background: rgba(0,0,0,0.45);
          backdrop-filter: blur(4px); -webkit-backdrop-filter: blur(4px);
          display: flex; align-items: center; justify-content: center;
          padding: 20px;
          animation: csm-fade 0.14s ease-out;
        }
        @keyframes csm-fade { from { opacity: 0; } to { opacity: 1; } }
        .csm-modal {
          width: 100%; max-width: 420px;
          background: var(--white);
          border-radius: 18px;
          box-shadow: 0 20px 60px rgba(0,0,0,0.25);
          display: flex; flex-direction: column;
          animation: csm-in 0.18s cubic-bezier(0.2, 0.8, 0.2, 1);
        }
        @keyframes csm-in {
          from { transform: translateY(12px) scale(0.98); opacity: 0; }
          to   { transform: translateY(0) scale(1); opacity: 1; }
        }
        .csm-head {
          display: flex; align-items: flex-start; gap: 10px;
          padding: 16px 20px 10px;
        }
        .csm-head-flush {
          justify-content: flex-end;
          padding: 10px 10px 0;
        }
        .csm-title { font-size: 17px; font-weight: 700; color: var(--text); flex: 1; }
        .csm-close {
          background: none; border: none; cursor: pointer;
          color: var(--muted); padding: 2px;
          display: inline-flex; align-items: center; justify-content: center;
        }
        .csm-body { padding: 4px 20px 20px; }
        .csm-label {
          display: block; font-size: 11px; font-weight: 600;
          text-transform: uppercase; letter-spacing: 0.4px;
          color: var(--muted); margin: 10px 0 6px;
        }
        .csm-input {
          width: 100%; height: 38px; padding: 0 12px;
          border: 1px solid var(--border); border-radius: 10px;
          background: var(--white); font: inherit; font-size: 14px;
          outline: none; box-sizing: border-box;
        }
        .csm-input:focus { border-color: var(--gold-500); }

        .csm-types {
          display: grid;
          grid-template-columns: repeat(3, 1fr);
          gap: 8px;
          margin-top: 4px;
        }
        .csm-type {
          padding: 12px 6px;
          border-radius: 10px;
          border: 1px solid var(--border);
          background: var(--card);
          color: var(--text);
          cursor: pointer; font-family: inherit;
          display: flex; flex-direction: column; align-items: center; gap: 6px;
          font-size: 12px; font-weight: 500;
          transition: all 0.12s;
        }
        .csm-type:hover { border-color: var(--gold-500); color: var(--gold-600); }
        .csm-type.active {
          background: var(--gold-100);
          border-color: var(--gold-500);
          color: var(--gold-600);
          font-weight: 600;
        }

        .csm-actions {
          display: flex; gap: 8px; margin-top: 16px;
        }
      `}</style>

      <div className="csm-bg" onClick={onClose}>
        <div className="csm-modal" onClick={e => e.stopPropagation()}>
          <div className="csm-head csm-head-flush">
            <button className="csm-close" onClick={onClose}><X size={18} /></button>
          </div>
          <div className="csm-body">
            <label className="csm-label">Название</label>
            <input autoFocus value={name}
              onChange={e => setName(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && name.trim() && handleCreate()}
              placeholder="Придумай обозначение месту"
              className="csm-input"
            />

            {showTypeSelector && (
              <div className="csm-types">
                {TYPE_OPTIONS.map(opt => (
                  <button key={opt.value} type="button"
                    className={`csm-type ${type === opt.value ? 'active' : ''}`}
                    onClick={() => setType(opt.value)}
                  >
                    <opt.Icon size={20} strokeWidth={1.4} />
                    {opt.label}
                  </button>
                ))}
              </div>
            )}

            <div className="csm-actions">
              <Button variant="secondary" size="sm" fullWidth onClick={onClose}>Отмена</Button>
              <Button size="sm" fullWidth disabled={!name.trim() || saving}
                onClick={handleCreate}>
                {saving ? 'Создание…' : 'Создать'}
              </Button>
            </div>
          </div>
        </div>
      </div>
    </>
  )
}
