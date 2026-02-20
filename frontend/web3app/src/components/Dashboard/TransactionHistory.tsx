import { useState } from 'react'
import type { TxEvent } from '../../hooks/useTransactionHistory'
import { HAZARD_ID_TO_STRING } from '../../types'
import { rawToUsdc, formatUsdc } from '../../utils/format'

interface TransactionHistoryProps {
  events: TxEvent[]
  loading: boolean
  error: string | null
}

const HAZARD_ICONS: Record<string, string> = {
  heatwave: 'fa-solid fa-temperature-high',
  flood: 'fa-solid fa-water',
  drought: 'fa-solid fa-sun-plant-wilt',
}

export default function TransactionHistory({ events, loading, error }: TransactionHistoryProps) {
  const [copiedHash, setCopiedHash] = useState<string | null>(null)

  const copyHash = (hash: string) => {
    void navigator.clipboard.writeText(hash).then(() => {
      setCopiedHash(hash)
      setTimeout(() => setCopiedHash(null), 1500)
    })
  }
  if (loading) {
    return <div className="tx-history-loading">Loading transactions...</div>
  }

  if (error) {
    return <div className="tx-history-error">{error}</div>
  }

  if (events.length === 0) {
    return null
  }

  return (
    <div className="tx-history">
      <h3>Transaction History</h3>
      <div className="tx-table">
        <div className="tx-table-header">
          <span>Type</span>
          <span>Policy</span>
          <span>Details</span>
          <span>Tx</span>
        </div>
        {events.map((ev, i) => {
          const hazardName = ev.hazard !== undefined
            ? HAZARD_ID_TO_STRING[ev.hazard as 0 | 1 | 2] ?? ''
            : ''
          const hazardIcon = HAZARD_ICONS[hazardName]

          return (
            <div key={`${ev.txHash}-${i}`} className={`tx-row tx-${ev.type}`}>
              <span className="tx-type">
                {ev.type === 'purchase' ? (
                  <><i className="fa-solid fa-cart-shopping" /> Purchase</>
                ) : (
                  <><i className="fa-solid fa-money-bill-wave" /> Payout</>
                )}
              </span>
              <span className="tx-policy">
                #{ev.policyId.toString()}
                {hazardIcon && (
                  <> <i className={hazardIcon} title={hazardName} /></>
                )}
              </span>
              <span className="tx-details">
                {ev.type === 'purchase' && ev.maxCoverage !== undefined && (
                  <>Coverage: ${formatUsdc(rawToUsdc(ev.maxCoverage))} USDC</>
                )}
                {ev.type === 'payout' && ev.actualPayout !== undefined && (
                  <>Received: ${formatUsdc(rawToUsdc(ev.actualPayout))} USDC</>
                )}
              </span>
              <span
                className={`tx-hash${copiedHash === ev.txHash ? ' copied' : ''}`}
                onClick={() => copyHash(ev.txHash)}
                title="Click to copy"
              >
                {copiedHash === ev.txHash
                  ? <><i className="fa-solid fa-check" /> Copied</>
                  : <>{ev.txHash.slice(0, 6)}...{ev.txHash.slice(-4)}</>
                }
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}
