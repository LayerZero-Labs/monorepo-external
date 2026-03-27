// SPDX-License-Identifier: MIT
pragma solidity ^0.8.22;

import { IRateLimiter } from "@layerzerolabs/utils-evm-impl/contracts/interfaces/IRateLimiter.sol";
import { AccessControl2StepUpgradeable } from "./../access/AccessControl2StepUpgradeable.sol";
import { RateLimiterBaseUpgradeable } from "./RateLimiterBaseUpgradeable.sol";

/**
 * @title RateLimiterRBACUpgradeable
 * @author LayerZero Labs (tinom.eth)
 * @custom:version 1.0.0
 * @notice Abstract upgradeable contract that provides toggleable rate limiting functionality for OApps.
 *         Token bucket algorithm with linear decay.
 * @dev Exposes public management functions through `AccessControl2StepUpgradeable`.
 * @dev Configured limits must be significantly larger than windows to avoid precision loss when calculating decays.
 * @dev Net rate limits offset outflow usage with inflows and vice versa, gross rate limits do not.
 * @dev Amounts are stored as `uint96`, any amounts larger than `type(uint96).max` need to be downscaled via the
 *      `SCALE_DECIMALS` constructor parameter.
 * @dev When using global state, ID-specific configs are ignored, and the default config is always used.
 */
abstract contract RateLimiterRBACUpgradeable is
    IRateLimiter,
    RateLimiterBaseUpgradeable,
    AccessControl2StepUpgradeable
{
    /// @notice Role for configuring rate limits.
    bytes32 public constant RATE_LIMITER_MANAGER_ROLE = keccak256("RATE_LIMITER_MANAGER_ROLE");

    /**
     * @dev Sets immutable variables.
     * @param _scaleDecimals Number of decimals to scale the rate limit amounts, usually 0
     */
    constructor(uint8 _scaleDecimals) RateLimiterBaseUpgradeable(_scaleDecimals) {}

    /**
     * @notice Initializes the contract.
     * @dev This function is empty on purpose, as no custom logic is needed.
     */
    function __RateLimiterRBAC_init() internal onlyInitializing {}

    /**
     * @notice Unchained initialization function for the contract.
     * @dev This function is empty on purpose, as no custom logic is needed.
     */
    function __RateLimiterRBAC_init_unchained() internal onlyInitializing {}

    /**
     * @inheritdoc IRateLimiter
     */
    function setRateLimitGlobalConfig(
        RateLimitGlobalConfig memory _globalConfig
    ) public virtual onlyRole(RATE_LIMITER_MANAGER_ROLE) {
        _setRateLimitGlobalConfig(_globalConfig);
    }

    /**
     * @inheritdoc IRateLimiter
     */
    function setRateLimitConfigs(
        SetRateLimitConfigParam[] calldata _params
    ) public virtual onlyRole(RATE_LIMITER_MANAGER_ROLE) {
        _setRateLimitConfigs(_params);
    }

    /**
     * @inheritdoc IRateLimiter
     */
    function setRateLimitStates(
        SetRateLimitStateParam[] calldata _params
    ) public virtual onlyRole(RATE_LIMITER_MANAGER_ROLE) {
        _setRateLimitStates(_params);
    }

    /**
     * @inheritdoc IRateLimiter
     */
    function setRateLimitAddressExemptions(
        SetRateLimitAddressExemptionParam[] calldata _exemptions
    ) public virtual onlyRole(RATE_LIMITER_MANAGER_ROLE) {
        _setRateLimitAddressExemptions(_exemptions);
    }

    /**
     * @inheritdoc IRateLimiter
     */
    function checkpointRateLimits(uint256[] calldata _ids) public virtual onlyRole(RATE_LIMITER_MANAGER_ROLE) {
        _checkpointRateLimits(_ids);
    }
}
