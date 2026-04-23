// Единый хук для загрузки складов + секций выбранного склада.
// Используется всеми 3 экранами каталога. Держит общий reload-триггер.
//
// Возвращает:
//   warehouses   — список всех складов (имя + id)
//   warehouse    — текущий выбранный
//   sections     — массив секций с ячейками (from /warehouses/:id/cells)
//   loading      — флаг загрузки секций (только если нет кэша)
//   reload()     — перезапросить секции (после edit-операций)
//
// Перфоманс: данные кэшируются в sessionStorage. При навигации между
// CellsIndex/TypeView/HallView/SectionView каталог показывается мгновенно
// (из кэша), в фоне тянется свежая версия и обновляется при необходимости.

import { useCallback, useEffect, useState } from 'react'
import { warehouses as warehousesApi } from '../../../services/api'

// In-memory fallback (на случай отключения sessionStorage).
const MEM = { warehouses: null, sections: new Map() }

function readCache(key) {
  try {
    const raw = sessionStorage.getItem(key)
    return raw ? JSON.parse(raw) : null
  } catch { return null }
}
function writeCache(key, value) {
  try {
    sessionStorage.setItem(key, JSON.stringify(value))
  } catch { /* quota или privacy mode — ок */ }
}

const KEY_WHS = 'cells:warehouses'
const keySections = (id) => `cells:sections:${id}`

export default function useWarehouseData(warehouseId) {
  // Hydrate из кэша — сразу при первом рендере, чтобы избежать мигания.
  const [warehouses, setWarehouses] = useState(() => {
    return MEM.warehouses || readCache(KEY_WHS) || []
  })
  const [warehousesLoading, setWarehousesLoading] = useState(() => {
    return !(MEM.warehouses || readCache(KEY_WHS))
  })
  const [sections, setSections] = useState(() => {
    if (!warehouseId) return []
    return MEM.sections.get(warehouseId) || readCache(keySections(warehouseId)) || []
  })
  const [loading, setLoading] = useState(() => {
    if (!warehouseId) return false
    return !(MEM.sections.get(warehouseId) || readCache(keySections(warehouseId)))
  })
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    let cancelled = false
    warehousesApi.list()
      .then(d => {
        if (cancelled) return
        const list = d.warehouses || []
        setWarehouses(list)
        MEM.warehouses = list
        writeCache(KEY_WHS, list)
      })
      .catch(() => { /* при ошибке оставляем кэшированные данные */ })
      .finally(() => { if (!cancelled) setWarehousesLoading(false) })
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    if (!warehouseId) return undefined
    let cancelled = false
    // Если нет кэша — показываем лоадер. Если есть — лоадер скрыт,
    // фоновый запрос просто обновит данные.
    const hasCache = !!(MEM.sections.get(warehouseId) || readCache(keySections(warehouseId)))
    if (!hasCache) {
      Promise.resolve().then(() => { if (!cancelled) setLoading(true) })
    }
    // Если кэш есть, но пользователь зашёл в другой warehouseId —
    // сначала показываем кэш этого warehouseId (через hydrate state),
    // потом refetch. Hydrate при смене warehouseId (через микротаск,
    // чтобы не триггерить react-hooks/set-state-in-effect).
    if (hasCache) {
      const cached = MEM.sections.get(warehouseId) || readCache(keySections(warehouseId))
      Promise.resolve().then(() => { if (!cancelled) setSections(cached) })
    }
    warehousesApi.cells(warehouseId)
      .then(d => {
        if (cancelled) return
        const list = d.sections || []
        setSections(list)
        MEM.sections.set(warehouseId, list)
        writeCache(keySections(warehouseId), list)
      })
      .catch(() => { /* при ошибке — оставляем кэш */ })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [warehouseId, reloadKey])

  const reload = useCallback(() => setReloadKey(k => k + 1), [])

  const warehouse = warehouses.find(w => String(w.id) === String(warehouseId)) || null

  return { warehouses, warehousesLoading, warehouse, sections, setSections, loading, reload }
}
