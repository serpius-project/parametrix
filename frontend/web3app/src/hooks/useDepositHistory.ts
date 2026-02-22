import { useCallback, useEffect, useState } from 'react'
import { PolicyManagerAbi } from '../abi/PolicyManager'
import { VAULT_ADDRESS, POLICY_MANAGER_ADDRESS } from '../config/contracts'
import { useViemClients } from './useWalletClient'

export interface ChartPoint {
  date: string // formatted date string for x-axis
  cumulativeDeposits: number // USDC
  cumulativePremiums: number // USDC
  activeCoverage: number // USDC
}

type EventType = 'deposit' | 'premium' | 'coverage_add' | 'coverage_remove'

interface RawEvent {
  blockNumber: number
  type: EventType
  amount: bigint
}

export function useDepositHistory() {
  const { publicClient } = useViemClients()
  const [data, setData] = useState<ChartPoint[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    setLoading(true)
    setError(null)

    try {
      // Fetch all relevant events in parallel
      const [depositLogs, purchaseLogs, payoutLogs, expiredLogs] = await Promise.all([
        publicClient.getLogs({
          address: VAULT_ADDRESS,
          event: {
            type: 'event',
            name: 'Deposit',
            inputs: [
              { name: 'sender', type: 'address', indexed: true },
              { name: 'receiver', type: 'address', indexed: true },
              { name: 'assets', type: 'uint256', indexed: false },
              { name: 'shares', type: 'uint256', indexed: false },
            ],
          },
          fromBlock: 0n,
          toBlock: 'latest',
        }),
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
              { name: 'triggerThreshold', type: 'int256', indexed: false },
              { name: 'lat', type: 'int32', indexed: false },
              { name: 'lon', type: 'int32', indexed: false },
            ],
          },
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
              { name: 'observedValue', type: 'int256', indexed: false },
              { name: 'requestedPayout', type: 'uint256', indexed: false },
              { name: 'actualPayout', type: 'uint256', indexed: false },
            ],
          },
          fromBlock: 0n,
          toBlock: 'latest',
        }),
        publicClient.getLogs({
          address: POLICY_MANAGER_ADDRESS,
          event: {
            type: 'event',
            name: 'PolicyExpiredReleased',
            inputs: [
              { name: 'policyId', type: 'uint256', indexed: true },
              { name: 'sharesReleased', type: 'uint256', indexed: false },
            ],
          },
          fromBlock: 0n,
          toBlock: 'latest',
        }),
      ])

      // Read premium for each purchased policy (not in event, stored in struct)
      const premiumResults = await Promise.all(
        purchaseLogs.map((log) =>
          publicClient
            .readContract({
              address: POLICY_MANAGER_ADDRESS,
              abi: PolicyManagerAbi,
              functionName: 'policies',
              args: [log.args.policyId!],
            })
            .then((result) => ({ status: 'success' as const, result }))
            .catch(() => ({ status: 'failure' as const, result: null })),
        ),
      )

      // For payout/expired events, read maxCoverage to know how much coverage was removed
      const coverageRemovalIds = [
        ...payoutLogs.map((l) => l.args.policyId!),
        ...expiredLogs.map((l) => l.args.policyId!),
      ]
      const coverageRemovalResults = await Promise.all(
        coverageRemovalIds.map((id) =>
          publicClient
            .readContract({
              address: POLICY_MANAGER_ADDRESS,
              abi: PolicyManagerAbi,
              functionName: 'policies',
              args: [id],
            })
            .then((result) => ({ status: 'success' as const, result }))
            .catch(() => ({ status: 'failure' as const, result: null })),
        ),
      )

      // Build unified event list
      const events: RawEvent[] = []

      // Vault deposits
      for (const log of depositLogs) {
        events.push({
          blockNumber: Number(log.blockNumber),
          type: 'deposit',
          amount: log.args.assets!,
        })
      }

      // Policy purchases → premium + coverage_add
      for (let i = 0; i < purchaseLogs.length; i++) {
        const log = purchaseLogs[i]
        if (!log) continue
        const maxCoverage = log.args.maxCoverage!

        events.push({
          blockNumber: Number(log.blockNumber),
          type: 'coverage_add',
          amount: maxCoverage,
        })

        const result = premiumResults[i]
        if (result?.status === 'success') {
          const policyData = result.result as readonly [number, number, number, number, number, bigint, bigint, bigint, boolean]
          events.push({
            blockNumber: Number(log.blockNumber),
            type: 'premium',
            amount: policyData[6], // premium field
          })
        }
      }

      // Payouts → coverage_remove
      let removalIdx = 0
      for (const log of payoutLogs) {
        const result = coverageRemovalResults[removalIdx++]
        if (result?.status === 'success') {
          const policyData = result.result as readonly [number, number, number, number, number, bigint, bigint, bigint, boolean]
          events.push({
            blockNumber: Number(log.blockNumber),
            type: 'coverage_remove',
            amount: policyData[5], // maxCoverage field
          })
        }
      }

      // Expired releases → coverage_remove
      for (const log of expiredLogs) {
        const result = coverageRemovalResults[removalIdx++]
        if (result?.status === 'success') {
          const policyData = result.result as readonly [number, number, number, number, number, bigint, bigint, bigint, boolean]
          events.push({
            blockNumber: Number(log.blockNumber),
            type: 'coverage_remove',
            amount: policyData[5], // maxCoverage field
          })
        }
      }

      // Sort by block number
      events.sort((a, b) => a.blockNumber - b.blockNumber)

      // Get timestamps for unique block numbers
      const uniqueBlocks = [...new Set(events.map((e) => e.blockNumber))]
      const blockTimestamps = new Map<number, number>()
      await Promise.all(
        uniqueBlocks.map(async (bn) => {
          try {
            const block = await publicClient.getBlock({ blockNumber: BigInt(bn) })
            blockTimestamps.set(bn, Number(block.timestamp))
          } catch {
            blockTimestamps.set(bn, 0)
          }
        }),
      )

      // Compute cumulative totals
      let cumDeposits = 0n
      let cumPremiums = 0n
      let cumCoverage = 0n
      const points = new Map<string, ChartPoint>()

      for (const ev of events) {
        if (ev.type === 'deposit') cumDeposits += ev.amount
        else if (ev.type === 'premium') cumPremiums += ev.amount
        else if (ev.type === 'coverage_add') cumCoverage += ev.amount
        else if (ev.type === 'coverage_remove') cumCoverage = cumCoverage > ev.amount ? cumCoverage - ev.amount : 0n

        const ts = blockTimestamps.get(ev.blockNumber) ?? 0
        const date = ts > 0
          ? new Date(ts * 1000).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
          : `Block ${ev.blockNumber}`

        points.set(date, {
          date,
          cumulativeDeposits: Number(cumDeposits) / 1e6,
          cumulativePremiums: Number(cumPremiums) / 1e6,
          activeCoverage: Number(cumCoverage) / 1e6,
        })
      }

      setData([...points.values()])
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to load deposit history')
    } finally {
      setLoading(false)
    }
  }, [publicClient])

  useEffect(() => {
    void refresh()
  }, [refresh])

  return { data, loading, error, refresh }
}
