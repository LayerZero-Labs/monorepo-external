// SPDX-License-Identifier: MIT
pragma solidity ^0.8.22;

import { IOAppAlt } from "@layerzerolabs/oapp-evm-impl/contracts/interfaces/IOAppAlt.sol";
import {
    MessagingReceipt,
    MessagingFee,
    OFTReceipt,
    SendParam
} from "@layerzerolabs/oft-evm-impl/contracts/interfaces/IOFT.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { NexusOFT } from "./NexusOFT.sol";

/**
 * @title NexusOFTAlt
 * @author LayerZero Labs (@TRileySchwarz, tinom.eth)
 * @custom:version 1.0.0
 * @notice `NexusOFT` variant that pays native fees using an ERC20 token instead of `msg.value`.
 * @dev For chains where gas/native fees are paid via an ERC20 token (e.g., some L2s using `EndpointV2Alt`).
 * @dev Conventional native fee payment flow is altered in this contract, since the native fee is pushed to the
 *      endpoint before the OFT token transfer. This can result in native fee griefing if the OFT uses tokens that
 *      have hooks or allow arbitrary calls.
 */
contract NexusOFTAlt is IOAppAlt, NexusOFT {
    using SafeERC20 for IERC20;

    /// @dev ERC20 token used to pay native fees, cached from the endpoint.
    address internal immutable NATIVE_TOKEN;

    /**
     * @dev Reverts if the endpoint has a zero address native token.
     * @param _nexus Address of the `NexusAlt` hub contract
     * @param _token Address of the underlying ERC20 token
     * @param _tokenId Unique token identifier
     */
    constructor(address _nexus, address _token, uint32 _tokenId) NexusOFT(_nexus, _token, _tokenId) {
        NATIVE_TOKEN = ENDPOINT.nativeToken();
        if (NATIVE_TOKEN == address(0)) revert InvalidNativeToken();
    }

    /**
     * @dev Handles pushing native ERC20 fee to the endpoint. This alters conventional OFT flow, where the fee is paid
     *      after the OFT token transfer, and can result in native fee griefing if the OFT uses tokens that have hooks
     *      or allow arbitrary calls.
     * @inheritdoc NexusOFT
     */
    function send(
        SendParam calldata _sendParam,
        MessagingFee calldata _fee,
        address _refundAddress
    ) public payable virtual override returns (MessagingReceipt memory msgReceipt, OFTReceipt memory oftReceipt) {
        if (msg.value > 0) revert OnlyAltToken();

        /// @dev Push native ERC20 fee to the endpoint. Equivalent to `OAppSender._payNative()`.
        if (_fee.nativeFee > 0) {
            IERC20(NATIVE_TOKEN).safeTransferFrom(msg.sender, address(ENDPOINT), _fee.nativeFee);
        }

        /// @dev Push LZ token fee to the endpoint. Equivalent to `OAppSender._payLzToken()`.
        if (_fee.lzTokenFee > 0) {
            address lzToken = ENDPOINT.lzToken();
            if (lzToken == address(0)) revert LzTokenUnavailable();
            IERC20(lzToken).safeTransferFrom(msg.sender, address(ENDPOINT), _fee.lzTokenFee);
        }

        (msgReceipt, oftReceipt) = NEXUS.nexusSend(msg.sender, _sendParam, _fee, _refundAddress);

        emit OFTSent(
            msgReceipt.guid,
            _sendParam.dstEid,
            msg.sender,
            oftReceipt.amountSentLD,
            oftReceipt.amountReceivedLD
        );
    }
}
