import { useState, useEffect, useCallback } from 'react'
import { X, ChevronLeft, ChevronRight } from 'lucide-react'

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
}

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

  if (!photos.length) return null

  const src = typeof photos[idx] === 'string' ? photos[idx] : photos[idx]?.url

  return (
    <>
      <style>{css}</style>
      <div className="lb-overlay" onClick={e => { e.stopPropagation(); onClose() }}>
        <div onClick={e => e.stopPropagation()}>
          {isVideoUrl(src) ? (
            <video className="lb-img" src={src} controls autoPlay style={{ outline: 'none' }} />
          ) : (
            <img className="lb-img" src={src} alt="" />
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
