// SPDX-License-Identifier: MIT
pragma solidity ^0.8.22;

/**
 * @title IFeeConfig
 * @author LayerZero Labs (@TRileySchwarz, tinom.eth)
 * @custom:version 1.0.0
 * @notice Interface for the `FeeConfig` contract.
 */
interface IFeeConfig {
    /**
     * @notice Configuration for a fee.
     * @param feeBps Fee basis points (BPS)
     * @param enabled False to fallback to the default fee basis points (BPS)
     */
    struct FeeConfig {
        uint16 feeBps;
        bool enabled;
    }

    /**
     * @notice Emitted when the fee basis points (BPS) are set for a specific destination ID.
     * @param id Destination ID
     * @param feeBps Fee basis points (BPS)
     * @param enabled Whether the fee is enabled for the destination
     */
    event FeeBpsSet(uint256 id, uint16 feeBps, bool enabled);

    /**
     * @notice Emitted when the default fee basis points (BPS) are set.
     * @param feeBps Default fee basis points (BPS)
     */
    event DefaultFeeBpsSet(uint16 feeBps);

    /**
     * @notice Thrown when the fee basis points (BPS) are invalid.
     * @param feeBps Invalid fee basis points (BPS)
     */
    error InvalidBps(uint16 feeBps);

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

    /**
     * @notice Retrieves default fee basis points (BPS) used if no fee is configured for the destination ID.
     * @return fee Default fee basis points (BPS)
     */
    function defaultFeeBps() external view returns (uint16 fee);

    /**
     * @notice Retrieves the configured fee for a given ID.
     * @param _id Destination ID
     * @return config Configured fee for the destination ID
     */
    function feeBps(uint256 _id) external view returns (FeeConfig memory config);

    /**
     * @notice Set the default fee basis points (BPS) for all destinations.
     * @param _feeBps New default fee basis points (BPS)
     */
    function setDefaultFeeBps(uint16 _feeBps) external;

    /**
     * @notice Sets the fee basis points for a specific destination ID.
     * @param _id Destination ID
     * @param _feeBps Fee basis points to set
     * @param _enabled Whether the fee is enabled for the destination
     */
    function setFeeBps(uint256 _id, uint16 _feeBps, bool _enabled) external;
}
