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
  direction: 'high_is_bad' | 'low_is_bad'
}

export interface TierDef {
  key: string
  quantile: number // position within [p_min, p_max], e.g. 0.20, 0.50, 0.80
}

const SEARCH_BOUNDS: Record<string, [number, number]> = {
  heatwave: [5, 45],
  flood: [10, 5000],
  drought: [0.1, 20],
}

async function probeProb(params: SearchParams, threshold: number): Promise<PremiumResponse> {
  return apiPost<PremiumResponse>('/premium', {
    lat: params.lat,
    lon: params.lon,
    hazard: params.hazard,
    threshold,
    n_months: params.n_months,
    payout: params.payout,
    loading_factor: params.loading_factor,
  })
}

export function useTierSearch(params: SearchParams) {
  const [tiers, setTiers] = useState<Record<string, TierResult | null>>({})
  const [loading, setLoading] = useState<Record<string, boolean>>({})
  const [range, setRange] = useState<{ pMin: number; pMax: number } | null>(null)
  const cacheRef = useRef<Record<string, { key: string; result: TierResult }>>({})
  const rangeRef = useRef<{ key: string; pMin: number; pMax: number } | null>(null)

  const searchAll = useCallback(
    async (tierDefs: TierDef[]) => {
      const { hazard, n_months, payout, direction } = params
      const paramsKey = `${params.lat},${params.lon},${hazard},${n_months},${payout},${direction}`

      // Mark all as loading
      setLoading((prev) => {
        const next = { ...prev }
        for (const t of tierDefs) next[t.key] = true
        return next
      })

      try {
        // Step 1: Probe range endpoints if not cached
        let pMin: number
        let pMax: number

        if (rangeRef.current && rangeRef.current.key === paramsKey) {
          pMin = rangeRef.current.pMin
          pMax = rangeRef.current.pMax
        } else {
          const bounds = SEARCH_BOUNDS[hazard] ?? [0, 100]

          const resLo = await probeProb(params, bounds[0])
          const resHi = await probeProb(params, bounds[1])

          console.log(`[TierSearch] Range probe for ${hazard}: threshold=${bounds[0]} → p=${resLo.exceedance_prob}, threshold=${bounds[1]} → p=${resHi.exceedance_prob}`)

          // Ensure pMin < pMax regardless of direction
          const pA = resLo.exceedance_prob
          const pB = resHi.exceedance_prob
          pMin = Math.min(pA, pB)
          pMax = Math.max(pA, pB)

          if (pMax - pMin < 0.001) {
            console.warn(`[TierSearch] Range too narrow for ${hazard}: pMin=${pMin}, pMax=${pMax}`)
          }

          rangeRef.current = { key: paramsKey, pMin, pMax }
          setRange({ pMin, pMax })
        }

        // Step 2: For each tier, compute target and binary search (sequentially to avoid API overload)
        for (const tierDef of tierDefs) {
          const targetProb = pMin + tierDef.quantile * (pMax - pMin)
          const cacheKey = `${paramsKey},${tierDef.quantile}`

          console.log(`[TierSearch] ${tierDef.key}: target p=${targetProb.toFixed(4)} (quantile=${tierDef.quantile}, range=[${pMin.toFixed(4)}, ${pMax.toFixed(4)}])`)

          // Check cache
          const cached = cacheRef.current[tierDef.key]
          if (cached && cached.key === cacheKey) {
            setTiers((prev) => ({ ...prev, [tierDef.key]: cached.result }))
            setLoading((prev) => ({ ...prev, [tierDef.key]: false }))
            continue
          }

          try {
            const bounds = SEARCH_BOUNDS[hazard] ?? [0, 100]
            let lo = bounds[0]
            let hi = bounds[1]
            let bestResult: TierResult | null = null

            // Use more decimal places for narrower ranges
            const rangeWidth = hi - lo
            const decimals = rangeWidth > 500 ? 0 : rangeWidth > 50 ? 1 : 2

            for (let i = 0; i < 15; i++) {
              const factor = Math.pow(10, decimals)
              const mid = Math.round(((lo + hi) / 2) * factor) / factor

              const res = await probeProb(params, mid)

              bestResult = {
                threshold: mid,
                exceedanceProb: res.exceedance_prob,
                premiumUsdc: res.premium_usdc,
              }

              // Use tight tolerance to distinguish close targets
              const tol = Math.max(targetProb * 0.02, 0.0002)
              if (Math.abs(res.exceedance_prob - targetProb) <= tol) break

              // Determine search direction from actual probed data:
              // We need to know if increasing threshold increases or decreases prob.
              // For high_is_bad: higher threshold → lower prob → if prob too high, increase threshold
              // For low_is_bad:  higher threshold → higher prob → if prob too high, decrease threshold
              if (direction === 'high_is_bad') {
                if (res.exceedance_prob > targetProb) {
                  lo = mid
                } else {
                  hi = mid
                }
              } else {
                if (res.exceedance_prob > targetProb) {
                  hi = mid
                } else {
                  lo = mid
                }
              }
            }

            if (bestResult) {
              console.log(`[TierSearch] ${tierDef.key}: converged → threshold=${bestResult.threshold}, p=${bestResult.exceedanceProb.toFixed(4)}`)
              cacheRef.current[tierDef.key] = { key: cacheKey, result: bestResult }
              setTiers((prev) => ({ ...prev, [tierDef.key]: bestResult }))
            }
          } catch (err) {
            console.error(`[TierSearch] Binary search failed for ${tierDef.key}:`, err)
          } finally {
            setLoading((prev) => ({ ...prev, [tierDef.key]: false }))
          }
        }
      } catch (err) {
        console.error('[TierSearch] Range probe failed:', err)
        setLoading((prev) => {
          const next = { ...prev }
          for (const t of tierDefs) next[t.key] = false
          return next
        })
      }
    },
    [params],
  )

  return { tiers, loading, range, searchAll }
}
