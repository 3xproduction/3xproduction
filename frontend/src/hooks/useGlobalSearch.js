import { useState, useEffect, useRef, useCallback } from 'react'
import { search as searchApi } from '../services/api'

const RECENT_KEY = 'global_search_recent'
const MAX_RECENT = 10
const DEBOUNCE_MS = 400

export function useGlobalSearch() {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [results, setResults] = useState(null)
  const [loading, setLoading] = useState(false)
  const [category, setCategory] = useState(null) // null = all
  const abortRef = useRef(null)
  const cacheRef = useRef({}) // query+cat → results

  // Ctrl+K / Cmd+K shortcut
  useEffect(() => {
    const handler = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault()
        setOpen(o => !o)
      }
      if (e.key === 'Escape' && open) {
        setOpen(false)
      }
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [open])

  // Внешний триггер: window.dispatchEvent(new Event('open-global-search'))
  // — позволяет любой странице открыть модалку, не прокидывая props.
  useEffect(() => {
    const handler = () => setOpen(true)
    window.addEventListener('open-global-search', handler)
    return () => window.removeEventListener('open-global-search', handler)
  }, [])

  // Debounced search
  useEffect(() => {
    if (!query.trim()) {
      setResults(null)
      setLoading(false)
      return
    }

    const cacheKey = `${query.trim()}|${category || 'all'}`
    if (cacheRef.current[cacheKey]) {
      setResults(cacheRef.current[cacheKey])
      return
    }

    setLoading(true)

    const timer = setTimeout(async () => {
      // Abort previous request
      if (abortRef.current) abortRef.current.abort()
      const controller = new AbortController()
      abortRef.current = controller

      try {
        const params = {}
        if (category) params.category = category
        const data = await searchApi.query(query.trim(), params)
        if (!controller.signal.aborted) {
          setResults(data)
          // Cache the result
          cacheRef.current[cacheKey] = data
          // Keep cache small
          const keys = Object.keys(cacheRef.current)
          if (keys.length > 20) delete cacheRef.current[keys[0]]
        }
      } catch (err) {
        if (err.name !== 'AbortError' && !controller.signal.aborted) {
          setResults(null)
        }
      } finally {
        if (!controller.signal.aborted) setLoading(false)
      }
    }, DEBOUNCE_MS)

    return () => {
      clearTimeout(timer)
      if (abortRef.current) abortRef.current.abort()
    }
  }, [query, category])

  // Recent searches from localStorage
  const getRecent = useCallback(() => {
    try {
      return JSON.parse(localStorage.getItem(RECENT_KEY) || '[]')
    } catch { return [] }
  }, [])

  const addRecent = useCallback((q) => {
    const trimmed = q.trim()
    if (!trimmed) return
    const list = getRecent().filter(r => r !== trimmed)
    list.unshift(trimmed)
    localStorage.setItem(RECENT_KEY, JSON.stringify(list.slice(0, MAX_RECENT)))
  }, [getRecent])

  // Reset state on close
  const close = useCallback(() => {
    if (query.trim()) addRecent(query.trim())
    setOpen(false)
    setQuery('')
    setResults(null)
    setCategory(null)
  }, [query, addRecent])

  return {
    open, setOpen, close,
    query, setQuery,
    results, loading,
    category, setCategory,
    getRecent,
  }
}
