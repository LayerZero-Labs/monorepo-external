// SPDX-License-Identifier: MIT
pragma solidity ^0.8.22;

/**
 * @title IFeeHandler
 * @author LayerZero Labs (tinom.eth)
 * @custom:version 1.0.0
 * @notice Interface for the `FeeHandler` contract.
 */
interface IFeeHandler {
    /**
     * @notice Thrown when the fee deposit address is invalid.
     */
    error InvalidFeeDeposit();

    /**
     * @notice Emitted when the fee deposit is updated.
     * @param feeDeposit New fee deposit address
     */
    event FeeDepositSet(address indexed feeDeposit);

    /**
     * @notice Returns the address to which fees are forwarded.
     * @return deposit Address that will receive any accrued fees
     */
    function feeDeposit() external view returns (address deposit);

    /**
     * @notice Sets the fee deposit address.
     * @param _feeDeposit Address that will receive any accrued fees
     */
    function setFeeDeposit(address _feeDeposit) external;
}
