import { defineChain } from 'viem'

export const POLICY_MANAGER_ADDRESS = '0xE3E1b5A56d11376D27c0efF3256E7299dF197d5E' as const
export const USDC_ADDRESS = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48' as const
export const VAULT_ADDRESS = '0x8c20B0469FdBcE27bDf894425115e07096C0ea9F' as const

export const USDC_DECIMALS = 6

export const tenderlyChain = defineChain({
  id: Number(import.meta.env.VITE_CHAIN_ID) || 1,
  name: 'Tenderly Virtual Testnet',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: {
    default: { http: [import.meta.env.VITE_CHAIN_RPC_URL || 'http://localhost:8545'] },
  },
})
