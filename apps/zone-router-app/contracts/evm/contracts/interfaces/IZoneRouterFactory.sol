// SPDX-License-Identifier: MIT
pragma solidity ^0.8.22;

import { IZoneRouter } from "./IZoneRouter.sol";

/**
 * @title IZoneRouterFactory
 * @author LayerZero Labs
 * @custom:version 1.0.0
 * @notice Interface for the `ZoneRouterFactory` contract.
 */
interface IZoneRouterFactory {
    /**
     * @notice Emitted when a `ZoneRouter` ERC1967 proxy is deployed.
     * @param initialOwner Initial router owner
     * @param token ERC20 token
     * @param salt CREATE2 salt
     * @param router Deployed router
     */
    event RouterDeployed(address indexed initialOwner, address indexed token, bytes32 indexed salt, address router);

    /**
     * @notice Thrown when the implementation has no code.
     */
    error InvalidImplementation();

    /**
     * @notice Returns the implementation used by deployed router ERC1967 proxies.
     * @return implementation Router implementation
     */
    function IMPLEMENTATION() external view returns (address implementation);

    /**
     * @notice Returns whether this factory deployed a router.
     * @dev The mapping is at storage slot 0.
     * @param _router Router address
     * @return deployed Whether this factory deployed the router
     */
    function isRouter(address _router) external view returns (bool deployed);

    /**
     * @notice Deploys a `ZoneRouter` ERC1967 proxy for the specified owner.
     * @dev The implementation address and full initialization configuration also affect the CREATE2 address.
     * @param _initialOwner Initial router owner
     * @param _config Token settlement configuration
     * @param _salt Deployment salt
     * @return router Deployed router
     */
    function deploy(
        address _initialOwner,
        IZoneRouter.Config calldata _config,
        bytes32 _salt
    ) external returns (address router);
}
