import { useCallback, useEffect, useState } from 'react'
import { UnderwriterVaultAbi } from '../abi/UnderwriterVault'
import { PolicyManagerAbi } from '../abi/PolicyManager'
import {
  UNDERWRITER_VAULT_ADDRESS,
  JUNIOR_VAULT_ADDRESS,
  SENIOR_VAULT_ADDRESS,
  POLICY_MANAGER_ADDRESS,
} from '../config/contracts'
import { useViemClients } from './useWalletClient'

interface VaultMetrics {
  totalAssets: bigint
  cap: bigint
  totalReservedShares: bigint
  totalSupply: bigint
}

export interface ProtocolHealthData {
  totalAssets: bigint
  cap: bigint
  totalReservedShares: bigint
  totalSupply: bigint
  totalActiveCoverage: bigint
  pendingCoverage: bigint
  underwriter: VaultMetrics
  junior: VaultMetrics
  senior: VaultMetrics
}

async function readVaultMetrics(
  publicClient: ReturnType<typeof useViemClients>['publicClient'],
  address: `0x${string}`,
): Promise<VaultMetrics> {
  if (address === '0x0000000000000000000000000000000000000000') {
    return { totalAssets: 0n, cap: 0n, totalReservedShares: 0n, totalSupply: 0n }
  }

  const [totalAssets, cap, totalReservedShares, totalSupply] = await Promise.all([
    publicClient.readContract({ address, abi: UnderwriterVaultAbi, functionName: 'totalAssets' }),
    publicClient.readContract({ address, abi: UnderwriterVaultAbi, functionName: 'cap' }),
    publicClient.readContract({ address, abi: UnderwriterVaultAbi, functionName: 'totalReservedShares' }),
    publicClient.readContract({ address, abi: UnderwriterVaultAbi, functionName: 'totalSupply' }),
  ])

  return {
    totalAssets: totalAssets as bigint,
    cap: cap as bigint,
    totalReservedShares: totalReservedShares as bigint,
    totalSupply: totalSupply as bigint,
  }
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
      const [underwriter, junior, senior, totalActiveCoverage, nextId] = await Promise.all([
        readVaultMetrics(publicClient, UNDERWRITER_VAULT_ADDRESS),
        readVaultMetrics(publicClient, JUNIOR_VAULT_ADDRESS),
        readVaultMetrics(publicClient, SENIOR_VAULT_ADDRESS),
        publicClient.readContract({
          address: POLICY_MANAGER_ADDRESS,
          abi: PolicyManagerAbi,
          functionName: 'totalActiveCoverage',
        }),
        publicClient.readContract({
          address: POLICY_MANAGER_ADDRESS,
          abi: PolicyManagerAbi,
          functionName: 'nextId',
        }),
      ])

      // Compute pending (unverified) coverage by iterating all policies
      const nowSec = Math.floor(Date.now() / 1000)
      let pendingCoverage = 0n
      for (let id = 1n; id < (nextId as bigint); id++) {
        const status = await publicClient.readContract({
          address: POLICY_MANAGER_ADDRESS,
          abi: PolicyManagerAbi,
          functionName: 'policyStatus',
          args: [id],
        })
        if (Number(status) !== 0) continue // only Unverified

        const data = await publicClient.readContract({
          address: POLICY_MANAGER_ADDRESS,
          abi: PolicyManagerAbi,
          functionName: 'policies',
          args: [id],
        })
        const [, , end, , , maxCoverage, , , paid] = data as [number, number, number, number, number, bigint, bigint, bigint, boolean]
        if (!paid && Number(end) > nowSec) {
          pendingCoverage += maxCoverage
        }
      }

      const totalAssets = underwriter.totalAssets + junior.totalAssets + senior.totalAssets
      const cap = underwriter.cap + junior.cap + senior.cap
      const totalReservedShares = underwriter.totalReservedShares + junior.totalReservedShares + senior.totalReservedShares
      const totalSupply = underwriter.totalSupply + junior.totalSupply + senior.totalSupply

      setData({
        totalAssets,
        cap,
        totalReservedShares,
        totalSupply,
        totalActiveCoverage: totalActiveCoverage as bigint,
        pendingCoverage,
        underwriter,
        junior,
        senior,
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
