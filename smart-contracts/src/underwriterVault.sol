// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.20;
pragma abicoder v2;

import {ERC4626} from "@openzeppelin/contracts/token/ERC20/extensions/ERC4626.sol";
import {ERC20}   from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC20}  from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {IAavePool} from "./interfaces/IAavePool.sol";
import {IAToken} from "./interfaces/IAToken.sol";

contract underwriterVault is ERC4626, Ownable, Pausable, ReentrancyGuard {
    uint256 public cap;              // max totalAssets
    uint256 public depositFeeBps;    // fee on assets deposited (LP side)
    address public feeRecipient;
    address public policyManager;    // authorized to reserve shares
    uint256 public totalReservedShares; // shares locked for policy coverage
    address public capManager;       // authorized to update cap (e.g. policyManager)

    // ── Lockup configuration ─────────────────────────────────────────────
    bool    public lockupEnabled;                        // default false
    uint256 public lockupDuration;                       // seconds (e.g. 2592000 = 30 days)
    mapping(address => uint256) public depositTimestamp;  // last deposit time per user

    // ── Aave yield integration ─────────────────────────────────────────────
    IAavePool public aavePool;
    IAToken   public aToken;
    uint256   public aaveTargetBps;   // 0-9000 (max 90% of totalAssets in Aave)
    bool      public aaveEnabled;

    event AaveSupply(uint256 amount);
    event AaveWithdraw(uint256 amount);
    event Rebalanced(uint256 localBalance, uint256 aaveBalance);

    constructor(IERC20 asset_, string memory name_, string memory symbol_, uint256 cap_, address feeRecipient_)
        ERC4626(asset_)
        ERC20(name_, symbol_)
        Ownable(msg.sender)
    {
        cap = cap_;
        feeRecipient = feeRecipient_;
    }

    // ── Owner setters ──────────────────────────────────────────────────────
    function setCap(uint256 newCap) external onlyOwner { cap = newCap; }
    function setFee(uint256 bps, address recipient) external onlyOwner {
        require(bps <= 500, "fee too high");
        depositFeeBps = bps;
        feeRecipient = recipient;
    }
    function setPolicyManager(address pm) external onlyOwner { policyManager = pm; }
    function setCapManager(address cm) external onlyOwner { capManager = cm; }
    function setCapFromManager(uint256 newCap) external {
        require(msg.sender == capManager, "not authorized");
        cap = newCap;
    }
    function pause() external onlyOwner { _pause(); }
    function unpause() external onlyOwner { _unpause(); }
    function setLockupEnabled(bool enabled) external onlyOwner { lockupEnabled = enabled; }
    function setLockupDuration(uint256 duration) external onlyOwner {
        require(duration <= 365 days, "max 365 days");
        lockupDuration = duration;
    }

    // ── Aave configuration ─────────────────────────────────────────────────
    function setAavePool(address pool, address aToken_) external onlyOwner {
        require(pool != address(0) && aToken_ != address(0), "zero address");
        aavePool = IAavePool(pool);
        aToken = IAToken(aToken_);
    }

    function setAaveTargetBps(uint256 bps) external onlyOwner {
        require(bps <= 9000, "max 90%");
        aaveTargetBps = bps;
    }

    function setAaveEnabled(bool enabled) external onlyOwner {
        aaveEnabled = enabled;
    }

    // ── Aave view helpers ──────────────────────────────────────────────────
    function localBalance() public view returns (uint256) {
        return IERC20(asset()).balanceOf(address(this));
    }

    function aaveBalance() public view returns (uint256) {
        if (address(aToken) == address(0)) return 0;
        return aToken.balanceOf(address(this));
    }

    /// @notice Total assets = local USDC + aToken balance (includes accrued yield)
    function totalAssets() public view override returns (uint256) {
        return localBalance() + aaveBalance();
    }

    // ── Aave internal helpers ──────────────────────────────────────────────

    /// @dev Deposit USDC into Aave lending pool
    function _supplyToAave(uint256 amount) internal {
        if (!aaveEnabled || address(aavePool) == address(0) || amount == 0) return;
        IERC20(asset()).approve(address(aavePool), amount);
        aavePool.supply(asset(), amount, address(this), 0);
        emit AaveSupply(amount);
    }

    /// @dev Withdraw USDC from Aave lending pool
    function _withdrawFromAave(uint256 amount) internal returns (uint256 withdrawn) {
        if (address(aavePool) == address(0) || amount == 0) return 0;
        uint256 available = aaveBalance();
        uint256 toWithdraw = amount > available ? available : amount;
        if (toWithdraw == 0) return 0;
        withdrawn = aavePool.withdraw(asset(), toWithdraw, address(this));
        emit AaveWithdraw(withdrawn);
    }

    /// @dev Ensure at least `needed` USDC is available locally. Pull from Aave if necessary.
    function _ensureLocalLiquidity(uint256 needed) internal {
        uint256 local = localBalance();
        if (local >= needed) return;
        _withdrawFromAave(needed - local);
    }

    /// @dev After a deposit, deploy excess USDC to Aave if target not met
    function _deployToAaveIfNeeded() internal {
        if (!aaveEnabled || aaveTargetBps == 0) return;
        uint256 ta = totalAssets();
        uint256 targetInAave = (ta * aaveTargetBps) / 10_000;
        uint256 currentInAave = aaveBalance();
        if (currentInAave >= targetInAave) return;
        uint256 toSupply = targetInAave - currentInAave;
        uint256 localAvail = localBalance();
        if (toSupply > localAvail) toSupply = localAvail;
        _supplyToAave(toSupply);
    }

    /// @notice Rebalance vault's Aave allocation to match target
    function rebalance() external onlyOwner nonReentrant {
        require(aaveEnabled, "aave not enabled");
        uint256 ta = totalAssets();
        uint256 targetInAave = (ta * aaveTargetBps) / 10_000;
        uint256 currentInAave = aaveBalance();

        if (currentInAave < targetInAave) {
            uint256 toSupply = targetInAave - currentInAave;
            uint256 localAvail = localBalance();
            if (toSupply > localAvail) toSupply = localAvail;
            _supplyToAave(toSupply);
        } else if (currentInAave > targetInAave) {
            _withdrawFromAave(currentInAave - targetInAave);
        }

        emit Rebalanced(localBalance(), aaveBalance());
    }

    // ── Share reservation (PolicyManager only) ─────────────────────────────

    function reserveShares(uint256 shares) external returns (uint256 reserved) {
        require(msg.sender == policyManager, "not authorized");
        uint256 available = totalSupply() > totalReservedShares
            ? totalSupply() - totalReservedShares
            : 0;
        reserved = shares < available ? shares : available;
        totalReservedShares += reserved;
    }

    function unreserveShares(uint256 shares) external returns (bool) {
        require(msg.sender == policyManager, "not authorized");
        require(totalReservedShares >= shares, "underflow");
        totalReservedShares -= shares;
        return true;
    }

    /// @notice Special withdrawal for policy payouts - bypasses normal maxWithdraw limits
    function withdrawForPayout(uint256 assets, address receiver, uint256 reservedShares)
        external
        nonReentrant
        returns (uint256 shares)
    {
        require(msg.sender == policyManager, "not authorized");
        require(totalReservedShares >= reservedShares, "invalid reservation");

        shares = previewWithdraw(assets);
        require(shares <= reservedShares, "exceeds reserved");

        totalReservedShares -= reservedShares;

        // Ensure we have enough local USDC (pull from Aave if needed)
        _ensureLocalLiquidity(assets);

        IERC20(asset()).transfer(receiver, assets);

        emit Withdraw(msg.sender, receiver, address(this), assets, shares);
    }

    // ── ERC4626 overrides ──────────────────────────────────────────────────

    function maxDeposit(address) public view override returns (uint256) {
        if (paused()) return 0;
        uint256 ta = totalAssets();
        if (cap <= ta) return 0;
        return cap - ta;
    }

    function maxWithdraw(address owner) public view override returns (uint256) {
        if (lockupEnabled && block.timestamp < depositTimestamp[owner] + lockupDuration) return 0;
        uint256 ownerShares = balanceOf(owner);
        uint256 totalUnreserved = totalSupply() > totalReservedShares ? totalSupply() - totalReservedShares : 0;
        uint256 maxOwnerShares = ownerShares <= totalUnreserved ? ownerShares : totalUnreserved;
        return _convertToAssets(maxOwnerShares, Math.Rounding.Floor);
    }

    function maxRedeem(address owner) public view override returns (uint256) {
        if (lockupEnabled && block.timestamp < depositTimestamp[owner] + lockupDuration) return 0;
        uint256 ownerShares = balanceOf(owner);
        uint256 totalUnreserved = totalSupply() > totalReservedShares ? totalSupply() - totalReservedShares : 0;
        return ownerShares <= totalUnreserved ? ownerShares : totalUnreserved;
    }

    /// @dev Override ERC4626 internal withdraw to pull from Aave if needed
    function _withdraw(
        address caller,
        address receiver,
        address owner_,
        uint256 assets,
        uint256 shares
    ) internal override nonReentrant {
        _ensureLocalLiquidity(assets);
        super._withdraw(caller, receiver, owner_, assets, shares);
    }

    /// @notice Deposit with fee + Aave deployment
    function deposit(uint256 assets, address receiver)
        public
        override
        whenNotPaused
        nonReentrant
        returns (uint256 shares)
    {
        require(totalAssets() + assets <= cap, "cap");
        uint256 fee = (assets * depositFeeBps) / 10_000;
        uint256 net = assets - fee;

        shares = previewDeposit(net);
        require(shares > 0, "zero shares");

        IERC20(asset()).transferFrom(msg.sender, address(this), assets);

        if (fee != 0) IERC20(asset()).transfer(feeRecipient, fee);

        _mint(receiver, shares);
        depositTimestamp[receiver] = block.timestamp;

        // Deploy excess to Aave if target not met
        _deployToAaveIfNeeded();

        emit Deposit(msg.sender, receiver, net, shares);
    }
}
