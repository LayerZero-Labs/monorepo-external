// SPDX-License-Identifier: MIT
pragma solidity ^0.8.22;

import { OptionsBuilder } from "@layerzerolabs/oapp-evm-contracts/contracts/oapp/libs/OptionsBuilder.sol";
import { SendParam } from "@layerzerolabs/oft-evm-contracts/contracts/interfaces/IOFT.sol";
import { Test } from "forge-std/Test.sol";
import { MultiHopComposerMsgCodec } from "./../../contracts/libs/MultiHopComposerMsgCodec.sol";

contract MultiHopComposerMsgCodecHarness {
    function decode(
        bytes calldata _message
    ) external pure returns (SendParam memory sendParam, address oft, bytes32 refundTo, uint256 minMsgValue) {
        return MultiHopComposerMsgCodec.decode(_message);
    }
}

contract MultiHopComposerMsgCodecTest is Test {
    using OptionsBuilder for bytes;

    address internal constant OFT = address(0x0F7);

    MultiHopComposerMsgCodecHarness internal harness = new MultiHopComposerMsgCodecHarness();

    function test_encode() public pure {
        bytes memory extraOptions = OptionsBuilder.newOptions().addExecutorLzReceiveOption(200_000, 0);
        bytes memory composeMsg = hex"c0ffee";
        SendParam memory sendParam = SendParam(30109, bytes32(uint256(0xb0b)), 1e6, 0, extraOptions, composeMsg, "");

        bytes memory message = MultiHopComposerMsgCodec.encode(sendParam, OFT, bytes32(uint256(0xa11ce)), 1e14);

        assertEq(message.length, 0x200, "the message length");
        assertEq(_word(message, 0x00), MultiHopComposerMsgCodec.SEND_PARAM_OFFSET, "the send param offset");
        assertEq(_word(message, 0x20), uint160(OFT), "oft");
        assertEq(_word(message, 0x40), 0xa11ce, "refundTo");
        assertEq(_word(message, 0x60), 1e14, "minMsgValue");
        assertEq(_word(message, 0x80), 30109, "sendParam.dstEid");
        assertEq(_word(message, 0xa0), 0xb0b, "sendParam.to");
        assertEq(_word(message, 0xc0), 1e6, "sendParam.amountLD");
        assertEq(_word(message, 0xe0), 0, "sendParam.minAmountLD");
        assertEq(_word(message, 0x100), 0xe0, "the extraOptions offset, from the start of sendParam");
        assertEq(_word(message, 0x120), 0x120, "the composeMsg offset, from the start of sendParam");
        assertEq(_word(message, 0x140), 0x160, "the oftCmd offset, from the start of sendParam");
        assertEq(_word(message, 0x160), extraOptions.length, "the extraOptions length");
        assertEq(bytes32(_word(message, 0x180)), bytes32(extraOptions), "the extraOptions data, right-padded");
        assertEq(_word(message, 0x1a0), composeMsg.length, "the composeMsg length");
        assertEq(bytes32(_word(message, 0x1c0)), bytes32(composeMsg), "the composeMsg data, right-padded");
        assertEq(_word(message, 0x1e0), 0, "the oftCmd length");
    }

    function test_decode_Fuzz(
        SendParam memory _sendParam,
        address _oft,
        bytes32 _refundTo,
        uint256 _minMsgValue,
        uint128 _lzReceiveGas,
        uint128 _value
    ) public view {
        _sendParam.extraOptions = _options(_sendParam.extraOptions, _lzReceiveGas, _value, _sendParam.to);

        (SendParam memory decoded, address oft, bytes32 refundTo, uint256 minMsgValue) = harness.decode(
            MultiHopComposerMsgCodec.encode(_sendParam, _oft, _refundTo, _minMsgValue)
        );

        assertEq(abi.encode(decoded), abi.encode(_sendParam), "the send param should round-trip");
        assertEq(oft, _oft);
        assertEq(refundTo, _refundTo);
        assertEq(minMsgValue, _minMsgValue);
    }

    function test_decode_Revert_LegacyPayload() public {
        SendParam memory sendParam = SendParam(30109, bytes32(uint256(0xb0b)), 1e6, 0, "", "", "");

        vm.expectRevert(MultiHopComposerMsgCodec.InvalidMessage.selector);
        harness.decode(abi.encode(sendParam));
    }

    function test_decode_Fuzz_Revert_InvalidPrefix(bytes32 _prefix) public {
        vm.assume(uint256(_prefix) != 0x80);
        uint256 length = bound(uint256(_prefix), 0, 10_000);

        vm.expectRevert(MultiHopComposerMsgCodec.InvalidMessage.selector);
        harness.decode(bytes.concat(_prefix, vm.randomBytes(length)));
    }

    function test_decode_Fuzz_Revert_TooShort(uint256 _length) public {
        _length = bound(_length, 0, 31);

        vm.expectRevert(MultiHopComposerMsgCodec.InvalidMessage.selector);
        harness.decode(vm.randomBytes(_length));
    }

    function _options(
        bytes memory _fuzzed,
        uint128 _lzReceiveGas,
        uint128 _value,
        bytes32 _receiver
    ) internal pure returns (bytes memory) {
        uint256 variant = _lzReceiveGas % 4;
        if (variant == 0) return _fuzzed;
        if (variant == 1) return "";

        bytes memory options = OptionsBuilder.newOptions().addExecutorLzReceiveOption(_lzReceiveGas, _value);
        if (variant == 2) return options;
        return options.addExecutorNativeDropOption(_value, _receiver);
    }

    function _word(bytes memory _data, uint256 _offset) internal pure returns (uint256 word) {
        assembly {
            word := mload(add(add(_data, 32), _offset))
        }
    }
}
