// SPDX-License-Identifier: MIT
pragma solidity ^0.8.22;

import { OFTLockUnlockExtendedRBACAltTest } from "@layerzerolabs/oft-evm-upgradeable-impl/test/OFTLockUnlockExtendedRBACAlt.t.sol";
import { OFTLockUnlockAlt } from "../contracts/alt/OFTLockUnlockAlt.sol";

contract OFTLockUnlockAltHarness is OFTLockUnlockAlt {
    constructor(address _token, address _endpoint) OFTLockUnlockAlt(_token, _endpoint, 0) {}

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

contract OFTLockUnlockAltTest is OFTLockUnlockExtendedRBACAltTest {
    function _deployHarness() internal override returns (address) {
        return address(new OFTLockUnlockAltHarness(address(token), endpoint));
    }
}
