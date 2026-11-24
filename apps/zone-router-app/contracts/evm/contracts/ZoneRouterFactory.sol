// SPDX-License-Identifier: MIT
pragma solidity ^0.8.22;

import { ERC1967Proxy } from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import { IZoneRouter } from "./interfaces/IZoneRouter.sol";
import { IZoneRouterFactory } from "./interfaces/IZoneRouterFactory.sol";

/**
 * @title ZoneRouterFactory
 * @author LayerZero Labs
 * @custom:version 1.0.0
 * @notice Deploys `ZoneRouter` ERC1967 proxies.
 */
contract ZoneRouterFactory is IZoneRouterFactory {
    /// @inheritdoc IZoneRouterFactory
    address public immutable IMPLEMENTATION;

    /// @inheritdoc IZoneRouterFactory
    mapping(address router => bool deployed) public isRouter;

    /**
     * @param _implementation Router implementation
     */
    constructor(address _implementation) {
        if (_implementation.code.length == 0) revert InvalidImplementation();

        IMPLEMENTATION = _implementation;
    }

    /// @inheritdoc IZoneRouterFactory
    function deploy(
        address _initialOwner,
        IZoneRouter.Config calldata _config,
        bytes32 _salt
    ) public virtual returns (address router) {
        router = address(
            new ERC1967Proxy{ salt: _salt }(
                IMPLEMENTATION,
                abi.encodeCall(IZoneRouter.initialize, (_initialOwner, _config))
            )
        );
        isRouter[router] = true;
        emit RouterDeployed(_initialOwner, _config.token, _salt, router);
    }
}
