// SPDX-License-Identifier: MIT
pragma solidity ^0.8.22;

/**
 * @title IRateLimiter
 * @author LayerZero Labs (tinom.eth)
 * @custom:version 1.0.0
 * @notice Interface for the `RateLimiter` contract.
 */
interface IRateLimiter {
    /**
     * @notice Global configuration for the rate limiter.
     * @param useGlobalState Whether to use global state for the rate limiter, instead of per-ID rules
     * @param isGloballyDisabled Whether the rate limiter is globally disabled
     */
    struct RateLimitGlobalConfig {
        bool useGlobalState;
        bool isGloballyDisabled;
    }

    /**
     * @notice Rate limit state for a given ID.
     * @param outboundUsage Current usage of the outbound rate limit
     * @param inboundUsage Current usage of the inbound rate limit
     * @param lastUpdated Last updated timestamp
     * @param configBitmap Bitmap of the rate limit configuration
     * @param outboundLimit Limit of the outbound rate limit
     * @param outboundWindow Window of the outbound rate limit
     * @param inboundLimit Limit of the inbound rate limit
     * @param inboundWindow Window of the inbound rate limit
     */
    struct RateLimit {
        uint96 outboundUsage;
        uint96 inboundUsage;
        uint40 lastUpdated;
        uint24 configBitmap;
        uint96 outboundLimit;
        uint32 outboundWindow;
        uint96 inboundLimit;
        uint32 inboundWindow;
    }

    /**
     * @notice Rate limit configuration.
     * @param overrideDefaultConfig Whether to override the default configuration
     * @param outboundEnabled Whether the outbound rate limit is enabled
     * @param inboundEnabled Whether the inbound rate limit is enabled
     * @param netAccountingEnabled Whether net accounting is enabled
     * @param addressExemptionEnabled Whether address exemption is enabled
     * @param outboundLimit Limit of the outbound rate limit
     * @param inboundLimit Limit of the inbound rate limit
     * @param outboundWindow Window of the outbound rate limit
     * @param inboundWindow Window of the inbound rate limit
     */
    struct RateLimitConfig {
        bool overrideDefaultConfig;
        bool outboundEnabled;
        bool inboundEnabled;
        bool netAccountingEnabled;
        bool addressExemptionEnabled;
        uint96 outboundLimit;
        uint96 inboundLimit;
        uint32 outboundWindow;
        uint32 inboundWindow;
    }

    /**
     * @notice Parameters for setting a rate limit configuration.
     * @param id ID of the rate limit configuration
     * @param config Configuration to set
     */
    struct SetRateLimitConfigParam {
        uint256 id;
        RateLimitConfig config;
    }

    /**
     * @notice Rate limit state.
     * @param outboundUsage Current usage of the outbound rate limit
     * @param inboundUsage Current usage of the inbound rate limit
     * @param lastUpdated Last updated timestamp
     */
    struct RateLimitState {
        uint96 outboundUsage;
        uint96 inboundUsage;
        uint40 lastUpdated;
    }

    /**
     * @notice Parameters for setting a rate limit state.
     * @param id ID of the rate limit state
     * @param state State to set
     */
    struct SetRateLimitStateParam {
        uint256 id;
        RateLimitState state;
    }

    /**
     * @notice Parameter for setting a rate limit address exemption.
     * @param user Address of the user
     * @param isExempt Whether the address should be exempt from the rate limit
     */
    struct SetRateLimitAddressExemptionParam {
        address user;
        bool isExempt;
    }

    /**
     * @notice Emitted when the global rate limiter configuration is updated.
     * @param globalConfig Updated global configuration
     */
    event RateLimitGlobalConfigUpdated(RateLimitGlobalConfig globalConfig);

    /**
     * @notice Emitted when a rate limit configuration is updated.
     * @param id ID of the rate limit configuration
     * @param config Parameters for the updated rate limit configuration
     */
    event RateLimitConfigUpdated(uint256 indexed id, RateLimitConfig config);

    /**
     * @notice Emitted when a rate limit state is updated.
     * @param id ID of the rate limit state
     * @param state Parameters for the updated rate limit state
     */
    event RateLimitStateUpdated(uint256 indexed id, RateLimitState state);

    /**
     * @notice Emitted when a rate limit address exemption is updated.
     * @param user Address of the user
     * @param isExempt Whether the address is exempt
     */
    event RateLimitAddressExemptionUpdated(address indexed user, bool isExempt);

    /**
     * @notice Thrown when the scaled decimals are invalid.
     * @param scaledDecimals Scaled decimals
     */
    error InvalidScaledDecimals(uint8 scaledDecimals);

    /**
     * @notice Thrown when a rate limit state is set to a timestamp in the future.
     * @param lastUpdated Last updated timestamp
     * @param currentTimestamp Current block timestamp
     */
    error LastUpdatedInFuture(uint40 lastUpdated, uint40 currentTimestamp);

    /**
     * @notice Thrown when a rate limit is exceeded.
     * @param availableAmount Remaining capacity of the rate limit
     * @param requestedAmount Amount requested
     */
    error RateLimitExceeded(uint256 availableAmount, uint256 requestedAmount);

    /**
     * @notice Thrown when a user is already in the desired state (exempt or not exempt).
     * @param user User address
     * @param isExempt Whether the address is exempt
     */
    error ExemptionStateIdempotent(address user, bool isExempt);

    /**
     * @notice Returns the global configuration for the rate limiter.
     * @return globalConfig Global configuration
     */
    function getRateLimitGlobalConfig() external view returns (RateLimitGlobalConfig memory globalConfig);

    /**
     * @notice Returns the rate limit state and configuration for a given ID.
     * @dev May return unscaled state if `SCALE_DECIMALS` is set, use `getRateLimitUsages` for scaled values.
     * @dev Reads the rate limit state from storage without checking defaults.
     * @param _id ID of the rate limit
     * @return rateLimit Rate limit state and configuration
     */
    function rateLimits(uint256 _id) external view returns (RateLimit memory rateLimit);

    /**
     * @notice Returns the address exemption status for a given user.
     * @param _user Address of the user
     * @return isExempt Whether the address is exempt
     */
    function isRateLimitAddressExempt(address _user) external view returns (bool isExempt);

    /**
     * @notice Calculates decayed usages and capacities for a rate limit.
     * @dev Potentially scaled up by `SCALE_DECIMALS`.
     * @dev Checks config and falls back to default if necessary.
     * @dev If a rate limit is disabled in a given direction, the available amount is `type(uint256).max`.
     * @param _id ID of the rate limit
     * @return outboundUsage Scaled current usage of the outbound rate limit
     * @return outboundAvailableAmount Scaled capacity of the outbound rate limit
     * @return inboundUsage Scaled current usage of the inbound rate limit
     * @return inboundAvailableAmount Scaled capacity of the inbound rate limit
     */
    function getRateLimitUsages(
        uint256 _id
    )
        external
        view
        returns (
            uint256 outboundUsage,
            uint256 outboundAvailableAmount,
            uint256 inboundUsage,
            uint256 inboundAvailableAmount
        );

    /**
     * @notice Sets the global configuration for the rate limiter.
     * @param _globalConfig Global configuration to set
     */
    function setRateLimitGlobalConfig(RateLimitGlobalConfig memory _globalConfig) external;

    /**
     * @notice Sets ID-specific configurations for the rate limiter.
     * @dev Configurations must be significantly larger than windows to avoid precision loss when calculating decays.
     * @dev It does not checkpoint rate limits for the configured IDs.
     * @param _params Array of configurations to set
     */
    function setRateLimitConfigs(SetRateLimitConfigParam[] calldata _params) external;

    /**
     * @notice Sets ID-specific states for the rate limiter.
     * @dev States cannot be set to a timestamp in the future.
     * @param _params Array of states to set
     */
    function setRateLimitStates(SetRateLimitStateParam[] calldata _params) external;

    /**
     * @notice Sets address exemptions for the rate limiter.
     * @dev Only in effect if `addressExemptionEnabled` is true for an ID.
     * @param _exemptions Array of exemptions to set
     */
    function setRateLimitAddressExemptions(SetRateLimitAddressExemptionParam[] calldata _exemptions) external;

    /**
     * @notice Checkpoints rate limits for multiple IDs, updating decayed usages to storage.
     * @dev Recommended to be called atomically before setting new limits or windows through `setRateLimitConfigs`, to
     *      avoid retroactively applying decays. Alternatively, `setRateLimitStates` can be called to explicitly set
     *      the desired usages.
     * @param _ids Array of rate limit IDs to checkpoint
     */
    function checkpointRateLimits(uint256[] calldata _ids) external;
}
