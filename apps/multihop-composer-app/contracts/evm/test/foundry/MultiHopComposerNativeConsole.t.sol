// SPDX-License-Identifier: MIT
pragma solidity ^0.8.22;

import { MessagingReceipt, SendParam } from "@layerzerolabs/oft-evm-contracts/contracts/interfaces/IOFT.sol";
import { OFTNativeExtendedRBACUpgradeable } from "@layerzerolabs/oft-upgradeable-evm-contracts/contracts/extended/OFTNativeExtendedRBACUpgradeable.sol";
import { ICreditRedirect } from "@layerzerolabs/utils-evm-contracts/contracts/interfaces/ICreditRedirect.sol";
import { IPauseByID } from "@layerzerolabs/utils-evm-contracts/contracts/interfaces/IPauseByID.sol";
import { IRateLimiter } from "@layerzerolabs/utils-evm-contracts/contracts/interfaces/IRateLimiter.sol";
import { IMultiHopComposer } from "./../../contracts/interfaces/IMultiHopComposer.sol";
import { MockCreditRedirectAllowlist } from "./mocks/MockCreditRedirectAllowlist.sol";
import { MultiHopComposerNativeTest } from "./MultiHopComposerNative.t.sol";

/**
 * @notice Runs the whole native suite against a `MultiHopComposerNative` joining Console OFTs
 *         (`OFTNativeExtendedRBACUpgradeable`), plus the paths their fee, pause, rate limit and credit redirect change.
 * @dev `OFTNativeExtendedRBACUpgradeable.send` requires `msg.value == nativeFee + amountLD` without removing dust, and
 * @dev takes any dust as a fee.
 */
contract MultiHopComposerNativeConsoleTest is MultiHopComposerNativeTest {
    uint16 internal constant FEE_BPS = 1_000;
    uint256 internal constant FEE = (TOKENS_TO_SEND * FEE_BPS) / 10_000;

    function _oftKind() internal pure override returns (OFTKind) {
        return OFTKind.NativeConsole;
    }

    /// @dev The Console OFT takes the dust as a fee, so the onward send succeeds and the composer keeps nothing.
    function test_lzCompose_DifferentSharedDecimals() public override {
        DustHop memory hop = _landDustHop();
        uint256 initialFeeDepositBalance = feeDeposit.balance;

        vm.expectEmit(true, true, true, true, address(hop.composer));
        emit IMultiHopComposer.Sent(hop.guid, arbMeshB);
        this.lzCompose(ARB_EID, hop.arbOFT, hop.options, hop.guid, address(hop.composer), hop.composeMsg);

        assertEq(address(hop.composer).balance, 0, "the composer should retain nothing after the hop");
        assertEq(feeDeposit.balance - initialFeeDepositBalance, DUST, "the dust should go to the fee deposit");
        _verifyLanded(polMeshB, hop.amount - DUST);
    }

    /// @dev The outbound OFT takes its fee from the amount, and the recipient receives the rest.
    function test_lzCompose_OutboundFee() public {
        _console(arbMeshB).setDefaultFeeBps(FEE_BPS);
        (SendParam memory sendParam, MessagingReceipt memory receipt) = _landFirstLeg(
            address(composer),
            _hop(arbMeshB, _secondLegSendParam(POL_EID, _secondLegOptions())),
            LZ_COMPOSE_VALUE
        );
        uint256 initialFeeDepositBalance = feeDeposit.balance;

        vm.expectEmit(true, true, true, true, address(composer));
        emit IMultiHopComposer.Sent(receipt.guid, arbMeshB);
        this.lzCompose(
            ARB_EID,
            arbMeshA,
            sendParam.extraOptions,
            receipt.guid,
            address(composer),
            _queuedComposeMsg(ETH_EID, sendParam, receipt)
        );

        assertEq(address(composer).balance, 0, "the composer should retain nothing after the hop");
        assertEq(feeDeposit.balance - initialFeeDepositBalance, FEE, "the fee should go to the fee deposit");
        _verifyLanded(polMeshB, TOKENS_TO_SEND - FEE);
    }

    /// @dev A paused outbound pathway fails the onward send, and the hop is refunded through the inbound OFT.
    function test_lzCompose_SendFailed_Paused() public {
        IPauseByID.SetPausedParam[] memory params = new IPauseByID.SetPausedParam[](1);
        params[0] = IPauseByID.SetPausedParam({ id: POL_EID, paused: true, enabled: true });
        _console(arbMeshB).setPaused(params);

        bytes32 guid = _failSecondLeg(
            composer,
            arbMeshB,
            _secondLegSendParam(POL_EID, _secondLegOptions()),
            LZ_COMPOSE_VALUE
        );

        _refundAndLand(composer, guid, arbMeshA, ethMeshA);
    }

    /// @dev An exhausted outbound rate limit fails the onward send, and the hop is refunded through the inbound OFT.
    function test_lzCompose_SendFailed_RateLimited() public {
        /// @dev The pol pathway has no active rate-limit config, so enabling rate limits leaves nothing to send to pol.
        _console(arbMeshB).setRateLimitGlobalConfig(
            IRateLimiter.RateLimitGlobalConfig({ useGlobalState: false, isGloballyDisabled: false })
        );

        bytes32 guid = _failSecondLeg(
            composer,
            arbMeshB,
            _secondLegSendParam(POL_EID, _secondLegOptions()),
            LZ_COMPOSE_VALUE
        );

        _refundAndLand(composer, guid, arbMeshA, ethMeshA);
    }

    /// @dev The inbound OFT redirects the credit to its escrow and composes a zero amount, so the hop forwards nothing.
    function test_lzCompose_CreditRedirected() public {
        address escrow = makeAddr("escrow");
        _console(arbMeshA).setCreditRedirectConfig(
            ICreditRedirect.CreditRedirectConfig({
                allowlist: address(new MockCreditRedirectAllowlist()),
                escrow: escrow
            })
        );
        (SendParam memory sendParam, MessagingReceipt memory receipt) = _landFirstLeg(
            address(composer),
            _hop(arbMeshB, _secondLegSendParam(POL_EID, _secondLegOptions())),
            LZ_COMPOSE_VALUE
        );

        assertEq(escrow.balance, TOKENS_TO_SEND, "the escrow should receive the credit");
        assertEq(address(composer).balance, 0, "the composer should receive nothing");

        vm.expectEmit(true, true, true, true, address(composer));
        emit IMultiHopComposer.Sent(receipt.guid, arbMeshB);
        this.lzCompose(
            ARB_EID,
            arbMeshA,
            sendParam.extraOptions,
            receipt.guid,
            address(composer),
            _createComposePayload(receipt.nonce, ETH_EID, sendParam.composeMsg, 0, userA)
        );

        _verifyLanded(polMeshB, 0);
    }

    /// @dev The inbound OFT takes its fee from a refund too.
    function test_refund_InboundFee() public {
        bytes32 guid = _failSecondLeg(
            composer,
            arbMeshB,
            _secondLegSendParam(BAD_EID, _secondLegOptions()),
            LZ_COMPOSE_VALUE
        );
        _console(arbMeshA).setDefaultFeeBps(FEE_BPS);

        _refundAndLand(composer, guid, arbMeshA, ethMeshA, TOKENS_TO_SEND - FEE);
        assertEq(address(composer).balance, 0, "the refund should take the whole amount");
    }

    function _console(address _oft) internal pure returns (OFTNativeExtendedRBACUpgradeable) {
        return OFTNativeExtendedRBACUpgradeable(payable(_oft));
    }
}
