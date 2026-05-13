import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
const BACKEND_ROUTES = [
  '/auth', '/invites', '/units', '/project-units', '/handovers', '/colleagues',
  '/warehouses', '/requests', '/issuances', '/documents', '/rent', '/public',
  '/analytics', '/team', '/lists', '/debts', '/locations', '/decorations',
  '/vehicles', '/search', '/projects', '/push', '/notifications', '/admin', '/health',
]

const proxy = Object.fromEntries(
  BACKEND_ROUTES.map(p => [p, { target: 'http://localhost:3000', changeOrigin: true }])
)

export default defineConfig({
  plugins: [react()],
  server: { host: true, proxy, allowedHosts: true },
  preview: { host: true, proxy, allowedHosts: true },
})
