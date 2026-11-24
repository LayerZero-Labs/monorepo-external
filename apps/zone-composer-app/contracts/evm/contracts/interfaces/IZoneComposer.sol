// SPDX-License-Identifier: MIT
pragma solidity ^0.8.22;

import { ILayerZeroComposer } from "@layerzerolabs/lz-evm-protocol-v2/contracts/interfaces/ILayerZeroComposer.sol";

/**
 * @title IZoneComposer
 * @author LayerZero Labs
 * @custom:version 1.0.0
 * @notice Interface for the `ZoneComposer` contract.
 */
interface IZoneComposer is ILayerZeroComposer {
    /**
     * @notice Emitted when a compose message payload cannot be decoded.
     * @param guid Message GUID
     * @param message Compose payload that failed to decode
     */
    event DecodeFailed(bytes32 indexed guid, bytes message);

    /**
     * @notice Emitted when the destination zone is not routable at delivery.
     * @param guid Message GUID
     * @param dstZone Destination zone
     * @param recipient Recipient in the destination zone's account encoding
     * @param memo Opaque transfer memo
     */
    event UnroutableZone(bytes32 indexed guid, uint64 dstZone, bytes recipient, bytes memo);

    /**
     * @notice Emitted when a credit is forwarded to its destination zone.
     * @param guid Message GUID
     * @param dstZone Destination zone
     * @param nonce `Airlock` channel nonce of the forwarded transfer
     */
    event Sent(bytes32 indexed guid, uint64 indexed dstZone, uint64 nonce);

    /**
     * @notice Emitted when a cached unroutable message is forwarded.
     * @param guid Message GUID
     */
    event Retried(bytes32 indexed guid);

    /**
     * @notice Emitted when the owner rescues a cached message.
     * @param guid Message GUID
     * @param to Recipient of the rescued token amount
     * @param amountLD Rescued token amount
     */
    event Rescued(bytes32 indexed guid, address indexed to, uint256 amountLD);

    /**
     * @notice Thrown when the configured OFT is zero or its token is invalid for the composer variant.
     */
    error InvalidOFT();

    /**
     * @notice Thrown when the configured OFT has no endpoint.
     */
    error InvalidEndpoint();

    /**
     * @notice Thrown when a compose caller is not the endpoint.
     * @param caller Compose caller
     */
    error OnlyEndpoint(address caller);

    /**
     * @notice Thrown when a compose message is not from the configured OFT.
     * @param caller Compose sender
     */
    error OnlyOFT(address caller);

    /**
     * @notice Thrown when compose delivery carries native value.
     * @param value Unexpected native value
     */
    error UnexpectedValue(uint256 value);

    /**
     * @notice Thrown when the OFT credited no tokens.
     */
    error ZeroAmount();

    /**
     * @notice Thrown when the rescue recipient is invalid for the credited asset.
     */
    error InvalidRescueRecipient();

    /**
     * @notice Thrown when a message has no cached amount to rescue.
     * @param guid Message GUID
     */
    error NothingToRescue(bytes32 guid);

    /**
     * @notice Thrown when a message has no cached transfer matching the retry arguments.
     * @param guid Message GUID
     */
    error NothingToRetry(bytes32 guid);

    /**
     * @notice Thrown when the owner attempts to renounce ownership.
     */
    error CannotRenounceOwnership();

    /**
     * @notice Thrown when the router has no code or does not use the OFT token.
     */
    error InvalidRouter();

    /**
     * @notice Returns the OFT whose credited amounts can be composed.
     * @return oft OFT
     */
    function OFT() external view returns (address oft);

    /**
     * @notice Returns the endpoint that authenticates compose delivery.
     * @return endpoint LayerZero endpoint
     */
    function ENDPOINT() external view returns (address endpoint);

    /**
     * @notice Returns the OFT token, or zero for native credits.
     * @return token ERC20 token or zero for native credits
     */
    function TOKEN() external view returns (address token);

    /**
     * @notice Returns the configured token router or native `Airlock` precompile.
     * @return router Token router or native `Airlock` precompile
     */
    function ROUTER() external view returns (address router);

    /**
     * @notice Returns the token amount the owner can rescue for a message.
     * @param _guid Message GUID
     * @return amountLD Rescuable token amount
     */
    function rescuableMessages(bytes32 _guid) external view returns (uint256 amountLD);

    /**
     * @notice Returns the transfer hash that a retry of a cached unroutable message must match.
     * @dev The hash is `keccak256(abi.encode(dstZone, recipient, memo))`, or zero when nothing is retryable.
     * @param _guid Message GUID
     * @return transferHash Cached transfer hash
     */
    function retryableMessages(bytes32 _guid) external view returns (bytes32 transferHash);

    /**
     * @notice Forwards a cached unroutable message to its destination zone.
     * @dev Anyone may retry with the transfer emitted in `UnroutableZone`. The router or `Airlock` rejects a destination
     *      that is still unroutable. Failed retries revert and retain the cache entry. Successful retries clear it before
     *      forwarding.
     * @param _guid Message GUID
     * @param _dstZone Destination zone
     * @param _recipient Recipient in the destination zone's account encoding
     * @param _memo Opaque transfer memo
     */
    function retry(bytes32 _guid, uint64 _dstZone, bytes calldata _recipient, bytes calldata _memo) external;

    /**
     * @notice Lets the owner rescue the token amount recorded for a message.
     * @dev Rescue also clears any retryable transfer for the message.
     * @param _guid Message GUID
     * @param _to Recipient of the rescued token amount
     */
    function rescue(bytes32 _guid, address _to) external;
}
