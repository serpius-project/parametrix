# Deployment Guide

This guide explains how to deploy the Parametrix smart contracts using Foundry.

## Prerequisites

1. Install Foundry: `curl -L https://foundry.paradigm.xyz | bash && foundryup`
2. Set up your environment variables (see `.env.example`)
3. Fund your deployer wallet with native tokens (ETH/MATIC/etc.) for gas

## Configuration

Create a `.env` file in the `smart-contracts` directory:

```bash
# Required
PRIVATE_KEY=your_private_key_here

# Optional - Development/Testing
DEPLOY_MOCK_TOKEN=true
VAULT_CAP=10000000000000  # 10M USDC (6 decimals)
DEPOSIT_FEE_BPS=50        # 0.5%
FEE_RECIPIENT=0x...       # Defaults to deployer
VAULT_NAME="Parametrix Underwriter Vault"
VAULT_SYMBOL="pUWV"
POLICY_URI="https://api.parametrix.io/policy/{id}"

# Optional - Production
ASSET_TOKEN=0x...         # Existing USDC/stablecoin address
```

## Deployment Scripts

### 1. Local Development (Anvil)

Deploy to a local Foundry node for testing:

```bash
# Start local node
anvil

# In another terminal, deploy contracts
forge script script/Deploy.s.sol:DeployScript --fork-url http://localhost:8545 --broadcast
```

### 2. Testnet Deployment (e.g., Sepolia)

```bash
# Deploy to Sepolia testnet
forge script script/Deploy.s.sol:DeployScript \
  --rpc-url $SEPOLIA_RPC_URL \
  --broadcast \
  --verify \
  -vvvv

# Or use network aliases
forge script script/Deploy.s.sol:DeployScript \
  --rpc-url sepolia \
  --broadcast \
  --verify
```

### 3. Mainnet/Production Deployment

For production deployments, use the `DeployProduction` script which has additional safety checks:

```bash
# Set production environment variables
export DEPLOY_MOCK_TOKEN=false
export ASSET_TOKEN=0x...     # Real USDC address
export FEE_RECIPIENT=0x...   # Your fee recipient address
export VAULT_CAP=10000000000000

# Deploy to mainnet
forge script script/Deploy.s.sol:DeployProduction \
  --rpc-url $MAINNET_RPC_URL \
  --broadcast \
  --verify \
  --slow \
  -vvvv
```

## Supported Networks

### Testnets
- **Sepolia (Ethereum)**: `--rpc-url sepolia`
- **Mumbai (Polygon)**: `--rpc-url mumbai`
- **Goerli (Ethereum)**: `--rpc-url goerli`

### Mainnets
- **Ethereum**: `--rpc-url mainnet`
- **Polygon**: `--rpc-url polygon`
- **Arbitrum**: `--rpc-url arbitrum`
- **Optimism**: `--rpc-url optimism`

Configure RPC URLs in `foundry.toml`:

```toml
[rpc_endpoints]
sepolia = "${SEPOLIA_RPC_URL}"
mainnet = "${MAINNET_RPC_URL}"
polygon = "${POLYGON_RPC_URL}"
```

## Post-Deployment Steps

After deployment, you'll need to:

1. **Verify deployment addresses** in `deployments/latest.json`

2. **Set up the oracle** - Update the oracle address in PolicyManager:
   ```bash
   cast send <POLICY_MANAGER_ADDRESS> "setOracle(address)" <ORACLE_ADDRESS> \
     --rpc-url <RPC_URL> \
     --private-key $PRIVATE_KEY
   ```

3. **Initial underwriter deposits** (optional):
   ```bash
   # Approve vault to spend tokens
   cast send <ASSET_TOKEN> "approve(address,uint256)" <VAULT_ADDRESS> <AMOUNT> \
     --rpc-url <RPC_URL> \
     --private-key $UNDERWRITER_PRIVATE_KEY

   # Deposit to vault
   cast send <VAULT_ADDRESS> "deposit(uint256,address)" <AMOUNT> <UNDERWRITER_ADDRESS> \
     --rpc-url <RPC_URL> \
     --private-key $UNDERWRITER_PRIVATE_KEY
   ```

4. **Verify contracts on block explorer** (automatically done with `--verify` flag)

## Verification

If automatic verification fails, manually verify contracts:

```bash
forge verify-contract \
  --chain-id <CHAIN_ID> \
  --constructor-args $(cast abi-encode "constructor(address,string,string,uint256,address)" <ARGS>) \
  <CONTRACT_ADDRESS> \
  src/underwriterVault.sol:underwriterVault
```

## Deployment Outputs

After successful deployment, you'll find:
- Deployment addresses in `deployments/latest.json`
- Transaction receipts in `broadcast/Deploy.s.sol/<chain-id>/`

## Example Deployment

```bash
# 1. Set up environment
cp .env.example .env
# Edit .env with your values

# 2. Test locally first
anvil &
forge script script/Deploy.s.sol:DeployScript --fork-url http://localhost:8545 --broadcast

# 3. Deploy to testnet
forge script script/Deploy.s.sol:DeployScript \
  --rpc-url sepolia \
  --broadcast \
  --verify

# 4. Verify deployment
cat deployments/latest.json
```

## Troubleshooting

**Problem**: "Failed to get EIP-1559 fees"
- **Solution**: Add `--legacy` flag for networks without EIP-1559

**Problem**: "Verification failed"
- **Solution**: Check your Etherscan API key in `foundry.toml`

**Problem**: "Insufficient funds"
- **Solution**: Ensure deployer wallet has enough native tokens for gas

**Problem**: Mock token deployed in production
- **Solution**: Set `DEPLOY_MOCK_TOKEN=false` and provide `ASSET_TOKEN` address

## Security Checklist

Before production deployment:
- [ ] Private key is stored securely (use hardware wallet or secure key management)
- [ ] Fee recipient address is correct
- [ ] Vault cap is set appropriately
- [ ] Asset token address is verified (no mock tokens!)
- [ ] Oracle address is set to a trusted source
- [ ] Contracts are audited
- [ ] Test deployment performed on testnet first
- [ ] Multi-sig setup for contract ownership (optional but recommended)
