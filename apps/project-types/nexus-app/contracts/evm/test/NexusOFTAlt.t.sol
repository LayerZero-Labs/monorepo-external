// SPDX-License-Identifier: MIT
pragma solidity ^0.8.22;

import {
    MessagingReceipt,
    MessagingFee
} from "@layerzerolabs/lz-evm-protocol-v2/contracts/interfaces/ILayerZeroEndpointV2.sol";
import { IOAppAlt } from "@layerzerolabs/oapp-evm-impl/contracts/interfaces/IOAppAlt.sol";
import { SendParam } from "@layerzerolabs/oft-evm-impl/contracts/interfaces/IOFT.sol";
import {
    MockBurnerMinterRedeemIssue,
    MockBurnerMinterCrosschain
} from "@layerzerolabs/test-utils-evm/contracts/mocks/MockBurnerMinterVariants.sol";
import { MockERC20 } from "@layerzerolabs/test-utils-evm/contracts/mocks/MockERC20.sol";
import { INexusOFT } from "./../contracts/interfaces/INexusOFT.sol";
import { Nexus } from "./../contracts/Nexus.sol";
import { NexusAlt } from "./../contracts/NexusAlt.sol";
import { NexusOFTAlt } from "./../contracts/NexusOFTAlt.sol";
import { NexusOFTTest } from "./NexusOFT.t.sol";

contract NexusOFTAltTest is NexusOFTTest {
    NexusAlt aNexusAlt;
    NexusAlt bNexusAlt;
    NexusOFTAlt aNexusOFTAlt;
    NexusOFTAlt bNexusOFTAlt;
    MockERC20 nativeToken;

    function _setupEndpoints() internal override {
        nativeToken = new MockERC20(18);
        address[] memory nativeTokenAddresses = new address[](2);
        nativeTokenAddresses[0] = address(nativeToken);
        nativeTokenAddresses[1] = address(nativeToken);
        createEndpoints(2, LibraryType.UltraLightNode, nativeTokenAddresses);
    }

    function _deployNexusContracts() internal virtual override {
        NexusAlt aNexusAltImpl = new NexusAlt(address(endpoints[aEid]), localDecimals, BURN_SELECTOR, MINT_SELECTOR);
        NexusAlt bNexusAltImpl = new NexusAlt(address(endpoints[bEid]), localDecimals, BURN_SELECTOR, MINT_SELECTOR);

        aNexusAlt = NexusAlt(
            _deployTransparentProxy(
                address(aNexusAltImpl),
                proxyAdmin,
                abi.encodeWithSelector(Nexus.initialize.selector, owner, owner)
            )
        );
        bNexusAlt = NexusAlt(
            _deployTransparentProxy(
                address(bNexusAltImpl),
                proxyAdmin,
                abi.encodeWithSelector(Nexus.initialize.selector, owner, owner)
            )
        );

        aNexus = aNexusAlt;
        bNexus = bNexusAlt;
    }

    function _deployNexusOFTs() internal virtual override {
        _grantNexusRoles();

        aNexusOFTAlt = new NexusOFTAlt(address(aNexusAlt), address(aToken), TOKEN_ID);
        bNexusOFTAlt = new NexusOFTAlt(address(bNexusAlt), address(bToken), TOKEN_ID);

        aNexusOFT = aNexusOFTAlt;
        bNexusOFT = bNexusOFTAlt;

        aNexusAlt.registerToken(TOKEN_ID, address(aNexusOFTAlt), address(aToken));
        bNexusAlt.registerToken(TOKEN_ID, address(bNexusOFTAlt), address(bToken));
    }

    /**
     * @dev Override to pay fees with ERC20 native token instead of `msg.value`.
     */
    function _executeSend(
        address _sender,
        SendParam memory _sendParam,
        MessagingFee memory _fee,
        address _refundAddress
    ) internal override returns (MessagingReceipt memory receipt) {
        nativeToken.mint(_sender, _fee.nativeFee);
        vm.startPrank(_sender);
        nativeToken.approve(address(aNexusOFT), _fee.nativeFee);
        (receipt, ) = aNexusOFT.send(_sendParam, _fee, payable(_refundAddress));
        vm.stopPrank();
    }

    function test_constructor_Revert_InvalidNativeToken() public {
        address fakeEndpoint = makeAddr("fakeEndpoint");
        address fakeNexus = makeAddr("fakeNexus");
        vm.mockCall(fakeNexus, abi.encodeWithSignature("endpoint()"), abi.encode(fakeEndpoint));
        vm.mockCall(fakeEndpoint, abi.encodeWithSignature("nativeToken()"), abi.encode(address(0)));
        vm.expectRevert(IOAppAlt.InvalidNativeToken.selector);
        new NexusOFTAlt(fakeNexus, address(aToken), TOKEN_ID);
    }

    function test_send_Revert_OnlyAltToken() public {
        uint256 tokensToSend = 1 ether;
        SendParam memory sendParam = _buildSendParamWithOptions(
            bEid,
            bob,
            tokensToSend,
            tokensToSend,
            _getDefaultLzOptions()
        );
        MessagingFee memory fee = aNexusOFTAlt.quoteSend(sendParam, false);

        nativeToken.mint(alice, fee.nativeFee);

        vm.startPrank(alice);
        nativeToken.approve(address(aNexusOFTAlt), fee.nativeFee);

        vm.expectRevert(IOAppAlt.OnlyAltToken.selector);
        aNexusOFTAlt.send{ value: 1 wei }(sendParam, fee, payable(address(this)));
        vm.stopPrank();
    }

    function test_send_Revert_MsgInspection() public override {
        vm.skip(true, "Tested in parent");
    }

    function test_send_Revert_MsgInspectionWhitelist() public override {
        vm.skip(true, "Tested in parent");
    }

    function test_send_Revert_WhenPaused() public override {
        vm.skip(true, "Tested in parent");
    }

    function test_send_Revert_ScaledRateLimitOverLimit() public override {
        vm.skip(true, "Tested in parent");
    }

    function test_send_Revert_LzTokenUnavailable() public override {
        uint256 tokensToSend = 1 ether;
        SendParam memory sendParam = _buildSendParamWithOptions(
            bEid,
            bob,
            tokensToSend,
            tokensToSend,
            _getDefaultLzOptions()
        );

        MessagingFee memory nativeFee = aNexusOFT.quoteSend(sendParam, false);

        MessagingFee memory feeWithLzToken = MessagingFee({ nativeFee: nativeFee.nativeFee, lzTokenFee: 0.01 ether });

        nativeToken.mint(alice, nativeFee.nativeFee);

        vm.startPrank(alice);
        nativeToken.approve(address(aNexusOFT), nativeFee.nativeFee);
        vm.expectRevert(INexusOFT.LzTokenUnavailable.selector);
        aNexusOFT.send(sendParam, feeWithLzToken, payable(alice));
        vm.stopPrank();
    }
}

// ============ Dynamic Selector Tests ============

contract NexusOFTAltRedeemIssueTest is NexusOFTAltTest {
    address aBurnerMinter;
    address bBurnerMinter;

    function _deployNexusContracts() internal override {
        bytes4 redeemSelector = bytes4(keccak256("redeem(address,uint256)"));
        bytes4 issueSelector = bytes4(keccak256("issue(address,uint256)"));

        NexusAlt aNexusAltImpl = new NexusAlt(address(endpoints[aEid]), localDecimals, redeemSelector, issueSelector);
        NexusAlt bNexusAltImpl = new NexusAlt(address(endpoints[bEid]), localDecimals, redeemSelector, issueSelector);

        aNexusAlt = NexusAlt(
            _deployTransparentProxy(
                address(aNexusAltImpl),
                proxyAdmin,
                abi.encodeWithSelector(Nexus.initialize.selector, owner, owner)
            )
        );
        bNexusAlt = NexusAlt(
            _deployTransparentProxy(
                address(bNexusAltImpl),
                proxyAdmin,
                abi.encodeWithSelector(Nexus.initialize.selector, owner, owner)
            )
        );

        aNexus = aNexusAlt;
        bNexus = bNexusAlt;
    }

    function _deployTokens() internal override {
        super._deployTokens();
        aBurnerMinter = address(new MockBurnerMinterRedeemIssue(address(aToken)));
        bBurnerMinter = address(new MockBurnerMinterRedeemIssue(address(bToken)));
    }

    function _setupTokenRoles() internal override {
        aToken.grantRole(aToken.MINTER_ROLE(), aBurnerMinter);
        aToken.grantRole(aToken.BURNER_ROLE(), aBurnerMinter);
        bToken.grantRole(bToken.MINTER_ROLE(), bBurnerMinter);
        bToken.grantRole(bToken.BURNER_ROLE(), bBurnerMinter);

        aToken.grantRole(aToken.MINTER_ROLE(), address(this));
    }

    function _deployNexusOFTs() internal override {
        _grantNexusRoles();

        aNexusOFTAlt = new NexusOFTAlt(address(aNexusAlt), address(aToken), TOKEN_ID);
        bNexusOFTAlt = new NexusOFTAlt(address(bNexusAlt), address(bToken), TOKEN_ID);

        aNexusOFT = aNexusOFTAlt;
        bNexusOFT = bNexusOFTAlt;

        aNexusAlt.registerToken(TOKEN_ID, address(aNexusOFTAlt), aBurnerMinter);
        bNexusAlt.registerToken(TOKEN_ID, address(bNexusOFTAlt), bBurnerMinter);
    }
}

contract NexusOFTAltCrosschainTest is NexusOFTAltTest {
    address aBurnerMinter;
    address bBurnerMinter;

    function _deployNexusContracts() internal override {
        bytes4 crosschainBurnSelector = bytes4(keccak256("crosschainBurn(address,uint256)"));
        bytes4 crosschainMintSelector = bytes4(keccak256("crosschainMint(address,uint256)"));

        NexusAlt aNexusAltImpl = new NexusAlt(
            address(endpoints[aEid]),
            localDecimals,
            crosschainBurnSelector,
            crosschainMintSelector
        );
        NexusAlt bNexusAltImpl = new NexusAlt(
            address(endpoints[bEid]),
            localDecimals,
            crosschainBurnSelector,
            crosschainMintSelector
        );

        aNexusAlt = NexusAlt(
            _deployTransparentProxy(
                address(aNexusAltImpl),
                proxyAdmin,
                abi.encodeWithSelector(Nexus.initialize.selector, owner, owner)
            )
        );
        bNexusAlt = NexusAlt(
            _deployTransparentProxy(
                address(bNexusAltImpl),
                proxyAdmin,
                abi.encodeWithSelector(Nexus.initialize.selector, owner, owner)
            )
        );

        aNexus = aNexusAlt;
        bNexus = bNexusAlt;
    }

    function _deployTokens() internal override {
        super._deployTokens();
        aBurnerMinter = address(new MockBurnerMinterCrosschain(address(aToken)));
        bBurnerMinter = address(new MockBurnerMinterCrosschain(address(bToken)));
    }

    function _setupTokenRoles() internal override {
        aToken.grantRole(aToken.MINTER_ROLE(), aBurnerMinter);
        aToken.grantRole(aToken.BURNER_ROLE(), aBurnerMinter);
        bToken.grantRole(bToken.MINTER_ROLE(), bBurnerMinter);
        bToken.grantRole(bToken.BURNER_ROLE(), bBurnerMinter);

        aToken.grantRole(aToken.MINTER_ROLE(), address(this));
    }

    function _deployNexusOFTs() internal override {
        _grantNexusRoles();

        aNexusOFTAlt = new NexusOFTAlt(address(aNexusAlt), address(aToken), TOKEN_ID);
        bNexusOFTAlt = new NexusOFTAlt(address(bNexusAlt), address(bToken), TOKEN_ID);

        aNexusOFT = aNexusOFTAlt;
        bNexusOFT = bNexusOFTAlt;

        aNexusAlt.registerToken(TOKEN_ID, address(aNexusOFTAlt), aBurnerMinter);
        bNexusAlt.registerToken(TOKEN_ID, address(bNexusOFTAlt), bBurnerMinter);
    }
}
