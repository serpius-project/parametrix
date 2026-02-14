// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {ERC1155} from "@openzeppelin/contracts/token/ERC1155/ERC1155.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC4626} from "@openzeppelin/contracts/interfaces/IERC4626.sol";

interface IUnderwriterVault is IERC4626 {
    function reserveShares(uint256 shares) external returns (bool);
    function unreserveShares(uint256 shares) external returns (bool);
    function withdrawForPayout(uint256 assets, address receiver, uint256 reservedShares) external returns (uint256 shares);
}

contract policyManager is ERC1155, Ownable {
    IERC20   public immutable asset;
    IUnderwriterVault public immutable vault;

    // Dynamic hazard type registry (replaces fixed enum for flexibility)
    mapping(uint8 => bool) public validHazards;
    mapping(uint8 => string) public hazardNames;

    // Hazard management events
    event HazardAdded(uint8 indexed hazardId, string name);
    event HazardRemoved(uint8 indexed hazardId);

    // Events for CRE monitoring
    event PolicyPurchased(
        uint256 indexed policyId,
        address indexed holder,
        uint8 hazard,
        uint256 start,
        uint256 end,
        uint256 maxCoverage,
        uint256 triggerThreshold
    );

    event PayoutTriggered(
        uint256 indexed policyId,
        address indexed holder,
        uint256 observedValue,
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
        uint256 maxCoverage;
        uint256 premium;
        uint256 triggerThreshold;
        bool paid;
    }

    struct PolicyInput {
        uint8 hazard;
        uint256 durationDays;
        uint256 maxCoverage;
        uint256 premium;
        uint256 triggerThreshold;
    }

    uint256 public nextId = 1;
    mapping(uint256 => Policy) public policies;
    mapping(uint256 => address) public holderOf; // always current holder (since supply=1)
    mapping(uint256 => uint256) public reservedShares; // shares reserved per policy
    address public oracle;

    constructor(IERC20 asset_, IUnderwriterVault vault_, string memory uri_) //vault_ is the underwriter address
        ERC1155(uri_)
        Ownable(msg.sender)
    {
        asset = asset_;
        vault = vault_;
        oracle = msg.sender;

        // Initialize default hazard types (backward compatible)
        validHazards[0] = true; // Heatwave
        validHazards[1] = true; // Flood
        validHazards[2] = true; // Drought

        hazardNames[0] = "Heatwave";
        hazardNames[1] = "Flood";
        hazardNames[2] = "Drought";
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
    function addHazardType(uint8 hazardId, string calldata name) external onlyOwner {
        require(!validHazards[hazardId], "hazard already exists");
        require(bytes(name).length > 0, "name required");

        validHazards[hazardId] = true;
        hazardNames[hazardId] = name;

        emit HazardAdded(hazardId, name);
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
        uint256 triggerThreshold,
        address receiver
    ) external returns (uint256 id) {
        require(validHazards[hazard], "invalid hazard type");

        id = nextId++;

        policies[id] = Policy({
            hazard: hazard,
            start: uint40(block.timestamp),
            end: uint40(block.timestamp + durationDays * 1 days),
            maxCoverage: maxCoverage,
            premium: premium,
            triggerThreshold: triggerThreshold,
            paid: false
        });

        asset.transferFrom(msg.sender, address(this), premium);
        asset.approve(address(vault), premium);
        vault.deposit(premium, address(this));

        // Reserve shares to cover maxCoverage
        uint256 sharesToReserve = vault.previewWithdraw(maxCoverage);
        require(vault.reserveShares(sharesToReserve), "reservation failed");
        reservedShares[id] = sharesToReserve;

        _mint(receiver, id, 1, ""); // supply fixed to 1

        emit PolicyPurchased(
            id,
            receiver,
            hazard,
            block.timestamp,
            block.timestamp + durationDays * 1 days,
            maxCoverage,
            triggerThreshold
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
                maxCoverage: in_.maxCoverage,
                premium: in_.premium,
                triggerThreshold: in_.triggerThreshold,
                paid: false
            });

            // Reserve shares to cover maxCoverage
            uint256 sharesToReserve = vault.previewWithdraw(in_.maxCoverage);
            require(vault.reserveShares(sharesToReserve), "reservation failed");
            reservedShares[id] = sharesToReserve;

            _mint(receiver, id, 1, "");

            emit PolicyPurchased(
                id,
                receiver,
                in_.hazard,
                block.timestamp,
                block.timestamp + in_.durationDays * 1 days,
                in_.maxCoverage,
                in_.triggerThreshold
            );
        }
    }

    function triggerPayout(uint256 id, uint256 observedValue, uint256 payout) external {
        require(msg.sender == oracle, "not oracle");

        Policy storage p = policies[id];
        require(!p.paid, "paid");
        require(block.timestamp <= p.end, "expired");
        require(observedValue >= p.triggerThreshold, "no trigger");
        require(payout <= p.maxCoverage, "too much");

        address holder = holderOf[id];
        require(holder != address(0), "no holder");

        // Calculate what the reserved shares are worth now
        uint256 reserved = reservedShares[id];
        uint256 maxRedeemable = vault.previewRedeem(reserved);

        // Dynamic payout: pay full amount if possible, otherwise pay what's available
        uint256 actualPayout = (maxRedeemable >= payout) ? payout : maxRedeemable;

        p.paid = true;
        reservedShares[id] = 0;

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