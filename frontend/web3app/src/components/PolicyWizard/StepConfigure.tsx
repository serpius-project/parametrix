import { useCallback, useEffect, useRef } from 'react'
import type { Site, WizardState, PremiumResponse } from '../../types'
import { useHazards } from '../../hooks/useHazards'
import { usePremium } from '../../hooks/usePremium'
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

  // Set default threshold on mount
  useEffect(() => {
    if (wizard.threshold === null) {
      onChange({ threshold: DEFAULT_THRESHOLDS[hazard] ?? 35 })
    }
  }, [hazard]) // eslint-disable-line react-hooks/exhaustive-deps

  // Recalculate premium when params change (use clicked coordinates)
  const lat = wizard.clickLat ?? site.lat
  const lon = wizard.clickLon ?? site.lon

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

  return (
    <div className="wizard-step">
      <h3>Configure Policy</h3>

      <div className="form-group">
        <label>
          Trigger Threshold ({unit})
          <div className="number-input-wrapper">
            <button type="button" className="number-btn" onClick={() => onChange({ threshold: (wizard.threshold ?? 0) - 1 })}>
              <i className="fa-solid fa-minus" />
            </button>
            <input
              type="number"
              value={wizard.threshold ?? ''}
              onChange={(e) => onChange({ threshold: parseFloat(e.target.value) || 0 })}
            />
            <button type="button" className="number-btn" onClick={() => onChange({ threshold: (wizard.threshold ?? 0) + 1 })}>
              <i className="fa-solid fa-plus" />
            </button>
          </div>
        </label>
        {config && (
          <p className="form-hint">
            {config.direction === 'high_is_bad'
              ? `Payout triggers when value exceeds this threshold`
              : `Payout triggers when value drops below this threshold`}
          </p>
        )}
      </div>

      <div className="form-group">
        <label>
          Max Coverage (USDC)
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
            </div>
          </div>
        )}
      </div>

      <div className="wizard-actions">
        <Button variant="secondary" onClick={onBack}>
          Back
        </Button>
        <Button
          disabled={!premium || loading}
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
