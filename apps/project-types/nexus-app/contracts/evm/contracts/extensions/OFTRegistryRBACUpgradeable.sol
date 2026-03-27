// SPDX-License-Identifier: MIT
pragma solidity ^0.8.22;

import { AccessControl2StepUpgradeable } from "@layerzerolabs/utils-evm-upgradeable-impl/contracts/access/AccessControl2StepUpgradeable.sol";
import { IOFTRegistry } from "./../interfaces/IOFTRegistry.sol";
import { OFTRegistryBaseUpgradeable } from "./OFTRegistryBaseUpgradeable.sol";

/**
 * @title OFTRegistryRBACUpgradeable
 * @author LayerZero Labs (@TRileySchwarz)
 * @custom:version 1.0.0
 * @notice Abstract upgradeable contract that implements OFT registry functionality with RBAC access control.
 * @dev Exposes public management functions through `AccessControl2StepUpgradeable`.
 */
abstract contract OFTRegistryRBACUpgradeable is OFTRegistryBaseUpgradeable, AccessControl2StepUpgradeable {
    /// @notice Role for registering and deregistering tokens.
    bytes32 public constant TOKEN_REGISTRAR_ROLE = keccak256("TOKEN_REGISTRAR_ROLE");

    /**
     * @dev Sets immutable variables.
     * @param _localDecimals Local decimals for tokens on this chain
     */
    constructor(uint8 _localDecimals) OFTRegistryBaseUpgradeable(_localDecimals) {}

    /**
     * @notice Initializes the contract.
     * @dev This function is empty on purpose, as no custom logic is needed.
     */
    function __OFTRegistryRBAC_init() internal onlyInitializing {}

    /**
     * @notice Unchained initialization function for the contract.
     * @dev This function is empty on purpose, as no custom logic is needed.
     */
    function __OFTRegistryRBAC_init_unchained() internal onlyInitializing {}

    /**
     * @inheritdoc IOFTRegistry
     */
    function registerToken(
        uint32 _tokenId,
        address _oftAddress,
        address _burnerMinterAddress
    ) public virtual onlyRole(TOKEN_REGISTRAR_ROLE) {
        _registerToken(_tokenId, _oftAddress, _burnerMinterAddress);
    }

    /**
     * @inheritdoc IOFTRegistry
     */
    function deregisterToken(uint32 _tokenId) public virtual onlyRole(TOKEN_REGISTRAR_ROLE) {
        _deregisterToken(_tokenId);
    }
}
