// SPDX-License-Identifier: MIT
pragma solidity ^0.8.22;

import { ICreditRedirect } from "@layerzerolabs/utils-evm-contracts/contracts/interfaces/ICreditRedirect.sol";
import { AccessControl2StepUpgradeable } from "./../access/AccessControl2StepUpgradeable.sol";
import { CreditRedirectBaseUpgradeable } from "./CreditRedirectBaseUpgradeable.sol";

/**
 * @title CreditRedirectRBACUpgradeable
 * @author LayerZero Labs (tinom.eth)
 * @custom:version 1.0.0
 * @notice Abstract upgradeable contract that implements configuration to redirect credits from non-allowlisted
 *         addresses to an escrow address.
 * @dev Exposes public management functions through `AccessControl2StepUpgradeable`.
 */
abstract contract CreditRedirectRBACUpgradeable is CreditRedirectBaseUpgradeable, AccessControl2StepUpgradeable {
    /**
     * @notice Initializes the contract.
     * @dev This function is empty on purpose, as no custom logic is needed.
     */
    function __CreditRedirectRBAC_init() internal onlyInitializing {}

    /**
     * @notice Unchained initialization function for the contract.
     * @dev This function is empty on purpose, as no custom logic is needed.
     */
    function __CreditRedirectRBAC_init_unchained() internal onlyInitializing {}

    /**
     * @inheritdoc ICreditRedirect
     */
    function setCreditRedirectConfig(
        CreditRedirectConfig calldata _config
    ) public virtual onlyRole(DEFAULT_ADMIN_ROLE) {
        _setCreditRedirectConfig(_config);
    }
}
