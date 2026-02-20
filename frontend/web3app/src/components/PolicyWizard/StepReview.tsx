import { useDynamicContext } from '@dynamic-labs/sdk-react-core'
import type { WizardState } from '../../types'
import { HAZARD_STRING_TO_ID } from '../../types'
import { useBuyPolicy } from '../../hooks/usePolicyContract'
import { formatUsdc, formatUnit } from '../../utils/format'
import Button from '../common/Button'

interface StepReviewProps {
  wizard: WizardState
  onBack: () => void
  onComplete: () => void
}

export default function StepReview({ wizard, onBack, onComplete }: StepReviewProps) {
  const { primaryWallet, setShowAuthFlow } = useDynamicContext()
  const { buy, step, policyId, error, txHash } = useBuyPolicy()

  const premium = wizard.premiumResponse!
  const isConnected = !!primaryWallet

  const handleBuy = () => {
    if (!isConnected) {
      setShowAuthFlow(true)
      return
    }

    const hazardId = HAZARD_STRING_TO_ID[wizard.hazard!]
    if (hazardId === undefined) return

    void buy({
      hazardId,
      durationMonths: wizard.durationMonths,
      coverageUsdc: wizard.coverageUsdc,
      premiumUsdc: premium.premium_usdc,
      triggerThreshold: wizard.threshold!,
      lat: wizard.clickLat!,
      lon: wizard.clickLon!,
    })
  }

  if (step === 'success') {
    return (
      <div className="wizard-step">
        <div className="success-card">
          <h3>Policy Purchased!</h3>
          <p>Policy ID: {policyId?.toString()}</p>
          {txHash && <p className="tx-hash">Tx: {txHash.slice(0, 10)}...{txHash.slice(-8)}</p>}
          <Button onClick={onComplete}>Go to Dashboard</Button>
        </div>
      </div>
    )
  }

  return (
    <div className="wizard-step">
      <h3>Review & Buy</h3>

      <div className="review-summary">
        <div className="review-row">
          <span>Location</span>
          <span>{wizard.placeName ?? 'Selected point'}</span>
        </div>
        <div className="review-row">
          <span>Coordinates</span>
          <span>Lat {wizard.clickLat?.toFixed(4)}°, Lon {wizard.clickLon?.toFixed(4)}°</span>
        </div>
        <div className="review-row">
          <span>Hazard</span>
          <span>{wizard.hazard?.charAt(0).toUpperCase()}{wizard.hazard?.slice(1)}</span>
        </div>
        <div className="review-row">
          <span>Threshold</span>
          <span>{wizard.threshold} {formatUnit(premium.unit)}</span>
        </div>
        <div className="review-row">
          <span>Coverage</span>
          <span>${formatUsdc(wizard.coverageUsdc)} USDC</span>
        </div>
        <div className="review-row">
          <span>Duration</span>
          <span>{wizard.durationMonths} months ({wizard.durationMonths * 30} days)</span>
        </div>
        <div className="review-row highlight">
          <span>Premium</span>
          <span>${formatUsdc(premium.premium_usdc)} USDC</span>
        </div>
      </div>

      {error && <p className="error-message">{error}</p>}

      {step === 'approving' && <p className="tx-status">Approving USDC spend...</p>}
      {step === 'buying' && <p className="tx-status">Buying policy...</p>}

      <div className="wizard-actions">
        <Button variant="secondary" onClick={onBack} disabled={step === 'approving' || step === 'buying'}>
          Back
        </Button>
        {!isConnected ? (
          <Button onClick={() => setShowAuthFlow(true)}>Connect Wallet</Button>
        ) : (
          <Button
            onClick={handleBuy}
            loading={step === 'approving' || step === 'buying'}
          >
            {step === 'error' ? 'Retry' : `Pay $${formatUsdc(premium.premium_usdc)} USDC`}
          </Button>
        )}
      </div>
    </div>
  )
}
