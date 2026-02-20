import { useCallback, useEffect, useState } from 'react'
import { PolicyManagerAbi } from '../abi/PolicyManager'
import { POLICY_MANAGER_ADDRESS } from '../config/contracts'
import { useViemClients } from './useWalletClient'

export interface TxEvent {
  type: 'purchase' | 'payout'
  policyId: bigint
  blockNumber: bigint
  txHash: string
  // Purchase fields
  hazard?: number
  maxCoverage?: bigint
  triggerThreshold?: bigint
  // Payout fields
  observedValue?: bigint
  requestedPayout?: bigint
  actualPayout?: bigint
}

export function useTransactionHistory() {
  const { publicClient, address } = useViemClients()
  const [events, setEvents] = useState<TxEvent[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    if (!address) {
      setEvents([])
      return
    }

    setLoading(true)
    setError(null)

    try {
      const [purchaseLogs, payoutLogs] = await Promise.all([
        publicClient.getLogs({
          address: POLICY_MANAGER_ADDRESS,
          event: {
            type: 'event',
            name: 'PolicyPurchased',
            inputs: [
              { name: 'policyId', type: 'uint256', indexed: true },
              { name: 'holder', type: 'address', indexed: true },
              { name: 'hazard', type: 'uint8', indexed: false },
              { name: 'start', type: 'uint256', indexed: false },
              { name: 'end', type: 'uint256', indexed: false },
              { name: 'maxCoverage', type: 'uint256', indexed: false },
              { name: 'triggerThreshold', type: 'uint256', indexed: false },
              { name: 'lat', type: 'int32', indexed: false },
              { name: 'lon', type: 'int32', indexed: false },
            ],
          },
          args: { holder: address },
          fromBlock: 0n,
          toBlock: 'latest',
        }),
        publicClient.getLogs({
          address: POLICY_MANAGER_ADDRESS,
          event: {
            type: 'event',
            name: 'PayoutTriggered',
            inputs: [
              { name: 'policyId', type: 'uint256', indexed: true },
              { name: 'holder', type: 'address', indexed: true },
              { name: 'observedValue', type: 'uint256', indexed: false },
              { name: 'requestedPayout', type: 'uint256', indexed: false },
              { name: 'actualPayout', type: 'uint256', indexed: false },
            ],
          },
          args: { holder: address },
          fromBlock: 0n,
          toBlock: 'latest',
        }),
      ])

      const txEvents: TxEvent[] = []

      for (const log of purchaseLogs) {
        txEvents.push({
          type: 'purchase',
          policyId: log.args.policyId!,
          blockNumber: log.blockNumber,
          txHash: log.transactionHash,
          hazard: Number(log.args.hazard),
          maxCoverage: log.args.maxCoverage,
          triggerThreshold: log.args.triggerThreshold,
        })
      }

      for (const log of payoutLogs) {
        txEvents.push({
          type: 'payout',
          policyId: log.args.policyId!,
          blockNumber: log.blockNumber,
          txHash: log.transactionHash,
          observedValue: log.args.observedValue,
          requestedPayout: log.args.requestedPayout,
          actualPayout: log.args.actualPayout,
        })
      }

      // Sort by block number descending (most recent first)
      txEvents.sort((a, b) => Number(b.blockNumber - a.blockNumber))

      setEvents(txEvents)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to load transaction history')
    } finally {
      setLoading(false)
    }
  }, [address, publicClient])

  useEffect(() => {
    void refresh()
  }, [refresh])

  return { events, loading, error, refresh }
}
