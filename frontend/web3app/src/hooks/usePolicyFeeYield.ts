import { useCallback, useEffect, useState } from 'react'
import { PolicyManagerAbi } from '../abi/PolicyManager'
import { POLICY_MANAGER_ADDRESS, USDC_DECIMALS } from '../config/contracts'
import { useViemClients } from './useWalletClient'

type VaultTranche = 'underwriter' | 'junior' | 'senior'

export function usePolicyFeeYield(
  tranche: VaultTranche,
  totalAssets: bigint | undefined,
) {
  const { publicClient } = useViemClients()
  const [yieldPercent, setYieldPercent] = useState<number | null>(null)
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    if (
      POLICY_MANAGER_ADDRESS === '0x0000000000000000000000000000000000000000' ||
      !totalAssets || totalAssets === 0n
    ) {
      setLoading(false)
      return
    }

    try {
      // Query all PremiumDistributed events from deployment onward.
      // On Tenderly forks the block history may be short, so we start from
      // the earliest safe block (0n) and compute the actual time window from
      // the first event's block timestamp.
      const logs = await publicClient.getContractEvents({
        address: POLICY_MANAGER_ADDRESS,
        abi: PolicyManagerAbi,
        eventName: 'PremiumDistributed',
        fromBlock: 0n,
        toBlock: 'latest',
      })

      if (logs.length === 0) {
        setYieldPercent(0)
        return
      }

      let premiumToVault = 0n
      for (const log of logs) {
        if (tranche === 'underwriter') premiumToVault += log.args.underwriterAmount ?? 0n
        else if (tranche === 'junior') premiumToVault += log.args.juniorAmount ?? 0n
        else premiumToVault += log.args.seniorAmount ?? 0n
      }

      // Compute actual time window from first event to now
      const firstBlock = await publicClient.getBlock({ blockNumber: logs[0].blockNumber })
      const nowSeconds = BigInt(Math.floor(Date.now() / 1000))
      const elapsedSeconds = Number(nowSeconds - firstBlock.timestamp)
      const elapsedDays = Math.max(elapsedSeconds / 86400, 1) // at least 1 day to avoid division spikes

      const premiumNum = Number(premiumToVault) / 10 ** USDC_DECIMALS
      const assetsNum = Number(totalAssets) / 10 ** USDC_DECIMALS

      if (assetsNum > 0) {
        const annualized = (premiumNum / assetsNum) * (365 / elapsedDays) * 100
        setYieldPercent(annualized)
      } else {
        setYieldPercent(0)
      }
    } catch {
      setYieldPercent(null)
    } finally {
      setLoading(false)
    }
  }, [publicClient, tranche, totalAssets])

  useEffect(() => {
    void refresh()
  }, [refresh])

  return { yieldPercent, loading, refresh }
}
