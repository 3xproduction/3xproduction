const BASE = import.meta.env.VITE_API_URL || (['5173', '4173'].includes(location.port) ? `${location.protocol}//${location.hostname}:3000` : '')
const UNIT_BULK_FLOW_HEADERS = { 'X-Bulk-Flow': 'unit-bulk-upload' }
const UNIT_BULK_RETRY_OPTS = {
  headers: UNIT_BULK_FLOW_HEADERS,
  retry429: true,
  retry429Attempts: 8,
  retry429BaseMs: 1200,
}

function getToken() {
  return localStorage.getItem('token')
}

function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

function retryAfterMs(res, attempt, baseMs) {
  const raw = res.headers.get('Retry-After')
  if (raw) {
    const seconds = Number(raw)
    if (Number.isFinite(seconds)) return Math.min(Math.max(seconds * 1000, 1000), 60_000)
    const dateMs = Date.parse(raw)
    if (Number.isFinite(dateMs)) return Math.min(Math.max(dateMs - Date.now(), 1000), 60_000)
  }
  const backoff = Math.min(baseMs * (2 ** attempt), 15_000)
  return backoff + Math.floor(Math.random() * 350)
}

// ── Кэш GET-запросов: in-memory + localStorage (stale-while-revalidate) ──
// Каталог/склады/заявки — тяжёлые. Сетка такая:
//
//   • In-memory cache (TTL 30s) — попадание = мгновенный return без сети.
//   • localStorage (TTL 24h)    — пережил перезагрузку. При наличии:
//       сначала отдаём *кэш как stale*, затем тихо в фоне дёргаем сеть и
//       резолвим Promise свежими данными. Колл-сайт получит ОБА колбэка
//       через метод .onUpdate(cb) на возвращённом промисе.
//
// Cold-start serverless container ~5-10 сек — никак не уйдёт без provisioned,
// но stale-while-revalidate делает повторные заходы (а это 90% случаев)
// мгновенными визуально.
const _cache = new Map()
function _cacheGet(key) {
  const e = _cache.get(key)
  if (!e) return null
  if (Date.now() > e.expiresAt) { _cache.delete(key); return null }
  return e.data
}
function _cacheSet(key, data, ttlMs) {
  _cache.set(key, { data, expiresAt: Date.now() + ttlMs })
}
// Префиксы путей, инвалидированные мутацией (units.create, .update, и т.п.).
// Следующий cachedGet с совпадающим префиксом обойдёт LS-stale и пойдёт
// сразу в сеть — иначе после `unitsApi.create() → await unitsApi.list()`
// caller получил бы старый список без только что созданной единицы.
// После первого fresh-fetch префикс снимается → дальше обычный SWR.
const _invalidatedPrefixes = new Set()
function _consumeInvalidatedPrefix(path) {
  for (const p of _invalidatedPrefixes) {
    if (path.startsWith(p)) {
      _invalidatedPrefixes.delete(p)
      return true
    }
  }
  return false
}

function _cacheInvalidate(prefixes) {
  const arr = Array.isArray(prefixes) ? prefixes : [prefixes]
  for (const k of _cache.keys()) {
    if (arr.some(p => k.startsWith(p))) _cache.delete(k)
  }
  // localStorage НЕ чистим: он работает как stale-fallback для холодного
  // старта (refresh страницы / открытие после долгой паузы). Если стереть —
  // на refresh пользователь снова увидит пустой каталог + 5-10 сек "Загрузка…"
  // (cold-start serverless). Помечаем префиксы как "инвалид" — ближайший
  // in-session cachedGet с этим путём сходит в сеть, а не вернёт устаревший LS.
  for (const p of arr) _invalidatedPrefixes.add(p)
}

const LS_PREFIX = 'apicache:'
// 30 дней. Раньше было 24h — слишком короткий, юзер не каждый день заходит,
// после 24h простоя кэш пропадал → на холодный старт получал пустой экран
// + 30-60 сек ожидания (cold-start serverless container). Лучше показать
// очень устаревший список, чем "Загрузка..." на минуту: cachedGet всё равно
// в фоне дёрнет сеть и обновит через .onUpdate.
const LS_TTL = 30 * 24 * 60 * 60 * 1000 // 30 days
function _lsGet(key) {
  try {
    const raw = localStorage.getItem(LS_PREFIX + key)
    if (!raw) return null
    const obj = JSON.parse(raw)
    if (!obj || Date.now() > obj.expiresAt) return null
    return obj.data
  } catch { return null }
}
function _lsSet(key, data) {
  try {
    localStorage.setItem(LS_PREFIX + key, JSON.stringify({ data, expiresAt: Date.now() + LS_TTL }))
  } catch { /* quota */ }
}

// Синхронно отдаёт stale-кэш (in-memory или localStorage) если есть, иначе null.
// Используется для инициализации useState из закешированных данных, чтобы
// при холодном старте контейнера (5-10 сек) пользователь видел старый список
// сразу, а не пустой "Загрузка..." до прихода свежих данных.
export function peekCache(path) {
  return _cacheGet(path) || _lsGet(path) || null
}

// Возвращает promise, на котором есть .onUpdate(cb) — вызывается со свежими
// данными когда они приходят из сети после stale-показа.
function cachedGet(path, ttlMs = 30000) {
  const mem = _cacheGet(path)
  if (mem) {
    const p = Promise.resolve(mem)
    p.onUpdate = () => p  // у in-memory hit нет фонового апдейта — самим уже свежо
    return p
  }
  // Если путь был инвалидирован недавней мутацией — игнорируем LS-stale и
  // идём сразу в сеть. Иначе caller (например, unitsApi.list() после create)
  // получит старый список без только что созданной/изменённой записи.
  const wasInvalidated = _consumeInvalidatedPrefix(path)
  const stale = wasInvalidated ? null : _lsGet(path)
  if (stale) {
    // stale-while-revalidate: возвращаем stale моментально, в фоне обновляем.
    let updateCb = null
    const fresh = request('GET', path).then(data => {
      _cacheSet(path, data, ttlMs)
      _lsSet(path, data)
      if (updateCb) {
        try { updateCb(data) } catch { /* swallow */ }
      }
      return data
    }).catch(() => stale) // сеть упала — оставим stale
    const p = Promise.resolve(stale)
    p.onUpdate = (cb) => { updateCb = cb; return fresh }
    return p
  }
  // Холодный старт без stale — ждём сеть.
  const p = request('GET', path).then(data => {
    _cacheSet(path, data, ttlMs)
    _lsSet(path, data)
    return data
  })
  _cacheSet(path, p, 1000) // защита от параллельных дублей
  p.onUpdate = () => p
  return p
}

// Эндпоинты, для которых 401 не должен инициировать принудительный logout.
// Ключ-признак — это /public/* (публичный кабинет) и /auth/login (логин сам
// обрабатывает 401 в форме).
const SKIP_AUTO_LOGOUT = [/^\/public\//, /^\/auth\/login$/]

async function request(method, path, body, opts = {}) {
  const {
    retry429 = false,
    retry429Attempts = 0,
    retry429BaseMs = 1000,
    headers: extraHeaders = {},
    ...fetchOpts
  } = opts

  const isFormData = body instanceof FormData
  const headers = isFormData
    ? { ...extraHeaders }
    : { 'Content-Type': 'application/json', ...extraHeaders }
  const token = getToken()
  if (token) headers['X-Auth-Token'] = token

  const config = {
    method,
    headers,
    ...fetchOpts,
  }

  if (body && !isFormData) {
    config.body = JSON.stringify(body)
  } else if (isFormData) {
    // Для FormData нельзя ставить Content-Type — браузер сам добавит boundary.
    // Сохраняем только специальные заголовки и X-Auth-Token, если он есть.
    const fdHeaders = { ...extraHeaders }
    if (token) fdHeaders['X-Auth-Token'] = token
    config.headers = fdHeaders
    config.body = body
  }

  for (let attempt = 0; ; attempt++) {
    const res = await fetch(`${BASE}${path}`, config)
    const data = await res.json().catch(() => ({}))

    if (!res.ok) {
      if (res.status === 429 && retry429 && attempt < retry429Attempts) {
        await wait(retryAfterMs(res, attempt, retry429BaseMs))
        continue
      }

      // 401 с валидной ранее авторизацией → токен протух/невалиден. Чистим
      // сессию и даём дружелюбное сообщение. Исключения — публичные эндпоинты.
      const isSkipAutoLogout = SKIP_AUTO_LOGOUT.some(rx => rx.test(path))
      if (res.status === 401 && !isSkipAutoLogout && token) {
        localStorage.removeItem('token')
        localStorage.removeItem('user')
        const err = new Error('Сессия истекла — войдите заново')
        err.status = 401
        err.data = data
        // Мягкий редирект на логин, чтобы пользователь не застревал
        setTimeout(() => {
          if (!location.pathname.startsWith('/login')) location.href = '/login'
        }, 800)
        throw err
      }

      const err = new Error(data.error || `HTTP ${res.status}`)
      err.status = res.status
      err.data = data
      throw err
    }

    return data
  }
}

// ─── Auth ────────────────────────────────────────────────────────────────────
export const auth = {
  login:          (email, password) => request('POST', '/auth/login',          { email, password }),
  register:       (body)            => request('POST', '/auth/register',        body),
  users:          ()                => request('GET',  '/auth/users'),
  impersonate:    (user_id)         => request('POST', '/auth/impersonate',     { user_id }),
  recoverRequest: (email)           => request('POST', '/auth/recover/request', { email }),
  recoverVerify:  (email, code)     => request('POST', '/auth/recover/verify',  { email, code }),
  recoverReset:   (email, code, password) =>
    request('POST', '/auth/recover/reset', { email, code, password }),
  changeName:     (name)           => request('PATCH', '/auth/name',     { name }),
  changePhone:    (phone)          => request('PATCH', '/auth/phone',    { phone }),
  changePassword: (current, next) => request('PATCH', '/auth/password', { current, next }),
  // Walk-in claim: provisional-юзер ставит пароль и получает JWT.
  claimGet:       (token)                  => request('GET',  `/auth/claim/${token}`),
  claimSet:       (token, password, email) => request('POST', `/auth/claim/${token}`, { password, email }),
}

// ─── Invites ─────────────────────────────────────────────────────────────────
export const invites = {
  get:      (token) => request('GET',  `/invites/${token}`),
  generate: (body)  => request('POST', '/invites/generate', body),
}

// ─── Units ───────────────────────────────────────────────────────────────────
// Любая мутация над units/warehouses/requests дёргает _invalidateUnitsRelated:
// каталог/карта/заявки часто отображают одни и те же данные в разных разрезах.
function _invalidateUnitsRelated() {
  _cacheInvalidate(['/units', '/warehouses', '/requests', '/issuances', '/project-units', '/colleagues', '/admin-units'])
}

export const units = {
  list:     (params = {}) => {
    const q = new URLSearchParams(params).toString()
    // Поиск (?search=) не кэшируем — слишком переменчивый.
    if (params.search) return request('GET', `/units${q ? '?' + q : ''}`)
    return cachedGet(`/units${q ? '?' + q : ''}`)
  },
  // Синхронный peek в кэш — для инициализации state'а на первом рендере.
  // Поиск не кэшируется, поэтому для search-параметров возвращаем null.
  listCached: (params = {}) => {
    if (params.search) return null
    const q = new URLSearchParams(params).toString()
    return peekCache(`/units${q ? '?' + q : ''}`)
  },
  get:      (id)   => request('GET',  `/units/${id}`),
  create:   (body) => request('POST', '/units', body).then(r => { _invalidateUnitsRelated(); return r }),
  update:   (id, body) => request('PUT', `/units/${id}`, body).then(r => { _invalidateUnitsRelated(); return r }),
  delete:   (id)       => request('DELETE', `/units/${id}`).then(r => { _invalidateUnitsRelated(); return r }),
  bulkDelete: (ids)    => request('POST', '/units/bulk-delete', { ids }).then(r => { _invalidateUnitsRelated(); return r }),
  approvals: ()    => request('GET',  '/units/approvals'),
  approve:  (id, approval_id, valuation, extra) => request('POST', `/units/${id}/approve`, { approval_id, valuation, ...(extra || {}) }).then(r => { _invalidateUnitsRelated(); return r }),
  reject:   (id, approval_id, reason) => request('POST', `/units/${id}/reject`, { approval_id, reason }).then(r => { _invalidateUnitsRelated(); return r }),
  writeoff: (id, reason) => request('POST', `/units/${id}/writeoff`, { reason }).then(r => { _invalidateUnitsRelated(); return r }),
  requestWriteoff: (id, reason) => request('POST', `/units/${id}/request-writeoff`, { reason }).then(r => { _invalidateUnitsRelated(); return r }),
  markMissing:     (id, reason) => request('POST', `/units/${id}/mark-missing`, { reason }).then(r => { _invalidateUnitsRelated(); return r }),
  resolveMissing:  (id)         => request('POST', `/units/${id}/resolve-missing`).then(r => { _invalidateUnitsRelated(); return r }),
  uploadPhoto: (id, formData) => request('POST', `/units/${id}/photos`, formData).then(r => { _invalidateUnitsRelated(); return r }),
  recognize:   (formData) => request('POST', '/units/recognize', formData),
  listBulkMatch: (params = {}) => {
    const q = new URLSearchParams(params).toString()
    return request('GET', `/units${q ? '?' + q : ''}`, undefined, UNIT_BULK_RETRY_OPTS)
  },
  createBulk: (body) =>
    request('POST', '/units', body, UNIT_BULK_RETRY_OPTS).then(r => { _invalidateUnitsRelated(); return r }),
  uploadPhotoBulk: (id, formData) =>
    request('POST', `/units/${id}/photos`, formData, UNIT_BULK_RETRY_OPTS).then(r => { _invalidateUnitsRelated(); return r }),
  recognizeBulk: (formData) => request('POST', '/units/recognize', formData, UNIT_BULK_RETRY_OPTS),
  deletePhoto: (id, photoId) => request('DELETE', `/units/${id}/photos/${photoId}`).then(r => { _invalidateUnitsRelated(); return r }),
  regenPhotoBg: (id, photoId, model = 'u2net') => request('POST', `/units/${id}/photos/${photoId}/regen-bg`, { model }).then(r => { _invalidateUnitsRelated(); return r }),
  bulkRegenBg: (ids, opts = {}) => request('POST', '/units/bulk-regen-bg', { ids, ...opts }).then(r => { _invalidateUnitsRelated(); return r }),
  history:  (id)   => request('GET', `/units/${id}/history`),
}

// ─── Writeoffs — списания единиц (выбыли при возврате или помечены долгом) ──
export const writeoffs = {
  list:   ()     => request('GET',  '/writeoffs'),
  create: (body) => request('POST', '/writeoffs', body),
  convertToWriteoff: (id) => request('POST', `/writeoffs/${id}/convert-to-writeoff`),
}

// ─── Colleagues' project warehouses (cross-project visibility + loan requests) ──
export const colleagues = {
  projects:     ()    => request('GET', '/colleagues/projects'),
  projectUnits: (id)  => request('GET', `/colleagues/projects/${id}/units`),
  responders:   (projectId, category) =>
    request('GET', `/colleagues/responders?project_id=${encodeURIComponent(projectId)}&category=${encodeURIComponent(category || '')}`),

  // Loan requests between projects
  createRequest: (body) => request('POST',  '/colleagues/requests', body),
  listRequests:  (direction = 'incoming', status) => {
    const q = new URLSearchParams({ direction, ...(status ? { status } : {}) }).toString()
    return request('GET', `/colleagues/requests?${q}`)
  },
  acceptRequest: (id, comment) => request('POST', `/colleagues/requests/${id}/accept`, { comment }),
  rejectRequest: (id, comment) => request('POST', `/colleagues/requests/${id}/reject`, { comment }),
  cancelRequest: (id)          => request('POST', `/colleagues/requests/${id}/cancel`),
  returnRequest: (id)          => request('POST', `/colleagues/requests/${id}/return`),
  extendRequest: (id, new_deadline) => request('POST', `/colleagues/requests/${id}/extend`, { new_deadline }),
  approveExtension: (id)       => request('POST', `/colleagues/requests/${id}/approve-extension`),
}

// ─── Handovers — inventory handover between employees of a project ──────────
export const handovers = {
  list: (params = {}) => {
    const q = new URLSearchParams(params).toString()
    return request('GET', `/handovers${q ? '?' + q : ''}`)
  },
  get:    (id)          => request('GET',    `/handovers/${id}`),
  create: (body)        => request('POST',   '/handovers', body),
  check:  (id, itemId, body) => request('PUT', `/handovers/${id}/items/${itemId}`, body),
  sign:   (id)          => request('POST',   `/handovers/${id}/sign`),
  delete: (id)          => request('DELETE', `/handovers/${id}`),
}

// ─── Project-kept units (stored only in a project inventory) ────────────────
export const projectUnits = {
  list: (params = {}) => {
    const q = new URLSearchParams(params).toString()
    return request('GET', `/project-units${q ? '?' + q : ''}`)
  },
  create:            (body) => request('POST',   '/project-units', body),
  createForProjectPhoto: (formData) =>
    request('POST', '/project-units/create-for-project-photo', formData).then(r => { _invalidateUnitsRelated(); return r }),
  createForProjectPhotos: (formData) =>
    request('POST', '/project-units/create-for-project-photo', formData).then(r => { _invalidateUnitsRelated(); return r }),
  createForProjectPhotosBulk: (formData) =>
    request('POST', '/project-units/create-for-project-photo', formData, UNIT_BULK_RETRY_OPTS).then(r => { _invalidateUnitsRelated(); return r }),
  intakeToWarehousePhotosBulk: (formData) =>
    request('POST', '/project-units/intake-to-warehouse-photo', formData, UNIT_BULK_RETRY_OPTS).then(r => { _invalidateUnitsRelated(); return r }),
  recordProjectIntakeBulk: (id, project_id, comment) =>
    request('POST', `/project-units/${id}/record-intake`, { project_id, comment }, UNIT_BULK_RETRY_OPTS).then(r => { _invalidateUnitsRelated(); return r }),
  update:        (id, body) => request('PUT',    `/project-units/${id}`, body),
  delete:        (id, reason) => request('DELETE', `/project-units/${id}`, reason ? { reason } : undefined),
  uploadReceipt:  (formData) => request('POST',   '/project-units/upload-receipt', formData),
  purchasedByProjects: ()   => request('GET',   '/project-units/purchased-by-projects'),
  transfer:      (id, comment) => request('POST', `/project-units/${id}/transfer-to-warehouse`, { comment }),
  pendingTransfers: ()      => request('GET',   '/project-units/pending-transfers'),
  // Список всех проектов — для селектора в ProjectWarehousePage (wh-director/deputy/producer).
  allProjects:      ()      => request('GET',   '/project-units/projects'),
  acceptTransfer: (id, warehouse_id, cell_id) =>
    request('POST', `/project-units/${id}/accept-transfer`, { warehouse_id, cell_id }),
  rejectTransfer: (id, reason) =>
    request('POST', `/project-units/${id}/reject-transfer`, { reason }),
  // Batch-перемещение единиц с центрального склада на склад указанного проекта.
  // Доступно warehouse_director / warehouse_deputy / warehouse_staff.
  // Возвращает { ok, moved_count, errors[], project }.
  moveToProject: (unit_ids, project_id) =>
    request('POST', '/project-units/move-to-project', { unit_ids, project_id }).then(r => { _invalidateUnitsRelated(); return r }),
  moveToProjectBulk: (unit_ids, project_id) =>
    request('POST', '/project-units/move-to-project', { unit_ids, project_id }, UNIT_BULK_RETRY_OPTS).then(r => { _invalidateUnitsRelated(); return r }),

  // Двухэтапный возврат: warehouse/producer создаёт запрос → проект имеет 3 дня →
  // warehouse/producer подтверждает фактический возврат.
  requestReturn: (unitId, comment) =>
    request('POST', `/project-units/${unitId}/request-return`, { comment }),
  listReturnRequests: (direction = 'outgoing', status) => {
    const q = new URLSearchParams({ direction, ...(status ? { status } : {}) }).toString()
    return request('GET', `/project-units/return-requests?${q}`)
  },
  confirmReturn: (requestId) =>
    request('POST', `/project-units/return-requests/${requestId}/confirm`),
  cancelReturn:  (requestId) =>
    request('POST', `/project-units/return-requests/${requestId}/cancel`),
}

// ─── Administrative shop stock ──────────────────────────────────────────────
export const adminUnits = {
  list: (params = {}) => {
    const q = new URLSearchParams(params).toString()
    if (params.search) return request('GET', `/admin-units${q ? '?' + q : ''}`)
    return cachedGet(`/admin-units${q ? '?' + q : ''}`)
  },
  create: (body) =>
    request('POST', '/admin-units', body).then(r => { _invalidateUnitsRelated(); return r }),
  uploadReceipt: (formData) =>
    request('POST', '/admin-units/upload-receipt', formData),
}

// ─── Warehouses / Cells ──────────────────────────────────────────────────────
export const warehouses = {
  list:          ()             => cachedGet('/warehouses'),
  create:        (body)         => request('POST', '/warehouses', body).then(r => { _invalidateUnitsRelated(); return r }),
  cells:         (warehouseId) => cachedGet(`/warehouses/${warehouseId}/cells`),
  createSection: (body) => request('POST', '/warehouses/sections', body),
  updateSection: (id, patch) => request('PUT', `/warehouses/sections/${id}`, patch),
  addCell:       (sectionId)     => request('POST', `/warehouses/sections/${sectionId}/cells`),
  renameCell:    (cellId, name) => request('PUT', `/warehouses/cells/${cellId}`, { custom_name: name }),
  deleteCell:    (cellId)      => request('DELETE', `/warehouses/cells/${cellId}`),
  deleteSection: (id)          => request('DELETE', `/warehouses/sections/${id}`),
  deleteWarehouse: (id)        => request('DELETE', `/warehouses/${id}`),
  reorderSections: (section_ids) => request('PUT', '/warehouses/sections/reorder', { section_ids }),
  updateSectionLayout: (id, layout) => request('PUT', `/warehouses/sections/${id}/layout`, layout),
  bulkLayout:    (layouts)      => request('PUT', '/warehouses/sections/layout/bulk', { layouts }),
  requestVisibility: ()         => request('GET', '/warehouses/request-visibility'),
  setRequestVisibility: (user_id, can_see_requests) =>
    request('PUT', '/warehouses/request-visibility', { user_id, can_see_requests }),
}

// ─── Requests ────────────────────────────────────────────────────────────────
export const requests = {
  list:   (params = {}) => {
    const q = new URLSearchParams(params).toString()
    return cachedGet(`/requests${q ? '?' + q : ''}`, 15000)
  },
  create: (body)        => request('POST', '/requests', body).then(r => { _invalidateUnitsRelated(); return r }),
  status: (id, status)  => request('PUT',  `/requests/${id}/status`, { status }).then(r => { _invalidateUnitsRelated(); return r }),
  // Полная пересинхронизация состава активной заявки. formData содержит
  // existing_unit_ids (JSON), new_units (JSON) и поля photos_<temp_id> для
  // новых единиц. См. backend/src/routes/requests.js POST /:id/items.
  updateItems: (id, formData) =>
    request('POST', `/requests/${id}/items`, formData).then(r => { _invalidateUnitsRelated(); return r }),
}

// ─── Issuances ───────────────────────────────────────────────────────────────
export const issuances = {
  active:  ()           => request('GET',  '/issuances/active'),
  acts:    ()           => request('GET',  '/issuances/acts'),
  issue:   (formData)   => request('POST', '/issuances', formData),
  return:  (formData)   => request('POST', '/issuances/returns', formData),
  extend:        (body)   => request('POST', '/issuances/extensions', body),
  requestReturn: (id)     => request('POST', `/issuances/${id}/request-return`),
}

// ─── Documents ───────────────────────────────────────────────────────────────
export const documents = {
  list:    (projectId, type) => {
    const q = type ? `?type=${type}` : ''
    return request('GET', `/documents/${projectId}${q}`)
  },
  listAll: (type) => {
    const q = type ? `?type=${type}` : ''
    return request('GET', `/documents/all${q}`)
  },
  upload:  (formData)  => request('POST', '/documents/upload', formData),
  view:    (projectId, docId) => request('GET', `/documents/${projectId}/view/${docId}`),
  delta:   (id)        => request('GET',  `/documents/${id}/delta`),
  reparse: (id, text)  => request('POST', `/documents/${id}/parse`, { text }),
  lists:      (projectId, role) => request('GET', `/documents/lists/${projectId}/${role}`),
  parsed:     (projectId)      => request('GET',  `/documents/${projectId}/parsed`),
  importToList: (docId)        => request('POST', `/documents/${docId}/import`),
  resetAll:     ()             => request('POST', '/admin/reset-docs'),
  remove:       (id)           => request('DELETE', `/documents/${id}`),
  // Document Groups (Blocks)
  groups:       (projectId) => request('GET', `/documents/groups/${projectId}`),
  createGroup:  (body)      => request('POST', '/documents/groups', body),
  updateGroup:  (id, body)  => request('PATCH', `/documents/groups/${id}`, body),
  deleteGroup:  (id)        => request('DELETE', `/documents/groups/${id}`),
  assignGroup:  (docId, group_id) => request('PATCH', `/documents/${docId}/group`, { group_id }),
}

// ─── Rent ────────────────────────────────────────────────────────────────────
export const rent = {
  list:   (params = {}) => {
    const q = new URLSearchParams(params).toString()
    return request('GET', `/rent${q ? '?' + q : ''}`)
  },
  get:    (id)          => request('GET',  `/rent/${id}`),
  create: (body)        => request('POST', '/rent', body),
  status: (id, status)  => request('PUT',  `/rent/${id}/status`, { status }),
  return: (id, body)    => request('POST', `/rent/${id}/return`, body),
  generateLink: ()      => request('POST', '/rent/public/generate-link'),
  review: (id, body)    => request('PUT',  `/rent/${id}/review`, body),
  workflowStage: (id, stage) => request('PUT', `/rent/${id}/workflow-stage`, { stage }),
  issuePublic: (id, formData) => request('POST', `/rent/${id}/issue-public`, formData),
  requestReturn: (id) => request('POST', `/rent/${id}/request-return`),
  cancelReturnRequest: (id) => request('POST', `/rent/${id}/cancel-return-request`),
  finalizeReturn: (id, formData) => request('POST', `/rent/${id}/finalize-return`, formData),
}

// ─── Public (no auth) ────────────────────────────────────────────────────────
export const publicApi = {
  catalog: (token)       => request('GET',  `/public/warehouse/${token}`),
  sendRequest: (token, body) => request('POST', `/public/warehouse/${token}/request`, body),
  submitCart:   (token, body) => request('POST', `/public/warehouse/${token}/cart-request`, body),
  myDeals:      (token, phone) => request('GET', `/public/warehouse/${token}/my-deals?phone=${encodeURIComponent(phone)}`),
  requestReturn: (token, dealId, phone) =>
    request('POST', `/public/warehouse/${token}/deals/${dealId}/request-return`, { phone }),
}

// ─── Projects ────────────────────────────────────────────────────────────────
export const projects = {
  list:   () => request('GET',  '/projects'),
  create: (name) => request('POST', '/projects', { name }),
  rename: (id, name) => request('PATCH', `/projects/${id}`, { name }),
  remove: (id, move_docs_to) => request('DELETE', `/projects/${id}`, { move_docs_to }),
  reimport: (docId) => request('POST', `/documents/${docId}/reimport`),
}

// ─── Notifications ───────────────────────────────────────────────────────────
export const notifications = {
  list:    (unreadOnly = false) =>
    request('GET', `/notifications${unreadOnly ? '?unread_only=true' : ''}`),
  read:    (id)  => request('POST', `/notifications/${id}/read`),
  readAll: ()    => request('POST', '/notifications/read-all'),
}

// ─── Push ─────────────────────────────────────────────────────────────────────
export const push = {
  vapidKey:    ()  => request('GET', '/push/vapid-key'),
  subscribe:   (sub) => request('POST', '/push/subscribe', sub),
  unsubscribe: (endpoint) => request('DELETE', '/push/subscribe', { endpoint }),
}

// ─── Team ────────────────────────────────────────────────────────────────────
export const team = {
  list: (params = {}) => {
    const q = new URLSearchParams(params).toString()
    return request('GET', `/team${q ? '?' + q : ''}`)
  },
  remove: (userId) => request('DELETE', `/team/${userId}`),
  moveToProject: (userId, project_id) => request('PATCH', `/team/${userId}/project`, { project_id }),
  bulkMove: (project_id) => request('POST', '/team/bulk-move', { project_id }),
}

// ─── Production Lists ─────────────────────────────────────────────────────────
export const lists = {
  all:        (projectId) => request('GET', `/lists${projectId ? '?project_id=' + projectId : ''}`),
  items:      (type, params = {}) => {
    const q = new URLSearchParams(params).toString()
    return request('GET', `/lists/${type}/items${q ? '?' + q : ''}`)
  },
  addItem:    (type, body) => request('POST', `/lists/${type}/items`, body),
  updateItem: (id, body)   => request('PATCH', `/lists/items/${id}`, body),
  deleteItem: (id)         => request('DELETE', `/lists/items/${id}`),
  matchedUnits: (projectId) => request('GET', `/lists/matched-units?project_id=${projectId}`),
  assignScene: (itemId, canonical_id) => request('PATCH', `/lists/items/${itemId}/assign-scene`, { canonical_id }),
}

// ─── Scenes ──────────────────────────────────────────────────────────────────
export const scenes = {
  list:      (projectId) => request('GET', `/scenes?project_id=${projectId}`),
  aiTasks:   (projectId) => request('GET', `/scenes/ai-tasks?project_id=${projectId}`),
  retryTask: (taskId)    => request('POST', `/scenes/ai-tasks/${taskId}/retry`),
}

// ─── Rebuild ─────────────────────────────────────────────────────────────────
export const admin = {
  rebuildPositions: (projectId) => request('POST', `/projects/${projectId}/rebuild-positions`),
  backfillScenes:   () => request('POST', '/admin/backfill-scenes'),
}

// ─── Debts ──────────────────────────────────────────────────────────────────
export const debts = {
  list:     (status) => request('GET', `/debts${status ? '?status=' + status : ''}`),
  create:   (body)   => request('POST', '/debts', body),
  close:    (id)     => request('POST', `/debts/${id}/close`),
  writeoff: (id, reason) => request('POST', `/debts/${id}/writeoff`, { reason }),
  stats:    ()       => request('GET', '/debts/stats'),
}

// ─── Locations ──────────────────────────────────────────────────────────────
export const locations = {
  list:   (params = {}) => {
    const q = new URLSearchParams(params).toString()
    return request('GET', `/locations${q ? '?' + q : ''}`)
  },
  get:         (id)          => request('GET',    `/locations/${id}`),
  create:      (body)        => request('POST',   '/locations', body),
  update:      (id, body)    => request('PUT',    `/locations/${id}`, body),
  delete:      (id)          => request('DELETE', `/locations/${id}`),
  uploadPhoto: (id, formData) => request('POST',  `/locations/${id}/photos`, formData),
  recognize:   (formData)     => request('POST',  '/locations/recognize', formData),
}

// ─── Decorations ────────────────────────────────────────────────────────────
export const decorations = {
  list:   (params = {}) => {
    const q = new URLSearchParams(params).toString()
    return request('GET', `/decorations${q ? '?' + q : ''}`)
  },
  get:         (id)          => request('GET',    `/decorations/${id}`),
  create:      (body)        => request('POST',   '/decorations', body),
  update:      (id, body)    => request('PUT',    `/decorations/${id}`, body),
  delete:      (id)          => request('DELETE', `/decorations/${id}`),
  uploadPhoto: (id, formData) => request('POST',  `/decorations/${id}/photos`, formData),
  linkUnits:   (id, unit_ids) => request('POST',  `/decorations/${id}/units`, { unit_ids }),
  unlinkUnit:  (id, unitId)   => request('DELETE', `/decorations/${id}/units/${unitId}`),
  recognize:   (formData)     => request('POST',  '/decorations/recognize', formData),
  pavilions:   ()              => request('GET',    '/decorations/pavilions'),
}

// ─── Vehicles ───────────────────────────────────────────────────────────────
export const vehicles = {
  list:   (params = {}) => {
    const q = new URLSearchParams(params).toString()
    return request('GET', `/vehicles${q ? '?' + q : ''}`)
  },
  get:         (id)          => request('GET',    `/vehicles/${id}`),
  create:      (body)        => request('POST',   '/vehicles', body),
  update:      (id, body)    => request('PUT',    `/vehicles/${id}`, body),
  delete:      (id)          => request('DELETE', `/vehicles/${id}`),
  uploadPhoto: (id, formData) => request('POST',  `/vehicles/${id}/photos`, formData),
  recognize:   (formData)     => request('POST',  '/vehicles/recognize', formData),
}

// ─── Casting ────────────────────────────────────────────────────────────────
export const casting = {
  list:   (params = {}) => {
    const q = new URLSearchParams(params).toString()
    return request('GET', `/casting${q ? '?' + q : ''}`)
  },
  get:         (id)          => request('GET',    `/casting/${id}`),
  create:      (body)        => request('POST',   '/casting', body),
  update:      (id, body)    => request('PUT',    `/casting/${id}`, body),
  delete:      (id)          => request('DELETE', `/casting/${id}`),
  uploadPhoto: (id, formData) => request('POST',  `/casting/${id}/photos`, formData),
  deletePhoto: (id, photoId) => request('DELETE', `/casting/${id}/photos/${photoId}`),
  recognize:   (formData)    => request('POST',   '/casting/recognize', formData),
}

// ─── Analytics ───────────────────────────────────────────────────────────────
export const analytics = {
  warehouse: ()             => request('GET', '/analytics/warehouse'),
  producer:  (projectId, periodDays) => {
    const params = new URLSearchParams()
    if (projectId) params.set('project_id', projectId)
    if (periodDays) params.set('period_days', String(periodDays))
    const q = params.toString()
    return request('GET', `/analytics/producer${q ? `?${q}` : ''}`)
  },
  project:   (projectId) => request('GET', `/analytics/project/${projectId}`),
}

// ─── Walk-in выдача ─────────────────────────────────────────────────────────
// Один эндпоинт /walkin/issue делает в одной транзакции: project (если новый)
// + project_director (provisional) + получатель (provisional) + units +
// issuance + PDF + email-уведомления.
export const walkin = {
  issue: (formData) => request('POST', '/walkin/issue', formData),
  searchProjects: (q) => request('GET', `/walkin/projects?q=${encodeURIComponent(q)}`),
  searchUsers: (project_id, q) =>
    request('GET', `/walkin/users?project_id=${encodeURIComponent(project_id)}&q=${encodeURIComponent(q)}`),
}

// ─── Выданное по проектам (раздел /issued) ─────────────────────────────────
// Иерархия проект → человек → единицы для warehouse_director/deputy.
// Запросы возврата на 3 уровнях; быстрый mass-return через walkin-return.
export const issued = {
  // view: 'issued' | 'all' | 'new' | 'returning' | 'returned' | 'acts'
  // params: { days: 30 | 90 | 'all' } для returned/acts
  byProjects: (view = 'issued', params = {}) => {
    const qs = new URLSearchParams({ view, ...params }).toString()
    return request('GET', `/issued/by-projects?${qs}`)
  },
  cancelReturnRequestByIssuance: (issuance_id) =>
    request('POST', '/issued/cancel-return-request-by-issuance', { issuance_id }),
  user: (userId) => request('GET', `/issued/user/${userId}`),
  requestReturnByIssuance: (issuance_id) => request('POST', '/issued/request-return-by-issuance', { issuance_id }),
  requestReturnByUser:     (user_id) => request('POST', '/issued/request-return-by-user', { user_id }),
  requestReturnByProject:  (project_id) => request('POST', '/issued/request-return-by-project', { project_id }),
  walkinReturn:            (formData) => request('POST', '/issued/walkin-return', formData),
}

// ─── Global Search ──────────────────────────────────────────────────────────
export const search = {
  query: (q, params = {}) => {
    const p = new URLSearchParams({ q, ...params })
    return request('GET', `/search?${p}`)
  },
  recent: () => request('GET', '/search/recent'),
}
