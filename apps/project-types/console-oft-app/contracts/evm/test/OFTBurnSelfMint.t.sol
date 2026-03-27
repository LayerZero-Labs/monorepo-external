// SPDX-License-Identifier: MIT
pragma solidity ^0.8.22;

import { OFTBurnSelfMintExtendedRBACTest } from "@layerzerolabs/oft-evm-upgradeable-impl/test/OFTBurnSelfMintExtendedRBAC.t.sol";
import { OFTBurnSelfMint } from "../contracts/OFTBurnSelfMint.sol";

contract OFTBurnSelfMintHarness is OFTBurnSelfMint {
    constructor(
        address _token,
        address _burnerMinter,
        address _endpoint,
        bytes4 _burnSelector,
        bytes4 _mintSelector
    ) OFTBurnSelfMint(_token, _burnerMinter, _endpoint, _burnSelector, _mintSelector, 0) {}

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

contract OFTBurnSelfMintTest is OFTBurnSelfMintExtendedRBACTest {
    function _deployHarness() internal override returns (address) {
        return
            address(
                new OFTBurnSelfMintHarness(
                    address(token),
                    burnerMinter,
                    endpoint,
                    bytes4(keccak256("burn(uint256)")),
                    bytes4(keccak256("mint(address,uint256)"))
                )
            );
    }
}
