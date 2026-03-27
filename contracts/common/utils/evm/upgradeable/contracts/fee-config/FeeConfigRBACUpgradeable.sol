// SPDX-License-Identifier: MIT
pragma solidity ^0.8.22;

import { IFeeConfig } from "@layerzerolabs/utils-evm-impl/contracts/interfaces/IFeeConfig.sol";
import { AccessControl2StepUpgradeable } from "./../access/AccessControl2StepUpgradeable.sol";
import { FeeConfigBaseUpgradeable } from "./FeeConfigBaseUpgradeable.sol";

/**
 * @title FeeConfigRBACUpgradeable
 * @author LayerZero Labs (@TRileySchwarz, tinom.eth)
 * @custom:version 1.0.0
 * @notice Abstract upgradeable contract that implements fee configuration and calculation.
 * @dev Exposes public management functions through `AccessControl2StepUpgradeable`.
 */
abstract contract FeeConfigRBACUpgradeable is FeeConfigBaseUpgradeable, AccessControl2StepUpgradeable {
    /// @notice Role for setting fee basis points.
    bytes32 public constant FEE_CONFIG_MANAGER_ROLE = keccak256("FEE_CONFIG_MANAGER_ROLE");

    /**
     * @notice Initializes the contract.
     * @dev This function is empty on purpose, as no custom logic is needed.
     */
    function __FeeConfigRBAC_init() internal onlyInitializing {}

    /**
     * @notice Unchained initialization function for the contract.
     * @dev This function is empty on purpose, as no custom logic is needed.
     */
    function __FeeConfigRBAC_init_unchained() internal onlyInitializing {}

    /**
     * @inheritdoc IFeeConfig
     */
    function setDefaultFeeBps(uint16 _feeBps) public virtual onlyRole(FEE_CONFIG_MANAGER_ROLE) {
        _setDefaultFeeBps(_feeBps);
    }

    /**
     * @inheritdoc IFeeConfig
     */
    function setFeeBps(uint256 _id, uint16 _feeBps, bool _enabled) public virtual onlyRole(FEE_CONFIG_MANAGER_ROLE) {
        _setFeeBps(_id, _feeBps, _enabled);
    }
}
