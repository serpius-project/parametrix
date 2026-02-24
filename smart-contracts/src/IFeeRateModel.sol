// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IFeeRateModel {
    struct FeeAllocation {
        uint256 juniorBps;       // basis points of premium to junior vault
        uint256 seniorBps;       // basis points of premium to senior vault
        uint256 underwriterBps;  // basis points of premium to underwriter vault
    }

    /// @notice Compute premium split given current vault states
    /// @param totalPremium The premium amount being allocated
    /// @param capitalJunior Total assets in junior vault
    /// @param capitalSenior Total assets in senior vault
    /// @param capitalUnderwriter Total assets in underwriter vault
    /// @return allocation The fee split in basis points (must sum to 10000)
    function getFeeSplit(
        uint256 totalPremium,
        uint256 capitalJunior,
        uint256 capitalSenior,
        uint256 capitalUnderwriter
    ) external view returns (FeeAllocation memory allocation);

    /// @notice Returns the current cap for junior vault
    function juniorCap() external view returns (uint256);

    /// @notice Returns the current cap for senior vault
    function seniorCap() external view returns (uint256);

    /// @notice Recompute linked caps from current juniorCap and uTargetBps
    function recomputeCaps() external;
}
