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
              │  Payout Waterfall     │
              │  UW Vault → JR Vault  │
              │  → SR Vault           │
              │  (withdraws from Aave │
              │   if needed)          │
              │  Transfers USDC to    │
              │  policyholder         │
              └───────────────────────┘
```

## How It Works

### 1. Policy Purchase
A user buys a parametric insurance policy via the frontend or directly on-chain. The `PolicyManager` contract emits a `PolicyPurchased` event, which the CRE Log Trigger detects.

### 2. Continuous Monitoring (Cron)
On a configurable cron schedule, the workflow:
1. Reads `nextId` from `PolicyManager` to discover how many policies exist (1 EVM read)
2. Scans a **rotating window** of policy IDs (up to 4 per cycle, 2 reads per policy: `policyStatus` + `policies`)
3. Filters to **verified** policies only (status = `Verified`), then checks active (not paid out, not expired)
4. Groups active policies by **(lat, lon, hazard)** — policies at the same location and hazard type share one weather fetch
5. Fetches weather data for up to **5 groups** per cycle (respecting the 5 HTTP call quota), rotating through remaining groups on subsequent cycles
6. Aggregates daily data to monthly values (max, mean, or Thornthwaite PET deficit)
7. DON nodes each call Open-Meteo independently; results are aggregated via **median consensus**
8. Evaluates every policy in each group against its own trigger threshold
9. If the trigger condition is met → calls `triggerPayout()` on-chain

### 3. Payout Execution
When a policy is triggered:
- The CRE workflow generates a consensus report signed by the DON
- Submits `triggerPayout(policyId, observedValue, payoutAmount)` to `PolicyManager`
- The contract validates the call (only the authorized oracle can trigger) and executes the **payout waterfall**: Underwriter Vault pays first, then Junior, then Senior (most protected). If local USDC is insufficient, vaults automatically withdraw from Aave V3
- Pro-rata payouts apply when vaults are underfunded
- Updates `activeCoverageByHazard` accounting
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

../underwriter/              # CRE underwriter verification workflow (verifies/rejects policies)
├── main.ts                  # Verification logic (premium check via Python API)
├── config.staging.json      # Staging config
└── ...

../contracts/abi/
├── PolicyManager.ts         # PolicyManager ABI (events + functions + verification)
└── index.ts                 # ABI exports

../project.yaml              # CRE project settings (RPC endpoints, workflow paths)
```

## Key Files

### `main.ts` — Workflow Logic

- **`initWorkflow(config)`** — Registers two triggers:
  - `CronCapability` with configurable schedule
  - `EVMClient.logTrigger` for `PolicyPurchased` events
- **`getActivePolicies(runtime)`** — Reads all policies from chain, filters to verified and active ones (checks `policyStatus` before reading full policy data)
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
    "policyManagerAddress": "0xE3E1b5A56d11376D27c0efF3256E7299dF197d5E",
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
Grouped into 1 unique (location, hazard) groups
Processing 1 groups starting at offset 0 of 1 total (cycle 14732)
Fetching weather for group 39.5,-119.8,heatwave (2 policies, hazard=heatwave)
Policy 1: triggered=false, value=8.2, threshold=35
Policy 2: triggered=true, value=42.1, threshold=35
Policy 2 TRIGGERED! Observed 42.1 (threshold: 35). Initiating payout...
Payout triggered successfully at txHash: 0x...
Checked 2/2 policies (1 HTTP calls), triggered 1 payouts
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

event PolicyVerified(uint256 indexed policyId);
event PolicyRejected(uint256 indexed policyId);
```

## CRE Service Quota Management

The biggest engineering challenge we faced building on CRE was working within the **per-execution service quotas**. CRE enforces strict resource limits on every workflow execution — and unlike a traditional backend, the runtime is **stateless** (no `localStorage`, no persistent variables between executions). This meant we couldn't simply "remember where we left off" and had to design a purely time-based rotation strategy.

### The quotas that constrain us

| Quota | Limit | What consumes it |
|-------|-------|------------------|
| **EVM reads** (`ChainRead.CallLimit`) | 10 per execution | 1 for `nextId()` + 2 per policy scanned (`policyStatus(id)` + `policies(id)`) |
| **HTTP calls** (`HTTPAction.CallLimit`) | 5 per execution | 1 per unique (location, hazard) weather fetch from Open-Meteo |
| **Execution timeout** | 5 minutes | End-to-end, including all contract reads, HTTP calls, and writes |

### The problem

A naive implementation makes **1 HTTP call per active policy**. With 6 policies we hit the 5-call limit. Worse, reading policy data from the contract costs **2 EVM reads per policy** (verification status + policy data) — with 5+ policies we'd blow the 10-read quota before even checking the weather.

### Our solution: grouping + rotating windows

We apply three optimizations that work together:

1. **Early status filtering** — Each policy requires 2 reads: `policyStatus(id)` (to skip unverified/rejected policies early) and `policies(id)` (for the full data). This allows scanning up to **4 policies per cycle**. Unverified policies are skipped before the more expensive policy data read, avoiding wasted quota on policies that would revert on `triggerPayout()`.

2. **Group policies by (lat, lon, hazard)** — Multiple policies at the same location with the same hazard type share identical weather data. One Open-Meteo fetch serves the entire group; each policy is then evaluated against its own trigger threshold locally.

3. **Time-based rotating windows** — Since CRE is stateless, we derive a rotation offset from `Date.now()` divided by the cron interval (parsed from the config schedule). This gives each execution a different "window" into both the policy ID space and the HTTP group space:

4. **On-chain premium verification** — The companion `underwriter` CRE workflow validates every policy's premium against the Python API. Underpriced policies are rejected on-chain (`rejectPolicy()`), and this workflow skips them via the `policyStatus` check, reducing the number of active policies to monitor and saving EVM read and HTTP call budgets.

```
EVM read window:  cycleIndex = floor(now / cronInterval)
                  windowIndex = cycleIndex % ceil(totalPolicies / 4)
                  scan policies [windowIndex*4 + 1 .. windowIndex*4 + 4]

HTTP call window: offset = (cycleIndex % ceil(totalGroups / 5)) * 5
                  fetch groups [offset .. offset+5]
```

With a 2-minute cron, all policies are checked within `ceil(N/4) * 2` minutes, and all weather groups within `ceil(G/5) * 2` minutes. For 20 policies across 8 locations, full coverage takes ~10 minutes (5 cron cycles).

### Why this was challenging

- **No persistent state**: We can't store "last processed index" between runs. The rotation must be deterministic and derived purely from the current timestamp.
- **Quotas interact**: EVM reads limit how many policies we discover, HTTP calls limit how many we can check, and both rotate independently. The workflow must stay within *all* limits simultaneously.
- **DON consensus adds constraints**: Each HTTP call runs on every DON node independently. We can't batch multiple locations into one API call because the consensus aggregation (`median`) operates per-call.
- **Cron interval matters**: A `*/2` schedule means the `cycleIndex` only increments on even minutes. The rotation logic must account for the actual cron interval to avoid always landing on the same window.

## CRE SDK Capabilities Used

| Capability | Usage |
|------------|-------|
| `CronCapability` | Periodic policy monitoring on configurable schedule |
| `EVMClient.logTrigger` | React to `PolicyPurchased` events in real-time |
| `EVMClient.callContract` | Read policy data from chain (`nextId()`, `policyStatus()`, `policies()`) — budget: 10 per execution |
| `HTTPClient.sendRequest` | Fetch weather data from Open-Meteo with DON consensus via median — budget: 5 per execution |
| `EVMClient.writeReport` | Submit `triggerPayout()` transaction with DON-signed report |
| `runtime.report()` | Generate consensus report for on-chain verification |

## Security

- **No centralized dependency**: Weather data fetched directly from Open-Meteo (public API) — each DON node verifies independently
- **Policy verification**: Only `Verified` policies are processed — unverified and rejected policies are skipped, preventing wasted gas on calls that would revert. The companion `underwriter` workflow handles verification
- **Oracle authorization**: Only the DON address (set via `setOracle()`) can call `triggerPayout()`, `verifyPolicy()`, and `rejectPolicy()`
- **DON consensus**: Weather data aggregated via median across multiple nodes — no single point of failure
- **Three-vault waterfall**: Payouts cascade Underwriter -> Junior -> Senior, isolating risk by tranche
- **Share reservation**: Each policy's coverage is backed by reserved shares across all 3 vaults at purchase time
- **Aave liquidity**: Vaults auto-withdraw from Aave V3 if local USDC is insufficient for payout
- **Dynamic payout**: If vaults are underfunded, the contract pays out proportionally based on available share value

## Resources

- [Chainlink CRE Documentation](https://docs.chain.link/cre)
- [CRE Service Quotas](https://docs.chain.link/cre/service-quotas)
- [Chain Selector Names](https://github.com/smartcontractkit/chain-selectors/blob/main/selectors.yml)
- [Open-Meteo API Documentation](https://open-meteo.com/en/docs)
