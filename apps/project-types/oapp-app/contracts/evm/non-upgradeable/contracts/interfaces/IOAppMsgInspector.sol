// SPDX-License-Identifier: MIT
pragma solidity ^0.8.22;

/**
 * @title IOAppMsgInspector
 * @author LayerZero Labs (@TRileySchwarz, tinom.eth)
 * @custom:version 1.0.0
 * @notice Interface for OApp message inspector contracts.
 */
interface IOAppMsgInspector {
    /**
     * @notice Emitted when the inspection fails.
     * @param sender Address of the sender of the message
     * @param message LayerZero message payload that failed inspection
     * @param options LayerZero message options that failed inspection
     */
    error InspectionFailed(address sender, bytes message, bytes options);

    /**
     * @notice Allows the inspector to examine LayerZero message contents and optionally throw a revert if invalid.
     * @dev It may either revert or return a boolean.
     * @param _sender Address of the sender of the message
     * @param _message LayerZero message payload to be inspected
     * @param _options LayerZero message options to be inspected
     * @return valid A boolean indicating whether the inspection passed (true) or failed (false)
     */
    function inspect(
        address _sender,
        bytes calldata _message,
        bytes calldata _options
    ) external view returns (bool valid);
}
