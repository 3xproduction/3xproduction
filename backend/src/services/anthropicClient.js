const Anthropic = require('@anthropic-ai/sdk')

// Прямой api.anthropic.com недоступен из Yandex Cloud (egress — RU IP,
// Anthropic отдаёт 403 "Request not allowed"). Поэтому по умолчанию ходим
// через Cloudflare-прокси, который снимает гео-ограничение. Реальный URL
// можно переопределить через ANTHROPIC_BASE_URL / ANTHROPIC_PROXY_URL, но
// дефолт НЕ должен быть прямым эндпоинтом — иначе все AI-функции падают,
// если env по какой-то причине не доехал до контейнера.
const DEFAULT_ANTHROPIC_BASE_URL = 'https://anthropic-proxy.pavelbelov590.workers.dev'

function createAnthropicClient(options = {}) {
  const config = {
    apiKey: process.env.ANTHROPIC_API_KEY,
    ...options,
  }

  const baseURL = (process.env.ANTHROPIC_BASE_URL || process.env.ANTHROPIC_PROXY_URL || DEFAULT_ANTHROPIC_BASE_URL).trim()
  if (baseURL) config.baseURL = baseURL

  if (!createAnthropicClient._logged) {
    createAnthropicClient._logged = true
    let host = baseURL
    try { host = new URL(baseURL).host } catch { /* keep raw */ }
    console.log('[anthropic] effective baseURL host=%s envBASE=%s envPROXY=%s hasKey=%s',
      host,
      process.env.ANTHROPIC_BASE_URL ? 'set' : 'unset',
      process.env.ANTHROPIC_PROXY_URL ? 'set' : 'unset',
      !!process.env.ANTHROPIC_API_KEY)
  }

  return new Anthropic(config)
}

module.exports = { createAnthropicClient }
