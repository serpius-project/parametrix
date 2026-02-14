# Deployment Scripts

Quick reference for deploying Parametrix to **Ethereum Mainnet** and **Tenderly testnet**.

## Quick Commands

### Tenderly Testnet (Development)
```bash
# Deploy with mock USDC
DEPLOY_MOCK_TOKEN=true forge script script/Deploy.s.sol:DeployScript \
  --rpc-url $TENDERLY_RPC_URL \
  --broadcast \
  -vvvv
```

### Ethereum Mainnet (Production)
```bash
# Deploy with real USDC
forge script script/Deploy.s.sol:DeployProduction \
  --rpc-url $MAINNET_RPC_URL \
  --broadcast \
  --verify \
  --slow \
  -vvvv
```

## Available Scripts

### `DeployScript`
**For development and testing (Tenderly)**

- Optionally deploys mock USDC
- Configurable via environment variables
- Saves deployment info to `deployments/latest.json`

### `DeployProduction`
**For production deployment (Mainnet)**

- Requires real USDC token
- Additional safety checks
- Fixed configuration for production

## Configuration

Required environment variables in `.env`:

| Variable | Mainnet | Tenderly |
|----------|---------|----------|
| `PRIVATE_KEY` | Your deployer key | Your deployer key |
| `DEPLOY_MOCK_TOKEN` | `false` | `true` |
| `ASSET_TOKEN` | `0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48` (USDC) | Not needed |
| `MAINNET_RPC_URL` | Alchemy/Infura URL | - |
| `TENDERLY_RPC_URL` | - | Your devnet URL |
| `VAULT_CAP` | `10000000000000` (10M USDC) | `10000000000000` |
| `DEPOSIT_FEE_BPS` | `50` (0.5%) | `50` |
| `FEE_RECIPIENT` | Your address | Your address |

## Common Operations

### Dry Run (Simulation)
Test without broadcasting:
```bash
forge script script/Deploy.s.sol:DeployScript --rpc-url $TENDERLY_RPC_URL
```

### Resume Failed Deployment
Continue from last successful transaction:
```bash
forge script script/Deploy.s.sol:DeployScript \
  --rpc-url $TENDERLY_RPC_URL \
  --resume \
  --broadcast
```

### Manual Verification
If auto-verification fails on mainnet:
```bash
forge verify-contract \
  <CONTRACT_ADDRESS> \
  src/policyManager.sol:policyManager \
  --chain-id 1 \
  --etherscan-api-key $ETHERSCAN_API_KEY \
  --constructor-args $(cast abi-encode "constructor(...)" ...)
```

## Post-Deployment

After deploying:

1. **Save addresses** from deployment output
2. **Set oracle**:
   ```bash
   cast send <POLICY_MANAGER> "setOracle(address)" <DON_ADDRESS> --rpc-url $RPC_URL --private-key $PRIVATE_KEY
   ```
3. **Transfer ownership** to multisig (mainnet only)
4. **Configure CRE** with PolicyManager address
5. **Initial deposit** to vault (mainnet)

## Network Details

### Ethereum Mainnet
- **Chain ID**: 1
- **USDC**: `0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48`
- **Explorer**: https://etherscan.io
- **Gas**: ~0.05 ETH needed

### Tenderly Testnet
- **Chain ID**: Custom (from dashboard)
- **USDC**: Auto-deployed mock
- **Explorer**: Tenderly dashboard
- **Gas**: Free (virtual)

## Deployment Outputs

Script saves to `deployments/latest.json`:
```json
{
  "chainId": "1",
  "network": "mainnet",
  "timestamp": "2024-02-14T10:30:00Z",
  "deployer": "0x...",
  "contracts": {
    "asset": "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
    "vault": "0x...",
    "policyManager": "0x..."
  },
  "config": {
    "vaultCap": "10000000000000",
    "depositFeeBps": "50",
    "feeRecipient": "0x..."
  }
}
```

## Troubleshooting

| Issue | Solution |
|-------|----------|
| Gas estimation failed | Check RPC URL and deployer balance |
| Verification failed | Use manual verification with `forge verify-contract` |
| Transaction underpriced | Add `--slow` flag or set gas price manually |
| Contract already deployed | Use `--resume` or deploy from different address |

## Security

⚠️ **Production Deployment:**
- Use hardware wallet (`--ledger`) for mainnet
- Never commit private keys
- Test on Tenderly first
- Verify all addresses before deploying
- Transfer ownership to multisig immediately

## Full Documentation

See [DEPLOYMENT.md](./DEPLOYMENT.md) for complete guide.

## Resources

- **CRE Setup**: `cre_chainlink/parametrix/payout_trigger/CRE_SETUP.md`
- **Foundry Docs**: https://book.getfoundry.sh
- **Tenderly**: https://dashboard.tenderly.co
