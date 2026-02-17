// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Script, console} from "forge-std/Script.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {policyManager} from "../src/policyManager.sol";

/**
 * @title BuyPolicyScript
 * @notice Simulates a real user buying a parametric insurance policy.
 *         Assumes contracts are already deployed.
 *
 * Configuration: edit the constants below after running Deploy.s.sol.
 * Addresses are printed to the console and saved in deployments/latest.json.
 *
 * Required .env variable:
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
    address constant POLICY_MANAGER_ADDRESS = address(0x29FbE48c63B2877C155F45E7CA176F3e664aE672);
    address constant ASSET_TOKEN_ADDRESS    = address(0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48); 

    // ── Policy configuration ─────────────────────────────────────────────────
    uint8   constant HAZARD_TYPE        = 0;     // 0=Heatwave  1=Flood  2=Drought
    uint256 constant DURATION_DAYS      = 30;    // Policy length in days
    uint256 constant MAX_COVERAGE_USDC  = 1000;  // Max payout in whole USDC ($1,000)
    uint256 constant PREMIUM_USDC       = 50;    // Premium in whole USDC ($50)
    uint256 constant TRIGGER_THRESHOLD  = 35;    // e.g. 35°C for heatwave

    // ── Internal ─────────────────────────────────────────────────────────────
    string[3] private HAZARD_NAMES = ["Heatwave", "Flood", "Drought"];

    function run() external {
        require(POLICY_MANAGER_ADDRESS != address(0), "Set POLICY_MANAGER_ADDRESS in BuyPolicy.s.sol");
        require(ASSET_TOKEN_ADDRESS    != address(0), "Set ASSET_TOKEN_ADDRESS in BuyPolicy.s.sol");

        uint256 userPrivateKey = vm.envUint("USER_PRIVATE_KEY");
        address user           = vm.addr(userPrivateKey);

        uint256 maxCoverage = MAX_COVERAGE_USDC * 10**6;
        uint256 premium     = PREMIUM_USDC      * 10**6;

        policyManager manager = policyManager(POLICY_MANAGER_ADDRESS);

        console.log("\n=== BUY POLICY SCRIPT ===");
        console.log("User wallet:      ", user);
        console.log("PolicyManager:    ", POLICY_MANAGER_ADDRESS);
        console.log("Asset token:      ", ASSET_TOKEN_ADDRESS);
        console.log("Hazard:           ", HAZARD_NAMES[HAZARD_TYPE]);
        console.log("Duration (days):  ", DURATION_DAYS);
        console.log("Max coverage:     ", MAX_COVERAGE_USDC, "USDC");
        console.log("Premium:          ", PREMIUM_USDC, "USDC");
        console.log("Trigger threshold:", TRIGGER_THRESHOLD);
        console.log("=========================\n");

        // ── Step 1: Approve + Buy Policy ────────────────────────────────────
        // The user approves PolicyManager to pull the premium, then calls buyPolicy().
        // Inside buyPolicy(): transferFrom(user -> PolicyManager) then deposit(-> Vault)
        vm.startBroadcast(userPrivateKey);

        uint256 balanceBefore = IERC20(ASSET_TOKEN_ADDRESS).balanceOf(user);
        console.log("User USDC balance before:", balanceBefore / 10**6, "USDC");
        require(balanceBefore >= premium, "Insufficient USDC - set MINT_MOCK_USDC=true or fund the wallet");

        IERC20(ASSET_TOKEN_ADDRESS).approve(POLICY_MANAGER_ADDRESS, premium);
        console.log("Approved PolicyManager to spend", PREMIUM_USDC, "USDC");

        uint256 policyId = manager.buyPolicy(
            HAZARD_TYPE,
            DURATION_DAYS,
            maxCoverage,
            premium,
            TRIGGER_THRESHOLD,
            user
        );

        vm.stopBroadcast();

        // ── Step 3: Print results ───────────────────────────────────────────
        uint256 balanceAfter = IERC20(ASSET_TOKEN_ADDRESS).balanceOf(user);

        (
            uint8  storedHazard,
            uint40 start,
            uint40 end,
            uint256 storedMaxCoverage,
            uint256 storedPremium,
            uint256 storedThreshold,
            bool paid
        ) = manager.policies(policyId);

        console.log("\n=== POLICY PURCHASED ===");
        console.log("Policy ID:        ", policyId);
        console.log("Hazard:           ", HAZARD_NAMES[storedHazard]);
        console.log("Start timestamp:  ", start);
        console.log("End timestamp:    ", end);
        console.log("Expires in days:  ", DURATION_DAYS);
        console.log("Max coverage:     ", storedMaxCoverage / 10**6, "USDC");
        console.log("Premium paid:     ", storedPremium / 10**6, "USDC");
        console.log("Trigger threshold:", storedThreshold);
        console.log("Already paid out: ", paid);
        console.log("Policy holder:    ", manager.holderOf(policyId));
        console.log("User balance now: ", balanceAfter / 10**6, "USDC");
        console.log("========================\n");

        console.log("SUCCESS: Policy", policyId, "is active.");
    }
}
