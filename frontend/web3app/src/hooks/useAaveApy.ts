import { useCallback, useEffect, useState } from 'react'
import { AavePoolAbi } from '../abi/AavePool'
import { AAVE_POOL_ADDRESS, USDC_ADDRESS } from '../config/contracts'
import { useViemClients } from './useWalletClient'

const RAY = 1e27 // Aave rates are in ray (1e27)

export function useAaveApy() {
  const { publicClient } = useViemClients()
  const [apy, setApy] = useState<number | null>(null)
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    if (USDC_ADDRESS === '0x0000000000000000000000000000000000000000') {
      setLoading(false)
      return
    }

    try {
      const reserveData = await publicClient.readContract({
        address: AAVE_POOL_ADDRESS,
        abi: AavePoolAbi,
        functionName: 'getReserveData',
        args: [USDC_ADDRESS],
      })

      // currentLiquidityRate is the supply APR in ray (1e27)
      const liquidityRate = Number(reserveData.currentLiquidityRate)
      const apyPercent = (liquidityRate / RAY) * 100
      setApy(apyPercent)
    } catch {
      setApy(null)
    } finally {
      setLoading(false)
    }
  }, [publicClient])

  useEffect(() => {
    void refresh()
  }, [refresh])

  return { apy, loading, refresh }
}
