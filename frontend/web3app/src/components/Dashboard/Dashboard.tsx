import { useUserPolicies } from '../../hooks/useUserPolicies'
import { useTransactionHistory } from '../../hooks/useTransactionHistory'
import { useDynamicContext } from '@dynamic-labs/sdk-react-core'
import PolicyCard from './PolicyCard'
import TransactionHistory from './TransactionHistory'
import Button from '../common/Button'
import { useNavigate } from 'react-router-dom'

export default function Dashboard() {
  const { primaryWallet, setShowAuthFlow } = useDynamicContext()
  const { policies, loading, error, refresh } = useUserPolicies()
  const { events, loading: txLoading, error: txError } = useTransactionHistory()
  const navigate = useNavigate()

  if (!primaryWallet) {
    return (
      <div className="dashboard-empty">
        <h2>Connect Your Wallet</h2>
        <p>Connect your wallet to view your insurance policies.</p>
        <Button onClick={() => setShowAuthFlow(true)}>Connect Wallet</Button>
      </div>
    )
  }

  if (loading) {
    return <div className="dashboard-loading">Loading your policies...</div>
  }

  if (error) {
    return (
      <div className="dashboard-error">
        <p>{error}</p>
        <Button onClick={() => void refresh()}>Retry</Button>
      </div>
    )
  }

  if (policies.length === 0) {
    return (
      <div className="dashboard-empty">
        <h2>No Policies Yet</h2>
        <p>You haven't purchased any insurance policies yet.</p>
        <Button onClick={() => navigate('/')}>Buy a Policy</Button>
      </div>
    )
  }

  const now = Math.floor(Date.now() / 1000)

  return (
    <div className="dashboard">
      <div className="dashboard-header">
        <h2>Your Policies ({policies.length})</h2>
        <Button variant="secondary" onClick={() => void refresh()}>
          Refresh
        </Button>
      </div>
      <div className="policy-grid">
        {policies.map((policy) => (
          <PolicyCard key={policy.id.toString()} policy={policy} now={now} />
        ))}
      </div>
      <TransactionHistory events={events} loading={txLoading} error={txError} />
    </div>
  )
}
