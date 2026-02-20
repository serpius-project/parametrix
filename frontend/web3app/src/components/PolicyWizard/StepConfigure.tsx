import { useEffect } from 'react'
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

const DURATION_OPTIONS = [
  { value: 1, label: '1 month' },
  { value: 3, label: '3 months' },
  { value: 6, label: '6 months' },
  { value: 12, label: '12 months' },
]

const DEFAULT_THRESHOLDS: Record<string, number> = {
  heatwave: 35,
  flood: 500,
  drought: -50,
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
          Duration
          <select
            value={wizard.durationMonths}
            onChange={(e) => onChange({ durationMonths: parseInt(e.target.value, 10) })}
          >
            {DURATION_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </label>
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
