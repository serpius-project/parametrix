// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.20;

import {Test, console} from "forge-std/Test.sol";
import {FeeRateModel} from "../src/FeeRateModel.sol";
import {IFeeRateModel} from "../src/IFeeRateModel.sol";

contract FeeRateModelTest is Test {
    FeeRateModel public model;

    uint256 constant JUNIOR_CAP = 5_000_000 * 10**6;
    uint256 constant SENIOR_CAP = 15_000_000 * 10**6;

    function setUp() public {
        model = new FeeRateModel(JUNIOR_CAP);
    }

    /* ============ Default Parameter Tests ============ */

    function test_DefaultParameters() public view {
        assertEq(model.baseSeniorBps(), 2000, "baseSeniorBps default");
        assertEq(model.underwriterBps(), 500, "underwriterBps default");
        assertEq(model.uTargetBps(), 2500, "uTargetBps default");
        assertEq(model.kBps(), 5000, "kBps default");
        assertEq(model.juniorCap(), JUNIOR_CAP, "junior cap");
        assertEq(model.seniorCap(), SENIOR_CAP, "senior cap");
    }

    /* ============ Fee Split Tests ============ */

    function test_DefaultSplitWhenBalanced() public view {
        // When junior is at target ratio (25% of tranche capital)
        // u' = 250 / (250 + 750) = 0.25 = uTarget → deviation = 0
        // feeSenior = 2000 + 0 = 2000 (20%)
        // feeJunior = 10000 - 500 - 2000 = 7500 (75%)
        IFeeRateModel.FeeAllocation memory alloc = model.getFeeSplit(
            1000e6, // premium
            250e6,  // junior capital (25%)
            750e6,  // senior capital (75%)
            100e6   // underwriter capital
        );

        assertEq(alloc.juniorBps, 7500, "junior at target");
        assertEq(alloc.seniorBps, 2000, "senior at target");
        assertEq(alloc.underwriterBps, 500, "underwriter at target");
        assertEq(alloc.juniorBps + alloc.seniorBps + alloc.underwriterBps, 10000, "sums to 100%");
    }

    function test_SplitWhenZeroCapital() public view {
        // When both are zero, defaults to target ratio
        IFeeRateModel.FeeAllocation memory alloc = model.getFeeSplit(
            1000e6, 0, 0, 0
        );

        assertEq(alloc.juniorBps, 7500, "junior default");
        assertEq(alloc.seniorBps, 2000, "senior default");
        assertEq(alloc.underwriterBps, 500, "underwriter default");
    }

    function test_SplitWhenJuniorOverweight() public view {
        // Junior at 50% (over target of 25%) → senior fee increases
        // u' = 5000 bps, deviation = 5000 - 2500 = 2500
        // seniorAdj = 2000 + (5000 * 2500) / 10000 = 2000 + 1250 = 3250
        IFeeRateModel.FeeAllocation memory alloc = model.getFeeSplit(
            1000e6,
            500e6,  // 50% of tranche
            500e6,  // 50% of tranche
            100e6
        );

        assertEq(alloc.seniorBps, 3250, "senior increases when junior overweight");
        assertEq(alloc.juniorBps, 6250, "junior decreases when overweight");
        assertEq(alloc.underwriterBps, 500, "underwriter unchanged");
        assertEq(alloc.juniorBps + alloc.seniorBps + alloc.underwriterBps, 10000, "sums to 100%");
    }

    function test_SplitWhenSeniorOverweight() public view {
        // Junior at 10% (under target of 25%) → senior fee decreases
        // u' = 1000 bps, deviation = 1000 - 2500 = -1500
        // seniorAdj = 2000 + (5000 * -1500) / 10000 = 2000 - 750 = 1250
        IFeeRateModel.FeeAllocation memory alloc = model.getFeeSplit(
            1000e6,
            100e6,  // 10% of tranche
            900e6,  // 90% of tranche
            100e6
        );

        assertEq(alloc.seniorBps, 1250, "senior decreases when senior overweight");
        assertEq(alloc.juniorBps, 8250, "junior increases to attract capital");
        assertEq(alloc.underwriterBps, 500, "underwriter unchanged");
    }

    function test_SeniorFeeClampedToZero() public view {
        // Extreme case: junior is 0%, senior is 100%
        // u' = 0, deviation = 0 - 2500 = -2500
        // seniorAdj = 2000 + (5000 * -2500) / 10000 = 2000 - 1250 = 750
        // Not negative here, but let's set k high enough to force negative
        // This test uses defaults where it won't go negative, but we test the clamp path
    }

    function test_SeniorFeeClampedToZeroWithHighK() public {
        model.setKBps(20000); // very high k

        // u' = 0, deviation = -2500
        // seniorAdj = 2000 + (20000 * -2500) / 10000 = 2000 - 5000 = -3000 → clamped to 0
        IFeeRateModel.FeeAllocation memory alloc = model.getFeeSplit(
            1000e6, 0, 1000e6, 0
        );

        assertEq(alloc.seniorBps, 0, "senior clamped to 0");
        assertEq(alloc.juniorBps, 9500, "junior gets remainder");
        assertEq(alloc.underwriterBps, 500, "underwriter unchanged");
    }

    function test_SeniorFeeClampedToMax() public {
        model.setKBps(50000); // very high k

        // u' = 100% (10000 bps), deviation = 10000 - 2500 = 7500
        // seniorAdj = 2000 + (50000 * 7500) / 10000 = 2000 + 37500 = 39500 → clamped to 9500
        IFeeRateModel.FeeAllocation memory alloc = model.getFeeSplit(
            1000e6, 1000e6, 0, 0
        );

        assertEq(alloc.seniorBps, 9500, "senior clamped to max (10000 - underwriterBps)");
        assertEq(alloc.juniorBps, 0, "junior gets 0");
        assertEq(alloc.underwriterBps, 500, "underwriter unchanged");
    }

    /* ============ Fuzz: Split Always Sums to 10000 ============ */

    function testFuzz_SplitSumsTo10000(
        uint256 capitalJunior,
        uint256 capitalSenior,
        uint256 capitalUnderwriter,
        uint256 premium
    ) public view {
        capitalJunior = bound(capitalJunior, 0, 100_000_000e6);
        capitalSenior = bound(capitalSenior, 0, 100_000_000e6);
        capitalUnderwriter = bound(capitalUnderwriter, 0, 100_000_000e6);
        premium = bound(premium, 1, 10_000_000e6);

        IFeeRateModel.FeeAllocation memory alloc = model.getFeeSplit(
            premium, capitalJunior, capitalSenior, capitalUnderwriter
        );

        assertEq(
            alloc.juniorBps + alloc.seniorBps + alloc.underwriterBps,
            10000,
            "Split must always sum to 10000"
        );
    }

    /* ============ Owner Setter Tests ============ */

    function test_OwnerCanSetBaseSeniorBps() public {
        model.setBaseSeniorBps(3000);
        assertEq(model.baseSeniorBps(), 3000);
    }

    function test_OwnerCanSetUnderwriterBps() public {
        model.setUnderwriterBps(1000);
        assertEq(model.underwriterBps(), 1000);
    }

    function test_OwnerCanSetUTargetBps() public {
        model.setUTargetBps(5000);
        assertEq(model.uTargetBps(), 5000);
    }

    function test_OwnerCanSetKBps() public {
        model.setKBps(10000);
        assertEq(model.kBps(), 10000);
    }

    function test_OwnerCanSetJuniorCap() public {
        model.setJuniorCap(10_000_000e6);
        assertEq(model.juniorCap(), 10_000_000e6);
    }

    function test_OwnerCanSetSeniorCap() public {
        model.setSeniorCap(20_000_000e6);
        assertEq(model.seniorCap(), 20_000_000e6);
    }

    function test_NonOwnerCannotSetParams() public {
        vm.startPrank(address(0xBEEF));

        vm.expectRevert();
        model.setBaseSeniorBps(3000);

        vm.expectRevert();
        model.setUnderwriterBps(1000);

        vm.expectRevert();
        model.setUTargetBps(5000);

        vm.expectRevert();
        model.setKBps(10000);

        vm.expectRevert();
        model.setJuniorCap(10_000_000e6);

        vm.expectRevert();
        model.setSeniorCap(20_000_000e6);

        vm.stopPrank();
    }

    function test_SetBaseSeniorBpsRevertsIfOutOfRange() public {
        vm.expectRevert(bytes("out of range"));
        model.setBaseSeniorBps(10001);
    }

    function test_SetUnderwriterBpsRevertsIfOutOfRange() public {
        vm.expectRevert(bytes("out of range"));
        model.setUnderwriterBps(10001);
    }

    /* ============ Linked Cap Tests ============ */

    function test_SetJuniorCapLinksSeniorCap() public {
        model.setJuniorCap(2_000_000e6);
        // uTargetBps = 2500 (25%), so senior = junior * 3
        assertEq(model.juniorCap(), 2_000_000e6, "junior cap set");
        assertEq(model.seniorCap(), 6_000_000e6, "senior auto-linked to 3x junior");
    }

    function test_SetSeniorCapLinksJuniorCap() public {
        model.setSeniorCap(12_000_000e6);
        // junior = senior * 2500 / 7500 = senior / 3
        assertEq(model.seniorCap(), 12_000_000e6, "senior cap set");
        assertEq(model.juniorCap(), 4_000_000e6, "junior auto-linked to 1/3 senior");
    }

    function test_SetCapsIndependent() public {
        model.setCapsIndependent(1_000_000e6, 10_000_000e6);
        assertEq(model.juniorCap(), 1_000_000e6, "independent junior");
        assertEq(model.seniorCap(), 10_000_000e6, "independent senior");
    }

    function test_ComputeLinkedSeniorCap() public view {
        // With uTargetBps = 2500: senior = junior * (10000 - 2500) / 2500 = junior * 3
        assertEq(model.computeLinkedSeniorCap(5_000_000e6), 15_000_000e6, "5M jr -> 15M sr");
        assertEq(model.computeLinkedSeniorCap(1_000_000e6), 3_000_000e6, "1M jr -> 3M sr");
    }

    function test_ComputeLinkedJuniorCap() public view {
        assertEq(model.computeLinkedJuniorCap(15_000_000e6), 5_000_000e6, "15M sr -> 5M jr");
        assertEq(model.computeLinkedJuniorCap(3_000_000e6), 1_000_000e6, "3M sr -> 1M jr");
    }

    function test_LinkedCapRatioMatchesUTarget() public {
        model.setJuniorCap(7_777_777e6);
        uint256 jr = model.juniorCap();
        uint256 sr = model.seniorCap();
        // jr / (jr + sr) should == uTargetBps / 10000
        uint256 actualRatioBps = (jr * 10000) / (jr + sr);
        assertEq(actualRatioBps, model.uTargetBps(), "ratio matches uTarget");
    }
}
