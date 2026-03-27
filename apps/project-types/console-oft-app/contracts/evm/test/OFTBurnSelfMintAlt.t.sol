// SPDX-License-Identifier: MIT
pragma solidity ^0.8.22;

import { OFTBurnSelfMintExtendedRBACAltTest } from "@layerzerolabs/oft-evm-upgradeable-impl/test/OFTBurnSelfMintExtendedRBACAlt.t.sol";
import { OFTBurnSelfMintAlt } from "../contracts/alt/OFTBurnSelfMintAlt.sol";

contract OFTBurnSelfMintAltHarness is OFTBurnSelfMintAlt {
    constructor(
        address _token,
        address _burnerMinter,
        address _endpoint,
        bytes4 _burnSelector,
        bytes4 _mintSelector
    ) OFTBurnSelfMintAlt(_token, _burnerMinter, _endpoint, _burnSelector, _mintSelector, 0) {}

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

contract OFTBurnSelfMintAltTest is OFTBurnSelfMintExtendedRBACAltTest {
    function _deployHarness() internal override returns (address) {
        return
            address(
                new OFTBurnSelfMintAltHarness(
                    address(token),
                    burnerMinter,
                    endpoint,
                    bytes4(keccak256("burn(uint256)")),
                    bytes4(keccak256("mint(address,uint256)"))
                )
            );
    }
}
