// SPDX-License-Identifier: MIT
pragma solidity ^0.8.22;

/**
 * @title IProxyAdmin2Step
 * @author LayerZero Labs (tinom.eth)
 * @custom:version 1.0.0
 * @notice Interface for the `ProxyAdmin2Step` contract.
 */
interface IProxyAdmin2Step {
    /**
     * @notice Thrown when trying to renounce ownership.
     */
    error CannotRenounceOwnership();
}
