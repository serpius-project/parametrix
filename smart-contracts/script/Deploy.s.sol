// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Script, console} from "forge-std/Script.sol";
import {underwriterVault} from "../src/underwriterVault.sol";
import {policyManager, IUnderwriterVault} from "../src/policyManager.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

// Mock USDC for testing purposes
contract MockUSDC is ERC20 {
    constructor() ERC20("Mock USDC", "USDC") {
        // Mint initial supply to deployer
        _mint(msg.sender, 100_000_000 * 10**6); // 100M USDC (6 decimals)
    }

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

contract DeployScript is Script {
    // Deployment configuration
    struct Config {
        address assetToken;
        uint256 vaultCap;
        uint256 depositFeeBps;
        address feeRecipient;
        string vaultName;
        string vaultSymbol;
        string policyURI;
        bool deployMockToken;
    }

    function run() external {
        // Load configuration from environment or use defaults
        Config memory config = loadConfig();

        // Start broadcasting transactions
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        vm.startBroadcast(deployerPrivateKey);

        // Step 1: Deploy or use existing asset token
        IERC20 asset;
        if (config.deployMockToken) {
            console.log("Deploying Mock USDC...");
            asset = IERC20(address(new MockUSDC()));
            console.log("Mock USDC deployed at:", address(asset));
        } else {
            asset = IERC20(config.assetToken);
            console.log("Using existing asset token at:", address(asset));
        }

        // Step 2: Deploy UnderwriterVault
        console.log("\nDeploying UnderwriterVault...");
        underwriterVault vault = new underwriterVault(
            asset,
            config.vaultName,
            config.vaultSymbol,
            config.vaultCap,
            config.feeRecipient
        );
        console.log("UnderwriterVault deployed at:", address(vault));

        // Step 3: Deploy PolicyManager
        console.log("\nDeploying PolicyManager...");
        policyManager manager = new policyManager(
            asset,
            IUnderwriterVault(address(vault)),
            config.policyURI
        );
        console.log("PolicyManager deployed at:", address(manager));

        // Step 4: Connect contracts
        console.log("\nConnecting contracts...");
        vault.setPolicyManager(address(manager));
        console.log("PolicyManager set in vault");

        // Step 5: Set deposit fee if specified
        if (config.depositFeeBps > 0) {
            console.log("\nSetting deposit fee...");
            vault.setFee(config.depositFeeBps, config.feeRecipient);
            console.log("Fee set to:", config.depositFeeBps, "bps");
        }

        vm.stopBroadcast();

        // Print deployment summary
        console.log("\n=== DEPLOYMENT SUMMARY ===");
        console.log("Asset Token:", address(asset));
        console.log("UnderwriterVault:", address(vault));
        console.log("PolicyManager:", address(manager));
        console.log("Fee Recipient:", config.feeRecipient);
        console.log("Vault Cap:", config.vaultCap);
        console.log("Deposit Fee:", config.depositFeeBps, "bps");
        console.log("=========================\n");

        // Save deployment addresses to file
        string memory deploymentInfo = string.concat(
            "{\n",
            '  "asset": "', vm.toString(address(asset)), '",\n',
            '  "vault": "', vm.toString(address(vault)), '",\n',
            '  "policyManager": "', vm.toString(address(manager)), '",\n',
            '  "feeRecipient": "', vm.toString(config.feeRecipient), '",\n',
            '  "vaultCap": "', vm.toString(config.vaultCap), '",\n',
            '  "depositFeeBps": "', vm.toString(config.depositFeeBps), '"\n',
            "}"
        );

        vm.writeFile("deployments/latest.json", deploymentInfo);
        console.log("Deployment info saved to deployments/latest.json");
    }

    function loadConfig() internal view returns (Config memory) {
        // Try to load from environment variables, fallback to defaults
        Config memory config;

        // Check if we should deploy a mock token (default: true for testing)
        config.deployMockToken = vm.envOr("DEPLOY_MOCK_TOKEN", true);

        // Asset token address (only used if deployMockToken is false)
        config.assetToken = vm.envOr("ASSET_TOKEN", address(0));

        // Vault configuration
        config.vaultCap = vm.envOr("VAULT_CAP", uint256(10_000_000 * 10**6)); // 10M USDC default
        config.depositFeeBps = vm.envOr("DEPOSIT_FEE_BPS", uint256(50)); // 0.5% default
        config.feeRecipient = vm.envOr("FEE_RECIPIENT", msg.sender);

        // Vault token name and symbol
        config.vaultName = vm.envOr("VAULT_NAME", string("Parametrix Underwriter Vault"));
        config.vaultSymbol = vm.envOr("VAULT_SYMBOL", string("pUWV"));

        // Policy metadata URI
        config.policyURI = vm.envOr("POLICY_URI", string("https://api.parametrix.io/policy/{id}"));

        return config;
    }
}

// Separate script for testnet/mainnet deployment with verification
contract DeployProduction is Script {
    function run() external {
        require(!vm.envOr("DEPLOY_MOCK_TOKEN", false), "Cannot deploy mock token in production");

        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        address assetToken = vm.envAddress("ASSET_TOKEN");
        address feeRecipient = vm.envAddress("FEE_RECIPIENT");
        uint256 vaultCap = vm.envUint("VAULT_CAP");

        require(assetToken != address(0), "ASSET_TOKEN must be set");
        require(feeRecipient != address(0), "FEE_RECIPIENT must be set");

        vm.startBroadcast(deployerPrivateKey);

        // Deploy vault
        underwriterVault vault = new underwriterVault(
            IERC20(assetToken),
            "Parametrix Underwriter Vault",
            "pUWV",
            vaultCap,
            feeRecipient
        );

        // Deploy policy manager
        policyManager manager = new policyManager(
            IERC20(assetToken),
            IUnderwriterVault(address(vault)),
            "https://api.parametrix.io/policy/{id}"
        );

        // Connect contracts
        vault.setPolicyManager(address(manager));

        // Set fee
        vault.setFee(50, feeRecipient); // 0.5%

        vm.stopBroadcast();

        console.log("=== PRODUCTION DEPLOYMENT ===");
        console.log("UnderwriterVault:", address(vault));
        console.log("PolicyManager:", address(manager));
        console.log("=============================");
    }
}
