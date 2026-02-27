import { useProtocolHealth } from '../../hooks/useProtocolHealth'
import { useDepositHistory } from '../../hooks/useDepositHistory'
import { rawToUsdc, formatUsdc, formatCompact } from '../../utils/format'
import Button from '../common/Button'
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
  PieChart,
  Pie,
  Cell,
} from 'recharts'

function getRatioClass(ratio: number): string {
  if (ratio >= 1.5) return 'ratio-healthy'
  if (ratio >= 1) return 'ratio-warning'
  return 'ratio-danger'
}

function getRatioLabel(ratio: number): string {
  if (ratio >= 1.5) return 'Healthy'
  if (ratio >= 1) return 'Adequate'
  return 'Underfunded'
}

interface VaultDonutProps {
  label: string
  color: string
  assets: number
  cap: number
}

function VaultDonut({ label, color, assets, cap }: VaultDonutProps) {
  const pct = cap > 0 ? Math.min((assets / cap) * 100, 100) : 0
  const data = [
    { value: pct },
    { value: 100 - pct },
  ]
  return (
    <div className="vault-donut">
      <div className="vault-donut-chart">
        <ResponsiveContainer width={120} height={120}>
          <PieChart>
            <Pie
              data={data}
              innerRadius={40}
              outerRadius={55}
              startAngle={90}
              endAngle={-270}
              dataKey="value"
              stroke="none"
            >
              <Cell fill={color} />
              <Cell fill="rgba(255,255,255,0.06)" />
            </Pie>
          </PieChart>
        </ResponsiveContainer>
        <span className="vault-donut-pct">{pct.toFixed(1)}%</span>
      </div>
      <span className="vault-donut-label">{label}</span>
      <span className="vault-donut-value">${formatCompact(assets)} of ${formatCompact(cap)}</span>
    </div>
  )
}

export default function ProtocolHealth() {
  const { data, loading, error, refresh } = useProtocolHealth()
  const { data: chartData, loading: chartLoading, error: chartError } = useDepositHistory()

  if (loading) {
    return <div className="health-loading">Loading protocol data...</div>
  }

  if (error) {
    return (
      <div className="health-error">
        <p>{error}</p>
        <Button onClick={() => void refresh()}>Retry</Button>
      </div>
    )
  }

  if (!data) return null

  const totalAssetsUsdc = rawToUsdc(data.totalAssets)
  const capUsdc = rawToUsdc(data.cap)
  const activeCoverageUsdc = rawToUsdc(data.totalActiveCoverage)
  const pendingCoverageUsdc = rawToUsdc(data.pendingCoverage)
  const verifiedCoverageUsdc = activeCoverageUsdc - pendingCoverageUsdc
  const coverageRatio = verifiedCoverageUsdc > 0 ? totalAssetsUsdc / verifiedCoverageUsdc : Infinity

  const uwAssets = rawToUsdc(data.underwriter.totalAssets)
  const uwCap = rawToUsdc(data.underwriter.cap)
  const jrAssets = rawToUsdc(data.junior.totalAssets)
  const jrCap = rawToUsdc(data.junior.cap)
  const srAssets = rawToUsdc(data.senior.totalAssets)
  const srCap = rawToUsdc(data.senior.cap)

  return (
    <div className="protocol-health">
      <div className="health-header">
        <h2>Protocol Health</h2>
        <Button variant="secondary" onClick={() => void refresh()}>
          <i className="fa-solid fa-rotate" /> Refresh
        </Button>
      </div>

      {/* Summary cards */}
      <div className="health-cards">
        <div className="health-card">
          <span className="health-card-label">Total Vault Deposits</span>
          <span className="health-card-value">${formatUsdc(totalAssetsUsdc)}</span>
          <span className="health-card-sub">USDC across all vaults</span>
        </div>

        <div className="health-card">
          <span className="health-card-label">Verified Active Coverage</span>
          <span className="health-card-value">${formatUsdc(verifiedCoverageUsdc)}</span>
          <span className="health-card-sub">
            {pendingCoverageUsdc > 0
              ? `+ $${formatUsdc(pendingCoverageUsdc)} pending verification`
              : 'USDC (if all policies trigger)'}
          </span>
        </div>

        <div className={`health-card ${getRatioClass(coverageRatio)}`}>
          <span className="health-card-label">Coverage Ratio</span>
          <span className="health-card-value">
            {coverageRatio === Infinity ? 'N/A' : `${coverageRatio.toFixed(2)}x`}
          </span>
          <span className="health-card-sub">
            {coverageRatio === Infinity ? 'No active coverage' : getRatioLabel(coverageRatio)}
          </span>
        </div>
      </div>

      {/* Per-vault breakdown */}
      <div className="health-bar-section">
        <h3>Vault Breakdown</h3>
        <div className="vault-donuts">
          <VaultDonut label="Underwriter" color="#8b5cf6" assets={uwAssets} cap={uwCap} />
          <VaultDonut label="Junior" color="#f59e0b" assets={jrAssets} cap={jrCap} />
          <VaultDonut label="Senior" color="#22c55e" assets={srAssets} cap={srCap} />
        </div>
        <div className="health-bar-labels">
          <span>Total: ${formatCompact(totalAssetsUsdc)}</span>
          <span>Verified coverage: ${formatCompact(verifiedCoverageUsdc)}{pendingCoverageUsdc > 0 ? ` | Pending: $${formatCompact(pendingCoverageUsdc)}` : ''}</span>
          <span>Total Cap: ${formatCompact(capUsdc)}</span>
        </div>
      </div>

      {/* Historical chart */}
      <div className="health-chart-section">
        <h3>Historical Deposits, Premiums & Coverage</h3>
        {chartLoading && <p className="health-loading">Loading chart data...</p>}
        {chartError && <p className="health-error">{chartError}</p>}
        {!chartLoading && !chartError && chartData.length > 0 && (
          <div className="health-chart">
            <ResponsiveContainer width="100%" height={300}>
              <AreaChart data={chartData} margin={{ top: 10, right: 30, left: 10, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.1)" />
                <XAxis
                  dataKey="date"
                  tick={{ fill: '#999', fontSize: 12 }}
                />
                <YAxis
                  tick={{ fill: '#999', fontSize: 12 }}
                  tickFormatter={(v: number) => `$${v}`}
                />
                <Tooltip
                  contentStyle={{
                    background: '#1a1a2e',
                    border: '1px solid rgba(255,255,255,0.1)',
                    borderRadius: 8,
                    color: '#fff',
                  }}
                  formatter={(value: number | string | undefined, name: string | undefined) => {
                    const labels: Record<string, string> = {
                      cumulativeDeposits: 'Vault Deposits',
                      cumulativePremiums: 'Premiums Collected',
                      activeCoverage: 'Active Coverage',
                    }
                    const num = typeof value === 'number' ? value : 0
                    return [`$${formatUsdc(num)} USDC`, labels[name ?? ''] ?? name]
                  }}
                />
                <Legend
                  formatter={(value: string) => {
                    const labels: Record<string, string> = {
                      cumulativeDeposits: 'Vault Deposits',
                      cumulativePremiums: 'Premiums Collected',
                      activeCoverage: 'Active Coverage',
                    }
                    return labels[value] ?? value
                  }}
                />
                <Area
                  type="monotone"
                  dataKey="cumulativeDeposits"
                  stroke="#4f7cff"
                  fill="rgba(79, 124, 255, 0.2)"
                  strokeWidth={2}
                />
                <Area
                  type="monotone"
                  dataKey="cumulativePremiums"
                  stroke="#22c55e"
                  fill="rgba(34, 197, 94, 0.2)"
                  strokeWidth={2}
                />
                <Area
                  type="monotone"
                  dataKey="activeCoverage"
                  stroke="#ef4444"
                  fill="rgba(239, 68, 68, 0.15)"
                  strokeWidth={2}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        )}
        {!chartLoading && !chartError && chartData.length === 0 && (
          <p className="health-empty">No deposit or premium history yet.</p>
        )}
      </div>
    </div>
  )
}
