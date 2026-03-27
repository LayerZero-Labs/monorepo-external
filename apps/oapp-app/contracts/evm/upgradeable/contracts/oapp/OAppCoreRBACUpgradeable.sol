// SPDX-License-Identifier: MIT
pragma solidity ^0.8.22;

import { IOAppCore } from "@layerzerolabs/oapp-evm-impl/contracts/interfaces/IOAppCore.sol";
import { AccessControl2StepUpgradeable } from "@layerzerolabs/utils-evm-upgradeable-impl/contracts/access/AccessControl2StepUpgradeable.sol";
import { OAppCoreBaseUpgradeable } from "./OAppCoreBaseUpgradeable.sol";

/**
 * @title OAppCoreRBACUpgradeable
 * @author LayerZero Labs
 * @custom:version 1.0.0
 * @notice Abstract upgradeable contract implementing the IOAppCore interface with RBAC access control.
 * @dev Exposes public management functions through `AccessControl2StepUpgradeable`.
 * @dev Does not initialize `AccessControl2StepUpgradeable`. Inheriting contracts must call `__AccessControl2Step_init`
 *      to set the `DEFAULT_ADMIN_ROLE`.
 * @dev Endpoint delegate is permanently synced with the `DEFAULT_ADMIN_ROLE` holder. Calling `setDelegate` directly
 *      will revert. The delegate is updated automatically when `acceptDefaultAdminTransfer` is called. Inheriting
 *      contracts must call `__OAppCoreBase_init` with the initial default admin to ensure that both roles are synced on
 *      initialization.
 */
abstract contract OAppCoreRBACUpgradeable is OAppCoreBaseUpgradeable, AccessControl2StepUpgradeable {
    /**
     * @notice Thrown when `setDelegate` is called directly. The delegate is synced with `DEFAULT_ADMIN_ROLE`.
     */
    error CannotDirectlySetDelegate();

    /**
     * @notice Initializes the contract.
     * @dev This function is empty on purpose, as no custom logic is needed.
     */
    function __OAppCoreRBAC_init() internal onlyInitializing {}

    /**
     * @notice Unchained initialization function for the contract.
     * @dev This function is empty on purpose, as no custom logic is needed.
     */
    function __OAppCoreRBAC_init_unchained() internal onlyInitializing {}

    /**
     * @notice Sets the peer address (OApp instance) for a corresponding endpoint.
     * @param _eid The endpoint ID.
     * @param _peer The address of the peer to be associated with the corresponding endpoint.
     *
     * @dev Only accounts with `DEFAULT_ADMIN_ROLE` can call this function.
     * @dev Indicates that the peer is trusted to send LayerZero messages to this OApp.
     * @dev Set this to bytes32(0) to remove the peer address.
     * @dev Peer is a bytes32 to accommodate non-evm chains.
     */
    function setPeer(uint32 _eid, bytes32 _peer) public virtual onlyRole(DEFAULT_ADMIN_ROLE) {
        _setPeer(_eid, _peer);
    }

    /**
     * @dev Always reverts. The delegate is synced with `DEFAULT_ADMIN_ROLE` and transfers automatically.
     *      To change the delegate, use `beginDefaultAdminTransfer` followed by `acceptDefaultAdminTransfer`.
     * @inheritdoc IOAppCore
     */
    function setDelegate(address) public virtual {
        revert CannotDirectlySetDelegate();
    }

    /**
     * @notice Accepts a pending `DEFAULT_ADMIN_ROLE` transfer and updates the endpoint delegate.
     * @dev Overrides `AccessControl2StepUpgradeable.acceptDefaultAdminTransfer` to keep the endpoint delegate
     *      in sync with the new `DEFAULT_ADMIN_ROLE` holder.
     */
    function acceptDefaultAdminTransfer() public virtual override {
        super.acceptDefaultAdminTransfer();
        _setDelegate(defaultAdmin());
    }
}
