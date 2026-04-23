import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import { AuthProvider } from './hooks/useAuth'
import { ToastProvider } from './components/shared/Toast'

// PWA: регистрируем service worker сразу при загрузке. Без этого Chrome
// не покажет кнопку «Установить приложение», а iOS не сможет корректно
// запустить сайт в standalone-режиме после «На экран Домой».
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {})
  })
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <AuthProvider>
      <ToastProvider>
        <App />
      </ToastProvider>
    </AuthProvider>
  </StrictMode>,
)
