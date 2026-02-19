import { defineChain } from 'viem'

export const POLICY_MANAGER_ADDRESS = '0x4b0aF97a249Dbf50203C7Cadb8Ee628DC767F09f' as const
export const USDC_ADDRESS = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48' as const
export const VAULT_ADDRESS = '0x13C9403F6921ee4b020d644Db2Ee9d4a5480a080' as const

export const USDC_DECIMALS = 6

export const tenderlyChain = defineChain({
  id: Number(import.meta.env.VITE_CHAIN_ID) || 1,
  name: 'Tenderly Virtual Testnet',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: {
    default: { http: [import.meta.env.VITE_CHAIN_RPC_URL || 'http://localhost:8545'] },
  },
})
