// SPDX-License-Identifier: MIT
pragma solidity ^0.8.22;

import { IOAppOptionsType3 } from "@layerzerolabs/oapp-evm-impl/contracts/interfaces/IOAppOptionsType3.sol";
import { AccessControl2StepUpgradeable } from "@layerzerolabs/utils-evm-upgradeable-impl/contracts/access/AccessControl2StepUpgradeable.sol";
import { OAppOptionsType3BaseUpgradeable } from "./OAppOptionsType3BaseUpgradeable.sol";

/**
 * @title OAppOptionsType3RBACUpgradeable
 * @author LayerZero Labs
 * @custom:version 1.0.0
 * @notice Abstract upgradeable contract implementing the IOAppOptionsType3 interface with RBAC access control.
 * @dev Exposes public management functions through `AccessControl2StepUpgradeable`.
 */
abstract contract OAppOptionsType3RBACUpgradeable is OAppOptionsType3BaseUpgradeable, AccessControl2StepUpgradeable {
    /**
     * @notice Initializes the contract.
     * @dev This function is empty on purpose, as no custom logic is needed.
     */
    function __OAppOptionsType3RBAC_init() internal onlyInitializing {}

    /**
     * @notice Unchained initialization function for the contract.
     * @dev This function is empty on purpose, as no custom logic is needed.
     */
    function __OAppOptionsType3RBAC_init_unchained() internal onlyInitializing {}

    /**
     * @inheritdoc IOAppOptionsType3
     */
    function setEnforcedOptions(
        IOAppOptionsType3.EnforcedOptionParam[] calldata _enforcedOptions
    ) public virtual onlyRole(DEFAULT_ADMIN_ROLE) {
        _setEnforcedOptions(_enforcedOptions);
    }
}
