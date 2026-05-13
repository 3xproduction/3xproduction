// Удаление фона через наш бэкенд (rembg sidecar в YC SC).
// Бесплатно (Python `rembg` self-hosted), не зависит от внешних CDN,
// нет 200MB модели в браузере, мобилки не падают по памяти.
//
// Endpoint: POST /units/remove-bg, multipart `photo`, ответ — JPEG с белым фоном.
// Cold-start sidecar — до 15 секунд. Warm — 1-3 сек.

const ENDPOINT = '/units/remove-bg'
const WARM_ENDPOINT = '/units/remove-bg/warm'

// Модель rembg, передаваемая в sidecar v1.8+. На staging тестируем `u2net` —
// часто работает лучше isnet на «свет на свет». На prod-app v1.13 этот
// параметр не передаётся (старая версия фронта) → sidecar берёт дефолтный
// isnet-general-use → поведение для prod-юзеров не меняется.
const REMBG_MODEL = 'u2net'

function getApiBase() {
  // Та же логика что в services/api.js — для LAN-доступа с телефона.
  if (typeof window === 'undefined') return ''
  const port = window.location.port
  if (port === '5173' || port === '4173') {
    return `${window.location.protocol}//${window.location.hostname}:3000`
  }
  return ''
}

function authToken() {
  return (typeof localStorage !== 'undefined' && localStorage.getItem('token')) || ''
}

// Прогрев sidecar. Дёргается при открытии модалки добавления и при включении
// тоггла «белый фон». Запрос фоновый, ответ не ждём — к моменту submit'а
// контейнер уже warm (cold-start с ~15с до ~0).
let _warmInflight = null
export async function preloadBgModel() {
  if (_warmInflight) return _warmInflight
  const base = getApiBase()
  _warmInflight = fetch(base + WARM_ENDPOINT, {
    method: 'GET',
    headers: { 'x-auth-token': authToken() },
  }).catch(() => null).finally(() => {
    // 60 сек — окно после которого считаем sidecar опять «холодным».
    setTimeout(() => { _warmInflight = null }, 60_000)
  })
  return _warmInflight
}

// Основная функция — отправляет файл на наш endpoint, получает JPEG с белым
// фоном. При срабатывании sanity-check sidecar возвращает оригинал + хэдер
// `X-Bg-Skipped`, ставим маркер `_bgSkipped` на возвращённом File — UI решит,
// показать ли warning-toast.
export async function removeBgWhite(file, opts = {}) {
  const base = getApiBase()
  const fd = new FormData()
  fd.append('photo', file)

  // 95с — backend держит до 90с на sidecar (cold-start ~15с). Запас 5с
  // на сетевые задержки. AbortError мобилка получит, если страница ушла в
  // фон и iOS убил коннект — UI покажет «попробуй ещё раз».
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort('timeout'), 95_000)

  const url = base + ENDPOINT + (REMBG_MODEL ? `?model=${encodeURIComponent(REMBG_MODEL)}` : '')

  let r
  try {
    const headers = { 'x-auth-token': authToken() }
    if (opts.bulkFlow) headers['X-Bulk-Flow'] = 'unit-bulk-upload'
    r = await fetch(url, {
      method: 'POST',
      headers,
      body: fd,
      signal: ctrl.signal,
    })
  } catch (err) {
    clearTimeout(timer)
    if (err?.name === 'AbortError') {
      const e = new Error('timeout')
      e.code = 'timeout'
      throw e
    }
    const e = new Error('network: ' + String(err?.message || err).slice(0, 100))
    e.code = 'network'
    throw e
  }
  clearTimeout(timer)

  if (!r.ok) {
    const txt = await r.text().catch(() => '')
    let msg = `server_${r.status}`
    try { msg = JSON.parse(txt).error || msg } catch { /* non-JSON body — оставляем server_NNN */ }
    const e = new Error(msg + (txt && txt.length < 200 ? `: ${txt}` : ''))
    e.code = `http_${r.status}`
    throw e
  }

  const blob = await r.blob()
  const baseName = (file.name || 'photo').replace(/\.[^.]+$/, '')
  const out = new File([blob], baseName + '_white.jpg', { type: 'image/jpeg' })
  // Sidecar решил, что маска ненадёжна — это «успех с оговоркой». Возвращаем
  // оригинал-в-jpeg, но помечаем чтобы UI кинул информационный toast.
  const skipped = r.headers.get('x-bg-skipped')
  if (skipped) out._bgSkipped = skipped
  return out
}

// Унифицированное сообщение об ошибке removeBgWhite. Маппит технические коды
// в понятные пользователю фразы, чтобы не показывать «server_502: ...».
export function describeBgError(err) {
  const code = err?.code || ''
  if (code === 'timeout') return 'Не удалось обработать фон: превышено время ожидания. Загружаю как есть.'
  if (code === 'network') return 'Не удалось обработать фон: нет связи с сервером. Загружаю как есть.'
  if (code === 'http_413') return 'Фото слишком большое для обработки фона. Загружаю как есть.'
  if (code === 'http_401' || code === 'http_403') return 'Нет доступа к обработке фона. Загружаю как есть.'
  if (code.startsWith('http_5')) return 'Сервис обработки фона недоступен. Загружаю как есть.'
  // На крайний случай — короткое сообщение без обрезанного http-payload'а.
  const msg = String(err?.message || '').split(':')[0].slice(0, 60)
  return `Не удалось обработать фон${msg ? ` (${msg})` : ''}. Загружаю как есть.`
}

// Описание sanity-skip от sidecar для UI.
export function describeBgSkipped(reason) {
  if (reason === 'low-confidence-empty') return 'Фон не распознан: предмет слишком сливается с фоном. Оставлен оригинал.'
  if (reason === 'low-confidence-full') return 'Фон не распознан: предмет занимает почти весь кадр. Оставлен оригинал.'
  return 'Фон не распознан, оставлен оригинал.'
}
