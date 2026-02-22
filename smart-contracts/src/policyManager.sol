// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {ERC1155} from "@openzeppelin/contracts/token/ERC1155/ERC1155.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC4626} from "@openzeppelin/contracts/interfaces/IERC4626.sol";

interface IUnderwriterVault is IERC4626 {
    function reserveShares(uint256 shares) external returns (uint256 reserved);
    function unreserveShares(uint256 shares) external returns (bool);
    function withdrawForPayout(uint256 assets, address receiver, uint256 reservedShares) external returns (uint256 shares);
}

contract policyManager is ERC1155, Ownable {
    IERC20   public immutable asset;
    IUnderwriterVault public immutable vault;

    // Dynamic hazard type registry (replaces fixed enum for flexibility)
    mapping(uint8 => bool) public validHazards;
    mapping(uint8 => string) public hazardNames;
    mapping(uint8 => bool) public hazardTriggerAbove; // true = value >= threshold triggers, false = value <= threshold triggers

    // Hazard management events
    event HazardAdded(uint8 indexed hazardId, string name, bool triggerAbove);
    event HazardRemoved(uint8 indexed hazardId);

    // Events for CRE monitoring
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

    struct Policy {
        uint8 hazard;
        uint40 start;
        uint40 end;
        int32 lat;          // latitude × 10 000  (e.g. 39.5157° → 395157)
        int32 lon;          // longitude × 10 000  (e.g. -119.4713° → -1194713)
        uint256 maxCoverage;
        uint256 premium;
        int256 triggerThreshold;
        bool paid;
    }

    struct PolicyInput {
        uint8 hazard;
        uint256 durationDays;
        uint256 maxCoverage;
        uint256 premium;
        int256 triggerThreshold;
        int32 lat;
        int32 lon;
    }

    uint256 public nextId = 1;
    mapping(uint256 => Policy) public policies;
    mapping(uint256 => address) public holderOf; // always current holder (since supply=1)
    mapping(uint256 => uint256) public reservedShares; // shares reserved per policy
    uint256 public totalActiveCoverage; // sum of maxCoverage across all active policies
    address public oracle;

    constructor(IERC20 asset_, IUnderwriterVault vault_, string memory uri_) //vault_ is the underwriter address
        ERC1155(uri_)
        Ownable(msg.sender)
    {
        asset = asset_;
        vault = vault_;
        oracle = msg.sender;

        // Initialize default hazard types
        validHazards[0] = true; // Heatwave
        validHazards[1] = true; // Flood
        validHazards[2] = true; // Drought

        hazardNames[0] = "Heatwave";
        hazardNames[1] = "Flood";
        hazardNames[2] = "Drought";

        hazardTriggerAbove[0] = true;  // Heatwave: high temp is bad
        hazardTriggerAbove[1] = true;  // Flood: high discharge is bad
        hazardTriggerAbove[2] = false; // Drought: low deficit is bad
    }

    function setOracle(address o) external onlyOwner { oracle = o; }

    // ============================================================================
    // HAZARD MANAGEMENT FUNCTIONS
    // ============================================================================

    /**
     * @notice Add a new hazard type to the registry
     * @param hazardId Unique identifier for the hazard (e.g., 3, 4, 5...)
     * @param name Human-readable name for the hazard (e.g., "Earthquake", "Hurricane")
     */
    function addHazardType(uint8 hazardId, string calldata name, bool triggerAbove) external onlyOwner {
        require(!validHazards[hazardId], "hazard already exists");
        require(bytes(name).length > 0, "name required");

        validHazards[hazardId] = true;
        hazardNames[hazardId] = name;
        hazardTriggerAbove[hazardId] = triggerAbove;

        emit HazardAdded(hazardId, name, triggerAbove);
    }

    /**
     * @notice Remove/deprecate a hazard type from the registry
     * @dev Existing policies with this hazard remain valid, but new policies cannot be created
     * @param hazardId The hazard identifier to remove
     */
    function removeHazardType(uint8 hazardId) external onlyOwner {
        require(validHazards[hazardId], "hazard doesn't exist");

        validHazards[hazardId] = false;

        emit HazardRemoved(hazardId);
    }

    // ============================================================================
    // POLICY PURCHASE FUNCTIONS
    // ============================================================================

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

        asset.transferFrom(msg.sender, address(this), premium);
        asset.approve(address(vault), premium);
        vault.deposit(premium, address(this));

        // Reserve up to the shares needed for maxCoverage.
        // If vault is underfunded, partial reservation is accepted - payout will
        // be pro-rata based on totalActiveCoverage at trigger time.
        uint256 sharesToReserve = vault.previewWithdraw(maxCoverage);
        reservedShares[id] = vault.reserveShares(sharesToReserve);
        totalActiveCoverage += maxCoverage;

        _mint(receiver, id, 1, ""); // supply fixed to 1

        emit PolicyPurchased(
            id,
            receiver,
            hazard,
            block.timestamp,
            block.timestamp + durationDays * 1 days,
            maxCoverage,
            triggerThreshold,
            lat,
            lon
        );
    }

    function buyPolicies(PolicyInput[] calldata inputs, address receiver)
        external
        returns (uint256[] memory ids)
    {
        uint256 n = inputs.length;
        require(n != 0, "empty");
        ids = new uint256[](n);

        uint256 totalPremium;
        for (uint256 i; i < n; ++i) totalPremium += inputs[i].premium;

        asset.transferFrom(msg.sender, address(this), totalPremium);
        asset.approve(address(vault), totalPremium);
        vault.deposit(totalPremium, address(this));

        for (uint256 i; i < n; ++i) {
            PolicyInput calldata in_ = inputs[i];
            require(validHazards[in_.hazard], "invalid hazard type");

            uint256 id = nextId++;
            ids[i] = id;

            policies[id] = Policy({
                hazard: in_.hazard,
                start: uint40(block.timestamp),
                end: uint40(block.timestamp + in_.durationDays * 1 days),
                lat: in_.lat,
                lon: in_.lon,
                maxCoverage: in_.maxCoverage,
                premium: in_.premium,
                triggerThreshold: in_.triggerThreshold,
                paid: false
            });

            // Reserve up to the shares needed; partial reservation accepted for pro-rata payouts.
            uint256 sharesToReserve = vault.previewWithdraw(in_.maxCoverage);
            reservedShares[id] = vault.reserveShares(sharesToReserve);
            totalActiveCoverage += in_.maxCoverage;

            _mint(receiver, id, 1, "");

            emit PolicyPurchased(
                id,
                receiver,
                in_.hazard,
                block.timestamp,
                block.timestamp + in_.durationDays * 1 days,
                in_.maxCoverage,
                in_.triggerThreshold,
                in_.lat,
                in_.lon
            );
        }
    }

    function triggerPayout(uint256 id, int256 observedValue, uint256 payout) external {
        require(msg.sender == oracle, "not oracle");

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

        // Pro-rata payout: each policy receives a share of vault assets proportional
        // to its maxCoverage. If vault is fully funded (totalAssets >= totalActiveCoverage),
        // the full requested payout is paid. Otherwise each policy is paid proportionally.
        uint256 reserved = reservedShares[id];
        uint256 vaultAssets = vault.totalAssets();
        uint256 totalCoverage = totalActiveCoverage;

        uint256 proRataMax = totalCoverage > 0
            ? (vaultAssets * p.maxCoverage) / totalCoverage
            : 0;
        uint256 actualPayout = payout < proRataMax ? payout : proRataMax;

        // Also cap by what the reserved shares can actually redeem (protects against
        // payout exceeding this policy's locked collateral).
        uint256 maxFromReserved = vault.previewRedeem(reserved);
        if (actualPayout > maxFromReserved) actualPayout = maxFromReserved;

        p.paid = true;
        reservedShares[id] = 0;
        totalActiveCoverage -= p.maxCoverage;

        // Withdraw using special payout function that handles reserved shares
        vault.withdrawForPayout(actualPayout, holder, reserved);

        emit PayoutTriggered(id, holder, observedValue, payout, actualPayout);
    }

    // Release reserved shares for expired policies that were not triggered
    function releaseExpiredPolicy(uint256 id) external {
        Policy storage p = policies[id];
        require(block.timestamp > p.end, "not expired");
        require(!p.paid, "already paid");

        uint256 reserved = reservedShares[id];
        require(reserved > 0, "no shares reserved");

        // Mark as paid to prevent future claims
        p.paid = true;

        // Unreserve the shares so underwriters can withdraw
        require(vault.unreserveShares(reserved), "unreserve failed");
        reservedShares[id] = 0;
        totalActiveCoverage -= p.maxCoverage;

        emit PolicyExpiredReleased(id, reserved);
    }

    // Batch release for multiple expired policies
    function releaseExpiredPolicies(uint256[] calldata ids) external {
        for (uint256 i = 0; i < ids.length; i++) {
            uint256 id = ids[i];
            Policy storage p = policies[id];

            // Skip if not expired or already paid
            if (block.timestamp <= p.end || p.paid) continue;

            uint256 reserved = reservedShares[id];
            if (reserved == 0) continue;

            p.paid = true;
            require(vault.unreserveShares(reserved), "unreserve failed");
            reservedShares[id] = 0;
            totalActiveCoverage -= p.maxCoverage;

            emit PolicyExpiredReleased(id, reserved);
        }
    }

    // Keeps holderOf accurate for transferable policies (OZ v5)
    function _update(
        address from,
        address to,
        uint256[] memory ids,
        uint256[] memory values
    ) internal override {
        // enforce supply=1 and non-fractional transfers
        for (uint256 i; i < ids.length; ++i) {
            require(values[i] == 1, "policy amount must be 1");
        }

        super._update(from, to, ids, values);

        for (uint256 i; i < ids.length; ++i) {
            uint256 id = ids[i];

            if (to == address(0)) {
                // burn
                holderOf[id] = address(0);
            } else {
                // mint or transfer
                // since supply=1, the receiver is always the current holder
                holderOf[id] = to;

                // safety: ensure receiver doesn't end up with >1
                require(balanceOf(to, id) == 1, "invalid balance");
            }

            // safety: ensure sender doesn't keep any (for transfers)
            if (from != address(0) && to != address(0)) {
                require(balanceOf(from, id) == 0, "sender still holds");
            }
        }
    }
}