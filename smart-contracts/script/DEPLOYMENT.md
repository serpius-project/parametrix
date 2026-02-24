# Parametrix Deployment Guide

Deployment instructions for **Ethereum Mainnet** (production) and **Tenderly testnet** (development).

## Prerequisites

1. **Install Foundry**: `curl -L https://foundry.paradigm.xyz | bash && foundryup`
2. **Configure environment**: Copy `.env.example` to `.env` and update values
3. **Fund deployer wallet**:
   - Mainnet: ~0.1 ETH for gas (6 contract deploys + wiring)
   - Tenderly: Use virtual testnet (no real ETH needed)

## What Gets Deployed

The deploy script creates and wires the following contracts:

| Contract | Purpose |
|---|---|
| UnderwriterVault (`pUWV`) | First-loss ERC-4626 vault |
| JuniorVault (`pJNR`) | Mezzanine ERC-4626 vault |
| SeniorVault (`pSNR`) | Most-protected ERC-4626 vault |
| FeeRateModel | Premium split calculator (pluggable) |
| PolicyManager | ERC-1155 policy issuance, payout waterfall |

Post-deploy wiring:
- All 3 vaults → `setPolicyManager(policyManager)`
- Junior & Senior vaults → `setCapManager(policyManager)` (for `syncVaultCaps()`)
- All 3 vaults → `setFee(depositFeeBps, feeRecipient)`
- (Optional) All 3 vaults → Aave pool, aToken, target BPS, enabled

## Network Configuration

### Ethereum Mainnet (Production)
- **Chain ID**: 1
- **USDC Address**: `0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48`
- **Aave V3 Pool**: `0x87870Bca3F3fD6335C3F4ce8392D69350B4fA4E2`
- **aUSDC**: `0x98C23E9d8f34FEFb1B7BD6a91B7FF122F4e16F5c`
- **RPC**: Alchemy/Infura recommended
- **Block Explorer**: https://etherscan.io

### Tenderly Mainnet Fork (Development - Public)
- **Type**: Mainnet fork - all mainnet contracts exist
- **Chain ID**: Custom (configured in Tenderly dashboard)
- **USDC Address**: `0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48` (same as mainnet!)
- **Aave**: Same addresses as mainnet (available on fork)
- **RPC**: Your Tenderly virtual testnet RPC URL
- **Block Explorer**: Tenderly dashboard
- **Visibility**: **Public** - Anyone can view and interact with contracts

## Quick Start

### 1. Configure Environment

Edit `.env` file:

```bash
# Deployer private key
PRIVATE_KEY=your_private_key_here

# Network RPC URLs
MAINNET_RPC_URL=https://eth-mainnet.g.alchemy.com/v2/YOUR_KEY
TENDERLY_RPC_URL=https://rpc.vnet.tenderly.co/devnet/YOUR_DEVNET_ID

# Verification
ETHERSCAN_API_KEY=your_etherscan_api_key

# Token (uses existing USDC on-chain — same address on mainnet and Tenderly fork)
ASSET_TOKEN=0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48

# Vault caps (6 decimals for USDC)
UW_VAULT_CAP=2000000000000          # 2M USDC
JUNIOR_VAULT_CAP=5000000000000      # 5M USDC
SENIOR_VAULT_CAP=15000000000000     # 15M USDC

# Fees
DEPOSIT_FEE_BPS=50                  # 0.5%
FEE_RECIPIENT=your_fee_recipient_address

# Policy metadata
POLICY_URI="https://api.parametrix.io/policy/{id}"

# Aave integration (optional - omit AAVE_POOL to skip)
AAVE_POOL=0x87870Bca3F3fD6335C3F4ce8392D69350B4fA4E2
AAVE_AUSDC=0x98C23E9d8f34FEFb1B7BD6a91B7FF122F4e16F5c
UW_AAVE_TARGET_BPS=7000             # 70% to Aave
JR_AAVE_TARGET_BPS=7000
SR_AAVE_TARGET_BPS=7000
```

### 2. Deploy to Tenderly (Testing on Mainnet Fork)

Deployment is split into two steps: contract creation (requires `--slow`) and configuration (fast, no ordering dependency).

```bash
# Step 1: Deploy contracts (requires --slow on Tenderly)
forge script script/Deploy.s.sol:DeployContracts \
  --rpc-url $TENDERLY_RPC_URL \
  --broadcast --slow -vvvv

# Step 2: Configure contracts (no --slow needed)
forge script script/Deploy.s.sol:ConfigureContracts \
  --rpc-url $TENDERLY_RPC_URL \
  --broadcast -vvvv
```

> **Why two steps?** Tenderly processes transactions out of order without `--slow`, but `--slow` is only needed for contract deploys (each depends on the previous address). Configuration calls are independent and can batch fast.

**After deployment, fund test wallets:**
1. Go to Tenderly dashboard
2. Use "State Overrides" to mint USDC to test addresses
3. Test policies with real USDC contract behavior

### 3. Deploy to Mainnet (Production)

**Production Deployment Checklist:**
- [ ] Smart contracts audited
- [ ] All 106 tests passing: `forge test`
- [ ] Environment variables verified
- [ ] USDC address correct: `0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48`
- [ ] Aave addresses correct (if using Aave)
- [ ] Fee recipient address confirmed
- [ ] Vault caps appropriate for launch
- [ ] Deployer wallet funded (0.1+ ETH)
- [ ] Tested on Tenderly first

```bash
# Verify configuration
echo "Asset Token: $ASSET_TOKEN"
echo "Fee Recipient: $FEE_RECIPIENT"
echo "Deployer: $(cast wallet address --private-key $PRIVATE_KEY)"

# Step 1: Deploy contracts (add --verify for Etherscan verification)
forge script script/Deploy.s.sol:DeployContracts \
  --rpc-url $MAINNET_RPC_URL \
  --broadcast --verify --slow -vvvv

# Step 2: Configure contracts
forge script script/Deploy.s.sol:ConfigureContracts \
  --rpc-url $MAINNET_RPC_URL \
  --broadcast -vvvv
```

## Deployment Output

After successful deployment, addresses are saved to `deployments/latest.json`:

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

## Post-Deployment Steps

### 1. Set Oracle Address

After deploying CRE workflow, set the DON as oracle:

```bash
export POLICY_MANAGER=0x...

cast send $POLICY_MANAGER \
  "setOracle(address)" \
  <DON_ADDRESS> \
  --rpc-url $MAINNET_RPC_URL \
  --private-key $PRIVATE_KEY
```

### 2. Sync Vault Caps (if using dynamic caps)

After adjusting FeeRateModel caps, push them to the vaults:

```bash
cast send $POLICY_MANAGER \
  "syncVaultCaps()" \
  --rpc-url $MAINNET_RPC_URL \
  --private-key $PRIVATE_KEY
```

### 3. Transfer Ownership (Recommended)

Transfer contract ownership to a multisig:

```bash
# Transfer all vault ownerships
for VAULT in $UW_VAULT $JR_VAULT $SR_VAULT; do
  cast send $VAULT \
    "transferOwnership(address)" \
    <MULTISIG_ADDRESS> \
    --rpc-url $MAINNET_RPC_URL \
    --private-key $PRIVATE_KEY
done

# Transfer PolicyManager ownership
cast send $POLICY_MANAGER \
  "transferOwnership(address)" \
  <MULTISIG_ADDRESS> \
  --rpc-url $MAINNET_RPC_URL \
  --private-key $PRIVATE_KEY

# Transfer FeeRateModel ownership
cast send $FEE_RATE_MODEL \
  "transferOwnership(address)" \
  <MULTISIG_ADDRESS> \
  --rpc-url $MAINNET_RPC_URL \
  --private-key $PRIVATE_KEY
```

### 4. Initial Deposits

Provide initial liquidity to each vault:

```bash
export AMOUNT=1000000000  # 1,000 USDC (6 decimals)

# Approve and deposit to each vault
for VAULT in $UW_VAULT $JR_VAULT $SR_VAULT; do
  cast send $ASSET_TOKEN \
    "approve(address,uint256)" $VAULT $AMOUNT \
    --rpc-url $MAINNET_RPC_URL \
    --private-key $UNDERWRITER_KEY

  cast send $VAULT \
    "deposit(uint256,address)" $AMOUNT <UNDERWRITER_ADDRESS> \
    --rpc-url $MAINNET_RPC_URL \
    --private-key $UNDERWRITER_KEY
done
```

### 5. Rebalance to Aave (if Aave enabled)

After initial deposits, trigger rebalancing to deploy funds to Aave:

```bash
for VAULT in $UW_VAULT $JR_VAULT $SR_VAULT; do
  cast send $VAULT \
    "rebalance()" \
    --rpc-url $MAINNET_RPC_URL \
    --private-key $PRIVATE_KEY
done
```

## Verification

If automatic verification fails, verify manually:

```bash
# Verify UnderwriterVault (same for Junior/Senior with different args)
forge verify-contract \
  <VAULT_ADDRESS> \
  src/underwriterVault.sol:underwriterVault \
  --chain-id 1 \
  --etherscan-api-key $ETHERSCAN_API_KEY \
  --constructor-args $(cast abi-encode \
    "constructor(address,string,string,uint256,address)" \
    $ASSET_TOKEN \
    "Parametrix Underwriter Vault" \
    "pUWV" \
    $UW_VAULT_CAP \
    $FEE_RECIPIENT)

# Verify FeeRateModel
forge verify-contract \
  <FEE_MODEL_ADDRESS> \
  src/FeeRateModel.sol:FeeRateModel \
  --chain-id 1 \
  --etherscan-api-key $ETHERSCAN_API_KEY \
  --constructor-args $(cast abi-encode \
    "constructor(uint256,uint256)" \
    $JUNIOR_VAULT_CAP \
    $SENIOR_VAULT_CAP)

# Verify PolicyManager
forge verify-contract \
  <POLICY_MANAGER_ADDRESS> \
  src/policyManager.sol:policyManager \
  --chain-id 1 \
  --etherscan-api-key $ETHERSCAN_API_KEY \
  --constructor-args $(cast abi-encode \
    "constructor(address,address,address,address,address,string)" \
    $ASSET_TOKEN \
    $UW_VAULT \
    $JR_VAULT \
    $SR_VAULT \
    $FEE_RATE_MODEL \
    "https://api.parametrix.io/policy/{id}")
```

## Testing on Tenderly (Public Mainnet Fork)

### Mainnet Fork Benefits

Since Tenderly is a **mainnet fork**, you get:
- **Real USDC Contract**: Test with actual USDC at `0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48`
- **Real Aave V3**: Test yield integration with actual Aave pool
- **Identical Deployment**: Same as mainnet, just virtual funds
- **Realistic Testing**: Exact production environment simulation

### Security Considerations

**Public fork** means anyone can:
- View all contract code and state
- Call any public function
- Purchase policies with USDC (if they have fork balance)
- Attempt exploits (good for finding bugs!)

**Best Practices**:
- Use separate test wallets (never use mainnet keys)
- Don't test sensitive business logic publicly
- Monitor for unusual activity

### Mint Test USDC on Fork

```bash
# Use Tenderly dashboard "State Overrides" feature
# Or use Tenderly API to modify USDC balances
```

## Troubleshooting

| Issue | Solution |
|-------|----------|
| Gas estimation failed | Check RPC URL and deployer balance |
| Verification failed | Use manual verification commands above |
| Transaction underpriced | Add `--slow` flag or set gas price manually |
| Contract already deployed | Use `--resume` flag or deploy from different address |
| Stack-too-deep compilation | Ensure `via_ir = true` in `foundry.toml` |

## Security Checklist

Before mainnet deployment:

- [ ] **Audit**: Contract code professionally audited
- [ ] **Tests**: 106 tests passing with good coverage
- [ ] **Keys**: Use hardware wallet or secure key management
- [ ] **Addresses**: All addresses verified (USDC, Aave, fee recipient)
- [ ] **Limits**: Vault caps appropriate for launch
- [ ] **Aave targets**: Sane percentages (max 90% per vault)
- [ ] **Ownership**: Plan for multisig transfer
- [ ] **Oracle**: CRE workflow tested and ready
- [ ] **Monitoring**: Block explorer alerts configured
- [ ] **Recovery**: Emergency procedures documented (pause vaults, disable Aave)

## Cost Estimates

### Ethereum Mainnet Gas Costs

| Operation | Estimated Gas | Cost @ 30 gwei |
|-----------|--------------|----------------|
| Deploy UnderwriterVault (x3) | ~7,500,000 | ~0.225 ETH |
| Deploy FeeRateModel | ~800,000 | ~0.024 ETH |
| Deploy PolicyManager | ~3,000,000 | ~0.090 ETH |
| Wiring (setPolicyManager, capManager, fees, Aave) | ~500,000 | ~0.015 ETH |
| **Total (with Aave)** | **~11,800,000** | **~0.35 ETH** |
| **Total (no Aave)** | **~11,300,000** | **~0.34 ETH** |

*Actual costs vary with gas prices*

### Tenderly Testnet
- **Cost**: Free (virtual testnet)

## Resources

- **Etherscan**: https://etherscan.io
- **Tenderly**: https://dashboard.tenderly.co
- **USDC Info**: https://www.circle.com/en/usdc
- **Aave V3 Docs**: https://docs.aave.com/developers/
- **Foundry Docs**: https://book.getfoundry.sh
- **CRE Setup**: See `cre_chainlink/parametrix/payout_trigger/CRE_SETUP.md`
