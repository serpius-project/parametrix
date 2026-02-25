# Parametrix Frontend

React + Vite + TypeScript web app for the Parametrix parametric insurance protocol.

## Stack

- **React 19** with Vite
- **viem** for Ethereum contract interactions
- **Dynamic Labs SDK** for wallet connection
- **Mapbox GL** for location picker map
- **Recharts** for donut charts and data visualization

## Pages

| Page | Route | Description |
|---|---|---|
| Buy | `/buy` | Policy purchase wizard: select location on map, choose hazard, set coverage/threshold, preview premium, buy |
| Dashboard | `/dashboard` | View purchased policies, their status, and payout history |
| Vaults | `/vaults` | Deposit/withdraw from Underwriter, Junior, and Senior vaults |
| Protocol Health | `/protocol-health` | Protocol-wide stats: total deposits, coverage, vault utilization donut charts |

## Key Components

- **PolicyWizard** — Multi-step policy purchase flow with map-based location selection
- **VaultCard** — ERC-4626 vault interaction (deposit/withdraw with +/- buttons, cap display, APY)
- **ProtocolHealth** — Protocol overview with vault donut charts, utilization bar, and summary stats
- **Map** — Mapbox GL map with geocoder for location selection
- **Dashboard** — User's active policies and claim history

## Hooks

| Hook | Purpose |
|---|---|
| `usePolicyContract` | Read/write to PolicyManager contract |
| `usePremium` | Fetch premium quote from backend API |
| `useVaultData` | Read vault state (totalAssets, cap, shares, APY) |
| `useVaultDeposit` | Deposit/withdraw vault transactions |
| `useProtocolHealth` | Aggregate protocol stats across all vaults |
| `useUserPolicies` | Fetch user's purchased policies |
| `useAaveApy` | Fetch Aave lending APY for vault yield display |
| `usePolicyFeeYield` | Compute vault APY from policy premium fees |
| `useHazards` | Available hazard types from contract |
| `useSites` | Predefined site locations from backend |

## Setup

```bash
npm install
npm run dev
```

Requires environment variables (see `.env` or Vite config):
- `VITE_DYNAMIC_ENV_ID` — Dynamic Labs environment ID for wallet connection
- `VITE_MAPBOX_TOKEN` — Mapbox access token for the map
- `VITE_API_URL` — Backend API URL (premium calculations)
- Contract addresses configured in `src/config/`

## Build

```bash
npm run build
npm run preview
```
