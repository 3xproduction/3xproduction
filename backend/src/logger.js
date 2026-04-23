const pino = require('pino')

const isProduction = process.env.NODE_ENV === 'production'

const logger = pino({
  level: process.env.LOG_LEVEL || (isProduction ? 'info' : 'debug'),
  base: undefined,
  redact: {
    paths: [
      'req.headers.authorization',
      'req.headers.cookie',
      'password',
      'password_hash',
      '*.password',
      '*.password_hash',
      '*.token',
      'DATABASE_URL',
      'JWT_SECRET',
    ],
    censor: '[REDACTED]',
  },
  ...(isProduction ? {} : {
    transport: {
      target: 'pino-pretty',
      options: {
        colorize: true,
        translateTime: 'HH:MM:ss',
        ignore: 'pid,hostname',
      },
    },
  }),
})

module.exports = logger
