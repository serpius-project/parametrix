// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.20;

import {Test, console} from "forge-std/Test.sol";
import {underwriterVault} from "../src/underwriterVault.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract MockERC20 is ERC20 {
    constructor() ERC20("Mock Token", "MOCK") {
        _mint(msg.sender, 1_000_000 * 10**18);
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

contract UnderwriterVaultTest is Test {
    underwriterVault public vault;
    MockERC20 public asset;

    address public owner = address(this);
    address public policyManager = address(0x1);
    address public feeRecipient = address(0x2);
    address public alice = address(0x3);
    address public bob = address(0x4);

    uint256 constant CAP = 1_000_000 * 10**18;
    uint256 constant INITIAL_DEPOSIT = 100_000 * 10**18;

    function setUp() public {
        asset = new MockERC20();
        vault = new underwriterVault(
            asset,
            "Underwriter Vault",
            "UWV",
            CAP,
            feeRecipient
        );

        // Set policy manager
        vault.setPolicyManager(policyManager);

        // Setup test users with tokens
        asset.mint(alice, INITIAL_DEPOSIT);
        asset.mint(bob, INITIAL_DEPOSIT);

        vm.label(alice, "Alice");
        vm.label(bob, "Bob");
        vm.label(policyManager, "PolicyManager");
    }

    /* ============ Basic Deposit Tests ============ */

    function test_Deposit() public {
        vm.startPrank(alice);
        asset.approve(address(vault), INITIAL_DEPOSIT);
        uint256 shares = vault.deposit(INITIAL_DEPOSIT, alice);
        vm.stopPrank();

        assertGt(shares, 0, "Should receive shares");
        assertEq(vault.balanceOf(alice), shares, "Share balance mismatch");
    }

    function test_DepositWithFee() public {
        vault.setFee(100, feeRecipient); // 1% fee

        vm.startPrank(alice);
        asset.approve(address(vault), INITIAL_DEPOSIT);
        uint256 shares = vault.deposit(INITIAL_DEPOSIT, alice);
        vm.stopPrank();

        uint256 expectedFee = INITIAL_DEPOSIT * 100 / 10_000;
        assertEq(asset.balanceOf(feeRecipient), expectedFee, "Fee not collected");
        assertGt(shares, 0, "Should receive shares");
    }

    function test_DepositRevertsWhenPaused() public {
        vault.pause();

        vm.startPrank(alice);
        asset.approve(address(vault), INITIAL_DEPOSIT);
        vm.expectRevert();
        vault.deposit(INITIAL_DEPOSIT, alice);
        vm.stopPrank();
    }

    function test_DepositRevertsWhenExceedsCap() public {
        vm.startPrank(alice);
        asset.approve(address(vault), CAP + 1);
        vm.expectRevert(bytes("cap"));
        vault.deposit(CAP + 1, alice);
        vm.stopPrank();
    }

    /* ============ Share Reservation Tests ============ */

    function test_ReserveShares() public {
        // First, policy manager needs shares
        vm.startPrank(policyManager);
        asset.mint(policyManager, INITIAL_DEPOSIT);
        asset.approve(address(vault), INITIAL_DEPOSIT);
        vault.deposit(INITIAL_DEPOSIT, policyManager);

        uint256 sharesToReserve = 1000 * 10**18;
        bool success = vault.reserveShares(sharesToReserve);
        vm.stopPrank();

        assertTrue(success, "Reservation should succeed");
        assertEq(vault.totalReservedShares(), sharesToReserve, "Reserved shares mismatch");
    }

    function test_ReserveSharesRevertsIfUnauthorized() public {
        vm.startPrank(alice);
        asset.approve(address(vault), INITIAL_DEPOSIT);
        vault.deposit(INITIAL_DEPOSIT, alice);

        vm.expectRevert(bytes("not authorized"));
        vault.reserveShares(1000 * 10**18);
        vm.stopPrank();
    }

    function test_ReserveSharesRevertsIfInsufficient() public {
        vm.startPrank(policyManager);
        asset.mint(policyManager, INITIAL_DEPOSIT);
        asset.approve(address(vault), INITIAL_DEPOSIT);
        uint256 shares = vault.deposit(INITIAL_DEPOSIT, policyManager);

        vm.expectRevert(bytes("insufficient liquidity"));
        vault.reserveShares(shares + 1);
        vm.stopPrank();
    }

    function test_UnreserveShares() public {
        // Setup: reserve some shares
        vm.startPrank(policyManager);
        asset.mint(policyManager, INITIAL_DEPOSIT);
        asset.approve(address(vault), INITIAL_DEPOSIT);
        vault.deposit(INITIAL_DEPOSIT, policyManager);

        uint256 sharesToReserve = 1000 * 10**18;
        vault.reserveShares(sharesToReserve);

        // Unreserve
        bool success = vault.unreserveShares(sharesToReserve);
        vm.stopPrank();

        assertTrue(success, "Unreservation should succeed");
        assertEq(vault.totalReservedShares(), 0, "Should have no reserved shares");
    }

    function test_UnreserveSharesRevertsIfUnauthorized() public {
        vm.prank(alice);
        vm.expectRevert(bytes("not authorized"));
        vault.unreserveShares(1000 * 10**18);
    }

    /* ============ Max Withdraw/Redeem Tests ============ */

    function test_MaxWithdrawWithoutReservation() public {
        vm.startPrank(alice);
        asset.approve(address(vault), INITIAL_DEPOSIT);
        vault.deposit(INITIAL_DEPOSIT, alice);

        uint256 maxWithdraw = vault.maxWithdraw(alice);
        vm.stopPrank();

        assertGt(maxWithdraw, 0, "Should be able to withdraw");
        assertApproxEqRel(maxWithdraw, INITIAL_DEPOSIT, 0.01e18, "Should be able to withdraw deposited amount");
    }

    function test_MaxWithdrawPolicyManagerWithReservation() public {
        // Policy manager deposits
        vm.startPrank(policyManager);
        asset.mint(policyManager, INITIAL_DEPOSIT);
        asset.approve(address(vault), INITIAL_DEPOSIT);
        uint256 shares = vault.deposit(INITIAL_DEPOSIT, policyManager);

        // Reserve half the shares
        uint256 sharesToReserve = shares / 2;
        vault.reserveShares(sharesToReserve);

        uint256 maxWithdraw = vault.maxWithdraw(policyManager);
        vm.stopPrank();

        assertGt(maxWithdraw, 0, "Should be able to withdraw unreserved");
        assertLt(maxWithdraw, INITIAL_DEPOSIT, "Should not withdraw full amount");
    }

    function test_MaxWithdrawPolicyManagerWithFullReservation() public {
        // Policy manager deposits
        vm.startPrank(policyManager);
        asset.mint(policyManager, INITIAL_DEPOSIT);
        asset.approve(address(vault), INITIAL_DEPOSIT);
        uint256 shares = vault.deposit(INITIAL_DEPOSIT, policyManager);

        // Reserve all shares
        vault.reserveShares(shares);

        uint256 maxWithdraw = vault.maxWithdraw(policyManager);
        vm.stopPrank();

        assertEq(maxWithdraw, 0, "Should not be able to withdraw when fully reserved");
    }

    function test_MaxRedeemWithReservation() public {
        vm.startPrank(policyManager);
        asset.mint(policyManager, INITIAL_DEPOSIT);
        asset.approve(address(vault), INITIAL_DEPOSIT);
        uint256 shares = vault.deposit(INITIAL_DEPOSIT, policyManager);

        uint256 sharesToReserve = shares / 2;
        vault.reserveShares(sharesToReserve);

        uint256 maxRedeem = vault.maxRedeem(policyManager);
        vm.stopPrank();

        assertEq(maxRedeem, shares - sharesToReserve, "Should only redeem unreserved shares");
    }

    /* ============ Admin Functions Tests ============ */

    function test_SetCap() public {
        uint256 newCap = 2_000_000 * 10**18;
        vault.setCap(newCap);
        assertEq(vault.cap(), newCap, "Cap not updated");
    }

    function test_SetFee() public {
        vault.setFee(200, feeRecipient);
        assertEq(vault.depositFeeBps(), 200, "Fee not updated");
    }

    function test_SetFeeRevertsIfTooHigh() public {
        vm.expectRevert(bytes("fee too high"));
        vault.setFee(501, feeRecipient);
    }

    function test_SetPolicyManager() public {
        address newPM = address(0x999);
        vault.setPolicyManager(newPM);
        assertEq(vault.policyManager(), newPM, "Policy manager not updated");
    }

    /* ============ Fuzz Tests ============ */

    function testFuzz_Deposit(uint256 amount) public {
        amount = bound(amount, 1, CAP);

        asset.mint(alice, amount);

        vm.startPrank(alice);
        asset.approve(address(vault), amount);
        uint256 shares = vault.deposit(amount, alice);
        vm.stopPrank();

        assertGt(shares, 0, "Should receive shares");
        assertEq(vault.balanceOf(alice), shares, "Share balance mismatch");
    }

    function testFuzz_ReserveShares(uint256 depositAmount, uint256 reserveAmount) public {
        depositAmount = bound(depositAmount, 1000, CAP);

        vm.startPrank(policyManager);
        asset.mint(policyManager, depositAmount);
        asset.approve(address(vault), depositAmount);
        uint256 shares = vault.deposit(depositAmount, policyManager);

        reserveAmount = bound(reserveAmount, 1, shares);

        bool success = vault.reserveShares(reserveAmount);
        vm.stopPrank();

        assertTrue(success, "Reservation should succeed");
        assertEq(vault.totalReservedShares(), reserveAmount, "Reserved shares mismatch");
    }

    function testFuzz_MaxWithdrawWithReservation(uint256 depositAmount, uint256 reservePercent) public {
        depositAmount = bound(depositAmount, 1000, CAP);
        reservePercent = bound(reservePercent, 0, 100);

        vm.startPrank(policyManager);
        asset.mint(policyManager, depositAmount);
        asset.approve(address(vault), depositAmount);
        uint256 shares = vault.deposit(depositAmount, policyManager);

        uint256 sharesToReserve = shares * reservePercent / 100;
        if (sharesToReserve > 0) {
            vault.reserveShares(sharesToReserve);
        }

        uint256 maxWithdraw = vault.maxWithdraw(policyManager);
        vm.stopPrank();

        if (reservePercent == 100) {
            assertEq(maxWithdraw, 0, "Should not withdraw when fully reserved");
        } else {
            assertGt(maxWithdraw, 0, "Should be able to withdraw unreserved");
        }
    }
}
