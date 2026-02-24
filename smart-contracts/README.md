# Parametrix Smart Contracts

Foundry project containing the parametric insurance smart contracts for Parametrix.

## Architecture

Parametrix uses a **three-vault tranche system** with a waterfall payout structure:

```
Policyholder Premium
        │
        ▼
┌──────────────────┐
│  PolicyManager   │  ERC-1155 policy NFTs, premium split, payout waterfall
│  (policyManager) │
└──────┬───────────┘
       │  premium split via FeeRateModel
       ▼
┌──────────┐  ┌──────────┐  ┌──────────┐
│Underwriter│  │  Junior  │  │  Senior  │    ERC-4626 vaults
│  Vault    │  │  Vault   │  │  Vault   │    (each can deploy to Aave)
└──────────┘  └──────────┘  └──────────┘
       ▲              ▲            ▲
       │     Payout waterfall order:
       │     1st hit ──► 2nd hit ──► 3rd hit (most protected)
```

## Contracts

| Contract | Description |
|---|---|
| `src/policyManager.sol` | Issues policies (ERC-1155 NFTs), collects premiums, splits across 3 vaults, triggers payouts via waterfall, tracks per-hazard active coverage, syncs vault caps |
| `src/underwriterVault.sol` | ERC-4626 vault with share reservation, Aave yield integration, pausable deposits, configurable fees |
| `src/FeeRateModel.sol` | Computes premium split (Underwriter/Junior/Senior) based on capital ratios and u'_target. Auto-links Junior/Senior caps |
| `src/IUnderwriterVault.sol` | Interface for vault interactions |
| `src/IFeeRateModel.sol` | Interface for pluggable fee models |
| `src/interfaces/IAavePool.sol` | Minimal Aave V3 Pool interface |
| `src/interfaces/IAToken.sol` | Minimal Aave aToken interface |

## Key Features

### Three-Vault Tranche System
- **Underwriter Vault**: First loss position, highest yield
- **Junior Vault**: Mezzanine tranche
- **Senior Vault**: Most protected, lowest yield
- Premium split determined by `FeeRateModel` based on current capital ratios
- Payout waterfall: Underwriter → Junior → Senior

### Aave Yield Integration
- Each vault can deploy up to 90% of idle assets to Aave V3 to earn yield
- Per-vault `aaveTargetBps` set by vault owner (e.g., 7000 = 70%)
- Lazy rebalancing: supply on deposit, withdraw from Aave on payout when needed
- `totalAssets()` = local USDC + aToken balance
- Manual `rebalance()` for owner/keeper
- Kill switch via `aaveEnabled` flag

### Per-Hazard Coverage Accounting
- `activeCoverageByHazard(uint8 hazardId)` tracks active coverage per hazard type
- Automatically updated on policy purchase, payout, and expiry

### Dynamic Vault Caps
- `FeeRateModel.setJuniorCap()` auto-links senior cap to maintain u'_target ratio
- `FeeRateModel.setSeniorCap()` auto-links junior cap
- `setCapsIndependent()` available to bypass linking
- `policyManager.syncVaultCaps()` pushes caps from FeeRateModel to vaults

### Replaceable Fee Model
- Owner can swap `FeeRateModel` without redeploying the entire system
- Formula: `feeSenior = baseSenior + k * (u' - u'_target) / 10000`

## Setup

```bash
# Install Foundry (if not already installed)
curl -L https://foundry.paradigm.xyz | bash
foundryup

# Install dependencies
forge install
```

Copy and configure your environment:
```bash
cp .env.example .env   # then edit .env with your keys and addresses
```

## Scripts

### 1. Deploy contracts

Deploys three vaults, FeeRateModel, and PolicyManager. Saves addresses to `deployments/latest.json`. Uses the existing USDC on-chain (mainnet or Tenderly fork).

```bash
# Step 1: Deploy (requires --slow on Tenderly)
forge script script/Deploy.s.sol:DeployContracts \
  --rpc-url $RPC_URL \
  --broadcast --slow -vvvv

# Step 2: Configure (no --slow needed, all calls are independent)
forge script script/Deploy.s.sol:ConfigureContracts \
  --rpc-url $RPC_URL \
  --broadcast -vvvv
```

> **Note:** `--slow` is only needed for `DeployContracts` because Tenderly processes transactions out of order. `ConfigureContracts` reads deployed addresses from `deployments/latest.json` and all config calls are independent. The same scripts work for both Tenderly fork and mainnet.

After deploying, copy the printed addresses into:
- `script/BuyPolicy.s.sol` (constants at the top)
- `cre_chainlink/parametrix/payout_trigger/config.staging.json` (`policyManagerAddress`)

### 2. Buy a policy (simulate a user)

Before running, update the constants at the top of `script/BuyPolicy.s.sol`:

```solidity
address constant POLICY_MANAGER_ADDRESS = address(0x...); // from deployments/latest.json
address constant ASSET_TOKEN_ADDRESS    = address(0x...); // from deployments/latest.json
```

Then run:

```bash
forge script script/BuyPolicy.s.sol:BuyPolicyScript \
  --rpc-url $TENDERLY_RPC_URL \
  --broadcast \
  -vvvv
```

The script will:
1. Mint mock USDC to the buyer wallet (if `MINT_MOCK_USDC = true`)
2. Approve the PolicyManager to spend the premium
3. Call `buyPolicy()` and print the resulting policy ID and details

### 3. Build & test

```bash
forge build
forge test -vvvv
```

## Environment Variables (`.env`)

### Core

| Variable | Description | Default |
|---|---|---|
| `PRIVATE_KEY` | Deployer wallet private key | required |
| `TENDERLY_RPC_URL` | Tenderly virtual testnet RPC URL | — |
| `MAINNET_RPC_URL` | Ethereum mainnet RPC (production) | — |
| `USER_PRIVATE_KEY` | Policy buyer wallet private key (BuyPolicy script) | — |
| `ETHERSCAN_API_KEY` | For contract verification (mainnet) | — |

### Vault Configuration

| Variable | Description | Default |
|---|---|---|
| `ASSET_TOKEN` | USDC address (mainnet or fork) | required |
| `UW_VAULT_CAP` | Underwriter vault cap | required |
| `JUNIOR_VAULT_CAP` | Junior vault cap | `5,000,000 USDC` |
| `SENIOR_VAULT_CAP` | Senior vault cap | `15,000,000 USDC` |
| `DEPOSIT_FEE_BPS` | Deposit fee in basis points | `50` (0.5%) |
| `FEE_RECIPIENT` | Address receiving deposit fees | deployer |
| `POLICY_URI` | ERC-1155 metadata URI template | `https://api.parametrix.io/policy/{id}` |

### Aave Integration (optional)

| Variable | Description | Default |
|---|---|---|
| `AAVE_POOL` | Aave V3 Pool address (omit to skip Aave setup) | `address(0)` |
| `AAVE_AUSDC` | Aave aUSDC token address | `address(0)` |
| `UW_AAVE_TARGET_BPS` | Underwriter vault Aave target | `7000` (70%) |
| `JR_AAVE_TARGET_BPS` | Junior vault Aave target | `7000` (70%) |
| `SR_AAVE_TARGET_BPS` | Senior vault Aave target | `7000` (70%) |

## Deployment Output

After running Deploy.s.sol, addresses are saved to `deployments/latest.json`:

```json
{
  "asset": "0x...",
  "underwriterVault": "0x...",
  "juniorVault": "0x...",
  "seniorVault": "0x...",
  "feeRateModel": "0x...",
  "policyManager": "0x...",
  "feeRecipient": "0x...",
  "underwriterVaultCap": "...",
  "juniorVaultCap": "...",
  "seniorVaultCap": "...",
  "depositFeeBps": "..."
}
```

## Tests

106 tests across 4 suites:

| Suite | Tests | Coverage |
|---|---|---|
| `test/policyManager.t.sol` | 46 | Policy lifecycle, premium splits, payout waterfall, per-hazard coverage, vault cap sync |
| `test/feeRateModel.t.sol` | 24 | Premium split formula, cap linking, parameter tuning |
| `test/underwriterVault.t.sol` | 23 | ERC-4626 deposits/withdrawals, fees, share reservation, capManager |
| `test/aaveIntegration.t.sol` | 13 | Aave supply/withdraw, rebalance, totalAssets consistency, E2E payout waterfall with Aave |

## Hazard Types

| ID | Name | Trigger Direction | Unit |
|---|---|---|---|
| 0 | Heatwave | Above threshold | °C (wet-bulb temperature) |
| 1 | Flood | Above threshold | m³/s (river discharge) |
| 2 | Drought | Below threshold | mm (water deficit) |

Custom hazard types can be added/removed by the contract owner via `addHazardType()` / `removeHazardType()`.

## Policy Lifecycle

1. **Purchase**: User calls `buyPolicy()` → premium split across 3 vaults, shares reserved
2. **Active**: Policy tracked in `totalActiveCoverage` and `activeCoverageByHazard`
3. **Payout**: Oracle calls `triggerPayout()` → waterfall pays from UW → JR → SR vaults
4. **Expiry**: Anyone calls `releaseExpiredPolicy()` → reserved shares unreserved, coverage removed
