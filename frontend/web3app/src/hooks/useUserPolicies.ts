import { useCallback, useEffect, useState } from 'react'
import { PolicyManagerAbi } from '../abi/PolicyManager'
import { POLICY_MANAGER_ADDRESS } from '../config/contracts'
import { useViemClients } from './useWalletClient'
import type { PolicyOnChain } from '../types'

export function useUserPolicies() {
  const { publicClient, address } = useViemClients()
  const [policies, setPolicies] = useState<PolicyOnChain[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    if (!address) {
      setPolicies([])
      return
    }

    setLoading(true)
    setError(null)

    try {
      // Get total number of policies
      const nextId = await publicClient.readContract({
        address: POLICY_MANAGER_ADDRESS,
        abi: PolicyManagerAbi,
        functionName: 'nextId',
      })

      const userPolicies: PolicyOnChain[] = []

      // Check each policy
      for (let id = 1n; id < nextId; id++) {
        const holder = await publicClient.readContract({
          address: POLICY_MANAGER_ADDRESS,
          abi: PolicyManagerAbi,
          functionName: 'holderOf',
          args: [id],
        })

        if (holder.toLowerCase() !== address.toLowerCase()) continue

        const data = await publicClient.readContract({
          address: POLICY_MANAGER_ADDRESS,
          abi: PolicyManagerAbi,
          functionName: 'policies',
          args: [id],
        })

        const [hazard, start, end, lat, lon, maxCoverage, premium, triggerThreshold, paid] = data

        const status = await publicClient.readContract({
          address: POLICY_MANAGER_ADDRESS,
          abi: PolicyManagerAbi,
          functionName: 'policyStatus',
          args: [id],
        })

        userPolicies.push({
          id,
          hazard: Number(hazard),
          start: Number(start),
          end: Number(end),
          lat: Number(lat),
          lon: Number(lon),
          maxCoverage,
          premium,
          triggerThreshold,
          paid,
          status: Number(status),
          holder: holder as `0x${string}`,
        })
      }

      setPolicies(userPolicies)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to load policies')
    } finally {
      setLoading(false)
    }
  }, [address, publicClient])

  useEffect(() => {
    void refresh()
  }, [refresh])

  return { policies, loading, error, refresh }
}
