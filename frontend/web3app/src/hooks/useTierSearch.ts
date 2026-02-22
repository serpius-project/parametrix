import { useCallback, useRef, useState } from 'react'
import { apiPost } from '../config/api'
import type { PremiumResponse } from '../types'

export interface TierResult {
  threshold: number
  exceedanceProb: number
  premiumUsdc: number
}

interface SearchParams {
  lat: number
  lon: number
  hazard: string
  n_months: number
  payout: number
  loading_factor: number
}

export interface TierDef {
  key: string
  exceedanceProb: number // target monthly exceedance probability, e.g. 0.0083
}

interface ThresholdResponse {
  threshold: number
  exceedance_prob: number
  site_name: string
  city: string
  hazard: string
  unit: string
}

export function useTierSearch(params: SearchParams) {
  const [tiers, setTiers] = useState<Record<string, TierResult | null>>({})
  const [loading, setLoading] = useState<Record<string, boolean>>({})
  const cacheRef = useRef<Record<string, { key: string; result: TierResult }>>({})

  const searchAll = useCallback(
    async (tierDefs: TierDef[]) => {
      const { hazard, n_months, payout, loading_factor } = params
      const paramsKey = `${params.lat},${params.lon},${hazard},${n_months},${payout}`

      // Mark all as loading
      setLoading((prev) => {
        const next = { ...prev }
        for (const t of tierDefs) next[t.key] = true
        return next
      })

      for (const tierDef of tierDefs) {
        const cacheKey = `${paramsKey},${tierDef.exceedanceProb}`

        // Check cache
        const cached = cacheRef.current[tierDef.key]
        if (cached && cached.key === cacheKey) {
          setTiers((prev) => ({ ...prev, [tierDef.key]: cached.result }))
          setLoading((prev) => ({ ...prev, [tierDef.key]: false }))
          continue
        }

        try {
          // Step 1: Get threshold from exceedance probability
          const thresholdRes = await apiPost<ThresholdResponse>('/threshold', {
            lat: params.lat,
            lon: params.lon,
            hazard,
            exceedance_prob: tierDef.exceedanceProb,
          })

          // Step 2: Get premium for that threshold
          const premiumRes = await apiPost<PremiumResponse>('/premium', {
            lat: params.lat,
            lon: params.lon,
            hazard,
            threshold: thresholdRes.threshold,
            n_months,
            payout,
            loading_factor,
          })

          const result: TierResult = {
            threshold: Math.round(thresholdRes.threshold * 100) / 100,
            exceedanceProb: premiumRes.exceedance_prob,
            premiumUsdc: premiumRes.premium_usdc,
          }

          cacheRef.current[tierDef.key] = { key: cacheKey, result }
          setTiers((prev) => ({ ...prev, [tierDef.key]: result }))
        } catch (err) {
          console.error(`[TierSearch] Failed for ${tierDef.key}:`, err)
        } finally {
          setLoading((prev) => ({ ...prev, [tierDef.key]: false }))
        }
      }
    },
    [params],
  )

  return { tiers, loading, searchAll }
}
