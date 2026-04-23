const BASE = import.meta.env.VITE_API_URL || ''

function getToken() {
  return localStorage.getItem('token')
}

// Эндпоинты, для которых 401 не должен инициировать принудительный logout.
// Ключ-признак — это /public/* (публичный кабинет) и /auth/login (логин сам
// обрабатывает 401 в форме).
const SKIP_AUTO_LOGOUT = [/^\/public\//, /^\/auth\/login$/]

async function request(method, path, body, opts = {}) {
  const headers = { 'Content-Type': 'application/json' }
  const token = getToken()
  if (token) headers['X-Auth-Token'] = token

  const config = {
    method,
    headers,
    ...opts,
  }

  if (body && !(body instanceof FormData)) {
    config.body = JSON.stringify(body)
  } else if (body instanceof FormData) {
    // Для FormData нельзя ставить Content-Type — браузер сам добавит boundary.
    // Сохраняем только X-Auth-Token, если он есть.
    const fdHeaders = {}
    if (token) fdHeaders['X-Auth-Token'] = token
    config.headers = fdHeaders
    config.body = body
  }

  const res = await fetch(`${BASE}${path}`, config)
  const data = await res.json().catch(() => ({}))

  if (!res.ok) {
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
}

// ─── Invites ─────────────────────────────────────────────────────────────────
export const invites = {
  get:      (token) => request('GET',  `/invites/${token}`),
  generate: (body)  => request('POST', '/invites/generate', body),
}

// ─── Units ───────────────────────────────────────────────────────────────────
export const units = {
  list:     (params = {}) => {
    const q = new URLSearchParams(params).toString()
    return request('GET', `/units${q ? '?' + q : ''}`)
  },
  get:      (id)   => request('GET',  `/units/${id}`),
  create:   (body) => request('POST', '/units', body),
  update:   (id, body) => request('PUT', `/units/${id}`, body),
  delete:   (id)       => request('DELETE', `/units/${id}`),
  bulkDelete: (ids)    => request('POST', '/units/bulk-delete', { ids }),
  approvals: ()    => request('GET',  '/units/approvals'),
  approve:  (id, approval_id, valuation, extra) => request('POST', `/units/${id}/approve`, { approval_id, valuation, ...(extra || {}) }),
  reject:   (id, approval_id, reason) => request('POST', `/units/${id}/reject`, { approval_id, reason }),
  writeoff: (id, reason) => request('POST', `/units/${id}/writeoff`, { reason }),
  requestWriteoff: (id, reason) => request('POST', `/units/${id}/request-writeoff`, { reason }),
  markMissing:     (id, reason) => request('POST', `/units/${id}/mark-missing`, { reason }),
  resolveMissing:  (id)         => request('POST', `/units/${id}/resolve-missing`),
  uploadPhoto: (id, formData) => request('POST', `/units/${id}/photos`, formData),
  recognize:   (formData) => request('POST', '/units/recognize', formData),
  deletePhoto: (id, photoId) => request('DELETE', `/units/${id}/photos/${photoId}`),
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
  update:        (id, body) => request('PUT',    `/project-units/${id}`, body),
  delete:        (id, reason) => request('DELETE', `/project-units/${id}`, reason ? { reason } : undefined),
  uploadReceipt:  (formData) => request('POST',   '/project-units/upload-receipt', formData),
  transfer:      (id, comment) => request('POST', `/project-units/${id}/transfer-to-warehouse`, { comment }),
  pendingTransfers: ()      => request('GET',   '/project-units/pending-transfers'),
  acceptTransfer: (id, warehouse_id, cell_id) =>
    request('POST', `/project-units/${id}/accept-transfer`, { warehouse_id, cell_id }),
  rejectTransfer: (id, reason) =>
    request('POST', `/project-units/${id}/reject-transfer`, { reason }),

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

// ─── Warehouses / Cells ──────────────────────────────────────────────────────
export const warehouses = {
  list:          ()             => request('GET',  '/warehouses'),
  create:        (body)         => request('POST', '/warehouses', body),
  cells:         (warehouseId) => request('GET',  `/warehouses/${warehouseId}/cells`),
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
    return request('GET', `/requests${q ? '?' + q : ''}`)
  },
  create: (body)        => request('POST', '/requests', body),
  status: (id, status)  => request('PUT',  `/requests/${id}/status`, { status }),
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
}

// ─── Analytics ───────────────────────────────────────────────────────────────
export const analytics = {
  warehouse: ()             => request('GET', '/analytics/warehouse'),
  producer:  (projectId)   => {
    const q = projectId ? `?project_id=${projectId}` : ''
    return request('GET', `/analytics/producer${q}`)
  },
  project:   (projectId) => request('GET', `/analytics/project/${projectId}`),
}

// ─── Global Search ──────────────────────────────────────────────────────────
export const search = {
  query: (q, params = {}) => {
    const p = new URLSearchParams({ q, ...params })
    return request('GET', `/search?${p}`)
  },
  recent: () => request('GET', '/search/recent'),
}
