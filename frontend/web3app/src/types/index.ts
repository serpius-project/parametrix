// ── API Types ────────────────────────────────────────────────────────────────

export interface Site {
  site_id: string
  name: string
  city: string
  lat: number
  lon: number
  available_hazards: string[]
}

export interface HazardConfig {
  family: string
  param_names: string[]
  direction: 'high_is_bad' | 'low_is_bad'
  unit: string
  description: string
}

export interface PremiumRequest {
  lat: number
  lon: number
  hazard: string
  threshold: number
  n_months: number
  payout: number
  loading_factor: number
}

export interface PremiumResponse {
  site_name: string
  city: string
  site_lat: number
  site_lon: number
  distance_km: number
  hazard: string
  threshold: number
  unit: string
  exceedance_prob: number
  expected_loss_monthly: number
  n_months: number
  pure_premium: number
  premium_usdc: number
  payout: number
  loading_factor: number
}

// ── On-chain Types ───────────────────────────────────────────────────────────

export interface PolicyOnChain {
  id: bigint
  hazard: number
  start: number
  end: number
  lat: number
  lon: number
  maxCoverage: bigint
  premium: bigint
  triggerThreshold: bigint
  paid: boolean
  holder: `0x${string}`
}

// ── Hazard Mapping ───────────────────────────────────────────────────────────

export type HazardId = 0 | 1 | 2

export const HAZARD_STRING_TO_ID: Record<string, HazardId> = {
  heatwave: 0,
  flood: 1,
  drought: 2,
}

export const HAZARD_ID_TO_STRING: Record<HazardId, string> = {
  0: 'heatwave',
  1: 'flood',
  2: 'drought',
}

// Only these hazards exist on-chain
export const ON_CHAIN_HAZARDS = new Set(['heatwave', 'flood', 'drought'])

// ── Wizard State ─────────────────────────────────────────────────────────────

export interface WizardState {
  site: Site | null
  clickLat: number | null
  clickLon: number | null
  hazard: string | null
  threshold: number | null
  coverageUsdc: number
  durationMonths: number
  premiumResponse: PremiumResponse | null
}
