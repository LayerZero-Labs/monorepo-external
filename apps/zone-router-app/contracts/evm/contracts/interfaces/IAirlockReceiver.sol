// SPDX-License-Identifier: MIT
pragma solidity ^0.8.22;

/**
 * @title IAirlockReceiver
 * @author LayerZero Labs
 * @custom:version 1.0.0
 * @notice Interface for receiving messages from other Zero zones.
 */
interface IAirlockReceiver {
    /**
     * @notice Receives a consecutive batch of authenticated messages from another Zero zone.
     * @param _srcZone Source zone
     * @param _srcApp Source application
     * @param _firstNonce First nonce, equal to the `Airlock` channel cursor
     * @param _count Number of consecutive messages
     */
    function airlockReceive(uint64 _srcZone, bytes calldata _srcApp, uint64 _firstNonce, uint64 _count) external;
}
