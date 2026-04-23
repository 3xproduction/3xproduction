import { useEffect } from 'react'

// Блокировка скролла body, пока открыта модалка/оверлей/слайд-панель.
// iOS Safari любит «протаскивать» скролл на underlay — фиксируем
// body через position: fixed (сохраняя текущий scroll) и возвращаем
// на место при закрытии.
//
// Использование: useBodyLock(isOpen)
//
// Несколько одновременных потребителей учитываются через счётчик —
// последний закрывшийся освобождает body.
const STATE = {
  count: 0,
  scrollY: 0,
  originalStyles: null,
}

function lock() {
  if (STATE.count === 0) {
    STATE.scrollY = window.scrollY || window.pageYOffset || 0
    const body = document.body
    STATE.originalStyles = {
      position: body.style.position,
      top: body.style.top,
      width: body.style.width,
      overflow: body.style.overflow,
    }
    body.style.position = 'fixed'
    body.style.top = `-${STATE.scrollY}px`
    body.style.width = '100%'
    body.style.overflow = 'hidden'
  }
  STATE.count++
}

function unlock() {
  if (STATE.count <= 0) return
  STATE.count--
  if (STATE.count === 0) {
    const body = document.body
    const s = STATE.originalStyles || {}
    body.style.position = s.position || ''
    body.style.top = s.top || ''
    body.style.width = s.width || ''
    body.style.overflow = s.overflow || ''
    window.scrollTo(0, STATE.scrollY)
  }
}

export function useBodyLock(isOpen) {
  useEffect(() => {
    if (!isOpen) return
    lock()
    return () => unlock()
  }, [isOpen])
}
