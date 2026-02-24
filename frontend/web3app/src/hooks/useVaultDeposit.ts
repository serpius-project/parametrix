import { useCallback, useState } from 'react'
import { UnderwriterVaultAbi } from '../abi/UnderwriterVault'
import { ERC20Abi } from '../abi/ERC20'
import { USDC_ADDRESS } from '../config/contracts'
import { useViemClients } from './useWalletClient'
import { usdcToRaw } from '../utils/format'

export type VaultStep = 'idle' | 'approving' | 'depositing' | 'withdrawing' | 'success' | 'error'

export function useVaultDeposit(vaultAddress: `0x${string}`) {
  const { publicClient, getWalletClient, address } = useViemClients()
  const [step, setStep] = useState<VaultStep>('idle')
  const [error, setError] = useState<string | null>(null)
  const [txHash, setTxHash] = useState<string | null>(null)

  const deposit = useCallback(
    async (amountUsdc: number) => {
      if (!address) {
        setError('Wallet not connected')
        setStep('error')
        return
      }

      try {
        setStep('idle')
        setError(null)
        setTxHash(null)

        const walletClient = await getWalletClient()
        const amountRaw = usdcToRaw(amountUsdc)

        // Check USDC balance
        const balance = await publicClient.readContract({
          address: USDC_ADDRESS,
          abi: ERC20Abi,
          functionName: 'balanceOf',
          args: [address],
        })

        if (balance < amountRaw) {
          setError(`Insufficient USDC. Need ${amountUsdc.toFixed(2)} but have ${(Number(balance) / 1e6).toFixed(2)}`)
          setStep('error')
          return
        }

        // Check allowance
        const allowance = await publicClient.readContract({
          address: USDC_ADDRESS,
          abi: ERC20Abi,
          functionName: 'allowance',
          args: [address, vaultAddress],
        })

        if (allowance < amountRaw) {
          setStep('approving')

          if (allowance > 0n) {
            const resetHash = await walletClient.writeContract({
              address: USDC_ADDRESS,
              abi: ERC20Abi,
              functionName: 'approve',
              args: [vaultAddress, 0n],
            })
            await publicClient.waitForTransactionReceipt({ hash: resetHash })
          }

          const approveHash = await walletClient.writeContract({
            address: USDC_ADDRESS,
            abi: ERC20Abi,
            functionName: 'approve',
            args: [vaultAddress, amountRaw],
          })
          await publicClient.waitForTransactionReceipt({ hash: approveHash })
        }

        // Deposit
        setStep('depositing')
        const hash = await walletClient.writeContract({
          address: vaultAddress,
          abi: UnderwriterVaultAbi,
          functionName: 'deposit',
          args: [amountRaw, address],
        })

        setTxHash(hash)
        await publicClient.waitForTransactionReceipt({ hash })
        setStep('success')
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : 'Deposit failed')
        setStep('error')
      }
    },
    [address, publicClient, getWalletClient, vaultAddress],
  )

  const withdraw = useCallback(
    async (amountUsdc: number) => {
      if (!address) {
        setError('Wallet not connected')
        setStep('error')
        return
      }

      try {
        setStep('idle')
        setError(null)
        setTxHash(null)

        const walletClient = await getWalletClient()
        const amountRaw = usdcToRaw(amountUsdc)

        setStep('withdrawing')
        const hash = await walletClient.writeContract({
          address: vaultAddress,
          abi: UnderwriterVaultAbi,
          functionName: 'withdraw',
          args: [amountRaw, address, address],
        })

        setTxHash(hash)
        await publicClient.waitForTransactionReceipt({ hash })
        setStep('success')
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : 'Withdrawal failed')
        setStep('error')
      }
    },
    [address, publicClient, getWalletClient, vaultAddress],
  )

  const reset = useCallback(() => {
    setStep('idle')
    setError(null)
    setTxHash(null)
  }, [])

  return { deposit, withdraw, step, error, txHash, reset }
}
