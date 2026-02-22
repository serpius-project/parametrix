import { defineChain } from 'viem'

export const POLICY_MANAGER_ADDRESS = '0x7C3C2AC7BE829fB101AF70b753b924bd9d4a0C86' as const
export const USDC_ADDRESS = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48' as const
export const VAULT_ADDRESS = '0xCA079c8D56C8FE8dE8CEC3cf86B2E2175CC32C82' as const

export const USDC_DECIMALS = 6

export const tenderlyChain = defineChain({
  id: Number(import.meta.env.VITE_CHAIN_ID) || 1,
  name: 'Tenderly Virtual Testnet',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: {
    default: { http: [import.meta.env.VITE_CHAIN_RPC_URL || 'http://localhost:8545'] },
  },
})
