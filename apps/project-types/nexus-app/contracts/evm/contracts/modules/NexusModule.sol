// SPDX-License-Identifier: MIT
pragma solidity ^0.8.22;

import { IAccessControl } from "@openzeppelin/contracts/access/IAccessControl.sol";

import { INexusModule } from "../interfaces/INexusModule.sol";

/**
 * @title NexusModule
 * @author LayerZero Labs (tinom.eth)
 * @custom:version 1.0.0
 * @notice Abstract base for Nexus module contracts. Provides authentication modifiers that delegate access control to
 *         the Nexus contract, and shared constants for priority-based key resolution.
 * @dev A composite Nexus ID has the layout `(tokenId << 32) | eid`. The masks below extract partial keys for the
 *      4-level priority resolution hierarchy (checked in this order, least-specific first):
 *      1. Global:           `GLOBAL_KEY` — all pathways
 *      2. Destination-only: `nexusId & DESTINATION_KEY_MASK` — all tokens for a destination
 *      3. Token-only:       `nexusId & TOKEN_KEY_MASK` — all destinations for a token
 *      4. Composite:        `nexusId` itself — specific (tokenId, eid) pair
 */
abstract contract NexusModule is INexusModule {
    /// @dev Extracts the token-only key: `nexusId & TOKEN_KEY_MASK == tokenId << 32`.
    uint256 internal constant TOKEN_KEY_MASK = 0xFFFFFFFF00000000;

    /// @dev Extracts the destination-only key: `nexusId & DESTINATION_KEY_MASK == eid`.
    uint256 internal constant DESTINATION_KEY_MASK = 0xFFFFFFFF;

    /// @dev Config key that applies to all pathways.
    uint256 internal constant GLOBAL_KEY = 0;

    /// @dev Sentinel priority that triggers an immediate early return in resolution.
    uint128 internal constant MAX_PRIORITY = type(uint128).max;

    /// @dev Nexus hub contract.
    address internal immutable NEXUS;

    /**
     * @notice Restricts function access to the Nexus contract.
     */
    modifier onlyNexus() {
        if (msg.sender != NEXUS) revert OnlyNexus();
        _;
    }

    /**
     * @notice Restricts function access to callers that hold the specified role on the Nexus contract.
     * @param _role Role required to call the function
     */
    modifier onlyNexusRole(bytes32 _role) {
        if (!IAccessControl(NEXUS).hasRole(_role, msg.sender)) revert UnauthorizedRole(_role, msg.sender);
        _;
    }

    /**
     * @dev Sets the immutable Nexus address.
     * @param _nexus Nexus contract address
     */
    constructor(address _nexus) {
        if (_nexus == address(0)) revert InvalidNexus();
        NEXUS = _nexus;
    }

    /**
     * @inheritdoc INexusModule
     */
    function nexus() public view virtual returns (address nexusAddress) {
        return NEXUS;
    }

    /**
     * @notice Checks that the caller has the specified role on the Nexus contract.
     * @dev Equivalent to `AccessControl._checkRole(bytes32)`.
     * @param _role Role required to call the function
     */
    function _checkRole(bytes32 _role) internal view {
        if (!IAccessControl(NEXUS).hasRole(_role, msg.sender)) revert UnauthorizedRole(_role, msg.sender);
    }

    /**
     * @notice Decomposes a composite Nexus ID into EID and token ID.
     * @dev Nexus ID layout: `(tokenId << 32) | eid`.
     * @param _nexusId Composite Nexus identifier
     * @return eid Endpoint ID
     * @return tokenId Token identifier
     */
    function _decodeNexusId(uint256 _nexusId) internal pure returns (uint32 eid, uint32 tokenId) {
        assembly {
            eid := and(_nexusId, DESTINATION_KEY_MASK)
            tokenId := shr(32, and(_nexusId, TOKEN_KEY_MASK))
        }
    }
}
