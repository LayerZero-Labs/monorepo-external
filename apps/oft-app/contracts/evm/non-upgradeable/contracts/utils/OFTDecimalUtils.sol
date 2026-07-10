// SPDX-License-Identifier: MIT
pragma solidity ^0.8.22;

import { IOFTDecimalUtils } from "../interfaces/IOFTDecimalUtils.sol";

/**
 * @title OFTDecimalUtils
 * @author LayerZero Labs (@TRileySchwarz, tinom.eth)
 * @custom:version 1.0.0
 * @notice Abstract contract that implements decimal conversion utilities between local and shared decimals.
 * @dev It can be inherited in either upgradeable or non-upgradeable contracts.
 */
abstract contract OFTDecimalUtils is IOFTDecimalUtils {
    /// @dev Immutable variable for local decimals.
    uint8 private immutable LOCAL_DECIMALS;

    /// @dev Immutable variable for shared decimals.
    uint8 private immutable SHARED_DECIMALS;

    /// @dev Immutable variable for the conversion rate between local and shared decimals.
    uint256 private immutable DECIMAL_CONVERSION_RATE;

    /**
     * @dev Sets immutable variables.
     * @dev Reverts if the shared decimals are greater than the local decimals.
     * @param _localDecimals Local decimals for tokens on this chain
     * @param _sharedDecimals Shared decimals for cross-chain messaging
     */
    constructor(uint8 _localDecimals, uint8 _sharedDecimals) {
        if (_sharedDecimals > _localDecimals) revert InvalidLocalDecimals();

        LOCAL_DECIMALS = _localDecimals;
        SHARED_DECIMALS = _sharedDecimals;
        DECIMAL_CONVERSION_RATE = 10 ** (_localDecimals - _sharedDecimals);
    }

    /**
     * @inheritdoc IOFTDecimalUtils
     */
    function localDecimals() public view virtual returns (uint8 ld) {
        return LOCAL_DECIMALS;
    }

    /**
     * @inheritdoc IOFTDecimalUtils
     */
    function sharedDecimals() public view virtual returns (uint8 sd) {
        return SHARED_DECIMALS;
    }

    /**
     * @inheritdoc IOFTDecimalUtils
     */
    function decimalConversionRate() public view virtual returns (uint256 rate) {
        return DECIMAL_CONVERSION_RATE;
    }

    /**
     * @notice Removes dust from the given local decimal amount.
     * @dev Prevents the loss of dust when moving amounts between chains with different decimals.
     * @param _amountLD Amount in local decimals
     * @return amountLD Amount after removing dust
     */
    function _removeDust(uint256 _amountLD) internal view virtual returns (uint256 amountLD) {
        return (_amountLD / DECIMAL_CONVERSION_RATE) * DECIMAL_CONVERSION_RATE;
    }

    /**
     * @notice Converts an amount from shared decimals into local decimals.
     * @param _amountSD Amount in shared decimals
     * @return amountLD Amount in local decimals
     */
    function _toLD(uint64 _amountSD) internal view virtual returns (uint256 amountLD) {
        return _amountSD * DECIMAL_CONVERSION_RATE;
    }

    /**
     * @notice Converts an amount from local decimals into shared decimals.
     * @dev Reverts if the amount in shared decimals overflows `uint64`.
     * @param _amountLD Amount in local decimals
     * @return amountSD Amount in shared decimals
     */
    function _toSD(uint256 _amountLD) internal view virtual returns (uint64 amountSD) {
        uint256 _amountSD = _amountLD / DECIMAL_CONVERSION_RATE;
        if (_amountSD > type(uint64).max) revert AmountSDOverflowed(_amountSD);
        return uint64(_amountSD);
    }
}
