# Deployment Scripts

This directory contains scripts for deploying the Parametrix smart contracts.

## Quick Start

```bash
# 1. Copy and configure environment variables
cp .env.example .env
# Edit .env with your configuration

# 2. Local deployment (for testing)
anvil &
forge script script/Deploy.s.sol:DeployScript --fork-url http://localhost:8545 --broadcast

# 3. Testnet deployment
forge script script/Deploy.s.sol:DeployScript --rpc-url sepolia --broadcast --verify

# 4. Production deployment
forge script script/Deploy.s.sol:DeployProduction --rpc-url mainnet --broadcast --verify --slow
```

## Available Scripts

### `Deploy.s.sol:DeployScript`
Main deployment script for development and testing environments.

**Features:**
- Optionally deploys mock USDC token
- Configurable via environment variables
- Saves deployment info to `deployments/latest.json`
- Suitable for local and testnet deployments

**Usage:**
```bash
forge script script/Deploy.s.sol:DeployScript \
  --rpc-url <RPC_URL> \
  --broadcast \
  [--verify]
```

### `Deploy.s.sol:DeployProduction`
Hardened deployment script for production environments.

**Features:**
- Requires real asset token (no mock deployments)
- Additional safety checks
- Fixed configuration for production use
- Validates all required parameters

**Usage:**
```bash
forge script script/Deploy.s.sol:DeployProduction \
  --rpc-url <RPC_URL> \
  --broadcast \
  --verify \
  --slow
```

## Configuration

All deployment parameters can be configured via environment variables:

| Variable | Default | Description |
|----------|---------|-------------|
| `PRIVATE_KEY` | *required* | Deployer private key |
| `DEPLOY_MOCK_TOKEN` | `true` | Deploy mock USDC for testing |
| `ASSET_TOKEN` | `address(0)` | Existing asset token address |
| `VAULT_CAP` | `10000000000000` | Max vault capacity (10M USDC) |
| `DEPOSIT_FEE_BPS` | `50` | Deposit fee in basis points (0.5%) |
| `FEE_RECIPIENT` | deployer | Address receiving fees |
| `VAULT_NAME` | `"Parametrix Underwriter Vault"` | Vault token name |
| `VAULT_SYMBOL` | `"pUWV"` | Vault token symbol |
| `POLICY_URI` | `"https://api.parametrix.io/policy/{id}"` | Policy NFT metadata URI |

## Common Commands

### Dry Run (Simulation)
Test deployment without broadcasting transactions:
```bash
forge script script/Deploy.s.sol:DeployScript --rpc-url sepolia
```

### Deploy with Verification
Deploy and automatically verify contracts on block explorer:
```bash
forge script script/Deploy.s.sol:DeployScript \
  --rpc-url sepolia \
  --broadcast \
  --verify \
  --etherscan-api-key $ETHERSCAN_API_KEY
```

### Resume Failed Deployment
If deployment fails partway through, resume from last successful transaction:
```bash
forge script script/Deploy.s.sol:DeployScript \
  --rpc-url sepolia \
  --resume \
  --broadcast
```

### Deploy to Custom Network
Deploy to any EVM-compatible network:
```bash
forge script script/Deploy.s.sol:DeployScript \
  --rpc-url https://your-custom-rpc.com \
  --broadcast \
  --legacy  # Add if network doesn't support EIP-1559
```

## Post-Deployment

After successful deployment, the script outputs:
1. Contract addresses to console
2. Deployment info to `deployments/latest.json`
3. Transaction receipts to `broadcast/Deploy.s.sol/<chain-id>/`

### Set Oracle
Update the oracle address in PolicyManager:
```bash
cast send <POLICY_MANAGER_ADDRESS> \
  "setOracle(address)" \
  <ORACLE_ADDRESS> \
  --rpc-url <RPC_URL> \
  --private-key $PRIVATE_KEY
```

### Initial Underwriter Deposit
Provide initial liquidity to the vault:
```bash
# 1. Approve vault
cast send <ASSET_TOKEN> \
  "approve(address,uint256)" \
  <VAULT_ADDRESS> \
  <AMOUNT> \
  --rpc-url <RPC_URL> \
  --private-key $UNDERWRITER_KEY

# 2. Deposit
cast send <VAULT_ADDRESS> \
  "deposit(uint256,address)" \
  <AMOUNT> \
  <UNDERWRITER_ADDRESS> \
  --rpc-url <RPC_URL> \
  --private-key $UNDERWRITER_KEY
```

## Network-Specific Examples

### Ethereum Sepolia
```bash
forge script script/Deploy.s.sol:DeployScript \
  --rpc-url $SEPOLIA_RPC_URL \
  --broadcast \
  --verify \
  --etherscan-api-key $ETHERSCAN_API_KEY
```

### Polygon Mumbai
```bash
forge script script/Deploy.s.sol:DeployScript \
  --rpc-url $MUMBAI_RPC_URL \
  --broadcast \
  --verify \
  --etherscan-api-key $POLYGONSCAN_API_KEY \
  --verifier-url https://api-testnet.polygonscan.com/api
```

### Arbitrum Sepolia
```bash
forge script script/Deploy.s.sol:DeployScript \
  --rpc-url $ARBITRUM_SEPOLIA_RPC_URL \
  --broadcast \
  --verify \
  --etherscan-api-key $ARBISCAN_API_KEY \
  --verifier-url https://api-sepolia.arbiscan.io/api
```

## Troubleshooting

See [DEPLOYMENT.md](./DEPLOYMENT.md) for detailed troubleshooting guide.

## Security

⚠️ **Never commit your `.env` file or private keys to version control!**

For production deployments:
- Use a hardware wallet (Ledger/Trezor) with `--ledger` flag
- Or use a secure key management system
- Always test on testnet first
- Verify all addresses before deployment
- Use multi-sig for contract ownership

## Resources

- [Foundry Book - Deploying](https://book.getfoundry.sh/forge/deploying)
- [Foundry Scripts](https://book.getfoundry.sh/tutorials/solidity-scripting)
- [Cast Commands](https://book.getfoundry.sh/reference/cast/)
