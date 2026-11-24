// SPDX-License-Identifier: MIT
pragma solidity ^0.8.22;

import {
    IOFT,
    MessagingFee,
    MessagingReceipt,
    SendParam
} from "@layerzerolabs/oft-evm-contracts/contracts/interfaces/IOFT.sol";
import { NativeOFTAdapter } from "@layerzerolabs/oft-evm/contracts/NativeOFTAdapter.sol";
import { MockERC20 } from "@layerzerolabs/test-utils-evm-contracts/contracts/mocks/MockERC20.sol";
import { IMultiHopComposer } from "./../../contracts/interfaces/IMultiHopComposer.sol";
import { IMultiHopComposerNative } from "./../../contracts/interfaces/IMultiHopComposerNative.sol";
import { MultiHopComposer } from "./../../contracts/MultiHopComposer.sol";
import { OFTAdapterHarness, SharedDecimals8NativeOFTAdapterHarness } from "./harnesses/OFTHarnesses.sol";
import { MultiHopComposerTest } from "./MultiHopComposer.t.sol";

/**
 * @notice Runs the whole `MultiHopComposerTest` suite against a `MultiHopComposerNative` joining `NativeOFTAdapter`s,
 *         plus the native paths.
 * @dev Overrides the base tests that do not apply to native: ERC20 approvals and tokens, and the shared-decimals dust.
 */
contract MultiHopComposerNativeTest is MultiHopComposerTest {
    /// @dev One unit at 8 shared decimals, which is dust at the default 6.
    uint256 internal constant DUST = 1e10;

    /**
     * @dev A hop that arrives with `DUST` through an OFT with 8 shared decimals, toward `arbMeshB` with the default 6.
     * @param composer Composer joining the 8-decimal OFT and `arbMeshB`
     * @param ethOFT Source OFT with 8 shared decimals
     * @param arbOFT Hub OFT with 8 shared decimals
     * @param amount Amount the hop carries, `DUST` included
     * @param guid Message GUID
     * @param options Options of the first leg
     * @param composeMsg Compose message the hub OFT queued
     */
    struct DustHop {
        MultiHopComposer composer;
        address ethOFT;
        address arbOFT;
        uint256 amount;
        bytes32 guid;
        bytes options;
        bytes composeMsg;
    }

    function _oftKind() internal pure virtual override returns (OFTKind) {
        return OFTKind.NativeOFTAdapter;
    }

    /// @dev Skipped: a native composer grants no ERC20 approval.
    function test_constructor_NonCompliantERC20Approval() public override {
        vm.skip(true);
    }

    /// @dev Inverted: a native composer rejects an ERC20 OFT.
    function test_constructor_Revert_NativeToken() public override {
        address erc20OFT = _newERC20OFT();

        vm.expectRevert(IMultiHopComposerNative.NativeRequired.selector);
        _newComposer(address(this), _addressArray(erc20OFT), nativeRefundRecipient, MAX_ENFORCED_MSG_VALUE);
    }

    /// @dev Every native OFT carries the same token, so an OFT with another token is an ERC20 OFT.
    function test_constructor_Revert_DifferentTokens() public override {
        address erc20OFT = _newERC20OFT();

        vm.expectRevert(IMultiHopComposerNative.NativeRequired.selector);
        _deployComposer(arbMeshA, erc20OFT);
    }

    /// @dev Inverted: an ERC20 OFT ahead of a native one.
    function test_constructor_Revert_DifferentTokens_NativeOFT() public override {
        address erc20OFT = _newERC20OFT();

        vm.expectRevert(IMultiHopComposerNative.NativeRequired.selector);
        _deployComposer(erc20OFT, arbMeshA);
    }

    function test_receive() public {
        vm.deal(arbMeshA, arbMeshA.balance + 1 ether);
        vm.prank(arbMeshA);
        (bool success, ) = address(composer).call{ value: 1 ether }("");

        assertTrue(success);
        assertEq(address(composer).balance, 1 ether);
    }

    /// @dev An unregistered OFT cannot credit the composer, so its inbound transfer reverts instead of stranding native.
    function test_receive_Revert_UnregisteredOFTCredit() public {
        address ethOFT = _newNativeOFT(address(endpoints[ETH_EID]));
        address arbOFT = _deployHubOFT();
        this.wireOApps(_addressArray(ethOFT, arbOFT));
        _fund(arbOFT, arbOFT, INITIAL_BALANCE);

        SendParam memory sendParam = SendParam(
            ARB_EID,
            addressToBytes32(address(composer)),
            TOKENS_TO_SEND,
            TOKENS_TO_SEND,
            lzReceiveOptions,
            "",
            ""
        );
        MessagingFee memory fee = IOFT(ethOFT).quoteSend(sendParam, false);
        vm.prank(userA);
        IOFT(ethOFT).send{ value: fee.nativeFee + TOKENS_TO_SEND }(sendParam, fee, userA);

        vm.expectRevert(
            abi.encodeWithSelector(
                NativeOFTAdapter.CreditFailed.selector,
                address(composer),
                TOKENS_TO_SEND,
                abi.encodeWithSelector(IMultiHopComposer.OnlyOFT.selector, arbOFT)
            )
        );
        this.verifyPackets(ARB_EID, addressToBytes32(arbOFT));
    }

    function test_receive_Fuzz_Revert_OnlyOFT(address _sender) public {
        vm.assume(!composer.isOFT(_sender));
        assumeNotForgeAddress(_sender);
        assumeNotPrecompile(_sender);
        vm.deal(_sender, 1 ether);

        vm.expectRevert(abi.encodeWithSelector(IMultiHopComposer.OnlyOFT.selector, _sender));
        vm.prank(_sender);
        (bool success, ) = address(composer).call{ value: 1 ether }("");
        success;
    }

    /// @dev `NativeOFTAdapter.send` requires the amount without dust, so the onward send fails on every attempt and the
    /// @dev hop can only be refunded, through the inbound OFT, for which the amount has no dust.
    function test_lzCompose_DifferentSharedDecimals() public virtual override {
        DustHop memory hop = _landDustHop();

        vm.expectEmit(true, true, true, true, address(hop.composer));
        emit IMultiHopComposer.SendFailed(hop.guid, arbMeshB);
        this.lzCompose(ARB_EID, hop.arbOFT, hop.options, hop.guid, address(hop.composer), hop.composeMsg);

        vm.expectRevert(
            abi.encodeWithSelector(
                NativeOFTAdapter.IncorrectMessageValue.selector,
                LZ_COMPOSE_VALUE + hop.amount,
                LZ_COMPOSE_VALUE + hop.amount - DUST
            )
        );
        hop.composer.retry(hop.guid);

        _refundAndLand(hop.composer, hop.guid, hop.arbOFT, hop.ethOFT, hop.amount);
        assertEq(address(hop.composer).balance, 0, "the refund should take the whole amount");
    }

    /// @dev Lands a hop with `DUST` through a mesh with 8 shared decimals on a composer that forwards it to `arbMeshB`.
    function _landDustHop() internal returns (DustHop memory hop) {
        hop.ethOFT = address(
            new SharedDecimals8NativeOFTAdapterHarness(NATIVE_DECIMALS, address(endpoints[ETH_EID]), address(this))
        );
        hop.arbOFT = address(new SharedDecimals8NativeOFTAdapterHarness(NATIVE_DECIMALS, arbEndpoint, address(this)));
        this.wireOApps(_addressArray(hop.ethOFT, hop.arbOFT));
        _setEnforcedOptions(hop.arbOFT, ETH_EID);
        _fund(hop.ethOFT, hop.ethOFT, INITIAL_BALANCE);
        _fund(hop.arbOFT, hop.arbOFT, INITIAL_BALANCE);
        hop.composer = _deployComposer(hop.arbOFT, arbMeshB);
        hop.amount = TOKENS_TO_SEND + DUST;

        (SendParam memory sendParam, MessagingReceipt memory receipt) = _sendFirstLeg(
            hop.ethOFT,
            address(hop.composer),
            ARB_EID,
            _hop(arbMeshB, _secondLegSendParam(POL_EID, _secondLegOptions())),
            LZ_COMPOSE_VALUE,
            hop.amount
        );
        verifyPackets(ARB_EID, addressToBytes32(hop.arbOFT));

        hop.guid = receipt.guid;
        hop.options = sendParam.extraOptions;
        hop.composeMsg = _queuedComposeMsg(ETH_EID, sendParam, receipt);
    }

    function _newERC20OFT() internal returns (address) {
        return address(new OFTAdapterHarness(address(new MockERC20(DECIMALS)), arbEndpoint, address(this)));
    }
}
