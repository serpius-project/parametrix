import { useCallback, useEffect, useState } from 'react'
import { UnderwriterVaultAbi } from '../abi/UnderwriterVault'
import { useViemClients } from './useWalletClient'

export interface VaultData {
  totalAssets: bigint
  cap: bigint
  totalSupply: bigint
  totalReservedShares: bigint
  userShares: bigint
  userAssetValue: bigint
  maxDeposit: bigint
  maxWithdraw: bigint
  lockupEnabled: boolean
  lockupDuration: bigint
  userDepositTimestamp: bigint
  aaveEnabled: boolean
}

export function useVaultData(vaultAddress: `0x${string}`) {
  const { publicClient, address } = useViemClients()
  const [data, setData] = useState<VaultData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    if (vaultAddress === '0x0000000000000000000000000000000000000000') {
      setLoading(false)
      return
    }

    setLoading(true)
    setError(null)

    try {
      const userAddr = address || '0x0000000000000000000000000000000000000000'

      const [
        totalAssets, cap, totalSupply, totalReservedShares,
        userShares, maxDeposit, maxWithdraw,
        lockupEnabled, lockupDuration, userDepositTimestamp, aaveEnabled,
      ] = await Promise.all([
        publicClient.readContract({ address: vaultAddress, abi: UnderwriterVaultAbi, functionName: 'totalAssets' }),
        publicClient.readContract({ address: vaultAddress, abi: UnderwriterVaultAbi, functionName: 'cap' }),
        publicClient.readContract({ address: vaultAddress, abi: UnderwriterVaultAbi, functionName: 'totalSupply' }),
        publicClient.readContract({ address: vaultAddress, abi: UnderwriterVaultAbi, functionName: 'totalReservedShares' }),
        publicClient.readContract({ address: vaultAddress, abi: UnderwriterVaultAbi, functionName: 'balanceOf', args: [userAddr] }),
        publicClient.readContract({ address: vaultAddress, abi: UnderwriterVaultAbi, functionName: 'maxDeposit', args: [userAddr] }),
        publicClient.readContract({ address: vaultAddress, abi: UnderwriterVaultAbi, functionName: 'maxWithdraw', args: [userAddr] }),
        publicClient.readContract({ address: vaultAddress, abi: UnderwriterVaultAbi, functionName: 'lockupEnabled' }),
        publicClient.readContract({ address: vaultAddress, abi: UnderwriterVaultAbi, functionName: 'lockupDuration' }),
        publicClient.readContract({ address: vaultAddress, abi: UnderwriterVaultAbi, functionName: 'depositTimestamp', args: [userAddr] }),
        publicClient.readContract({ address: vaultAddress, abi: UnderwriterVaultAbi, functionName: 'aaveEnabled' }),
      ])

      let userAssetValue = 0n
      if ((userShares as bigint) > 0n) {
        userAssetValue = await publicClient.readContract({
          address: vaultAddress,
          abi: UnderwriterVaultAbi,
          functionName: 'convertToAssets',
          args: [userShares as bigint],
        }) as bigint
      }

      setData({
        totalAssets: totalAssets as bigint,
        cap: cap as bigint,
        totalSupply: totalSupply as bigint,
        totalReservedShares: totalReservedShares as bigint,
        userShares: userShares as bigint,
        userAssetValue,
        maxDeposit: maxDeposit as bigint,
        maxWithdraw: maxWithdraw as bigint,
        lockupEnabled: lockupEnabled as boolean,
        lockupDuration: lockupDuration as bigint,
        userDepositTimestamp: userDepositTimestamp as bigint,
        aaveEnabled: aaveEnabled as boolean,
      })
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to load vault data')
    } finally {
      setLoading(false)
    }
  }, [publicClient, vaultAddress, address])

  useEffect(() => {
    void refresh()
  }, [refresh])

  return { data, loading, error, refresh }
}
