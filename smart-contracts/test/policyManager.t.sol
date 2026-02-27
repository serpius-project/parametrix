// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.20;

import {Test, console} from "forge-std/Test.sol";
import {policyManager} from "../src/policyManager.sol";
import {IUnderwriterVault} from "../src/IUnderwriterVault.sol";
import {IFeeRateModel} from "../src/IFeeRateModel.sol";
import {FeeRateModel} from "../src/FeeRateModel.sol";
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
    underwriterVault public uwVault;
    underwriterVault public juniorVault;
    underwriterVault public seniorVault;
    FeeRateModel public feeModel;
    MockERC20 public asset;

    address public owner = address(this);
    address public oracle;
    address public feeRecipient = address(0x2);
    address public alice = address(0x3);
    address public bob = address(0x4);
    address public underwriter = address(0x5);

    uint256 constant VAULT_CAP = 10_000_000 * 10**18;
    uint256 constant UNDERWRITER_DEPOSIT = 1_000_000 * 10**18;

    int32 constant DEFAULT_LAT = 395157;
    int32 constant DEFAULT_LON = -1194713;

    function setUp() public {
        oracle = address(this);
        asset = new MockERC20();

        uwVault = new underwriterVault(asset, "Parametrix Underwriter Vault", "pUWV", VAULT_CAP, feeRecipient);
        juniorVault = new underwriterVault(asset, "Parametrix Junior Vault", "pJNR", VAULT_CAP, feeRecipient);
        seniorVault = new underwriterVault(asset, "Parametrix Senior Vault", "pSNR", VAULT_CAP, feeRecipient);

        feeModel = new FeeRateModel(VAULT_CAP);

        manager = new policyManager(
            asset,
            IUnderwriterVault(address(uwVault)),
            IUnderwriterVault(address(juniorVault)),
            IUnderwriterVault(address(seniorVault)),
            IFeeRateModel(address(feeModel)),
            "https://api.parametrix.com/policy/{id}"
        );

        uwVault.setPolicyManager(address(manager));
        juniorVault.setPolicyManager(address(manager));
        seniorVault.setPolicyManager(address(manager));

        juniorVault.setCapManager(address(manager));
        seniorVault.setCapManager(address(manager));

        _seedVault(uwVault, underwriter, UNDERWRITER_DEPOSIT);
        _seedVault(juniorVault, underwriter, UNDERWRITER_DEPOSIT);
        _seedVault(seniorVault, underwriter, UNDERWRITER_DEPOSIT);

        asset.mint(alice, 100_000 * 10**18);
        asset.mint(bob, 100_000 * 10**18);

        vm.label(alice, "Alice");
        vm.label(bob, "Bob");
        vm.label(underwriter, "Underwriter");
        vm.label(oracle, "Oracle");
    }

    function _seedVault(underwriterVault v, address depositor, uint256 amount) internal {
        asset.mint(depositor, amount);
        vm.startPrank(depositor);
        asset.approve(address(v), amount);
        v.deposit(amount, depositor);
        vm.stopPrank();
    }

    /* ============ Hazard Management Tests ============ */

    function test_DefaultHazardsInitialized() public view {
        assertTrue(manager.validHazards(0));
        assertTrue(manager.validHazards(1));
        assertTrue(manager.validHazards(2));
        assertEq(manager.hazardNames(0), "Heatwave");
        assertEq(manager.hazardNames(1), "Flood");
        assertEq(manager.hazardNames(2), "Drought");
    }

    function test_AddHazardType() public {
        manager.addHazardType(3, "Earthquake", true);
        assertTrue(manager.validHazards(3));
        assertEq(manager.hazardNames(3), "Earthquake");
        assertTrue(manager.hazardTriggerAbove(3));
    }

    function test_AddHazardTypeTriggerBelow() public {
        manager.addHazardType(4, "ColdSnap", false);
        assertTrue(manager.validHazards(4));
        assertFalse(manager.hazardTriggerAbove(4));
    }

    function test_AddHazardTypeRevertsIfAlreadyExists() public {
        vm.expectRevert(bytes("hazard already exists"));
        manager.addHazardType(0, "Heatwave", true);
    }

    function test_AddHazardTypeRevertsIfNotOwner() public {
        vm.prank(alice);
        vm.expectRevert();
        manager.addHazardType(3, "Earthquake", true);
    }

    function test_RemoveHazardType() public {
        manager.removeHazardType(2);
        assertFalse(manager.validHazards(2));
    }

    function test_RemoveHazardTypeRevertsIfDoesntExist() public {
        vm.expectRevert(bytes("hazard doesn't exist"));
        manager.removeHazardType(99);
    }

    function test_BuyPolicyWithNewHazardType() public {
        manager.addHazardType(3, "Earthquake", true);

        vm.startPrank(alice);
        asset.approve(address(manager), 1000 * 10**18);
        uint256 policyId = manager.buyPolicy(3, 30, 10_000 * 10**18, 1000 * 10**18, 6, alice, DEFAULT_LAT, DEFAULT_LON);
        vm.stopPrank();

        assertEq(policyId, 1);
        (uint8 hazard, , , , , , , , ) = manager.policies(policyId);
        assertEq(hazard, 3);
    }

    function test_BuyPolicyRevertsWithInvalidHazard() public {
        vm.startPrank(alice);
        asset.approve(address(manager), 1000 * 10**18);
        vm.expectRevert(bytes("invalid hazard type"));
        manager.buyPolicy(99, 30, 10_000 * 10**18, 1000 * 10**18, 35, alice, DEFAULT_LAT, DEFAULT_LON);
        vm.stopPrank();
    }

    function test_BuyPolicyRevertsWithRemovedHazard() public {
        manager.removeHazardType(2);
        vm.startPrank(alice);
        asset.approve(address(manager), 1000 * 10**18);
        vm.expectRevert(bytes("invalid hazard type"));
        manager.buyPolicy(2, 30, 10_000 * 10**18, 1000 * 10**18, 35, alice, DEFAULT_LAT, DEFAULT_LON);
        vm.stopPrank();
    }

    /* ============ Policy Purchase Tests ============ */

    function test_BuyPolicy() public {
        vm.startPrank(alice);
        asset.approve(address(manager), 1000 * 10**18);
        uint256 policyId = manager.buyPolicy(0, 30, 10_000 * 10**18, 1000 * 10**18, 35, alice, DEFAULT_LAT, DEFAULT_LON);
        vm.stopPrank();

        assertEq(policyId, 1);
        assertEq(manager.balanceOf(alice, policyId), 1);
        assertEq(manager.holderOf(policyId), alice);

        (uint256 uwShares, uint256 jrShares, uint256 srShares) = manager.vaultReservedShares(policyId);
        assertGt(uwShares + jrShares + srShares, 0, "Shares should be reserved");
    }

    function test_BuyPolicySplitsPremiumAcrossVaults() public {
        uint256 uwBefore = uwVault.totalAssets();
        uint256 jrBefore = juniorVault.totalAssets();
        uint256 srBefore = seniorVault.totalAssets();
        uint256 premium = 10_000 * 10**18;

        vm.startPrank(alice);
        asset.approve(address(manager), premium);
        manager.buyPolicy(0, 30, 100_000 * 10**18, premium, 35, alice, DEFAULT_LAT, DEFAULT_LON);
        vm.stopPrank();

        uint256 uwInc = uwVault.totalAssets() - uwBefore;
        uint256 jrInc = juniorVault.totalAssets() - jrBefore;
        uint256 srInc = seniorVault.totalAssets() - srBefore;

        // With equal capital in junior & senior (1M each), u' = 50%, deviation = 2500
        // seniorAdj = 2000 + (5000 * 2500) / 10000 = 3250, juniorBps = 10000 - 500 - 3250 = 6250
        assertApproxEqRel(jrInc, premium * 6250 / 10000, 0.01e18, "Junior gets ~62.5%");
        assertApproxEqRel(srInc, premium * 3250 / 10000, 0.01e18, "Senior gets ~32.5%");
        assertApproxEqRel(uwInc, premium * 500 / 10000, 0.01e18, "Underwriter gets ~5%");
        assertApproxEqAbs(uwInc + jrInc + srInc, premium, 3, "Total deposits == premium");
    }

    function test_BuyPolicyDepositsPremiumToVaults() public {
        uint256 uwBal = uwVault.balanceOf(address(manager));
        uint256 jrBal = juniorVault.balanceOf(address(manager));
        uint256 srBal = seniorVault.balanceOf(address(manager));

        vm.startPrank(alice);
        asset.approve(address(manager), 1000 * 10**18);
        manager.buyPolicy(0, 30, 10_000 * 10**18, 1000 * 10**18, 35, alice, DEFAULT_LAT, DEFAULT_LON);
        vm.stopPrank();

        uint256 inc = (uwVault.balanceOf(address(manager)) - uwBal) +
            (juniorVault.balanceOf(address(manager)) - jrBal) +
            (seniorVault.balanceOf(address(manager)) - srBal);
        assertGt(inc, 0, "Premium deposited across vaults");
    }

    /* ============ Payout Tests ============ */

    function test_TriggerPayoutFullCoverage() public {
        vm.startPrank(alice);
        asset.approve(address(manager), 1000 * 10**18);
        uint256 pid = manager.buyPolicy(0, 30, 10_000 * 10**18, 1000 * 10**18, 35, alice, DEFAULT_LAT, DEFAULT_LON);
        vm.stopPrank();

        uint256 before = asset.balanceOf(alice);
        manager.verifyPolicy(pid);
        manager.triggerPayout(pid, 40, 5000 * 10**18);
        assertEq(asset.balanceOf(alice) - before, 5000 * 10**18, "Full payout");

        (, , , , , , , , bool paid) = manager.policies(pid);
        assertTrue(paid);
        (uint256 u, uint256 j, uint256 s) = manager.vaultReservedShares(pid);
        assertEq(u + j + s, 0, "Reservations cleared");
    }

    function test_PayoutWaterfallOrder() public {
        vm.startPrank(alice);
        asset.approve(address(manager), 1000 * 10**18);
        uint256 pid = manager.buyPolicy(0, 30, 10_000 * 10**18, 1000 * 10**18, 35, alice, DEFAULT_LAT, DEFAULT_LON);
        vm.stopPrank();

        uint256 uwBefore = uwVault.totalAssets();
        uint256 jrBefore = juniorVault.totalAssets();
        uint256 srBefore = seniorVault.totalAssets();
        (uint256 uwRes, , ) = manager.vaultReservedShares(pid);

        manager.verifyPolicy(pid);
        manager.triggerPayout(pid, 40, 5000 * 10**18);

        uint256 uwDec = uwBefore - uwVault.totalAssets();
        uint256 jrDec = jrBefore - juniorVault.totalAssets();
        uint256 srDec = srBefore - seniorVault.totalAssets();

        if (uwRes > 0) assertGt(uwDec, 0, "Underwriter absorbs first");
        assertApproxEqAbs(uwDec + jrDec + srDec, 5000 * 10**18, 3, "Total withdrawal == payout");
    }

    /* ============ Underfunded System ============ */

    function _deployUnderfundedSystem()
        internal
        returns (underwriterVault, underwriterVault, underwriterVault, policyManager freshManager)
    {
        underwriterVault fUw = new underwriterVault(asset, "Fresh UW", "FUW", VAULT_CAP, feeRecipient);
        underwriterVault fJr = new underwriterVault(asset, "Fresh JR", "FJR", VAULT_CAP, feeRecipient);
        underwriterVault fSr = new underwriterVault(asset, "Fresh SR", "FSR", VAULT_CAP, feeRecipient);
        FeeRateModel fm2 = new FeeRateModel(VAULT_CAP);

        freshManager = new policyManager(
            asset,
            IUnderwriterVault(address(fUw)),
            IUnderwriterVault(address(fJr)),
            IUnderwriterVault(address(fSr)),
            IFeeRateModel(address(fm2)),
            "https://api.parametrix.com/policy/{id}"
        );
        fUw.setPolicyManager(address(freshManager));
        fJr.setPolicyManager(address(freshManager));
        fSr.setPolicyManager(address(freshManager));
        fJr.setCapManager(address(freshManager));
        fSr.setCapManager(address(freshManager));
    }

    function test_TriggerPayoutPartialCoverageWhenUnderfunded() public {
        (, , , policyManager fm) = _deployUnderfundedSystem();

        uint256 cov1 = 1000 * 10**18; uint256 pre1 = 50 * 10**18;
        uint256 cov2 = 2000 * 10**18; uint256 pre2 = 70 * 10**18;
        uint256 totalPremiums = pre1 + pre2;

        vm.startPrank(alice);
        asset.approve(address(fm), pre1);
        uint256 pA = fm.buyPolicy(0, 30, cov1, pre1, 35, alice, DEFAULT_LAT, DEFAULT_LON);
        vm.stopPrank();

        vm.startPrank(bob);
        asset.approve(address(fm), pre2);
        uint256 pB = fm.buyPolicy(0, 30, cov2, pre2, 35, bob, DEFAULT_LAT, DEFAULT_LON);
        vm.stopPrank();

        fm.verifyPolicy(pA);
        fm.verifyPolicy(pB);

        uint256 aliceBefore = asset.balanceOf(alice);
        fm.triggerPayout(pA, 40, cov1);
        uint256 alicePayout = asset.balanceOf(alice) - aliceBefore;
        assertApproxEqAbs(alicePayout, totalPremiums * cov1 / (cov1 + cov2), 2, "Alice pro-rata");
        assertLt(alicePayout, cov1);

        uint256 bobBefore = asset.balanceOf(bob);
        fm.triggerPayout(pB, 40, cov2);
        uint256 bobPayout = asset.balanceOf(bob) - bobBefore;
        assertLt(bobPayout, cov2);
        assertGt(bobPayout, 0);

        assertLe(alicePayout + bobPayout, totalPremiums);
        assertEq(fm.totalActiveCoverage(), 0);
    }

    /* ============ Payout Validation Tests ============ */

    function test_TriggerPayoutRevertsIfNotOracle() public {
        vm.startPrank(alice);
        asset.approve(address(manager), 1000 * 10**18);
        uint256 pid = manager.buyPolicy(0, 30, 10_000 * 10**18, 1000 * 10**18, 35, alice, DEFAULT_LAT, DEFAULT_LON);
        vm.stopPrank();
        vm.prank(bob);
        vm.expectRevert(bytes("not oracle"));
        manager.triggerPayout(pid, 40, 5000 * 10**18);
    }

    function test_TriggerPayoutRevertsIfAlreadyPaid() public {
        vm.startPrank(alice);
        asset.approve(address(manager), 1000 * 10**18);
        uint256 pid = manager.buyPolicy(0, 30, 10_000 * 10**18, 1000 * 10**18, 35, alice, DEFAULT_LAT, DEFAULT_LON);
        vm.stopPrank();
        manager.verifyPolicy(pid);
        manager.triggerPayout(pid, 40, 5000 * 10**18);
        vm.expectRevert(bytes("paid"));
        manager.triggerPayout(pid, 40, 5000 * 10**18);
    }

    function test_TriggerPayoutRevertsIfExpired() public {
        vm.startPrank(alice);
        asset.approve(address(manager), 1000 * 10**18);
        uint256 pid = manager.buyPolicy(0, 30, 10_000 * 10**18, 1000 * 10**18, 35, alice, DEFAULT_LAT, DEFAULT_LON);
        vm.stopPrank();
        manager.verifyPolicy(pid);
        vm.warp(block.timestamp + 31 days);
        vm.expectRevert(bytes("expired"));
        manager.triggerPayout(pid, 40, 5000 * 10**18);
    }

    function test_TriggerPayoutRevertsIfThresholdNotMet() public {
        vm.startPrank(alice);
        asset.approve(address(manager), 1000 * 10**18);
        uint256 pid = manager.buyPolicy(0, 30, 10_000 * 10**18, 1000 * 10**18, 35, alice, DEFAULT_LAT, DEFAULT_LON);
        vm.stopPrank();
        manager.verifyPolicy(pid);
        vm.expectRevert(bytes("no trigger"));
        manager.triggerPayout(pid, 34, 5000 * 10**18);
    }

    function test_TriggerPayoutRevertsIfPayoutExceedsMaxCoverage() public {
        vm.startPrank(alice);
        asset.approve(address(manager), 1000 * 10**18);
        uint256 pid = manager.buyPolicy(0, 30, 10_000 * 10**18, 1000 * 10**18, 35, alice, DEFAULT_LAT, DEFAULT_LON);
        vm.stopPrank();
        manager.verifyPolicy(pid);
        vm.expectRevert(bytes("too much"));
        manager.triggerPayout(pid, 40, 11_000 * 10**18);
    }

    /* ============ Drought Tests ============ */

    function test_DefaultHazardTriggerDirections() public view {
        assertTrue(manager.hazardTriggerAbove(0));
        assertTrue(manager.hazardTriggerAbove(1));
        assertFalse(manager.hazardTriggerAbove(2));
    }

    function test_TriggerPayoutDroughtNegativeThreshold() public {
        vm.startPrank(alice);
        asset.approve(address(manager), 1000 * 10**18);
        uint256 pid = manager.buyPolicy(2, 30, 10_000 * 10**18, 1000 * 10**18, int256(-50), alice, DEFAULT_LAT, DEFAULT_LON);
        vm.stopPrank();
        manager.verifyPolicy(pid);
        uint256 before = asset.balanceOf(alice);
        manager.triggerPayout(pid, int256(-80), 5000 * 10**18);
        assertEq(asset.balanceOf(alice) - before, 5000 * 10**18);
        (, , , , , , , , bool paid) = manager.policies(pid);
        assertTrue(paid);
    }

    function test_TriggerPayoutDroughtNotTriggered() public {
        vm.startPrank(alice);
        asset.approve(address(manager), 1000 * 10**18);
        uint256 pid = manager.buyPolicy(2, 30, 10_000 * 10**18, 1000 * 10**18, int256(-50), alice, DEFAULT_LAT, DEFAULT_LON);
        vm.stopPrank();
        manager.verifyPolicy(pid);
        vm.expectRevert(bytes("no trigger"));
        manager.triggerPayout(pid, int256(-30), 5000 * 10**18);
    }

    function test_TriggerPayoutDroughtExactThreshold() public {
        vm.startPrank(alice);
        asset.approve(address(manager), 1000 * 10**18);
        uint256 pid = manager.buyPolicy(2, 30, 10_000 * 10**18, 1000 * 10**18, int256(-50), alice, DEFAULT_LAT, DEFAULT_LON);
        vm.stopPrank();
        manager.verifyPolicy(pid);
        manager.triggerPayout(pid, int256(-50), 5000 * 10**18);
        (, , , , , , , , bool paid) = manager.policies(pid);
        assertTrue(paid);
    }

    /* ============ Expired Policy Release ============ */

    function test_ReleaseExpiredPolicy() public {
        vm.startPrank(alice);
        asset.approve(address(manager), 1000 * 10**18);
        uint256 pid = manager.buyPolicy(0, 30, 10_000 * 10**18, 1000 * 10**18, 35, alice, DEFAULT_LAT, DEFAULT_LON);
        vm.stopPrank();
        (uint256 u, uint256 j, uint256 s) = manager.vaultReservedShares(pid);
        assertGt(u + j + s, 0);
        vm.warp(block.timestamp + 31 days);
        manager.releaseExpiredPolicy(pid);
        (u, j, s) = manager.vaultReservedShares(pid);
        assertEq(u + j + s, 0);
        (, , , , , , , , bool paid) = manager.policies(pid);
        assertTrue(paid);
    }

    function test_ReleaseExpiredPolicyRevertsIfNotExpired() public {
        vm.startPrank(alice);
        asset.approve(address(manager), 1000 * 10**18);
        uint256 pid = manager.buyPolicy(0, 30, 10_000 * 10**18, 1000 * 10**18, 35, alice, DEFAULT_LAT, DEFAULT_LON);
        vm.stopPrank();
        vm.expectRevert(bytes("not expired"));
        manager.releaseExpiredPolicy(pid);
    }

    function test_ReleaseExpiredPoliciesBatch() public {
        uint256[] memory pids = new uint256[](3);
        vm.startPrank(alice);
        for (uint i = 0; i < 3; i++) {
            asset.approve(address(manager), 1000 * 10**18);
            pids[i] = manager.buyPolicy(0, 30, 10_000 * 10**18, 1000 * 10**18, 35, alice, DEFAULT_LAT, DEFAULT_LON);
        }
        vm.stopPrank();
        vm.warp(block.timestamp + 31 days);
        manager.releaseExpiredPolicies(pids);
        for (uint i = 0; i < 3; i++) {
            (uint256 u, uint256 j, uint256 s) = manager.vaultReservedShares(pids[i]);
            assertEq(u + j + s, 0);
        }
    }

    /* ============ Transfer Tests ============ */

    function test_TransferPolicy() public {
        vm.startPrank(alice);
        asset.approve(address(manager), 1000 * 10**18);
        uint256 pid = manager.buyPolicy(0, 30, 10_000 * 10**18, 1000 * 10**18, 35, alice, DEFAULT_LAT, DEFAULT_LON);
        manager.safeTransferFrom(alice, bob, pid, 1, "");
        vm.stopPrank();
        assertEq(manager.balanceOf(bob, pid), 1);
        assertEq(manager.holderOf(pid), bob);
        assertEq(manager.balanceOf(alice, pid), 0);
    }

    function test_PayoutGoesToCurrentHolder() public {
        vm.startPrank(alice);
        asset.approve(address(manager), 1000 * 10**18);
        uint256 pid = manager.buyPolicy(0, 30, 10_000 * 10**18, 1000 * 10**18, 35, alice, DEFAULT_LAT, DEFAULT_LON);
        manager.safeTransferFrom(alice, bob, pid, 1, "");
        vm.stopPrank();
        uint256 before = asset.balanceOf(bob);
        manager.verifyPolicy(pid);
        manager.triggerPayout(pid, 40, 5000 * 10**18);
        assertEq(asset.balanceOf(bob) - before, 5000 * 10**18);
    }

    /* ============ Fee Rate Model Tests ============ */

    function test_SetFeeRateModel() public {
        FeeRateModel newModel = new FeeRateModel(VAULT_CAP);
        newModel.setBaseSeniorBps(3000);
        manager.setFeeRateModel(IFeeRateModel(address(newModel)));

        uint256 srBefore = seniorVault.totalAssets();
        vm.startPrank(alice);
        asset.approve(address(manager), 10_000 * 10**18);
        manager.buyPolicy(0, 30, 100_000 * 10**18, 10_000 * 10**18, 35, alice, DEFAULT_LAT, DEFAULT_LON);
        vm.stopPrank();
        uint256 srInc = seniorVault.totalAssets() - srBefore;
        // With baseSeniorBps=3000 and equal capital: seniorAdj = 3000 + (5000*2500)/10000 = 4250
        assertApproxEqRel(srInc, 10_000 * 10**18 * 4250 / 10000, 0.05e18, "Senior ~42.5% with new model");
    }

    function test_SetFeeRateModelRevertsZeroAddress() public {
        vm.expectRevert(bytes("zero address"));
        manager.setFeeRateModel(IFeeRateModel(address(0)));
    }

    function test_SetFeeRateModelRevertsIfNotOwner() public {
        FeeRateModel newModel = new FeeRateModel(VAULT_CAP);
        vm.prank(alice);
        vm.expectRevert();
        manager.setFeeRateModel(IFeeRateModel(address(newModel)));
    }

    /* ============ Fuzz Tests ============ */

    function testFuzz_BuyPolicy(uint256 premium, uint256 maxCoverage, uint256 durationDays) public {
        premium = bound(premium, 100 * 10**18, 10_000 * 10**18);
        maxCoverage = bound(maxCoverage, premium, 100_000 * 10**18);
        durationDays = bound(durationDays, 1, 365);
        asset.mint(alice, premium);
        vm.startPrank(alice);
        asset.approve(address(manager), premium);
        uint256 pid = manager.buyPolicy(0, durationDays, maxCoverage, premium, 35, alice, DEFAULT_LAT, DEFAULT_LON);
        vm.stopPrank();
        assertGt(pid, 0);
        (uint256 u, uint256 j, uint256 s) = manager.vaultReservedShares(pid);
        assertGt(u + j + s, 0);
    }

    function testFuzz_TriggerPayout(uint256 premium, uint256 maxCoverage, uint256 requestedPayout) public {
        premium = bound(premium, 1000 * 10**18, 10_000 * 10**18);
        maxCoverage = bound(maxCoverage, 10_000 * 10**18, 50_000 * 10**18);
        requestedPayout = bound(requestedPayout, 1000 * 10**18, maxCoverage);
        asset.mint(alice, premium);
        vm.startPrank(alice);
        asset.approve(address(manager), premium);
        uint256 pid = manager.buyPolicy(0, 30, maxCoverage, premium, 35, alice, DEFAULT_LAT, DEFAULT_LON);
        vm.stopPrank();
        uint256 before = asset.balanceOf(alice);
        manager.verifyPolicy(pid);
        manager.triggerPayout(pid, 40, requestedPayout);
        uint256 actual = asset.balanceOf(alice) - before;
        assertGt(actual, 0);
        assertLe(actual, requestedPayout);
    }

    function testFuzz_MultipleUsersMultiplePolicies(uint8 numUsers, uint8 numPoliciesPerUser) public {
        numUsers = uint8(bound(numUsers, 1, 10));
        numPoliciesPerUser = uint8(bound(numPoliciesPerUser, 1, 5));
        for (uint8 i = 0; i < numUsers; i++) {
            address user = address(uint160(1000 + i));
            uint256 total = uint256(numPoliciesPerUser) * 1000 * 10**18;
            asset.mint(user, total);
            vm.startPrank(user);
            for (uint8 j = 0; j < numPoliciesPerUser; j++) {
                asset.approve(address(manager), 1000 * 10**18);
                uint256 pid = manager.buyPolicy(0, 30, 10_000 * 10**18, 1000 * 10**18, 35, user, DEFAULT_LAT, DEFAULT_LON);
                assertEq(manager.holderOf(pid), user);
            }
            vm.stopPrank();
        }
        assertEq(manager.nextId() - 1, uint256(numUsers) * uint256(numPoliciesPerUser));
    }

    /* ============ Pro-Rata ============ */

    function test_ProRataPayoutTwoUsersFullyFunded() public {
        uint256 cov1 = 1000 * 10**18; uint256 pre1 = 50 * 10**18;
        uint256 cov2 = 2000 * 10**18; uint256 pre2 = 70 * 10**18;

        vm.startPrank(alice);
        asset.approve(address(manager), pre1);
        uint256 p1 = manager.buyPolicy(0, 30, cov1, pre1, 35, alice, DEFAULT_LAT, DEFAULT_LON);
        vm.stopPrank();
        vm.startPrank(bob);
        asset.approve(address(manager), pre2);
        uint256 p2 = manager.buyPolicy(0, 30, cov2, pre2, 35, bob, DEFAULT_LAT, DEFAULT_LON);
        vm.stopPrank();

        manager.verifyPolicy(p1);
        manager.verifyPolicy(p2);

        uint256 aBefore = asset.balanceOf(alice);
        manager.triggerPayout(p1, 40, cov1);
        assertApproxEqRel(asset.balanceOf(alice) - aBefore, cov1, 0.001e18);

        uint256 bBefore = asset.balanceOf(bob);
        manager.triggerPayout(p2, 40, cov2);
        assertApproxEqRel(asset.balanceOf(bob) - bBefore, cov2, 0.002e18);
    }

    function test_TotalActiveCoverageTracking() public {
        uint256 cov1 = 5000 * 10**18; uint256 cov2 = 3000 * 10**18;
        uint256 pre = 1000 * 10**18;
        assertEq(manager.totalActiveCoverage(), 0);

        vm.startPrank(alice);
        asset.approve(address(manager), pre);
        uint256 p1 = manager.buyPolicy(0, 30, cov1, pre, 35, alice, DEFAULT_LAT, DEFAULT_LON);
        vm.stopPrank();
        assertEq(manager.totalActiveCoverage(), cov1);

        vm.startPrank(bob);
        asset.approve(address(manager), pre);
        uint256 p2 = manager.buyPolicy(0, 30, cov2, pre, 35, bob, DEFAULT_LAT, DEFAULT_LON);
        vm.stopPrank();
        assertEq(manager.totalActiveCoverage(), cov1 + cov2);

        manager.verifyPolicy(p1);
        manager.triggerPayout(p1, 40, cov1);
        assertEq(manager.totalActiveCoverage(), cov2);

        vm.warp(block.timestamp + 31 days);
        manager.releaseExpiredPolicy(p2);
        assertEq(manager.totalActiveCoverage(), 0);
    }

    function test_BuyPolicySucceedsWithNoUnderwriterCapital() public {
        (, , , policyManager fm) = _deployUnderfundedSystem();
        vm.startPrank(alice);
        asset.approve(address(fm), 100 * 10**18);
        uint256 pid = fm.buyPolicy(0, 30, 100_000 * 10**18, 100 * 10**18, 35, alice, DEFAULT_LAT, DEFAULT_LON);
        vm.stopPrank();
        assertEq(pid, 1);
        assertEq(fm.totalActiveCoverage(), 100_000 * 10**18);
    }

    function testFuzz_ProRataPayoutManyUsers(uint8 numUsers) public {
        numUsers = uint8(bound(numUsers, 2, 8));
        (, , , policyManager fm) = _deployUnderfundedSystem();

        uint256[] memory coverages = new uint256[](numUsers);
        uint256[] memory pids = new uint256[](numUsers);
        address[] memory users = new address[](numUsers);
        uint256 totalCov;

        for (uint8 i = 0; i < numUsers; i++) {
            users[i] = address(uint160(0x9000 + i));
            coverages[i] = (uint256(i) + 1) * 1000 * 10**18;
            uint256 premium = (uint256(i) + 1) * 50 * 10**18;
            totalCov += coverages[i];
            asset.mint(users[i], premium);
            vm.startPrank(users[i]);
            asset.approve(address(fm), premium);
            pids[i] = fm.buyPolicy(0, 30, coverages[i], premium, 35, users[i], DEFAULT_LAT, DEFAULT_LON);
            vm.stopPrank();
        }

        for (uint8 i = 0; i < numUsers; i++) {
            fm.verifyPolicy(pids[i]);
        }

        uint256 totalPaid;
        for (uint8 i = 0; i < numUsers; i++) {
            uint256 bal = asset.balanceOf(users[i]);
            fm.triggerPayout(pids[i], 40, coverages[i]);
            uint256 payout = asset.balanceOf(users[i]) - bal;
            assertLe(payout, coverages[i]);
            totalPaid += payout;
        }
        assertEq(fm.totalActiveCoverage(), 0);
    }

    /* ============ Per-Hazard Coverage Tracking ============ */

    function test_ActiveCoverageByHazardTracking() public {
        uint256 cov1 = 5000 * 10**18;
        uint256 cov2 = 3000 * 10**18;
        uint256 pre = 1000 * 10**18;

        // Buy heatwave policy
        vm.startPrank(alice);
        asset.approve(address(manager), pre);
        manager.buyPolicy(0, 30, cov1, pre, 35, alice, DEFAULT_LAT, DEFAULT_LON);
        vm.stopPrank();
        assertEq(manager.activeCoverageByHazard(0), cov1, "heatwave coverage");
        assertEq(manager.activeCoverageByHazard(1), 0, "flood coverage zero");

        // Buy flood policy
        vm.startPrank(bob);
        asset.approve(address(manager), pre);
        manager.buyPolicy(1, 30, cov2, pre, 100, bob, DEFAULT_LAT, DEFAULT_LON);
        vm.stopPrank();
        assertEq(manager.activeCoverageByHazard(0), cov1, "heatwave unchanged");
        assertEq(manager.activeCoverageByHazard(1), cov2, "flood coverage added");
        assertEq(manager.totalActiveCoverage(), cov1 + cov2, "total matches sum");
    }

    function test_ActiveCoverageByHazardDecrementOnPayout() public {
        uint256 cov = 5000 * 10**18;
        uint256 pre = 1000 * 10**18;

        vm.startPrank(alice);
        asset.approve(address(manager), pre);
        uint256 pid = manager.buyPolicy(0, 30, cov, pre, 35, alice, DEFAULT_LAT, DEFAULT_LON);
        vm.stopPrank();
        assertEq(manager.activeCoverageByHazard(0), cov);

        manager.verifyPolicy(pid);
        manager.triggerPayout(pid, 40, cov);
        assertEq(manager.activeCoverageByHazard(0), 0, "heatwave coverage cleared");
    }

    function test_ActiveCoverageByHazardDecrementOnExpiry() public {
        uint256 cov = 5000 * 10**18;
        uint256 pre = 1000 * 10**18;

        vm.startPrank(alice);
        asset.approve(address(manager), pre);
        uint256 pid = manager.buyPolicy(1, 30, cov, pre, 100, alice, DEFAULT_LAT, DEFAULT_LON);
        vm.stopPrank();
        assertEq(manager.activeCoverageByHazard(1), cov);

        vm.warp(block.timestamp + 31 days);
        manager.releaseExpiredPolicy(pid);
        assertEq(manager.activeCoverageByHazard(1), 0, "flood coverage cleared on expiry");
    }

    /* ============ Policy Verification ============ */

    function test_PolicyCreatedAsUnverified() public {
        vm.startPrank(alice);
        asset.approve(address(manager), 1000 * 10**18);
        uint256 pid = manager.buyPolicy(0, 30, 10_000 * 10**18, 1000 * 10**18, 35, alice, DEFAULT_LAT, DEFAULT_LON);
        vm.stopPrank();
        assertEq(uint8(manager.policyStatus(pid)), 0, "new policy should be Unverified");
    }

    function test_VerifyPolicy() public {
        vm.startPrank(alice);
        asset.approve(address(manager), 1000 * 10**18);
        uint256 pid = manager.buyPolicy(0, 30, 10_000 * 10**18, 1000 * 10**18, 35, alice, DEFAULT_LAT, DEFAULT_LON);
        vm.stopPrank();

        vm.expectEmit(true, false, false, false);
        emit policyManager.PolicyVerified(pid);
        manager.verifyPolicy(pid);
        assertEq(uint8(manager.policyStatus(pid)), 1, "should be Verified");
    }

    function test_VerifyPolicyRevertsIfNotOracle() public {
        vm.startPrank(alice);
        asset.approve(address(manager), 1000 * 10**18);
        uint256 pid = manager.buyPolicy(0, 30, 10_000 * 10**18, 1000 * 10**18, 35, alice, DEFAULT_LAT, DEFAULT_LON);
        vm.stopPrank();

        vm.prank(alice);
        vm.expectRevert(bytes("not oracle"));
        manager.verifyPolicy(pid);
    }

    function test_RejectPolicy() public {
        vm.startPrank(alice);
        asset.approve(address(manager), 1000 * 10**18);
        uint256 pid = manager.buyPolicy(0, 30, 10_000 * 10**18, 1000 * 10**18, 35, alice, DEFAULT_LAT, DEFAULT_LON);
        vm.stopPrank();

        uint256 covBefore = manager.totalActiveCoverage();
        (uint256 uBefore, uint256 jBefore, uint256 sBefore) = manager.vaultReservedShares(pid);
        assertGt(uBefore + jBefore + sBefore, 0, "shares should be reserved");

        vm.expectEmit(true, false, false, false);
        emit policyManager.PolicyRejected(pid);
        manager.rejectPolicy(pid);

        assertEq(uint8(manager.policyStatus(pid)), 2, "should be Invalid");
        (uint256 uAfter, uint256 jAfter, uint256 sAfter) = manager.vaultReservedShares(pid);
        assertEq(uAfter + jAfter + sAfter, 0, "shares should be unreserved");
        assertEq(manager.totalActiveCoverage(), covBefore - 10_000 * 10**18, "coverage decremented");
        assertEq(manager.activeCoverageByHazard(0), covBefore - 10_000 * 10**18, "hazard coverage decremented");
    }

    function test_RejectPolicyKeepsPremium() public {
        uint256 uwBefore = uwVault.totalAssets();
        uint256 jrBefore = juniorVault.totalAssets();
        uint256 srBefore = seniorVault.totalAssets();

        vm.startPrank(alice);
        asset.approve(address(manager), 1000 * 10**18);
        uint256 pid = manager.buyPolicy(0, 30, 10_000 * 10**18, 1000 * 10**18, 35, alice, DEFAULT_LAT, DEFAULT_LON);
        vm.stopPrank();

        uint256 uwAfterBuy = uwVault.totalAssets();
        uint256 jrAfterBuy = juniorVault.totalAssets();
        uint256 srAfterBuy = seniorVault.totalAssets();
        assertGt(uwAfterBuy + jrAfterBuy + srAfterBuy, uwBefore + jrBefore + srBefore, "premium deposited");

        manager.rejectPolicy(pid);

        assertEq(uwVault.totalAssets(), uwAfterBuy, "UW assets unchanged after reject");
        assertEq(juniorVault.totalAssets(), jrAfterBuy, "JR assets unchanged after reject");
        assertEq(seniorVault.totalAssets(), srAfterBuy, "SR assets unchanged after reject");
    }

    function test_TriggerPayoutRevertsIfUnverified() public {
        vm.startPrank(alice);
        asset.approve(address(manager), 1000 * 10**18);
        uint256 pid = manager.buyPolicy(0, 30, 10_000 * 10**18, 1000 * 10**18, 35, alice, DEFAULT_LAT, DEFAULT_LON);
        vm.stopPrank();

        vm.expectRevert(bytes("not verified"));
        manager.triggerPayout(pid, 40, 5000 * 10**18);
    }

    function test_TriggerPayoutRevertsIfInvalid() public {
        vm.startPrank(alice);
        asset.approve(address(manager), 1000 * 10**18);
        uint256 pid = manager.buyPolicy(0, 30, 10_000 * 10**18, 1000 * 10**18, 35, alice, DEFAULT_LAT, DEFAULT_LON);
        vm.stopPrank();

        manager.rejectPolicy(pid);

        vm.expectRevert(bytes("not verified"));
        manager.triggerPayout(pid, 40, 5000 * 10**18);
    }

    function test_TriggerPayoutWorksIfVerified() public {
        vm.startPrank(alice);
        asset.approve(address(manager), 1000 * 10**18);
        uint256 pid = manager.buyPolicy(0, 30, 10_000 * 10**18, 1000 * 10**18, 35, alice, DEFAULT_LAT, DEFAULT_LON);
        vm.stopPrank();

        manager.verifyPolicy(pid);

        uint256 before = asset.balanceOf(alice);
        manager.triggerPayout(pid, 40, 5000 * 10**18);
        assertGt(asset.balanceOf(alice) - before, 0, "payout received");
    }

    /* ============ Dynamic Caps (syncVaultCaps) ============ */

    function test_SyncVaultCaps() public {
        // Set capManager on jr and sr vaults
        juniorVault.setCapManager(address(manager));
        seniorVault.setCapManager(address(manager));

        // Change caps on feeModel
        feeModel.setJuniorCap(2_000_000 * 10**18);
        // senior should auto-link: 2M * (10000-2500)/2500 = 2M * 3 = 6M
        assertEq(feeModel.seniorCap(), 6_000_000 * 10**18, "auto-linked senior cap");

        // Sync to vaults
        manager.syncVaultCaps();

        // Verify vault caps updated
        assertEq(juniorVault.cap(), 2_000_000 * 10**18, "junior vault cap synced");
        assertEq(seniorVault.cap(), 6_000_000 * 10**18, "senior vault cap synced");
    }

    function test_SyncVaultCapsAfterModelChange() public {
        juniorVault.setCapManager(address(manager));
        seniorVault.setCapManager(address(manager));

        // Deploy new feeModel with different caps
        FeeRateModel newModel = new FeeRateModel(3_000_000 * 10**18);
        manager.setFeeRateModel(IFeeRateModel(address(newModel)));

        manager.syncVaultCaps();

        assertEq(juniorVault.cap(), 3_000_000 * 10**18, "junior cap from new model");
        assertEq(seniorVault.cap(), 9_000_000 * 10**18, "senior cap from new model");
    }

    /* ============ Auto Cap Sync on Buy ============ */

    function test_BuyPolicyAutoSyncsVaultCaps() public {
        // Change caps on feeModel (junior auto-links senior)
        feeModel.setJuniorCap(5_000_000 * 10**18);
        uint256 expectedSr = feeModel.seniorCap();

        // Before buy, vault caps still at VAULT_CAP
        assertEq(juniorVault.cap(), VAULT_CAP);

        vm.startPrank(alice);
        asset.approve(address(manager), 1000 * 10**18);
        manager.buyPolicy(0, 30, 10_000 * 10**18, 1000 * 10**18, 35, alice, DEFAULT_LAT, DEFAULT_LON);
        vm.stopPrank();

        // After buy, caps should be synced
        assertEq(juniorVault.cap(), 5_000_000 * 10**18, "junior cap synced on buy");
        assertEq(seniorVault.cap(), expectedSr, "senior cap synced on buy");
    }

}
