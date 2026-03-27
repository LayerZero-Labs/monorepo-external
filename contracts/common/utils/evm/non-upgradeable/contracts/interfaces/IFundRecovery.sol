// SPDX-License-Identifier: MIT
pragma solidity ^0.8.22;

/**
 * @title IFundRecovery
 * @author LayerZero Labs (tinom.eth)
 * @custom:version 1.0.0
 * @notice Interface for ERC20 contracts implementing fund recovery functionality.
 */
interface IFundRecovery {
    /**
     * @notice Recovers funds from a non-allowlisted address.
     * @dev Only recovers from non-allowlisted `_from` address.
     * @param _from Address to recover funds from
     * @param _to Address to send the recovered funds to
     * @param _amount Amount of funds to recover
     */
    function recoverFunds(address _from, address _to, uint256 _amount) external;
}
