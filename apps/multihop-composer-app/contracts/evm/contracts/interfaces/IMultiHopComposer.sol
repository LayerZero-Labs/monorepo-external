// SPDX-License-Identifier: MIT
pragma solidity ^0.8.22;

import { IOAppComposer } from "@layerzerolabs/oapp-evm-contracts/contracts/interfaces/IOAppComposer.sol";
import { SendParam } from "@layerzerolabs/oft-evm-contracts/contracts/interfaces/IOFT.sol";

/**
 * @title IMultiHopComposer
 * @author LayerZero Labs
 * @custom:version 2.0.0
 * @notice Interface for the `MultiHopComposer` contract.
 */
interface IMultiHopComposer is IOAppComposer {
    // ============ Structs ============

    /**
     * @notice Message that failed to decode. Only the owner can rescue it.
     * @param amount Tokens received from the inbound OFT
     * @param msgValue Native value passed to `lzCompose`
     */
    struct UndecodableMessage {
        uint256 amount;
        uint256 msgValue;
    }

    /**
     * @notice Message that failed on `oft.send`. Non-exhaustive list of possible reasons:
     *         - Not enough `msg.value`, `oft` messaging fee may have risen since the original message was sent.
     *           It can be retried with more `msg.value`.
     *         - Malformed options. If the extra options are malformed. It cannot be retried, needs to be refunded.
     *         - Empty options. If `oft` doesn't have enforced options and the original `sendParam` didn't add any.
     *           It cannot be retried unless `oft` updates its enforced options, needs to be refunded.
     *         - OFT-controlled configurations such as non-peered pathways, rate limits, paused pathways, etc.
     *           It cannot be retried unless `oft` updates its configurations, needs to be refunded.
     * @param oft Outbound OFT
     * @param sendParam Send param for the retry
     * @param refundOFT Inbound OFT
     * @param refundSendParam Send param for the refund
     * @param msgValue Native value passed to `lzCompose`
     */
    struct FailedMessage {
        address oft;
        SendParam sendParam;
        address refundOFT;
        SendParam refundSendParam;
        uint256 msgValue;
    }

    // ============ Events ============

    /**
     * @notice Emitted when a compose message payload cannot be decoded.
     * @param guid Message GUID
     * @param message Compose payload that failed to decode
     */
    event DecodeFailed(bytes32 indexed guid, bytes message);

    /**
     * @notice Emitted when the second hop fails and is stored for retry or refund.
     * @param guid Message GUID
     * @param oft Outbound OFT
     */
    event SendFailed(bytes32 indexed guid, address indexed oft);

    /**
     * @notice Emitted when the second hop is sent.
     * @param guid Message GUID
     * @param oft Outbound OFT
     */
    event Sent(bytes32 indexed guid, address indexed oft);

    /**
     * @notice Emitted when a failed hop is retried.
     * @param guid Message GUID
     * @param oft Outbound OFT
     */
    event Retried(bytes32 indexed guid, address indexed oft);

    /**
     * @notice Emitted when a failed hop is refunded to the source chain.
     * @param guid Message GUID
     * @param oft Inbound OFT
     */
    event Refunded(bytes32 indexed guid, address indexed oft);

    /**
     * @notice Emitted when the owner rescues an undecodable hop.
     * @param guid Message GUID
     * @param to Recipient of the rescued tokens and native value
     * @param amount Rescued token amount
     * @param value Rescued native value
     */
    event Rescued(bytes32 indexed guid, address indexed to, uint256 amount, uint256 value);

    /**
     * @notice Emitted when the native refund recipient is replaced.
     * @param recipient New native refund recipient
     */
    event NativeRefundRecipientSet(address indexed recipient);

    /**
     * @notice Emitted when the cap on the enforced `minMsgValue` is replaced.
     * @param maxEnforcedMsgValue New cap on the enforced `minMsgValue`
     */
    event MaxEnforcedMsgValueSet(uint256 maxEnforcedMsgValue);

    // ============ Errors ============

    /**
     * @notice Thrown when registered OFTs do not share an endpoint.
     */
    error DifferentEndpoints();

    /**
     * @notice Thrown when registered OFTs do not share the same token.
     */
    error DifferentTokens();

    /**
     * @notice Thrown when an OFT reports the native token.
     */
    error NativeNotSupported();

    /**
     * @notice Thrown when an OFT address is zero, duplicated, or not registered.
     * @param oft OFT address
     */
    error InvalidOFT(address oft);

    /**
     * @notice Thrown when the native refund recipient is the zero address.
     */
    error InvalidNativeRefundRecipient();

    /**
     * @notice Thrown when the rescue recipient is the zero address.
     */
    error InvalidRescueRecipient();

    /**
     * @notice Thrown when the rescued native transfer fails.
     */
    error NativeTransferFailed();

    /**
     * @notice Thrown when `rescue` is called for a message with nothing to rescue.
     * @param guid Message GUID
     */
    error NothingToRescue(bytes32 guid);

    /**
     * @notice Thrown when the owner tries to renounce ownership.
     */
    error CannotRenounceOwnership();

    /**
     * @notice Thrown when `lzCompose` is not called by the endpoint.
     * @param caller Caller address
     */
    error OnlyEndpoint(address caller);

    /**
     * @notice Thrown when `lzCompose` is not called for a registered OFT.
     * @param oft OFT address
     */
    error OnlyOFT(address oft);

    /**
     * @notice Thrown when `send` is not called by this contract.
     * @param caller Caller address
     */
    error OnlySelf(address caller);

    /**
     * @notice Thrown when retry or refund is called for a message that cannot take that path.
     * @param sendParam Send param that cannot be retried or refunded
     */
    error InvalidSendParam(SendParam sendParam);

    /**
     * @notice Thrown when `msg.value` is below the hop's committed minimum, capped at `maxEnforcedMsgValue`.
     * @param expectedMsgValue Minimum `msg.value` committed in the hop, capped at `maxEnforcedMsgValue`
     * @param actualMsgValue `msg.value` passed to `lzCompose`
     */
    error InsufficientMsgValue(uint256 expectedMsgValue, uint256 actualMsgValue);

    // ============ View Functions ============

    /**
     * @notice Returns the LayerZero endpoint.
     * @return endpoint LayerZero endpoint
     */
    function ENDPOINT() external view returns (address endpoint);

    /**
     * @notice Returns the token shared by the registered OFTs.
     * @return token Token address
     */
    function TOKEN() external view returns (address token);

    /**
     * @notice Returns the native refund recipient.
     * @return nativeRefundRecipientAddress Native refund recipient
     */
    function nativeRefundRecipient() external view returns (address nativeRefundRecipientAddress);

    /**
     * @notice Returns the cap on the `minMsgValue` enforced on a compose.
     * @return maxEnforcedMsgValueAmount Cap on the enforced `minMsgValue`
     */
    function maxEnforcedMsgValue() external view returns (uint256 maxEnforcedMsgValueAmount);

    /**
     * @notice Returns whether an OFT is registered.
     * @param oft OFT address
     * @return isAddressOFT Whether the address is a registered OFT
     */
    function isOFT(address oft) external view returns (bool isAddressOFT);

    /**
     * @notice Returns the OFTs registered at deployment.
     * @return ofts OFT addresses
     */
    function getOFTs() external view returns (address[] memory ofts);

    // ============ Functions ============

    /**
     * @notice Permissionless function to retry a failed message.
     * @param _guid GUID of the failed message
     */
    function retry(bytes32 _guid) external payable;

    /**
     * @notice Permissionless function to refund a failed message to the source chain.
     * @param _guid GUID of the failed message
     */
    function refund(bytes32 _guid) external payable;

    /**
     * @notice Permissioned function to rescue funds from an undecodable message.
     * @param _guid GUID of the undecodable message
     * @param _to Recipient of the stuck tokens and cached `msg.value`
     */
    function rescue(bytes32 _guid, address _to) external;

    /**
     * @notice Permissioned function to set the native refund recipient.
     * @param _nativeRefundRecipient Native refund recipient, must accept native token transfers
     */
    function setNativeRefundRecipient(address _nativeRefundRecipient) external;

    /**
     * @notice Permissioned function to set the cap on the `minMsgValue` enforced on a compose.
     * @dev Zero disables the `minMsgValue` check.
     * @param _maxEnforcedMsgValue Cap on the enforced `minMsgValue`
     */
    function setMaxEnforcedMsgValue(uint256 _maxEnforcedMsgValue) external;
}
