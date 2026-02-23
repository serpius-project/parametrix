import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { DynamicContextProvider } from '@dynamic-labs/sdk-react-core'
import { EthereumWalletConnectors } from '@dynamic-labs/ethereum'
import App from './App'
import './index.css'

const chainId = Number(import.meta.env.VITE_CHAIN_ID) || 1
const rpcUrl = import.meta.env.VITE_CHAIN_RPC_URL || 'http://localhost:8545'

const dynamicCssOverrides = `
  @media (max-width: 768px) {
    .network-switch-control__network-name {
      display: none !important;
    }
  }
`

const dynamicSettings = {
  environmentId: import.meta.env.VITE_DYNAMIC_ENV_ID || '',
  walletConnectors: [EthereumWalletConnectors],
  cssOverrides: dynamicCssOverrides,
  overrides: {
    evmNetworks: [
      {
        blockExplorerUrls: ['https://dashboard.tenderly.co'],
        chainId: chainId,
        chainName: 'Parametrix Virtual Testnet',
        iconUrls: ['https://app.dynamic.xyz/assets/networks/eth.svg'],
        name: 'Tenderly Virtual Testnet',
        nativeCurrency: {
          decimals: 18,
          name: 'Ether',
          symbol: 'ETH',
        },
        networkId: chainId,
        rpcUrls: [rpcUrl],
        vanityName: 'PXTestnet',
      },
    ],
  },
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <DynamicContextProvider settings={dynamicSettings}>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </DynamicContextProvider>
  </StrictMode>,
)
