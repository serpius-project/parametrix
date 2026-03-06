# Deployment Scripts

Quick reference for deploying Parametrix to **Ethereum Mainnet** and **Tenderly mainnet fork**.

## Quick Commands

```bash
# Step 1: Deploy contracts (requires --slow on Tenderly)
forge script script/Deploy.s.sol:DeployContracts \
  --rpc-url $RPC_URL \
  --broadcast --slow -vvvv

# Step 2: Configure contracts (no --slow needed)
forge script script/Deploy.s.sol:ConfigureContracts \
  --rpc-url $RPC_URL \
  --broadcast -vvvv
```

The same scripts work for both Tenderly mainnet fork and Ethereum mainnet. For mainnet, add `--verify` to step 1.

## Available Scripts

### `DeployContracts`
**Step 1 — Deploy all contracts (run with `--slow`)**

- Deploys 3 ERC-4626 vaults (Underwriter, Junior, Senior), FeeRateModel, PolicyManager
- Uses existing USDC on-chain (mainnet address works on both mainnet and Tenderly fork)
- Saves all addresses to `deployments/latest.json`
- No configuration — just contract creation

### `ConfigureContracts`
**Step 2 — Wire and configure (run without `--slow`)**

- Reads addresses from `deployments/latest.json`
- Sets PolicyManager on all 3 vaults
- Sets capManager on Junior/Senior vaults
- Configures deposit fees
- Configures Aave on all vaults (if `AAVE_POOL` env var provided)
- All calls are independent — no ordering dependency

### `BuyPolicyScript`
**Simulate a policy purchase**

- Update constants at top of `script/BuyPolicy.s.sol` with deployed addresses
- Approves PolicyManager, calls `buyPolicy()`

## Configuration

Required environment variables in `.env`:

| Variable | Description | Default |
|----------|-------------|---------|
| `PRIVATE_KEY` | Deployer private key | required |
| `ASSET_TOKEN` | USDC address (mainnet or fork) | required |
| `UW_VAULT_CAP` | Underwriter vault cap | `2,000,000 USDC` |
| `JUNIOR_VAULT_CAP` | Junior vault cap | `5,000,000 USDC` |
| `SENIOR_VAULT_CAP` | Senior vault cap (auto-computed if omitted) | `juniorCap × 3` |
| `DEPOSIT_FEE_BPS` | Deposit fee (basis points) | `50` (0.5%) |
| `FEE_RECIPIENT` | Fee recipient address | deployer |
| `POLICY_URI` | ERC-1155 metadata URI | `https://api.parametrix.io/policy/{id}` |
| `AAVE_POOL` | Aave V3 Pool address (omit to skip) | `address(0)` |
| `AAVE_AUSDC` | Aave aUSDC address | `address(0)` |
| `UW_AAVE_TARGET_BPS` | UW vault Aave target | `7000` (70%) |
| `JR_AAVE_TARGET_BPS` | Junior vault Aave target | `7000` (70%) |
| `SR_AAVE_TARGET_BPS` | Senior vault Aave target | `7000` (70%) |

Network-specific:

| Variable | Mainnet | Tenderly Fork |
|----------|---------|---------------|
| `MAINNET_RPC_URL` | Alchemy/Infura URL | — |
| `TENDERLY_RPC_URL` | — | Your devnet URL |
| `ETHERSCAN_API_KEY` | For verification | — |

## Common Operations

### Dry Run (Simulation)
Test without broadcasting:
```bash
forge script script/Deploy.s.sol:DeployContracts --rpc-url $TENDERLY_RPC_URL
```

### Resume Failed Deployment
Continue from last successful transaction:
```bash
forge script script/Deploy.s.sol:DeployContracts \
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
  --constructor-args $(cast abi-encode \
    "constructor(address,address,address,address,address,string)" \
    $ASSET_TOKEN $UW_VAULT $JR_VAULT $SR_VAULT $FEE_MODEL $POLICY_URI)
```

## Post-Deployment

After deploying:

1. **Save addresses** from `deployments/latest.json`
2. **Set oracle**:
   ```bash
   cast send <POLICY_MANAGER> "setOracle(address)" <DON_ADDRESS> \
     --rpc-url $RPC_URL --private-key $PRIVATE_KEY
   ```
3. **Sync vault caps** (if adjusting via FeeRateModel):
   ```bash
   cast send <POLICY_MANAGER> "syncVaultCaps()" \
     --rpc-url $RPC_URL --private-key $PRIVATE_KEY
   ```
4. **Transfer ownership** to multisig (all 3 vaults + PolicyManager + FeeRateModel)
5. **Configure CRE** with PolicyManager address
6. **Initial deposits** to all 3 vaults
7. **Rebalance to Aave** (if Aave enabled):
   ```bash
   cast send <VAULT> "rebalance()" --rpc-url $RPC_URL --private-key $PRIVATE_KEY
   ```

## Deployment Output

Script saves to `deployments/latest.json`:
```json
{
  "asset": "0x...",
  "underwriterVault": "0x...",
  "juniorVault": "0x...",
  "seniorVault": "0x...",
  "feeRateModel": "0x...",
  "policyManager": "0x...",
  "feeRecipient": "0x...",
  "underwriterVaultCap": "...",
  "juniorVaultCap": "...",
  "seniorVaultCap": "...",
  "depositFeeBps": "..."
}
```

## Network Details

### Ethereum Mainnet
- **Chain ID**: 1
- **USDC**: `0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48`
- **Aave V3 Pool**: `0x87870Bca3F3fD6335C3F4ce8392D69350B4fA4E2`
- **aUSDC**: `0x98C23E9d8f34FEFb1B7BD6a91B7FF122F4e16F5c`
- **Explorer**: https://etherscan.io
- **Gas**: ~0.1 ETH needed

### Tenderly Mainnet Fork
- **Chain ID**: Custom (from dashboard)
- **USDC/Aave**: Same as mainnet (real contracts on fork!)
- **Explorer**: Tenderly dashboard
- **Gas**: Free (virtual)

## Troubleshooting

| Issue | Solution |
|-------|----------|
| Gas estimation failed | Check RPC URL and deployer balance |
| Verification failed | Use manual verification with `forge verify-contract` |
| Transaction underpriced | Add `--slow` flag or set gas price manually |
| Contract already deployed | Use `--resume` or deploy from different address |
| Stack-too-deep | Ensure `via_ir = true` in `foundry.toml` |

## Security

**Production Deployment:**
- Use hardware wallet (`--ledger`) for mainnet
- Never commit private keys
- Test on Tenderly first
- Verify all addresses before deploying
- Transfer ownership to multisig immediately
- Set sane Aave targets (max 90% per vault)

## Resources

- **CRE Payout Trigger**: `cre_chainlink/parametrix/payout_trigger/README.md`
- **CRE Underwriter**: `cre_chainlink/parametrix/underwriter/README.md`
- **Foundry Docs**: https://book.getfoundry.sh
- **Aave V3 Docs**: https://docs.aave.com/developers/
- **Tenderly**: https://dashboard.tenderly.co
