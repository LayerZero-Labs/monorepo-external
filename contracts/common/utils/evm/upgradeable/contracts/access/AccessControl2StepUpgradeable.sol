// SPDX-License-Identifier: MIT
pragma solidity ^0.8.22;

import { IAccessControl2Step } from "@layerzerolabs/utils-evm-impl/contracts/interfaces/IAccessControl2Step.sol";
import { AccessControlUpgradeable } from "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import { AccessControlEnumerableUpgradeable } from "@openzeppelin/contracts-upgradeable/access/extensions/AccessControlEnumerableUpgradeable.sol";

/**
 * @title AccessControl2StepUpgradeable
 * @author LayerZero Labs (tinom.eth)
 * @custom:version 1.0.0
 * @notice Abstract upgradeable contract that extends `AccessControlEnumerable` with a two-step transfer mechanism for
 *         the `DEFAULT_ADMIN_ROLE`, similar to `AccessControlDefaultAdminRules`. It does not enforce delayed transfers.
 * @dev The `DEFAULT_ADMIN_ROLE` cannot be granted or revoked through the standard `grantRole` and `revokeRole`
 *      functions. Instead, a two-step process is enforced:
 *      1. The current admin calls `beginDefaultAdminTransfer(newAdmin)`.
 *      2. The pending admin calls `acceptDefaultAdminTransfer()`.
 *      The current default admin can cancel a pending transfer via `beginDefaultAdminTransfer(address(0))`.
 *      Renouncing the `DEFAULT_ADMIN_ROLE` is not permitted.
 */
abstract contract AccessControl2StepUpgradeable is IAccessControl2Step, AccessControlEnumerableUpgradeable {
    /// @custom:storage-location erc7201:layerzerov2.storage.accesscontrol2step
    struct AccessControl2StepStorage {
        address _pendingDefaultAdmin;
        address _currentDefaultAdmin;
    }

    // keccak256(abi.encode(uint256(keccak256("layerzerov2.storage.accesscontrol2step")) - 1)) & ~bytes32(uint256(0xff))
    bytes32 private constant ACCESS_CONTROL_2_STEP_STORAGE_LOCATION =
        0x9ab055b8fb8e38b861ceee93a65f20f7a2382a86570a6abe934fe7edfac60400;

    /**
     * @notice Internal function to get the contract storage.
     * @return $ Storage pointer
     */
    function _getAccessControl2StepStorage() internal pure returns (AccessControl2StepStorage storage $) {
        assembly {
            $.slot := ACCESS_CONTROL_2_STEP_STORAGE_LOCATION
        }
    }

    /**
     * @notice Initializes the contract.
     * @param _initialDefaultAdmin Default admin address
     */
    function __AccessControl2Step_init(address _initialDefaultAdmin) internal onlyInitializing {
        __AccessControl2Step_init_unchained(_initialDefaultAdmin);
    }

    /**
     * @notice Unchained initialization function for the contract.
     * @param _initialDefaultAdmin Default admin address
     */
    function __AccessControl2Step_init_unchained(address _initialDefaultAdmin) internal onlyInitializing {
        if (_initialDefaultAdmin == address(0)) {
            revert InvalidDefaultAdmin(address(0));
        }
        AccessControl2StepStorage storage $ = _getAccessControl2StepStorage();
        $._currentDefaultAdmin = _initialDefaultAdmin;
        /// @dev Bypass `DEFAULT_ADMIN_ROLE` check.
        super._grantRole(DEFAULT_ADMIN_ROLE, _initialDefaultAdmin);
    }

    // ============ Getters ============

    /**
     * @inheritdoc IAccessControl2Step
     */
    function defaultAdmin() public view virtual returns (address defaultAdminAddress) {
        return _getAccessControl2StepStorage()._currentDefaultAdmin;
    }

    /**
     * @inheritdoc IAccessControl2Step
     */
    function pendingDefaultAdmin() public view virtual returns (address pendingDefaultAdminAddress) {
        return _getAccessControl2StepStorage()._pendingDefaultAdmin;
    }

    // ============ Setters ============

    /**
     * @inheritdoc IAccessControl2Step
     */
    function beginDefaultAdminTransfer(address _newAdmin) public virtual onlyRole(DEFAULT_ADMIN_ROLE) {
        AccessControl2StepStorage storage $ = _getAccessControl2StepStorage();
        $._pendingDefaultAdmin = _newAdmin;
        emit DefaultAdminTransferStarted(_newAdmin);
    }

    /**
     * @inheritdoc IAccessControl2Step
     */
    function acceptDefaultAdminTransfer() public virtual {
        AccessControl2StepStorage storage $ = _getAccessControl2StepStorage();

        address pendingAdmin = $._pendingDefaultAdmin;
        if (pendingAdmin != _msgSender()) {
            revert CallerNotPendingAdmin(pendingAdmin);
        }

        /// @dev Bypass `DEFAULT_ADMIN_ROLE` check.
        super._revokeRole(DEFAULT_ADMIN_ROLE, $._currentDefaultAdmin);
        super._grantRole(DEFAULT_ADMIN_ROLE, pendingAdmin);

        $._currentDefaultAdmin = pendingAdmin;
        delete $._pendingDefaultAdmin;
    }

    // ============ Overrides ============

    /**
     * @dev Override to prevent granting `DEFAULT_ADMIN_ROLE`.
     * @inheritdoc AccessControlEnumerableUpgradeable
     */
    function _grantRole(bytes32 role, address account) internal virtual override returns (bool) {
        if (role == DEFAULT_ADMIN_ROLE) {
            revert AccessControlEnforcedDefaultAdminRules();
        }
        return super._grantRole(role, account);
    }

    /**
     * @dev Override to prevent revoking `DEFAULT_ADMIN_ROLE`.
     * @inheritdoc AccessControlEnumerableUpgradeable
     */
    function _revokeRole(bytes32 role, address account) internal virtual override returns (bool) {
        if (role == DEFAULT_ADMIN_ROLE) {
            revert AccessControlEnforcedDefaultAdminRules();
        }
        return super._revokeRole(role, account);
    }

    /**
     * @dev Override to prevent updating the admin of the `DEFAULT_ADMIN_ROLE`.
     * @inheritdoc AccessControlUpgradeable
     */
    function _setRoleAdmin(bytes32 role, bytes32 adminRole) internal virtual override {
        if (role == DEFAULT_ADMIN_ROLE) {
            revert AccessControlEnforcedDefaultAdminRules();
        }
        super._setRoleAdmin(role, adminRole);
    }
}
