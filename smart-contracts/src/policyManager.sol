// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {ERC1155} from "@openzeppelin/contracts/token/ERC1155/ERC1155.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IUnderwriterVault} from "./IUnderwriterVault.sol";
import {IFeeRateModel} from "./IFeeRateModel.sol";

contract policyManager is ERC1155, Ownable {
    IERC20 public immutable asset;

    // ── Three-vault tranche system ───────────────────────────────────────────
    IUnderwriterVault public immutable underwriterVault;
    IUnderwriterVault public immutable juniorVault;
    IUnderwriterVault public immutable seniorVault;

    // Replaceable fee model (owner can swap without redeploying)
    IFeeRateModel public feeRateModel;

    // ── Dynamic hazard type registry ─────────────────────────────────────────
    mapping(uint8 => bool) public validHazards;
    mapping(uint8 => string) public hazardNames;
    mapping(uint8 => bool) public hazardTriggerAbove;

    // ── Events ───────────────────────────────────────────────────────────────
    event HazardAdded(uint8 indexed hazardId, string name, bool triggerAbove);
    event HazardRemoved(uint8 indexed hazardId);

    event PolicyPurchased(
        uint256 indexed policyId,
        address indexed holder,
        uint8 hazard,
        uint256 start,
        uint256 end,
        uint256 maxCoverage,
        int256 triggerThreshold,
        int32 lat,
        int32 lon
    );

    event PremiumDistributed(
        uint256 indexed policyId,
        uint256 juniorAmount,
        uint256 seniorAmount,
        uint256 underwriterAmount
    );

    event PayoutTriggered(
        uint256 indexed policyId,
        address indexed holder,
        int256 observedValue,
        uint256 requestedPayout,
        uint256 actualPayout
    );

    event PolicyExpiredReleased(
        uint256 indexed policyId,
        uint256 sharesReleased
    );

    event PolicyVerified(uint256 indexed policyId);
    event PolicyRejected(uint256 indexed policyId);

    // ── Data structures ──────────────────────────────────────────────────────
    struct Policy {
        uint8 hazard;
        uint40 start;
        uint40 end;
        int32 lat;
        int32 lon;
        uint256 maxCoverage;
        uint256 premium;
        int256 triggerThreshold;
        bool paid;
    }

    struct VaultReservations {
        uint256 underwriterShares;
        uint256 juniorShares;
        uint256 seniorShares;
    }

    uint256 public nextId = 1;
    mapping(uint256 => Policy) public policies;
    mapping(uint256 => address) public holderOf;
    mapping(uint256 => VaultReservations) public vaultReservedShares;
    uint256 public totalActiveCoverage;
    mapping(uint8 => uint256) public activeCoverageByHazard;
    address public oracle;

    // ── Policy verification ───────────────────────────────────────────────
    enum PolicyStatus { Unverified, Verified, Invalid }
    mapping(uint256 => PolicyStatus) public policyStatus;

    // ── Constructor ──────────────────────────────────────────────────────────
    constructor(
        IERC20 asset_,
        IUnderwriterVault underwriterVault_,
        IUnderwriterVault juniorVault_,
        IUnderwriterVault seniorVault_,
        IFeeRateModel feeRateModel_,
        string memory uri_
    )
        ERC1155(uri_)
        Ownable(msg.sender)
    {
        asset = asset_;
        underwriterVault = underwriterVault_;
        juniorVault = juniorVault_;
        seniorVault = seniorVault_;
        feeRateModel = feeRateModel_;
        oracle = msg.sender;

        // Initialize default hazard types
        validHazards[0] = true;
        validHazards[1] = true;
        validHazards[2] = true;

        hazardNames[0] = "Heatwave";
        hazardNames[1] = "Flood";
        hazardNames[2] = "Drought";

        hazardTriggerAbove[0] = true;   // high temp is bad
        hazardTriggerAbove[1] = true;   // high discharge is bad
        hazardTriggerAbove[2] = false;  // low deficit is bad
    }

    // ── Admin ────────────────────────────────────────────────────────────────
    function setOracle(address o) external onlyOwner { oracle = o; }

    function setFeeRateModel(IFeeRateModel newModel) external onlyOwner {
        require(address(newModel) != address(0), "zero address");
        feeRateModel = newModel;
    }

    event VaultCapsSynced(uint256 juniorCap, uint256 seniorCap);

    /// @dev Internal cap sync logic — recomputes linked caps from current
    ///      juniorCap and uTargetBps, then pushes to vaults.
    function _syncVaultCaps() internal {
        feeRateModel.recomputeCaps();
        uint256 jrCap = feeRateModel.juniorCap();
        uint256 srCap = feeRateModel.seniorCap();
        juniorVault.setCapFromManager(jrCap);
        seniorVault.setCapFromManager(srCap);
        emit VaultCapsSynced(jrCap, srCap);
    }

    /// @notice Push the FeeRateModel's caps to the junior and senior vaults
    function syncVaultCaps() external {
        _syncVaultCaps();
    }

    // ── Hazard management ────────────────────────────────────────────────────
    function addHazardType(uint8 hazardId, string calldata name, bool triggerAbove) external onlyOwner {
        require(!validHazards[hazardId], "hazard already exists");
        require(bytes(name).length > 0, "name required");
        validHazards[hazardId] = true;
        hazardNames[hazardId] = name;
        hazardTriggerAbove[hazardId] = triggerAbove;
        emit HazardAdded(hazardId, name, triggerAbove);
    }

    function removeHazardType(uint8 hazardId) external onlyOwner {
        require(validHazards[hazardId], "hazard doesn't exist");
        validHazards[hazardId] = false;
        emit HazardRemoved(hazardId);
    }

    // ── Policy verification (oracle-only) ──────────────────────────────────

    function verifyPolicy(uint256 id) external {
        require(msg.sender == oracle, "not oracle");
        require(policyStatus[id] == PolicyStatus.Unverified, "not unverified");
        policyStatus[id] = PolicyStatus.Verified;
        emit PolicyVerified(id);
    }

    function rejectPolicy(uint256 id) external {
        require(msg.sender == oracle, "not oracle");
        require(policyStatus[id] == PolicyStatus.Unverified, "not unverified");
        policyStatus[id] = PolicyStatus.Invalid;

        // Unreserve shares (premium stays in vaults as penalty)
        _unreserveAll(id);
        totalActiveCoverage -= policies[id].maxCoverage;
        activeCoverageByHazard[policies[id].hazard] -= policies[id].maxCoverage;

        emit PolicyRejected(id);
    }

    // ── Helpers (internal) ───────────────────────────────────────────────────

    /// @dev Get the total assets across all three vaults
    function _totalVaultAssets() internal view returns (uint256) {
        return underwriterVault.totalAssets() + juniorVault.totalAssets() + seniorVault.totalAssets();
    }

    /// @dev Split premium and deposit to all three vaults
    function _distributePremium(uint256 premium, uint256 policyId) internal {
        IFeeRateModel.FeeAllocation memory alloc = feeRateModel.getFeeSplit(
            premium,
            juniorVault.totalAssets(),
            seniorVault.totalAssets(),
            underwriterVault.totalAssets()
        );

        uint256 juniorAmount = (premium * alloc.juniorBps) / 10000;
        uint256 seniorAmount = (premium * alloc.seniorBps) / 10000;
        uint256 underwriterAmount = premium - juniorAmount - seniorAmount; // dust goes to underwriter

        if (juniorAmount > 0) {
            asset.approve(address(juniorVault), juniorAmount);
            juniorVault.deposit(juniorAmount, address(this));
        }
        if (seniorAmount > 0) {
            asset.approve(address(seniorVault), seniorAmount);
            seniorVault.deposit(seniorAmount, address(this));
        }
        if (underwriterAmount > 0) {
            asset.approve(address(underwriterVault), underwriterAmount);
            underwriterVault.deposit(underwriterAmount, address(this));
        }

        emit PremiumDistributed(policyId, juniorAmount, seniorAmount, underwriterAmount);
    }

    /// @dev Reserve shares across vaults in waterfall order:
    ///      underwriter first → junior → senior (senior is most protected)
    function _reserveShares(uint256 maxCoverage, uint256 policyId) internal {
        uint256 remaining = maxCoverage;

        // 1. Underwriter vault absorbs first
        uint256 uwReserved;
        if (remaining > 0) {
            uint256 uwShares = underwriterVault.previewWithdraw(remaining);
            uwReserved = underwriterVault.reserveShares(uwShares);
            uint256 uwCovered = underwriterVault.previewRedeem(uwReserved);
            remaining = remaining > uwCovered ? remaining - uwCovered : 0;
        }

        // 2. Junior vault absorbs next
        uint256 jrReserved;
        if (remaining > 0) {
            uint256 jrShares = juniorVault.previewWithdraw(remaining);
            jrReserved = juniorVault.reserveShares(jrShares);
            uint256 jrCovered = juniorVault.previewRedeem(jrReserved);
            remaining = remaining > jrCovered ? remaining - jrCovered : 0;
        }

        // 3. Senior vault absorbs last (most protected)
        uint256 srReserved;
        if (remaining > 0) {
            uint256 srShares = seniorVault.previewWithdraw(remaining);
            srReserved = seniorVault.reserveShares(srShares);
        }

        vaultReservedShares[policyId] = VaultReservations({
            underwriterShares: uwReserved,
            juniorShares: jrReserved,
            seniorShares: srReserved
        });
    }

    /// @dev Unreserve shares from all vaults for a policy
    function _unreserveAll(uint256 policyId) internal returns (uint256 totalReleased) {
        VaultReservations memory res = vaultReservedShares[policyId];

        if (res.underwriterShares > 0) {
            underwriterVault.unreserveShares(res.underwriterShares);
            totalReleased += res.underwriterShares;
        }
        if (res.juniorShares > 0) {
            juniorVault.unreserveShares(res.juniorShares);
            totalReleased += res.juniorShares;
        }
        if (res.seniorShares > 0) {
            seniorVault.unreserveShares(res.seniorShares);
            totalReleased += res.seniorShares;
        }

        delete vaultReservedShares[policyId];
    }

    // ── Policy purchase ──────────────────────────────────────────────────────

    function buyPolicy(
        uint8 hazard,
        uint256 durationDays,
        uint256 maxCoverage,
        uint256 premium,
        int256 triggerThreshold,
        address receiver,
        int32 lat,
        int32 lon
    ) external returns (uint256 id) {
        _syncVaultCaps();
        require(validHazards[hazard], "invalid hazard type");

        id = nextId++;

        policies[id] = Policy({
            hazard: hazard,
            start: uint40(block.timestamp),
            end: uint40(block.timestamp + durationDays * 1 days),
            lat: lat,
            lon: lon,
            maxCoverage: maxCoverage,
            premium: premium,
            triggerThreshold: triggerThreshold,
            paid: false
        });

        // Transfer premium from buyer
        asset.transferFrom(msg.sender, address(this), premium);

        // Split and deposit to three vaults
        _distributePremium(premium, id);

        // Reserve shares in waterfall order for coverage
        _reserveShares(maxCoverage, id);
        totalActiveCoverage += maxCoverage;
        activeCoverageByHazard[hazard] += maxCoverage;

        _mint(receiver, id, 1, "");

        emit PolicyPurchased(
            id, receiver, hazard,
            block.timestamp, block.timestamp + durationDays * 1 days,
            maxCoverage, triggerThreshold, lat, lon
        );
    }

    // ── Payout ───────────────────────────────────────────────────────────────

    function triggerPayout(uint256 id, int256 observedValue, uint256 payout) external {
        require(msg.sender == oracle, "not oracle");
        require(policyStatus[id] == PolicyStatus.Verified, "not verified");

        Policy storage p = policies[id];
        require(!p.paid, "paid");
        require(block.timestamp <= p.end, "expired");
        if (hazardTriggerAbove[p.hazard]) {
            require(observedValue >= p.triggerThreshold, "no trigger");
        } else {
            require(observedValue <= p.triggerThreshold, "no trigger");
        }
        require(payout <= p.maxCoverage, "too much");

        address holder = holderOf[id];
        require(holder != address(0), "no holder");

        // Pro-rata check: if totalActiveCoverage > totalVaultAssets, scale payout
        // to prevent one claim from draining all vaults
        uint256 totalVaultAssets = _totalVaultAssets();
        uint256 totalCoverage = totalActiveCoverage;

        uint256 proRataMax = totalCoverage > 0
            ? (totalVaultAssets * p.maxCoverage) / totalCoverage
            : 0;
        uint256 actualPayout = payout < proRataMax ? payout : proRataMax;

        // Also cap by what reserved shares across all vaults can redeem
        VaultReservations memory res = vaultReservedShares[id];
        uint256 maxFromReserved = 0;
        if (res.underwriterShares > 0) maxFromReserved += underwriterVault.previewRedeem(res.underwriterShares);
        if (res.juniorShares > 0) maxFromReserved += juniorVault.previewRedeem(res.juniorShares);
        if (res.seniorShares > 0) maxFromReserved += seniorVault.previewRedeem(res.seniorShares);
        if (actualPayout > maxFromReserved) actualPayout = maxFromReserved;

        p.paid = true;
        totalActiveCoverage -= p.maxCoverage;
        activeCoverageByHazard[p.hazard] -= p.maxCoverage;

        // Waterfall withdrawal: underwriter → junior → senior
        uint256 remaining = actualPayout;

        if (remaining > 0 && res.underwriterShares > 0) {
            uint256 uwMax = underwriterVault.previewRedeem(res.underwriterShares);
            uint256 fromUw = remaining < uwMax ? remaining : uwMax;
            if (fromUw > 0) {
                underwriterVault.withdrawForPayout(fromUw, holder, res.underwriterShares);
                remaining -= fromUw;
            }
        }

        if (remaining > 0 && res.juniorShares > 0) {
            uint256 jrMax = juniorVault.previewRedeem(res.juniorShares);
            uint256 fromJr = remaining < jrMax ? remaining : jrMax;
            if (fromJr > 0) {
                juniorVault.withdrawForPayout(fromJr, holder, res.juniorShares);
                remaining -= fromJr;
            }
        }

        if (remaining > 0 && res.seniorShares > 0) {
            uint256 srMax = seniorVault.previewRedeem(res.seniorShares);
            uint256 fromSr = remaining < srMax ? remaining : srMax;
            if (fromSr > 0) {
                seniorVault.withdrawForPayout(fromSr, holder, res.seniorShares);
                remaining -= fromSr;
            }
        }

        // If payout didn't use all reserved shares, unreserve remainders
        // (withdrawForPayout already unreserves the full reservation per vault)
        // Clean up mapping
        delete vaultReservedShares[id];

        emit PayoutTriggered(id, holder, observedValue, payout, actualPayout);
    }

    // ── Expired policy release ───────────────────────────────────────────────

    function releaseExpiredPolicy(uint256 id) external {
        Policy storage p = policies[id];
        require(block.timestamp > p.end, "not expired");
        require(!p.paid, "already paid");

        VaultReservations memory res = vaultReservedShares[id];
        require(
            res.underwriterShares > 0 || res.juniorShares > 0 || res.seniorShares > 0,
            "no shares reserved"
        );

        p.paid = true;
        uint256 totalReleased = _unreserveAll(id);
        totalActiveCoverage -= p.maxCoverage;
        activeCoverageByHazard[p.hazard] -= p.maxCoverage;

        emit PolicyExpiredReleased(id, totalReleased);
    }

    function releaseExpiredPolicies(uint256[] calldata ids) external {
        for (uint256 i = 0; i < ids.length; i++) {
            uint256 id = ids[i];
            Policy storage p = policies[id];

            if (block.timestamp <= p.end || p.paid) continue;

            VaultReservations memory res = vaultReservedShares[id];
            if (res.underwriterShares == 0 && res.juniorShares == 0 && res.seniorShares == 0) continue;

            p.paid = true;
            uint256 totalReleased = _unreserveAll(id);
            totalActiveCoverage -= p.maxCoverage;
            activeCoverageByHazard[p.hazard] -= p.maxCoverage;

            emit PolicyExpiredReleased(id, totalReleased);
        }
    }

    // ── ERC-1155 transfer hook ───────────────────────────────────────────────

    function _update(
        address from,
        address to,
        uint256[] memory ids,
        uint256[] memory values
    ) internal override {
        for (uint256 i; i < ids.length; ++i) {
            require(values[i] == 1, "policy amount must be 1");
        }

        super._update(from, to, ids, values);

        for (uint256 i; i < ids.length; ++i) {
            uint256 id = ids[i];

            if (to == address(0)) {
                holderOf[id] = address(0);
            } else {
                holderOf[id] = to;
                require(balanceOf(to, id) == 1, "invalid balance");
            }

            if (from != address(0) && to != address(0)) {
                require(balanceOf(from, id) == 0, "sender still holds");
            }
        }
    }
}
