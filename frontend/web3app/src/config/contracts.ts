import { defineChain } from 'viem'

// Multi-vault addresses (updated after redeployment)
export const POLICY_MANAGER_ADDRESS = (import.meta.env.VITE_POLICY_MANAGER_ADDRESS || '0x0000000000000000000000000000000000000000') as `0x${string}`
export const USDC_ADDRESS = (import.meta.env.VITE_USDC_ADDRESS || '0x0000000000000000000000000000000000000000') as `0x${string}`
export const UNDERWRITER_VAULT_ADDRESS = (import.meta.env.VITE_UNDERWRITER_VAULT_ADDRESS || '0x0000000000000000000000000000000000000000') as `0x${string}`
export const JUNIOR_VAULT_ADDRESS = (import.meta.env.VITE_JUNIOR_VAULT_ADDRESS || '0x0000000000000000000000000000000000000000') as `0x${string}`
export const SENIOR_VAULT_ADDRESS = (import.meta.env.VITE_SENIOR_VAULT_ADDRESS || '0x0000000000000000000000000000000000000000') as `0x${string}`
export const FEE_RATE_MODEL_ADDRESS = (import.meta.env.VITE_FEE_RATE_MODEL_ADDRESS || '0x0000000000000000000000000000000000000000') as `0x${string}`

export const USDC_DECIMALS = 6

// Aave V3 (mainnet + Tenderly fork share the same addresses)
export const AAVE_POOL_ADDRESS = (import.meta.env.VITE_AAVE_POOL_ADDRESS || '0x87870Bca3F3fD6335C3F4ce8392D69350B4fA4E2') as `0x${string}`

export const tenderlyChain = defineChain({
  id: Number(import.meta.env.VITE_CHAIN_ID) || 1,
  name: 'Tenderly Virtual Testnet',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: {
    default: { http: [import.meta.env.VITE_CHAIN_RPC_URL || 'http://localhost:8545'] },
  },
})
