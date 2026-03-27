// SPDX-License-Identifier: MIT
pragma solidity ^0.8.22;

import { IPauseByID } from "@layerzerolabs/utils-evm-impl/contracts/interfaces/IPauseByID.sol";
import { AccessControl2StepUpgradeable } from "./../access/AccessControl2StepUpgradeable.sol";
import { PauseByIDBaseUpgradeable } from "./PauseByIDBaseUpgradeable.sol";

/**
 * @title PauseByIDRBACUpgradeable
 * @author LayerZero Labs (tinom.eth)
 * @custom:version 1.0.0
 * @notice Abstract upgradeable contract that implements pause configuration and enforcement per ID.
 * @dev Exposes public management functions through `AccessControl2StepUpgradeable`.
 */
abstract contract PauseByIDRBACUpgradeable is PauseByIDBaseUpgradeable, AccessControl2StepUpgradeable {
    /// @notice Role for pausing the contract.
    bytes32 public constant PAUSER_ROLE = keccak256("PAUSER_ROLE");

    /// @notice Role for unpausing the contract.
    bytes32 public constant UNPAUSER_ROLE = keccak256("UNPAUSER_ROLE");

    /**
     * @notice Initializes the contract.
     * @dev This function is empty on purpose, as no custom logic is needed.
     */
    function __PauseByIDRBAC_init() internal onlyInitializing {}

    /**
     * @notice Unchained initialization function for the contract.
     * @dev This function is empty on purpose, as no custom logic is needed.
     */
    function __PauseByIDRBAC_init_unchained() internal onlyInitializing {}

    /**
     * @inheritdoc IPauseByID
     */
    function setDefaultPaused(bool _paused) public virtual {
        _paused ? _checkRole(PAUSER_ROLE) : _checkRole(UNPAUSER_ROLE);
        _setDefaultPaused(_paused);
    }

    /**
     * @dev Caller must have both `PAUSER_ROLE` and `UNPAUSER_ROLE` if setting mixed pause states.
     *      Role checks are based on the effective pause state, accounting for the `enabled` flag and `defaultPaused`
     *      fallback.
     * @dev Requires the more restrictive `UNPAUSER_ROLE` for no-ops.
     * @inheritdoc IPauseByID
     */
    function setPaused(SetPausedParam[] calldata _params) public virtual {
        bool needsPauser;
        bool needsUnpauser;
        bool _defaultPaused = defaultPaused();

        for (uint256 i = 0; i < _params.length; i++) {
            /// @dev Determine if the operation effectively pauses or unpauses the ID.
            ///      It's safe to ignore `_params[i].paused` if the ID is not enabled, since it'll be ignored and this
            ///      function is the entrypoint for ID configuration, which disallows privilege escalation.
            if (_params[i].enabled ? _params[i].paused : _defaultPaused) {
                needsPauser = true;
            } else {
                needsUnpauser = true;
            }

            /// @dev Early exit if both roles are needed.
            if (needsPauser && needsUnpauser) break;
        }

        if (needsPauser) _checkRole(PAUSER_ROLE);
        /// @dev Avoid unauthorized no-ops.
        if (needsUnpauser || !needsPauser) _checkRole(UNPAUSER_ROLE);

        _setPaused(_params);
    }
}
