# Parametrix — CRE Underwriter Verification Workflow

Automated policy verification workflow built on the **Chainlink Runtime Environment (CRE)**. When a user purchases a policy on-chain, this workflow validates the premium against the Python pricing API and verifies or rejects the policy — ensuring the protocol can't be exploited by submitting underpriced policies directly to the contract.

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
│       │ Read Unverified     │◄─── PolicyManager (on-chain)  │
│       │ Policies            │     policyStatus() + policies()│
│       └─────────┬───────────┘                               │
│                 ▼                                            │
│       ┌─────────────────────┐     Python Pricing API:       │
│       │ POST /premium       │◄─── POST { lat, lon, hazard,  │
│       │ (DON consensus via  │      threshold, n_months,     │
│       │  median aggregation)│      payout, loading_factor } │
│       └─────────┬───────────┘                               │
│                 ▼                                            │
│       ┌─────────────────────┐                               │
│       │ Compare on-chain    │                               │
│       │ premium vs API      │                               │
│       │ minimum premium     │                               │
│       └─────────┬───────────┘                               │
│                 ▼                                            │
│       ┌─────────────────────┐                               │
│       │ If premium >= min → │                               │
│       │   verifyPolicy()    │──── PolicyManager (on-chain)  │
│       │ If premium < min →  │                               │
│       │   rejectPolicy()    │──── PolicyManager (on-chain)  │
│       └─────────────────────┘                               │
└──────────────────────────────────────────────────────────────┘
```

## How It Works

### 1. Policy Purchase
Anyone can call `buyPolicy()` on `PolicyManager`. The policy is created with status `Unverified` (default enum value 0). The contract emits a `PolicyPurchased` event.

### 2. Continuous Verification (Cron)
On a configurable cron schedule, the workflow:
1. Reads `nextId` from `PolicyManager` to discover total policies (1 EVM read)
2. Scans a **rotating window** of policy IDs (up to 4 per cycle, 2 reads per policy: `policyStatus` + `policies`)
3. Filters to **unverified** policies only (status = `Unverified`)
4. Groups unverified policies by **(lat, lon, hazard)** — same location+hazard share one API call
5. Calls the Python `/premium` API for up to **5 groups** per cycle (DON consensus via median)
6. Compares each policy's on-chain premium against the API-computed minimum
7. If `on-chain premium >= API minimum` → calls `verifyPolicy(id)` on-chain
8. If `on-chain premium < API minimum` → calls `rejectPolicy(id)` on-chain

### 3. Verification Outcome

**Verified policies** (status = `Verified`):
- Can trigger payouts via the companion payout_trigger workflow
- Counted as active coverage in protocol health

**Rejected policies** (status = `Invalid`):
- `rejectPolicy()` unreserves shares across all 3 vaults
- Decrements `totalActiveCoverage` and `activeCoverageByHazard`
- Premium stays in vaults (no refund — acts as a penalty for underpricing)
- Cannot trigger payouts (`triggerPayout()` reverts with "not verified")

### 4. Log Trigger
When a `PolicyPurchased` event is detected, the workflow logs the new policy ID. Actual verification is handled by the cron job on the next cycle.

## Premium Comparison Logic

The workflow converts between on-chain raw token units and API USDC values:

1. **API input**: `payout` is `maxCoverage / 1e6` (USDC float), along with `lat`, `lon`, `hazard`, `threshold`, `n_months`, `loading_factor`
2. **API output**: `premium_usdc` (float) — the minimum acceptable premium
3. **Conversion**: `minimumPremiumRaw = floor(premium_usdc * 1e6)` (back to raw 6-decimal units)
4. **Coverage adjustment**: If a policy in the group has different coverage than the representative, the minimum is scaled linearly: `adjustedMinimum = minimumPremiumRaw * policy.maxCoverage / representative.maxCoverage`
5. **Decision**: `policy.premium >= adjustedMinimum` → verify, otherwise reject

## Project Structure

```
underwriter/
├── main.ts                  # CRE workflow (verification logic)
├── config.staging.json      # Staging config (localhost API, Tenderly testnet)
├── config.production.json   # Production config (api.parametrix.io)
├── workflow.yaml            # CRE workflow settings (staging + production)
├── package.json             # Dependencies (@chainlink/cre-sdk, viem, zod)
├── tsconfig.json            # TypeScript config
└── README.md                # This file

../payout_trigger/           # Companion workflow (weather monitoring + payout)
├── main.ts                  # Payout logic (only processes Verified policies)
└── ...

../contracts/abi/
├── PolicyManager.ts         # Shared ABI (events + functions + verification)
└── index.ts                 # ABI exports
```

## Key Files

### `main.ts` — Workflow Logic

- **`getUnverifiedPolicies(runtime)`** — Reads policies from chain with a rotating scan window, filters to unverified status. Budget: 1 read for `nextId` + 2 reads per policy
- **`createPremiumFetcher(representative)`** — Creates an HTTP callback for DON consensus that calls `POST /premium` on the Python API
- **`submitVerification(runtime, policyId, action)`** — Generates a DON consensus report and submits `verifyPolicy()` or `rejectPolicy()` via `writeReport`
- **`verifyPolicies(runtime)`** — Main orchestration: groups policies, rotates HTTP window, evaluates premiums, submits decisions
- **`onCronTrigger`** — Entry point for scheduled runs
- **`onLogTrigger`** — Entry point for `PolicyPurchased` events (logs only)

### `config.staging.json`

```json
{
  "schedule": "*/2 * * * *",
  "minLoadingFactor": 0.10,
  "evms": [{
    "policyManagerAddress": "0xEfC0E3ff32A6e71D7661062E9F444D919F4b17e4",
    "chainSelectorName": "ethereum-testnet-sepolia",
    "gasLimit": "1000000"
  }],
  "apiUrl": "http://localhost:2082"
}
```

- `schedule` — Cron expression for verification frequency
- `minLoadingFactor` — Minimum loading factor passed to the API (e.g. 0.10 = 10%)
- `apiUrl` — Python pricing API base URL (staging: localhost, production: api.parametrix.io)

## Prerequisites

- **Bun** — [bun.com/docs/installation](https://bun.com/docs/installation)
- **Chainlink CRE CLI** — `npm install -g @chainlink/cre-cli`
- **Deployed PolicyManager** — See `smart-contracts/` for deployment scripts
- **Python API running** — The `/premium` endpoint must be accessible at the configured `apiUrl`

## Setup & Simulation

### 1. Install Dependencies

```bash
cd underwriter && bun install
```

The `postinstall` hook runs `bun x cre-setup` to generate the CRE compile script.

### 2. Configure Environment

Create a `.env` file with your private key:

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

### 4. Start the Python API

```bash
cd api && python main.py
```

The API must be running at the URL configured in `config.staging.json` (default: `http://localhost:8000`).

### 5. Simulate the Workflow

```bash
cre workflow simulate ./underwriter
```

Select trigger type:
- **Option 1 (Cron)**: Scans for unverified policies and processes them
- **Option 2 (Log)**: Provide a `PolicyPurchased` transaction hash and event index

Example simulation output:

```
Starting underwriter verification...
Next policy ID: 4
Scanning policy IDs 1..4 (window 1/1, 4 max per cycle)
Policy 1: status=1, skipping (not unverified)
Found 2 unverified policies
Grouped into 1 unique (location, hazard) groups
Processing 1 groups starting at offset 0 of 1 total (cycle 14732)
Fetching premium for group 39.5,-119.8,heatwave (2 policies, hazard=heatwave)
Group 39.5,-119.8,heatwave: API minimum premium = 281.47 USDC (281470000 raw)
Policy 2: onChainPremium=300000000, minimumRequired=281470000
Submitting verifyPolicy for policy 2
verifyPolicy succeeded at txHash: 0x...
Policy 3: onChainPremium=100000000, minimumRequired=281470000
Policy 3 REJECTED: premium 100000000 < minimum 281470000
Submitting rejectPolicy for policy 3
rejectPolicy succeeded at txHash: 0x...
Verified 1, rejected 1 out of 2 unverified policies (1 HTTP calls)
```

### 6. Deploy to DON

```bash
cre workflow deploy --config workflow.yaml --target staging-settings
```

After deployment, set the DON address as the oracle in the PolicyManager contract:

```bash
cast send <POLICY_MANAGER> "setOracle(address)" <DON_ADDRESS> \
  --rpc-url <RPC_URL> --private-key <PRIVATE_KEY>
```

## CRE Service Quota Management

This workflow shares the same quota constraints and rotation strategy as the payout_trigger workflow. See the [payout_trigger README](../payout_trigger/README.md#cre-service-quota-management) for a detailed explanation.

### Budget per execution

| Resource | Budget | Breakdown |
|----------|--------|-----------|
| **EVM reads** | 10 total | 1 for `nextId()` + 2 per policy (`policyStatus` + `policies`) = **4 policies/cycle** |
| **HTTP calls** | 5 total | 1 per unique (lat, lon, hazard) group = **5 groups/cycle** |
| **EVM writes** | 1 per verification | Each `verifyPolicy`/`rejectPolicy` requires a DON consensus report |

### Rotation strategy

- **EVM read window**: Scans 4 policy IDs per cycle, rotating based on `cycleIndex = floor(now / cronInterval)`
- **HTTP call window**: Processes 5 location groups per cycle, with wrap-around for the last window
- With a 2-minute cron, all policies are scanned within `ceil(N/4) * 2` minutes

## CRE SDK Capabilities Used

| Capability | Usage |
|------------|-------|
| `CronCapability` | Periodic verification on configurable schedule |
| `EVMClient.logTrigger` | React to `PolicyPurchased` events |
| `EVMClient.callContract` | Read policy data (`nextId()`, `policyStatus()`, `policies()`) |
| `HTTPClient.sendRequest` | Call Python `/premium` API with DON consensus via median |
| `EVMClient.writeReport` | Submit `verifyPolicy()` / `rejectPolicy()` with DON-signed report |
| `runtime.report()` | Generate consensus report for on-chain verification |

## Security

- **Permissionless policy creation**: Anyone can buy a policy, but underpriced ones are automatically rejected
- **Oracle authorization**: Only the DON address (set via `setOracle()`) can call `verifyPolicy()` and `rejectPolicy()`
- **DON consensus**: Premium API results aggregated via median across multiple nodes
- **No refund on rejection**: Rejected policies lose their premium (stays in vaults as penalty), discouraging spam
- **Share unreservation**: Rejected policies' reserved shares are released back to vaults
- **Coverage adjustment**: Scales minimum premium linearly for policies with different coverage in the same group

## Relationship with Payout Trigger

The two CRE workflows work together:

1. **Underwriter** (this workflow): Verifies new policies → sets status to `Verified` or `Invalid`
2. **Payout Trigger**: Monitors weather → triggers payouts **only** for `Verified` policies

The payout trigger reads `policyStatus` before processing each policy and skips any that aren't `Verified`, preventing wasted HTTP calls on weather data for policies that would revert on `triggerPayout()`.

## Resources

- [Chainlink CRE Documentation](https://docs.chain.link/cre)
- [CRE Service Quotas](https://docs.chain.link/cre/service-quotas)
- [Chain Selector Names](https://github.com/smartcontractkit/chain-selectors/blob/main/selectors.yml)
