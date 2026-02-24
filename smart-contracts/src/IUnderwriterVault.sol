// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IERC4626} from "@openzeppelin/contracts/interfaces/IERC4626.sol";

interface IUnderwriterVault is IERC4626 {
    function reserveShares(uint256 shares) external returns (uint256 reserved);
    function unreserveShares(uint256 shares) external returns (bool);
    function withdrawForPayout(uint256 assets, address receiver, uint256 reservedShares) external returns (uint256 shares);
    function setCapFromManager(uint256 newCap) external;
    function lockupEnabled() external view returns (bool);
    function lockupDuration() external view returns (uint256);
    function depositTimestamp(address user) external view returns (uint256);
}
