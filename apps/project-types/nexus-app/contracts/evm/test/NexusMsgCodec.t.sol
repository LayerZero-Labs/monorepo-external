// SPDX-License-Identifier: MIT
pragma solidity ^0.8.22;

import { Test } from "forge-std/Test.sol";
import { NexusMsgCodec } from "../contracts/libs/NexusMsgCodec.sol";

/**
 * @notice Harness contract to expose internal library functions for testing.
 */
contract NexusMsgCodecHarness {
    function encode(
        uint32 _tokenId,
        bytes32 _sendTo,
        uint64 _amountSD,
        address _composeFrom,
        bytes memory _composeMsg
    ) external pure returns (bytes memory _msg, bool hasCompose) {
        return NexusMsgCodec.encode(_tokenId, _sendTo, _amountSD, _composeFrom, _composeMsg);
    }

    function tokenId(bytes calldata _msg) external pure returns (uint32) {
        return NexusMsgCodec.tokenId(_msg);
    }

    function oftMsg(bytes calldata _msg) external pure returns (bytes memory) {
        return NexusMsgCodec.oftMsg(_msg);
    }

    function isComposed(bytes calldata _msg) external pure returns (bool) {
        return NexusMsgCodec.isComposed(_msg);
    }

    function sendTo(bytes calldata _msg) external pure returns (bytes32) {
        return NexusMsgCodec.sendTo(_msg);
    }

    function amountSD(bytes calldata _msg) external pure returns (uint64) {
        return NexusMsgCodec.amountSD(_msg);
    }

    function composeMsg(bytes calldata _msg) external pure returns (bytes memory) {
        return NexusMsgCodec.composeMsg(_msg);
    }

    function addressToBytes32(address _addr) external pure returns (bytes32) {
        return NexusMsgCodec.addressToBytes32(_addr);
    }

    function bytes32ToAddress(bytes32 _b) external pure returns (address) {
        return NexusMsgCodec.bytes32ToAddress(_b);
    }
}

contract NexusMsgCodecTest is Test {
    NexusMsgCodecHarness codec;

    address alice = makeAddr("alice");
    address bob = makeAddr("bob");

    /// @dev Known bytes32 that is NOT a valid padded address (has high bits set).
    bytes32 constant NON_ADDRESS_BYTES32 = 0xdeadbeef00000000000000000000000000000000000000000000000000000001;

    function setUp() public {
        codec = new NexusMsgCodecHarness();
    }

    // ============ encode Tests ============

    function test_encode() public view {
        uint32 tokenId = 1;
        bytes32 sendTo = bytes32(uint256(uint160(bob)));
        uint64 amountSD = 1000;

        (bytes memory msg_, bool hasCompose) = codec.encode(tokenId, sendTo, amountSD, alice, bytes(""));

        assertFalse(hasCompose);
        assertEq(msg_.length, 44); // 4 + 32 + 8

        // Verify round-trip decoding.
        assertEq(codec.tokenId(msg_), tokenId);
        assertEq(codec.sendTo(msg_), sendTo);
        assertEq(codec.amountSD(msg_), amountSD);
        assertFalse(codec.isComposed(msg_));
    }

    function test_encode_WithComposeMsg() public view {
        uint32 tokenId = 42;
        bytes32 sendTo = bytes32(uint256(uint160(alice)));
        uint64 amountSD = 5000;
        bytes memory composeMsg = hex"deadbeef";

        (bytes memory msg_, bool hasCompose) = codec.encode(tokenId, sendTo, amountSD, bob, composeMsg);

        assertTrue(hasCompose);
        assertEq(msg_.length, 80); // 4 + 32 + 8 + 32 + 4

        assertEq(codec.tokenId(msg_), tokenId);
        assertEq(codec.sendTo(msg_), sendTo);
        assertEq(codec.amountSD(msg_), amountSD);
        assertTrue(codec.isComposed(msg_));
    }

    function test_encode_ByteLayout() public view {
        uint32 tokenId = 0x12345678;
        bytes32 sendTo = 0x000000000000000000000000aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa;
        uint64 amountSD = 0x1122334455667788;

        (bytes memory msg_, ) = codec.encode(tokenId, sendTo, amountSD, alice, bytes(""));

        // Verify first 4 bytes are `tokenId` (big-endian).
        assertEq(uint8(msg_[0]), 0x12);
        assertEq(uint8(msg_[1]), 0x34);
        assertEq(uint8(msg_[2]), 0x56);
        assertEq(uint8(msg_[3]), 0x78);

        // Verify next 32 bytes are `sendTo`.
        for (uint256 i = 0; i < 32; i++) {
            assertEq(msg_[4 + i], sendTo[i]);
        }

        // Verify last 8 bytes are `amountSD` (big-endian).
        assertEq(uint8(msg_[36]), 0x11);
        assertEq(uint8(msg_[37]), 0x22);
        assertEq(uint8(msg_[38]), 0x33);
        assertEq(uint8(msg_[39]), 0x44);
        assertEq(uint8(msg_[40]), 0x55);
        assertEq(uint8(msg_[41]), 0x66);
        assertEq(uint8(msg_[42]), 0x77);
        assertEq(uint8(msg_[43]), 0x88);
    }

    function test_encode_Fuzz(uint32 _tokenId, bytes32 _sendTo, uint64 _amountSD) public view {
        (bytes memory msg_, bool hasCompose) = codec.encode(_tokenId, _sendTo, _amountSD, alice, bytes(""));

        assertFalse(hasCompose);
        assertEq(msg_.length, 44);
        assertEq(codec.tokenId(msg_), _tokenId);
        assertEq(codec.sendTo(msg_), _sendTo);
        assertEq(codec.amountSD(msg_), _amountSD);
    }

    function test_encode_Fuzz_WithComposeMsg(
        uint32 _tokenId,
        bytes32 _sendTo,
        uint64 _amountSD,
        bytes calldata _composeMsg
    ) public view {
        vm.assume(_composeMsg.length > 0);

        (bytes memory msg_, bool hasCompose) = codec.encode(_tokenId, _sendTo, _amountSD, alice, _composeMsg);

        assertTrue(hasCompose);
        assertEq(msg_.length, 44 + 32 + _composeMsg.length);
        assertEq(codec.tokenId(msg_), _tokenId);
        assertEq(codec.sendTo(msg_), _sendTo);
        assertEq(codec.amountSD(msg_), _amountSD);
        assertTrue(codec.isComposed(msg_));
    }

    // ============ oftMsg Tests ============

    function test_oftMsg() public view {
        uint32 tokenId = 1;
        bytes32 sendTo = bytes32(uint256(uint160(bob)));
        uint64 amountSD = 500;

        (bytes memory msg_, ) = codec.encode(tokenId, sendTo, amountSD, alice, bytes(""));

        bytes memory oftMsgBytes = codec.oftMsg(msg_);

        // OFT message should be everything after the `tokenId` prefix.
        assertEq(oftMsgBytes.length, 40);

        // Verify it's the correct slice by checking content.
        for (uint256 i = 0; i < 40; i++) {
            assertEq(oftMsgBytes[i], msg_[4 + i]);
        }
    }

    function test_oftMsg_WithComposeMsg() public view {
        bytes memory composeMsg = hex"cafebabe";

        (bytes memory msg_, ) = codec.encode(1, bytes32(uint256(uint160(bob))), 500, alice, composeMsg);

        bytes memory oftMsgBytes = codec.oftMsg(msg_);

        // OFT message = 32 (sendTo) + 8 (amountSD) + 32 (composeSender) + 4 (composeMsg).
        assertEq(oftMsgBytes.length, 76);
    }

    // ============ composeMsg Tests ============

    function test_composeMsg() public view {
        bytes memory inputComposeMsg = hex"deadbeefcafe";

        (bytes memory msg_, ) = codec.encode(1, bytes32(uint256(uint160(bob))), 100, alice, inputComposeMsg);

        bytes memory actualComposeMsg = codec.composeMsg(msg_);

        // Result includes `composeSender` (32 bytes) + original compose msg.
        assertEq(actualComposeMsg.length, 32 + inputComposeMsg.length);

        // Verify the payload portion matches input.
        for (uint256 i = 0; i < inputComposeMsg.length; i++) {
            assertEq(actualComposeMsg[32 + i], inputComposeMsg[i]);
        }
    }

    function test_composeMsg_Empty() public view {
        (bytes memory msg_, ) = codec.encode(1, bytes32(uint256(uint160(bob))), 100, alice, bytes(""));

        bytes memory actualComposeMsg = codec.composeMsg(msg_);

        assertEq(actualComposeMsg.length, 0);
    }

    function test_composeMsg_Fuzz(bytes calldata _composeMsg) public view {
        vm.assume(_composeMsg.length > 0);

        (bytes memory msg_, ) = codec.encode(1, bytes32(uint256(uint160(bob))), 100, alice, _composeMsg);

        bytes memory actualComposeMsg = codec.composeMsg(msg_);

        assertEq(actualComposeMsg.length, 32 + _composeMsg.length);
    }

    // ============ addressToBytes32 Tests ============

    function test_addressToBytes32() public view {
        bytes32 result = codec.addressToBytes32(alice);

        // The high 96 bits should be zero, low 160 bits should be the address.
        assertEq(uint256(result) >> 160, 0);
        assertEq(address(uint160(uint256(result))), alice);
    }

    function test_addressToBytes32_Fuzz(address _addr) public view {
        bytes32 result = codec.addressToBytes32(_addr);

        // High 96 bits must be zero (right-padded address).
        assertEq(uint256(result) >> 160, 0);

        // Round-trip must preserve address.
        assertEq(codec.bytes32ToAddress(result), _addr);
    }

    // ============ bytes32ToAddress Tests ============

    function test_bytes32ToAddress() public view {
        bytes32 input = bytes32(uint256(uint160(bob)));

        address result = codec.bytes32ToAddress(input);

        assertEq(result, bob);
    }

    function test_bytes32ToAddress_TruncatesHighBits() public view {
        // Input with high bits set.
        bytes32 input = NON_ADDRESS_BYTES32;

        address result = codec.bytes32ToAddress(input);

        // Result should only contain lower 160 bits.
        assertEq(uint160(uint256(input)), uint160(result));

        // High bits are lost.
        assertTrue(uint256(input) != uint256(uint160(result)));
    }

    function test_bytes32ToAddress_Fuzz(bytes32 _b) public view {
        address result = codec.bytes32ToAddress(_b);

        // Result must equal lower 160 bits.
        assertEq(uint160(result), uint160(uint256(_b)));
    }

    // ============ Round-Trip Tests ============

    function test_addressRoundTrip_Fuzz(address _addr) public view {
        bytes32 asBytes32 = codec.addressToBytes32(_addr);
        address recovered = codec.bytes32ToAddress(asBytes32);

        assertEq(recovered, _addr);
    }

    function test_encodeDecodeRoundTrip_Fuzz(
        uint32 _tokenId,
        bytes32 _sendTo,
        uint64 _amountSD,
        bytes calldata _composeMsg
    ) public view {
        (bytes memory msg_, bool hasCompose) = codec.encode(_tokenId, _sendTo, _amountSD, alice, _composeMsg);

        assertEq(hasCompose, _composeMsg.length > 0);
        assertEq(codec.tokenId(msg_), _tokenId);
        assertEq(codec.sendTo(msg_), _sendTo);
        assertEq(codec.amountSD(msg_), _amountSD);
        assertEq(codec.isComposed(msg_), _composeMsg.length > 0);

        if (_composeMsg.length > 0) {
            bytes memory actualComposeMsg = codec.composeMsg(msg_);
            assertEq(actualComposeMsg.length, 32 + _composeMsg.length);
        }
    }

    // ============ sendTo with Full bytes32 ============

    function test_sendTo_NonAddressBytes32() public view {
        // Use a bytes32 that has high bits set (not a valid padded address).
        bytes32 sendTo = NON_ADDRESS_BYTES32;

        (bytes memory msg_, ) = codec.encode(1, sendTo, 100, alice, bytes(""));

        // Should preserve full bytes32.
        assertEq(codec.sendTo(msg_), sendTo);
    }
}
