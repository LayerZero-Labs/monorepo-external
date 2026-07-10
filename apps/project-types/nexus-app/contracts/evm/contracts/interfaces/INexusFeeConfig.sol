// SPDX-License-Identifier: MIT
pragma solidity ^0.8.22;

/**
 * @title INexusFeeConfig
 * @author LayerZero Labs (tinom.eth)
 * @custom:version 1.0.0
 * @notice Minimal interface for the Nexus fee configuration extension. Contains only the functions called by Nexus.
 */
interface INexusFeeConfig {
    /**
     * @notice Retrieves the fee for a destination ID and amount.
     * @param _id Destination ID
     * @param _amount Amount to calculate the fee for
     * @return fee Fee amount
     */
    function getFee(uint256 _id, uint256 _amount) external view returns (uint256 fee);

    /**
     * @notice Retrieves the pre-fee amount required to yield a given post-fee amount.
     * @param _id Destination ID
     * @param _amountAfterFee Desired amount after fees
     * @return amountBeforeFee Required amount before fees
     */
    function getAmountBeforeFee(uint256 _id, uint256 _amountAfterFee) external view returns (uint256 amountBeforeFee);
}
