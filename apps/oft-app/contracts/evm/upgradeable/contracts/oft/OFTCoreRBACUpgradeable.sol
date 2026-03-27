// SPDX-License-Identifier: MIT
pragma solidity ^0.8.22;

import { OAppMsgInspectionRBACUpgradeable } from "@layerzerolabs/oapp-evm-upgradeable-impl/contracts/oapp/msg-inspection/OAppMsgInspectionRBACUpgradeable.sol";
import { OAppCoreRBACUpgradeable } from "@layerzerolabs/oapp-evm-upgradeable-impl/contracts/oapp/OAppCoreRBACUpgradeable.sol";
import { OAppOptionsType3RBACUpgradeable } from "@layerzerolabs/oapp-evm-upgradeable-impl/contracts/oapp/options-type-3/OAppOptionsType3RBACUpgradeable.sol";
import { AccessControl2StepUpgradeable } from "@layerzerolabs/utils-evm-upgradeable-impl/contracts/access/AccessControl2StepUpgradeable.sol";
import { OFTCoreBaseUpgradeable } from "./OFTCoreBaseUpgradeable.sol";

/**
 * @title OFTCoreRBACUpgradeable
 * @author LayerZero Labs
 * @custom:version 1.0.0
 * @notice Abstract upgradeable contract for the OmniChain Fungible Token (OFT) with RBAC access control.
 * @dev Inherits `OFTCoreBaseUpgradeable` and adds RBAC extensions for access-controlled configuration.
 * @dev Does not initialize `AccessControl2StepUpgradeable`. Inheriting contracts must call `__AccessControl2Step_init`
 *      to set the `DEFAULT_ADMIN_ROLE`.
 */
abstract contract OFTCoreRBACUpgradeable is
    OFTCoreBaseUpgradeable,
    OAppCoreRBACUpgradeable,
    OAppOptionsType3RBACUpgradeable,
    OAppMsgInspectionRBACUpgradeable
{
    /**
     * @dev Sets immutable variables.
     * @param _localDecimals Decimals of the token on the local chain (this chain)
     * @param _endpoint Address of the LayerZero endpoint
     */
    constructor(uint8 _localDecimals, address _endpoint) OFTCoreBaseUpgradeable(_localDecimals, _endpoint) {}

    /**
     * @notice Initializes the contract.
     * @dev This function is empty on purpose, as no custom logic is needed.
     */
    function __OFTCoreRBAC_init() internal onlyInitializing {}

    /**
     * @notice Unchained initialization function for the contract.
     * @dev This function is empty on purpose, as no custom logic is needed.
     */
    function __OFTCoreRBAC_init_unchained() internal onlyInitializing {}

    /**
     * @inheritdoc OAppCoreRBACUpgradeable
     */
    function acceptDefaultAdminTransfer()
        public
        virtual
        override(OAppCoreRBACUpgradeable, AccessControl2StepUpgradeable)
    {
        super.acceptDefaultAdminTransfer();
    }
}
