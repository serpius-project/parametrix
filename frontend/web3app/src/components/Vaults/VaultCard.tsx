import { useState } from 'react'
import { useVaultData } from '../../hooks/useVaultData'
import { useVaultDeposit } from '../../hooks/useVaultDeposit'
import { useAaveApy } from '../../hooks/useAaveApy'
import { usePolicyFeeYield } from '../../hooks/usePolicyFeeYield'
import { rawToUsdc, formatUsdc, formatCompact } from '../../utils/format'
import { useViemClients } from '../../hooks/useWalletClient'
import Button from '../common/Button'

interface VaultCardProps {
  name: string
  symbol: string
  riskLevel: 'Underwriter' | 'Junior' | 'Senior'
  vaultAddress: `0x${string}`
}

const RISK_INFO = {
  Underwriter: {
    badge: 'Highest Risk / Highest Yield',
    description: 'First-loss tranche. Absorbs losses first. Receives the largest share of premiums.',
    color: '#ef4444',
    tranche: 'underwriter' as const,
  },
  Junior: {
    badge: 'Higher Risk / Higher Yield',
    description: 'Mezzanine tranche. Absorbs losses after the underwriter vault. Receives a larger share of premiums.',
    color: '#f59e0b',
    tranche: 'junior' as const,
  },
  Senior: {
    badge: 'Lower Risk / Lower Yield',
    description: 'Protected tranche. Last to absorb losses. Receives a smaller but steadier share of premiums.',
    color: '#22c55e',
    tranche: 'senior' as const,
  },
}

function formatLockupRemaining(depositTimestamp: bigint, lockupDuration: bigint): string {
  const unlockTime = Number(depositTimestamp) + Number(lockupDuration)
  const now = Math.floor(Date.now() / 1000)
  if (now >= unlockTime) return 'Unlocked'
  const secondsLeft = unlockTime - now
  const daysLeft = Math.ceil(secondsLeft / 86400)
  return `${daysLeft} day${daysLeft === 1 ? '' : 's'} remaining`
}

function formatDuration(seconds: bigint): string {
  const days = Number(seconds) / 86400
  if (days >= 1) return `${Math.round(days)} day${Math.round(days) === 1 ? '' : 's'}`
  const hours = Number(seconds) / 3600
  return `${Math.round(hours)} hour${Math.round(hours) === 1 ? '' : 's'}`
}

export default function VaultCard({ name, symbol, riskLevel, vaultAddress }: VaultCardProps) {
  const { data, loading, error, refresh } = useVaultData(vaultAddress)
  const { deposit, withdraw, step, error: txError, reset } = useVaultDeposit(vaultAddress)
  const { isConnected } = useViemClients()
  const { apy: aaveApy } = useAaveApy()
  const info = RISK_INFO[riskLevel]
  const { yieldPercent: policyYield } = usePolicyFeeYield(info.tranche, data?.totalAssets)

  const [depositAmount, setDepositAmount] = useState('')
  const [withdrawAmount, setWithdrawAmount] = useState('')
  const [activeTab, setActiveTab] = useState<'deposit' | 'withdraw'>('deposit')

  const isZeroAddr = vaultAddress === '0x0000000000000000000000000000000000000000'

  const handleDeposit = async () => {
    const amount = parseFloat(depositAmount)
    if (isNaN(amount) || amount <= 0) return
    await deposit(amount)
    setDepositAmount('')
    void refresh()
  }

  const handleWithdraw = async () => {
    const amount = parseFloat(withdrawAmount)
    if (isNaN(amount) || amount <= 0) return
    await withdraw(amount)
    setWithdrawAmount('')
    void refresh()
  }

  if (isZeroAddr) {
    return (
      <div className="vault-card vault-card-disabled">
        <div className="vault-card-header">
          <h3>{name}</h3>
          <span className="vault-badge" style={{ borderColor: info.color, color: info.color }}>
            {riskLevel}
          </span>
        </div>
        <p className="vault-description">{info.description}</p>
        <p className="vault-not-deployed">Vault not yet deployed. Set address in environment variables.</p>
      </div>
    )
  }

  if (loading) {
    return (
      <div className="vault-card">
        <div className="vault-card-header">
          <h3>{name}</h3>
        </div>
        <p className="vault-loading">Loading vault data...</p>
      </div>
    )
  }

  if (error) {
    return (
      <div className="vault-card">
        <div className="vault-card-header">
          <h3>{name}</h3>
        </div>
        <p className="vault-error">{error}</p>
        <Button variant="secondary" onClick={() => void refresh()}>Retry</Button>
      </div>
    )
  }

  if (!data) return null

  const totalAssetsUsdc = rawToUsdc(data.totalAssets)
  const capUsdc = rawToUsdc(data.cap)
  const utilization = capUsdc > 0 ? (totalAssetsUsdc / capUsdc) * 100 : 0
  const userValueUsdc = rawToUsdc(data.userAssetValue)
  const maxWithdrawUsdc = rawToUsdc(data.maxWithdraw)

  const isBusy = step === 'approving' || step === 'depositing' || step === 'withdrawing'

  // Compute effective Aave APY for this vault (only if Aave is enabled)
  const effectiveAaveApy = data.aaveEnabled && aaveApy != null ? aaveApy : null
  const totalApy = (effectiveAaveApy ?? 0) + (policyYield ?? 0)
  const hasAnyYield = effectiveAaveApy != null || policyYield != null

  // Lockup state
  const isLocked = data.lockupEnabled &&
    data.userDepositTimestamp > 0n &&
    BigInt(Math.floor(Date.now() / 1000)) < data.userDepositTimestamp + data.lockupDuration

  return (
    <div className="vault-card">
      <div className="vault-card-header">
        <div>
          <h3>{name}</h3>
          <span className="vault-symbol">{symbol}</span>
        </div>
        <span className="vault-badge" style={{ borderColor: info.color, color: info.color }}>
          {info.badge}
        </span>
      </div>

      <p className="vault-description">{info.description}</p>

      {/* Yield breakdown */}
      <div className="vault-yield-section">
        <div className="vault-stat">
          <span className="vault-stat-label">Total APY</span>
          <span className="vault-stat-value vault-apy-highlight" style={{ color: info.color }}>
            {hasAnyYield ? `${totalApy.toFixed(2)}%` : '--'}
          </span>
        </div>
        <div className="vault-yield-breakdown">
          {effectiveAaveApy != null && (
            <div className="vault-yield-item">
              <span className="vault-yield-label">Aave Lending</span>
              <span className="vault-yield-value">{effectiveAaveApy.toFixed(2)}%</span>
            </div>
          )}
          {!data.aaveEnabled && (
            <div className="vault-yield-item">
              <span className="vault-yield-label">Aave Lending</span>
              <span className="vault-yield-value vault-yield-disabled">Disabled</span>
            </div>
          )}
          <div className="vault-yield-item">
            <span className="vault-yield-label">Policy Premiums</span>
            <span className="vault-yield-value">{policyYield != null ? `${policyYield.toFixed(2)}%` : '--'}</span>
          </div>
        </div>
      </div>

      <div className="vault-stats">
        <div className="vault-stat">
          <span className="vault-stat-label">Total Deposits</span>
          <span className="vault-stat-value">${formatUsdc(totalAssetsUsdc)}</span>
        </div>
        <div className="vault-stat">
          <span className="vault-stat-label">Cap</span>
          <span className="vault-stat-value">${formatCompact(capUsdc)}</span>
        </div>
        <div className="vault-stat">
          <span className="vault-stat-label">Lockup</span>
          <span className="vault-stat-value">
            {data.lockupEnabled ? formatDuration(data.lockupDuration) : 'None'}
          </span>
        </div>
      </div>

      <div className="vault-utilization">
        <div className="vault-utilization-bar">
          <div
            className="vault-utilization-fill"
            style={{ width: `${Math.min(utilization, 100)}%`, backgroundColor: info.color }}
          />
        </div>
        <span className="vault-utilization-label">{utilization.toFixed(1)}% utilized</span>
      </div>

      {isConnected && data.userShares > 0n && (
        <div className="vault-user-position">
          <span className="vault-stat-label">Your Position</span>
          <span className="vault-stat-value">${formatUsdc(userValueUsdc)} USDC</span>
          {data.lockupEnabled && data.userDepositTimestamp > 0n && (
            <span className={`vault-lockup-status ${isLocked ? 'locked' : 'unlocked'}`}>
              {isLocked
                ? formatLockupRemaining(data.userDepositTimestamp, data.lockupDuration)
                : 'Unlocked'}
            </span>
          )}
        </div>
      )}

      {isConnected && (
        <div className="vault-actions">
          <div className="vault-tabs">
            <button
              className={`vault-tab ${activeTab === 'deposit' ? 'active' : ''}`}
              onClick={() => { setActiveTab('deposit'); reset() }}
            >
              Deposit
            </button>
            <button
              className={`vault-tab ${activeTab === 'withdraw' ? 'active' : ''}`}
              onClick={() => { setActiveTab('withdraw'); reset() }}
            >
              Withdraw
            </button>
          </div>

          {activeTab === 'deposit' ? (
            <div className="vault-form">
              <div className="vault-input-row">
                <div className="number-input-wrapper">
                  <button type="button" className="number-btn" disabled={isBusy} onClick={() => setDepositAmount(String(Math.max(0, (parseFloat(depositAmount) || 0) - 10)))}>
                    <i className="fa-solid fa-minus" />
                  </button>
                  <input
                    type="number"
                    placeholder="Amount (USDC)"
                    value={depositAmount}
                    onChange={(e) => setDepositAmount(e.target.value)}
                    disabled={isBusy}
                    min="0"
                    step="10"
                  />
                  <button type="button" className="number-btn" disabled={isBusy} onClick={() => setDepositAmount(String((parseFloat(depositAmount) || 0) + 10))}>
                    <i className="fa-solid fa-plus" />
                  </button>
                </div>
                <Button
                  onClick={() => void handleDeposit()}
                  loading={step === 'approving' || step === 'depositing'}
                  disabled={isBusy || !depositAmount || parseFloat(depositAmount) <= 0}
                >
                  {step === 'approving' ? 'Approving...' : step === 'depositing' ? 'Depositing...' : 'Deposit'}
                </Button>
              </div>
              {data.lockupEnabled && (
                <p className="vault-lockup-notice">
                  Depositing will lock your funds for {formatDuration(data.lockupDuration)}.
                </p>
              )}
            </div>
          ) : (
            <div className="vault-form">
              {isLocked && data.userShares > 0n ? (
                <p className="vault-lockup-notice">
                  Your funds are locked. Withdrawal available in {formatLockupRemaining(data.userDepositTimestamp, data.lockupDuration)}.
                </p>
              ) : (
                <>
                  <div className="vault-input-row">
                    <div className="number-input-wrapper">
                      <button type="button" className="number-btn" disabled={isBusy} onClick={() => setWithdrawAmount(String(Math.max(0, (parseFloat(withdrawAmount) || 0) - 10)))}>
                        <i className="fa-solid fa-minus" />
                      </button>
                      <input
                        type="number"
                        placeholder={`Max: ${formatUsdc(maxWithdrawUsdc)} USDC`}
                        value={withdrawAmount}
                        onChange={(e) => setWithdrawAmount(e.target.value)}
                        disabled={isBusy}
                        min="0"
                        step="10"
                      />
                      <button type="button" className="number-btn" disabled={isBusy} onClick={() => setWithdrawAmount(String(Math.min(maxWithdrawUsdc, (parseFloat(withdrawAmount) || 0) + 10)))}>
                        <i className="fa-solid fa-plus" />
                      </button>
                    </div>
                    <Button
                      onClick={() => void handleWithdraw()}
                      loading={step === 'withdrawing'}
                      disabled={isBusy || !withdrawAmount || parseFloat(withdrawAmount) <= 0}
                    >
                      {step === 'withdrawing' ? 'Withdrawing...' : 'Withdraw'}
                    </Button>
                  </div>
                  {maxWithdrawUsdc > 0 && (
                    <button
                      className="vault-max-btn"
                      onClick={() => setWithdrawAmount(maxWithdrawUsdc.toFixed(2))}
                      disabled={isBusy}
                    >
                      Max
                    </button>
                  )}
                </>
              )}
            </div>
          )}

          {step === 'success' && (
            <p className="vault-success">Transaction successful!</p>
          )}
          {txError && (
            <p className="vault-tx-error">{txError}</p>
          )}
        </div>
      )}

      {!isConnected && (
        <p className="vault-connect-prompt">Connect wallet to deposit or withdraw</p>
      )}
    </div>
  )
}
