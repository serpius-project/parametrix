import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Site, WizardState, PremiumResponse } from '../../types'
import { useHazards } from '../../hooks/useHazards'
import { usePremium } from '../../hooks/usePremium'
import { useTierSearch, type TierDef } from '../../hooks/useTierSearch'
import { formatUsdc, formatUnit } from '../../utils/format'
import Button from '../common/Button'

interface StepConfigureProps {
  site: Site
  hazard: string
  wizard: WizardState
  onChange: (updates: Partial<WizardState>) => void
  onBack: () => void
  onNext: (premium: PremiumResponse) => void
}


const DEFAULT_THRESHOLDS: Record<string, number> = {
  heatwave: 35,
  flood: 500,
  drought: 2,
}

const TIERS = [
  { key: 'budget', name: 'Budget', subtitle: 'Catastrophic', exceedanceProb: 0.05 / 6, icon: 'fa-solid fa-shield', recommended: true },
  { key: 'balanced', name: 'Balanced', subtitle: 'Moderate', exceedanceProb: 0.40 / 6, icon: 'fa-solid fa-shield-halved', recommended: false },
  { key: 'protection', name: 'Protection+', subtitle: 'Sensitive', exceedanceProb: 0.85 / 6, icon: 'fa-solid fa-shield-heart', recommended: false },
] as const

const TIER_DEFS: TierDef[] = TIERS.map((t) => ({ key: t.key, exceedanceProb: t.exceedanceProb }))

function DurationSlider({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  const trackRef = useRef<HTMLDivElement>(null)
  const min = 1
  const max = 12
  const pct = ((value - min) / (max - min)) * 100

  const resolve = useCallback(
    (clientX: number) => {
      const track = trackRef.current
      if (!track) return
      const rect = track.getBoundingClientRect()
      const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width))
      const snapped = Math.round(min + ratio * (max - min))
      onChange(snapped)
    },
    [onChange],
  )

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      e.preventDefault()
      const el = e.currentTarget as HTMLElement
      el.setPointerCapture(e.pointerId)
      resolve(e.clientX)

      const onMove = (ev: PointerEvent) => resolve(ev.clientX)
      const onUp = () => {
        el.removeEventListener('pointermove', onMove)
        el.removeEventListener('pointerup', onUp)
      }
      el.addEventListener('pointermove', onMove)
      el.addEventListener('pointerup', onUp)
    },
    [resolve],
  )

  return (
    <div className="duration-slider-wrapper" onPointerDown={onPointerDown}>
      <div className="duration-slider-track" ref={trackRef}>
        <div className="duration-slider-thumb" style={{ left: `${pct}%` }} />
      </div>
      <div className="duration-slider-labels">
        {[1, 3, 6, 9, 12].map((v) => (
          <span key={v} style={{ left: `${((v - min) / (max - min)) * 100}%` }}>
            {v}
          </span>
        ))}
      </div>
    </div>
  )
}

export default function StepConfigure({
  site,
  hazard,
  wizard,
  onChange,
  onBack,
  onNext,
}: StepConfigureProps) {
  const { hazards: hazardConfigs } = useHazards()
  const { premium, loading, error, calculate } = usePremium()
  const config = hazardConfigs[hazard]
  const unit = formatUnit(config?.unit ?? '')

  // Recalculate premium when params change (use clicked coordinates)
  const lat = wizard.clickLat ?? site.lat
  const lon = wizard.clickLon ?? site.lon

  // Tier search
  const tierParams = useMemo(
    () => ({
      lat,
      lon,
      hazard,
      n_months: wizard.durationMonths,
      payout: wizard.coverageUsdc,
      loading_factor: 0.2,
    }),
    [lat, lon, hazard, wizard.durationMonths, wizard.coverageUsdc],
  )

  const { tiers, loading: tierLoading, searchAll } = useTierSearch(tierParams)

  // Auto-search all tiers on mount / when params change
  useEffect(() => {
    if (!config) return
    void searchAll(TIER_DEFS)
  }, [tierParams, config, searchAll])

  // Set threshold from recommended tier on first load, fallback to default
  const appliedDefaultRef = useRef<string | null>(null)
  const recommendedTier = TIERS.find((t) => t.recommended)!
  const recommendedResult = tiers[recommendedTier.key]

  useEffect(() => {
    if (appliedDefaultRef.current === hazard) return
    if (recommendedResult) {
      onChange({ threshold: Math.round(recommendedResult.threshold) })
      appliedDefaultRef.current = hazard
    } else if (wizard.threshold === null) {
      // Temporary default while tier search is in progress
      onChange({ threshold: DEFAULT_THRESHOLDS[hazard] ?? 35 })
    }
  }, [hazard, recommendedResult]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (wizard.threshold === null) return
    calculate({
      lat,
      lon,
      hazard,
      threshold: wizard.threshold,
      n_months: wizard.durationMonths,
      payout: wizard.coverageUsdc,
      loading_factor: 0.2,
    })
  }, [lat, lon, hazard, wizard.threshold, wizard.durationMonths, wizard.coverageUsdc, calculate])

  // Cumulative probability for the selected period
  const pMonth = premium?.exceedance_prob ?? null
  const nMonths = wizard.durationMonths
  const pCumulative = pMonth !== null ? 1 - Math.pow(1 - pMonth, nMonths) : null

  // Scroll fade indicator
  const [scrolledBottom, setScrolledBottom] = useState(false)
  const onBodyScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    const el = e.currentTarget
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 8
    setScrolledBottom(atBottom)
  }, [])

  return (
    <div className="wizard-step wizard-step--scrollable">
      <h3>Configure Policy</h3>

      <div className={`wizard-step-body-wrapper${scrolledBottom ? ' scrolled-bottom' : ''}`}>
      <div className="wizard-step-body" onScroll={onBodyScroll}>
      {/* Tier presets */}
      <div className="form-group">
        <div className="tier-presets">
          {TIERS.map((tier) => {
            const result = tiers[tier.key]
            const isLoading = tierLoading[tier.key]
            const isActive = result && wizard.threshold !== null && wizard.threshold === Math.round(result.threshold)
            return (
              <button
                key={tier.key}
                type="button"
                className={`tier-card${isActive ? ' active' : ''}${isLoading ? ' loading' : ''}${tier.recommended ? ' recommended' : ''}`}
                disabled={isLoading}
                onClick={() => {
                  if (result) {
                    onChange({ threshold: Math.round(result.threshold) })
                  }
                }}
              >
                <div className="tier-icon"><i className={tier.icon} /></div>
                <div className="tier-name">{tier.name}</div>
                <div className="tier-subtitle">{tier.subtitle}</div>
                {isLoading && <div className="tier-spinner"><i className="fa-solid fa-spinner fa-spin" /></div>}
                {result && !isLoading && (
                  <div className="tier-result">
                    <span>${formatUsdc(result.premiumUsdc)}</span>
                  </div>
                )}
              </button>
            )
          })}
        </div>
      </div>

      <div className="form-row">
        <div className="form-group">
          <label>
            Trigger ({unit})
            <div className="number-input-wrapper">
              <button type="button" className="number-btn" onClick={() => onChange({ threshold: (wizard.threshold ?? 0) - 1 })}>
                <i className="fa-solid fa-minus" />
              </button>
              <input
                type="number"
                step="1"
                value={wizard.threshold ?? ''}
                onChange={(e) => onChange({ threshold: Math.round(parseFloat(e.target.value) || 0) })}
              />
              <button type="button" className="number-btn" onClick={() => onChange({ threshold: (wizard.threshold ?? 0) + 1 })}>
                <i className="fa-solid fa-plus" />
              </button>
            </div>
          </label>
        </div>

        <div className="form-group">
          <label>
            Coverage (USDC)
            <div className="number-input-wrapper">
              <button type="button" className="number-btn" onClick={() => onChange({ coverageUsdc: Math.max(100, wizard.coverageUsdc - 100) })}>
                <i className="fa-solid fa-minus" />
              </button>
              <input
                type="number"
                value={wizard.coverageUsdc}
                min={100}
                step={100}
                onChange={(e) => onChange({ coverageUsdc: parseFloat(e.target.value) || 0 })}
              />
              <button type="button" className="number-btn" onClick={() => onChange({ coverageUsdc: wizard.coverageUsdc + 100 })}>
                <i className="fa-solid fa-plus" />
              </button>
            </div>
          </label>
        </div>
      </div>
      {config && (
        <p className="form-hint" style={{ marginBottom: '16px' }}>
          {config.direction === 'high_is_bad'
            ? `Payout triggers when value exceeds the threshold`
            : `Payout triggers when value drops below the threshold`}
        </p>
      )}

      <div className="form-group">
        <label>
          Duration: {wizard.durationMonths} {wizard.durationMonths === 1 ? 'month' : 'months'}
        </label>
        <DurationSlider value={wizard.durationMonths} onChange={(v) => onChange({ durationMonths: v })} />
      </div>

      {/* Premium result */}
      <div className="premium-result">
        {loading && <p className="premium-loading">Calculating premium...</p>}
        {error && <p className="premium-error">{error}</p>}
        {premium && !loading && (
          <div className="premium-card">
            <div className="premium-amount">
              <span className="label">Premium</span>
              <span className="value">${formatUsdc(premium.premium_usdc)} USDC</span>
            </div>
            <div className="premium-details">
              <p>Exceedance probability: {(premium.exceedance_prob * 100).toFixed(2)}%/month</p>
              {pCumulative !== null && (
                <p className="premium-cumulative">
                  Estimated payout probability: {(pCumulative * 100).toFixed(1)}%
                </p>
              )}
            </div>
            {premium.premium_usdc < 10 && (
              <p className="premium-error">Minimum premium is 10 USDC. Increase coverage or duration.</p>
            )}
          </div>
        )}
      </div>
      </div>
      </div>

      <div className="wizard-actions">
        <Button variant="secondary" onClick={onBack}>
          Back
        </Button>
        <Button
          disabled={!premium || loading || (premium && premium.premium_usdc < 10)}
          onClick={() => {
            if (premium) onNext(premium)
          }}
        >
          Continue
        </Button>
      </div>
    </div>
  )
}
