import { useMemo } from 'react'
import { useDynamicContext } from '@dynamic-labs/sdk-react-core'
import { isEthereumWallet } from '@dynamic-labs/ethereum'
import { createPublicClient, http } from 'viem'
import { tenderlyChain } from '../config/contracts'

export function useViemClients() {
  const { primaryWallet } = useDynamicContext()

  const publicClient = useMemo(
    () =>
      createPublicClient({
        chain: tenderlyChain,
        transport: http(),
      }),
    [],
  )

  const getWalletClient = async () => {
    if (!primaryWallet) throw new Error('No wallet connected')
    if (!isEthereumWallet(primaryWallet)) throw new Error('Not an Ethereum wallet')

    const walletClient = await primaryWallet.getWalletClient()
    return walletClient
  }

  const address = primaryWallet?.address as `0x${string}` | undefined

  return { publicClient, getWalletClient, address, isConnected: !!primaryWallet }
}
