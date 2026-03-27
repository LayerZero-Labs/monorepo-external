// SPDX-License-Identifier: MIT
pragma solidity ^0.8.22;

import { OFTMsgCodec } from "@layerzerolabs/oft-evm-impl/contracts/libs/OFTMsgCodec.sol";

/**
 * @title NexusMsgCodec
 * @author LayerZero Labs (@TRileySchwarz, tinom.eth)
 * @custom:version 1.0.0
 * @notice Extends OFTMsgCodec to prepend a `tokenId` for multi-token messaging.
 * @dev Message format: [tokenId (4 bytes)][OFT message...]
 *      OFT message: [sendTo (32 bytes)][amountSD (8 bytes)][optional: composeSender (32 bytes) + composeMsg]
 */
library NexusMsgCodec {
    uint8 private constant TOKEN_ID_OFFSET = 4;

    /**
     * @notice Encodes a Nexus message with `tokenId` prefix.
     * @dev Uses an explicit `_composeFrom` parameter instead of `msg.sender` to correctly attribute
     *      compose messages to the original user, not the `NexusOFT` wrapper contract.
     * @param _tokenId Token identifier
     * @param _sendTo Recipient address
     * @param _amountSD Amount in shared decimals
     * @param _composeFrom Address of the original sender
     * @param _composeMsg Composed message
     * @return _msg Encoded message
     * @return hasCompose Boolean indicating whether the message has a composed payload
     */
    function encode(
        uint32 _tokenId,
        bytes32 _sendTo,
        uint64 _amountSD,
        address _composeFrom,
        bytes memory _composeMsg
    ) internal pure returns (bytes memory _msg, bool hasCompose) {
        hasCompose = _composeMsg.length > 0;
        _msg = hasCompose
            ? abi.encodePacked(_tokenId, _sendTo, _amountSD, OFTMsgCodec.addressToBytes32(_composeFrom), _composeMsg)
            : abi.encodePacked(_tokenId, _sendTo, _amountSD);
    }

    /**
     * @notice Retrieves the `tokenId` from the Nexus message.
     * @param _msg Nexus message
     * @return Token identifier
     */
    function tokenId(bytes calldata _msg) internal pure returns (uint32) {
        return uint32(bytes4(_msg[:TOKEN_ID_OFFSET]));
    }

    /**
     * @notice Returns the OFT message portion (without `tokenId` prefix).
     * @param _msg Nexus message
     * @return OFT message slice
     */
    function oftMsg(bytes calldata _msg) internal pure returns (bytes calldata) {
        return _msg[TOKEN_ID_OFFSET:];
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // Convenience wrappers that operate directly on the full Nexus message
    // ═══════════════════════════════════════════════════════════════════════════

    /**
     * @notice Checks if the Nexus message has a composed payload.
     * @param _msg Nexus message
     * @return Boolean indicating whether the message is composed
     */
    function isComposed(bytes calldata _msg) internal pure returns (bool) {
        return OFTMsgCodec.isComposed(oftMsg(_msg));
    }

    /**
     * @notice Retrieves the recipient from the Nexus message.
     * @param _msg Nexus message
     * @return Recipient address as `bytes32`
     */
    function sendTo(bytes calldata _msg) internal pure returns (bytes32) {
        return OFTMsgCodec.sendTo(oftMsg(_msg));
    }

    /**
     * @notice Retrieves the amount in shared decimals from the Nexus message.
     * @param _msg Nexus message
     * @return Amount in shared decimals
     */
    function amountSD(bytes calldata _msg) internal pure returns (uint64) {
        return OFTMsgCodec.amountSD(oftMsg(_msg));
    }

    /**
     * @notice Retrieves the composed message from the Nexus message.
     * @param _msg Nexus message
     * @return Composed message bytes
     */
    function composeMsg(bytes calldata _msg) internal pure returns (bytes memory) {
        return OFTMsgCodec.composeMsg(oftMsg(_msg));
    }

    /**
     * @notice Converts an address to bytes32.
     * @param _addr Address to convert
     * @return `bytes32` representation of the address
     */
    function addressToBytes32(address _addr) internal pure returns (bytes32) {
        return OFTMsgCodec.addressToBytes32(_addr);
    }

    /**
     * @notice Converts bytes32 to an address.
     * @param _b `bytes32` value to convert
     * @return Address representation of `bytes32`
     */
    function bytes32ToAddress(bytes32 _b) internal pure returns (address) {
        return OFTMsgCodec.bytes32ToAddress(_b);
    }
}
