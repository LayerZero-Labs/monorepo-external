// SPDX-License-Identifier: MIT
pragma solidity ^0.8.22;

import {
    SetDefaultUlnConfigParam,
    UlnBase,
    UlnConfig
} from "@layerzerolabs/lz-evm-messagelib-v2/contracts/uln/UlnBase.sol";
import {
    ILayerZeroEndpointV2,
    MessagingReceipt
} from "@layerzerolabs/lz-evm-protocol-v2/contracts/interfaces/ILayerZeroEndpointV2.sol";
import { SendParam } from "@layerzerolabs/oft-evm-contracts/contracts/interfaces/IOFT.sol";
import { DVNFeeLibMock } from "@layerzerolabs/test-devtools-evm-foundry/contracts/mocks/DVNFeeLibMock.sol";
import { DVNMock, IDVN } from "@layerzerolabs/test-devtools-evm-foundry/contracts/mocks/DVNMock.sol";
import { MockERC20 } from "@layerzerolabs/test-utils-evm-contracts/contracts/mocks/MockERC20.sol";
import { IMultiHopComposer } from "./../../contracts/interfaces/IMultiHopComposer.sol";
import { MultiHopComposer } from "./../../contracts/MultiHopComposer.sol";
import { MultiHopComposerNative } from "./../../contracts/MultiHopComposerNative.sol";
import {
    OFTAdapterHarness,
    RateLimitedNativeOFTAdapterHarness,
    RateLimitedOFTAdapterHarness
} from "./harnesses/OFTHarnesses.sol";
import { MultiHopComposerTestBase } from "./shared/MultiHopComposerTestBase.sol";

/**
 * @notice Gas snapshots of the paths that complete, written to `generated/snapshots/<_group()>.json`.
 * @dev A suite for another OFT kind inherits this contract and overrides `_oftKind` and `_group`.
 * @dev Each test sets up its state and snapshots exactly one call, so the numbers stay comparable across changes.
 * @dev Relative numbers only: non-IR build, TestHelperOz5 mocks (the send library stores each packet in the test
 *      contract), empty worker fee balances, and setup in the same transaction. Compare against the previous snapshot;
 *      do not size gas options or fees from them.
 */
contract MultiHopComposerGasTest is MultiHopComposerTestBase {
    /// @dev Required DVNs on the hub's sends, so the snapshots include quoting and paying five workers.
    uint256 internal constant DVN_COUNT = 5;

    function setUp() public override {
        super.setUp();
        _requireDVNs(POL_EID);
        _requireDVNs(ETH_EID);
    }

    /// @dev A deployment is not a call, so it is metered between start and stop instead.
    /// @dev The kind is chosen outside the metered window, so the snapshot holds the deployment only.
    function test_constructor() public {
        if (_isNative()) {
            vm.startSnapshotGas(_group(), "constructor");
            new MultiHopComposerNative(
                address(this),
                _addressArray(address(arbMeshA), address(arbMeshB)),
                nativeRefundRecipient,
                MAX_ENFORCED_MSG_VALUE
            );
            vm.stopSnapshotGas();
        } else {
            vm.startSnapshotGas(_group(), "constructor");
            new MultiHopComposer(
                address(this),
                _addressArray(address(arbMeshA), address(arbMeshB)),
                nativeRefundRecipient,
                MAX_ENFORCED_MSG_VALUE
            );
            vm.stopSnapshotGas();
        }
    }

    function test_lzCompose() public {
        (bytes32 guid, bytes memory composeMsg) = _landCompose(
            composer,
            _hop(address(arbMeshB), _secondLegSendParam(POL_EID, _secondLegOptions()))
        );
        vm.expectEmit(true, true, true, true, address(composer));
        emit IMultiHopComposer.Sent(guid, address(arbMeshB));
        _deliver(composer, guid, composeMsg);
        vm.snapshotGasLastCall(_group(), "lzCompose");
    }

    function test_lzCompose_DecodeFailed() public {
        (bytes32 guid, bytes memory composeMsg) = _landCompose(composer, bytes("malformed"));
        vm.expectEmit(true, true, true, true, address(composer));
        emit IMultiHopComposer.DecodeFailed(guid, bytes("malformed"));
        _deliver(composer, guid, composeMsg);
        vm.snapshotGasLastCall(_group(), "lzCompose_DecodeFailed");
    }

    function test_lzCompose_SendFailed_NonPeered() public {
        (bytes32 guid, bytes memory composeMsg) = _landCompose(
            composer,
            _hop(address(arbMeshB), _secondLegSendParam(BAD_EID, _secondLegOptions()))
        );
        vm.expectEmit(true, true, true, true, address(composer));
        emit IMultiHopComposer.SendFailed(guid, address(arbMeshB));
        _deliver(composer, guid, composeMsg);
        vm.snapshotGasLastCall(_group(), "lzCompose_SendFailed_NonPeered");
    }

    /// @dev `send` rejects the unregistered OFT before calling it, the cheapest failure to record.
    function test_lzCompose_SendFailed_UnregisteredOFT() public {
        address unregisteredOFT = makeAddr("unregisteredOFT");
        (bytes32 guid, bytes memory composeMsg) = _landCompose(
            composer,
            _hop(unregisteredOFT, _secondLegSendParam(POL_EID, _secondLegOptions()))
        );
        vm.expectEmit(true, true, true, true, address(composer));
        emit IMultiHopComposer.SendFailed(guid, unregisteredOFT);
        _deliver(composer, guid, composeMsg);
        vm.snapshotGasLastCall(_group(), "lzCompose_SendFailed_UnregisteredOFT");
    }

    /// @dev The outbound OFT rate-limits the destination, so its debit rejects the send while its quote still succeeds.
    function test_lzCompose_SendFailed_RateLimited() public {
        (address arbMeshR, address polMeshR) = _deployRateLimitedMesh();
        this.wireOApps(_addressArray(address(arbMeshR), address(polMeshR)));
        MultiHopComposer hopComposer = _deployComposer(address(arbMeshA), address(arbMeshR));
        (bytes32 guid, bytes memory composeMsg) = _landCompose(
            hopComposer,
            _hop(address(arbMeshR), _secondLegSendParam(POL_EID, _secondLegOptions()))
        );
        vm.expectEmit(true, true, true, true, address(hopComposer));
        emit IMultiHopComposer.SendFailed(guid, address(arbMeshR));
        _deliver(hopComposer, guid, composeMsg);
        vm.snapshotGasLastCall(_group(), "lzCompose_SendFailed_RateLimited");
    }

    /// @dev The endpoint rejects the fee only after every worker has been assigned, the most expensive send failure.
    function test_lzCompose_SendFailed_InsufficientFee() public {
        (bytes32 guid, bytes memory composeMsg) = _landCompose(
            composer,
            _hop(address(arbMeshB), _secondLegSendParam(POL_EID, _secondLegOptions()))
        );
        vm.expectEmit(true, true, true, true, address(composer));
        emit IMultiHopComposer.SendFailed(guid, address(arbMeshB));
        _deliver(composer, guid, composeMsg, 1 wei);
        vm.snapshotGasLastCall(_group(), "lzCompose_SendFailed_InsufficientFee");
    }

    /// @dev A deliverer pays 1 wei, below the compose value the sender committed to, so the compose reverts and stays
    /// @dev queued.
    function test_lzCompose_Revert_InsufficientMsgValue() public {
        bytes memory revertData = _deliverReverting(
            composer,
            _hop(address(arbMeshB), bytes32(0), LZ_COMPOSE_VALUE, _secondLegSendParam(POL_EID, _secondLegOptions())),
            1 wei
        );
        vm.snapshotGasLastCall(_group(), "lzCompose_Revert_InsufficientMsgValue");

        assertEq(
            revertData,
            abi.encodeWithSelector(IMultiHopComposer.InsufficientMsgValue.selector, LZ_COMPOSE_VALUE, 1 wei)
        );
    }

    /// @dev The hop failed on a missing peer, and the retry tops it up once the pathway is wired.
    function test_retry() public {
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
        vm.prank(userB, userB);
        hopComposer.retry{ value: 1 ether }(guid);
        vm.snapshotGasLastCall(_group(), "retry");
    }

    function test_refund() public {
        bytes32 guid = _failSecondLeg(
            composer,
            address(arbMeshB),
            _secondLegSendParam(BAD_EID, _secondLegOptions()),
            LZ_COMPOSE_VALUE
        );
        vm.expectEmit(true, true, true, true, address(composer));
        emit IMultiHopComposer.Refunded(guid, address(arbMeshA));
        vm.prank(userB, userB);
        composer.refund{ value: 1 ether }(guid);
        vm.snapshotGasLastCall(_group(), "refund");
    }

    function test_rescue() public {
        bytes32 guid = _failDecode(composer);
        address rescueTo = makeAddr("rescueTo");
        vm.expectEmit(true, true, true, true, address(composer));
        emit IMultiHopComposer.Rescued(guid, rescueTo, TOKENS_TO_SEND, LZ_COMPOSE_VALUE);
        composer.rescue(guid, rescueTo);
        vm.snapshotGasLastCall(_group(), "rescue");
    }

    function test_setNativeRefundRecipient() public {
        address newNativeRefundRecipient = makeAddr("newNativeRefundRecipient");
        vm.expectEmit(true, true, true, true, address(composer));
        emit IMultiHopComposer.NativeRefundRecipientSet(newNativeRefundRecipient);
        composer.setNativeRefundRecipient(newNativeRefundRecipient);
        vm.snapshotGasLastCall(_group(), "setNativeRefundRecipient");
    }

    function test_setMaxEnforcedMsgValue() public {
        vm.expectEmit(true, true, true, true, address(composer));
        emit IMultiHopComposer.MaxEnforcedMsgValueSet(LZ_COMPOSE_VALUE);
        composer.setMaxEnforcedMsgValue(LZ_COMPOSE_VALUE);
        vm.snapshotGasLastCall(_group(), "setMaxEnforcedMsgValue");
    }

    function test_getOFTs() public {
        composer.getOFTs();
        vm.snapshotGasLastCall(_group(), "getOFTs");
    }

    /// @dev Snapshot group, named after the contract under test.
    function _group() internal pure virtual returns (string memory) {
        return "MultiHopComposer";
    }

    /// @dev Deploys a hub OFT whose debit rejects every send to pol while its quote still succeeds, and its pol peer.
    function _deployRateLimitedMesh() internal virtual returns (address arbMeshR, address polMeshR) {
        if (_oftKind() == OFTKind.NativeOFTAdapter) {
            arbMeshR = address(new RateLimitedNativeOFTAdapterHarness(NATIVE_DECIMALS, arbEndpoint, address(this)));
            polMeshR = _newNativeOFT(address(endpoints[POL_EID]));
        } else {
            arbMeshR = address(new RateLimitedOFTAdapterHarness(address(arbToken), arbEndpoint, address(this)));
            polMeshR = address(
                new OFTAdapterHarness(address(new MockERC20(DECIMALS)), address(endpoints[POL_EID]), address(this))
            );
        }
    }

    /// @dev Makes every send from the hub to `_dstEid` require `DVN_COUNT` DVNs: the default one plus new mock DVNs.
    function _requireDVNs(uint32 _dstEid) internal {
        address sendLib = ILayerZeroEndpointV2(arbEndpoint).defaultSendLibrary(_dstEid);
        address defaultDVN = UlnBase(sendLib).getUlnConfig(address(0), _dstEid).requiredDVNs[0];

        address[] memory messageLibs = new address[](1);
        messageLibs[0] = sendLib;
        address[] memory signers = new address[](1);
        signers[0] = vm.addr(1);
        address[] memory admins = new address[](1);
        admins[0] = address(this);
        IDVN.DstConfigParam[] memory dstConfigs = new IDVN.DstConfigParam[](1);
        dstConfigs[0] = IDVN.DstConfigParam({ dstEid: _dstEid, gas: 5000, multiplierBps: 10000, floorMarginUSD: 1e10 });

        address[] memory dvns = new address[](DVN_COUNT);
        dvns[0] = defaultDVN;
        for (uint256 i = 1; i < DVN_COUNT; i++) {
            DVNMock dvn = new DVNMock(
                ARB_EID,
                uint32(100 + i),
                messageLibs,
                DVNMock(defaultDVN).priceFeed(),
                signers,
                1,
                admins
            );
            dvn.setWorkerFeeLib(address(new DVNFeeLibMock(ARB_EID, 1e18)));
            dvn.setDstConfig(dstConfigs);
            dvns[i] = address(dvn);
        }
        /// @dev The send library requires its DVNs sorted in ascending order.
        for (uint256 i = 1; i < DVN_COUNT; i++) {
            for (uint256 j = i; j > 0 && dvns[j - 1] > dvns[j]; j--) (dvns[j - 1], dvns[j]) = (dvns[j], dvns[j - 1]);
        }

        SetDefaultUlnConfigParam[] memory params = new SetDefaultUlnConfigParam[](1);
        params[0] = SetDefaultUlnConfigParam(_dstEid, UlnConfig(100, uint8(DVN_COUNT), 0, 0, dvns, new address[](0)));
        UlnBase(sendLib).setDefaultUlnConfigs(params);
    }

    /// @dev Delivers a landed compose through the endpoint, as the executor would. The caller expects the event of the
    /// @dev path it snapshots, so a fixture change cannot move the snapshot onto another path unnoticed.
    function _deliver(MultiHopComposer _composer, bytes32 _guid, bytes memory _composeMsg) internal {
        _deliver(_composer, _guid, _composeMsg, LZ_COMPOSE_VALUE);
    }

    function _deliver(MultiHopComposer _composer, bytes32 _guid, bytes memory _composeMsg, uint256 _value) internal {
        vm.deal(executor, _value);
        vm.prank(executor);
        ILayerZeroEndpointV2(arbEndpoint).lzCompose{ value: _value, gas: LZ_COMPOSE_GAS }(
            address(arbMeshA),
            address(_composer),
            _guid,
            0,
            _composeMsg,
            ""
        );
    }

    /// @dev Delivers with `_value`, expecting a revert, and returns its data. The caller snapshots the delivery before
    /// @dev making any other call.
    function _deliverReverting(
        MultiHopComposer _composer,
        bytes memory _payload,
        uint256 _value
    ) internal returns (bytes memory revertData) {
        (bytes32 guid, bytes memory composeMsg) = _landCompose(_composer, _payload);
        vm.deal(executor, _value);
        vm.prank(executor);
        try
            ILayerZeroEndpointV2(arbEndpoint).lzCompose{ value: _value, gas: LZ_COMPOSE_GAS }(
                address(arbMeshA),
                address(_composer),
                guid,
                0,
                composeMsg,
                ""
            )
        {
            revert("the delivery should revert");
        } catch (bytes memory reason) {
            revertData = reason;
        }
    }

    /// @dev Lands the first leg through mesh A, queuing its compose for `_composer`.
    function _landCompose(
        MultiHopComposer _composer,
        bytes memory _payload
    ) internal returns (bytes32 guid, bytes memory composeMsg) {
        (SendParam memory sendParam, MessagingReceipt memory receipt) = _landFirstLeg(
            address(_composer),
            _payload,
            LZ_COMPOSE_VALUE
        );
        return (receipt.guid, _queuedComposeMsg(ETH_EID, sendParam, receipt));
    }
}
