import { useEffect, useState } from 'react'
import { apiGet } from '../config/api'
import type { Site } from '../types'

interface SitesResponse {
  sites: Site[]
  total_count: number
}

export function useSites() {
  const [sites, setSites] = useState<Site[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    apiGet<SitesResponse>('/sites')
      .then((data) => {
        if (!cancelled) {
          setSites(data.sites)
          setLoading(false)
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load sites')
          setLoading(false)
        }
      })
    return () => { cancelled = true }
  }, [])

  return { sites, loading, error }
}
