// SPDX-License-Identifier: MIT
pragma solidity ^0.8.22;

import { UlnOptions } from "@layerzerolabs/lz-evm-messagelib-v2/contracts/uln/libs/UlnOptions.sol";
import { ILayerZeroEndpointV2 } from "@layerzerolabs/lz-evm-protocol-v2/contracts/interfaces/ILayerZeroEndpointV2.sol";
import { Errors } from "@layerzerolabs/lz-evm-protocol-v2/contracts/libs/Errors.sol";
import {
    EnforcedOptionParam,
    IOAppOptionsType3
} from "@layerzerolabs/oapp-evm/contracts/oapp/interfaces/IOAppOptionsType3.sol";
import {
    IOFT,
    MessagingFee,
    MessagingReceipt,
    OFTReceipt,
    SendParam
} from "@layerzerolabs/oft-evm-contracts/contracts/interfaces/IOFT.sol";
import { MockERC20 } from "@layerzerolabs/test-utils-evm-contracts/contracts/mocks/MockERC20.sol";
import { Ownable } from "@openzeppelin/contracts/access/Ownable.sol";
import { IMultiHopComposer } from "./../../contracts/interfaces/IMultiHopComposer.sol";
import { MultiHopComposerMsgCodec } from "./../../contracts/libs/MultiHopComposerMsgCodec.sol";
import { MultiHopComposer } from "./../../contracts/MultiHopComposer.sol";
import {
    NativeOFTAdapterHarness,
    OFTAdapterHarness,
    OFTHarness,
    SharedDecimals8OFTAdapterHarness
} from "./harnesses/OFTHarnesses.sol";
import { GasHeavyOFT } from "./mocks/GasHeavyOFT.sol";
import { MockNonCompliantERC20, RawApprover } from "./mocks/MockNonCompliantERC20.sol";
import { NativeRejecter } from "./mocks/NativeRejecter.sol";
import { NestedDeliverer } from "./mocks/NestedDeliverer.sol";
import { MultiHopComposerTestBase } from "./shared/MultiHopComposerTestBase.sol";

contract MultiHopComposerTest is MultiHopComposerTestBase {
    function test_constructor() public view {
        address[] memory ofts = composer.getOFTs();

        assertEq(ofts.length, 2);
        assertEq(ofts[0], address(arbMeshA));
        assertEq(ofts[1], address(arbMeshB));

        assertTrue(composer.isOFT(address(arbMeshA)));
        assertTrue(composer.isOFT(address(arbMeshB)));
        assertFalse(composer.isOFT(address(ethMeshA)));

        assertEq(composer.TOKEN(), IOFT(arbMeshA).token());
        assertEq(composer.ENDPOINT(), arbEndpoint);
        assertEq(composer.nativeRefundRecipient(), nativeRefundRecipient);
        assertEq(composer.maxEnforcedMsgValue(), MAX_ENFORCED_MSG_VALUE);
        assertEq(composer.owner(), address(this));

        _assertApproval(composer, arbMeshA);
        _assertApproval(composer, arbMeshB);
    }

    function test_constructor_ArbitraryInitialOwner() public {
        address initialOwner = makeAddr("initialOwner");
        MultiHopComposer differentOwnerComposer = _newComposer(
            initialOwner,
            _addressArray(address(arbMeshA), address(arbMeshB)),
            nativeRefundRecipient,
            MAX_ENFORCED_MSG_VALUE
        );
        assertEq(differentOwnerComposer.owner(), initialOwner);
    }

    function test_constructor_ThreeOFTs() public {
        address[] memory ofts = new address[](3);
        ofts[0] = address(arbMeshA);
        ofts[1] = address(arbMeshB);
        ofts[2] = _deployHubOFT();

        MultiHopComposer hopComposer = _newComposer(address(this), ofts, nativeRefundRecipient, MAX_ENFORCED_MSG_VALUE);

        assertEq(hopComposer.getOFTs(), ofts);
        for (uint256 i; i < ofts.length; i++) {
            assertTrue(hopComposer.isOFT(ofts[i]));
            _assertApproval(hopComposer, ofts[i]);
        }
    }

    /// @dev Like Ethereum USDT, the token's approve() returns nothing: a plain IERC20 approve fails to decode that, while
    ///      the composer's forceApprove tolerates it.
    function test_constructor_NonCompliantERC20Approval() public virtual {
        MockNonCompliantERC20 usdt = new MockNonCompliantERC20();
        RawApprover raw = new RawApprover();

        vm.expectRevert(bytes(""));
        raw.approve(address(usdt), address(this), 1);

        assertEq(usdt.allowance(address(raw), address(this)), 0);

        OFTAdapterHarness meshA = new OFTAdapterHarness(address(usdt), arbEndpoint, address(this));
        OFTAdapterHarness meshB = new OFTAdapterHarness(address(usdt), arbEndpoint, address(this));
        MultiHopComposer hopComposer = _newComposer(
            address(this),
            _addressArray(address(meshA), address(meshB)),
            nativeRefundRecipient,
            MAX_ENFORCED_MSG_VALUE
        );

        assertEq(usdt.allowance(address(hopComposer), address(meshA)), type(uint256).max);
        assertEq(usdt.allowance(address(hopComposer), address(meshB)), type(uint256).max);
    }

    /// @dev The constructor emits the setters' events, so the deployment log holds the initial configuration.
    function test_constructor_ConfigEvents() public {
        address expectedComposer = vm.computeCreateAddress(address(this), vm.getNonce(address(this)));

        vm.expectEmit(true, true, true, true, expectedComposer);
        emit IMultiHopComposer.NativeRefundRecipientSet(nativeRefundRecipient);
        vm.expectEmit(true, true, true, true, expectedComposer);
        emit IMultiHopComposer.MaxEnforcedMsgValueSet(MAX_ENFORCED_MSG_VALUE);
        MultiHopComposer deployed = _newComposer(
            address(this),
            _addressArray(address(arbMeshA), address(arbMeshB)),
            nativeRefundRecipient,
            MAX_ENFORCED_MSG_VALUE
        );

        assertEq(address(deployed), expectedComposer);
    }

    function test_constructor_Revert_OwnableInvalidOwner() public {
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableInvalidOwner.selector, address(0)));
        _newComposer(
            address(0),
            _addressArray(address(arbMeshA), address(arbMeshB)),
            nativeRefundRecipient,
            MAX_ENFORCED_MSG_VALUE
        );
    }

    function test_constructor_Revert_EmptyOFTs() public {
        vm.expectRevert(abi.encodeWithSelector(IMultiHopComposer.InvalidOFT.selector, address(0)));
        _newComposer(address(this), _addressArray(), nativeRefundRecipient, MAX_ENFORCED_MSG_VALUE);
    }

    function test_constructor_Revert_InvalidNativeRefundRecipient() public {
        vm.expectRevert(IMultiHopComposer.InvalidNativeRefundRecipient.selector);
        _newComposer(
            address(this),
            _addressArray(address(arbMeshA), address(arbMeshB)),
            address(0),
            MAX_ENFORCED_MSG_VALUE
        );
    }

    function test_constructor_Revert_NativeToken() public virtual {
        address nativeOFT = address(new NativeOFTAdapterHarness(18, address(endpoints[ARB_EID]), address(this)));

        vm.expectRevert(IMultiHopComposer.NativeNotSupported.selector);
        _newComposer(address(this), _addressArray(nativeOFT), nativeRefundRecipient, MAX_ENFORCED_MSG_VALUE);
    }

    function test_constructor_Revert_ZeroAddressOFT() public {
        vm.expectRevert(abi.encodeWithSelector(IMultiHopComposer.InvalidOFT.selector, address(0)));
        _newComposer(
            address(this),
            _addressArray(address(arbMeshA), address(0)),
            nativeRefundRecipient,
            MAX_ENFORCED_MSG_VALUE
        );
    }

    function test_constructor_Revert_ZeroAddressFirstOFT() public {
        vm.expectRevert(abi.encodeWithSelector(IMultiHopComposer.InvalidOFT.selector, address(0)));
        _newComposer(
            address(this),
            _addressArray(address(0), address(arbMeshA)),
            nativeRefundRecipient,
            MAX_ENFORCED_MSG_VALUE
        );
    }

    function test_constructor_Revert_DuplicateOFTs() public {
        vm.expectRevert(abi.encodeWithSelector(IMultiHopComposer.InvalidOFT.selector, address(arbMeshA)));
        _newComposer(
            address(this),
            _addressArray(address(arbMeshA), address(arbMeshA)),
            nativeRefundRecipient,
            MAX_ENFORCED_MSG_VALUE
        );
    }

    function test_constructor_Revert_DifferentEndpoints() public {
        vm.expectRevert(IMultiHopComposer.DifferentEndpoints.selector);
        _newComposer(
            address(this),
            _addressArray(address(arbMeshA), address(ethMeshA)),
            nativeRefundRecipient,
            MAX_ENFORCED_MSG_VALUE
        );
    }

    function test_constructor_Revert_DifferentTokens() public virtual {
        address otherTokenOFT = address(
            new OFTAdapterHarness(address(ethToken), address(endpoints[ARB_EID]), address(this))
        );

        vm.expectRevert(IMultiHopComposer.DifferentTokens.selector);
        _newComposer(
            address(this),
            _addressArray(address(arbMeshA), otherTokenOFT),
            nativeRefundRecipient,
            MAX_ENFORCED_MSG_VALUE
        );
    }

    function test_constructor_Revert_DifferentTokens_NativeOFT() public virtual {
        address nativeOFT = address(new NativeOFTAdapterHarness(18, address(endpoints[ARB_EID]), address(this)));

        vm.expectRevert(IMultiHopComposer.DifferentTokens.selector);
        _newComposer(
            address(this),
            _addressArray(address(arbMeshA), nativeOFT),
            nativeRefundRecipient,
            MAX_ENFORCED_MSG_VALUE
        );
    }

    function test_lzCompose() public {
        _fundUserA(address(ethMeshA));

        _fullTrip(
            FullTripParams({
                oftASrcChain: address(ethMeshA),
                oftAHubChain: address(arbMeshA),
                composer: composer,
                oftBHubChain: address(arbMeshB),
                oftBDstChain: address(polMeshB)
            })
        );
    }

    function test_lzCompose_BurnMintToLockUnlock() public {
        _fundUserA(polMeshB);
        uint256 initialLockUnlockBalance = _balanceOf(arbMeshA, arbMeshA);

        _fullTrip(
            FullTripParams({
                oftASrcChain: address(polMeshB),
                oftAHubChain: address(arbMeshB),
                composer: composer,
                oftBHubChain: address(arbMeshA),
                oftBDstChain: address(ethMeshA)
            })
        );

        assertEq(
            _balanceOf(arbMeshA, arbMeshA) - initialLockUnlockBalance,
            TOKENS_TO_SEND,
            "the lock-unlock mesh should have taken custody of the tokens"
        );
    }

    function test_lzCompose_SingleMeshSameOFTOnBothSides() public {
        address ethMeshB = _isNative()
            ? _newNativeOFT(address(endpoints[ETH_EID]))
            : address(new OFTHarness("ethMeshB", "ethMeshB", address(endpoints[ETH_EID]), address(this)));
        vm.label(ethMeshB, "MeshB_eth");

        address[] memory meshB = new address[](3);
        meshB[0] = address(ethMeshB);
        meshB[1] = address(arbMeshB);
        meshB[2] = address(polMeshB);
        this.wireOApps(meshB);

        MultiHopComposer hopComposer = _newComposer(
            address(this),
            _addressArray(address(arbMeshB)),
            nativeRefundRecipient,
            MAX_ENFORCED_MSG_VALUE
        );
        vm.label(address(hopComposer), "SingleMeshComposer");

        _fundUserA(ethMeshB);

        _fullTrip(
            FullTripParams({
                oftASrcChain: address(ethMeshB),
                oftAHubChain: address(arbMeshB),
                composer: hopComposer,
                oftBHubChain: address(arbMeshB),
                oftBDstChain: address(polMeshB)
            })
        );
    }

    function test_lzCompose_LockUnlockToLockUnlock() public {
        (address arbMeshC, address polMeshC) = _deployMeshC(true);
        MultiHopComposer hopComposer = _deployComposer(address(arbMeshA), address(arbMeshC));
        _fundUserA(address(ethMeshA));

        _fullTrip(
            FullTripParams({
                oftASrcChain: address(ethMeshA),
                oftAHubChain: address(arbMeshA),
                composer: hopComposer,
                oftBHubChain: address(arbMeshC),
                oftBDstChain: address(polMeshC)
            })
        );

        assertEq(
            _balanceOf(arbMeshC, arbMeshC),
            TOKENS_TO_SEND,
            "the target lock-unlock mesh should hold the collateral"
        );
    }

    function test_lzCompose_DecodeFailed() public {
        bytes32 guid = _failDecode(composer);

        (uint256 amount, uint256 msgValue) = composer.undecodableMessages(guid);
        assertEq(amount, TOKENS_TO_SEND, "the received amount should be cached");
        assertEq(msgValue, LZ_COMPOSE_VALUE, "the compose value should be cached");

        (address oft, , address refundOFT, , ) = composer.failedMessages(guid);
        assertEq(oft, address(0), "an undecodable hop is not retryable");
        assertEq(refundOFT, address(0), "an undecodable hop is not refundable");
    }

    function test_lzCompose_DecodeFailed_LegacyPayload() public {
        bytes32 guid = _failDecode(composer, abi.encode(_secondLegSendParam(POL_EID, _secondLegOptions())));

        (uint256 amount, ) = composer.undecodableMessages(guid);
        assertEq(amount, TOKENS_TO_SEND, "the legacy payload should be cached for the owner's rescue");

        (address oft, , , , ) = composer.failedMessages(guid);
        assertEq(oft, address(0), "the legacy payload should not be recorded as a failed send");
    }

    /// @dev The onward amount comes from the compose header, so tokens stranded by earlier hops stay out of reach.
    function test_lzCompose_CannotSpendStrandedTokens() public {
        uint256 stranded = 5 * TOKENS_TO_SEND;
        _fund(arbMeshA, address(composer), stranded);

        SendParam memory secondLeg = _secondLegSendParam(POL_EID, _secondLegOptions());
        secondLeg.amountLD = stranded + TOKENS_TO_SEND;
        (SendParam memory sendParam, MessagingReceipt memory receipt) = _landFirstLeg(
            address(composer),
            _hop(address(arbMeshB), secondLeg),
            LZ_COMPOSE_VALUE
        );
        bytes memory composeMsg = _queuedComposeMsg(ETH_EID, sendParam, receipt);
        this.lzCompose(ARB_EID, address(arbMeshA), sendParam.extraOptions, receipt.guid, address(composer), composeMsg);

        assertEq(_balanceOf(arbMeshA, address(composer)), stranded, "only the received amount should have moved");
    }

    function test_lzCompose_SendFailed() public {
        SendParam memory secondLeg = _secondLegSendParam(BAD_EID, _secondLegOptions());
        secondLeg.amountLD = 2 * TOKENS_TO_SEND;
        bytes32 guid = _failSecondLeg(composer, address(arbMeshB), secondLeg, LZ_COMPOSE_VALUE);

        (
            address oft,
            SendParam memory sendParam,
            address refundOFT,
            SendParam memory refundSendParam,
            uint256 msgValue
        ) = composer.failedMessages(guid);

        assertEq(oft, address(arbMeshB));
        assertEq(sendParam.dstEid, BAD_EID);
        assertEq(sendParam.amountLD, TOKENS_TO_SEND, "the credited amount should override the payload's");
        assertEq(sendParam.minAmountLD, 0, "the second hop should have no slippage protection");
        assertEq(sendParam.extraOptions, _secondLegOptions());

        assertEq(refundOFT, address(arbMeshA), "the refund should go through the inbound OFT");
        assertEq(refundSendParam.dstEid, ETH_EID, "the refund should go back to the source chain");
        assertEq(refundSendParam.to, addressToBytes32(userA), "without refundTo, the refund should go to the sender");
        assertEq(refundSendParam.amountLD, TOKENS_TO_SEND);
        assertEq(refundSendParam.extraOptions.length, 0, "a refund should carry no options");

        assertEq(msgValue, LZ_COMPOSE_VALUE);
    }

    /// @dev An unregistered target is never called, so it cannot take the compose value.
    function test_lzCompose_SendFailed_UnregisteredOFT() public {
        SpoofOFT spoof = new SpoofOFT();
        bytes32 guid = _failSecondLeg(
            composer,
            address(spoof),
            _secondLegSendParam(POL_EID, _secondLegOptions()),
            LZ_COMPOSE_VALUE
        );

        assertEq(address(spoof).balance, 0);
        (address oft, , , , ) = composer.failedMessages(guid);
        assertEq(oft, address(spoof));
    }

    function test_lzCompose_SendFailed_RefundToOverridesComposeFrom() public {
        bytes32 guid = _failSecondLeg(
            composer,
            address(arbMeshB),
            _hop(address(arbMeshB), addressToBytes32(userB), _secondLegSendParam(BAD_EID, _secondLegOptions())),
            LZ_COMPOSE_VALUE
        );

        (, , , SendParam memory refundSendParam, ) = composer.failedMessages(guid);
        assertEq(refundSendParam.to, addressToBytes32(userB));
    }

    /// @dev The acknowledged scenario: the deliverer supplies too little gas for a gas-heavy OFT, so its `send` runs out of
    ///      gas while the EIP-150 remainder still records the failed message, which anyone can then refund.
    function test_lzCompose_SendFailed_GasHeavyOFTOutOfGas() public {
        GasHeavyOFT heavyOFT = new GasHeavyOFT(arbEndpoint, IOFT(arbMeshA).token(), HEAVY_SEND_GAS);
        MultiHopComposer hopComposer = _deployComposer(address(arbMeshA), address(heavyOFT));
        (SendParam memory sendParam, MessagingReceipt memory receipt) = _landFirstLeg(
            address(hopComposer),
            _hop(address(heavyOFT), _secondLegSendParam(POL_EID, _secondLegOptions())),
            LZ_COMPOSE_VALUE
        );
        bytes memory composeMsg = _queuedComposeMsg(ETH_EID, sendParam, receipt);

        vm.expectEmit(true, true, true, true, address(hopComposer));
        emit IMultiHopComposer.SendFailed(receipt.guid, address(heavyOFT));
        vm.prank(executor);
        ILayerZeroEndpointV2(arbEndpoint).lzCompose{ value: LZ_COMPOSE_VALUE, gas: HEAVY_SEND_GAS_SHORTFALL }(
            address(arbMeshA),
            address(hopComposer),
            receipt.guid,
            0,
            composeMsg,
            ""
        );

        (address oft, , , , ) = hopComposer.failedMessages(receipt.guid);
        assertEq(oft, address(heavyOFT), "the out-of-gas send should be recorded");
    }

    /// @dev The leftover never goes to the deliverer, so one that rejects native cannot make the send fail.
    function test_lzCompose_LeftoverToNativeRefundRecipient() public {
        SendParam memory secondLeg = _secondLegSendParam(POL_EID, _secondLegOptions());
        (SendParam memory sendParam, MessagingReceipt memory receipt) = _landFirstLeg(
            address(composer),
            _hop(address(arbMeshB), secondLeg),
            LZ_COMPOSE_VALUE
        );
        bytes memory composeMsg = _queuedComposeMsg(ETH_EID, sendParam, receipt);

        secondLeg.minAmountLD = 0;
        uint256 fee = IOFT(address(arbMeshB)).quoteSend(secondLeg, false).nativeFee;
        uint256 initialRecipientBalance = nativeRefundRecipient.balance;

        /// @dev Stands in for an EIP-7702 delegated EOA whose code rejects native.
        address deliverer = makeAddr("deliverer");
        vm.etch(deliverer, address(new NativeRejecter()).code);
        vm.deal(deliverer, LZ_COMPOSE_VALUE);

        vm.expectEmit(true, true, true, true, address(composer));
        emit IMultiHopComposer.Sent(receipt.guid, address(arbMeshB));
        vm.prank(deliverer, deliverer);
        ILayerZeroEndpointV2(arbEndpoint).lzCompose{ value: LZ_COMPOSE_VALUE }(
            address(arbMeshA),
            address(composer),
            receipt.guid,
            0,
            composeMsg,
            ""
        );

        assertEq(nativeRefundRecipient.balance - initialRecipientBalance, LZ_COMPOSE_VALUE - fee);
    }

    /// @dev An 8-decimal token hops from an OFT with 8 shared decimals into one with the default 6. The outbound OFT drops
    /// @dev the dust below its conversion rate, which stays in the composer with no record.
    function test_lzCompose_DifferentSharedDecimals() public virtual {
        MockERC20 token = new MockERC20(8);
        SharedDecimals8OFTAdapterHarness arbMesh8 = new SharedDecimals8OFTAdapterHarness(
            address(token),
            arbEndpoint,
            address(this)
        );
        OFTAdapterHarness arbMesh6 = new OFTAdapterHarness(address(token), arbEndpoint, address(this));
        MockERC20 polToken = new MockERC20(8);
        OFTAdapterHarness polMesh6 = new OFTAdapterHarness(
            address(polToken),
            address(endpoints[POL_EID]),
            address(this)
        );
        this.wireOApps(_addressArray(address(arbMesh6), address(polMesh6)));
        polToken.mint(address(polMesh6), INITIAL_BALANCE);
        MultiHopComposer hopComposer = _deployComposer(address(arbMesh8), address(arbMesh6));

        /// @dev Stands in for the 8-decimal mesh crediting the composer with an amount that has dust for the 6-decimal one,
        ///      whose conversion rate is 100.
        uint256 dust = 99;
        uint256 amount = TOKENS_TO_SEND + dust;
        token.mint(address(hopComposer), amount);
        bytes memory composeMsg = _createComposePayload(
            1,
            ETH_EID,
            _hop(address(arbMesh6), _secondLegSendParam(POL_EID, _secondLegOptions())),
            amount,
            userA
        );
        bytes32 guid = _randomGUID();
        vm.prank(address(arbMesh8));
        ILayerZeroEndpointV2(arbEndpoint).sendCompose(address(hopComposer), guid, 0, composeMsg);

        vm.expectEmit(true, true, true, true, address(hopComposer));
        emit IMultiHopComposer.Sent(guid, address(arbMesh6));
        vm.prank(executor);
        ILayerZeroEndpointV2(arbEndpoint).lzCompose{ value: LZ_COMPOSE_VALUE }(
            address(arbMesh8),
            address(hopComposer),
            guid,
            0,
            composeMsg,
            ""
        );

        verifyPackets(POL_EID, addressToBytes32(address(polMesh6)));
        assertEq(polToken.balanceOf(userA), TOKENS_TO_SEND, "the recipient should receive the amount without dust");
        assertEq(token.balanceOf(address(hopComposer)), dust, "the dust should stay in the composer");
    }

    /// @dev A cap at or below the delivered value lets a compose committing a higher minimum through, zero included.
    function test_lzCompose_Fuzz_MaxEnforcedMsgValue(uint256 _maxEnforcedMsgValue) public {
        _maxEnforcedMsgValue = bound(_maxEnforcedMsgValue, 0, LZ_COMPOSE_VALUE);
        composer.setMaxEnforcedMsgValue(_maxEnforcedMsgValue);
        (SendParam memory sendParam, MessagingReceipt memory receipt) = _landFirstLeg(
            address(composer),
            _hop(address(arbMeshB), bytes32(0), MIN_MSG_VALUE, _secondLegSendParam(POL_EID, _secondLegOptions())),
            LZ_COMPOSE_VALUE
        );
        bytes memory composeMsg = _queuedComposeMsg(ETH_EID, sendParam, receipt);

        vm.expectEmit(true, true, true, true, address(composer));
        emit IMultiHopComposer.Sent(receipt.guid, address(arbMeshB));
        this.lzCompose(ARB_EID, address(arbMeshA), sendParam.extraOptions, receipt.guid, address(composer), composeMsg);
    }

    function test_lzCompose_Revert_OnlyEndpoint() public {
        vm.expectRevert(abi.encodeWithSelector(IMultiHopComposer.OnlyEndpoint.selector, address(this)));
        composer.lzCompose(address(arbMeshA), _randomGUID(), "", userA, "");
    }

    /// @dev The compose is not consumed, so the executor can deliver it again, here with exactly the minimum.
    function test_lzCompose_Revert_InsufficientMsgValue() public {
        (SendParam memory sendParam, MessagingReceipt memory receipt) = _landFirstLeg(
            address(composer),
            _hop(address(arbMeshB), bytes32(0), MIN_MSG_VALUE, _secondLegSendParam(POL_EID, _secondLegOptions())),
            LZ_COMPOSE_VALUE
        );
        bytes memory composeMsg = _queuedComposeMsg(ETH_EID, sendParam, receipt);

        vm.expectRevert(
            abi.encodeWithSelector(IMultiHopComposer.InsufficientMsgValue.selector, MIN_MSG_VALUE, LZ_COMPOSE_VALUE)
        );
        this.lzCompose(ARB_EID, address(arbMeshA), sendParam.extraOptions, receipt.guid, address(composer), composeMsg);

        vm.expectEmit(true, true, true, true, address(composer));
        emit IMultiHopComposer.Sent(receipt.guid, address(arbMeshB));
        vm.prank(executor);
        ILayerZeroEndpointV2(arbEndpoint).lzCompose{ value: MIN_MSG_VALUE }(
            address(arbMeshA),
            address(composer),
            receipt.guid,
            0,
            composeMsg,
            ""
        );

        _verifyLanded(polMeshB, TOKENS_TO_SEND);
    }

    /// @dev A minimum too high to ever pay is capped, so the compose can still be delivered with the cap.
    function test_lzCompose_Revert_InsufficientMsgValue_AboveMaxEnforcedMsgValue() public {
        (SendParam memory sendParam, MessagingReceipt memory receipt) = _landFirstLeg(
            address(composer),
            _hop(address(arbMeshB), bytes32(0), type(uint256).max, _secondLegSendParam(POL_EID, _secondLegOptions())),
            LZ_COMPOSE_VALUE
        );
        bytes memory composeMsg = _queuedComposeMsg(ETH_EID, sendParam, receipt);

        vm.expectRevert(
            abi.encodeWithSelector(
                IMultiHopComposer.InsufficientMsgValue.selector,
                MAX_ENFORCED_MSG_VALUE,
                LZ_COMPOSE_VALUE
            )
        );
        this.lzCompose(ARB_EID, address(arbMeshA), sendParam.extraOptions, receipt.guid, address(composer), composeMsg);

        vm.expectEmit(true, true, true, true, address(composer));
        emit IMultiHopComposer.Sent(receipt.guid, address(arbMeshB));
        vm.deal(executor, MAX_ENFORCED_MSG_VALUE);
        vm.prank(executor);
        ILayerZeroEndpointV2(arbEndpoint).lzCompose{ value: MAX_ENFORCED_MSG_VALUE }(
            address(arbMeshA),
            address(composer),
            receipt.guid,
            0,
            composeMsg,
            ""
        );
    }

    /// @dev The whole compose reverts and stays queued, so it can be delivered again with enough gas.
    function test_lzCompose_Revert_OutOfGas() public {
        (SendParam memory sendParam, MessagingReceipt memory receipt) = _landFirstLeg(
            address(composer),
            _hop(address(arbMeshB), _secondLegSendParam(POL_EID, _secondLegOptions())),
            LZ_COMPOSE_VALUE
        );
        bytes memory composeMsg = _queuedComposeMsg(ETH_EID, sendParam, receipt);

        /// @dev Once in the delivery that runs out of gas, and once in the re-delivery.
        vm.expectCall(address(arbMeshB), abi.encodeWithSelector(IOFT.send.selector), 2);
        vm.expectRevert(bytes(""));
        vm.prank(executor);
        ILayerZeroEndpointV2(arbEndpoint).lzCompose{ value: LZ_COMPOSE_VALUE, gas: LOW_COMPOSE_GAS }(
            address(arbMeshA),
            address(composer),
            receipt.guid,
            0,
            composeMsg,
            ""
        );

        vm.expectEmit(true, true, true, true, address(composer));
        emit IMultiHopComposer.Sent(receipt.guid, address(arbMeshB));
        this.lzCompose(ARB_EID, address(arbMeshA), sendParam.extraOptions, receipt.guid, address(composer), composeMsg);

        _verifyLanded(polMeshB, TOKENS_TO_SEND);
    }

    /// @dev Delivered from inside another endpoint send, the compose reverts instead of recording a refundable failure.
    function test_lzCompose_Revert_SendReentrancy() public {
        (SendParam memory sendParam, MessagingReceipt memory receipt) = _landFirstLeg(
            address(composer),
            _hop(address(arbMeshB), _secondLegSendParam(POL_EID, _secondLegOptions())),
            LZ_COMPOSE_VALUE
        );
        bytes memory composeMsg = _queuedComposeMsg(ETH_EID, sendParam, receipt);

        NestedDeliverer deliverer = new NestedDeliverer(arbEndpoint);
        vm.deal(address(deliverer), LZ_COMPOSE_VALUE);
        deliverer.deliverDuringSend{ value: 1 ether }(
            address(arbMeshA),
            address(composer),
            receipt.guid,
            composeMsg,
            LZ_COMPOSE_VALUE,
            POL_EID,
            _secondLegOptions()
        );

        assertEq(deliverer.composeRevert(), abi.encodeWithSelector(Errors.LZ_SendReentrancy.selector));

        vm.expectEmit(true, true, true, true, address(composer));
        emit IMultiHopComposer.Sent(receipt.guid, address(arbMeshB));
        this.lzCompose(ARB_EID, address(arbMeshA), sendParam.extraOptions, receipt.guid, address(composer), composeMsg);
    }

    /// @dev Any address can queue a compose to the composer, which only accepts those from registered OFTs.
    function test_lzCompose_Fuzz_Revert_OnlyOFT(address _oft) public {
        vm.assume(!composer.isOFT(_oft));
        assumeNotForgeAddress(_oft);
        bytes32 guid = _randomGUID();

        vm.prank(_oft);
        ILayerZeroEndpointV2(arbEndpoint).sendCompose(address(composer), guid, 0, "");

        vm.expectRevert(abi.encodeWithSelector(IMultiHopComposer.OnlyOFT.selector, _oft));
        vm.prank(executor);
        ILayerZeroEndpointV2(arbEndpoint).lzCompose(_oft, address(composer), guid, 0, "", "");
    }

    function test_lzCompose_Fuzz_Revert_InsufficientMsgValue(
        uint256 _minMsgValue,
        uint256 _maxEnforcedMsgValue,
        uint256 _msgValue
    ) public {
        _minMsgValue = bound(_minMsgValue, 1, type(uint256).max);
        _maxEnforcedMsgValue = bound(_maxEnforcedMsgValue, 1, type(uint128).max);
        uint256 enforcedMsgValue = _minMsgValue < _maxEnforcedMsgValue ? _minMsgValue : _maxEnforcedMsgValue;
        _msgValue = bound(_msgValue, 0, enforcedMsgValue - 1);
        composer.setMaxEnforcedMsgValue(_maxEnforcedMsgValue);
        (SendParam memory sendParam, MessagingReceipt memory receipt) = _landFirstLeg(
            address(composer),
            _hop(address(arbMeshB), bytes32(0), _minMsgValue, _secondLegSendParam(POL_EID, _secondLegOptions())),
            LZ_COMPOSE_VALUE
        );
        bytes memory composeMsg = _queuedComposeMsg(ETH_EID, sendParam, receipt);

        vm.expectRevert(
            abi.encodeWithSelector(IMultiHopComposer.InsufficientMsgValue.selector, enforcedMsgValue, _msgValue)
        );
        vm.deal(executor, _msgValue);
        vm.prank(executor);
        ILayerZeroEndpointV2(arbEndpoint).lzCompose{ value: _msgValue }(
            address(arbMeshA),
            address(composer),
            receipt.guid,
            0,
            composeMsg,
            ""
        );
    }

    /// @dev The hop failed on too little compose value. The retry tops it up and the excess goes back to `tx.origin`.
    function test_retry() public {
        SendParam memory secondLeg = _secondLegSendParam(POL_EID, _secondLegOptions());
        bytes32 guid = _failSecondLeg(composer, address(arbMeshB), secondLeg, 1 wei);

        /// @dev The composer zeroes the minimum amount, so quote the send the same way.
        secondLeg.minAmountLD = 0;
        uint256 fee = IOFT(address(arbMeshB)).quoteSend(secondLeg, false).nativeFee;
        uint256 initialBalance = userB.balance;

        vm.expectEmit(true, true, true, true, address(composer));
        emit IMultiHopComposer.Retried(guid, address(arbMeshB));
        vm.prank(userB, userB);
        composer.retry{ value: 1 ether }(guid);

        assertEq(userB.balance, initialBalance + 1 wei - fee, "the excess native should go back to tx.origin");

        (address oft, , , , ) = composer.failedMessages(guid);
        assertEq(oft, address(0), "the retry should clear the record");
        assertEq(address(composer).balance, 0, "the cached value should have been spent");

        _verifyLanded(polMeshB, TOKENS_TO_SEND);
    }

    /// @dev Neither the message nor the OFT provides options.
    function test_retry_EmptyOptionsAfterOFTUpdates() public {
        (address arbMeshC, address polMeshC) = _deployMeshC(true);
        MultiHopComposer hopComposer = _deployComposer(address(arbMeshA), address(arbMeshC));
        bytes32 guid = _failSecondLeg(
            hopComposer,
            address(arbMeshC),
            _secondLegSendParam(POL_EID, ""),
            LZ_COMPOSE_VALUE
        );

        EnforcedOptionParam[] memory enforcedOptions = new EnforcedOptionParam[](1);
        enforcedOptions[0] = EnforcedOptionParam({ eid: POL_EID, msgType: 1, options: lzReceiveOptions });
        IOAppOptionsType3(arbMeshC).setEnforcedOptions(enforcedOptions);

        vm.expectEmit(true, true, true, true, address(hopComposer));
        emit IMultiHopComposer.Retried(guid, address(arbMeshC));
        hopComposer.retry(guid);

        _verifyLanded(polMeshC, TOKENS_TO_SEND);
    }

    function test_retry_NonPeeredAfterOFTUpdates() public {
        (address arbMeshC, address polMeshC) = _deployMeshC(false);
        MultiHopComposer hopComposer = _deployComposer(address(arbMeshA), address(arbMeshC));
        bytes32 guid = _failSecondLeg(
            hopComposer,
            address(arbMeshC),
            _secondLegSendParam(POL_EID, _secondLegOptions()),
            LZ_COMPOSE_VALUE
        );

        this.wireOApps(_addressArray(address(arbMeshC), address(polMeshC)));

        vm.expectEmit(true, true, true, true, address(hopComposer));
        emit IMultiHopComposer.Retried(guid, address(arbMeshC));
        hopComposer.retry(guid);

        _verifyLanded(polMeshC, TOKENS_TO_SEND);
    }

    /// @dev The retry spends only its own hop's cached value, so another hop's tokens and value stay.
    function test_retry_LeavesOtherCredit() public {
        bytes32 undecodable = _failDecode(composer);
        bytes32 failed = _failSecondLeg(
            composer,
            address(arbMeshB),
            _secondLegSendParam(POL_EID, _secondLegOptions()),
            1 wei
        );

        vm.prank(userB, userB);
        composer.retry{ value: 1 ether }(failed);

        _assertHeld(
            address(composer),
            TOKENS_TO_SEND,
            LZ_COMPOSE_VALUE,
            "the undecodable hop's tokens and value should stay"
        );
        _verifyLanded(polMeshB, TOKENS_TO_SEND);

        composer.rescue(undecodable, makeAddr("rescueTo"));

        _assertHeld(address(composer), 0, 0, "the rescue should take the tokens and the value");
    }

    function test_retry_Revert_UnknownGuid() public {
        vm.expectRevert(abi.encodeWithSelector(IMultiHopComposer.InvalidSendParam.selector, _emptySendParam()));
        composer.retry(_randomGUID());
    }

    function test_retry_Revert_Undecodable() public {
        bytes32 guid = _failDecode(composer);

        vm.expectRevert(abi.encodeWithSelector(IMultiHopComposer.InvalidSendParam.selector, _emptySendParam()));
        composer.retry(guid);
    }

    function test_retry_Revert_AlreadyRefunded() public {
        bytes32 guid = _failSecondLeg(
            composer,
            address(arbMeshB),
            _secondLegSendParam(POL_EID, _secondLegOptions()),
            1 wei
        );
        composer.refund{ value: 1 ether }(guid);

        vm.expectRevert(abi.encodeWithSelector(IMultiHopComposer.InvalidSendParam.selector, _emptySendParam()));
        composer.retry{ value: 1 ether }(guid);
    }

    function test_retry_Revert_UnregisteredOFT() public {
        SpoofOFT spoof = new SpoofOFT();
        bytes32 guid = _failSecondLeg(
            composer,
            address(spoof),
            _secondLegSendParam(POL_EID, _secondLegOptions()),
            LZ_COMPOSE_VALUE
        );

        vm.expectRevert(abi.encodeWithSelector(IMultiHopComposer.InvalidOFT.selector, address(spoof)));
        composer.retry{ value: 1 ether }(guid);
    }

    function test_retry_Revert_InsufficientFee() public {
        SendParam memory secondLeg = _secondLegSendParam(POL_EID, _secondLegOptions());
        bytes32 guid = _failSecondLeg(composer, address(arbMeshB), secondLeg, 1 wei);

        secondLeg.minAmountLD = 0;
        MessagingFee memory fee = IOFT(address(arbMeshB)).quoteSend(secondLeg, false);

        vm.expectRevert(abi.encodeWithSelector(Errors.LZ_InsufficientFee.selector, fee.nativeFee, 1 wei, 0, 0));
        composer.retry(guid);
    }

    function test_refund() public {
        bytes32 guid = _failSecondLeg(
            composer,
            address(arbMeshB),
            _secondLegSendParam(POL_EID, _secondLegOptions()),
            1 wei
        );

        _refundAndLand(composer, guid, address(arbMeshA), address(ethMeshA));
    }

    function test_refund_EmptyOptions() public {
        (address arbMeshC, ) = _deployMeshC(true);
        MultiHopComposer hopComposer = _deployComposer(address(arbMeshA), address(arbMeshC));
        bytes32 guid = _failSecondLeg(
            hopComposer,
            address(arbMeshC),
            _secondLegSendParam(POL_EID, ""),
            LZ_COMPOSE_VALUE
        );

        _refundAndLand(hopComposer, guid, address(arbMeshA), address(ethMeshA));
    }

    function test_refund_NonPeered() public {
        (address arbMeshC, ) = _deployMeshC(false);
        MultiHopComposer hopComposer = _deployComposer(address(arbMeshA), address(arbMeshC));
        bytes32 guid = _failSecondLeg(
            hopComposer,
            address(arbMeshC),
            _secondLegSendParam(POL_EID, _secondLegOptions()),
            LZ_COMPOSE_VALUE
        );

        _refundAndLand(hopComposer, guid, address(arbMeshA), address(ethMeshA));
    }

    /// @dev Malformed options fail on every attempt, so the hop can only be refunded.
    function test_refund_MalformedOptions() public {
        bytes memory malformedOptions = hex"0001";
        bytes32 guid = _failSecondLeg(
            composer,
            address(arbMeshB),
            _secondLegSendParam(POL_EID, malformedOptions),
            LZ_COMPOSE_VALUE
        );

        vm.expectRevert(abi.encodeWithSelector(IOAppOptionsType3.InvalidOptions.selector, malformedOptions));
        composer.retry(guid);

        _refundAndLand(composer, guid, address(arbMeshA), address(ethMeshA));
    }

    function test_refund_UnregisteredOFT() public {
        address unregistered = _deployHubOFT();
        bytes32 guid = _failSecondLeg(
            composer,
            address(unregistered),
            _secondLegSendParam(POL_EID, _secondLegOptions()),
            LZ_COMPOSE_VALUE
        );

        _refundAndLand(composer, guid, address(arbMeshA), address(ethMeshA));
    }

    /// @dev Refunds carry no options of their own, so they fail until the inbound OFT enforces some.
    function test_refund_EmptyRefundOptionsAfterOFTUpdates() public {
        (address ethMeshD, address arbMeshD) = _deployMeshD();
        MultiHopComposer hopComposer = _deployComposer(address(arbMeshD), address(arbMeshB));

        bytes32 guid = _failSecondLeg(
            hopComposer,
            address(ethMeshD),
            address(arbMeshD),
            address(arbMeshB),
            _hop(address(arbMeshB), _secondLegSendParam(BAD_EID, _secondLegOptions())),
            LZ_COMPOSE_VALUE
        );

        /// @dev The ULN rejects empty options.
        vm.expectRevert(abi.encodeWithSelector(UlnOptions.LZ_ULN_InvalidWorkerOptions.selector, 0));
        hopComposer.refund{ value: 1 ether }(guid);

        EnforcedOptionParam[] memory enforcedOptions = new EnforcedOptionParam[](1);
        enforcedOptions[0] = EnforcedOptionParam({ eid: ETH_EID, msgType: 1, options: lzReceiveOptions });
        IOAppOptionsType3(arbMeshD).setEnforcedOptions(enforcedOptions);

        _refundAndLand(hopComposer, guid, address(arbMeshD), address(ethMeshD));
    }

    /// @dev The refund spends only its own hop's cached value, so another hop's tokens and value stay.
    function test_refund_LeavesOtherCredit() public {
        bytes32 undecodable = _failDecode(composer);
        bytes32 failed = _failSecondLeg(
            composer,
            address(arbMeshB),
            _secondLegSendParam(BAD_EID, _secondLegOptions()),
            LZ_COMPOSE_VALUE
        );

        _refundAndLand(composer, failed, address(arbMeshA), address(ethMeshA));

        _assertHeld(
            address(composer),
            TOKENS_TO_SEND,
            LZ_COMPOSE_VALUE,
            "the undecodable hop's tokens and value should stay"
        );

        composer.rescue(undecodable, makeAddr("rescueTo"));

        _assertHeld(address(composer), 0, 0, "the rescue should take the tokens and the value");
    }

    function test_refund_Revert_UnknownGuid() public {
        vm.expectRevert(abi.encodeWithSelector(IMultiHopComposer.InvalidSendParam.selector, _emptySendParam()));
        composer.refund(_randomGUID());
    }

    function test_refund_Revert_Undecodable() public {
        bytes32 guid = _failDecode(composer);

        vm.expectRevert(abi.encodeWithSelector(IMultiHopComposer.InvalidSendParam.selector, _emptySendParam()));
        composer.refund(guid);
    }

    function test_refund_Revert_AlreadyRetried() public {
        bytes32 guid = _failSecondLeg(
            composer,
            address(arbMeshB),
            _secondLegSendParam(POL_EID, _secondLegOptions()),
            1 wei
        );
        composer.retry{ value: 1 ether }(guid);

        vm.expectRevert(abi.encodeWithSelector(IMultiHopComposer.InvalidSendParam.selector, _emptySendParam()));
        composer.refund{ value: 1 ether }(guid);
    }

    function test_rescue() public {
        bytes32 guid = _failDecode(composer);
        address rescueTo = makeAddr("rescueTo");

        vm.expectEmit(true, true, true, true, address(composer));
        emit IMultiHopComposer.Rescued(guid, rescueTo, TOKENS_TO_SEND, LZ_COMPOSE_VALUE);
        composer.rescue(guid, rescueTo);

        _assertHeld(rescueTo, TOKENS_TO_SEND, LZ_COMPOSE_VALUE, "the rescue should pay the tokens and the value");

        (uint256 amount, uint256 value) = composer.undecodableMessages(guid);
        assertEq(amount, 0, "the rescue should clear the record");
        assertEq(value, 0, "the rescue should clear the record");
    }

    function test_rescue_LeavesOtherCredit() public {
        bytes32 undecodable = _failDecode(composer);
        bytes32 failed = _failSecondLeg(
            composer,
            address(arbMeshB),
            _secondLegSendParam(BAD_EID, _secondLegOptions()),
            LZ_COMPOSE_VALUE
        );

        composer.rescue(undecodable, makeAddr("rescueTo"));

        _assertHeld(
            address(composer),
            TOKENS_TO_SEND,
            LZ_COMPOSE_VALUE,
            "the failed hop's tokens and value should stay"
        );

        _refundAndLand(composer, failed, address(arbMeshA), address(ethMeshA));

        _assertHeld(address(composer), 0, 0, "the refund should take the tokens and the value");
    }

    function test_rescue_Revert_OnlyOwner() public {
        bytes32 guid = _failDecode(composer);

        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, userA));
        vm.prank(userA);
        composer.rescue(guid, userA);
    }

    function test_rescue_Revert_InvalidRescueRecipient() public {
        bytes32 guid = _failDecode(composer);

        vm.expectRevert(IMultiHopComposer.InvalidRescueRecipient.selector);
        composer.rescue(guid, address(0));
    }

    /// @dev A hop that failed to send is recovered through retry() or refund(), never rescue().
    function test_rescue_Revert_SendFailed() public {
        bytes32 guid = _failSecondLeg(
            composer,
            address(arbMeshB),
            _secondLegSendParam(BAD_EID, _secondLegOptions()),
            LZ_COMPOSE_VALUE
        );

        vm.expectRevert(abi.encodeWithSelector(IMultiHopComposer.NothingToRescue.selector, guid));
        composer.rescue(guid, userA);
    }

    function test_rescue_Revert_AlreadyRescued() public {
        bytes32 guid = _failDecode(composer);
        composer.rescue(guid, userA);

        vm.expectRevert(abi.encodeWithSelector(IMultiHopComposer.NothingToRescue.selector, guid));
        composer.rescue(guid, userA);
    }

    function test_rescue_Revert_NativeTransferFailed() public {
        bytes32 guid = _failDecode(composer);
        NativeRejecter rejecter = new NativeRejecter();

        vm.expectRevert(IMultiHopComposer.NativeTransferFailed.selector);
        composer.rescue(guid, address(rejecter));
    }

    function test_setNativeRefundRecipient() public {
        address next = makeAddr("next");

        vm.expectEmit(true, true, true, true, address(composer));
        emit IMultiHopComposer.NativeRefundRecipientSet(next);
        composer.setNativeRefundRecipient(next);

        assertEq(composer.nativeRefundRecipient(), next);
    }

    function test_setNativeRefundRecipient_Revert_OnlyOwner() public {
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, userA));
        vm.prank(userA);
        composer.setNativeRefundRecipient(makeAddr("next"));
    }

    function test_setNativeRefundRecipient_Revert_InvalidNativeRefundRecipient() public {
        vm.expectRevert(IMultiHopComposer.InvalidNativeRefundRecipient.selector);
        composer.setNativeRefundRecipient(address(0));
    }

    function test_setMaxEnforcedMsgValue() public {
        vm.expectEmit(true, true, true, true, address(composer));
        emit IMultiHopComposer.MaxEnforcedMsgValueSet(LZ_COMPOSE_VALUE);
        composer.setMaxEnforcedMsgValue(LZ_COMPOSE_VALUE);

        assertEq(composer.maxEnforcedMsgValue(), LZ_COMPOSE_VALUE);
    }

    function test_setMaxEnforcedMsgValue_Revert_OnlyOwner() public {
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, userA));
        vm.prank(userA);
        composer.setMaxEnforcedMsgValue(LZ_COMPOSE_VALUE);
    }

    function test_renounceOwnership_Revert_CannotRenounceOwnership() public {
        vm.expectRevert(IMultiHopComposer.CannotRenounceOwnership.selector);
        composer.renounceOwnership();
    }

    function test_renounceOwnership_Revert_OnlyOwner() public {
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, userA));
        vm.prank(userA);
        composer.renounceOwnership();
    }

    function test_decode() public view {
        SendParam memory sendParam = SendParam(POL_EID, addressToBytes32(userB), 1, 0, _secondLegOptions(), "", "");

        (SendParam memory decoded, address oft, bytes32 refundTo, uint256 minMsgValue) = composer.decode(
            _hop(address(arbMeshB), addressToBytes32(userA), 123, sendParam)
        );

        assertEq(abi.encode(decoded), abi.encode(sendParam));
        assertEq(oft, address(arbMeshB));
        assertEq(refundTo, addressToBytes32(userA));
        assertEq(minMsgValue, 123);
    }

    function test_decode_Revert_Malformed() public {
        vm.expectRevert(MultiHopComposerMsgCodec.InvalidMessage.selector);
        composer.decode(bytes("malformed"));
    }

    function test_send_Revert_OnlySelf() public {
        vm.expectRevert(abi.encodeWithSelector(IMultiHopComposer.OnlySelf.selector, address(this)));
        composer.send(address(arbMeshA), SendParam(ETH_EID, bytes32(0), 0, 0, "", "", ""));
    }
}

/// @dev Accepts the OFT `send` call and keeps the native value, so a missed registration check is observable.
contract SpoofOFT {
    function send(
        SendParam calldata,
        MessagingFee calldata,
        address
    ) external payable returns (MessagingReceipt memory, OFTReceipt memory) {}
}
