# Parametrix — CRE Payout Trigger Workflow

Automated parametric insurance payout trigger built on the **Chainlink Runtime Environment (CRE)**. The workflow monitors on-chain insurance policies, fetches real-world weather data directly from **Open-Meteo** (free, public, no-auth) with DON consensus, and triggers payouts when conditions are met — fully autonomous, no centralized backend dependency.

## Architecture

```
┌──────────────────────────────────────────────────────────────┐
│                  CHAINLINK CRE WORKFLOW                      │
│                                                              │
│  ┌──────────────┐        ┌──────────────┐                   │
│  │  Log Trigger │        │ Cron Trigger │                   │
│  │ (new policy  │        │ (every N min)│                   │
│  │  purchased)  │        │              │                   │
│  └──────┬───────┘        └──────┬───────┘                   │
│         └────────┬──────────────┘                            │
│                  ▼                                           │
│       ┌─────────────────────┐                               │
│       │ Read Active Policies│◄─── PolicyManager (on-chain)  │
│       └─────────┬───────────┘                               │
│                 ▼                                            │
│       ┌─────────────────────┐     Open-Meteo APIs:          │
│       │ GET weather data    │◄─── archive-api (heatwave)    │
│       │ (DON consensus via  │     flood-api (flood)         │
│       │  median aggregation)│     archive-api (drought)     │
│       └─────────┬───────────┘                               │
│                 ▼                                            │
│       ┌─────────────────────┐                               │
│       │ Aggregate & evaluate│                               │
│       │ Monthly max/mean/   │                               │
│       │ Thornthwaite PET    │                               │
│       └─────────┬───────────┘                               │
│                 ▼                                            │
│       ┌─────────────────────┐                               │
│       │ If triggered →      │                               │
│       │ triggerPayout()     │──── PolicyManager (on-chain)   │
│       └─────────────────────┘                               │
└──────────────────────────────────────────────────────────────┘
                          │
                          ▼
              ┌───────────────────────┐
              │  UnderwriterVault     │
              │  Burns reserved shares│
              │  Transfers USDC to    │
              │  policyholder         │
              └───────────────────────┘
```

## How It Works

### 1. Policy Purchase
A user buys a parametric insurance policy via the frontend or directly on-chain. The `PolicyManager` contract emits a `PolicyPurchased` event, which the CRE Log Trigger detects.

### 2. Continuous Monitoring (Cron)
On a configurable cron schedule, the workflow:
1. Reads all policies from `PolicyManager` (iterates `1..nextId`)
2. Filters to **active** policies (not paid out, not expired)
3. For each active policy, fetches weather data directly from Open-Meteo
4. Aggregates daily data to monthly values (max, mean, or Thornthwaite PET deficit)
5. DON nodes each call Open-Meteo independently; results are aggregated via **median consensus**
6. If the trigger condition is met → calls `triggerPayout()` on-chain

### 3. Payout Execution
When a policy is triggered:
- The CRE workflow generates a consensus report signed by the DON
- Submits `triggerPayout(policyId, observedValue, payoutAmount)` to `PolicyManager`
- The contract validates the call (only the authorized oracle can trigger), calculates the actual payout based on reserved vault shares, and transfers USDC to the policyholder
- Emits `PayoutTriggered` event

## Supported Hazards

| Hazard ID | Type | Open-Meteo Endpoint | Variable | Aggregation | Trigger |
|-----------|------|---------------------|----------|-------------|---------|
| 0 | **Heatwave** | `archive-api.open-meteo.com` | `wet_bulb_temperature_2m_max` | Monthly max | value > threshold |
| 1 | **Flood** | `flood-api.open-meteo.com` | `river_discharge` | Monthly max | value > threshold |
| 2 | **Drought** | `archive-api.open-meteo.com` | `temperature_2m_mean` + `precipitation_sum` | Thornthwaite PET deficit | value < threshold |

Each policy stores its own `lat`, `lon` (as `int32 × 10000`), and `triggerThreshold`. The workflow fetches historical weather data from Open-Meteo for the exact coordinates.

### Thornthwaite PET (Drought)
For drought evaluation, the workflow computes a water deficit using the Thornthwaite method:
1. Aggregate daily temperature (mean) and precipitation (sum) to monthly values
2. Compute monthly heat index: `I = (max(T, 0) / 5)^1.514`
3. Compute annual heat index via 12-month rolling sum
4. Compute PET: `16 * (10T / I_annual)^a` where `a` is a polynomial of `I_annual`
5. Water deficit: `D = precipitation - PET` (negative values indicate drought)

## Project Structure

```
payout_trigger/
├── main.ts                  # CRE workflow (triggers, weather fetching, payout logic)
├── config.staging.json      # Staging config (Tenderly virtual testnet)
├── config.production.json   # Production config template
├── package.json             # Dependencies (@chainlink/cre-sdk, viem, zod)
└── README.md                # This file

../contracts/abi/
├── PolicyManager.ts         # PolicyManager ABI (events + functions)
└── index.ts                 # ABI exports

../project.yaml              # CRE project settings (RPC endpoints, workflow paths)
```

## Key Files

### `main.ts` — Workflow Logic

- **`initWorkflow(config)`** — Registers two triggers:
  - `CronCapability` with configurable schedule
  - `EVMClient.logTrigger` for `PolicyPurchased` events
- **`getActivePolicies(runtime)`** — Reads all policies from chain, filters active ones
- **`createWeatherFetcher(policy)`** — Creates an HTTP callback for DON consensus that calls Open-Meteo directly, aggregates daily→monthly data, and evaluates the trigger condition
- **`aggregateMonthly(dates, values, method)`** — Groups daily values by month, applies max or mean
- **`computeThornthwaiteDeficit(dates, temps, precips)`** — Computes monthly water deficit for drought
- **`evaluateTrigger(value, threshold, hazard)`** — Threshold comparison per hazard type
- **`triggerPayout(runtime, policyId, observedValue, payoutAmount)`** — Encodes `triggerPayout` calldata, generates a DON consensus report, and submits the transaction via `writeReport`

### `config.staging.json`

```json
{
  "schedule": "*/2 * * * *",
  "lookbackMonths": 3,
  "evms": [{
    "policyManagerAddress": "0x4b0aF97a249Dbf50203C7Cadb8Ee628DC767F09f",
    "chainSelectorName": "ethereum-testnet-sepolia",
    "gasLimit": "1000000"
  }]
}
```

## Prerequisites

- **Bun** — [bun.com/docs/installation](https://bun.com/docs/installation)
- **Chainlink CRE CLI** — `npm install -g @chainlink/cre-cli`
- **Deployed PolicyManager** — See `smart-contracts/` for deployment scripts

No external API keys or backend services required — the workflow calls Open-Meteo directly (free, public API).

## Setup & Simulation

### 1. Install Dependencies

```bash
cd payout_trigger && bun install
```

### 2. Configure Environment

Create a `.env` file with your private key (needed for chain write simulation):

```
CRE_ETH_PRIVATE_KEY=<your_private_key>
```

### 3. Configure RPC

In `project.yaml`, set the RPC URL for your target chain under `staging-settings.rpcs`:

```yaml
staging-settings:
  rpcs:
    - chain-name: ethereum-testnet-sepolia
      url: <your_rpc_url>
```

### 4. Simulate the Workflow

```bash
cre workflow simulate ./payout_trigger
```

Select trigger type:
- **Option 1 (Cron)**: Immediately checks all active policies
- **Option 2 (Log)**: Provide a `PolicyPurchased` transaction hash and event index

Example simulation output:

```
Starting policy check...
Next policy ID: 3
Found 2 active policies
Checking policy 1: hazard=heatwave, location=(39.5, -119.8), threshold=35
Policy 1: triggered=false, value=8.2, threshold=35
Checking policy 2: hazard=heatwave, location=(39.5, -119.8), threshold=35
Policy 2: triggered=true, value=42.1, threshold=35
Policy 2 TRIGGERED! Observed 42.1 (threshold: 35). Initiating payout...
Payout triggered successfully at txHash: 0x...
Checked 2 policies, triggered 1 payouts
```

> **Note**: `cre workflow simulate` runs the workflow logic locally but does NOT submit actual on-chain transactions (you'll see "Skipping WorkflowEngineV2"). To execute real payouts, deploy to a Chainlink DON.

### 5. Deploy to DON

```bash
cre workflow deploy --config workflow.yaml --target staging-settings
```

After deployment, set the DON address as the oracle in the PolicyManager contract:

```bash
cast send <POLICY_MANAGER> "setOracle(address)" <DON_ADDRESS> \
  --rpc-url <RPC_URL> --private-key <PRIVATE_KEY>
```

## Smart Contract Events

The `PolicyManager` contract emits these events for CRE monitoring:

```solidity
event PolicyPurchased(
    uint256 indexed policyId,
    address indexed holder,
    Hazard hazard,
    uint256 start, uint256 end,
    uint256 maxCoverage, uint256 triggerThreshold
);

event PayoutTriggered(
    uint256 indexed policyId,
    address indexed holder,
    uint256 observedValue,
    uint256 requestedPayout, uint256 actualPayout
);

event PolicyExpiredReleased(
    uint256 indexed policyId,
    uint256 sharesReleased
);
```

## CRE SDK Capabilities Used

| Capability | Usage |
|------------|-------|
| `CronCapability` | Periodic policy monitoring on configurable schedule |
| `EVMClient.logTrigger` | React to `PolicyPurchased` events in real-time |
| `EVMClient.callContract` | Read policy data from chain (`policies()`, `holderOf()`, `nextId()`) |
| `HTTPClient.sendRequest` | Fetch weather data from Open-Meteo with DON consensus via median |
| `EVMClient.writeReport` | Submit `triggerPayout()` transaction with DON-signed report |
| `runtime.report()` | Generate consensus report for on-chain verification |

## Security

- **No centralized dependency**: Weather data fetched directly from Open-Meteo (public API) — each DON node verifies independently
- **Oracle authorization**: Only the DON address (set via `setOracle()`) can call `triggerPayout()`
- **DON consensus**: Weather data aggregated via median across multiple nodes — no single point of failure
- **Share reservation**: Each policy's coverage is backed by reserved vault shares at purchase time
- **Dynamic payout**: If the vault is underfunded, the contract pays out proportionally based on available share value

## Resources

- [Chainlink CRE Documentation](https://docs.chain.link/cre)
- [CRE Service Quotas](https://docs.chain.link/cre/service-quotas)
- [Chain Selector Names](https://github.com/smartcontractkit/chain-selectors/blob/main/selectors.yml)
- [Open-Meteo API Documentation](https://open-meteo.com/en/docs)
