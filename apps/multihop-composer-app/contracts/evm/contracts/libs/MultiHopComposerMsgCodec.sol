// SPDX-License-Identifier: MIT
pragma solidity ^0.8.22;

import { SendParam } from "@layerzerolabs/oft-evm-contracts/contracts/interfaces/IOFT.sol";

/**
 * @title MultiHopComposerMsgCodec
 * @author LayerZero Labs
 * @custom:version 1.0.0
 * @notice Library for encoding and decoding the message payload for the `MultiHopComposer` contract.
 * @dev ABI-encoded as `(sendParam, oft, refundTo, minMsgValue)`. Byte layout:
 *      0x00   offset to sendParam, 0x80
 *      0x20   oft, left-padded with zeros
 *      0x40   refundTo
 *      0x60   minMsgValue
 *      0x80   sendParam.dstEid
 *      0xa0   sendParam.to
 *      0xc0   sendParam.amountLD
 *      0xe0   sendParam.minAmountLD
 *      0x100  offset to extraOptions, from the start of sendParam
 *      0x120  offset to composeMsg, from the start of sendParam
 *      0x140  offset to oftCmd, from the start of sendParam
 *      0x160  extraOptions length
 *      0x180  extraOptions data, right-padded with zeros to a multiple of 32 bytes
 *      then   composeMsg length and padded data, at the position given by its offset
 *      then   oftCmd length and padded data, at the position given by its offset
 */
library MultiHopComposerMsgCodec {
    /// @dev Offset of `SendParam` in the canonical encoding, past the 4 head words.
    uint256 internal constant SEND_PARAM_OFFSET = 0x80;

    /**
     * @notice Thrown when the message does not start with the canonical `SendParam` offset.
     */
    error InvalidMessage();

    /**
     * @notice Encodes the message payload for the `MultiHopComposer` contract.
     * @param _sendParam Send param for the second hop
     * @param _oft Outbound OFT
     * @param _refundTo Address that will receive the funds in the source chain if the message is refunded
     * @param _minMsgValue Minimum `msg.value` that `lzCompose` will accept, capped at its `maxEnforcedMsgValue`
     * @return encodedMessage Encoded message
     */
    function encode(
        SendParam memory _sendParam,
        address _oft,
        bytes32 _refundTo,
        uint256 _minMsgValue
    ) internal pure returns (bytes memory encodedMessage) {
        return abi.encode(_sendParam, _oft, _refundTo, _minMsgValue);
    }

    /**
     * @notice Decodes the message payload for the `MultiHopComposer` contract.
     * @param _message Encoded message
     * @return sendParam Send param for the second hop
     * @return oft Outbound OFT
     * @return refundTo Address that will receive the funds in the source chain if the message is refunded
     * @return minMsgValue Minimum `msg.value` that `lzCompose` will accept, capped at its `maxEnforcedMsgValue`
     */
    function decode(
        bytes calldata _message
    ) internal pure returns (SendParam memory sendParam, address oft, bytes32 refundTo, uint256 minMsgValue) {
        /// @dev Throw on legacy `abi.encode(SendParam)`.
        if (_message.length < 32 || uint256(bytes32(_message[:32])) != SEND_PARAM_OFFSET) revert InvalidMessage();
        return abi.decode(_message, (SendParam, address, bytes32, uint256));
    }
}
