// SPDX-License-Identifier: MIT
pragma solidity ^0.8.22;

/**
 * @title MockCallTarget
 * @notice A simple mock contract for Certora verification that accepts any call and succeeds
 * @dev Used to verify that executeTransaction properly iterates through and executes calls
 */
contract MockCallTarget {
    // A generic function that can be called with any data
    function execute(bytes calldata) external payable returns (bool) {
        return true;
    }

    // Accept any call and succeed
    fallback() external payable {}

    // Accept ETH
    receive() external payable {}
}
