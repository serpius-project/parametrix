// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Script, console} from "forge-std/Script.sol";
import {underwriterVault} from "../src/underwriterVault.sol";
import {policyManager} from "../src/policyManager.sol";
import {FeeRateModel} from "../src/FeeRateModel.sol";
import {IUnderwriterVault} from "../src/IUnderwriterVault.sol";
import {IFeeRateModel} from "../src/IFeeRateModel.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

// ═══════════════════════════════════════════════════════════════════════════
// Step 1: Deploy contracts (run with --slow on Tenderly)
//
// Usage:
//   forge script script/Deploy.s.sol:DeployContracts \
//     --rpc-url $RPC_URL --broadcast --slow -vvvv
//
// Required env vars:
//   PRIVATE_KEY, ASSET_TOKEN, FEE_RECIPIENT,
//   UW_VAULT_CAP, JUNIOR_VAULT_CAP, SENIOR_VAULT_CAP
// ═══════════════════════════════════════════════════════════════════════════

contract DeployContracts is Script {
    function run() external {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        address assetToken = vm.envAddress("ASSET_TOKEN");
        address feeRecipient = vm.envAddress("FEE_RECIPIENT");
        uint256 uwCap = vm.envUint("UW_VAULT_CAP");
        uint256 jrCap = vm.envUint("JUNIOR_VAULT_CAP");
        // Senior cap auto-linked from junior cap: senior = junior * 3 (based on uTargetBps = 2500)
        uint256 srCap = (jrCap * 7500) / 2500;
        string memory policyURI = vm.envOr("POLICY_URI", string("https://api.parametrix.io/policy/{id}"));

        require(assetToken != address(0), "ASSET_TOKEN must be set");
        require(feeRecipient != address(0), "FEE_RECIPIENT must be set");

        vm.startBroadcast(deployerPrivateKey);

        // Deploy three vaults
        underwriterVault uwVault = new underwriterVault(
            IERC20(assetToken), "Parametrix Underwriter Vault", "pUWV", uwCap, feeRecipient
        );
        underwriterVault jrVault = new underwriterVault(
            IERC20(assetToken), "Parametrix Junior Vault", "pJNR", jrCap, feeRecipient
        );
        underwriterVault srVault = new underwriterVault(
            IERC20(assetToken), "Parametrix Senior Vault", "pSNR", srCap, feeRecipient
        );

        // Deploy FeeRateModel
        FeeRateModel feeModel = new FeeRateModel(jrCap);

        // Deploy PolicyManager
        policyManager manager = new policyManager(
            IERC20(assetToken),
            IUnderwriterVault(address(uwVault)),
            IUnderwriterVault(address(jrVault)),
            IUnderwriterVault(address(srVault)),
            IFeeRateModel(address(feeModel)),
            policyURI
        );

        vm.stopBroadcast();

        // Save deployment addresses
        string memory part1 = string.concat(
            "{\n",
            '  "asset": "', vm.toString(assetToken), '",\n',
            '  "underwriterVault": "', vm.toString(address(uwVault)), '",\n',
            '  "juniorVault": "', vm.toString(address(jrVault)), '",\n',
            '  "seniorVault": "', vm.toString(address(srVault)), '",\n'
        );
        string memory part2 = string.concat(
            '  "feeRateModel": "', vm.toString(address(feeModel)), '",\n',
            '  "policyManager": "', vm.toString(address(manager)), '",\n',
            '  "feeRecipient": "', vm.toString(feeRecipient), '",\n'
        );
        string memory part3 = string.concat(
            '  "underwriterVaultCap": "', vm.toString(uwCap), '",\n',
            '  "juniorVaultCap": "', vm.toString(jrCap), '",\n',
            '  "seniorVaultCap": "', vm.toString(srCap), '"\n',
            "}"
        );
        vm.writeFile("deployments/latest.json", string.concat(part1, part2, part3));

        console.log("=== DEPLOYMENT COMPLETE ===");
        console.log("Asset:           ", assetToken);
        console.log("UnderwriterVault:", address(uwVault));
        console.log("JuniorVault:     ", address(jrVault));
        console.log("SeniorVault:     ", address(srVault));
        console.log("FeeRateModel:    ", address(feeModel));
        console.log("PolicyManager:   ", address(manager));
        console.log("===========================");
        console.log("Saved to deployments/latest.json");
        console.log("Now run ConfigureContracts (without --slow)");
    }
}

// ═══════════════════════════════════════════════════════════════════════════
// Step 2: Configure contracts (run WITHOUT --slow, all calls are independent)
//
// Usage:
//   forge script script/Deploy.s.sol:ConfigureContracts \
//     --rpc-url $RPC_URL --broadcast -vvvv
//
// Reads addresses from deployments/latest.json.
// Optional env vars: DEPOSIT_FEE_BPS, AAVE_POOL, AAVE_AUSDC, *_AAVE_TARGET_BPS
// ═══════════════════════════════════════════════════════════════════════════

contract ConfigureContracts is Script {
    function run() external {
        // Read deployed addresses from deployments/latest.json
        string memory json = vm.readFile("deployments/latest.json");
        address uwAddr = vm.parseJsonAddress(json, ".underwriterVault");
        address jrAddr = vm.parseJsonAddress(json, ".juniorVault");
        address srAddr = vm.parseJsonAddress(json, ".seniorVault");
        address pmAddr = vm.parseJsonAddress(json, ".policyManager");

        underwriterVault uwVault = underwriterVault(uwAddr);
        underwriterVault jrVault = underwriterVault(jrAddr);
        underwriterVault srVault = underwriterVault(srAddr);

        // Read config from env + json
        uint256 depositFeeBps = vm.envOr("DEPOSIT_FEE_BPS", uint256(50));
        address feeRecipient = vm.parseJsonAddress(json, ".feeRecipient");
        address aavePool = vm.envOr("AAVE_POOL", address(0));
        address aaveAToken = vm.envOr("AAVE_AUSDC", address(0));
        uint256 uwAaveBps = vm.envOr("UW_AAVE_TARGET_BPS", uint256(7000));
        uint256 jrAaveBps = vm.envOr("JR_AAVE_TARGET_BPS", uint256(7000));
        uint256 srAaveBps = vm.envOr("SR_AAVE_TARGET_BPS", uint256(7000));

        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        vm.startBroadcast(deployerPrivateKey);

        // Wire vaults to PolicyManager
        uwVault.setPolicyManager(pmAddr);
        jrVault.setPolicyManager(pmAddr);
        srVault.setPolicyManager(pmAddr);
        console.log("PolicyManager set on all vaults");

        // Set capManager on junior and senior
        jrVault.setCapManager(pmAddr);
        srVault.setCapManager(pmAddr);
        console.log("CapManager set on junior and senior vaults");

        // Set deposit fees
        if (depositFeeBps > 0) {
            uwVault.setFee(depositFeeBps, feeRecipient);
            jrVault.setFee(depositFeeBps, feeRecipient);
            srVault.setFee(depositFeeBps, feeRecipient);
            console.log("Fee set to:", depositFeeBps, "bps");
        }

        // Configure Aave if pool address provided
        if (aavePool != address(0)) {
            uwVault.setAavePool(aavePool, aaveAToken);
            uwVault.setAaveTargetBps(uwAaveBps);
            uwVault.setAaveEnabled(true);

            jrVault.setAavePool(aavePool, aaveAToken);
            jrVault.setAaveTargetBps(jrAaveBps);
            jrVault.setAaveEnabled(true);

            srVault.setAavePool(aavePool, aaveAToken);
            srVault.setAaveTargetBps(srAaveBps);
            srVault.setAaveEnabled(true);

            console.log("Aave configured:");
            console.log("  UW target:", uwAaveBps, "bps");
            console.log("  JR target:", jrAaveBps, "bps");
            console.log("  SR target:", srAaveBps, "bps");
        }

        vm.stopBroadcast();
        console.log("\nAll contracts configured successfully");
    }
}
