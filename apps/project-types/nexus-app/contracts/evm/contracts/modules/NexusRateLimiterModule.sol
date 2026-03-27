// SPDX-License-Identifier: MIT
pragma solidity ^0.8.22;

import { IRateLimiter } from "@layerzerolabs/utils-evm-impl/contracts/interfaces/IRateLimiter.sol";
import { RateLimiterBaseUpgradeable } from "@layerzerolabs/utils-evm-upgradeable-impl/contracts/rate-limiter/RateLimiterBaseUpgradeable.sol";
import { TokenScalesBaseUpgradeable } from "./../extensions/TokenScalesBaseUpgradeable.sol";
import { INexusRateLimiter } from "./../interfaces/INexusRateLimiter.sol";
import { INexusRateLimiterModule } from "./../interfaces/INexusRateLimiterModule.sol";
import { ITokenScales } from "./../interfaces/ITokenScales.sol";
import { NexusModule } from "./NexusModule.sol";

/**
 * @title NexusRateLimiterModule
 * @author LayerZero Labs (tinom.eth)
 * @custom:version 1.0.0
 * @notice Independently upgradeable rate limiter module for Nexus.
 * @dev Rate limits are tracked per-EID (per destination chain). All tokens on the same chain share a single rate limit
 *      bucket. Token amounts are scaled to a common unit (e.g., USD) via per-token scales before consumption.
 * @dev Runtime updates (`outflow` / `inflow`) are restricted to the Nexus contract.
 * @dev Admin setters authenticate callers via the Nexus contract's access control.
 */
contract NexusRateLimiterModule is
    INexusRateLimiterModule,
    RateLimiterBaseUpgradeable,
    TokenScalesBaseUpgradeable,
    NexusModule
{
    /// @notice Role for setting the rate limiter configuration.
    bytes32 public constant RATE_LIMITER_MANAGER_ROLE = keccak256("RATE_LIMITER_MANAGER_ROLE");

    /**
     * @dev Sets immutable variables.
     * @dev Rate limiter amounts are scaled through `TokenScales`, therefore no scaling decimals are required.
     * @param _nexus Address of the Nexus contract
     */
    constructor(address _nexus) NexusModule(_nexus) RateLimiterBaseUpgradeable(0) {
        _disableInitializers();
    }

    /**
     * @notice Initializes the contract.
     * @param _useGlobalState Whether to use global rules for the rate limiter, instead of per-ID rules
     */
    function initialize(bool _useGlobalState) public initializer {
        __RateLimiterBase_init(_useGlobalState);
    }

    // ============ View Functions ============

    /**
     * @inheritdoc INexusRateLimiter
     */
    function getOutboundAvailable(uint256 _id) external view virtual returns (uint256 outboundAvailableAmount) {
        (uint32 eid, uint32 tokenId) = _decodeNexusId(_id);
        (, outboundAvailableAmount, , ) = getRateLimitUsages(uint256(eid));
        if (outboundAvailableAmount == type(uint256).max) return type(uint256).max;
        return _fromScaledAmount(tokenId, outboundAvailableAmount);
    }

    // ============ Functions ============

    /**
     * @inheritdoc INexusRateLimiter
     */
    function outflow(uint256 _id, address _from, uint256 _amount) external virtual onlyNexus {
        (uint32 eid, uint32 tokenId) = _decodeNexusId(_id);
        _outflow(uint256(eid), _from, _toScaledAmount(tokenId, _amount));
    }

    /**
     * @inheritdoc INexusRateLimiter
     */
    function inflow(uint256 _id, address _to, uint256 _amount) external virtual onlyNexus {
        (uint32 eid, uint32 tokenId) = _decodeNexusId(_id);
        _inflow(uint256(eid), _to, _toScaledAmount(tokenId, _amount));
    }

    // ============ Admin Setters ============

    /**
     * @inheritdoc IRateLimiter
     */
    function setRateLimitGlobalConfig(
        RateLimitGlobalConfig memory _globalConfig
    ) public virtual onlyNexusRole(RATE_LIMITER_MANAGER_ROLE) {
        _setRateLimitGlobalConfig(_globalConfig);
    }

    /**
     * @inheritdoc IRateLimiter
     */
    function setRateLimitConfigs(
        SetRateLimitConfigParam[] calldata _params
    ) public virtual onlyNexusRole(RATE_LIMITER_MANAGER_ROLE) {
        _setRateLimitConfigs(_params);
    }

    /**
     * @inheritdoc IRateLimiter
     */
    function setRateLimitStates(
        SetRateLimitStateParam[] calldata _params
    ) public virtual onlyNexusRole(RATE_LIMITER_MANAGER_ROLE) {
        _setRateLimitStates(_params);
    }

    /**
     * @inheritdoc IRateLimiter
     */
    function setRateLimitAddressExemptions(
        SetRateLimitAddressExemptionParam[] calldata _exemptions
    ) public virtual onlyNexusRole(RATE_LIMITER_MANAGER_ROLE) {
        _setRateLimitAddressExemptions(_exemptions);
    }

    /**
     * @inheritdoc IRateLimiter
     */
    function checkpointRateLimits(uint256[] calldata _ids) public virtual onlyNexusRole(RATE_LIMITER_MANAGER_ROLE) {
        _checkpointRateLimits(_ids);
    }

    /**
     * @inheritdoc ITokenScales
     */
    function setScales(SetScaleParam[] calldata _params) public virtual onlyNexusRole(RATE_LIMITER_MANAGER_ROLE) {
        _setScales(_params);
    }
}
