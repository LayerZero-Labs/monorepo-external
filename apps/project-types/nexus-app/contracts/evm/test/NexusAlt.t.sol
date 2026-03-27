// SPDX-License-Identifier: MIT
pragma solidity ^0.8.22;

import { IOAppAlt } from "@layerzerolabs/oapp-evm-impl/contracts/interfaces/IOAppAlt.sol";
import { SendParam, MessagingFee } from "@layerzerolabs/oft-evm-impl/contracts/interfaces/IOFT.sol";
import { MockERC20 } from "@layerzerolabs/test-utils-evm/contracts/mocks/MockERC20.sol";
import { Nexus } from "./../contracts/Nexus.sol";
import { NexusAlt } from "./../contracts/NexusAlt.sol";
import { NexusOFTAlt } from "./../contracts/NexusOFTAlt.sol";
import { NexusTest } from "./Nexus.t.sol";

contract NexusAltTest is NexusTest {
    NexusAlt aNexusAlt;
    NexusAlt bNexusAlt;
    MockERC20 nativeToken;

    function _setupEndpoints() internal override {
        nativeToken = new MockERC20(18);
        address[] memory nativeTokenAddresses = new address[](2);
        nativeTokenAddresses[0] = address(nativeToken);
        nativeTokenAddresses[1] = address(nativeToken);
        createEndpoints(2, LibraryType.UltraLightNode, nativeTokenAddresses);
    }

    function _deployNexusContracts() internal override {
        NexusAlt aNexusAltImpl_ = new NexusAlt(address(endpoints[aEid]), localDecimals, BURN_SELECTOR, MINT_SELECTOR);
        NexusAlt bNexusAltImpl_ = new NexusAlt(address(endpoints[bEid]), localDecimals, BURN_SELECTOR, MINT_SELECTOR);

        aNexusAlt = NexusAlt(
            _deployTransparentProxy(
                address(aNexusAltImpl_),
                proxyAdmin,
                abi.encodeWithSelector(Nexus.initialize.selector, owner, owner)
            )
        );
        bNexusAlt = NexusAlt(
            _deployTransparentProxy(
                address(bNexusAltImpl_),
                proxyAdmin,
                abi.encodeWithSelector(Nexus.initialize.selector, owner, owner)
            )
        );

        aNexus = aNexusAlt;
        bNexus = bNexusAlt;
        aNexusImpl = aNexusAltImpl_;
        bNexusImpl = bNexusAltImpl_;
    }

    function _deployNexusOFTs() internal override {
        _grantNexusRoles();

        aNexusOFT = new NexusOFTAlt(address(aNexusAlt), address(aToken), TOKEN_ID);
        bNexusOFT = new NexusOFTAlt(address(bNexusAlt), address(bToken), TOKEN_ID);

        aNexusAlt.registerToken(TOKEN_ID, address(aNexusOFT), address(aToken));
        bNexusAlt.registerToken(TOKEN_ID, address(bNexusOFT), address(bToken));
    }

    /**
     * @dev Override to pay fees with ERC20 native token instead of `msg.value`.
     */
    function _executeSend(
        address _sender,
        SendParam memory _sendParam,
        MessagingFee memory _fee,
        address _refundAddress
    ) internal override {
        nativeToken.mint(_sender, _fee.nativeFee);
        vm.startPrank(_sender);
        nativeToken.approve(address(aNexusOFT), _fee.nativeFee);
        aNexusOFT.send(_sendParam, _fee, payable(_refundAddress));
        vm.stopPrank();
    }

    function test_constructor_Revert_InvalidNativeToken() public {
        address fakeEndpoint = makeAddr("fakeEndpoint");
        vm.mockCall(fakeEndpoint, abi.encodeWithSignature("nativeToken()"), abi.encode(address(0)));
        vm.mockCall(fakeEndpoint, abi.encodeWithSignature("eid()"), abi.encode(uint32(1)));
        vm.expectRevert(IOAppAlt.InvalidNativeToken.selector);
        new NexusAlt(fakeEndpoint, localDecimals, BURN_SELECTOR, MINT_SELECTOR);
    }
}
