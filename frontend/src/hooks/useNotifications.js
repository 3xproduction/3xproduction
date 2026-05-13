import { useState, useEffect, useCallback } from 'react'
import { notifications as notifApi } from '../services/api'
import { useAuth } from './useAuth'

const POLL_INTERVAL = 30_000 // 30 seconds

export function useNotifications() {
  const { token } = useAuth()
  const [items, setItems]       = useState([])
  const [unreadCount, setUnreadCount] = useState(0)

  const fetch = useCallback(async () => {
    if (!token) return
    try {
      const data = await notifApi.list()
      setItems(data.notifications || [])
      setUnreadCount((data.notifications || []).filter(n => !n.read).length)
    } catch {}
  }, [token])

  useEffect(() => {
    fetch()
    const id = setInterval(fetch, POLL_INTERVAL)
    return () => clearInterval(id)
  }, [fetch])

  async function markRead(id) {
    await notifApi.read(id)
    setItems(prev => prev.map(n => n.id === id ? { ...n, read: true } : n))
    setUnreadCount(prev => Math.max(0, prev - 1))
  }

  async function markAllRead() {
    await notifApi.readAll()
    setItems(prev => prev.map(n => ({ ...n, read: true })))
    setUnreadCount(0)
  }

  return { items, unreadCount, loading: false, markRead, markAllRead, refresh: fetch }
}
