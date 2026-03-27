// SPDX-License-Identifier: MIT
pragma solidity ^0.8.22;

import { IAllowlist } from "@layerzerolabs/utils-evm-impl/contracts/interfaces/IAllowlist.sol";
import { AccessControl2StepUpgradeable } from "./../access/AccessControl2StepUpgradeable.sol";
import { AllowlistBaseUpgradeable } from "./AllowlistBaseUpgradeable.sol";

/**
 * @title AllowlistRBACUpgradeable
 * @author LayerZero Labs (tinom.eth)
 * @custom:version 1.0.0
 * @notice Abstract upgradeable contract that provides toggleable allowlist functionality between open, blacklist, and
 *         whitelist modes.
 * @dev Exposes public management functions through `AccessControl2StepUpgradeable`.
 */
abstract contract AllowlistRBACUpgradeable is AllowlistBaseUpgradeable, AccessControl2StepUpgradeable {
    /// @notice Role for setting the blacklist state for users.
    bytes32 public constant BLACKLISTER_ROLE = keccak256("BLACKLISTER_ROLE");

    /// @notice Role for setting the whitelist state for users.
    bytes32 public constant WHITELISTER_ROLE = keccak256("WHITELISTER_ROLE");

    /**
     * @notice Initializes the contract.
     * @dev This function is empty on purpose, as no custom logic is needed.
     */
    function __AllowlistRBAC_init() internal onlyInitializing {}

    /**
     * @notice Unchained initialization function for the contract.
     * @dev This function is empty on purpose, as no custom logic is needed.
     */
    function __AllowlistRBAC_init_unchained() internal onlyInitializing {}

    /**
     * @inheritdoc IAllowlist
     */
    function setAllowlistMode(AllowlistMode _mode) public virtual onlyRole(DEFAULT_ADMIN_ROLE) {
        _setAllowlistMode(_mode);
    }

    /**
     * @inheritdoc IAllowlist
     */
    function setBlacklisted(SetAllowlistParam[] calldata _params) public virtual onlyRole(BLACKLISTER_ROLE) {
        _setBlacklisted(_params);
    }

    /**
     * @inheritdoc IAllowlist
     */
    function setWhitelisted(SetAllowlistParam[] calldata _params) public virtual onlyRole(WHITELISTER_ROLE) {
        _setWhitelisted(_params);
    }
}
