# Parametrix CRE Payout Trigger - Setup Guide

This Chainlink Runtime Environment (CRE) workflow automates parametric insurance policy monitoring and payout triggers based on real-world weather data.

## Overview

The CRE workflow performs the following tasks:
1. **Monitors PolicyPurchased events** - Listens for new policies created on-chain
2. **Periodically checks active policies** - Runs on a cron schedule (configurable)
3. **Fetches weather data** - Pulls temperature/precipitation data from external APIs with DON consensus
4. **Triggers payouts** - Automatically calls `triggerPayout()` when policy conditions are met

## Architecture

```
┌─────────────────┐       ┌──────────────────┐
│  PolicyManager  │◄──────┤  CRE Workflow    │
│  (On-chain)     │       │  (Off-chain DON) │
└─────────────────┘       └──────────────────┘
        │                          │
        │ PolicyPurchased          │
        │ Events                   │
        ▼                          ▼
  Active Policies          Weather APIs
                          (with consensus)
```

## Prerequisites

1. **Deployed PolicyManager contract** - See `smart-contracts/script/DEPLOYMENT.md`
2. **Weather API access** - OpenWeatherMap or similar (free tier works for testing)
3. **Chainlink CRE CLI** - Install: `npm install -g @chainlink/cre-cli`
4. **DON access** - Register your workflow with a Chainlink DON

## Smart Contract Updates

The PolicyManager contract has been enhanced with events for CRE monitoring:

### New Events

```solidity
event PolicyPurchased(
    uint256 indexed policyId,
    address indexed holder,
    Hazard hazard,
    uint256 start,
    uint256 end,
    uint256 maxCoverage,
    uint256 triggerThreshold
);

event PayoutTriggered(
    uint256 indexed policyId,
    address indexed holder,
    uint256 observedValue,
    uint256 requestedPayout,
    uint256 actualPayout
);

event PolicyExpiredReleased(
    uint256 indexed policyId,
    uint256 sharesReleased
);
```

These events allow the CRE workflow to:
- Track all active policies automatically
- Monitor payout status
- Clean up expired policies

## Configuration

### 1. Update Config Files

Edit `config.production.json` or `config.staging.json`:

```json
{
  "schedule": "*/5 * * * *",  // Check every 5 minutes
  "weatherApiKey": "your_api_key_here",
  "weatherApiUrl": "https://api.openweathermap.org/data/2.5/weather",
  "evms": [
    {
      "policyManagerAddress": "0xYourDeployedPolicyManagerAddress",
      "chainSelectorName": "ethereum-testnet-sepolia",
      "gasLimit": "1000000"
    }
  ]
}
```

### 2. Set Oracle Address

After deploying PolicyManager, set the oracle to your DON address:

```bash
cast send <POLICY_MANAGER_ADDRESS> \
  "setOracle(address)" \
  <YOUR_DON_ADDRESS> \
  --rpc-url sepolia \
  --private-key $PRIVATE_KEY
```

### 3. Get Weather API Key

Sign up for a free API key from:
- **OpenWeatherMap**: https://openweathermap.org/api
- **WeatherAPI**: https://www.weatherapi.com/
- Or any other weather data provider

## Workflow Logic

### Hazard Types and Triggers

The workflow supports three parametric insurance types:

1. **Heatwave** (`Hazard.Heatwave`)
   - Triggered when: `temperature >= triggerThreshold`
   - Example: Policy pays if temperature exceeds 35°C

2. **Flood** (`Hazard.Flood`)
   - Triggered when: `precipitation >= triggerThreshold`
   - Example: Policy pays if rainfall exceeds 100mm

3. **Drought** (`Hazard.Drought`)
   - Triggered when: `precipitation <= triggerThreshold`
   - Example: Policy pays if rainfall is below 10mm

### Payout Calculation

The workflow uses the **dynamic payout mechanism**:
- Requests full `maxCoverage` when triggered
- Contract calculates actual payout based on reserved shares value
- If vault underfunded: pays partial amount (whatever reserved shares are worth)
- If fully funded: pays full `maxCoverage`

## Deployment

### 1. Build the Workflow

```bash
cd /Users/mmendozaj/Desktop/WedefinLabs/parametrix/parametrix/cre_chainlink/parametrix/payout_trigger
bun install
```

### 2. Compile for CRE

```bash
bun x cre-setup
```

This generates `tmp.js` and `tmp.wasm` files.

### 3. Deploy to DON

Using CRE CLI:

```bash
# Staging deployment
cre workflow deploy \
  --config workflow.yaml \
  --target staging-settings

# Production deployment
cre workflow deploy \
  --config workflow.yaml \
  --target production-settings
```

### 4. Verify Deployment

Check that your workflow is running:

```bash
cre workflow status --name payout_trigger-production
```

## Testing

### Local Testing (Anvil)

1. Start local blockchain:
```bash
anvil
```

2. Deploy contracts:
```bash
cd smart-contracts
forge script script/Deploy.s.sol:DeployScript --fork-url http://localhost:8545 --broadcast
```

3. Create test policy:
```bash
# Deploy and note PolicyManager address
export POLICY_MANAGER=<address_from_deployment>

# Buy a test policy (Heatwave, 30 days, triggers at 35°C)
cast send $POLICY_MANAGER \
  "buyPolicy(uint8,uint256,uint256,uint256,uint256,address)" \
  0 30 1000000000000000000000 100000000000000000000 35 $YOUR_ADDRESS \
  --rpc-url http://localhost:8545 \
  --private-key $TEST_PRIVATE_KEY
```

4. Simulate weather data:
Mock the weather API to return temperature >= 35°C

5. Workflow should automatically trigger payout

### Testnet Testing (Sepolia)

1. Deploy contracts to Sepolia (see `smart-contracts/script/DEPLOYMENT.md`)

2. Deploy CRE workflow to DON

3. Purchase a policy:
```bash
# Approve USDC first
cast send $USDC_ADDRESS \
  "approve(address,uint256)" \
  $POLICY_MANAGER \
  1000000000000000000000 \
  --rpc-url sepolia --private-key $PRIVATE_KEY

# Buy policy
cast send $POLICY_MANAGER \
  "buyPolicy(uint8,uint256,uint256,uint256,uint256,address)" \
  0 1 1000000000000000000000 100000000000000000000 35 $YOUR_ADDRESS \
  --rpc-url sepolia --private-key $PRIVATE_KEY
```

4. Monitor workflow logs:
```bash
cre workflow logs --name payout_trigger-staging --follow
```

5. Check for payout after weather conditions meet threshold

## Monitoring

### View Active Policies

```bash
cast call $POLICY_MANAGER "nextId()" --rpc-url sepolia
# Returns next policy ID, so active IDs are 1 to (nextId - 1)

# Check specific policy
cast call $POLICY_MANAGER "policies(uint256)" 1 --rpc-url sepolia
```

### Monitor Events

```bash
# Watch for PolicyPurchased events
cast logs --address $POLICY_MANAGER \
  --event "PolicyPurchased(uint256,address,uint8,uint256,uint256,uint256,uint256)" \
  --rpc-url sepolia

# Watch for PayoutTriggered events
cast logs --address $POLICY_MANAGER \
  --event "PayoutTriggered(uint256,address,uint256,uint256,uint256)" \
  --rpc-url sepolia
```

### CRE Workflow Logs

```bash
# View recent logs
cre workflow logs --name payout_trigger-production --tail 100

# Follow logs in real-time
cre workflow logs --name payout_trigger-production --follow
```

## Customization

### Adjust Check Frequency

Edit `schedule` in config file:
- `"*/1 * * * *"` - Every minute (testing)
- `"*/5 * * * *"` - Every 5 minutes (recommended)
- `"*/15 * * * *"` - Every 15 minutes (production)
- `"0 * * * *"` - Every hour

### Add Multiple Weather Data Sources

For improved reliability, modify `fetchWeatherDataForPolicy()` to aggregate from multiple APIs:

```typescript
// Fetch from multiple sources
const sources = [
  'https://api.openweathermap.org/data/2.5/weather',
  'https://api.weatherapi.com/v1/current.json',
  'https://api.tomorrow.io/v4/weather/realtime',
]

// DON will reach consensus across all sources
```

### Support Additional Locations

Currently, policies use a default location. To support per-policy locations:

1. Add location metadata to PolicyManager (e.g., via token URI)
2. Update `fetchWeatherDataForPolicy()` to read policy location
3. Pass location as parameter to weather API

## Troubleshooting

### Workflow Not Triggering

1. Check DON status: `cre workflow status`
2. Verify oracle address matches: `cast call $POLICY_MANAGER "oracle()"`
3. Check weather API is responding: `curl $WEATHER_API_URL?apiKey=...`

### Payout Transaction Failing

1. Ensure DON has ETH for gas
2. Check gasLimit in config (increase if needed)
3. Verify policy is still active: `cast call $POLICY_MANAGER "policies(uint256)" <ID>`

### No Active Policies Found

1. Verify PolicyManager address in config
2. Check policies exist: `cast call $POLICY_MANAGER "nextId()"`
3. Ensure policies haven't expired

## Production Checklist

Before going live:

- [ ] Smart contracts audited
- [ ] Weather API has production tier (rate limits)
- [ ] Multiple weather data sources configured
- [ ] DON funded with sufficient ETH for gas
- [ ] Oracle address set correctly in PolicyManager
- [ ] Monitoring/alerting set up for workflow
- [ ] Test end-to-end on testnet first
- [ ] Schedule set to appropriate frequency (not too aggressive)

## Architecture Notes

### Why CRE?

Traditional oracle solutions require manual intervention or centralized servers. CRE provides:
- **Decentralized consensus** - Multiple nodes verify weather data
- **Automatic execution** - No manual intervention needed
- **Gas efficiency** - Batches checks and only submits when triggered
- **Reliability** - DON continues running 24/7

### Security Considerations

1. **Oracle Authorization** - Only CRE DON can call `triggerPayout()`
2. **Data Consensus** - Weather data aggregated from multiple sources
3. **Share Reservation** - Ensures funds available for payout
4. **Dynamic Payout** - Gracefully handles underfunded scenarios

## Resources

- [Chainlink CRE Documentation](https://docs.chain.link/cre)
- [PolicyManager Source Code](../smart-contracts/src/policyManager.sol)
- [Deployment Guide](../smart-contracts/script/DEPLOYMENT.md)
- [Chainlink DON Registration](https://docs.chain.link/cre/getting-started)

## Support

For issues or questions:
1. Check CRE logs: `cre workflow logs`
2. Verify contract events on Etherscan/block explorer
3. Test weather API manually with curl
4. Review smart contract tests: `forge test`
