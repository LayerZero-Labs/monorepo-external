// SPDX-License-Identifier: MIT
pragma solidity ^0.8.22;

/**
 * @title ZoneComposerMsgCodec
 * @author LayerZero Labs
 * @custom:version 1.0.0
 * @notice Encodes and decodes Zero transfer payloads with an optional memo.
 * @dev Without a memo, ABI-encoded as `(uint64 dstZone, bytes recipient)`. Byte layout:
 *      0x00   dstZone, 8 bytes left-padded with 24 zero bytes
 *      0x20   offset to recipient, 0x40
 *      0x40   recipient length
 *      0x60   recipient data, right-padded with zeros to a multiple of 32 bytes
 * @dev With a memo, ABI-encoded as `(uint64 dstZone, bytes recipient, bytes memo)`. Byte layout:
 *      0x00   dstZone, 8 bytes left-padded with 24 zero bytes
 *      0x20   offset to recipient, 0x60
 *      0x40   offset to memo, 0x80 plus the padded recipient data length
 *      0x60   recipient length
 *      0x80   recipient data, right-padded with zeros to a multiple of 32 bytes
 *      then   memo length, at the position given by its offset
 *      then   memo data, right-padded with zeros to a multiple of 32 bytes
 * @dev An omitted memo decodes as empty bytes.
 */
library ZoneComposerMsgCodec {
    uint256 internal constant BASE_HEADER_LENGTH = 64;
    uint256 internal constant MEMOED_HEADER_LENGTH = 96;

    /**
     * @notice Thrown when a payload has an unsupported ABI head, a zero destination zone, an empty recipient,
     *         or a dynamic field exceeds 255 bytes.
     */
    error InvalidPayload();

    /**
     * @notice Encodes a transfer without a memo.
     * @param _dstZone Destination zone
     * @param _recipient Recipient in the destination zone's account encoding
     * @return message Encoded payload
     */
    function encode(uint64 _dstZone, bytes memory _recipient) internal pure returns (bytes memory message) {
        return abi.encode(_dstZone, _recipient);
    }

    /**
     * @notice Encodes a transfer with a memo.
     * @param _dstZone Destination zone
     * @param _recipient Recipient in the destination zone's account encoding
     * @param _memo Opaque transfer memo
     * @return message Encoded payload
     */
    function encode(
        uint64 _dstZone,
        bytes memory _recipient,
        bytes memory _memo
    ) internal pure returns (bytes memory message) {
        return abi.encode(_dstZone, _recipient, _memo);
    }

    /**
     * @notice Decodes a transfer, using an empty memo when none is encoded.
     * @param _message Encoded payload
     * @return dstZone Destination zone
     * @return recipient Recipient in the destination zone's account encoding
     * @return memo Opaque transfer memo, or empty bytes
     */
    function decode(
        bytes calldata _message
    ) internal pure returns (uint64 dstZone, bytes memory recipient, bytes memory memo) {
        if (_message.length < BASE_HEADER_LENGTH) revert InvalidPayload();
        uint256 recipientOffset = uint256(bytes32(_message[32:64]));
        if (recipientOffset == BASE_HEADER_LENGTH) {
            (dstZone, recipient) = abi.decode(_message, (uint64, bytes));
        } else if (recipientOffset == MEMOED_HEADER_LENGTH) {
            (dstZone, recipient, memo) = abi.decode(_message, (uint64, bytes, bytes));
        } else {
            revert InvalidPayload();
        }
        if (dstZone == 0 || recipient.length == 0 || recipient.length > 255 || memo.length > 255) {
            revert InvalidPayload();
        }
    }
}
