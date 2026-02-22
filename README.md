# Parametrix

**On-chain, fully automated parametric insurance.**

Parametrix provides parametric insurance for data centers and the lenders financing their infrastructure. Coverage targets natural hazards — heatwaves, floods, and droughts. Payout triggers are defined upfront and enforced on-chain using objective weather data, parsed via a Chainlink CRE workflow that orchestrates the full pipeline from data retrieval to payout execution.

---

## How It Works

1. **Policy purchase** — A user calls `buyPolicy()` on the PolicyManager contract, specifying hazard type, location (lat/lon), trigger threshold, and coverage amount. The premium is transferred to the UnderwriterVault. The policy is minted as an ERC-1155 NFT.

2. **Automated monitoring** — A Chainlink CRE workflow runs on a cron schedule (every 2 minutes in staging). It reads all active policies from the smart contract, including each policy's geographic coordinates, hazard type, and trigger threshold.

3. **Weather data retrieval** — The CRE workflow groups active policies by (location, hazard) and fetches weather data from Open-Meteo for each unique group. Each DON node fetches independently, aggregates daily observations to monthly values, and evaluates the trigger condition. Results are verified via DON median consensus. Every policy in a group is evaluated against its own trigger threshold.

4. **Payout execution** — If the trigger condition is met (e.g., temperature exceeds 35°C for a heatwave policy), the CRE workflow submits a `triggerPayout` transaction on-chain. The UnderwriterVault releases funds to the policyholder using a pro-rata model when multiple policies are active.

---

## Project Structure

| Directory | Description |
|---|---|
| [`smart-contracts/`](smart-contracts/) | Solidity contracts (Foundry) — policy management and underwriter vault |
| [`cre_chainlink/`](cre_chainlink/) | Chainlink CRE workflow — automated policy monitoring and payout triggering |
| [`backend-python/`](backend-python/) | Python FastAPI backend — weather data fetching, trigger evaluation, premium calculation |
| [`frontend/`](frontend/) | React web app (Vite) — user interface for buying policies |

---

## Chainlink Integration

Parametrix uses a **Chainlink CRE (Chainlink Runtime Environment) workflow** as its orchestration layer. The workflow integrates the Ethereum blockchain with an external weather API, reading on-chain policy data and triggering payouts based on real-world climate observations.

### Files using Chainlink

| File | Description |
|---|---|
| [`cre_chainlink/parametrix/payout_trigger/main.ts`](cre_chainlink/parametrix/payout_trigger/main.ts) | CRE workflow entry point — cron trigger reads active policies via `EVMClient.callContract()`, fetches weather data from Open-Meteo via `HTTPClient.sendRequest()` with DON consensus aggregation (`median`), aggregates and evaluates triggers in-workflow, and writes payout transactions via `EVMClient.writeReport()` |
| [`cre_chainlink/parametrix/contracts/abi/PolicyManager.ts`](cre_chainlink/parametrix/contracts/abi/PolicyManager.ts) | ABI definition used by the CRE workflow to read policies and trigger payouts on-chain |
| [`cre_chainlink/parametrix/payout_trigger/workflow.yaml`](cre_chainlink/parametrix/payout_trigger/workflow.yaml) | Workflow registration config — defines workflow names and artifact paths for staging/production targets |
| [`cre_chainlink/parametrix/payout_trigger/config.staging.json`](cre_chainlink/parametrix/payout_trigger/config.staging.json) | Staging config — cron schedule, lookback months, PolicyManager contract address, chain selector |
| [`cre_chainlink/parametrix/payout_trigger/config.production.json`](cre_chainlink/parametrix/payout_trigger/config.production.json) | Production config |
| [`cre_chainlink/parametrix/project.yaml`](cre_chainlink/parametrix/project.yaml) | CRE project settings — RPC endpoints per deployment target |
| [`cre_chainlink/parametrix/payout_trigger/package.json`](cre_chainlink/parametrix/payout_trigger/package.json) | Dependencies — includes `@chainlink/cre-sdk` |

### CRE Workflow Capabilities Used

- **CronCapability** — periodic trigger to check all active policies on a schedule
- **EVMClient.logTrigger** — listens for `PolicyPurchased` events on-chain
- **EVMClient.callContract** — reads policy data (hazard, lat/lon, threshold, coverage) from the smart contract
- **HTTPClient.sendRequest** — fetches weather data from Open-Meteo with DON consensus via `ConsensusAggregationByFields` + `median`
- **Runtime.report + EVMClient.writeReport** — generates a consensus report and submits the payout transaction on-chain

---

## Smart Contracts

| Contract | Description |
|---|---|
| [`smart-contracts/src/policyManager.sol`](smart-contracts/src/policyManager.sol) | Issues policies as ERC-1155 NFTs. Stores hazard type, lat/lon, trigger threshold, and coverage per policy. Collects premiums into the vault. Executes payouts via `triggerPayout()` (oracle-restricted). |
| [`smart-contracts/src/underwriterVault.sol`](smart-contracts/src/underwriterVault.sol) | ERC-4626 vault where underwriters deposit USDC as collateral. Handles share-based reserve tracking and pro-rata payouts when vault is underfunded. |

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

forge script script/Deploy.s.sol:DeployScript \
  --rpc-url $TENDERLY_RPC_URL \
  --broadcast --slow -vvvv
```

### 2. Buy a test policy

Update the contract addresses in `script/BuyPolicy.s.sol`, then:

```bash
forge script script/BuyPolicy.s.sol:BuyPolicyScript \
  --rpc-url $TENDERLY_RPC_URL \
  --broadcast -vvvv
```

### 3. Run the CRE simulation

```bash
cd cre_chainlink/parametrix/payout_trigger
bun install

cd ..
cre workflow simulate ./payout_trigger
# Select option 1: cron-trigger
```

### Expected output

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

The workflow reads the policy from the blockchain, groups it by location and hazard, fetches weather data from Open-Meteo, and evaluates the trigger. In this example, the observed temperature (8.2°C) is below the 35°C heatwave threshold, so no payout is triggered.

---

## Hazard Types

| ID | Name | Trigger Metric | Unit |
|---|---|---|---|
| 0 | Heatwave | Wet-bulb temperature | °C |
| 1 | Flood | River discharge | m³/s |
| 2 | Drought | Water deficit | mm |

---

## Challenges: Building on CRE

The biggest engineering challenge was designing the CRE workflow to operate within the **per-execution service quotas** — particularly the 5 HTTP calls and 10 EVM reads per execution — while the runtime is completely **stateless** (no persistent storage between runs).

### The problem

A parametric insurance system needs to monitor *every* active policy on a regular schedule. Each policy requires reading its data from the blockchain (1 EVM read) and fetching weather data for its location (1 HTTP call). With just 6 policies, the naive approach exceeds the 5-call HTTP limit; with 10+ policies, it exceeds the 10-call EVM read limit.

### Our solution

We designed a **quota-aware scheduling algorithm** with three layers:

1. **Eliminate redundant reads** — Removed the `holderOf()` contract call (not needed for trigger evaluation), cutting EVM reads from 2 per policy to 1. This allows scanning up to 9 policies per cycle within the 10-read budget.

2. **Group by (location, hazard)** — Policies at the same coordinates with the same hazard share one weather fetch. The observed value is then evaluated against each policy's individual threshold locally, with zero extra API calls.

3. **Time-based rotating windows** — Since CRE has no persistent state (`localStorage` is explicitly unavailable in the WASM runtime), we derive a deterministic rotation offset from `Date.now()` divided by the cron interval. Each execution scans a different window of policy IDs and weather groups, guaranteeing full coverage across multiple cron cycles.

The rotation offset is computed from the config's cron schedule (parsed at runtime), so it works correctly regardless of whether the cron fires every 30 seconds or every 5 minutes.

4. **Minimum premium enforcement** — A 10 USDC minimum premium is enforced on the frontend to economically discourage micro-policies. Fewer total policies means less pressure on the per-execution EVM read and HTTP call budgets, giving the rotation algorithm more headroom.

See [`cre_chainlink/parametrix/payout_trigger/README.md`](cre_chainlink/parametrix/payout_trigger/README.md#cre-service-quota-management) for the full technical breakdown with code examples.

---

## Tech Stack

- **Smart Contracts**: Solidity, Foundry, OpenZeppelin (ERC-1155, ERC-4626, ERC-20)
- **Automation**: Chainlink CRE SDK (TypeScript), DON consensus aggregation
- **Backend**: Python, FastAPI, Open-Meteo weather API
- **Frontend**: React, Vite
- **Testing**: Tenderly virtual testnet (Ethereum mainnet fork)
