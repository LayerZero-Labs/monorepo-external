// SPDX-License-Identifier: MIT
pragma solidity ^0.8.22;

import { ILayerZeroComposer } from "@layerzerolabs/lz-evm-protocol-v2/contracts/interfaces/ILayerZeroComposer.sol";
import { IMessagingContext } from "@layerzerolabs/lz-evm-protocol-v2/contracts/interfaces/IMessagingContext.sol";
import { IOAppCore } from "@layerzerolabs/oapp-evm-contracts/contracts/interfaces/IOAppCore.sol";
import { IOFT, SendParam, MessagingFee } from "@layerzerolabs/oft-evm-contracts/contracts/interfaces/IOFT.sol";
import { OFTComposeMsgCodec } from "@layerzerolabs/oft-evm-contracts/contracts/libs/OFTComposeMsgCodec.sol";
import { Ownable } from "@openzeppelin/contracts/access/Ownable.sol";
import { Ownable2Step } from "@openzeppelin/contracts/access/Ownable2Step.sol";
import { IERC20, SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { IMultiHopComposer } from "./interfaces/IMultiHopComposer.sol";
import { MultiHopComposerMsgCodec } from "./libs/MultiHopComposerMsgCodec.sol";

/**
 * @title MultiHopComposer
 * @author LayerZero Labs
 * @custom:version 2.1.0
 * @notice Allows A->B->C messages to be sent with a single user transaction for a set of trusted OFTs that share the
 *         same token.
 *         A transfer credited to this contract through the inbound OFT is forwarded onto a second hop through the
 *         outbound OFT, both on this chain, toward the destination chain.
 *         Handles three different failure scenarios:
 *         1. Failed to decode the message. `lzCompose` caches it and it can only be rescued by the owner through
 *            `rescue`.
 *         2. `msg.value` is below the payload's `minMsgValue`, capped at `maxEnforcedMsgValue`, or the call is nested
 *            within another endpoint send. `lzCompose` reverts and the compose can be delivered again.
 *         3. Failed to send the message to the outbound OFT. `lzCompose` caches it and the message can be retried
 *            through `retry` or refunded back to the source chain through `refund`. If too little gas is left to
 *            record the failure, `lzCompose` reverts and the compose can be delivered again.
 * @dev Serves any combination of OFTs and directions, including a single OFT in a hub-and-spoke topology.
 * @dev The second hop (the intended send, retry, or refund) has no slippage protection.
 * @dev The contract doesn't handle the failure scenario in which `this.send` fails due to an out-of-gas error but the
 *      EIP-150 remainder allows it to still record the failed message.
 * @dev Refunds are routed to the encoded `refundTo` address in the compose payload. If the `refundTo` param is empty,
 *      the refund is routed to the source sender. If the `refundTo` or the original sender is not a user-controlled
 *      address, such as a wrapper contract or another composer, funds can be permanently lost.
 * @dev `refund` relies entirely on the inbound OFT's enforced options. `lzCompose` and `retry` combine options from the
 *      nested send param with the outbound OFT's enforced options. Recovery callers cannot add options because native
 *      drops could redirect cached `msg.value`.
 */
contract MultiHopComposer is IMultiHopComposer, Ownable2Step {
    using SafeERC20 for IERC20;

    address public immutable ENDPOINT;
    address public immutable TOKEN;

    address public nativeRefundRecipient;
    uint256 public maxEnforcedMsgValue;

    address[] internal _oftsArray;

    mapping(address oft => bool) public isOFT;

    mapping(bytes32 guid => UndecodableMessage) public undecodableMessages;
    mapping(bytes32 guid => FailedMessage) public failedMessages;

    /**
     * @param _initialOwner Initial owner of the contract
     * @param _ofts OFTs to register
     * @param _nativeRefundRecipient Native refund recipient, must accept native token transfers
     * @param _maxEnforcedMsgValue Cap on the `minMsgValue` enforced on a compose
     */
    constructor(
        address _initialOwner,
        address[] memory _ofts,
        address _nativeRefundRecipient,
        uint256 _maxEnforcedMsgValue
    ) Ownable(_initialOwner) {
        if (_ofts.length == 0) revert InvalidOFT(address(0));

        _setNativeRefundRecipient(_nativeRefundRecipient);
        _setMaxEnforcedMsgValue(_maxEnforcedMsgValue);

        (address endpoint, address token, address[] memory ofts) = _processOFTs(_ofts);
        ENDPOINT = endpoint;
        TOKEN = token;
        _oftsArray = ofts;
    }

    /// @inheritdoc ILayerZeroComposer
    function lzCompose(
        address _inboundOFT,
        bytes32 _guid,
        bytes calldata _message,
        address /* _executor */,
        bytes calldata /* _extraData */
    ) public payable virtual override {
        if (msg.sender != ENDPOINT) revert OnlyEndpoint(msg.sender);
        if (!isOFT[_inboundOFT]) revert OnlyOFT(_inboundOFT);

        /// @dev Received amount of tokens from the inbound OFT.
        uint256 amount = OFTComposeMsgCodec.amountLD(_message);

        SendParam memory sendParam;
        address oft;
        bytes32 refundTo;
        uint256 minMsgValue;

        try this.decode(OFTComposeMsgCodec.composeMsg(_message)) returns (
            SendParam memory sendParamDecoded,
            address oftDecoded,
            bytes32 refundToDecoded,
            uint256 minMsgValueDecoded
        ) {
            sendParam = sendParamDecoded;
            oft = oftDecoded;
            refundTo = refundToDecoded;
            minMsgValue = minMsgValueDecoded;
        } catch {
            undecodableMessages[_guid] = UndecodableMessage({ amount: amount, msgValue: msg.value });
            emit DecodeFailed(_guid, OFTComposeMsgCodec.composeMsg(_message));
            return;
        }
        /// @dev As `sendParam.amountLD` may not equal the tokens transferred into the composer, we override with the
        ///      amount of tokens transferred into the composer to avoid misappropriation of funds.
        sendParam.amountLD = amount;
        /// @dev We remove slippage protection to avoid the second hop transaction from failing.
        sendParam.minAmountLD = 0;

        /// @dev Protection against front-running the executor with a low `msg.value` that reverts the message and
        ///      enables permissionlessly refunding the message to the source chain.
        /// @dev Capped so a `minMsgValue` too high to pay cannot keep the compose from ever being delivered.
        if (minMsgValue > maxEnforcedMsgValue) minMsgValue = maxEnforcedMsgValue;
        if (msg.value < minMsgValue) revert InsufficientMsgValue(minMsgValue, msg.value);

        /// @dev Try sending the message to the outbound OFT.
        try this.send{ value: msg.value }(oft, sendParam) {
            emit Sent(_guid, oft);
        } catch (bytes memory reason) {
            /// @dev Avoid caching the message as failed when trying to deliver from another endpoint send.
            if (IMessagingContext(ENDPOINT).isSendingMessage()) {
                assembly {
                    revert(add(reason, 32), mload(reason))
                }
            }

            /// @dev Fall back to the source sender only if `refundTo` is empty.
            SendParam memory refundSendParam = SendParam({
                dstEid: OFTComposeMsgCodec.srcEid(_message),
                to: refundTo != bytes32(0) ? refundTo : OFTComposeMsgCodec.composeFrom(_message),
                amountLD: amount,
                minAmountLD: 0,
                extraOptions: "",
                composeMsg: "",
                oftCmd: ""
            });

            /// @dev A failed send can happen due to several reasons: not enough `msg.value`, invalid peer, etc.
            /// @dev This message can only be refunded back to the source chain or retried with more value.
            failedMessages[_guid] = FailedMessage({
                oft: oft,
                sendParam: sendParam,
                refundOFT: _inboundOFT,
                refundSendParam: refundSendParam,
                msgValue: msg.value
            });
            emit SendFailed(_guid, oft);
            return;
        }
    }

    /// @inheritdoc IMultiHopComposer
    function retry(bytes32 _guid) public payable virtual {
        FailedMessage memory failedMessage = failedMessages[_guid];
        if (failedMessage.oft == address(0)) revert InvalidSendParam(failedMessage.sendParam);

        if (!isOFT[failedMessage.oft]) revert InvalidOFT(failedMessage.oft);

        delete failedMessages[_guid];
        _send(failedMessage.oft, failedMessage.sendParam, failedMessage.msgValue, tx.origin);
        emit Retried(_guid, failedMessage.oft);
    }

    /// @inheritdoc IMultiHopComposer
    function refund(bytes32 _guid) public payable virtual {
        FailedMessage memory failedMessage = failedMessages[_guid];
        /// @dev An undecodable hop has no record here. Only the owner can recover it, through rescue().
        if (failedMessage.refundOFT == address(0)) revert InvalidSendParam(failedMessage.refundSendParam);

        delete failedMessages[_guid];
        /// @dev `nativeRefundRecipient` prevents `tx.origin` from collecting fees when the refund route is cheaper.
        _send(failedMessage.refundOFT, failedMessage.refundSendParam, failedMessage.msgValue, nativeRefundRecipient);
        emit Refunded(_guid, failedMessage.refundOFT);
    }

    /// @inheritdoc IMultiHopComposer
    function rescue(bytes32 _guid, address _to) public virtual onlyOwner {
        if (_to == address(0)) revert InvalidRescueRecipient();
        UndecodableMessage memory undecodable = undecodableMessages[_guid];
        if (undecodable.amount == 0 && undecodable.msgValue == 0) revert NothingToRescue(_guid);

        uint256 amount = undecodable.amount;
        uint256 value = undecodable.msgValue;
        delete undecodableMessages[_guid];

        if (amount != 0) IERC20(TOKEN).safeTransfer(_to, amount);
        if (value != 0) {
            (bool success, ) = _to.call{ value: value }("");
            if (!success) revert NativeTransferFailed();
        }
        emit Rescued(_guid, _to, amount, value);
    }

    /// @inheritdoc IMultiHopComposer
    function setNativeRefundRecipient(address _nativeRefundRecipient) public virtual onlyOwner {
        _setNativeRefundRecipient(_nativeRefundRecipient);
    }

    /// @inheritdoc IMultiHopComposer
    function setMaxEnforcedMsgValue(uint256 _maxEnforcedMsgValue) public virtual onlyOwner {
        _setMaxEnforcedMsgValue(_maxEnforcedMsgValue);
    }

    /**
     * @inheritdoc Ownable
     * @dev Disallow renouncing ownership.
     */
    function renounceOwnership() public virtual override onlyOwner {
        revert CannotRenounceOwnership();
    }

    /// @dev External call for try-catch logic in `lzCompose()`.
    function decode(
        bytes calldata _message
    ) public pure virtual returns (SendParam memory sendParam, address oft, bytes32 refundTo, uint256 minMsgValue) {
        return MultiHopComposerMsgCodec.decode(_message);
    }

    /// @dev External call for try-catch logic in `lzCompose()`.
    function send(address _oft, SendParam memory _sendParam) public payable virtual {
        if (msg.sender != address(this)) revert OnlySelf(msg.sender);
        if (!isOFT[_oft]) revert InvalidOFT(_oft);
        /// @dev `nativeRefundRecipient` avoids an ETH-rejecting `tx.origin` from caching the message as failed.
        _send(_oft, _sendParam, 0, nativeRefundRecipient);
    }

    /// @inheritdoc IMultiHopComposer
    function getOFTs() public view virtual returns (address[] memory ofts) {
        return _oftsArray;
    }

    /**
     * @notice Validates, registers, and approves OFTs.
     * @param _ofts Non-empty array of OFTs
     */
    function _processOFTs(
        address[] memory _ofts
    ) internal virtual returns (address endpoint, address token, address[] memory ofts) {
        address firstOFT = _ofts[0];
        if (firstOFT == address(0)) revert InvalidOFT(firstOFT);
        endpoint = address(IOAppCore(firstOFT).endpoint());
        token = IOFT(firstOFT).token();
        if (token == address(0)) revert NativeNotSupported();

        for (uint256 i; i < _ofts.length; i++) {
            address oft = _ofts[i];

            if (oft == address(0) || isOFT[oft]) revert InvalidOFT(oft);
            if (address(IOAppCore(oft).endpoint()) != endpoint) revert DifferentEndpoints();
            if (IOFT(oft).token() != token) revert DifferentTokens();

            isOFT[oft] = true;

            /// @dev We don't trust or cache a self-reported `approvalRequired()`.
            IERC20(token).forceApprove(oft, type(uint256).max);
        }

        return (endpoint, token, _ofts);
    }

    /**
     * @notice Sets the native refund recipient.
     * @param _nativeRefundRecipient Native refund recipient
     */
    function _setNativeRefundRecipient(address _nativeRefundRecipient) internal virtual {
        if (_nativeRefundRecipient == address(0)) revert InvalidNativeRefundRecipient();
        nativeRefundRecipient = _nativeRefundRecipient;
        emit NativeRefundRecipientSet(_nativeRefundRecipient);
    }

    /**
     * @notice Sets the cap on the enforced `minMsgValue`.
     * @param _maxEnforcedMsgValue Cap on the enforced `minMsgValue`
     */
    function _setMaxEnforcedMsgValue(uint256 _maxEnforcedMsgValue) internal virtual {
        maxEnforcedMsgValue = _maxEnforcedMsgValue;
        emit MaxEnforcedMsgValueSet(_maxEnforcedMsgValue);
    }

    /// @dev Single function to send OFT messages.
    function _send(
        address _oft,
        SendParam memory _sendParam,
        uint256 _prePaidValue,
        address _refundTo
    ) internal virtual {
        uint256 msgValue = msg.value + _prePaidValue;
        IOFT(_oft).send{ value: msgValue }(_sendParam, MessagingFee({ nativeFee: msgValue, lzTokenFee: 0 }), _refundTo);
    }
}
