# Parametrix

**On-chain, fully automated parametric insurance.**

Parametrix provides parametric insurance for data centers and the lenders financing their infrastructure. Coverage targets natural hazards — heatwaves, floods, and droughts. Payout triggers are defined upfront and enforced on-chain using objective weather data, parsed via a Chainlink CRE workflow that orchestrates the full pipeline from data retrieval to payout execution.

---

## How It Works

1. **Policy purchase** — A user calls `buyPolicy()` on the PolicyManager contract, specifying hazard type, location (lat/lon), trigger threshold, and coverage amount. The premium is split across three tranched vaults (Underwriter, Junior, Senior) according to the FeeRateModel. The policy is minted as an ERC-1155 NFT with status `Unverified`.

2. **Underwriter verification** — A CRE underwriter workflow scans for unverified policies, calls the Python API (`/premium`) to compute the fair premium for the policy's location, hazard, and coverage, and compares it to the on-chain premium paid. If adequate → `verifyPolicy(id)` (status = `Verified`). If underpriced → `rejectPolicy(id)` (status = `Invalid`, shares unreserved, premium kept in vaults as penalty). This prevents anyone from buying $10M coverage for $1 directly on-chain.

3. **Automated monitoring** — A CRE payout trigger workflow runs on a cron schedule (every 2 minutes in staging). It reads verified active policies from the smart contract, including each policy's geographic coordinates, hazard type, and trigger threshold. Unverified and rejected policies are skipped.

4. **Weather data retrieval** — The payout trigger workflow groups active policies by (location, hazard) and fetches weather data from Open-Meteo for each unique group. Each DON node fetches independently, aggregates daily observations to monthly values, and evaluates the trigger condition. Results are verified via DON median consensus. Every policy in a group is evaluated against its own trigger threshold.

5. **Payout execution** — If the trigger condition is met (e.g., temperature exceeds 35°C for a heatwave policy), the CRE workflow submits a `triggerPayout` transaction on-chain (requires `Verified` status). Funds are released via a **waterfall**: Underwriter Vault pays first, then Junior, then Senior (most protected). Pro-rata payouts apply when underfunded. Vaults automatically withdraw from Aave if local USDC is insufficient.

---

## Project Structure

| Directory | Description |
|---|---|
| [`smart-contracts/`](smart-contracts/) | Solidity contracts (Foundry) — three-vault tranche system, policy management, on-chain verification, Aave yield, dynamic caps |
| [`cre_chainlink/`](cre_chainlink/) | Chainlink CRE workflows — underwriter verification and automated payout triggering |
| [`backend-python/`](backend-python/) | Python FastAPI backend — weather data fetching, trigger evaluation, premium calculation |
| [`frontend/`](frontend/) | React web app (Vite) — user interface for buying policies and depositing into vaults |

---

## Chainlink Integration

Parametrix uses two **Chainlink CRE (Chainlink Runtime Environment) workflows** as its orchestration layer. Together they handle the full policy lifecycle: premium verification and automated payout triggering — all decentralized via DON consensus.

### CRE Workflows

| Workflow | Purpose |
|---|---|
| **Underwriter** (`underwriter/`) | Scans for unverified policies, calls the Python API to validate the premium, then calls `verifyPolicy()` or `rejectPolicy()` on-chain. Prevents underpriced policies from receiving payouts. |
| **Payout Trigger** (`payout_trigger/`) | Monitors verified active policies, fetches weather data from Open-Meteo, evaluates trigger conditions, and calls `triggerPayout()` on-chain when conditions are met. |

### Files using Chainlink

| File | Description |
|---|---|
| [`cre_chainlink/parametrix/payout_trigger/main.ts`](cre_chainlink/parametrix/payout_trigger/main.ts) | Payout workflow — cron trigger reads verified policies via `EVMClient.callContract()`, fetches weather data from Open-Meteo via `HTTPClient.sendRequest()` with DON consensus aggregation (`median`), aggregates and evaluates triggers in-workflow, and writes payout transactions via `EVMClient.writeReport()` |
| [`cre_chainlink/parametrix/underwriter/main.ts`](cre_chainlink/parametrix/underwriter/main.ts) | Underwriter workflow — scans unverified policies, calls Python `/premium` API via `HTTPClient.sendRequest()` with DON consensus, compares on-chain premium vs API minimum, writes `verifyPolicy()` or `rejectPolicy()` via `EVMClient.writeReport()` |
| [`cre_chainlink/parametrix/contracts/abi/PolicyManager.ts`](cre_chainlink/parametrix/contracts/abi/PolicyManager.ts) | ABI definition used by both CRE workflows to read policies and submit transactions on-chain |
| [`cre_chainlink/parametrix/project.yaml`](cre_chainlink/parametrix/project.yaml) | CRE project settings — RPC endpoints per deployment target |
| [`cre_chainlink/parametrix/payout_trigger/config.staging.json`](cre_chainlink/parametrix/payout_trigger/config.staging.json) | Payout trigger staging config — cron schedule, lookback months, contract address |
| [`cre_chainlink/parametrix/underwriter/config.staging.json`](cre_chainlink/parametrix/underwriter/config.staging.json) | Underwriter staging config — cron schedule, minimum loading factor, API URL |

### CRE Workflow Capabilities Used

- **CronCapability** — periodic trigger for both workflows (policy verification + payout monitoring)
- **EVMClient.logTrigger** — listens for `PolicyPurchased` events on-chain
- **EVMClient.callContract** — reads policy data and verification status from the smart contract
- **HTTPClient.sendRequest** — fetches weather data (payout trigger) and premium quotes (underwriter) with DON consensus via `ConsensusAggregationByFields` + `median`
- **Runtime.report + EVMClient.writeReport** — generates consensus reports and submits transactions on-chain (`triggerPayout`, `verifyPolicy`, `rejectPolicy`)

---

## Smart Contracts

### Three-Vault Tranche System

```
Policyholder Premium
        |
        v
+------------------+
|  PolicyManager   |  ERC-1155 policy NFTs, premium split, payout waterfall
+--------+---------+
         |  split via FeeRateModel
         v
+----------+  +----------+  +----------+
|Underwriter|  |  Junior  |  |  Senior  |    ERC-4626 vaults (each with Aave yield)
|  Vault    |  |  Vault   |  |  Vault   |
+----------+  +----------+  +----------+
    1st hit       2nd hit       3rd hit (most protected)
```

| Contract | Description |
|---|---|
| [`policyManager.sol`](smart-contracts/src/policyManager.sol) | Issues policies as ERC-1155 NFTs. Splits premiums across 3 vaults via FeeRateModel. On-chain policy verification (Unverified/Verified/Invalid). Executes payouts via waterfall (UW -> JR -> SR, verified only). Tracks per-hazard active coverage. Syncs vault caps from FeeRateModel. |
| [`underwriterVault.sol`](smart-contracts/src/underwriterVault.sol) | ERC-4626 vault with share reservation, Aave V3 yield integration (up to 90%), deposit fees, pausable, and configurable cap. Used for all 3 tranches. |
| [`FeeRateModel.sol`](smart-contracts/src/FeeRateModel.sol) | Computes premium split based on capital ratios and u'_target. Auto-links Junior/Senior caps to maintain ratio. Replaceable by owner without redeploying. |
| [`IUnderwriterVault.sol`](smart-contracts/src/IUnderwriterVault.sol) | Vault interface for cross-contract calls |
| [`IFeeRateModel.sol`](smart-contracts/src/IFeeRateModel.sol) | Fee model interface (pluggable) |
| [`IAavePool.sol`](smart-contracts/src/interfaces/IAavePool.sol) | Minimal Aave V3 Pool interface |
| [`IAToken.sol`](smart-contracts/src/interfaces/IAToken.sol) | Minimal Aave aToken interface |

### Key Features

- **Policy verification**: Policies start as `Unverified`, CRE underwriter validates premium adequacy, rejects underpriced policies (no refund)
- **Payout waterfall**: Underwriter (first loss) -> Junior (mezzanine) -> Senior (most protected), verified policies only
- **Aave yield**: Each vault deploys idle USDC to Aave V3, auto-withdraws on payout
- **Per-hazard coverage**: `activeCoverageByHazard(hazardId)` tracks exposure per hazard type
- **Dynamic caps**: Junior/Senior caps auto-link to maintain u'_target ratio
- **Replaceable fee model**: Owner can swap FeeRateModel without redeploying

---

## Quick Start

### Prerequisites

- [Foundry](https://book.getfoundry.sh/getting-started/installation) (forge, cast)
- [Bun](https://bun.sh/) (for CRE TypeScript workflow)
- Python 3.10+
- [CRE CLI](https://docs.chain.link/cre) (for workflow simulation)

### 1. Deploy contracts

```bash
cd smart-contracts
cp .env.example .env  # configure PRIVATE_KEY, TENDERLY_RPC_URL

# Step 1: Deploy contracts (requires --slow on Tenderly)
forge script script/Deploy.s.sol:DeployContracts \
  --rpc-url $TENDERLY_RPC_URL \
  --broadcast --slow -vvvv

# Step 2: Configure contracts (no --slow needed)
forge script script/Deploy.s.sol:ConfigureContracts \
  --rpc-url $TENDERLY_RPC_URL \
  --broadcast -vvvv
```

Step 1 deploys 3 vaults, FeeRateModel, and PolicyManager using the existing on-chain USDC (saves addresses to `deployments/latest.json`). Step 2 reads those addresses and wires everything: setPolicyManager, capManager, fees, and Aave. The same scripts work for both Tenderly mainnet fork and Ethereum mainnet.

### 2. Buy a test policy

Update the contract addresses in `script/BuyPolicy.s.sol`, then:

```bash
forge script script/BuyPolicy.s.sol:BuyPolicyScript \
  --rpc-url $TENDERLY_RPC_URL \
  --broadcast -vvvv
```

### 3. Run the CRE simulations

```bash
cd cre_chainlink/parametrix

# Install dependencies for both workflows
cd payout_trigger && bun install && cd ..
cd underwriter && bun install && cd ..

# Simulate the underwriter (verifies/rejects policies)
cre workflow simulate ./underwriter
# Select option 1: cron-trigger

# Simulate the payout trigger (monitors weather, triggers payouts)
cre workflow simulate ./payout_trigger
# Select option 1: cron-trigger
```

### Expected output (payout trigger)

```
Workflow compiled
2026-02-17T19:55:04Z [SIMULATION] Simulator Initialized
2026-02-17T19:55:04Z [USER LOG] Running CronTrigger for policy monitoring
2026-02-17T19:55:04Z [USER LOG] Starting policy check...
2026-02-17T19:55:04Z [USER LOG] Next policy ID: 2
2026-02-17T19:55:05Z [USER LOG] Found 1 active policies
2026-02-17T19:55:05Z [USER LOG] Grouped into 1 unique (location, hazard) groups
2026-02-17T19:55:05Z [USER LOG] Processing 1 groups starting at offset 0 of 1 total (cycle 14732)
2026-02-17T19:55:05Z [USER LOG] Fetching weather for group 39.5157,-119.4713,heatwave (1 policies, hazard=heatwave)
2026-02-17T19:55:05Z [USER LOG] Policy 1: triggered=false, value=8.2, threshold=35
Workflow Simulation Result: "Checked 1/1 policies (1 HTTP calls), triggered 0 payouts"
```

The payout trigger reads verified policies from the blockchain, groups them by location and hazard, fetches weather data from Open-Meteo, and evaluates the trigger. In this example, the observed temperature (8.2°C) is below the 35°C heatwave threshold, so no payout is triggered. The underwriter workflow must verify the policy first — unverified policies are skipped by the payout trigger.

---

## Hazard Types

| ID | Name | Trigger Metric | Unit |
|---|---|---|---|
| 0 | Heatwave | Wet-bulb temperature | °C |
| 1 | Flood | River discharge | m³/s |
| 2 | Drought | Water deficit | mm |

Custom hazard types can be added/removed by the contract owner via `addHazardType()` / `removeHazardType()`.

---

## Challenges: Building on CRE

The biggest engineering challenge was designing the CRE workflows to operate within the **per-execution service quotas** — particularly the 5 HTTP calls and 10 EVM reads per execution — while the runtime is completely **stateless** (no persistent storage between runs). Both the underwriter and payout trigger workflows face these same constraints.

### The problem

A parametric insurance system needs to monitor *every* active policy on a regular schedule. Each policy requires reading its verification status and data from the blockchain (2 EVM reads) and fetching weather data for its location (1 HTTP call). With just 6 policies, the naive approach exceeds the 5-call HTTP limit; with 5+ policies, it exceeds the 10-call EVM read limit.

### Our solution

We designed a **quota-aware scheduling algorithm** with three layers, applied consistently across both workflows:

1. **Early status filtering** — Each policy requires 2 EVM reads: `policyStatus(id)` (to skip unverified/rejected policies early) and `policies(id)` (full data). This allows scanning up to 4 policies per cycle within the 10-read budget. The payout trigger skips non-verified policies; the underwriter skips already-verified/rejected ones.

2. **Group by (location, hazard)** — Policies at the same coordinates with the same hazard share one API call. The payout trigger fetches weather data once per group; the underwriter fetches one premium quote per group and scales by coverage for individual policies.

3. **Time-based rotating windows** — Since CRE has no persistent state (`localStorage` is explicitly unavailable in the WASM runtime), we derive a deterministic rotation offset from `Date.now()` divided by the cron interval. Each execution scans a different window of policy IDs and API groups, guaranteeing full coverage across multiple cron cycles.

The rotation offset is computed from the config's cron schedule (parsed at runtime), so it works correctly regardless of whether the cron fires every 30 seconds or every 5 minutes.

4. **On-chain premium verification** — The underwriter workflow validates every policy's premium against the Python API. Underpriced policies are rejected on-chain (`rejectPolicy()`), which unreserves their shares and removes them from active coverage. The payout trigger then skips rejected policies via the `policyStatus` check, reducing the number of policies to monitor and saving quota budget.

See [`cre_chainlink/parametrix/payout_trigger/README.md`](cre_chainlink/parametrix/payout_trigger/README.md#cre-service-quota-management) for the full technical breakdown with code examples.

---

## Tech Stack

- **Smart Contracts**: Solidity, Foundry, OpenZeppelin (ERC-1155, ERC-4626, ERC-20, ReentrancyGuard), Aave V3
- **Automation**: Chainlink CRE SDK (TypeScript), DON consensus aggregation
- **Backend**: Python, FastAPI, Open-Meteo weather API
- **Frontend**: React, Vite, Viem, WalletConnect
- **Testing**: Tenderly virtual testnet (Ethereum mainnet fork), Foundry (123 tests)
