// SPDX-License-Identifier: MIT
pragma solidity ^0.8.22;

import { IPause } from "@layerzerolabs/utils-evm-impl/contracts/interfaces/IPause.sol";
import { AccessControl2StepUpgradeable } from "./../access/AccessControl2StepUpgradeable.sol";
import { PauseBaseUpgradeable } from "./PauseBaseUpgradeable.sol";

/**
 * @title PauseRBACUpgradeable
 * @author LayerZero Labs (tinom.eth)
 * @custom:version 1.0.0
 * @notice Abstract upgradeable contract that provides pause functionality.
 * @dev Exposes public management functions through `AccessControl2StepUpgradeable`.
 */
abstract contract PauseRBACUpgradeable is PauseBaseUpgradeable, AccessControl2StepUpgradeable {
    /// @notice Role for pausing the contract.
    bytes32 public constant PAUSER_ROLE = keccak256("PAUSER_ROLE");

    /// @notice Role for unpausing the contract.
    bytes32 public constant UNPAUSER_ROLE = keccak256("UNPAUSER_ROLE");

    /**
     * @notice Initializes the contract.
     * @dev This function is empty on purpose, as no custom logic is needed.
     */
    function __PauseRBAC_init() internal onlyInitializing {}

    /**
     * @notice Unchained initialization function for the contract.
     * @dev This function is empty on purpose, as no custom logic is needed.
     */
    function __PauseRBAC_init_unchained() internal onlyInitializing {}

    /**
     * @inheritdoc IPause
     */
    function pause() public virtual onlyRole(PAUSER_ROLE) {
        _pause();
    }

    /**
     * @inheritdoc IPause
     */
    function unpause() public virtual onlyRole(UNPAUSER_ROLE) {
        _unpause();
    }
}
