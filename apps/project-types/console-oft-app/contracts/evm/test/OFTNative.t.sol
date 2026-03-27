// SPDX-License-Identifier: MIT
pragma solidity ^0.8.22;

import { OFTNativeExtendedRBACTest } from "@layerzerolabs/oft-evm-upgradeable-impl/test/OFTNativeExtendedRBAC.t.sol";
import { OFTNative } from "../contracts/OFTNative.sol";

contract OFTNativeHarness is OFTNative {
    constructor(uint8 _localDecimals, address _endpoint) OFTNative(_localDecimals, _endpoint, 0) {}

    function debit(
        address _from,
        uint256 _amountLD,
        uint256 _minAmountLD,
        uint32 _dstEid
    ) public returns (uint256 amountSentLD, uint256 amountReceivedLD) {
        return _debit(_from, _amountLD, _minAmountLD, _dstEid);
    }

    function credit(address _to, uint256 _amountLD, uint32 _srcEid) public returns (uint256 amountReceivedLD) {
        return _credit(_to, _amountLD, _srcEid);
    }
}

contract OFTNativeTest is OFTNativeExtendedRBACTest {
    function _deployHarness() internal override returns (address) {
        return address(new OFTNativeHarness(18, endpoint));
    }
}
