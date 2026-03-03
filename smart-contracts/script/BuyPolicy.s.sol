// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Script, console} from "forge-std/Script.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {policyManager} from "../src/policyManager.sol";

/**
 * @title BuyPolicyScript
 * @notice Buys a Flood policy with threshold=1 (always triggers), then
 *         temporarily sets the oracle to the owner to verify the policy,
 *         and restores the original oracle address afterwards.
 *
 * Required .env variables:
 *   PRIVATE_KEY       - Owner/deployer private key (for setOracle + verifyPolicy)
 *   USER_PRIVATE_KEY  - Private key of the policy buyer wallet
 *
 * Usage:
 *   forge script script/BuyPolicy.s.sol:BuyPolicyScript \
 *     --rpc-url $TENDERLY_RPC_URL \
 *     --broadcast \
 *     -vvvv
 */
contract BuyPolicyScript is Script {

    // ── Update these after running Deploy.s.sol ─────────────────────────────
    address constant POLICY_MANAGER_ADDRESS = address(0xEfC0E3ff32A6e71D7661062E9F444D919F4b17e4);
    address constant ASSET_TOKEN_ADDRESS    = address(0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48);

    // ── Policy configuration ─────────────────────────────────────────────────
    uint8   constant HAZARD_TYPE        = 0;     // 0=Heatwave  1=Flood  2=Drought
    uint256 constant DURATION_DAYS      = 90;    // Policy length in days
    uint256 constant MAX_COVERAGE_USDC  = 10000;  // Max payout in whole USDC ($1,000)
    uint256 constant PREMIUM_USDC       = 5000;    // Premium in whole USDC ($50)
    int256  constant TRIGGER_THRESHOLD  = 1;     // Threshold=1 so it always triggers
    int32   constant LAT                = 473780;   // 47.3780° (Zurich) × 10 000
    int32   constant LON                = 85404;    //  8.5404° × 10 000

    // ── Internal ─────────────────────────────────────────────────────────────
    string[3] private HAZARD_NAMES = ["Heatwave", "Flood", "Drought"];

    function run() external {
        require(POLICY_MANAGER_ADDRESS != address(0), "Set POLICY_MANAGER_ADDRESS in BuyPolicy.s.sol");
        require(ASSET_TOKEN_ADDRESS    != address(0), "Set ASSET_TOKEN_ADDRESS in BuyPolicy.s.sol");

        uint256 ownerPrivateKey = vm.envUint("PRIVATE_KEY");
        uint256 userPrivateKey  = vm.envUint("USER_PRIVATE_KEY");
        address owner           = vm.addr(ownerPrivateKey);
        address user            = vm.addr(userPrivateKey);

        uint256 maxCoverage = MAX_COVERAGE_USDC * 10**6;
        uint256 premium     = PREMIUM_USDC      * 10**6;

        policyManager manager = policyManager(POLICY_MANAGER_ADDRESS);

        console.log("\n=== BUY POLICY SCRIPT ===");
        console.log("Owner wallet:     ", owner);
        console.log("User wallet:      ", user);
        console.log("PolicyManager:    ", POLICY_MANAGER_ADDRESS);
        console.log("Asset token:      ", ASSET_TOKEN_ADDRESS);
        console.log("Hazard:           ", HAZARD_NAMES[HAZARD_TYPE]);
        console.log("Duration (days):  ", DURATION_DAYS);
        console.log("Max coverage:     ", MAX_COVERAGE_USDC, "USDC");
        console.log("Premium:          ", PREMIUM_USDC, "USDC");
        console.log("Trigger threshold:", TRIGGER_THRESHOLD);
        console.log("=========================\n");

        // ── Step 1: Approve + Buy Policy ──────────────────────────────────────
        vm.startBroadcast(userPrivateKey);

        uint256 balanceBefore = IERC20(ASSET_TOKEN_ADDRESS).balanceOf(user);
        console.log("User USDC balance before:", balanceBefore / 10**6, "USDC");
        require(balanceBefore >= premium, "Insufficient USDC - fund the wallet via Tenderly dashboard");

        IERC20(ASSET_TOKEN_ADDRESS).approve(POLICY_MANAGER_ADDRESS, premium);
        console.log("Approved PolicyManager to spend", PREMIUM_USDC, "USDC");

        uint256 policyId = manager.buyPolicy(
            HAZARD_TYPE,
            DURATION_DAYS,
            maxCoverage,
            premium,
            TRIGGER_THRESHOLD,
            user,
            LAT,
            LON
        );

        vm.stopBroadcast();

        console.log("\n=== POLICY PURCHASED ===");
        console.log("Policy ID:        ", policyId);
        console.log("Status:            Unverified (0)");

        // ── Step 2: Verify the policy as owner ────────────────────────────────
        // Save current oracle, set owner as oracle, verify, restore original
        address originalOracle = manager.oracle();
        console.log("\n=== VERIFYING POLICY ===");
        console.log("Current oracle:   ", originalOracle);

        vm.startBroadcast(ownerPrivateKey);

        // Set owner as oracle so we can call verifyPolicy
        manager.setOracle(owner);
        console.log("Oracle set to:    ", owner);

        // Verify the policy
        manager.verifyPolicy(policyId);
        console.log("Policy", policyId, "verified!");

        // Restore original oracle (address(0) if none was set)
        manager.setOracle(originalOracle);
        console.log("Oracle restored to:", originalOracle);

        vm.stopBroadcast();

        // ── Step 3: Print results ─────────────────────────────────────────────
        uint256 balanceAfter = IERC20(ASSET_TOKEN_ADDRESS).balanceOf(user);

        (
            uint8  storedHazard,
            uint40 start,
            uint40 end,
            ,  // lat
            ,  // lon
            uint256 storedMaxCoverage,
            uint256 storedPremium,
            int256 storedThreshold,
            bool paid
        ) = manager.policies(policyId);

        uint8 status = uint8(manager.policyStatus(policyId));

        console.log("\n=== FINAL POLICY STATE ===");
        console.log("Policy ID:        ", policyId);
        console.log("Hazard:           ", HAZARD_NAMES[storedHazard]);
        console.log("Start timestamp:  ", start);
        console.log("End timestamp:    ", end);
        console.log("Expires in days:  ", DURATION_DAYS);
        console.log("Max coverage:     ", storedMaxCoverage / 10**6, "USDC");
        console.log("Premium paid:     ", storedPremium / 10**6, "USDC");
        console.log("Trigger threshold:", storedThreshold);
        console.log("Status:           ", status == 1 ? "Verified" : "NOT Verified");
        console.log("Already paid out: ", paid);
        console.log("Policy holder:    ", manager.holderOf(policyId));
        console.log("User balance now: ", balanceAfter / 10**6, "USDC");
        console.log("==========================\n");

        console.log("SUCCESS: Policy", policyId, "is VERIFIED and ready for payout trigger.");
    }
}
