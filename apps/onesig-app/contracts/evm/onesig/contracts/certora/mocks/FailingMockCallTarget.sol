// SPDX-License-Identifier: MIT
pragma solidity ^0.8.22;

/**
 * @title FailingMockCallTarget
 * @notice A mock contract that always fails (reverts) on any call
 * @dev Used to verify that executeTransaction properly handles failed calls
 */
contract FailingMockCallTarget {
    error AlwaysFails();

    // Always revert on any call
    fallback() external payable {
        revert AlwaysFails();
    }

    // Also revert on plain ETH transfers
    receive() external payable {
        revert AlwaysFails();
    }
}
