// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {IFeeRateModel} from "./IFeeRateModel.sol";

/// @title FeeRateModel
/// @notice Computes the premium split across Junior, Senior, and Underwriter vaults
/// based on current capital ratios.  The owner (risk-manager role) can tune all
/// parameters or deploy a replacement contract without redeploying the rest of the
/// protocol.
///
/// Formula
/// -------
///   u'         = capitalJunior / (capitalJunior + capitalSenior)
///   feeSenior  = baseSeniorBps + kBps * (u' - u'_target) / 10 000
///   feeJunior  = 10 000 - underwriterBps - feeSenior
///
/// When junior capital is over-represented (u' > target), the senior fee increases,
/// attracting more senior deposits.  The split always sums to 10 000 bps (100%).
contract FeeRateModel is IFeeRateModel, Ownable {
    // ── Parameters (all in basis points, 1 bps = 0.01%) ──────────────────────
    uint256 public baseSeniorBps;    // target senior share of premium  (default 2000 = 20%)
    uint256 public underwriterBps;   // fixed underwriter share         (default  500 =  5%)
    uint256 public uTargetBps;       // target u' = junior/(junior+senior) (default 2500 = 25%)
    uint256 public kBps;             // speed parameter                 (default 5000)
    uint256 public juniorCapValue;   // maximum totalAssets for junior vault
    uint256 public seniorCapValue;   // maximum totalAssets for senior vault

    constructor(
        uint256 juniorCap_
    ) Ownable(msg.sender) {
        baseSeniorBps  = 2000;   // 20%
        underwriterBps = 500;    //  5%
        uTargetBps     = 2500;   // 25%  →  senior ≈ 3× junior capital
        kBps           = 5000;   // adjustment speed
        juniorCapValue = juniorCap_;
        // Auto-link: senior = junior * (10000 - uTarget) / uTarget = junior * 3
        seniorCapValue = (juniorCap_ * (10_000 - 2500)) / 2500;
    }

    // ── Owner setters ────────────────────────────────────────────────────────
    function setBaseSeniorBps(uint256 val) external onlyOwner {
        require(val <= 10000, "out of range");
        baseSeniorBps = val;
    }
    function setUnderwriterBps(uint256 val) external onlyOwner {
        require(val <= 10000, "out of range");
        underwriterBps = val;
    }
    function setUTargetBps(uint256 val) external onlyOwner {
        require(val <= 10000, "out of range");
        uTargetBps = val;
    }
    function setKBps(uint256 val) external onlyOwner { kBps = val; }

    event CapsUpdated(uint256 juniorCap, uint256 seniorCap);

    /// @notice Set junior cap and auto-link senior cap based on u'_target ratio
    function setJuniorCap(uint256 val) external onlyOwner {
        juniorCapValue = val;
        seniorCapValue = computeLinkedSeniorCap(val);
        emit CapsUpdated(juniorCapValue, seniorCapValue);
    }

    /// @notice Set senior cap and auto-link junior cap based on u'_target ratio
    function setSeniorCap(uint256 val) external onlyOwner {
        seniorCapValue = val;
        juniorCapValue = computeLinkedJuniorCap(val);
        emit CapsUpdated(juniorCapValue, seniorCapValue);
    }

    /// @notice Recompute linked caps from current juniorCap and uTargetBps.
    ///         Called automatically by PolicyManager on every policy purchase.
    function recomputeCaps() external override {
        seniorCapValue = computeLinkedSeniorCap(juniorCapValue);
        emit CapsUpdated(juniorCapValue, seniorCapValue);
    }

    /// @notice Set both caps independently (bypass auto-linking)
    function setCapsIndependent(uint256 juniorCap_, uint256 seniorCap_) external onlyOwner {
        juniorCapValue = juniorCap_;
        seniorCapValue = seniorCap_;
        emit CapsUpdated(juniorCapValue, seniorCapValue);
    }

    /// @dev Given a junior cap, compute the linked senior cap: senior = junior * (10000 - uTarget) / uTarget
    function computeLinkedSeniorCap(uint256 juniorCap_) public view returns (uint256) {
        require(uTargetBps > 0, "uTarget is zero");
        return (juniorCap_ * (10_000 - uTargetBps)) / uTargetBps;
    }

    /// @dev Given a senior cap, compute the linked junior cap: junior = senior * uTarget / (10000 - uTarget)
    function computeLinkedJuniorCap(uint256 seniorCap_) public view returns (uint256) {
        require(uTargetBps < 10_000, "uTarget is 10000");
        return (seniorCap_ * uTargetBps) / (10_000 - uTargetBps);
    }

    // ── View helpers ─────────────────────────────────────────────────────────
    function juniorCap() external view override returns (uint256) { return juniorCapValue; }
    function seniorCap() external view override returns (uint256) { return seniorCapValue; }

    // ── Core logic ───────────────────────────────────────────────────────────
    function getFeeSplit(
        uint256, /* totalPremium — unused in this model but available for future */
        uint256 capitalJunior,
        uint256 capitalSenior,
        uint256  /* capitalUnderwriter — unused in this model */
    ) external view override returns (FeeAllocation memory allocation) {
        // u' = capitalJunior / (capitalJunior + capitalSenior)
        // When both are zero, default to target ratio
        uint256 totalTrancheCapital = capitalJunior + capitalSenior;
        uint256 uPrimeBps;
        if (totalTrancheCapital == 0) {
            uPrimeBps = uTargetBps;
        } else {
            uPrimeBps = (capitalJunior * 10000) / totalTrancheCapital;
        }

        // feeSenior = baseSenior + k * (u' - u'_target) / 10 000
        // deviation can be negative so use int256
        int256 deviation = int256(uPrimeBps) - int256(uTargetBps);
        int256 seniorAdj = int256(baseSeniorBps) + (int256(kBps) * deviation) / 10000;

        // Clamp: 0 ≤ feeSenior ≤ 10 000 - underwriterBps
        uint256 maxSenior = 10000 - underwriterBps;
        uint256 seniorFinal;
        if (seniorAdj < 0) {
            seniorFinal = 0;
        } else if (uint256(seniorAdj) > maxSenior) {
            seniorFinal = maxSenior;
        } else {
            seniorFinal = uint256(seniorAdj);
        }

        // feeJunior = 1 - feeUnderwriter - feeSenior
        uint256 juniorFinal = 10000 - underwriterBps - seniorFinal;

        allocation = FeeAllocation({
            juniorBps: juniorFinal,
            seniorBps: seniorFinal,
            underwriterBps: underwriterBps
        });
    }
}
