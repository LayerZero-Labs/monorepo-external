// SPDX-License-Identifier: MIT
pragma solidity ^0.8.22;

import { IOAppMsgInspection } from "@layerzerolabs/oapp-evm-impl/contracts/interfaces/IOAppMsgInspection.sol";
import { AccessControl2StepUpgradeable } from "@layerzerolabs/utils-evm-upgradeable-impl/contracts/access/AccessControl2StepUpgradeable.sol";
import { OAppMsgInspectionBaseUpgradeable } from "./OAppMsgInspectionBaseUpgradeable.sol";

/**
 * @title OAppMsgInspectionRBACUpgradeable
 * @author LayerZero Labs (@TRileySchwarz, tinom.eth)
 * @custom:version 1.0.0
 * @notice Abstract upgradeable contract that implements message inspector functionality.
 * @dev Exposes public management functions through `AccessControl2StepUpgradeable`.
 */
abstract contract OAppMsgInspectionRBACUpgradeable is OAppMsgInspectionBaseUpgradeable, AccessControl2StepUpgradeable {
    /**
     * @notice Initializes the contract.
     * @dev This function is empty on purpose, as no custom logic is needed.
     */
    function __OAppMsgInspectionRBAC_init() internal onlyInitializing {}

    /**
     * @notice Unchained initialization function for the contract.
     * @dev This function is empty on purpose, as no custom logic is needed.
     */
    function __OAppMsgInspectionRBAC_init_unchained() internal onlyInitializing {}

    /**
     * @inheritdoc IOAppMsgInspection
     */
    function setMsgInspector(address _msgInspector) public virtual onlyRole(DEFAULT_ADMIN_ROLE) {
        _setMsgInspector(_msgInspector);
    }
}
