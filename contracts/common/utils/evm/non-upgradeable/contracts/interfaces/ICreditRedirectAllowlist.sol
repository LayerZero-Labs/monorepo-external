// SPDX-License-Identifier: MIT
pragma solidity ^0.8.22;

/**
 * @title ICreditRedirectAllowlist
 * @author LayerZero Labs (tinom.eth)
 * @custom:version 1.0.0
 * @notice Interface used by the `CreditRedirect` contract to query the allowlist status of a user.
 */
interface ICreditRedirectAllowlist {
    /**
     * @notice Checks if a user is allowlisted.
     * @param _user User address
     * @return isUserAllowlisted Whether the user is allowlisted
     */
    function isAllowlisted(address _user) external view returns (bool isUserAllowlisted);
}
