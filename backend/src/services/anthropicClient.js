const Anthropic = require('@anthropic-ai/sdk')

function createAnthropicClient(options = {}) {
  const config = {
    apiKey: process.env.ANTHROPIC_API_KEY,
    ...options,
  }

  const baseURL = (process.env.ANTHROPIC_BASE_URL || process.env.ANTHROPIC_PROXY_URL || '').trim()
  if (baseURL) config.baseURL = baseURL

  return new Anthropic(config)
}

module.exports = { createAnthropicClient }
