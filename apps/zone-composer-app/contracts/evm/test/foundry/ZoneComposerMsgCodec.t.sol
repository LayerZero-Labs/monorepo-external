// SPDX-License-Identifier: MIT
pragma solidity ^0.8.22;

import { Test } from "forge-std/Test.sol";
import { ZoneComposerMsgCodec } from "./../../contracts/libs/ZoneComposerMsgCodec.sol";

contract ZoneComposerMsgCodecHarness {
    function decode(
        bytes calldata _message
    ) external pure returns (uint64 dstZone, bytes memory recipient, bytes memory memo) {
        return ZoneComposerMsgCodec.decode(_message);
    }
}

contract ZoneComposerMsgCodecTest is Test {
    ZoneComposerMsgCodecHarness internal harness = new ZoneComposerMsgCodecHarness();

    function test_encode() public pure {
        assertEq(ZoneComposerMsgCodec.encode(1, hex"aabb"), abi.encode(uint64(1), hex"aabb"));
    }

    function test_encode_WithMemo() public pure {
        assertEq(ZoneComposerMsgCodec.encode(1, hex"aabb", hex"cc"), abi.encode(uint64(1), hex"aabb", hex"cc"));
    }

    function test_decode() public view {
        (uint64 zone, bytes memory recipient, bytes memory memo) = harness.decode(abi.encode(uint64(1), hex"aabb"));
        assertEq(zone, 1);
        assertEq(recipient, hex"aabb");
        assertEq(memo, bytes(""));
    }

    function test_decode_ExplicitEmptyMemo() public view {
        (uint64 zone, bytes memory recipient, bytes memory memo) = harness.decode(
            abi.encode(uint64(1), hex"aabb", bytes(""))
        );
        assertEq(zone, 1);
        assertEq(recipient, hex"aabb");
        assertEq(memo, bytes(""));
    }

    function test_decode_SameLengthDifferentForms() public view {
        bytes memory base = ZoneComposerMsgCodec.encode(1, new bytes(128));
        bytes memory memoed = ZoneComposerMsgCodec.encode(2, hex"aa", hex"bb");
        assertEq(base.length, memoed.length);
        (uint64 baseZone, bytes memory baseRecipient, bytes memory baseMemo) = harness.decode(base);
        (uint64 memoedZone, bytes memory memoedRecipient, bytes memory memo) = harness.decode(memoed);
        assertEq(baseZone, 1);
        assertEq(baseRecipient.length, 128);
        assertEq(baseMemo.length, 0);
        assertEq(memoedZone, 2);
        assertEq(memoedRecipient, hex"aa");
        assertEq(memo, hex"bb");
    }

    function test_decode_Fuzz(uint64 _zone, bytes memory _recipient, bytes memory _memo, bool _withMemo) public {
        _zone = uint64(bound(_zone, 1, type(uint64).max));
        vm.assume(_recipient.length > 0 && _recipient.length <= 255 && (!_withMemo || _memo.length <= 255));
        bytes memory payload = _withMemo
            ? ZoneComposerMsgCodec.encode(_zone, _recipient, _memo)
            : ZoneComposerMsgCodec.encode(_zone, _recipient);
        (uint64 zone, bytes memory recipient, bytes memory memo) = harness.decode(payload);
        assertEq(zone, _zone);
        assertEq(recipient, _recipient);
        assertEq(memo, _withMemo ? _memo : bytes(""));
    }

    function test_decode_Fuzz_MaximumFields(bool _withMemo) public view {
        bytes memory recipient = new bytes(255);
        bytes memory memo = new bytes(255);
        bytes memory payload = _withMemo
            ? ZoneComposerMsgCodec.encode(1, recipient, memo)
            : ZoneComposerMsgCodec.encode(1, recipient);
        (uint64 zone, bytes memory decodedRecipient, bytes memory decodedMemo) = harness.decode(payload);
        assertEq(zone, 1);
        assertEq(decodedRecipient, recipient);
        assertEq(decodedMemo, _withMemo ? memo : bytes(""));
    }

    function test_decode_Fuzz_Revert_OversizedRecipient(uint16 _length, bool _withMemo) public {
        bytes memory recipient = new bytes(bound(_length, 256, 4096));
        bytes memory payload = _withMemo
            ? ZoneComposerMsgCodec.encode(1, recipient, hex"01")
            : ZoneComposerMsgCodec.encode(1, recipient);
        vm.expectRevert(ZoneComposerMsgCodec.InvalidPayload.selector);
        harness.decode(payload);
    }

    function test_decode_Fuzz_Revert_OversizedMemo(uint16 _length) public {
        bytes memory memo = new bytes(bound(_length, 256, 4096));
        vm.expectRevert(ZoneComposerMsgCodec.InvalidPayload.selector);
        harness.decode(ZoneComposerMsgCodec.encode(1, hex"01", memo));
    }

    function test_decode_Fuzz_Revert_ZeroZone(bool _withMemo) public {
        bytes memory payload = _withMemo
            ? ZoneComposerMsgCodec.encode(0, hex"01", bytes(""))
            : ZoneComposerMsgCodec.encode(0, hex"01");
        vm.expectRevert(ZoneComposerMsgCodec.InvalidPayload.selector);
        harness.decode(payload);
    }

    function test_decode_Fuzz_Revert_EmptyRecipient(bool _withMemo) public {
        bytes memory payload = _withMemo
            ? ZoneComposerMsgCodec.encode(1, bytes(""), bytes(""))
            : ZoneComposerMsgCodec.encode(1, bytes(""));
        vm.expectRevert(ZoneComposerMsgCodec.InvalidPayload.selector);
        harness.decode(payload);
    }

    function test_decode_Revert_InvalidOffset() public {
        vm.expectRevert(ZoneComposerMsgCodec.InvalidPayload.selector);
        harness.decode(abi.encode(uint64(1), uint256(0)));
    }

    function test_decode_TrailingBytes() public view {
        (uint64 zone, bytes memory recipient, bytes memory memo) = harness.decode(
            bytes.concat(ZoneComposerMsgCodec.encode(1, hex"aa"), hex"00")
        );
        assertEq(zone, 1);
        assertEq(recipient, hex"aa");
        assertEq(memo, bytes(""));
    }

    function test_decode_NonzeroPadding() public view {
        bytes memory payload = ZoneComposerMsgCodec.encode(1, hex"aa");
        payload[payload.length - 1] = 0x01;
        (uint64 zone, bytes memory recipient, bytes memory memo) = harness.decode(payload);
        assertEq(zone, 1);
        assertEq(recipient, hex"aa");
        assertEq(memo, bytes(""));
    }

    function test_decode_Revert_TruncatedTail() public {
        vm.expectRevert(bytes(""));
        harness.decode(abi.encode(uint64(1), uint256(64), uint256(100)));
    }

    function test_decode_OverlappingTails() public view {
        (uint64 zone, bytes memory recipient, bytes memory memo) = harness.decode(
            abi.encode(uint64(1), uint256(96), uint256(96), uint256(1), bytes32(bytes1(0xaa)))
        );
        assertEq(zone, 1);
        assertEq(recipient, hex"aa");
        assertEq(memo, hex"aa");
    }

    function test_decode_Fuzz_Revert_ShortHead(uint8 _length) public {
        uint256 length = bound(_length, 0, 63);
        vm.expectRevert(ZoneComposerMsgCodec.InvalidPayload.selector);
        harness.decode(new bytes(length));
    }

    function test_decode_Fuzz_Revert_NonCanonicalZone(uint256 _zone, bool _withMemo) public {
        _zone = bound(_zone, uint256(type(uint64).max) + 1, type(uint256).max);
        bytes memory message = _withMemo ? abi.encode(_zone, hex"aa", hex"bb") : abi.encode(_zone, hex"aa");
        vm.expectRevert(bytes(""));
        harness.decode(message);
    }
}
