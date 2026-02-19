# Parametrix Deployment Quick Start

**Networks**: Ethereum Mainnet (production) + Tenderly Mainnet Fork (development)
**Token**: USDC (`0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48` on both!)

---

## 📁 Updated Files

All deployment documentation and configuration files have been updated:

### Smart Contracts
- ✅ [smart-contracts/script/DEPLOYMENT.md](smart-contracts/script/DEPLOYMENT.md) - Full deployment guide
- ✅ [smart-contracts/script/README.md](smart-contracts/script/README.md) - Quick reference
- ✅ [smart-contracts/.env](smart-contracts/.env) - Network configuration

### CRE Workflow
- ✅ [cre_chainlink/parametrix/.env](cre_chainlink/parametrix/.env) - CRE authentication
- ✅ [cre_chainlink/parametrix/payout_trigger/config.production.json](cre_chainlink/parametrix/payout_trigger/config.production.json) - Mainnet config
- ✅ [cre_chainlink/parametrix/payout_trigger/config.staging.json](cre_chainlink/parametrix/payout_trigger/config.staging.json) - Tenderly config

---

## 🚀 Deployment Steps

### 1️⃣ Configure Environment

Edit `smart-contracts/.env`:

```bash
# Add your keys
PRIVATE_KEY=your_deployer_private_key
MAINNET_RPC_URL=https://eth-mainnet.g.alchemy.com/v2/YOUR_KEY
TENDERLY_RPC_URL=https://rpc.vnet.tenderly.co/devnet/YOUR_DEVNET_ID
ETHERSCAN_API_KEY=your_etherscan_api_key
FEE_RECIPIENT=your_fee_recipient_address
```

### 2️⃣ Deploy to Tenderly (Test First)

**✨ Mainnet Fork**: Tenderly is a mainnet fork, so USDC already exists!

```bash
cd smart-contracts

# Deploy with real USDC (already exists on fork at mainnet address!)
forge script script/Deploy.s.sol:DeployScript \
  --rpc-url $TENDERLY_RPC_URL \
  --broadcast \
  -vvvv
```

**After deployment**:
1. Save contract addresses
2. Use Tenderly dashboard to mint test USDC to wallets
3. Test with real USDC contract behavior!
4. Share Tenderly link with community for public testing

### 3️⃣ Deploy to Mainnet (Production)

```bash
# ⚠️  Make sure ASSET_TOKEN=0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48 in .env
# ⚠️  Make sure DEPLOY_MOCK_TOKEN=false in .env
# ⚠️  Have ~0.05 ETH in deployer wallet

forge script script/Deploy.s.sol:DeployProduction \
  --rpc-url $MAINNET_RPC_URL \
  --broadcast \
  --verify \
  --slow \
  -vvvv
```

### 4️⃣ Configure CRE Workflow

Edit config files with deployed PolicyManager address:

**For Mainnet** - Edit `cre_chainlink/parametrix/payout_trigger/config.production.json`:
```json
{
  "evms": [{
    "policyManagerAddress": "YOUR_DEPLOYED_ADDRESS_FROM_MAINNET",
    "chainSelectorName": "ethereum-mainnet"
  }]
}
```

**For Tenderly** - Edit `cre_chainlink/parametrix/payout_trigger/config.staging.json`:
```json
{
  "evms": [{
    "policyManagerAddress": "YOUR_DEPLOYED_ADDRESS_FROM_TENDERLY",
    "chainSelectorName": "ethereum-testnet-sepolia"
  }]
}
```

### 5️⃣ Deploy CRE Workflow

```bash
cd cre_chainlink/parametrix/payout_trigger

# Install and compile
bun install
bun x cre-setup

# Deploy to staging (Tenderly)
cre workflow deploy --config workflow.yaml --target staging-settings

# Deploy to production (Mainnet)
cre workflow deploy --config workflow.yaml --target production-settings
```

### 6️⃣ Set Oracle Address

Get DON address from CRE deployment, then:

```bash
# For mainnet
cast send <POLICY_MANAGER_ADDRESS> \
  "setOracle(address)" \
  <DON_ADDRESS> \
  --rpc-url $MAINNET_RPC_URL \
  --private-key $PRIVATE_KEY

# For Tenderly
cast send <POLICY_MANAGER_ADDRESS> \
  "setOracle(address)" \
  <DON_ADDRESS> \
  --rpc-url $TENDERLY_RPC_URL \
  --private-key $PRIVATE_KEY
```

---

## 🔑 Key Addresses

### Ethereum Mainnet
- **USDC**: `0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48`
- **Chain ID**: 1
- **Explorer**: https://etherscan.io

### Tenderly Mainnet Fork (Public)
- **USDC**: `0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48` (same as mainnet!)
- **Type**: Full mainnet fork - all contracts exist
- **Chain ID**: Custom (from dashboard)
- **Explorer**: Tenderly dashboard
- **Visibility**: ⚠️ **Public** - Anyone can view/interact
- **Advantage**: Test with real USDC contract

---

## 📊 Configuration Summary

| Setting | Mainnet | Tenderly Fork |
|---------|---------|---------------|
| **Asset Token** | USDC `0xA0b8...B48` | USDC `0xA0b8...B48` (same!) |
| **Deploy Mock** | `false` | `false` (USDC exists!) |
| **Vault Cap** | 10M USDC | 10M USDC |
| **Deposit Fee** | 0.5% | 0.5% |
| **CRE Check Frequency** | Every 5 min | Every 2 min |
| **Chain Selector** | `ethereum-mainnet` | `ethereum-testnet-sepolia` |

---

## ✅ Post-Deployment Checklist

- [ ] Smart contracts deployed to both networks
- [ ] Deployment addresses saved
- [ ] CRE configs updated with PolicyManager addresses
- [ ] CRE workflow deployed to DON
- [ ] Oracle address set in PolicyManager
- [ ] Ownership transferred to multisig (mainnet only)
- [ ] Initial vault deposit made (mainnet)
- [ ] End-to-end test performed

---

## 📚 Documentation

- **Full Deployment Guide**: [smart-contracts/script/DEPLOYMENT.md](smart-contracts/script/DEPLOYMENT.md)
- **CRE Workflow README**: [cre_chainlink/parametrix/payout_trigger/README.md](cre_chainlink/parametrix/payout_trigger/README.md)

---

## 🆘 Quick Troubleshooting

**Gas estimation failed?**
```bash
# Check deployer balance
cast balance <YOUR_ADDRESS> --rpc-url $MAINNET_RPC_URL
```

**Verification failed?**
```bash
# Verify manually
forge verify-contract <ADDRESS> <CONTRACT> --chain-id 1 --etherscan-api-key $ETHERSCAN_API_KEY
```

**Can't find deployed addresses?**
```bash
# Check deployment output
cat deployments/latest.json
```

---

## 🎯 Test Flow

1. **Deploy to Tenderly** → Test all functionality
2. **Deploy CRE to staging** → Verify policy monitoring works
3. **Test policy purchase** → Ensure shares reserved correctly
4. **Simulate weather trigger** → Verify payout execution
5. **Deploy to Mainnet** → Production deployment
6. **Deploy CRE to production** → Production oracle
7. **Transfer ownership** → Secure with multisig

---

**Ready to deploy! 🚀**
