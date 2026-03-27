// SPDX-License-Identifier: MIT
pragma solidity ^0.8.22;

/**
 * @title INexusModule
 * @author LayerZero Labs (tinom.eth)
 * @custom:version 1.0.0
 * @notice Interface for Nexus modules. Modules delegate access control to the Nexus contract.
 */
interface INexusModule {
    /**
     * @notice Thrown when the provided Nexus address is invalid.
     */
    error InvalidNexus();

    /**
     * @notice Thrown when the caller is not the Nexus contract.
     */
    error OnlyNexus();

    /**
     * @notice Thrown when the caller does not have the required role on the Nexus contract.
     * @param role Role required to call the function
     * @param caller Address of the unauthorized caller
     */
    error UnauthorizedRole(bytes32 role, address caller);

    /**
     * @notice Returns the Nexus contract address.
     * @return nexusAddress Nexus contract address
     */
    function nexus() external view returns (address nexusAddress);
}
