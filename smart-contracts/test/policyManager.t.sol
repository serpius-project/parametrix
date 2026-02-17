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

    // Tahoe Reno, NV (The Citadel) — lat/lon × 10 000
    int32 constant DEFAULT_LAT = 395157;
    int32 constant DEFAULT_LON = -1194713;

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
            alice,
            DEFAULT_LAT,
            DEFAULT_LON
        );
        vm.stopPrank();

        assertEq(policyId, 1, "First policy should be ID 1");
        (uint8 hazard, , , , , , , , ) = manager.policies(policyId);
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
            alice,
            DEFAULT_LAT,
            DEFAULT_LON
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
            alice,
            DEFAULT_LAT,
            DEFAULT_LON
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
            alice,
            DEFAULT_LAT,
            DEFAULT_LON
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
            triggerThreshold: 35,
            lat: DEFAULT_LAT,
            lon: DEFAULT_LON
        });
        inputs[1] = policyManager.PolicyInput({
            hazard: 1,
            durationDays: 60,
            maxCoverage: 20_000 * 10**18,
            premium: 2000 * 10**18,
            triggerThreshold: 100,
            lat: DEFAULT_LAT,
            lon: DEFAULT_LON
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
        manager.buyPolicy(0, 30, 10_000 * 10**18, 1000 * 10**18, 35, alice, DEFAULT_LAT, DEFAULT_LON);
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
            alice,
            DEFAULT_LAT,
            DEFAULT_LON
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
        (, , , , , , , , bool paid) = manager.policies(policyId);
        assertTrue(paid, "Policy should be marked as paid");

        // Check shares were unreserved
        assertEq(manager.reservedShares(policyId), 0, "Reserved shares should be released");
        assertEq(vault.totalReservedShares(), 0, "No shares should be reserved");
    }

    /* ============ Payout Tests - Partial Coverage (Underfunded Vault) ============ */

    // Helper that creates a fresh vault+manager with no underwriter capital.
    // The only assets are the premiums paid by buyers themselves.
    function _deployUnderfundedSystem()
        internal
        returns (underwriterVault freshVault, policyManager freshManager)
    {
        freshVault = new underwriterVault(
            asset,
            "Fresh Vault",
            "FV",
            VAULT_CAP,
            feeRecipient
        );
        freshManager = new policyManager(
            asset,
            IUnderwriterVault(address(freshVault)),
            "https://api.parametrix.com/policy/{id}"
        );
        freshVault.setPolicyManager(address(freshManager));
        // oracle stays as address(this) (set in constructor)
    }

    function test_TriggerPayoutPartialCoverageWhenUnderfunded() public {
        // Deploy a vault with NO underwriter capital - only premiums are in the vault.
        // Verify that policyholders receive pro-rata payouts proportional to their coverage.
        (underwriterVault freshVault, policyManager freshManager) = _deployUnderfundedSystem();

        uint256 aliceCoverage = 1000 * 10**18;
        uint256 alicePremium  =   50 * 10**18;
        uint256 bobCoverage   = 2000 * 10**18;
        uint256 bobPremium    =   70 * 10**18;
        uint256 totalPremiums = alicePremium + bobPremium; // 120e18

        vm.startPrank(alice);
        asset.approve(address(freshManager), alicePremium);
        uint256 policyA = freshManager.buyPolicy(0, 30, aliceCoverage, alicePremium, 35, alice, DEFAULT_LAT, DEFAULT_LON);
        vm.stopPrank();

        vm.startPrank(bob);
        asset.approve(address(freshManager), bobPremium);
        uint256 policyB = freshManager.buyPolicy(0, 30, bobCoverage, bobPremium, 35, bob, DEFAULT_LAT, DEFAULT_LON);
        vm.stopPrank();

        assertEq(freshVault.totalAssets(), totalPremiums, "Vault should only hold premiums");
        assertEq(freshManager.totalActiveCoverage(), aliceCoverage + bobCoverage, "Coverage tracked");

        // -- Alice claims first --
        uint256 aliceBefore = asset.balanceOf(alice);
        freshManager.triggerPayout(policyA, 40, aliceCoverage); // request full maxCoverage
        uint256 alicePayout = asset.balanceOf(alice) - aliceBefore;

        // Expected: 120e18 * 1000/3000 = 40e18
        uint256 expectedAlice = totalPremiums * aliceCoverage / (aliceCoverage + bobCoverage);
        assertApproxEqAbs(alicePayout, expectedAlice, 1, "Alice pro-rata payout");
        assertLt(alicePayout, aliceCoverage, "Alice paid less than maxCoverage (underfunded)");

        // -- Bob claims after Alice --
        uint256 bobBefore = asset.balanceOf(bob);
        freshManager.triggerPayout(policyB, 40, bobCoverage);
        uint256 bobPayout = asset.balanceOf(bob) - bobBefore;

        assertLt(bobPayout, bobCoverage, "Bob paid less than maxCoverage (underfunded)");
        assertGt(bobPayout, 0, "Bob still receives something");

        // Invariant: total paid out never exceeds initial vault assets
        assertLe(alicePayout + bobPayout, totalPremiums, "Cannot pay more than vault held");

        // Coverage fully cleared
        assertEq(freshManager.totalActiveCoverage(), 0, "All coverage cleared after payouts");
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
            alice,
            DEFAULT_LAT,
            DEFAULT_LON
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
            alice,
            DEFAULT_LAT,
            DEFAULT_LON
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
            alice,
            DEFAULT_LAT,
            DEFAULT_LON
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
            alice,
            DEFAULT_LAT,
            DEFAULT_LON
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
            alice,
            DEFAULT_LAT,
            DEFAULT_LON
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
            alice,
            DEFAULT_LAT,
            DEFAULT_LON
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
        (, , , , , , , , bool paid) = manager.policies(policyId);
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
            alice,
            DEFAULT_LAT,
            DEFAULT_LON
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
                alice,
                DEFAULT_LAT,
                DEFAULT_LON
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
            alice,
            DEFAULT_LAT,
            DEFAULT_LON
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
            alice,
            DEFAULT_LAT,
            DEFAULT_LON
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
            alice,
            DEFAULT_LAT,
            DEFAULT_LON
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
            alice,
            DEFAULT_LAT,
            DEFAULT_LON
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
                    user,
                    DEFAULT_LAT,
                    DEFAULT_LON
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

    /* ============ Pro-Rata Payout Tests ============ */

    // Exactly the design scenario described for the system:
    //   User 1: $1,000 coverage, $50 premium
    //   User 2: $2,000 coverage, $70 premium
    //   Vault funded only by premiums ($120 total)
    //   If vault >= $3,000  -> full payouts ($1,000 and $2,000)
    //   If vault < $3,000   -> pro-rata  (user1 ~$40, user2 ~$70)
    function test_ProRataPayoutTwoUsersUnderfunded() public {
        (underwriterVault fv, policyManager fm) = _deployUnderfundedSystem();

        uint256 cov1 = 1000 * 10**18;
        uint256 pre1 =   50 * 10**18;
        uint256 cov2 = 2000 * 10**18;
        uint256 pre2 =   70 * 10**18;

        vm.startPrank(alice);
        asset.approve(address(fm), pre1);
        uint256 p1 = fm.buyPolicy(0, 30, cov1, pre1, 35, alice, DEFAULT_LAT, DEFAULT_LON);
        vm.stopPrank();

        vm.startPrank(bob);
        asset.approve(address(fm), pre2);
        uint256 p2 = fm.buyPolicy(0, 30, cov2, pre2, 35, bob, DEFAULT_LAT, DEFAULT_LON);
        vm.stopPrank();

        uint256 totalAssets = fv.totalAssets(); // 120e18
        uint256 totalCov    = cov1 + cov2;      // 3000e18

        // Alice claims: expected = 120 * 1000/3000 = 40
        uint256 aliceBefore = asset.balanceOf(alice);
        fm.triggerPayout(p1, 40, cov1);
        uint256 alicePayout = asset.balanceOf(alice) - aliceBefore;
        assertApproxEqAbs(alicePayout, totalAssets * cov1 / totalCov, 1, "Alice pro-rata");

        // Bob claims: remaining vault * 2000/2000
        uint256 remainingAssets = fv.totalAssets();
        uint256 bobBefore = asset.balanceOf(bob);
        fm.triggerPayout(p2, 40, cov2);
        uint256 bobPayout = asset.balanceOf(bob) - bobBefore;
        // Bob is capped by reserved shares (70e18), not by full pro-rata (remainingAssets)
        assertLe(bobPayout, remainingAssets, "Bob payout within remaining assets");
        assertGt(bobPayout, 0, "Bob receives a payout");

        assertLe(alicePayout + bobPayout, totalAssets, "Total payout within vault assets");
        assertEq(fm.totalActiveCoverage(), 0, "All coverage cleared");
    }

    function test_ProRataPayoutTwoUsersFullyFunded() public {
        // With sufficient underwriter capital, both users get their FULL requested payout.
        uint256 cov1 = 1000 * 10**18;
        uint256 pre1 =   50 * 10**18;
        uint256 cov2 = 2000 * 10**18;
        uint256 pre2 =   70 * 10**18;
        // Vault already has 1M from underwriter (setUp) - easily covers 3k total coverage.

        vm.startPrank(alice);
        asset.approve(address(manager), pre1);
        uint256 p1 = manager.buyPolicy(0, 30, cov1, pre1, 35, alice, DEFAULT_LAT, DEFAULT_LON);
        vm.stopPrank();

        vm.startPrank(bob);
        asset.approve(address(manager), pre2);
        uint256 p2 = manager.buyPolicy(0, 30, cov2, pre2, 35, bob, DEFAULT_LAT, DEFAULT_LON);
        vm.stopPrank();

        uint256 aliceBefore = asset.balanceOf(alice);
        manager.triggerPayout(p1, 40, cov1); // request full 1000
        // 0.1% tolerance: Alice's payout is exact since she goes first.
        assertApproxEqRel(asset.balanceOf(alice) - aliceBefore, cov1, 0.001e18, "Alice receives ~full coverage");

        uint256 bobBefore = asset.balanceOf(bob);
        manager.triggerPayout(p2, 40, cov2); // request full 2000
        // After Alice's payout, the share price dips slightly (~0.1%) because
        // the vault has fewer assets but the same share supply. Bob's payout
        // is still effectively full coverage within that rounding.
        assertApproxEqRel(asset.balanceOf(bob) - bobBefore, cov2, 0.002e18, "Bob receives ~full coverage");
    }

    function test_TotalActiveCoverageTracking() public {
        uint256 cov1 = 5000 * 10**18;
        uint256 cov2 = 3000 * 10**18;
        uint256 pre  = 1000 * 10**18;

        assertEq(manager.totalActiveCoverage(), 0, "Starts at zero");

        vm.startPrank(alice);
        asset.approve(address(manager), pre);
        uint256 p1 = manager.buyPolicy(0, 30, cov1, pre, 35, alice, DEFAULT_LAT, DEFAULT_LON);
        vm.stopPrank();
        assertEq(manager.totalActiveCoverage(), cov1, "After first purchase");

        vm.startPrank(bob);
        asset.approve(address(manager), pre);
        uint256 p2 = manager.buyPolicy(0, 30, cov2, pre, 35, bob, DEFAULT_LAT, DEFAULT_LON);
        vm.stopPrank();
        assertEq(manager.totalActiveCoverage(), cov1 + cov2, "After second purchase");

        // Payout decrements coverage
        manager.triggerPayout(p1, 40, cov1);
        assertEq(manager.totalActiveCoverage(), cov2, "After first payout");

        // Expiry also decrements coverage
        vm.warp(block.timestamp + 31 days);
        manager.releaseExpiredPolicy(p2);
        assertEq(manager.totalActiveCoverage(), 0, "After expiry release");
    }

    function test_BuyPolicySucceedsWithNoUnderwriterCapital() public {
        // The key behavioral change: purchasing a policy no longer reverts even when
        // the vault has no underwriter capital beyond the premium itself.
        (underwriterVault fv, policyManager fm) = _deployUnderfundedSystem();

        uint256 coverage = 100_000 * 10**18; // 100k coverage
        uint256 premium  =     100 * 10**18; // only 100 in vault after purchase

        vm.startPrank(alice);
        asset.approve(address(fm), premium);
        uint256 policyId = fm.buyPolicy(0, 30, coverage, premium, 35, alice, DEFAULT_LAT, DEFAULT_LON);
        vm.stopPrank();

        assertEq(policyId, 1, "Policy created successfully");
        assertEq(fm.totalActiveCoverage(), coverage, "Coverage tracked");
        assertEq(fv.totalAssets(), premium, "Vault holds the premium");

        // Reserved shares is at most what the vault has (the premium), not the full coverage
        uint256 reserved = fm.reservedShares(policyId);
        uint256 maxPossibleShares = fv.previewWithdraw(coverage);
        assertLt(reserved, maxPossibleShares, "Only partial shares reserved (vault underfunded)");
    }

    /* ============ Pro-Rata Fuzz Tests ============ */

    // Verifies the pro-rata payout invariants hold for any number of users with
    // varying coverage amounts when the vault holds only premium income.
    function testFuzz_ProRataPayoutManyUsers(uint8 numUsers) public {
        numUsers = uint8(bound(numUsers, 2, 8));

        (underwriterVault fv, policyManager fm) = _deployUnderfundedSystem();

        uint256[] memory coverages  = new uint256[](numUsers);
        uint256[] memory policyIds  = new uint256[](numUsers);
        address[]  memory users     = new address[](numUsers);
        uint256 totalCoverage;

        // Each user i gets (i+1)*1000 coverage and (i+1)*50 premium
        for (uint8 i = 0; i < numUsers; i++) {
            users[i]    = address(uint160(0x9000 + i));
            coverages[i] = (uint256(i) + 1) * 1000 * 10**18;
            uint256 premium = (uint256(i) + 1) * 50 * 10**18;
            totalCoverage += coverages[i];

            asset.mint(users[i], premium);
            vm.startPrank(users[i]);
            asset.approve(address(fm), premium);
            policyIds[i] = fm.buyPolicy(0, 30, coverages[i], premium, 35, users[i], DEFAULT_LAT, DEFAULT_LON);
            vm.stopPrank();
        }

        assertEq(fm.totalActiveCoverage(), totalCoverage, "Coverage tracked correctly");

        uint256 initialVaultAssets = fv.totalAssets();
        uint256 totalPaidOut;

        for (uint8 i = 0; i < numUsers; i++) {
            uint256 balBefore = asset.balanceOf(users[i]);
            fm.triggerPayout(policyIds[i], 40, coverages[i]);
            uint256 payout = asset.balanceOf(users[i]) - balBefore;

            assertLe(payout, coverages[i], "Payout never exceeds maxCoverage");
            totalPaidOut += payout;
        }

        // Core invariant: vault never pays out more than it held
        assertLe(totalPaidOut, initialVaultAssets, "Total payouts within vault assets");
        assertEq(fm.totalActiveCoverage(), 0, "All coverage fully cleared");
    }
}
