// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.20;

import {Test, console} from "forge-std/Test.sol";
import {underwriterVault} from "../src/underwriterVault.sol";
import {policyManager} from "../src/policyManager.sol";
import {FeeRateModel} from "../src/FeeRateModel.sol";
import {IUnderwriterVault} from "../src/IUnderwriterVault.sol";
import {IFeeRateModel} from "../src/IFeeRateModel.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

// ── Mock Aave contracts ────────────────────────────────────────────────────

contract MockAToken is ERC20 {
    address public UNDERLYING_ASSET_ADDRESS;

    constructor(address underlying) ERC20("aUSDC", "aUSDC") {
        UNDERLYING_ASSET_ADDRESS = underlying;
    }

    function mint(address to, uint256 amount) external { _mint(to, amount); }
    function burn(address from, uint256 amount) external { _burn(from, amount); }
}

contract MockAavePool {
    MockAToken public aToken;
    IERC20 public underlying;

    constructor(address underlying_) {
        underlying = IERC20(underlying_);
        aToken = new MockAToken(underlying_);
    }

    function supply(address, uint256 amount, address onBehalfOf, uint16) external {
        // Pool holds the underlying (like real Aave)
        underlying.transferFrom(msg.sender, address(this), amount);
        aToken.mint(onBehalfOf, amount);
    }

    function withdraw(address, uint256 amount, address to) external returns (uint256) {
        uint256 bal = aToken.balanceOf(msg.sender);
        uint256 actual = amount > bal ? bal : amount;
        aToken.burn(msg.sender, actual);
        // Transfer underlying from pool to recipient
        underlying.transfer(to, actual);
        return actual;
    }
}

// ── Mock ERC20 ─────────────────────────────────────────────────────────────

contract MockERC20 is ERC20 {
    constructor() ERC20("Mock USDC", "USDC") {
        _mint(msg.sender, 10_000_000 * 10**18);
    }
    function mint(address to, uint256 amount) external { _mint(to, amount); }
}

// ── Tests ──────────────────────────────────────────────────────────────────

contract AaveIntegrationTest is Test {
    underwriterVault public vault;
    MockERC20 public asset;
    MockAavePool public aavePool;
    MockAToken public aToken;

    address public owner = address(this);
    address public alice = address(0x3);
    address public feeRecipient = address(0x2);

    uint256 constant VAULT_CAP = 10_000_000 * 10**18;
    uint256 constant DEPOSIT_AMOUNT = 1_000_000 * 10**18;

    function setUp() public {
        asset = new MockERC20();
        vault = new underwriterVault(asset, "Test Vault", "TV", VAULT_CAP, feeRecipient);

        // Deploy mock Aave
        aavePool = new MockAavePool(address(asset));
        aToken = aavePool.aToken();

        // Configure Aave on vault
        vault.setAavePool(address(aavePool), address(aToken));
        vault.setAaveTargetBps(7000); // 70%
        vault.setAaveEnabled(true);

        // Fund alice
        asset.mint(alice, DEPOSIT_AMOUNT * 10);
    }

    /* ============ totalAssets includes Aave ============ */

    function test_TotalAssetsIncludesAave() public {
        // Deposit to vault
        vm.startPrank(alice);
        asset.approve(address(vault), DEPOSIT_AMOUNT);
        vault.deposit(DEPOSIT_AMOUNT, alice);
        vm.stopPrank();

        // totalAssets should equal deposit amount
        assertEq(vault.totalAssets(), DEPOSIT_AMOUNT, "totalAssets after deposit");

        // Some should be in Aave (70% target)
        uint256 inAave = vault.aaveBalance();
        uint256 local = vault.localBalance();
        assertEq(inAave + local, DEPOSIT_AMOUNT, "local + aave = total");
        assertApproxEqRel(inAave, DEPOSIT_AMOUNT * 7000 / 10000, 0.01e18, "~70% in Aave");
    }

    /* ============ Deposit triggers Aave supply ============ */

    function test_DepositTriggersAaveSupply() public {
        vm.startPrank(alice);
        asset.approve(address(vault), DEPOSIT_AMOUNT);
        vault.deposit(DEPOSIT_AMOUNT, alice);
        vm.stopPrank();

        assertGt(vault.aaveBalance(), 0, "should have aave balance");
        assertApproxEqRel(
            vault.aaveBalance(),
            DEPOSIT_AMOUNT * 7000 / 10000,
            0.01e18,
            "aave balance ~70%"
        );
    }

    /* ============ Withdraw from local first ============ */

    function test_WithdrawFromLocalFirst() public {
        vm.startPrank(alice);
        asset.approve(address(vault), DEPOSIT_AMOUNT);
        vault.deposit(DEPOSIT_AMOUNT, alice);

        // Local is ~30%. Withdraw less than local balance.
        uint256 local = vault.localBalance();
        uint256 smallWithdraw = local / 2;
        uint256 aaveBefore = vault.aaveBalance();

        vault.withdraw(smallWithdraw, alice, alice);

        // Aave balance should be unchanged
        assertEq(vault.aaveBalance(), aaveBefore, "aave unchanged for small withdraw");
        vm.stopPrank();
    }

    /* ============ Withdraw pulls from Aave when needed ============ */

    function test_WithdrawPullsFromAave() public {
        vm.startPrank(alice);
        asset.approve(address(vault), DEPOSIT_AMOUNT);
        vault.deposit(DEPOSIT_AMOUNT, alice);

        // Withdraw more than local balance (which is ~30%)
        uint256 local = vault.localBalance();
        uint256 largeWithdraw = local + 100_000 * 10**18;
        uint256 aaveBefore = vault.aaveBalance();

        vault.withdraw(largeWithdraw, alice, alice);

        assertLt(vault.aaveBalance(), aaveBefore, "aave balance should decrease");
        vm.stopPrank();
    }

    /* ============ withdrawForPayout pulls from Aave ============ */

    function test_WithdrawForPayoutPullsFromAave() public {
        // Set up with policyManager
        vault.setPolicyManager(address(this));

        vm.startPrank(alice);
        asset.approve(address(vault), DEPOSIT_AMOUNT);
        vault.deposit(DEPOSIT_AMOUNT, alice);
        vm.stopPrank();

        // Reserve some shares
        uint256 shares = vault.previewWithdraw(DEPOSIT_AMOUNT / 2);
        vault.reserveShares(shares);

        // Withdraw more than local balance
        uint256 payoutAmount = DEPOSIT_AMOUNT / 2;
        uint256 aaveBefore = vault.aaveBalance();

        vault.withdrawForPayout(payoutAmount, alice, shares);

        // Aave should have been tapped if local wasn't enough
        uint256 aaveAfter = vault.aaveBalance();
        // Total assets should decrease by payout
        assertApproxEqAbs(
            vault.totalAssets(),
            DEPOSIT_AMOUNT - payoutAmount,
            2,
            "total assets decreased by payout"
        );
    }

    /* ============ Rebalance moves to Aave ============ */

    function test_RebalanceMovesToAave() public {
        // Disable Aave first, deposit, then enable and rebalance
        vault.setAaveEnabled(false);

        vm.startPrank(alice);
        asset.approve(address(vault), DEPOSIT_AMOUNT);
        vault.deposit(DEPOSIT_AMOUNT, alice);
        vm.stopPrank();

        assertEq(vault.aaveBalance(), 0, "no aave before rebalance");
        assertEq(vault.localBalance(), DEPOSIT_AMOUNT, "all local");

        // Enable and rebalance
        vault.setAaveEnabled(true);
        vault.rebalance();

        assertApproxEqRel(
            vault.aaveBalance(),
            DEPOSIT_AMOUNT * 7000 / 10000,
            0.01e18,
            "~70% in Aave after rebalance"
        );
    }

    /* ============ Rebalance withdraws from Aave ============ */

    function test_RebalanceWithdrawsFromAave() public {
        vm.startPrank(alice);
        asset.approve(address(vault), DEPOSIT_AMOUNT);
        vault.deposit(DEPOSIT_AMOUNT, alice);
        vm.stopPrank();

        // Reduce target to 30%
        vault.setAaveTargetBps(3000);
        vault.rebalance();

        assertApproxEqRel(
            vault.aaveBalance(),
            DEPOSIT_AMOUNT * 3000 / 10000,
            0.01e18,
            "~30% in Aave after rebalance"
        );
    }

    /* ============ Aave disabled: no supply ============ */

    function test_AaveDisabledNoSupply() public {
        vault.setAaveEnabled(false);

        vm.startPrank(alice);
        asset.approve(address(vault), DEPOSIT_AMOUNT);
        vault.deposit(DEPOSIT_AMOUNT, alice);
        vm.stopPrank();

        assertEq(vault.aaveBalance(), 0, "no aave when disabled");
        assertEq(vault.localBalance(), DEPOSIT_AMOUNT, "all local");
    }

    /* ============ Aave config setters ============ */

    function test_SetAaveTargetBpsRevertsAbove90() public {
        vm.expectRevert(bytes("max 90%"));
        vault.setAaveTargetBps(9001);
    }

    function test_SetAavePoolRevertsZeroAddress() public {
        vm.expectRevert(bytes("zero address"));
        vault.setAavePool(address(0), address(aToken));
    }

    function test_RebalanceRevertsWhenDisabled() public {
        vault.setAaveEnabled(false);
        vm.expectRevert(bytes("aave not enabled"));
        vault.rebalance();
    }

    /* ============ Fuzz: totalAssets always consistent ============ */

    function testFuzz_TotalAssetsConsistency(uint256 depositAmt) public {
        depositAmt = bound(depositAmt, 1e18, VAULT_CAP);

        asset.mint(alice, depositAmt);
        vm.startPrank(alice);
        asset.approve(address(vault), depositAmt);
        vault.deposit(depositAmt, alice);
        vm.stopPrank();

        // totalAssets should always equal local + aave
        assertEq(
            vault.totalAssets(),
            vault.localBalance() + vault.aaveBalance(),
            "totalAssets == local + aave"
        );
    }

    /* ============ E2E: Payout waterfall with Aave ============ */

    function test_PayoutWaterfallWithAave() public {
        // Set up full system: 3 vaults + feeModel + policyManager
        underwriterVault jrVault = new underwriterVault(asset, "Junior", "JR", VAULT_CAP, feeRecipient);
        underwriterVault srVault = new underwriterVault(asset, "Senior", "SR", VAULT_CAP, feeRecipient);
        FeeRateModel feeModel = new FeeRateModel(VAULT_CAP);

        policyManager manager = new policyManager(
            asset,
            IUnderwriterVault(address(vault)),
            IUnderwriterVault(address(jrVault)),
            IUnderwriterVault(address(srVault)),
            IFeeRateModel(address(feeModel)),
            "https://test.com/{id}"
        );

        vault.setPolicyManager(address(manager));
        jrVault.setPolicyManager(address(manager));
        srVault.setPolicyManager(address(manager));
        jrVault.setCapManager(address(manager));
        srVault.setCapManager(address(manager));

        // Configure Aave on all vaults
        jrVault.setAavePool(address(aavePool), address(aToken));
        jrVault.setAaveTargetBps(7000);
        jrVault.setAaveEnabled(true);
        srVault.setAavePool(address(aavePool), address(aToken));
        srVault.setAaveTargetBps(7000);
        srVault.setAaveEnabled(true);

        // Seed liquidity
        address depositor = address(0x5);
        asset.mint(depositor, DEPOSIT_AMOUNT * 3);
        vm.startPrank(depositor);
        asset.approve(address(vault), DEPOSIT_AMOUNT);
        vault.deposit(DEPOSIT_AMOUNT, depositor);
        asset.approve(address(jrVault), DEPOSIT_AMOUNT);
        jrVault.deposit(DEPOSIT_AMOUNT, depositor);
        asset.approve(address(srVault), DEPOSIT_AMOUNT);
        srVault.deposit(DEPOSIT_AMOUNT, depositor);
        vm.stopPrank();

        // Buy a policy
        uint256 premium = 10_000 * 10**18;
        uint256 coverage = 100_000 * 10**18;
        asset.mint(alice, premium);
        vm.startPrank(alice);
        asset.approve(address(manager), premium);
        uint256 pid = manager.buyPolicy(0, 30, coverage, premium, 35, alice, 0, 0);
        vm.stopPrank();

        // Verify and trigger payout — should pull from Aave as needed
        manager.verifyPolicy(pid);
        uint256 payoutAmount = 50_000 * 10**18;
        uint256 aliceBefore = asset.balanceOf(alice);
        manager.triggerPayout(pid, 40, payoutAmount);
        uint256 aliceReceived = asset.balanceOf(alice) - aliceBefore;

        assertGt(aliceReceived, 0, "alice received payout");
        assertApproxEqAbs(aliceReceived, payoutAmount, 3, "payout ~= requested");
    }
}
