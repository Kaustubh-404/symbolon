// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

/// @notice The ERC-20 view of USDC on Arc (0x3600000000000000000000000000000000000000, 6 decimals).
interface IERC20Minimal {
    function balanceOf(address account) external view returns (uint256);
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function approve(address spender, uint256 amount) external returns (bool);
}
