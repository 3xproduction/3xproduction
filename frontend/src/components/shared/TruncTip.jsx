// TruncTip — обёртка над текстом с многоточием. Если текст не влез в ширину
// родителя — при наведении мыши (desktop) или тапе (mobile) показывает поповер
// с полным значением.
//
// Поведение:
//   • Применяет однострочное обрезание (whiteSpace: nowrap; overflow: hidden;
//     text-overflow: ellipsis) — caller может подменить через style/className.
//   • Через ResizeObserver следит за scrollWidth vs clientWidth — если текст
//     не обрезан, тултип не показывается, никакого мерцания/мусора.
//   • На мобильном тапе e.stopPropagation() чтобы тултип не закрылся
//     одновременно открытием карточки и user успел его прочитать. Закрытие —
//     повторный тап / клик вне / scroll / resize.
//   • Поповер через position:fixed на координатах getBoundingClientRect —
//     избегает clipping'а внутри overflow:hidden родителей.
//
// Пример:
//   <TruncTip as="div" style={{ fontWeight: 500, fontSize: 13 }}>{unit.name}</TruncTip>

import { useEffect, useRef, useState } from 'react'

// Минимальный набор стилей для однострочного обрезания. maxWidth НЕ задаём
// здесь — иначе перекроет CSS-правила класса (например `.uc-row-value
// { max-width: 60% }`). Ширина задаётся родителем (block-уровневая обёртка)
// или CSS-классом caller'а.
const baseTrunc = {
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
}
// Для span — inline-block, чтобы scrollWidth корректно отражал ширину
// контента (без этого в некоторых браузерах = clientWidth и обрезание
// не детектится). Для div — оставляем естественный block.
function defaultDisplayFor(tag) {
  return tag === 'span' ? 'inline-block' : undefined
}

export default function TruncTip({
  children,
  className = '',
  style,
  as: Tag = 'span',
  fullText,            // если children — JSX (а не строка), передать строку для тултипа
  stopPropagation = true,
  ...rest
}) {
  const ref = useRef(null)
  const [open, setOpen] = useState(false)
  const [truncated, setTruncated] = useState(false)
  const [coords, setCoords] = useState(null)

  // Проверка обрезания: scrollWidth (полная ширина контента) > clientWidth
  // (видимая). Запас 1px на субпиксельные расхождения.
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const check = () => setTruncated(el.scrollWidth > el.clientWidth + 1)
    check()
    let ro
    if (typeof ResizeObserver !== 'undefined') {
      ro = new ResizeObserver(check)
      ro.observe(el)
    }
    return () => ro?.disconnect()
  }, [children])

  // Закрытие тултипа: тап вне триггера, scroll, resize.
  useEffect(() => {
    if (!open) return
    function handleOutside(e) {
      if (!ref.current?.contains(e.target)) setOpen(false)
    }
    function handleScrollOrResize() { setOpen(false) }
    document.addEventListener('mousedown', handleOutside)
    document.addEventListener('touchstart', handleOutside, { passive: true })
    window.addEventListener('scroll', handleScrollOrResize, true)
    window.addEventListener('resize', handleScrollOrResize)
    return () => {
      document.removeEventListener('mousedown', handleOutside)
      document.removeEventListener('touchstart', handleOutside)
      window.removeEventListener('scroll', handleScrollOrResize, true)
      window.removeEventListener('resize', handleScrollOrResize)
    }
  }, [open])

  function show() {
    if (!truncated) return
    const r = ref.current?.getBoundingClientRect()
    if (!r) return
    setCoords({ top: r.top, left: r.left + r.width / 2 })
    setOpen(true)
  }

  function handleClick(e) {
    if (!truncated) return
    if (stopPropagation) e.stopPropagation()
    if (open) setOpen(false); else show()
  }

  const tipText = fullText ?? (typeof children === 'string' ? children : '')

  return (
    <>
      <Tag
        ref={ref}
        className={className}
        style={{
          display: defaultDisplayFor(Tag),
          ...baseTrunc,
          ...style,
        }}
        onMouseEnter={show}
        onMouseLeave={() => setOpen(false)}
        onClick={handleClick}
        {...rest}
      >
        {children}
      </Tag>
      {open && coords && tipText && (
        <div
          className="tt-popover"
          style={{
            position: 'fixed',
            top: coords.top - 10,
            left: coords.left,
            transform: 'translate(-50%, -100%)',
            zIndex: 9999,
            background: '#1a1a1a',
            color: '#fff',
            padding: '7px 12px',
            borderRadius: 8,
            fontSize: 12.5,
            fontWeight: 500,
            maxWidth: 'min(320px, 90vw)',
            boxShadow: '0 6px 18px rgba(0,0,0,0.22)',
            whiteSpace: 'normal',
            wordBreak: 'break-word',
            pointerEvents: 'none',
            lineHeight: 1.4,
            letterSpacing: '0.01em',
          }}
        >
          {tipText}
          <div style={{
            position: 'absolute', top: '100%', left: '50%',
            transform: 'translateX(-50%)',
            width: 0, height: 0,
            borderLeft: '5px solid transparent',
            borderRight: '5px solid transparent',
            borderTop: '5px solid #1a1a1a',
          }} />
        </div>
      )}
    </>
  )
}
