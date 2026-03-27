// SPDX-License-Identifier: MIT
pragma solidity ^0.8.22;

import { OFTBurnMintExtendedRBACTest } from "@layerzerolabs/oft-evm-upgradeable-impl/test/OFTBurnMintExtendedRBAC.t.sol";
import {
    MockBurnerMinterRedeemIssue,
    MockBurnerMinterCrosschain
} from "@layerzerolabs/test-utils-evm/contracts/mocks/MockBurnerMinterVariants.sol";
import { OFTBurnMint } from "../contracts/OFTBurnMint.sol";

contract OFTBurnMintHarness is OFTBurnMint {
    constructor(
        address _token,
        address _burnerMinter,
        address _endpoint,
        bool _approvalRequired,
        bytes4 _burnSelector,
        bytes4 _mintSelector
    ) OFTBurnMint(_token, _burnerMinter, _endpoint, _approvalRequired, _burnSelector, _mintSelector, 0) {}

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

contract OFTBurnMintTest is OFTBurnMintExtendedRBACTest {
    function _deployHarness() internal override returns (address) {
        return
            address(
                new OFTBurnMintHarness(
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

contract OFTBurnMintRedeemIssueTest is OFTBurnMintExtendedRBACTest {
    function _deployHarness() internal override returns (address) {
        burnerMinter = address(new MockBurnerMinterRedeemIssue(address(token)));
        approvalRequired = false;
        return
            address(
                new OFTBurnMintHarness(
                    address(token),
                    burnerMinter,
                    endpoint,
                    approvalRequired,
                    bytes4(keccak256("redeem(address,uint256)")),
                    bytes4(keccak256("issue(address,uint256)"))
                )
            );
    }
}

contract OFTBurnMintCrosschainTest is OFTBurnMintExtendedRBACTest {
    function _deployHarness() internal override returns (address) {
        burnerMinter = address(new MockBurnerMinterCrosschain(address(token)));
        approvalRequired = false;
        return
            address(
                new OFTBurnMintHarness(
                    address(token),
                    burnerMinter,
                    endpoint,
                    approvalRequired,
                    bytes4(keccak256("crosschainBurn(address,uint256)")),
                    bytes4(keccak256("crosschainMint(address,uint256)"))
                )
            );
    }
}
