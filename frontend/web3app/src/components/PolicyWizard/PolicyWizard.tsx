import { useState, useCallback } from 'react'
import type { Site, WizardState } from '../../types'
import { ON_CHAIN_HAZARDS } from '../../types'
import StepSelectHazard from './StepSelectHazard'
import StepConfigure from './StepConfigure'
import StepReview from './StepReview'

interface PolicyWizardProps {
  selectedSite: Site | null
  clickLat: number | null
  clickLon: number | null
  distanceKm: number | null
  onComplete: () => void
}

export default function PolicyWizard({
  selectedSite,
  clickLat,
  clickLon,
  distanceKm,
  onComplete,
}: PolicyWizardProps) {
  const [step, setStep] = useState(0)
  const [wizard, setWizard] = useState<WizardState>({
    site: null,
    clickLat: null,
    clickLon: null,
    hazard: null,
    threshold: null,
    coverageUsdc: 10000,
    durationMonths: 6,
    premiumResponse: null,
  })

  const resetWizard = useCallback(() => {
    setStep(0)
    setWizard((prev) => ({
      ...prev,
      hazard: null,
      threshold: null,
      premiumResponse: null,
    }))
  }, [])

  if (!selectedSite) {
    return (
      <div className="wizard-panel">
        <div className="wizard-empty">
          <h2>Select a Location</h2>
          <p>Click anywhere on the map to find the nearest data center and start configuring your insurance policy.</p>
        </div>
      </div>
    )
  }

  const availableHazards = selectedSite.available_hazards.filter((h) => ON_CHAIN_HAZARDS.has(h))

  return (
    <div className="wizard-panel">
      <div className="wizard-site-info">
        <h3>{selectedSite.name}</h3>
        <p className="site-city">{selectedSite.city}</p>
        {distanceKm !== null && (
          <p className="site-distance">{distanceKm.toFixed(1)} km from selected point</p>
        )}
      </div>

      <div className="wizard-steps">
        <div className={`wizard-step-indicator ${step >= 0 ? 'active' : ''}`}>1. Hazard</div>
        <div className={`wizard-step-indicator ${step >= 1 ? 'active' : ''}`}>2. Configure</div>
        <div className={`wizard-step-indicator ${step >= 2 ? 'active' : ''}`}>3. Review</div>
      </div>

      {step === 0 && (
        <StepSelectHazard
          hazards={availableHazards}
          onSelect={(hazard) => {
            setWizard((prev) => ({ ...prev, hazard, site: selectedSite, clickLat, clickLon }))
            setStep(1)
          }}
        />
      )}

      {step === 1 && wizard.hazard && (
        <StepConfigure
          site={selectedSite}
          hazard={wizard.hazard}
          wizard={wizard}
          onChange={(updates) => setWizard((prev) => ({ ...prev, ...updates }))}
          onBack={() => setStep(0)}
          onNext={(premiumResponse) => {
            setWizard((prev) => ({ ...prev, premiumResponse }))
            setStep(2)
          }}
        />
      )}

      {step === 2 && wizard.premiumResponse && (
        <StepReview
          wizard={wizard}
          onBack={() => setStep(1)}
          onComplete={() => {
            resetWizard()
            onComplete()
          }}
        />
      )}
    </div>
  )
}
