import { useCallback, useRef, useState } from 'react'
import { apiPost } from '../config/api'
import type { PremiumRequest, PremiumResponse } from '../types'

export function usePremium() {
  const [premium, setPremium] = useState<PremiumResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const calculate = useCallback((req: PremiumRequest) => {
    // Debounce 500ms
    if (timerRef.current) clearTimeout(timerRef.current)

    timerRef.current = setTimeout(() => {
      setLoading(true)
      setError(null)
      apiPost<PremiumResponse>('/premium', req)
        .then((data) => {
          setPremium(data)
          setLoading(false)
        })
        .catch((err: unknown) => {
          setError(err instanceof Error ? err.message : 'Premium calculation failed')
          setPremium(null)
          setLoading(false)
        })
    }, 500)
  }, [])

  const reset = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current)
    setPremium(null)
    setError(null)
    setLoading(false)
  }, [])

  return { premium, loading, error, calculate, reset }
}
