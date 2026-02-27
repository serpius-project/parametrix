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
| `src/policyManager.sol` | Issues policies (ERC-1155 NFTs), collects premiums, splits across 3 vaults, on-chain policy verification (Unverified/Verified/Invalid), triggers payouts via waterfall (verified policies only), tracks per-hazard active coverage, auto-recomputes and syncs vault caps on every purchase |
| `src/underwriterVault.sol` | ERC-4626 vault with share reservation, Aave yield integration, pausable deposits, configurable fees, lockup periods, capManager support |
| `src/FeeRateModel.sol` | Computes premium split (Underwriter/Junior/Senior) based on capital ratios and u'_target. Auto-links Junior/Senior caps. Supports `recomputeCaps()` for auto-recomputation |
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

### Dynamic Vault Caps (Auto-Recompute)
- `FeeRateModel.setJuniorCap()` auto-links senior cap to maintain u'_target ratio
- `FeeRateModel.setSeniorCap()` auto-links junior cap
- `setCapsIndependent()` available to bypass linking
- `recomputeCaps()` recalculates senior cap from current `juniorCapValue` and `uTargetBps`
- **Auto-recompute on every purchase**: `buyPolicy()` calls `_syncVaultCaps()` which triggers `recomputeCaps()` then pushes caps to junior and senior vaults
- `policyManager.syncVaultCaps()` also available for manual cap sync

### Lockup Periods
- Per-vault configurable lockup: `setLockupEnabled(bool)` and `setLockupDuration(uint256)`
- When enabled, depositors cannot withdraw until `lockupDuration` seconds after their last deposit
- Maximum lockup: 365 days
- `maxWithdraw()` and `maxRedeem()` return 0 during lockup

### Aave Yield Integration
- Each vault can deploy up to 90% of idle assets to Aave V3 to earn yield
- Per-vault `aaveTargetBps` set by vault owner (e.g., 7000 = 70%)
- Lazy rebalancing: supply on deposit, withdraw from Aave on payout when needed
- `totalAssets()` = local USDC + aToken balance
- Manual `rebalance()` for owner/keeper
- Kill switch via `aaveEnabled` flag

### Policy Verification (Underwriter)
- Every policy is created as `Unverified` (default status)
- A CRE underwriter workflow validates the premium against the Python API and calls `verifyPolicy(id)` or `rejectPolicy(id)` on-chain
- **PolicyStatus enum**: `Unverified` (0) → `Verified` (1) or `Invalid` (2)
- `triggerPayout()` enforces `status == Verified` — unverified and rejected policies cannot receive payouts
- `rejectPolicy()` unreserves shares and decrements coverage, but premium stays in vaults (no refund = penalty for underpriced policies)
- Only the oracle (CRE DON) can verify or reject policies

### Per-Hazard Coverage Accounting
- `activeCoverageByHazard(uint8 hazardId)` tracks active coverage per hazard type
- Automatically updated on policy purchase, payout, expiry, and rejection

### Replaceable Fee Model
- Owner can swap `FeeRateModel` without redeploying the entire system
- Formula: `feeSenior = baseSenior + k * (u' - u'_target) / 10000`
- Fee split is computed dynamically on each `buyPolicy()` from live vault balances

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

Deploys three vaults, FeeRateModel, and PolicyManager. Saves addresses to `deployments/latest.json`. Uses the existing USDC on-chain (mainnet or Tenderly fork). Senior vault cap is auto-computed from junior cap using the u'_target ratio (default: senior = junior * 3).

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
- `cre_chainlink/parametrix/underwriter/config.staging.json` (`policyManagerAddress`)

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
| `JUNIOR_VAULT_CAP` | Junior vault cap (senior cap auto-computed as junior * 3) | required |
| `DEPOSIT_FEE_BPS` | Deposit fee in basis points | `50` (0.5%) |
| `FEE_RECIPIENT` | Address receiving deposit fees | required |
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
  "seniorVaultCap": "..."
}
```

## Tests

123 tests across 4 suites:

| Suite | Tests | Coverage |
|---|---|---|
| `test/policyManager.t.sol` | 54 | Policy lifecycle, premium splits, payout waterfall, per-hazard coverage, vault cap sync, recomputeCaps, policy verification (verify/reject/enforce) |
| `test/underwriterVault.t.sol` | 32 | ERC-4626 deposits/withdrawals, fees, share reservation, capManager, lockup periods |
| `test/feeRateModel.t.sol` | 24 | Premium split formula, cap linking, parameter tuning, recomputeCaps |
| `test/aaveIntegration.t.sol` | 13 | Aave supply/withdraw, rebalance, totalAssets consistency, E2E payout waterfall with Aave |

## Hazard Types

| ID | Name | Trigger Direction | Unit |
|---|---|---|---|
| 0 | Heatwave | Above threshold | °C (wet-bulb temperature) |
| 1 | Flood | Above threshold | m³/s (river discharge) |
| 2 | Drought | Below threshold | mm (water deficit) |

Custom hazard types can be added/removed by the contract owner via `addHazardType()` / `removeHazardType()`.

## Policy Lifecycle

1. **Purchase**: User calls `buyPolicy()` → caps auto-recomputed, premium split across 3 vaults, shares reserved in waterfall order. Policy status = `Unverified`
2. **Verification**: CRE underwriter workflow calls `/premium` API to validate the premium. If adequate → `verifyPolicy(id)` (status = `Verified`). If underpriced → `rejectPolicy(id)` (status = `Invalid`, shares unreserved, premium kept as penalty)
3. **Active**: Verified policy tracked in `totalActiveCoverage` and `activeCoverageByHazard`
4. **Payout**: Oracle calls `triggerPayout()` (requires `Verified` status) → waterfall pays from UW → JR → SR vaults, pro-rata scaling if underfunded
5. **Expiry**: Anyone calls `releaseExpiredPolicy()` → reserved shares unreserved, coverage removed

## Governance vs Risk Curator Parameters

### Governance (Owner)
- `setOracle()` — who can trigger payouts (CRE DON address)
- `setFeeRateModel()` — swap fee model contract
- `addHazardType()` / `removeHazardType()` — manage insurable perils
- `setPolicyManager()` / `setCapManager()` — vault authorization
- `pause()` / `unpause()` — emergency circuit breaker
- `setAavePool()` / `setAaveEnabled()` — yield integration addresses

### Risk Curator
- `setJuniorCap()` — junior vault cap (senior auto-links)
- Underwriter vault cap via `setCap()` on the vault directly
- `setUTargetBps()` — target junior/(junior+senior) ratio (default 2500 = 25%)
- `setBaseSeniorBps()` — base senior premium share (default 2000 = 20%)
- `setUnderwriterBps()` — fixed underwriter premium share (default 500 = 5%)
- `setKBps()` — fee split adjustment speed (default 5000)
- `setFee()` — deposit fee per vault (max 500 bps)
- `setLockupEnabled()` / `setLockupDuration()` — depositor lockup periods
- `setAaveTargetBps()` — % of vault assets deployed to Aave (max 90%)

### Automatic (no manual action needed)
- Senior cap: auto-computed from `juniorCap * (10000 - uTargetBps) / uTargetBps` on every purchase
- Fee split (junior/senior/underwriter bps): computed dynamically from live vault balances
- Vault cap sync: pushed to vaults automatically on every `buyPolicy()`
- Policy verification: CRE underwriter workflow automatically verifies or rejects policies based on premium adequacy
