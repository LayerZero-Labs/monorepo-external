// SPDX-License-Identifier: MIT
pragma solidity ^0.8.22;

import { IAccessControlEnumerable } from "@openzeppelin/contracts/access/extensions/IAccessControlEnumerable.sol";

/**
 * @title IAccessControl2Step
 * @author LayerZero Labs (tinom.eth)
 * @custom:version 1.0.0
 * @notice Interface for the `AccessControl2Step` contract.
 */
interface IAccessControl2Step is IAccessControlEnumerable {
    /**
     * @notice Thrown when the intended default admin is invalid.
     * @param defaultAdmin Invalid default admin address
     */
    error InvalidDefaultAdmin(address defaultAdmin);

    /**
     * @notice Thrown when one of the following rules is violated:
     *         - The `DEFAULT_ADMIN_ROLE` must only be managed by itself.
     *         - The `DEFAULT_ADMIN_ROLE` must only be held by one account at the time.
     *         - Any `DEFAULT_ADMIN_ROLE` transfer must be in two steps.
     */
    error AccessControlEnforcedDefaultAdminRules();

    /**
     * @notice Thrown when the caller is not the pending admin.
     * @param pendingAdmin Address of the pending admin
     */
    error CallerNotPendingAdmin(address pendingAdmin);

    /**
     * @notice Emitted when a `DEFAULT_ADMIN_ROLE` transfer is started.
     * @param newAdmin Address of the new pending default admin
     */
    event DefaultAdminTransferStarted(address indexed newAdmin);

    /**
     * @notice Returns the address of the current `DEFAULT_ADMIN_ROLE` holder.
     * @return defaultAdminAddress Address of the current `DEFAULT_ADMIN_ROLE` holder
     */
    function defaultAdmin() external view returns (address defaultAdminAddress);

    /**
     * @notice Returns the address of the account that can claim the `DEFAULT_ADMIN_ROLE` by calling
     *         `acceptDefaultAdminTransfer`.
     * @return pendingDefaultAdminAddress Address of the pending `DEFAULT_ADMIN_ROLE` account
     */
    function pendingDefaultAdmin() external view returns (address pendingDefaultAdminAddress);

    /**
     * @notice Starts a `DEFAULT_ADMIN_ROLE` transfer by setting a `pendingDefaultAdmin`.
     * @dev It can cancel an existing pending transfer by setting the `newAdmin` to `address(0)`.
     * @param newAdmin Address of the new pending default admin
     */
    function beginDefaultAdminTransfer(address newAdmin) external;

    /**
     * @notice Completes a `DEFAULT_ADMIN_ROLE` transfer previously started with `beginDefaultAdminTransfer`.
     */
    function acceptDefaultAdminTransfer() external;
}
