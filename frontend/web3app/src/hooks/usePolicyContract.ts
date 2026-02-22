import { useCallback, useState } from 'react'
import { parseEventLogs } from 'viem'
import { PolicyManagerAbi } from '../abi/PolicyManager'
import { ERC20Abi } from '../abi/ERC20'
import { POLICY_MANAGER_ADDRESS, USDC_ADDRESS } from '../config/contracts'
import { useViemClients } from './useWalletClient'
import { usdcToRaw, coordToInt32, monthsToDays } from '../utils/format'

export type BuyStep = 'idle' | 'approving' | 'buying' | 'success' | 'error'

interface BuyParams {
  hazardId: number
  durationMonths: number
  coverageUsdc: number
  premiumUsdc: number
  triggerThreshold: number
  lat: number
  lon: number
}

export function useBuyPolicy() {
  const { publicClient, getWalletClient, address } = useViemClients()
  const [step, setStep] = useState<BuyStep>('idle')
  const [policyId, setPolicyId] = useState<bigint | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [txHash, setTxHash] = useState<string | null>(null)

  const buy = useCallback(
    async (params: BuyParams) => {
      if (!address) {
        setError('Wallet not connected')
        return
      }

      try {
        setStep('idle')
        setError(null)
        setPolicyId(null)
        setTxHash(null)

        const walletClient = await getWalletClient()
        const premiumRaw = usdcToRaw(params.premiumUsdc)
        const coverageRaw = usdcToRaw(params.coverageUsdc)
        const durationDays = monthsToDays(params.durationMonths)
        const latInt = coordToInt32(params.lat)
        const lonInt = coordToInt32(params.lon)

        // Check USDC balance
        const balance = await publicClient.readContract({
          address: USDC_ADDRESS,
          abi: ERC20Abi,
          functionName: 'balanceOf',
          args: [address],
        })

        if (balance < premiumRaw) {
          setError(
            `Insufficient USDC. Need ${params.premiumUsdc.toFixed(2)} but have ${(Number(balance) / 1e6).toFixed(2)}`,
          )
          setStep('error')
          return
        }

        // Check allowance
        const allowance = await publicClient.readContract({
          address: USDC_ADDRESS,
          abi: ERC20Abi,
          functionName: 'allowance',
          args: [address, POLICY_MANAGER_ADDRESS],
        })

        // Approve if needed
        if (allowance < premiumRaw) {
          setStep('approving')

          // If there's a non-zero allowance, reset to 0 first (USDC requirement)
          if (allowance > 0n) {
            const resetHash = await walletClient.writeContract({
              address: USDC_ADDRESS,
              abi: ERC20Abi,
              functionName: 'approve',
              args: [POLICY_MANAGER_ADDRESS, 0n],
            })
            await publicClient.waitForTransactionReceipt({ hash: resetHash })
          }

          const approveHash = await walletClient.writeContract({
            address: USDC_ADDRESS,
            abi: ERC20Abi,
            functionName: 'approve',
            args: [POLICY_MANAGER_ADDRESS, premiumRaw],
          })
          await publicClient.waitForTransactionReceipt({ hash: approveHash })
        }

        // Buy policy
        setStep('buying')
        const buyHash = await walletClient.writeContract({
          address: POLICY_MANAGER_ADDRESS,
          abi: PolicyManagerAbi,
          functionName: 'buyPolicy',
          args: [
            params.hazardId,
            durationDays,
            coverageRaw,
            premiumRaw,
            BigInt(Math.round(params.triggerThreshold)),
            address,
            latInt,
            lonInt,
          ],
        })

        setTxHash(buyHash)
        const receipt = await publicClient.waitForTransactionReceipt({ hash: buyHash })

        // Parse PolicyPurchased event
        const logs = parseEventLogs({
          abi: PolicyManagerAbi,
          logs: receipt.logs,
          eventName: 'PolicyPurchased',
        })

        if (logs.length > 0) {
          setPolicyId(logs[0]!.args.policyId)
        }

        setStep('success')
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : 'Transaction failed')
        setStep('error')
      }
    },
    [address, publicClient, getWalletClient],
  )

  const reset = useCallback(() => {
    setStep('idle')
    setError(null)
    setPolicyId(null)
    setTxHash(null)
  }, [])

  return { buy, step, policyId, error, txHash, reset }
}
