// SPDX-License-Identifier: MIT
pragma solidity ^0.8.22;

/// @dev Address of the `Airlock` precompile.
address constant AIRLOCK_ADDRESS = 0x0000000000000000000000000000000000000a1A;

/**
 * @title IAirlock
 * @author LayerZero Labs
 * @custom:version 1.0.0
 * @notice Partial interface for the functions consumed from the `Airlock` precompile.
 */
interface IAirlock {
    /**
     * @notice Authenticated cross-zone message returned by `Airlock`.
     * @param srcZone Source zone
     * @param srcApp Source application
     * @param dstZone Destination zone
     * @param dstApp Destination application
     * @param nonce Message nonce on the application channel, authenticated by `Airlock`
     * @param amount18d Amount in 18 decimals
     * @param sender Sender in the source zone's account encoding
     * @param recipient Recipient in the destination zone's account encoding
     * @param memo Opaque transfer memo
     */
    struct Message {
        uint64 srcZone;
        bytes srcApp;
        uint64 dstZone;
        bytes dstApp;
        uint64 nonce;
        uint256 amount18d;
        bytes sender;
        bytes recipient;
        bytes memo;
    }

    /**
     * @notice Returns whether the zone is active at the block's beacon dependency.
     * @param _zone Zone to query
     * @return active Whether the zone is active
     */
    function isActiveZone(uint64 _zone) external view returns (bool active);

    /**
     * @notice Sends a message from the calling application to another Zero zone.
     * @dev Reverts with `InvalidPeerZone` for zone 0 and `InactiveZone` for an inactive zone.
     * @param _dstZone Destination zone
     * @param _dstApp Destination application in the destination zone's account encoding
     * @param _amount18d Amount in 18 decimals
     * @param _sender Sender in the source zone's account encoding
     * @param _recipient Recipient in the destination zone's account encoding
     * @param _memo Opaque transfer memo
     * @return nonce Message nonce on the application channel
     */
    function send(
        uint64 _dstZone,
        bytes calldata _dstApp,
        uint256 _amount18d,
        bytes calldata _sender,
        bytes calldata _recipient,
        bytes calldata _memo
    ) external returns (uint64 nonce);

    /**
     * @notice Sends native ZRO to a recipient in the destination zone.
     * @dev Burns `msg.value`, which must be positive. The recipient uses the destination zone's account encoding.
     * @dev Reverts with `InvalidPeerZone` for zone 0 and `InactiveZone` for an inactive zone.
     * @param _dstZone Destination zone
     * @param _recipient Recipient in the destination zone's account encoding
     * @param _memo Opaque transfer memo
     * @return nonce Transfer nonce on the ZRO channel
     */
    function sendZro(
        uint64 _dstZone,
        bytes calldata _recipient,
        bytes calldata _memo
    ) external payable returns (uint64 nonce);

    /**
     * @notice Pulls authenticated messages addressed to the calling application.
     * @dev Requires the transaction's `Airlock` proof, the exact channel cursor, and a count from 1 through 64.
     * @param _srcZone Source zone
     * @param _srcApp Source application in the source zone's account encoding
     * @param _firstNonce First message nonce, equal to the channel cursor
     * @param _count Number of consecutive messages
     * @return messages Authenticated application payloads
     */
    function receiveMessages(
        uint64 _srcZone,
        bytes calldata _srcApp,
        uint64 _firstNonce,
        uint64 _count
    ) external returns (Message[] memory messages);
}
