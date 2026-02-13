// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.20;
pragma abicoder v2;

import {ERC4626} from "@openzeppelin/contracts/token/ERC20/extensions/ERC4626.sol";
import {ERC20}   from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC20}  from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";

contract underwriterVault is ERC4626, Ownable, Pausable {
    uint256 public cap;              // max totalAssets
    uint256 public depositFeeBps;    // fee on assets deposited (LP side)
    address public feeRecipient;
    address public policyManager;    // authorized to reserve shares
    uint256 public totalReservedShares; // shares locked for policy coverage

    constructor(IERC20 asset_, string memory name_, string memory symbol_, uint256 cap_, address feeRecipient_)
        ERC4626(asset_)
        ERC20(name_, symbol_)
        Ownable(msg.sender)
    {
        cap = cap_;
        feeRecipient = feeRecipient_;
    }

    function setCap(uint256 newCap) external onlyOwner { cap = newCap; }
    function setFee(uint256 bps, address recipient) external onlyOwner {
        require(bps <= 500, "fee too high");
        depositFeeBps = bps;
        feeRecipient = recipient;
    }
    function setPolicyManager(address pm) external onlyOwner { policyManager = pm; }
    function pause() external onlyOwner { _pause(); }
    function unpause() external onlyOwner { _unpause(); }

    // Reserve shares for a policy (only PolicyManager can call)
    function reserveShares(uint256 shares) external returns (bool) {
        require(msg.sender == policyManager, "not authorized");
        // Check that there are enough total shares in the vault to cover reservation
        require(totalSupply() >= totalReservedShares + shares, "insufficient liquidity");
        totalReservedShares += shares;
        return true;
    }

    // Release reserved shares (when policy expires or is paid)
    function unreserveShares(uint256 shares) external returns (bool) {
        require(msg.sender == policyManager, "not authorized");
        require(totalReservedShares >= shares, "underflow");
        totalReservedShares -= shares;
        return true;
    }

    // Special withdrawal for policy payouts - bypasses normal maxWithdraw limits
    // PolicyManager uses this to pay claims using reserved shares
    function withdrawForPayout(uint256 assets, address receiver, uint256 reservedShares) external returns (uint256 shares) {
        require(msg.sender == policyManager, "not authorized");
        require(totalReservedShares >= reservedShares, "invalid reservation");

        // Calculate shares needed
        shares = previewWithdraw(assets);
        require(shares <= reservedShares, "exceeds reserved");

        // Unreserve and burn the shares (redeem from total pool)
        totalReservedShares -= reservedShares;

        // Transfer assets to receiver
        IERC20(asset()).transfer(receiver, assets);

        emit Withdraw(msg.sender, receiver, address(this), assets, shares);
    }

    function maxDeposit(address) public view override returns (uint256) {
        if (paused()) return 0;
        uint256 ta = totalAssets();
        if (cap <= ta) return 0;
        return cap - ta;
    }

    // Override to prevent withdrawal of reserved shares
    function maxWithdraw(address owner) public view override returns (uint256) {
        uint256 ownerShares = balanceOf(owner);

        // Calculate unreserved shares available in the vault
        uint256 totalUnreserved = totalSupply() > totalReservedShares ? totalSupply() - totalReservedShares : 0;

        // Owner can only withdraw proportionally from unreserved shares
        uint256 maxOwnerShares = ownerShares <= totalUnreserved ? ownerShares : totalUnreserved;

        return _convertToAssets(maxOwnerShares, Math.Rounding.Floor);
    }

    // Override to prevent redemption of reserved shares
    function maxRedeem(address owner) public view override returns (uint256) {
        uint256 ownerShares = balanceOf(owner);

        // Calculate unreserved shares available in the vault
        uint256 totalUnreserved = totalSupply() > totalReservedShares ? totalSupply() - totalReservedShares : 0;

        // Owner can only redeem up to unreserved amount
        return ownerShares <= totalUnreserved ? ownerShares : totalUnreserved;
    }

    // Fee implemented by taking fee assets from caller before minting shares for net assets
    function deposit(uint256 assets, address receiver)
        public
        override
        whenNotPaused
        returns (uint256 shares)
    {
        require(totalAssets() + assets <= cap, "cap");
        uint256 fee = (assets * depositFeeBps) / 10_000;
        uint256 net = assets - fee;

        // Calculate shares based on net assets
        shares = previewDeposit(net);
        require(shares > 0, "zero shares");

        // Transfer assets from caller
        IERC20(asset()).transferFrom(msg.sender, address(this), assets);

        // Transfer fee if applicable
        if (fee != 0) IERC20(asset()).transfer(feeRecipient, fee);

        // Mint shares to receiver
        _mint(receiver, shares);

        emit Deposit(msg.sender, receiver, net, shares);
    }
}