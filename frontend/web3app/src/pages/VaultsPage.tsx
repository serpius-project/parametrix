import VaultCard from '../components/Vaults/VaultCard'
import { JUNIOR_VAULT_ADDRESS, SENIOR_VAULT_ADDRESS } from '../config/contracts'

export default function VaultsPage() {
  return (
    <div className="vaults-page">
      <div className="vaults-header">
        <h2>Vaults</h2>
        <p className="vaults-subtitle">
          Deposit USDC into risk-stratified vaults to earn premiums from insurance policies.
        </p>
      </div>

      <div className="vaults-grid">
        <VaultCard
          name="Junior Vault"
          symbol="pJNR"
          riskLevel="Junior"
          vaultAddress={JUNIOR_VAULT_ADDRESS}
        />
        <VaultCard
          name="Senior Vault"
          symbol="pSNR"
          riskLevel="Senior"
          vaultAddress={SENIOR_VAULT_ADDRESS}
        />
      </div>
    </div>
  )
}
