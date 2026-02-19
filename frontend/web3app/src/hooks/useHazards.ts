import { useEffect, useState } from 'react'
import { apiGet } from '../config/api'
import type { HazardConfig } from '../types'

interface HazardsResponse {
  hazards: Record<string, HazardConfig>
  available_types: string[]
}

export function useHazards() {
  const [hazards, setHazards] = useState<Record<string, HazardConfig>>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    apiGet<HazardsResponse>('/hazards')
      .then((data) => {
        if (!cancelled) {
          setHazards(data.hazards)
          setLoading(false)
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load hazards')
          setLoading(false)
        }
      })
    return () => { cancelled = true }
  }, [])

  return { hazards, loading, error }
}
