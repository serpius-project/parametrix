# Parametrix Smart Contracts

Foundry project containing the parametric insurance smart contracts for Parametrix.

## Contracts

| Contract | Description |
|---|---|
| `src/policyManager.sol` | Issues policies (ERC-1155 NFTs), collects premiums, triggers payouts |
| `src/underwriterVault.sol` | ERC-4626 vault where underwriters deposit USDC as collateral |

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

Deploys MockUSDC (testnet), UnderwriterVault, and PolicyManager. Saves addresses to `deployments/latest.json`.

```bash
forge script script/Deploy.s.sol:DeployScript \
  --rpc-url $TENDERLY_RPC_URL \
  --broadcast \
  --slow \
  -vvvv
```

> **Note:** The `--slow` flag is required for Tenderly virtual testnets. Without it, Foundry batch-sends all transactions and Tenderly may process them out of order, causing some contract deployments to silently fail.

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

## Environment variables (`.env`)

| Variable | Description |
|---|---|
| `PRIVATE_KEY` | Deployer wallet private key |
| `TENDERLY_RPC_URL` | Your Tenderly virtual testnet RPC URL |
| `MAINNET_RPC_URL` | Ethereum mainnet RPC (for production) |
| `USER_PRIVATE_KEY` | Policy buyer wallet private key (for BuyPolicy script) |
| `ETHERSCAN_API_KEY` | For contract verification (mainnet only) |

## Deployment output

After running Deploy.s.sol, addresses are saved to `deployments/latest.json`:

```json
{
  "asset": "0x...",
  "vault": "0x...",
  "policyManager": "0x...",
  "feeRecipient": "0x...",
  "vaultCap": "...",
  "depositFeeBps": "..."
}
```

## Hazard types

| ID | Name | Trigger unit |
|---|---|---|
| 0 | Heatwave | °C (wet-bulb temperature) |
| 1 | Flood | m³/s (river discharge) |
| 2 | Drought | mm (water deficit) |
