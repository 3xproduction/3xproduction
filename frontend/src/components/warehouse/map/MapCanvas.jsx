import { useEffect, useRef, useState, useCallback } from 'react'
import { Rnd } from 'react-rnd'
import { RotateCw } from 'lucide-react'
import { useGesture } from '@use-gesture/react'
import ShelfSection from './ShelfSection'
import HangerSection from './HangerSection'
import PlaceSection from './PlaceSection'

// Virtual canvas size — the area inside which sections live.
const CANVAS_W = 4000
const CANVAS_H = 3000

const MIN_ZOOM = 0.05
const MAX_ZOOM = 10

export default function MapCanvas({
  sections,
  editMode,
  canEdit,
  selectedCellId,
  selectedSectionId,
  focusSectionId,          // when this changes, pan/center the map on that section
  onCellClick,
  onSectionClick,
  onSectionLayoutChange,   // (id, { x_pos, y_pos, width, height, rotation? }) — local+persist
  onSectionDoubleClick,    // двойной клик → переход в edit-mode
}) {
  // State для drag-rotation ручки.
  const rotateRef = useRef({ active: false, id: null, cx: 0, cy: 0, startAngle: 0, startRotation: 0 })
  const [, forceRender] = useState(0)
  // Детект двойного тапа на секцию (на мобилке dblclick ненадёжен).
  const lastTapRef = useRef({ time: 0, sectionId: null })
  const startRotateDrag = useCallback((e, section, rect) => {
    e.stopPropagation()
    e.preventDefault()
    const cx = rect.left + rect.width / 2
    const cy = rect.top + rect.height / 2
    const startAngle = Math.atan2(e.clientY - cy, e.clientX - cx)
    rotateRef.current = {
      active: true,
      id: section.id,
      cx, cy, startAngle,
      startRotation: Number(section.rotation) || 0,
    }
    forceRender(n => n + 1)

    const onMove = (ev) => {
      if (!rotateRef.current.active) return
      const cur = Math.atan2(ev.clientY - rotateRef.current.cy, ev.clientX - rotateRef.current.cx)
      const delta = (cur - rotateRef.current.startAngle) * 180 / Math.PI
      let next = rotateRef.current.startRotation + delta
      next = ((next % 360) + 360) % 360
      // Shift — snap к 15°
      if (ev.shiftKey) next = Math.round(next / 15) * 15
      onSectionLayoutChange?.(rotateRef.current.id, { rotation: Math.round(next) })
    }
    const onUp = () => {
      rotateRef.current.active = false
      rotateRef.current.id = null
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      forceRender(n => n + 1)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }, [onSectionLayoutChange])
  const wrapRef = useRef(null)
  const [zoom, setZoom] = useState(0.7)
  const [pan, setPan] = useState({ x: 0, y: 0 })

  // --- Pan + pinch state (touch / wheel) ---
  const gestureRef = useRef({
    panning: false,
    startX: 0, startY: 0,
    startPanX: 0, startPanY: 0,
    pinching: false,
    startDist: 0,
    startZoom: 1,
    midX: 0, midY: 0,
    startPanForPinch: { x: 0, y: 0 },
  })

  // На первом монтировании подстраиваем масштаб и пан так, чтобы все секции
  // помещались в видимую область с небольшим отступом. Если секций нет —
  // центрируем канвас по умолчанию. Также пере-фитим при смене ориентации /
  // существенном изменении размеров контейнера (актуально на мобилке).
  const initialisedRef = useRef(false)
  const lastFitSizeRef = useRef({ w: 0, h: 0 })
  const fitToSections = useCallback(() => {
    const el = wrapRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    if (!rect.width || !rect.height) return

    const laid = sections.filter(s => s.width && s.height)
    const isMobile = rect.width < 640
    const padding = isMobile ? 20 : 80

    if (!laid.length) {
      if (sections.length === 0) return
      setPan({ x: rect.width / 2 - (CANVAS_W * 0.4) / 2, y: 40 })
      setZoom(0.4)
      lastFitSizeRef.current = { w: rect.width, h: rect.height }
      initialisedRef.current = true
      return
    }
    const xs = laid.map(s => (s.x_pos || 0))
    const ys = laid.map(s => (s.y_pos || 0))
    const rxs = laid.map(s => (s.x_pos || 0) + (s.width || 0))
    const rys = laid.map(s => (s.y_pos || 0) + (s.height || 0))
    const minX = Math.min(...xs), minY = Math.min(...ys)
    const maxX = Math.max(...rxs), maxY = Math.max(...rys)
    const bboxW = Math.max(1, maxX - minX)
    const bboxH = Math.max(1, maxY - minY)

    const zoomX = (rect.width - padding * 2) / bboxW
    const zoomY = (rect.height - padding * 2) / bboxH
    const maxInitial = isMobile ? 1.1 : 0.9
    const targetZoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, Math.min(zoomX, zoomY, maxInitial)))

    const centreX = (minX + maxX) / 2
    const centreY = (minY + maxY) / 2
    setZoom(targetZoom)
    setPan({
      x: rect.width / 2 - centreX * targetZoom,
      y: rect.height / 2 - centreY * targetZoom,
    })
    lastFitSizeRef.current = { w: rect.width, h: rect.height }
    initialisedRef.current = true
  }, [sections])

  useEffect(() => {
    if (initialisedRef.current) return
    fitToSections()
  }, [fitToSections])

  // Re-fit при смене размеров контейнера (rotation на мобилке, resize окна).
  useEffect(() => {
    const el = wrapRef.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(entries => {
      const entry = entries[0]
      if (!entry) return
      const { width, height } = entry.contentRect
      const last = lastFitSizeRef.current
      // Пере-фитим только при существенном изменении — чтобы случайные
      // 1px-дрожжания контейнера не сбивали пользовательский pan/zoom.
      const dw = Math.abs(width - last.w) / Math.max(1, last.w)
      const dh = Math.abs(height - last.h) / Math.max(1, last.h)
      if (initialisedRef.current && (dw > 0.25 || dh > 0.25)) {
        fitToSections()
      }
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [fitToSections])

  // Pan/zoom so the focused section is centred in the viewport.
  useEffect(() => {
    if (!focusSectionId) return
    const s = sections.find(x => String(x.id) === String(focusSectionId))
    if (!s) return
    const el = wrapRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    const w = s.width || 460
    const h = s.height || 220
    const centreX = (s.x_pos || 0) + w / 2
    const centreY = (s.y_pos || 0) + h / 2
    const targetZoom = 0.85
    setZoom(targetZoom)
    setPan({
      x: rect.width / 2 - centreX * targetZoom,
      y: rect.height / 2 - centreY * targetZoom,
    })
  }, [focusSectionId, sections])

  // Wheel zoom — plain wheel zooms (Miro-style). Shift+wheel pans.
  const onWheel = useCallback((e) => {
    if (e.shiftKey) {
      e.preventDefault()
      setPan(p => ({ x: p.x - e.deltaY, y: p.y - e.deltaX }))
      return
    }
    e.preventDefault()
    const rect = wrapRef.current.getBoundingClientRect()
    const mx = e.clientX - rect.left
    const my = e.clientY - rect.top
    const delta = -e.deltaY * 0.0015
    setZoom(z => {
      const nz = clamp(z * (1 + delta), MIN_ZOOM, MAX_ZOOM)
      // Zoom around cursor.
      setPan(p => ({
        x: mx - ((mx - p.x) * nz) / z,
        y: my - ((my - p.y) * nz) / z,
      }))
      return nz
    })
  }, [])

  // Touch: 1 finger pans canvas, 2 пальца — pinch-zoom.
  // Если одиночный тач начался ВНУТРИ секции в edit-mode (когда Rnd может
  // тащить/ресайзить) или на ручке вращения — не перехватываем. В остальных
  // случаях (в том числе по карточкам в обычном режиме) паним канвас.
  const onTouchStart = useCallback((e) => {
    const g = gestureRef.current
    const target = e.target
    const closestFn = target instanceof Element ? target.closest.bind(target) : null
    const inSection = !!(closestFn && (closestFn('[data-section-root]') || closestFn('.wh-section')))
    const onRotateHandle = !!(closestFn && closestFn('.wh-rotate-handle'))

    if (e.touches.length === 1) {
      // В editMode драг/ресайз секций обрабатывает Rnd — пропускаем panning.
      // Ручку вращения тоже не перехватываем независимо от режима.
      if (onRotateHandle) return
      if (editMode && inSection) return
      g.panning = true
      g.startX = e.touches[0].clientX
      g.startY = e.touches[0].clientY
      g.startPanX = pan.x
      g.startPanY = pan.y
    } else if (e.touches.length === 2) {
      // В edit-mode 2 пальца на секции = pinch/rotate секции (см. onTouchStart
      // секции ниже). На канвасе — зум канваса.
      if (editMode && inSection) return
      g.panning = false
      g.pinching = true
      const [t1, t2] = [e.touches[0], e.touches[1]]
      g.startDist = Math.hypot(t2.clientX - t1.clientX, t2.clientY - t1.clientY)
      g.startZoom = zoom
      const rect = wrapRef.current.getBoundingClientRect()
      g.midX = (t1.clientX + t2.clientX) / 2 - rect.left
      g.midY = (t1.clientY + t2.clientY) / 2 - rect.top
      g.startPanForPinch = { ...pan }
    }
  }, [pan, zoom, editMode])

  const onTouchMove = useCallback((e) => {
    const g = gestureRef.current
    if (g.pinching && e.touches.length === 2) {
      e.preventDefault()
      const [t1, t2] = [e.touches[0], e.touches[1]]
      const d = Math.hypot(t2.clientX - t1.clientX, t2.clientY - t1.clientY)
      const nz = clamp(g.startZoom * (d / g.startDist), MIN_ZOOM, MAX_ZOOM)
      setZoom(nz)
      // Keep mid-point anchored.
      setPan({
        x: g.midX - ((g.midX - g.startPanForPinch.x) * nz) / g.startZoom,
        y: g.midY - ((g.midY - g.startPanForPinch.y) * nz) / g.startZoom,
      })
    } else if (g.panning && e.touches.length === 1) {
      const dx = e.touches[0].clientX - g.startX
      const dy = e.touches[0].clientY - g.startY
      setPan({ x: g.startPanX + dx, y: g.startPanY + dy })
    }
  }, [])

  const onTouchEnd = useCallback(() => {
    gestureRef.current.panning = false
    gestureRef.current.pinching = false
  }, [])

  // Miro-style pan: any left-click drag on empty canvas background pans.
  // (Middle button also works.) React-rnd sections stop propagation on their
  // own pointer events so dragging inside a section never reaches here.
  const onBgPointerDown = useCallback((e) => {
    if (e.pointerType === 'touch') return // handled by touch handlers
    // Only start pan when the gesture begins on the canvas itself, not on
    // a child (section / cell button). Check via currentTarget vs target.
    const isBg = e.target === e.currentTarget
      || e.target.classList?.contains('wh-canvas')
    if (!isBg && e.button !== 1) return
    if (e.button === 0 || e.button === 1) {
      e.preventDefault()
      const g = gestureRef.current
      g.panning = true
      g.startX = e.clientX
      g.startY = e.clientY
      g.startPanX = pan.x
      g.startPanY = pan.y
      wrapRef.current.setPointerCapture?.(e.pointerId)
    }
  }, [pan])

  const onBgPointerMove = useCallback((e) => {
    const g = gestureRef.current
    if (!g.panning || e.pointerType === 'touch') return
    const dx = e.clientX - g.startX
    const dy = e.clientY - g.startY
    setPan({ x: g.startPanX + dx, y: g.startPanY + dy })
  }, [])

  const onBgPointerUp = useCallback((e) => {
    gestureRef.current.panning = false
    wrapRef.current?.releasePointerCapture?.(e.pointerId)
  }, [])

  const resetView = () => {
    const el = wrapRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    setZoom(0.7)
    setPan({
      x: rect.width / 2 - (CANVAS_W * 0.7) / 2,
      y: 60,
    })
  }

  const zoomStep = (dir) => {
    setZoom(z => clamp(z * (dir > 0 ? 1.2 : 1 / 1.2), MIN_ZOOM, MAX_ZOOM))
  }

  return (
    <div
      ref={wrapRef}
      className="wh-canvas-wrap"
      onWheel={onWheel}
      onPointerDown={onBgPointerDown}
      onPointerMove={onBgPointerMove}
      onPointerUp={onBgPointerUp}
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onTouchEnd={onTouchEnd}
      style={{
        position: 'relative',
        width: '100%', height: '100%',
        overflow: 'hidden',
        background: editMode
          ? 'linear-gradient(#f1f5fa, #f1f5fa), repeating-linear-gradient(0deg, transparent 0 39px, rgba(30,157,218,0.15) 39px 40px), repeating-linear-gradient(90deg, transparent 0 39px, rgba(30,157,218,0.15) 39px 40px)'
          : 'var(--bg)',
        backgroundBlendMode: editMode ? 'multiply' : 'normal',
        touchAction: 'none',
        cursor: gestureRef.current.panning ? 'grabbing' : 'grab',
      }}
    >
      <div
        className="wh-canvas"
        style={{
          position: 'absolute',
          top: 0, left: 0,
          width: CANVAS_W, height: CANVAS_H,
          transformOrigin: '0 0',
          transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
        }}
      >
        {sections.map(s => {
          const isSelected = String(selectedSectionId) === String(s.id)
          const rotation = Number(s.rotation) || 0
          const isRotating = rotateRef.current.active && String(rotateRef.current.id) === String(s.id)
          return (
            <Rnd
              key={s.id}
              className="wh-section"
              size={{ width: s.width || 460, height: s.height || 220 }}
              position={{ x: s.x_pos || 0, y: s.y_pos || 0 }}
              disableDragging={!editMode || isRotating}
              enableResizing={editMode && !isRotating}
              scale={zoom}
              minWidth={80}
              minHeight={60}
              resizeHandleStyles={editMode ? {
                bottomRight: { width: 18, height: 18, right: -9, bottom: -9, borderRadius: 3, background: 'var(--gold-500)', border: '2px solid #fff', boxShadow: '0 2px 6px rgba(0,0,0,0.2)', zIndex: 10 },
                bottomLeft:  { width: 18, height: 18, left: -9, bottom: -9, borderRadius: 3, background: 'var(--gold-500)', border: '2px solid #fff', boxShadow: '0 2px 6px rgba(0,0,0,0.2)', zIndex: 10 },
                topRight:    { width: 18, height: 18, right: -9, top: -9, borderRadius: 3, background: 'var(--gold-500)', border: '2px solid #fff', boxShadow: '0 2px 6px rgba(0,0,0,0.2)', zIndex: 10 },
                topLeft:     { width: 18, height: 18, left: -9, top: -9, borderRadius: 3, background: 'var(--gold-500)', border: '2px solid #fff', boxShadow: '0 2px 6px rgba(0,0,0,0.2)', zIndex: 10 },
              } : undefined}
              onDragStop={(_, d) => {
                onSectionLayoutChange?.(s.id, { x_pos: Math.round(d.x), y_pos: Math.round(d.y) })
              }}
              onResizeStop={(_, __, ref, ___, pos) => {
                onSectionLayoutChange?.(s.id, {
                  x_pos: Math.round(pos.x),
                  y_pos: Math.round(pos.y),
                  width: Math.round(parseFloat(ref.style.width)),
                  height: Math.round(parseFloat(ref.style.height)),
                })
              }}
              onClick={() => {
                // Cells call stopPropagation, so this only fires on the frame.
                // Селект работает и в editMode — нужен для отображения ручки вращения.
                // Двойной клик/тап: если второй клик пришёл <400ms и по той же
                // секции — переход в режим редактирования (работает и на мобилке,
                // где native dblclick не всегда срабатывает).
                const now = Date.now()
                const last = lastTapRef.current
                if (canEdit && last.sectionId === s.id && now - last.time < 400) {
                  lastTapRef.current = { time: 0, sectionId: null }
                  onSectionDoubleClick?.(s)
                  return
                }
                lastTapRef.current = { time: now, sectionId: s.id }
                onSectionClick?.(s)
              }}
              style={{
                cursor: editMode ? 'move' : 'pointer',
                // В edit-mode отключаем нативные touch-жесты на обёртке секции,
                // чтобы drag/resize Rnd работали на мобилке без дёргания от
                // браузерного скролла.
                touchAction: editMode ? 'none' : 'manipulation',
              }}
            >
              <SectionGestureRoot
                section={s}
                editMode={editMode && canEdit}
                onScale={(w, h) => onSectionLayoutChange?.(s.id, { width: w, height: h })}
                onRotate={(rot) => onSectionLayoutChange?.(s.id, { rotation: rot })}
                onDoubleClick={(e) => {
                  e.stopPropagation()
                  if (canEdit) onSectionDoubleClick?.(s)
                }}
              >
                {/* Rotation wrapper — CSS rotate вокруг центра.
                    Внутри: секция + ручка вращения + рамка выделения — всё
                    крутится вместе как единый объект (Miro-стиль). */}
                <div
                  style={{
                    width: '100%', height: '100%',
                    position: 'relative',
                    transform: rotation ? `rotate(${rotation}deg)` : undefined,
                    transformOrigin: '50% 50%',
                    transition: isRotating ? 'none' : 'transform 0.2s',
                    // Рамка выделения — тоже крутится вместе с секцией
                    outline: editMode
                      ? '2px dashed rgba(184,147,90,0.6)'
                      : isSelected ? '3px solid var(--gold-500)' : 'none',
                    outlineOffset: 2,
                    borderRadius: 10,
                  }}
                >
                  {s.type === 'hanger' ? (
                    <HangerSection section={s} selectedCellId={selectedCellId} onCellClick={onCellClick} />
                  ) : s.type === 'place' ? (
                    <PlaceSection section={s} selectedCellId={selectedCellId} onCellClick={onCellClick} />
                  ) : (
                    <ShelfSection section={s} selectedCellId={selectedCellId} onCellClick={onCellClick} />
                  )}

                  {/* Рычажок вращения — прикреплён к верхнему-правому углу секции
                      и крутится вместе с ней (внутри rotation-wrapper).
                      В edit-mode показываем для ВСЕХ секций (не надо предварительно
                      выделять), иначе — только у выбранной. */}
                  {canEdit && (editMode || isSelected) && (
                    <RotateHandle
                      onPointerDown={(e, rect) => startRotateDrag(e, s, rect)}
                      active={isRotating}
                    />
                  )}
                </div>
              </SectionGestureRoot>
            </Rnd>
          )
        })}
      </div>

      {/* Floating zoom toolbar */}
      <div className="wh-zoom-toolbar" style={{
        position: 'absolute', right: 16, bottom: 16,
        display: 'flex', flexDirection: 'column', gap: 6,
        background: 'var(--white)',
        padding: 6, borderRadius: 12,
        boxShadow: '0 6px 16px rgba(0,0,0,0.12)',
        border: '1px solid var(--border)',
        zIndex: 10,
      }}>
        <ZoomBtn onClick={() => zoomStep(1)}  title="Увеличить">＋</ZoomBtn>
        <div style={{
          fontSize: 10, fontWeight: 600, textAlign: 'center',
          color: 'var(--muted)', padding: '2px 0',
        }}>{Math.round(zoom * 100)}%</div>
        <ZoomBtn onClick={() => zoomStep(-1)} title="Уменьшить">－</ZoomBtn>
        <div style={{ height: 1, background: 'var(--border)', margin: '2px 4px' }} />
        <ZoomBtn onClick={resetView} title="Сбросить вид">⊙</ZoomBtn>
      </div>
    </div>
  )
}

function ZoomBtn({ children, onClick, title }) {
  return (
    <button
      onClick={onClick}
      title={title}
      style={{
        width: 34, height: 34,
        border: '1px solid var(--border)', borderRadius: 8,
        background: 'var(--white)', color: 'var(--text)',
        fontSize: 16, fontWeight: 600, cursor: 'pointer',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        transition: 'background 0.15s',
      }}
      onMouseEnter={e => e.currentTarget.style.background = 'var(--bg)'}
      onMouseLeave={e => e.currentTarget.style.background = 'var(--white)'}
    >{children}</button>
  )
}

function clamp(v, min, max) { return Math.max(min, Math.min(max, v)) }

/**
 * Ручка вращения Miro-стиля — плавающий круглый элемент над секцией.
 * При `pointerdown` захватывает drag, родитель считает угол относительно
 * центра секции. При `shift` — snap к 15°.
 */
/**
 * Обёртка секции с поддержкой мульти-тач жестов (@use-gesture/react).
 * - onPinch: scale (только изменение размеров, без вращения)
 *   — решение «ready-made», корректно работает на мобильных браузерах,
 *     обрабатывает cancel, multi-touch, момент скорости.
 * - onDoubleClick — прокидывается как есть (десктопный dblclick).
 *
 * Вращение отделено и идёт через RotateHandle (круговую ручку сверху
 * секции), чтобы pinch не крутил секцию от случайного дрожания пальцев.
 */
function SectionGestureRoot({ section, editMode, onScale, onRotate, onDoubleClick, children }) {
  const rootRef = useRef(null)
  const memoRef = useRef(null)

  useGesture(
    {
      onPinch: ({ first, last, offset: [scale], memo }) => {
        if (!editMode) return memo
        if (first) {
          memoRef.current = { w: section.width || 460, h: section.height || 220 }
          memo = memoRef.current
        }
        const base = memo || memoRef.current
        if (!base) return memo
        const nextW = Math.max(80, Math.round(base.w * scale))
        const nextH = Math.max(60, Math.round(base.h * scale))
        onScale?.(nextW, nextH)
        if (last) memoRef.current = null
        return memo
      },
    },
    {
      target: rootRef,
      eventOptions: { passive: false },
      pinch: {
        scaleBounds: { min: 0.25, max: 8 },
        // rubberband — гасит «отскок» при достижении границ
        rubberband: true,
      },
      // enabled — выключаем всё когда не edit mode, чтобы жест был
      // проброшен канвасу (pinch-zoom всего склада).
      enabled: !!editMode,
    }
  )

  // При воспроизведении scale @use-gesture выдаёт offset относительно
  // «нуля» жеста, но нам интересен только масштаб — angle не трогаем.
  // onRotate остаётся для будущего использования; сейчас не вызывается.
  void onRotate

  return (
    <div
      ref={rootRef}
      data-section-root="true"
      onDoubleClick={onDoubleClick}
      style={{
        width: '100%', height: '100%',
        position: 'relative',
        touchAction: editMode ? 'none' : 'manipulation',
      }}
    >
      {children}
    </div>
  )
}

function RotateHandle({ onPointerDown, active }) {
  return (
    <button
      className="wh-rotate-handle"
      onPointerDown={(e) => {
        e.stopPropagation()
        e.preventDefault()
        // Центр секции: родитель handle — rotation-wrapper (не крутит собственный
        // bounding box после rotation — rect меняется). Берём outerWrapper выше —
        // он НЕ крутится, его bbox = исходный ректангл секции, центр совпадает.
        const rotationWrapper = e.currentTarget.parentElement
        const outerWrapper = rotationWrapper?.parentElement
        const rect = (outerWrapper || rotationWrapper).getBoundingClientRect()
        onPointerDown(e, rect)
      }}
      onClick={e => e.stopPropagation()}
      style={{
        position: 'absolute',
        // Правый верхний угол, но чуть дальше от corner-resize (18×18 на -9),
        // чтобы ручка вращения и ручка ресайза не перекрывались.
        top: -34, right: -34,
        width: active ? 36 : 32, height: active ? 36 : 32,
        borderRadius: '50%',
        background: active ? 'var(--gold-500)' : 'var(--ink-900)',
        color: active ? 'var(--ink-900)' : 'var(--gold-500)',
        border: '2px solid var(--gold-500)',
        boxShadow: active
          ? '0 0 0 4px rgba(184,147,90,0.25), 0 4px 12px rgba(0,0,0,0.2)'
          : '0 2px 8px rgba(0,0,0,0.25)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        cursor: active ? 'grabbing' : 'grab',
        padding: 0,
        zIndex: 20,
        transition: active ? 'none' : 'background 0.12s, box-shadow 0.12s',
        touchAction: 'none',
      }}
      title="Потяни для поворота. Shift — шаг 15°"
    >
      <RotateCw size={14} strokeWidth={2} />
    </button>
  )
}
