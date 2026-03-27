// SPDX-License-Identifier: MIT
pragma solidity ^0.8.22;

import { IFeeHandler } from "@layerzerolabs/utils-evm-impl/contracts/interfaces/IFeeHandler.sol";
import { AccessControl2StepUpgradeable } from "./../access/AccessControl2StepUpgradeable.sol";
import { FeeHandlerBaseUpgradeable } from "./FeeHandlerBaseUpgradeable.sol";

/**
 * @title FeeHandlerRBACUpgradeable
 * @author LayerZero Labs (tinom.eth)
 * @custom:version 1.0.0
 * @notice Abstract upgradeable contract that stores the fee deposit address, for push-based fee handling.
 * @dev Exposes public management functions through `AccessControl2StepUpgradeable`.
 */
abstract contract FeeHandlerRBACUpgradeable is FeeHandlerBaseUpgradeable, AccessControl2StepUpgradeable {
    /**
     * @notice Initializes the contract.
     * @dev This function is empty on purpose, as no custom logic is needed.
     */
    function __FeeHandlerRBAC_init() internal onlyInitializing {}

    /**
     * @notice Unchained initialization function for the contract.
     * @dev This function is empty on purpose, as no custom logic is needed.
     */
    function __FeeHandlerRBAC_init_unchained() internal onlyInitializing {}

    /**
     * @inheritdoc IFeeHandler
     */
    function setFeeDeposit(address _feeDeposit) public virtual onlyRole(DEFAULT_ADMIN_ROLE) {
        _setFeeDeposit(_feeDeposit);
    }
}
