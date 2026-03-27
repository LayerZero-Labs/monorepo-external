// SPDX-License-Identifier: MIT
pragma solidity ^0.8.22;

import { OFTBurnMintExtendedRBACAltTest } from "@layerzerolabs/oft-evm-upgradeable-impl/test/OFTBurnMintExtendedRBACAlt.t.sol";
import { OFTBurnMintAlt } from "../contracts/alt/OFTBurnMintAlt.sol";

contract OFTBurnMintAltHarness is OFTBurnMintAlt {
    constructor(
        address _token,
        address _burnerMinter,
        address _endpoint,
        bool _approvalRequired,
        bytes4 _burnSelector,
        bytes4 _mintSelector
    ) OFTBurnMintAlt(_token, _burnerMinter, _endpoint, _approvalRequired, _burnSelector, _mintSelector, 0) {}

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

contract OFTBurnMintAltTest is OFTBurnMintExtendedRBACAltTest {
    function _deployHarness() internal override returns (address) {
        return
            address(
                new OFTBurnMintAltHarness(
                    address(token),
                    burnerMinter,
                    endpoint,
                    approvalRequired,
                    bytes4(keccak256("burn(address,uint256)")),
                    bytes4(keccak256("mint(address,uint256)"))
                )
            );
    }
}
