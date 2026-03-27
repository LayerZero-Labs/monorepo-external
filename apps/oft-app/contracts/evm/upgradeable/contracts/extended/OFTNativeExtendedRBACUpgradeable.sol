// SPDX-License-Identifier: MIT
pragma solidity ^0.8.22;

import { OAppSenderUpgradeable } from "@layerzerolabs/oapp-evm-upgradeable-impl/contracts/oapp/OAppSenderUpgradeable.sol";
import {
    IOFT,
    SendParam,
    MessagingFee,
    MessagingReceipt,
    OFTReceipt
} from "@layerzerolabs/oft-evm-impl/contracts/interfaces/IOFT.sol";
import { OFTCoreBaseUpgradeable } from "./../oft/OFTCoreBaseUpgradeable.sol";
import { OFTCoreExtendedRBACUpgradeable } from "./OFTCoreExtendedRBACUpgradeable.sol";

/**
 * @title OFTNativeExtendedRBACUpgradeable
 * @author LayerZero Labs (@TRileySchwarz, tinom.eth)
 * @custom:version 1.0.0
 * @notice Upgradeable OFT native adapter with toggleable pause, fee, and rate limit functionality.
 * @dev Roles are handled through `AccessControl2StepUpgradeable`.
 */
contract OFTNativeExtendedRBACUpgradeable is OFTCoreExtendedRBACUpgradeable {
    /**
     * @notice Thrown when the provided `msg.value` does not match expected.
     * @param provided Provided `msg.value`
     * @param required Expected `msg.value` including the OFT amount and the messaging fee
     */
    error IncorrectMessageValue(uint256 provided, uint256 required);

    /**
     * @notice Thrown when the native token credit fails.
     * @param to Address to credit native tokens to
     * @param amountLD Amount of native tokens to credit
     * @param revertData Error data from the credit call
     */
    error CreditFailed(address to, uint256 amountLD, bytes revertData);

    /**
     * @notice Thrown when the native token fee transfer fails.
     * @param to Address to transfer fees to
     * @param amount Amount of native tokens to transfer
     * @param revertData Error data from the transfer call
     */
    error FeeTransferFailed(address to, uint256 amount, bytes revertData);

    /**
     * @dev Sets immutable variables.
     * @param _localDecimals Decimals of the native token on the local chain (this chain), 18 on ETH
     * @param _endpoint LayerZero endpoint address
     * @param _rateLimiterScaleDecimals Number of decimals to scale rate limit amounts (usually 0)
     */
    constructor(
        uint8 _localDecimals,
        address _endpoint,
        uint8 _rateLimiterScaleDecimals
    ) OFTCoreExtendedRBACUpgradeable(_localDecimals, false, address(0), _endpoint, _rateLimiterScaleDecimals) {
        _disableInitializers();
    }

    /**
     * @notice Initializes the contract.
     * @param _initialAdmin Address to be granted `DEFAULT_ADMIN_ROLE` and endpoint delegate
     * @param _feeDeposit Address that will receive any accrued fees
     */
    function initialize(address _initialAdmin, address _feeDeposit) public initializer {
        __OFTCoreExtendedRBAC_init(_initialAdmin, _feeDeposit);
    }

    /**
     * @dev Override to remove `amountLD` dusting.
     * @inheritdoc OFTCoreBaseUpgradeable
     */
    function send(
        SendParam calldata _sendParam,
        MessagingFee calldata _fee,
        address _refundAddress
    )
        public
        payable
        virtual
        override(IOFT, OFTCoreBaseUpgradeable)
        returns (MessagingReceipt memory msgReceipt, OFTReceipt memory oftReceipt)
    {
        /// @dev Dusting `amountLD` is not required as it'll always equal to `amountSentLD`.
        uint256 requiredMsgValue = _fee.nativeFee + _sendParam.amountLD;
        if (msg.value != requiredMsgValue) {
            revert IncorrectMessageValue(msg.value, requiredMsgValue);
        }
        return _send(_sendParam, _fee, _refundAddress);
    }

    /**
     * @dev Override to apply rate limit, fee collection, and pausability.
     * @inheritdoc OFTCoreBaseUpgradeable
     */
    function _debit(
        address _from,
        uint256 _amountLD,
        uint256 _minAmountLD,
        uint32 _dstEid
    ) internal virtual override whenNotPaused(_dstEid) returns (uint256 amountSentLD, uint256 amountReceivedLD) {
        (amountSentLD, amountReceivedLD) = _debitView(_amountLD, _minAmountLD, _dstEid);

        /// @dev Apply rate limit.
        _outflow(_dstEid, _from, amountReceivedLD);

        /// @dev Fee is already received at this point, transfer to fee deposit.
        if (amountSentLD > amountReceivedLD) {
            unchecked {
                uint256 fee = amountSentLD - amountReceivedLD;
                address recipient = feeDeposit();
                (bool success, bytes memory data) = payable(recipient).call{ value: fee }("");
                if (!success) revert FeeTransferFailed(recipient, fee, data);
            }
        }
    }

    /**
     * @dev Override to apply rate limit.
     * @inheritdoc OFTCoreBaseUpgradeable
     */
    function _credit(
        address _to,
        uint256 _amountLD,
        uint32 _srcEid
    ) internal virtual override returns (uint256 amountReceivedLD) {
        /// @dev We assume `_amountLD` is equal to `amountReceivedLD`.
        _inflow(_srcEid, _to, _amountLD);

        /// @dev Transfer tokens to the recipient.
        (bool success, bytes memory data) = payable(_to).call{ value: _amountLD }("");
        if (!success) {
            revert CreditFailed(_to, _amountLD, data);
        }

        /// @dev In the case of a non-default OFT adapter, `_amountLD` might not be equal to `amountReceivedLD`.
        return _amountLD;
    }

    /**
     * @dev Overridden to be empty as this assertion is done higher up on the overridden `send` function.
     * @inheritdoc OAppSenderUpgradeable
     */
    function _payNative(uint256 _nativeFee) internal virtual override returns (uint256) {
        /// @dev `msg.value` includes both the OFT amount and the messaging fee.
        return _nativeFee;
    }
}
