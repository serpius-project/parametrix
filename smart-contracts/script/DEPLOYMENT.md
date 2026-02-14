# Parametrix Deployment Guide

Deployment instructions for **Ethereum Mainnet** (production) and **Tenderly testnet** (development).

## Prerequisites

1. **Install Foundry**: `curl -L https://foundry.paradigm.xyz | bash && foundryup`
2. **Configure environment**: Copy `.env.example` to `.env` and update values
3. **Fund deployer wallet**:
   - Mainnet: ~0.05 ETH for gas
   - Tenderly: Use virtual testnet (no real ETH needed)

## Network Configuration

### Ethereum Mainnet (Production)
- **Chain ID**: 1
- **USDC Address**: `0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48`
- **RPC**: Alchemy/Infura recommended
- **Block Explorer**: https://etherscan.io

### Tenderly Testnet (Development - Public)
- **Chain ID**: Custom (configured in Tenderly dashboard)
- **Mock USDC**: Deployed automatically
- **RPC**: Your Tenderly virtual testnet RPC URL
- **Block Explorer**: Tenderly dashboard
- **Visibility**: ⚠️ **Public** - Anyone can view and interact with contracts
- **Security**: Use only for testing, no real funds or sensitive data

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

# Production Configuration (Mainnet)
DEPLOY_MOCK_TOKEN=false
ASSET_TOKEN=0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48  # USDC on Mainnet

# Vault Settings
VAULT_CAP=10000000000000              # 10M USDC (6 decimals)
DEPOSIT_FEE_BPS=50                    # 0.5% fee
FEE_RECIPIENT=your_fee_recipient_address
VAULT_NAME="Parametrix Underwriter Vault"
VAULT_SYMBOL="pUWV"
POLICY_URI="https://api.parametrix.io/policy/{id}"
```

### 2. Deploy to Tenderly (Testing)

**⚠️ Public Testnet Notice:**
- Tenderly testnet is **publicly visible**
- Anyone can interact with deployed contracts
- Use only test wallets with no real value
- Perfect for public testing and demonstrations

```bash
# Deploy with mock USDC
DEPLOY_MOCK_TOKEN=true forge script script/Deploy.s.sol:DeployScript \
  --rpc-url $TENDERLY_RPC_URL \
  --broadcast \
  -vvvv

# Save the deployed addresses
# Share testnet URL with team or community for testing
```

### 3. Deploy to Mainnet (Production)

**⚠️ Production Deployment Checklist:**
- [ ] Smart contracts audited
- [ ] All tests passing: `forge test`
- [ ] Environment variables verified
- [ ] USDC address correct: `0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48`
- [ ] Fee recipient address confirmed
- [ ] Deployer wallet funded (0.05+ ETH)
- [ ] Tested on Tenderly first

```bash
# Verify configuration
echo "Asset Token: $ASSET_TOKEN"
echo "Fee Recipient: $FEE_RECIPIENT"
echo "Deployer: $(cast wallet address --private-key $PRIVATE_KEY)"

# Deploy to mainnet
forge script script/Deploy.s.sol:DeployProduction \
  --rpc-url $MAINNET_RPC_URL \
  --broadcast \
  --verify \
  --slow \
  -vvvv
```

## Deployment Outputs

After successful deployment:

```
===============================================
Parametrix Protocol Deployed Successfully
===============================================
Network: Ethereum Mainnet (Chain ID: 1)

Deployed Contracts:
  Asset Token:        0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48 (USDC)
  UnderwriterVault:   0x... (SAVE THIS!)
  PolicyManager:      0x... (SAVE THIS!)

Configuration:
  Vault Cap:          10,000,000 USDC
  Deposit Fee:        0.5%
  Fee Recipient:      0x...

Next Steps:
  1. Verify contracts on Etherscan (if --verify failed)
  2. Set oracle address in PolicyManager
  3. Transfer ownership to multisig
  4. Configure CRE workflow with PolicyManager address

Deployment saved to: deployments/latest.json
===============================================
```

## Post-Deployment Steps

### 1. Set Oracle Address

After deploying CRE workflow, set the DON as oracle:

```bash
# Get PolicyManager address from deployment output
export POLICY_MANAGER=0x...

# Set CRE DON as oracle
cast send $POLICY_MANAGER \
  "setOracle(address)" \
  <DON_ADDRESS> \
  --rpc-url $MAINNET_RPC_URL \
  --private-key $PRIVATE_KEY
```

### 2. Transfer Ownership (Recommended)

Transfer contract ownership to a multisig:

```bash
# Transfer UnderwriterVault ownership
cast send $VAULT_ADDRESS \
  "transferOwnership(address)" \
  <MULTISIG_ADDRESS> \
  --rpc-url $MAINNET_RPC_URL \
  --private-key $PRIVATE_KEY

# Transfer PolicyManager ownership
cast send $POLICY_MANAGER \
  "transferOwnership(address)" \
  <MULTISIG_ADDRESS> \
  --rpc-url $MAINNET_RPC_URL \
  --private-key $PRIVATE_KEY
```

### 3. Initial Underwriter Deposit

Provide initial liquidity:

```bash
export VAULT_ADDRESS=0x...
export AMOUNT=1000000000  # 1,000 USDC (6 decimals)

# 1. Approve USDC
cast send 0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48 \
  "approve(address,uint256)" \
  $VAULT_ADDRESS \
  $AMOUNT \
  --rpc-url $MAINNET_RPC_URL \
  --private-key $UNDERWRITER_KEY

# 2. Deposit to vault
cast send $VAULT_ADDRESS \
  "deposit(uint256,address)" \
  $AMOUNT \
  <UNDERWRITER_ADDRESS> \
  --rpc-url $MAINNET_RPC_URL \
  --private-key $UNDERWRITER_KEY
```

## Verification

If automatic verification fails, verify manually:

### Etherscan Verification

```bash
# Verify UnderwriterVault
forge verify-contract \
  <VAULT_ADDRESS> \
  src/underwriterVault.sol:underwriterVault \
  --chain-id 1 \
  --etherscan-api-key $ETHERSCAN_API_KEY \
  --constructor-args $(cast abi-encode "constructor(address,string,string,uint256,address)" \
    0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48 \
    "Parametrix Underwriter Vault" \
    "pUWV" \
    10000000000000 \
    $FEE_RECIPIENT)

# Verify PolicyManager
forge verify-contract \
  <POLICY_MANAGER_ADDRESS> \
  src/policyManager.sol:policyManager \
  --chain-id 1 \
  --etherscan-api-key $ETHERSCAN_API_KEY \
  --constructor-args $(cast abi-encode "constructor(address,address,string)" \
    0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48 \
    <VAULT_ADDRESS> \
    "https://api.parametrix.io/policy/{id}")
```

## Testing on Tenderly (Public Testnet)

### Public Testnet Benefits

Since your Tenderly testnet is **publicly visible**:
- ✅ **Community Testing**: Share with community for early feedback
- ✅ **Public Demos**: Show functionality to stakeholders/investors
- ✅ **Integration Testing**: Partners can test integrations before mainnet
- ✅ **Transparent Development**: Build in public, gain trust
- ✅ **Bug Bounties**: Let security researchers test publicly

### Security Considerations

⚠️ **Important**: Public testnet means anyone can:
- View all contract code and state
- Call any public function
- Purchase policies with mock USDC
- Attempt exploits (good for finding bugs!)
- Monitor all transactions and events

**Best Practices**:
- Use separate test wallets (never use mainnet keys)
- Don't test sensitive business logic publicly
- Monitor for unusual activity
- Consider it a security audit opportunity
- Document known limitations publicly

### Simulate Transactions

```bash
# Use Tenderly dashboard to:
# 1. Simulate policy purchases
# 2. Test payout triggers
# 3. Validate vault mechanics
# 4. Fork mainnet state for realistic testing
# 5. Share transaction simulations with team
```

### Monitor Deployment

View in Tenderly:
- Transaction history (public)
- Contract interactions (public)
- State changes (public)
- Event emissions (public)

**Share with team/community**:
- Tenderly dashboard link
- Contract addresses
- Mock USDC faucet (if implemented)
- Testing instructions

## Troubleshooting

### Gas Estimation Failed
- **Cause**: RPC issue or insufficient balance
- **Fix**: Try different RPC or add more ETH to deployer

### Verification Failed
- **Cause**: Etherscan API timeout or wrong constructor args
- **Fix**: Use manual verification command above

### Transaction Underpriced
- **Cause**: Network congestion
- **Fix**: Add `--with-gas-price $(cast gas-price --rpc-url $RPC_URL)` or use `--slow`

### Contract Already Deployed
- **Cause**: Previous deployment at same nonce
- **Fix**: Use `--resume` flag or deploy from different address

## Security Checklist

Before mainnet deployment:

- [ ] **Audit**: Contract code professionally audited
- [ ] **Tests**: 100% passing with good coverage
- [ ] **Keys**: Use hardware wallet or secure key management
- [ ] **Addresses**: All addresses verified (USDC, fee recipient, etc.)
- [ ] **Limits**: Vault cap appropriate for launch
- [ ] **Ownership**: Plan for multisig transfer
- [ ] **Oracle**: CRE workflow tested and ready
- [ ] **Monitoring**: Block explorer alerts configured
- [ ] **Recovery**: Emergency procedures documented

## Cost Estimates

### Ethereum Mainnet Gas Costs
| Operation | Estimated Gas | Cost @ 30 gwei |
|-----------|--------------|----------------|
| Deploy MockUSDC | ~1,200,000 | ~0.036 ETH |
| Deploy UnderwriterVault | ~2,500,000 | ~0.075 ETH |
| Deploy PolicyManager | ~3,000,000 | ~0.090 ETH |
| **Total (with mock)** | **~6,700,000** | **~0.20 ETH** |
| **Total (no mock)** | **~5,500,000** | **~0.165 ETH** |

*Actual costs vary with gas prices*

### Tenderly Testnet
- **Cost**: Free (virtual testnet)

## Resources

- **Etherscan**: https://etherscan.io
- **Tenderly**: https://dashboard.tenderly.co
- **USDC Info**: https://www.circle.com/en/usdc
- **Foundry Docs**: https://book.getfoundry.sh
- **CRE Setup**: See `cre_chainlink/parametrix/payout_trigger/CRE_SETUP.md`

## Support

For deployment issues:
1. Check Tenderly first (free testing)
2. Verify all env variables
3. Review transaction logs with `-vvvv`
4. Test with `--slow` flag for timing issues
