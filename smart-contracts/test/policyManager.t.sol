// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.20;

import {Test, console} from "forge-std/Test.sol";
import {policyManager, IUnderwriterVault} from "../src/policyManager.sol";
import {underwriterVault} from "../src/underwriterVault.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

contract MockERC20 is ERC20 {
    constructor() ERC20("Mock USDC", "USDC") {
        _mint(msg.sender, 10_000_000 * 10**18);
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

contract PolicyManagerTest is Test {
    policyManager public manager;
    underwriterVault public vault;
    MockERC20 public asset;

    address public owner = address(this);
    address public oracle;
    address public feeRecipient = address(0x2);
    address public alice = address(0x3);
    address public bob = address(0x4);
    address public underwriter = address(0x5);

    uint256 constant VAULT_CAP = 10_000_000 * 10**18;
    uint256 constant UNDERWRITER_DEPOSIT = 1_000_000 * 10**18;

    function setUp() public {
        oracle = address(this);

        // Deploy asset
        asset = new MockERC20();

        // Deploy vault
        vault = new underwriterVault(
            asset,
            "Parametrix Vault",
            "PRMX",
            VAULT_CAP,
            feeRecipient
        );

        // Deploy policy manager
        manager = new policyManager(
            asset,
            IUnderwriterVault(address(vault)),
            "https://api.parametrix.com/policy/{id}"
        );

        // Set policy manager in vault
        vault.setPolicyManager(address(manager));

        // Setup underwriter liquidity
        asset.mint(underwriter, UNDERWRITER_DEPOSIT);
        vm.startPrank(underwriter);
        asset.approve(address(vault), UNDERWRITER_DEPOSIT);
        vault.deposit(UNDERWRITER_DEPOSIT, underwriter);
        vm.stopPrank();

        // Setup test users
        asset.mint(alice, 100_000 * 10**18);
        asset.mint(bob, 100_000 * 10**18);

        vm.label(alice, "Alice");
        vm.label(bob, "Bob");
        vm.label(underwriter, "Underwriter");
        vm.label(oracle, "Oracle");
    }

    /* ============ Hazard Management Tests ============ */

    function test_DefaultHazardsInitialized() public view {
        assertTrue(manager.validHazards(0), "Heatwave should be valid");
        assertTrue(manager.validHazards(1), "Flood should be valid");
        assertTrue(manager.validHazards(2), "Drought should be valid");

        assertEq(manager.hazardNames(0), "Heatwave", "Heatwave name mismatch");
        assertEq(manager.hazardNames(1), "Flood", "Flood name mismatch");
        assertEq(manager.hazardNames(2), "Drought", "Drought name mismatch");
    }

    function test_AddHazardType() public {
        manager.addHazardType(3, "Earthquake");

        assertTrue(manager.validHazards(3), "Earthquake should be valid");
        assertEq(manager.hazardNames(3), "Earthquake", "Earthquake name mismatch");
    }

    function test_AddHazardTypeRevertsIfAlreadyExists() public {
        vm.expectRevert(bytes("hazard already exists"));
        manager.addHazardType(0, "Heatwave");
    }

    function test_AddHazardTypeRevertsIfNotOwner() public {
        vm.prank(alice);
        vm.expectRevert();
        manager.addHazardType(3, "Earthquake");
    }

    function test_RemoveHazardType() public {
        manager.removeHazardType(2); // Remove Drought

        assertFalse(manager.validHazards(2), "Drought should be invalid");
    }

    function test_RemoveHazardTypeRevertsIfDoesntExist() public {
        vm.expectRevert(bytes("hazard doesn't exist"));
        manager.removeHazardType(99);
    }

    function test_BuyPolicyWithNewHazardType() public {
        // Add new hazard type
        manager.addHazardType(3, "Earthquake");

        uint256 premium = 1000 * 10**18;
        uint256 maxCoverage = 10_000 * 10**18;

        vm.startPrank(alice);
        asset.approve(address(manager), premium);
        uint256 policyId = manager.buyPolicy(
            3, // Earthquake
            30,
            maxCoverage,
            premium,
            6, // Magnitude 6.0 trigger
            alice
        );
        vm.stopPrank();

        assertEq(policyId, 1, "First policy should be ID 1");
        (uint8 hazard, , , , , , ) = manager.policies(policyId);
        assertEq(hazard, 3, "Policy should have Earthquake hazard");
    }

    function test_BuyPolicyRevertsWithInvalidHazard() public {
        uint256 premium = 1000 * 10**18;

        vm.startPrank(alice);
        asset.approve(address(manager), premium);
        vm.expectRevert(bytes("invalid hazard type"));
        manager.buyPolicy(
            99, // Invalid hazard
            30,
            10_000 * 10**18,
            premium,
            35,
            alice
        );
        vm.stopPrank();
    }

    function test_BuyPolicyRevertsWithRemovedHazard() public {
        // Remove a hazard
        manager.removeHazardType(2); // Remove Drought

        uint256 premium = 1000 * 10**18;

        vm.startPrank(alice);
        asset.approve(address(manager), premium);
        vm.expectRevert(bytes("invalid hazard type"));
        manager.buyPolicy(
            2, // Drought (removed)
            30,
            10_000 * 10**18,
            premium,
            35,
            alice
        );
        vm.stopPrank();
    }

    /* ============ Policy Purchase Tests ============ */

    function test_BuyPolicy() public {
        uint256 premium = 1000 * 10**18;
        uint256 maxCoverage = 10_000 * 10**18;

        vm.startPrank(alice);
        asset.approve(address(manager), premium);
        uint256 policyId = manager.buyPolicy(
            0,
            30, // 30 days
            maxCoverage,
            premium,
            35, // 35°C trigger threshold
            alice
        );
        vm.stopPrank();

        assertEq(policyId, 1, "First policy should be ID 1");
        assertEq(manager.balanceOf(alice, policyId), 1, "Alice should own the policy");
        assertEq(manager.holderOf(policyId), alice, "Holder should be Alice");

        // Check shares were reserved
        uint256 reserved = manager.reservedShares(policyId);
        assertGt(reserved, 0, "Shares should be reserved");
        assertEq(vault.totalReservedShares(), reserved, "Vault should track reserved shares");
    }

    function test_BuyMultiplePolicies() public {
        policyManager.PolicyInput[] memory inputs = new policyManager.PolicyInput[](2);
        inputs[0] = policyManager.PolicyInput({
            hazard: 0,
            durationDays: 30,
            maxCoverage: 10_000 * 10**18,
            premium: 1000 * 10**18,
            triggerThreshold: 35
        });
        inputs[1] = policyManager.PolicyInput({
            hazard: 1,
            durationDays: 60,
            maxCoverage: 20_000 * 10**18,
            premium: 2000 * 10**18,
            triggerThreshold: 100
        });

        uint256 totalPremium = 3000 * 10**18;

        vm.startPrank(alice);
        asset.approve(address(manager), totalPremium);
        uint256[] memory policyIds = manager.buyPolicies(inputs, alice);
        vm.stopPrank();

        assertEq(policyIds.length, 2, "Should create 2 policies");
        assertEq(manager.balanceOf(alice, policyIds[0]), 1, "Alice should own policy 1");
        assertEq(manager.balanceOf(alice, policyIds[1]), 1, "Alice should own policy 2");

        // Check total reserved shares
        uint256 totalReserved = manager.reservedShares(policyIds[0]) + manager.reservedShares(policyIds[1]);
        assertEq(vault.totalReservedShares(), totalReserved, "Total reserved shares should match");
    }

    function test_BuyPolicyDepositsPremiumToVault() public {
        uint256 vaultBalanceBefore = vault.balanceOf(address(manager));

        vm.startPrank(alice);
        asset.approve(address(manager), 1000 * 10**18);
        manager.buyPolicy(
            0,
            30,
            10_000 * 10**18,
            1000 * 10**18,
            35,
            alice
        );
        vm.stopPrank();

        uint256 vaultBalanceAfter = vault.balanceOf(address(manager));
        assertGt(vaultBalanceAfter, vaultBalanceBefore, "Premium should be deposited to vault");
    }

    /* ============ Payout Tests - Full Coverage ============ */

    function test_TriggerPayoutFullCoverage() public {
        // Alice buys policy
        uint256 premium = 1000 * 10**18;
        uint256 maxCoverage = 10_000 * 10**18;

        vm.startPrank(alice);
        asset.approve(address(manager), premium);
        uint256 policyId = manager.buyPolicy(
            0,
            30,
            maxCoverage,
            premium,
            35,
            alice
        );
        vm.stopPrank();

        // Get Alice's balance before payout
        uint256 aliceBalanceBefore = asset.balanceOf(alice);

        // Oracle triggers payout
        uint256 requestedPayout = 5000 * 10**18; // Less than maxCoverage
        manager.triggerPayout(policyId, 40, requestedPayout); // 40°C exceeds 35°C threshold

        // Check Alice received the payout
        uint256 aliceBalanceAfter = asset.balanceOf(alice);
        assertEq(aliceBalanceAfter - aliceBalanceBefore, requestedPayout, "Alice should receive full payout");

        // Check policy is marked as paid
        (, , , , , , bool paid) = manager.policies(policyId);
        assertTrue(paid, "Policy should be marked as paid");

        // Check shares were unreserved
        assertEq(manager.reservedShares(policyId), 0, "Reserved shares should be released");
        assertEq(vault.totalReservedShares(), 0, "No shares should be reserved");
    }

    /* ============ Payout Tests - Partial Coverage (Underfunded Vault) ============ */

    function test_TriggerPayoutPartialCoverageWhenUnderfunded() public {
        // Create multiple policies to drain most of the vault
        // This simulates a scenario where multiple claims happen and vault becomes underfunded
        uint256 numPolicies = 10;
        uint256[] memory policyIds = new uint256[](numPolicies);

        // Buy 10 policies, each with high coverage
        vm.startPrank(alice);
        for (uint i = 0; i < numPolicies; i++) {
            asset.mint(alice, 1000 * 10**18);
            asset.approve(address(manager), 1000 * 10**18);
            policyIds[i] = manager.buyPolicy(
                0,
                30,
                100_000 * 10**18, // 100k coverage each
                1000 * 10**18,
                35,
                alice
            );
        }
        vm.stopPrank();

        // Trigger payouts for first 9 policies to drain the vault
        for (uint i = 0; i < numPolicies - 1; i++) {
            manager.triggerPayout(policyIds[i], 40, 50_000 * 10**18); // Pay 50k each
        }

        // Now trigger the last policy - vault should be underfunded
        uint256 lastPolicyId = policyIds[numPolicies - 1];
        uint256 reserved = manager.reservedShares(lastPolicyId);
        uint256 actualAvailable = vault.previewRedeem(reserved);
        uint256 requestedPayout = 100_000 * 10**18;

        uint256 aliceBalanceBefore = asset.balanceOf(alice);

        // Trigger final payout
        manager.triggerPayout(lastPolicyId, 40, requestedPayout);

        uint256 aliceBalanceAfter = asset.balanceOf(alice);
        uint256 actualPayout = aliceBalanceAfter - aliceBalanceBefore;

        // Should receive less than requested due to vault being drained
        assertLt(actualPayout, requestedPayout, "Payout should be less than requested");
        assertApproxEqRel(actualPayout, actualAvailable, 0.02e18, "Should pay what shares are worth");
    }

    /* ============ Payout Validation Tests ============ */

    function test_TriggerPayoutRevertsIfNotOracle() public {
        vm.startPrank(alice);
        asset.approve(address(manager), 1000 * 10**18);
        uint256 policyId = manager.buyPolicy(
            0,
            30,
            10_000 * 10**18,
            1000 * 10**18,
            35,
            alice
        );
        vm.stopPrank();

        vm.prank(bob);
        vm.expectRevert(bytes("not oracle"));
        manager.triggerPayout(policyId, 40, 5000 * 10**18);
    }

    function test_TriggerPayoutRevertsIfAlreadyPaid() public {
        vm.startPrank(alice);
        asset.approve(address(manager), 1000 * 10**18);
        uint256 policyId = manager.buyPolicy(
            0,
            30,
            10_000 * 10**18,
            1000 * 10**18,
            35,
            alice
        );
        vm.stopPrank();

        // First payout succeeds
        manager.triggerPayout(policyId, 40, 5000 * 10**18);

        // Second payout should fail
        vm.expectRevert(bytes("paid"));
        manager.triggerPayout(policyId, 40, 5000 * 10**18);
    }

    function test_TriggerPayoutRevertsIfExpired() public {
        vm.startPrank(alice);
        asset.approve(address(manager), 1000 * 10**18);
        uint256 policyId = manager.buyPolicy(
            0,
            30,
            10_000 * 10**18,
            1000 * 10**18,
            35,
            alice
        );
        vm.stopPrank();

        // Warp time past expiration
        vm.warp(block.timestamp + 31 days);

        vm.expectRevert(bytes("expired"));
        manager.triggerPayout(policyId, 40, 5000 * 10**18);
    }

    function test_TriggerPayoutRevertsIfThresholdNotMet() public {
        vm.startPrank(alice);
        asset.approve(address(manager), 1000 * 10**18);
        uint256 policyId = manager.buyPolicy(
            0,
            30,
            10_000 * 10**18,
            1000 * 10**18,
            35,
            alice
        );
        vm.stopPrank();

        vm.expectRevert(bytes("no trigger"));
        manager.triggerPayout(policyId, 34, 5000 * 10**18); // 34°C < 35°C threshold
    }

    function test_TriggerPayoutRevertsIfPayoutExceedsMaxCoverage() public {
        vm.startPrank(alice);
        asset.approve(address(manager), 1000 * 10**18);
        uint256 policyId = manager.buyPolicy(
            0,
            30,
            10_000 * 10**18,
            1000 * 10**18,
            35,
            alice
        );
        vm.stopPrank();

        vm.expectRevert(bytes("too much"));
        manager.triggerPayout(policyId, 40, 11_000 * 10**18); // Exceeds maxCoverage
    }

    /* ============ Expired Policy Release Tests ============ */

    function test_ReleaseExpiredPolicy() public {
        vm.startPrank(alice);
        asset.approve(address(manager), 1000 * 10**18);
        uint256 policyId = manager.buyPolicy(
            0,
            30,
            10_000 * 10**18,
            1000 * 10**18,
            35,
            alice
        );
        vm.stopPrank();

        uint256 reserved = manager.reservedShares(policyId);
        assertGt(reserved, 0, "Shares should be reserved");

        // Warp time past expiration
        vm.warp(block.timestamp + 31 days);

        // Release expired policy
        manager.releaseExpiredPolicy(policyId);

        // Check shares were unreserved
        assertEq(manager.reservedShares(policyId), 0, "Reserved shares should be released");
        assertEq(vault.totalReservedShares(), 0, "No shares should be reserved");

        // Check policy is marked as paid (to prevent future claims)
        (, , , , , , bool paid) = manager.policies(policyId);
        assertTrue(paid, "Policy should be marked as paid");
    }

    function test_ReleaseExpiredPolicyRevertsIfNotExpired() public {
        vm.startPrank(alice);
        asset.approve(address(manager), 1000 * 10**18);
        uint256 policyId = manager.buyPolicy(
            0,
            30,
            10_000 * 10**18,
            1000 * 10**18,
            35,
            alice
        );
        vm.stopPrank();

        vm.expectRevert(bytes("not expired"));
        manager.releaseExpiredPolicy(policyId);
    }

    function test_ReleaseExpiredPoliciesBatch() public {
        // Create multiple policies
        uint256[] memory policyIds = new uint256[](3);

        vm.startPrank(alice);
        for (uint i = 0; i < 3; i++) {
            asset.approve(address(manager), 1000 * 10**18);
            policyIds[i] = manager.buyPolicy(
                0,
                30,
                10_000 * 10**18,
                1000 * 10**18,
                35,
                alice
            );
        }
        vm.stopPrank();

        uint256 totalReserved = vault.totalReservedShares();
        assertGt(totalReserved, 0, "Shares should be reserved");

        // Warp time past expiration
        vm.warp(block.timestamp + 31 days);

        // Release all expired policies
        manager.releaseExpiredPolicies(policyIds);

        // Check all shares were unreserved
        assertEq(vault.totalReservedShares(), 0, "All shares should be released");
    }

    /* ============ Policy Transfer Tests ============ */

    function test_TransferPolicy() public {
        vm.startPrank(alice);
        asset.approve(address(manager), 1000 * 10**18);
        uint256 policyId = manager.buyPolicy(
            0,
            30,
            10_000 * 10**18,
            1000 * 10**18,
            35,
            alice
        );

        // Transfer to Bob
        manager.safeTransferFrom(alice, bob, policyId, 1, "");
        vm.stopPrank();

        assertEq(manager.balanceOf(bob, policyId), 1, "Bob should own the policy");
        assertEq(manager.holderOf(policyId), bob, "Holder should be updated to Bob");
        assertEq(manager.balanceOf(alice, policyId), 0, "Alice should not own the policy");
    }

    function test_PayoutGoesToCurrentHolder() public {
        vm.startPrank(alice);
        asset.approve(address(manager), 1000 * 10**18);
        uint256 policyId = manager.buyPolicy(
            0,
            30,
            10_000 * 10**18,
            1000 * 10**18,
            35,
            alice
        );

        // Transfer to Bob
        manager.safeTransferFrom(alice, bob, policyId, 1, "");
        vm.stopPrank();

        uint256 bobBalanceBefore = asset.balanceOf(bob);
        uint256 requestedPayout = 5000 * 10**18;

        // Oracle triggers payout
        manager.triggerPayout(policyId, 40, requestedPayout);

        // Bob (current holder) should receive payout, not Alice
        uint256 bobBalanceAfter = asset.balanceOf(bob);
        assertEq(bobBalanceAfter - bobBalanceBefore, requestedPayout, "Bob should receive payout");
    }

    /* ============ Fuzz Tests ============ */

    function testFuzz_BuyPolicy(
        uint256 premium,
        uint256 maxCoverage,
        uint256 durationDays
    ) public {
        premium = bound(premium, 100 * 10**18, 10_000 * 10**18);
        maxCoverage = bound(maxCoverage, premium, 100_000 * 10**18);
        durationDays = bound(durationDays, 1, 365);

        asset.mint(alice, premium);

        vm.startPrank(alice);
        asset.approve(address(manager), premium);
        uint256 policyId = manager.buyPolicy(
            0,
            durationDays,
            maxCoverage,
            premium,
            35,
            alice
        );
        vm.stopPrank();

        assertGt(policyId, 0, "Policy ID should be valid");
        assertGt(manager.reservedShares(policyId), 0, "Shares should be reserved");
    }

    function testFuzz_TriggerPayout(
        uint256 premium,
        uint256 maxCoverage,
        uint256 requestedPayout
    ) public {
        premium = bound(premium, 1000 * 10**18, 10_000 * 10**18);
        maxCoverage = bound(maxCoverage, 10_000 * 10**18, 50_000 * 10**18);
        requestedPayout = bound(requestedPayout, 1000 * 10**18, maxCoverage);

        asset.mint(alice, premium);

        vm.startPrank(alice);
        asset.approve(address(manager), premium);
        uint256 policyId = manager.buyPolicy(
            0,
            30,
            maxCoverage,
            premium,
            35,
            alice
        );
        vm.stopPrank();

        uint256 aliceBalanceBefore = asset.balanceOf(alice);

        // Trigger payout
        manager.triggerPayout(policyId, 40, requestedPayout);

        uint256 aliceBalanceAfter = asset.balanceOf(alice);
        uint256 actualPayout = aliceBalanceAfter - aliceBalanceBefore;

        assertGt(actualPayout, 0, "Should receive some payout");
        assertLe(actualPayout, requestedPayout, "Should not exceed requested payout");
    }

    function testFuzz_MultipleUsersMultiplePolicies(uint8 numUsers, uint8 numPoliciesPerUser) public {
        numUsers = uint8(bound(numUsers, 1, 10));
        numPoliciesPerUser = uint8(bound(numPoliciesPerUser, 1, 5));

        for (uint8 i = 0; i < numUsers; i++) {
            address user = address(uint160(1000 + i));
            uint256 totalPremium = uint256(numPoliciesPerUser) * 1000 * 10**18;

            asset.mint(user, totalPremium);

            vm.startPrank(user);
            for (uint8 j = 0; j < numPoliciesPerUser; j++) {
                asset.approve(address(manager), 1000 * 10**18);
                uint256 policyId = manager.buyPolicy(
                    0,
                    30,
                    10_000 * 10**18,
                    1000 * 10**18,
                    35,
                    user
                );
                assertEq(manager.holderOf(policyId), user, "User should own policy");
            }
            vm.stopPrank();
        }

        // Check total reserved shares matches all policies
        uint256 totalPolicies = uint256(numUsers) * uint256(numPoliciesPerUser);
        assertGt(vault.totalReservedShares(), 0, "Shares should be reserved");
        assertEq(manager.nextId() - 1, totalPolicies, "Policy count should match");
    }
}
