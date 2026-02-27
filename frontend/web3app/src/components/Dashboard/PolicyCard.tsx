import type { PolicyOnChain } from '../../types'
import { HAZARD_ID_TO_STRING } from '../../types'
import { rawToUsdc, formatUsdc, int32ToCoord, formatDate } from '../../utils/format'

interface PolicyCardProps {
  policy: PolicyOnChain
  now: number
}

function getStatus(policy: PolicyOnChain, now: number): { label: string; className: string } {
  if (policy.paid) return { label: 'Paid Out', className: 'status-paid' }
  if (policy.status === 2) return { label: 'Rejected', className: 'status-rejected' }
  if (policy.status === 0) return { label: 'Pending Verification', className: 'status-pending' }
  if (policy.end < now) return { label: 'Expired', className: 'status-expired' }
  return { label: 'Verified', className: 'status-active' }
}

export default function PolicyCard({ policy, now }: PolicyCardProps) {
  const status = getStatus(policy, now)
  const hazardName = HAZARD_ID_TO_STRING[policy.hazard as 0 | 1 | 2] ?? `Hazard ${policy.hazard}`
  const lat = int32ToCoord(policy.lat)
  const lon = int32ToCoord(policy.lon)
  const daysLeft = Math.max(0, Math.ceil((policy.end - now) / 86400))

  return (
    <div className={`policy-card ${status.className}`}>
      <div className="policy-card-header">
        <span className="policy-id">#{policy.id.toString()}</span>
        <span className={`policy-status ${status.className}`}>{status.label}</span>
      </div>

      <div className="policy-card-body">
        <div className="policy-hazard">
          {hazardName.charAt(0).toUpperCase() + hazardName.slice(1)}
        </div>

        <div className="policy-detail">
          <span>Coverage</span>
          <span>${formatUsdc(rawToUsdc(policy.maxCoverage))} USDC</span>
        </div>

        <div className="policy-detail">
          <span>Premium Paid</span>
          <span>${formatUsdc(rawToUsdc(policy.premium))} USDC</span>
        </div>

        <div className="policy-detail">
          <span>Threshold</span>
          <span>{Number(policy.triggerThreshold)}</span>
        </div>

        <div className="policy-detail">
          <span>Location</span>
          <span>Lat {lat.toFixed(4)}°, Lon {lon.toFixed(4)}°</span>
        </div>

        <div className="policy-detail">
          <span>Period</span>
          <span>{formatDate(policy.start)} — {formatDate(policy.end)}</span>
        </div>

        {(status.label === 'Verified' || status.label === 'Pending Verification') && (
          <div className="policy-detail highlight">
            <span>Days Remaining</span>
            <span>{daysLeft}</span>
          </div>
        )}
      </div>
    </div>
  )
}
