// SPDX-License-Identifier: MIT
pragma solidity ^0.8.22;

/**
 * @title IOFTDecimalUtils
 * @author LayerZero Labs (tinom.eth)
 * @custom:version 1.0.0
 * @notice Interface for OFT decimal conversion utilities.
 */
interface IOFTDecimalUtils {
    /**
     * @notice Thrown when shared decimals exceed local decimals.
     */
    error InvalidLocalDecimals();

    /**
     * @notice Thrown when the amount in shared decimals overflows `uint64`.
     * @param amountSD Amount in shared decimals
     */
    error AmountSDOverflowed(uint256 amountSD);

    /**
     * @notice Returns the local decimals for tokens on this chain.
     * @return ld Local decimals
     */
    function localDecimals() external view returns (uint8 ld);

    /**
     * @notice Returns the shared decimals for cross-chain messaging.
     * @return sd Shared decimals
     */
    function sharedDecimals() external view returns (uint8 sd);

    /**
     * @notice Returns the conversion rate to convert from local to shared decimals.
     * @return rate Conversion rate
     */
    function decimalConversionRate() external view returns (uint256 rate);
}
