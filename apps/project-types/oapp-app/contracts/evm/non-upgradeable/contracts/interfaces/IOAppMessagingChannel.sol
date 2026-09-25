// SPDX-License-Identifier: MIT
pragma solidity ^0.8.22;

import { Origin } from "@layerzerolabs/lz-evm-protocol-v2/contracts/interfaces/ILayerZeroEndpointV2.sol";

/**
 * @title IOAppMessagingChannel
 * @author LayerZero Labs (tinom.eth)
 * @custom:version 1.0.0
 * @notice Interface for OApp wrappers around endpoint messaging channel operations.
 * @dev Exposes `clear`, `skip`, `burn`, and `nilify` so that access is not limited to the endpoint delegate.
 */
interface IOAppMessagingChannel {
    /**
     * @notice Permanently consumes a verified inbound message without the `lzReceive` callback.
     * @param _origin Origin of the message
     * @param _guid GUID of the message
     * @param _message Message payload
     */
    function clear(Origin calldata _origin, bytes32 _guid, bytes calldata _message) external;

    /**
     * @notice Permanently skips the next inbound nonce for a path.
     * @param _srcEid Source endpoint ID
     * @param _sender Sender address on the source chain
     * @param _nonce Nonce to skip, must equal `inboundNonce + 1`
     */
    function skip(uint32 _srcEid, bytes32 _sender, uint64 _nonce) external;

    /**
     * @notice Permanently burns a verified or nilified inbound nonce so it can never be executed or re-verified.
     * @param _srcEid Source endpoint ID
     * @param _sender Sender address on the source chain
     * @param _nonce Nonce to burn, must be `<= lazyInboundNonce`
     * @param _payloadHash Expected payload hash for the nonce
     */
    function burn(uint32 _srcEid, bytes32 _sender, uint64 _nonce, bytes32 _payloadHash) external;

    /**
     * @notice Nilifies an inbound nonce, preventing execution until it is re-verified.
     * @dev An unverified nonce can be nilified by passing `bytes32(0)` for `_payloadHash`.
     * @param _srcEid Source endpoint ID
     * @param _sender Sender address on the source chain
     * @param _nonce Nonce to nilify
     * @param _payloadHash Expected payload hash for the nonce
     */
    function nilify(uint32 _srcEid, bytes32 _sender, uint64 _nonce, bytes32 _payloadHash) external;
}
