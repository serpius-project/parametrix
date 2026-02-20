import { useCallback, useEffect, useState } from 'react'
import { UnderwriterVaultAbi } from '../abi/UnderwriterVault'
import { PolicyManagerAbi } from '../abi/PolicyManager'
import { VAULT_ADDRESS, POLICY_MANAGER_ADDRESS } from '../config/contracts'
import { useViemClients } from './useWalletClient'

export interface ProtocolHealthData {
  totalAssets: bigint
  cap: bigint
  totalReservedShares: bigint
  totalSupply: bigint
  totalActiveCoverage: bigint
}

export function useProtocolHealth() {
  const { publicClient } = useViemClients()
  const [data, setData] = useState<ProtocolHealthData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    setLoading(true)
    setError(null)

    try {
      const [totalAssets, cap, totalReservedShares, totalSupply, totalActiveCoverage] =
        await Promise.all([
          publicClient.readContract({ address: VAULT_ADDRESS, abi: UnderwriterVaultAbi, functionName: 'totalAssets' }),
          publicClient.readContract({ address: VAULT_ADDRESS, abi: UnderwriterVaultAbi, functionName: 'cap' }),
          publicClient.readContract({ address: VAULT_ADDRESS, abi: UnderwriterVaultAbi, functionName: 'totalReservedShares' }),
          publicClient.readContract({ address: VAULT_ADDRESS, abi: UnderwriterVaultAbi, functionName: 'totalSupply' }),
          publicClient.readContract({ address: POLICY_MANAGER_ADDRESS, abi: PolicyManagerAbi, functionName: 'totalActiveCoverage' }),
        ])

      setData({
        totalAssets: totalAssets as bigint,
        cap: cap as bigint,
        totalReservedShares: totalReservedShares as bigint,
        totalSupply: totalSupply as bigint,
        totalActiveCoverage: totalActiveCoverage as bigint,
      })
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to load protocol health')
    } finally {
      setLoading(false)
    }
  }, [publicClient])

  useEffect(() => {
    void refresh()
  }, [refresh])

  return { data, loading, error, refresh }
}
