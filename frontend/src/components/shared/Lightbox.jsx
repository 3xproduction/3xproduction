import { useState, useEffect, useCallback, useRef } from 'react'
import { X, ChevronLeft, ChevronRight } from 'lucide-react'
import { useBodyLock } from '../../hooks/useBodyLock'

// Расстояние между двумя касаниями — для pinch-zoom.
function touchDistance(a, b) {
  const dx = a.clientX - b.clientX
  const dy = a.clientY - b.clientY
  return Math.sqrt(dx * dx + dy * dy)
}

const css = `
.lb-overlay {
  position: fixed; inset: 0; z-index: 10000;
  background: rgba(0,0,0,0.92);
  display: flex; align-items: center; justify-content: center;
  animation: lb-fade 0.15s ease;
}
@keyframes lb-fade { from { opacity: 0; } to { opacity: 1; } }

.lb-img {
  max-width: 90vw; max-height: 85vh;
  object-fit: contain;
  border-radius: 4px;
  user-select: none;
  -webkit-user-drag: none;
  touch-action: none;
  will-change: transform;
  transition: transform 0.18s ease;
}
.lb-img.zooming { transition: none; cursor: grab; }
.lb-img.zooming:active { cursor: grabbing; }

.lb-close {
  position: absolute; top: 16px; right: 16px;
  width: 40px; height: 40px; border-radius: 50%;
  background: rgba(255,255,255,0.12); border: none;
  color: #fff; cursor: pointer;
  display: flex; align-items: center; justify-content: center;
  transition: background 0.15s;
  z-index: 2;
}
.lb-close:hover { background: rgba(255,255,255,0.25); }

.lb-arrow {
  position: absolute; top: 50%; transform: translateY(-50%);
  width: 44px; height: 44px; border-radius: 50%;
  background: rgba(255,255,255,0.12); border: none;
  color: #fff; cursor: pointer;
  display: flex; align-items: center; justify-content: center;
  transition: background 0.15s;
  z-index: 2;
}
.lb-arrow:hover { background: rgba(255,255,255,0.25); }
.lb-arrow-left { left: 16px; }
.lb-arrow-right { right: 16px; }

.lb-counter {
  position: absolute; bottom: 20px; left: 50%; transform: translateX(-50%);
  color: rgba(255,255,255,0.7); font-size: 13px; font-weight: 500;
  z-index: 2;
}

.lb-thumbs {
  position: absolute; bottom: 44px; left: 50%; transform: translateX(-50%);
  display: flex; gap: 6px; z-index: 2;
}
.lb-thumb {
  width: 48px; height: 48px; border-radius: 6px;
  object-fit: cover; cursor: pointer;
  border: 2px solid transparent;
  opacity: 0.6; transition: opacity 0.15s, border-color 0.15s;
}
.lb-thumb:hover { opacity: 0.9; }
.lb-thumb.active { border-color: #fff; opacity: 1; }

@media (max-width: 768px) {
  .lb-arrow { width: 36px; height: 36px; }
  .lb-arrow-left { left: 8px; }
  .lb-arrow-right { right: 8px; }
  .lb-thumbs { display: none; }
}
`

function isVideoUrl(url) {
  if (!url) return false
  const lower = url.toLowerCase()
  return lower.includes('.mp4') || lower.includes('.webm') || lower.includes('.mov')
}

export default function Lightbox({ photos = [], startIndex = 0, onClose }) {
  const [idx, setIdx] = useState(startIndex)
  useBodyLock(true)

  // Pinch-zoom + pan + double-tap. Реализуем сами, потому что
  // index.html запрещает нативный pinch (maximum-scale=1.0).
  const [scale, setScale] = useState(1)
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const gestureRef = useRef({ mode: null })
  const lastTapRef = useRef(0)
  const isZoomed = scale > 1.02

  // При смене фото — сбрасываем зум.
  useEffect(() => {
    setScale(1)
    setPan({ x: 0, y: 0 })
  }, [idx])

  const go = useCallback((dir) => {
    setIdx(i => (i + dir + photos.length) % photos.length)
  }, [photos.length])

  useEffect(() => {
    function onKey(e) {
      if (e.key === 'Escape') onClose()
      if (e.key === 'ArrowLeft') go(-1)
      if (e.key === 'ArrowRight') go(1)
    }
    window.addEventListener('keydown', onKey)
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = ''
    }
  }, [onClose, go])

  // Touch-handlers для img:
  //   1 палец, не зум → swipe между фото
  //   1 палец, зум    → pan (двигаем фото)
  //   2 пальца        → pinch (масштаб)
  //   двойной тап     → toggle zoom
  function handleImgTouchStart(e) {
    if (e.touches.length === 2) {
      e.preventDefault()
      gestureRef.current = {
        mode: 'pinch',
        d0: touchDistance(e.touches[0], e.touches[1]),
        s0: scale,
      }
    } else if (e.touches.length === 1) {
      const t = e.touches[0]
      // Двойной тап: переключаем зум 1↔2.5.
      const now = Date.now()
      if (now - lastTapRef.current < 280) {
        e.preventDefault()
        lastTapRef.current = 0
        if (isZoomed) {
          setScale(1); setPan({ x: 0, y: 0 })
        } else {
          setScale(2.5)
          setPan({ x: 0, y: 0 })
        }
        gestureRef.current = { mode: null }
        return
      }
      lastTapRef.current = now
      if (isZoomed) {
        gestureRef.current = {
          mode: 'pan',
          x0: t.clientX - pan.x,
          y0: t.clientY - pan.y,
        }
      } else {
        gestureRef.current = {
          mode: 'swipe',
          x0: t.clientX,
          y0: t.clientY,
        }
      }
    }
  }
  function handleImgTouchMove(e) {
    const g = gestureRef.current
    if (g.mode === 'pinch' && e.touches.length === 2) {
      e.preventDefault()
      const d = touchDistance(e.touches[0], e.touches[1])
      const s = Math.max(1, Math.min(5, g.s0 * (d / g.d0)))
      setScale(s)
    } else if (g.mode === 'pan' && e.touches.length === 1) {
      e.preventDefault()
      setPan({
        x: e.touches[0].clientX - g.x0,
        y: e.touches[0].clientY - g.y0,
      })
    }
  }
  function handleImgTouchEnd(e) {
    const g = gestureRef.current
    // Свайп между фото — только если не было pinch/pan.
    if (g.mode === 'swipe') {
      const t = (e.changedTouches && e.changedTouches[0]) || null
      if (t) {
        const dx = t.clientX - g.x0
        const dy = t.clientY - g.y0
        if (Math.abs(dx) >= 50 && Math.abs(dx) > Math.abs(dy) && photos.length > 1) {
          go(dx > 0 ? -1 : 1)
        }
      }
    }
    // Pinch-out обратно к ~1 — снэпим на 1 и сбрасываем pan.
    if (scale < 1.05) {
      if (scale !== 1) setScale(1)
      if (pan.x !== 0 || pan.y !== 0) setPan({ x: 0, y: 0 })
    }
    gestureRef.current = { mode: null }
  }

  if (!photos.length) return null

  const src = typeof photos[idx] === 'string' ? photos[idx] : photos[idx]?.url

  return (
    <>
      <style>{css}</style>
      <div
        className="lb-overlay"
        onClick={e => { e.stopPropagation(); if (!isZoomed) onClose() }}
      >
        <div onClick={e => e.stopPropagation()}>
          {isVideoUrl(src) ? (
            <video className="lb-img" src={src} controls autoPlay style={{ outline: 'none' }} />
          ) : (
            <img
              className={`lb-img${isZoomed ? ' zooming' : ''}`}
              src={src}
              alt=""
              onTouchStart={handleImgTouchStart}
              onTouchMove={handleImgTouchMove}
              onTouchEnd={handleImgTouchEnd}
              onDoubleClick={(e) => {
                e.stopPropagation()
                if (isZoomed) { setScale(1); setPan({ x: 0, y: 0 }) }
                else { setScale(2.5); setPan({ x: 0, y: 0 }) }
              }}
              style={{
                transform: `translate(${pan.x}px, ${pan.y}px) scale(${scale})`,
              }}
            />
          )}
        </div>

        <button className="lb-close" onClick={onClose}>
          <X size={20} />
        </button>

        {photos.length > 1 && (
          <>
            <button className="lb-arrow lb-arrow-left" onClick={e => { e.stopPropagation(); go(-1) }}>
              <ChevronLeft size={22} />
            </button>
            <button className="lb-arrow lb-arrow-right" onClick={e => { e.stopPropagation(); go(1) }}>
              <ChevronRight size={22} />
            </button>
          </>
        )}

        {photos.length > 1 && (
          <div className="lb-thumbs">
            {photos.map((p, i) => {
              const thumbSrc = typeof p === 'string' ? p : p?.url
              return isVideoUrl(thumbSrc) ? (
                <div key={i} className={`lb-thumb${i === idx ? ' active' : ''}`}
                  style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#333', fontSize: 18 }}
                  onClick={e => { e.stopPropagation(); setIdx(i) }}>
                  {''}
                </div>
              ) : (
                <img key={i} className={`lb-thumb${i === idx ? ' active' : ''}`}
                  src={thumbSrc} alt=""
                  onClick={e => { e.stopPropagation(); setIdx(i) }} />
              )
            })}
          </div>
        )}

        <div className="lb-counter">{idx + 1} / {photos.length}</div>
      </div>
    </>
  )
}
