// SPDX-License-Identifier: MIT
pragma solidity ^0.8.22;

import { OFTLockUnlockExtendedRBACTest } from "@layerzerolabs/oft-evm-upgradeable-impl/test/OFTLockUnlockExtendedRBAC.t.sol";
import { OFTLockUnlock } from "../contracts/OFTLockUnlock.sol";

contract OFTLockUnlockHarness is OFTLockUnlock {
    constructor(address _token, address _endpoint) OFTLockUnlock(_token, _endpoint, 0) {}

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

contract OFTLockUnlockTest is OFTLockUnlockExtendedRBACTest {
    function _deployHarness() internal override returns (address) {
        return address(new OFTLockUnlockHarness(address(token), endpoint));
    }
}
