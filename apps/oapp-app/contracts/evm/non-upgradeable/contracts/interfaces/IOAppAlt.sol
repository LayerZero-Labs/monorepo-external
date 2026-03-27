// SPDX-License-Identifier: MIT
pragma solidity ^0.8.22;

/**
 * @title IOAppAlt
 * @author LayerZero Labs (@TRileySchwarz, tinom.eth)
 * @custom:version 1.0.0
 * @notice Interface for the `OAppAlt` contract.
 */
interface IOAppAlt {
    /**
     * @dev Thrown when the native token is not set, possibly due to the endpoint not being an `EndpointV2Alt`.
     */
    error InvalidNativeToken();

    /**
     * @dev Thrown when the native fee is paid with `msg.value`.
     */
    error OnlyAltToken();
}
