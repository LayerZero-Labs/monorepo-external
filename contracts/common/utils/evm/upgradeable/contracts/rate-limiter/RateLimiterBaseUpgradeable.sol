// SPDX-License-Identifier: MIT
pragma solidity ^0.8.22;

import { IRateLimiter } from "@layerzerolabs/utils-evm-impl/contracts/interfaces/IRateLimiter.sol";
import { Initializable } from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import { Math } from "@openzeppelin/contracts/utils/math/Math.sol";
import { RateLimiterUtils } from "./libs/RateLimiterUtils.sol";

/**
 * @title RateLimiterBaseUpgradeable
 * @author LayerZero Labs (tinom.eth)
 * @custom:version 1.0.0
 * @notice Abstract contract that provides toggleable rate limiting functionality for OApps.
 *         Token bucket algorithm with linear decay.
 * @dev No public management functions are exposed by this contract, wrappers should be used with access control.
 *      Alternatively, refer to `RateLimiterRBACUpgradeable` for a permissioned implementation.
 * @dev Configured limits must be significantly larger than windows to avoid precision loss when calculating decays.
 * @dev Net rate limits offset outflow usage with inflows and vice versa, gross rate limits do not.
 * @dev Amounts are stored as `uint96`, any amounts larger than `type(uint96).max` need to be downscaled via the
 *      `SCALE_DECIMALS` constructor parameter.
 * @dev When using global state, ID-specific configs are ignored, and the default config is always used.
 * @dev If `SCALE_DECIMALS` are applied, scaling rounding can favour the user in certain configurations. It is the
 *      responsibility of the app to ensure the economic cost of running the rate-limited operation is greater than the
 *      economic benefit of bypassing a unit of rate limit.
 *
 * Example 1: Max rate limit reached at beginning of window. As time continues the amount of in flights comes down.
 *
 * Rate Limit Config:
 *   limit: 100 units
 *   window: 60 seconds
 *
 *                              Amount in Flight (units) vs. Time Graph (seconds)
 *
 *      100 | * - (Max limit reached at beginning of window)
 *          |   *
 *          |     *
 *          |       *
 *       50 |         * (After 30 seconds only 50 units in flight)
 *          |           *
 *          |             *
 *          |               *
 *       0  +--|---|---|---|---|-->(After 60 seconds 0 units are in flight)
 *             0  15  30  45  60 (seconds)
 *
 * Example 2: Max rate limit reached at beginning of window. As time continues the amount of in flights comes down
 * allowing for more to be sent. At the 90 second mark, more in flights come in.
 *
 * Rate Limit Config:
 *   limit: 100 units
 *   window: 60 seconds
 *
 *                              Amount in Flight (units) vs. Time Graph (seconds)
 *
 *      100 | * - (Max limit reached at beginning of window)
 *          |   *
 *          |     *
 *          |       *
 *       50 |         *          * (50 inflight)
 *          |           *          *
 *          |             *          *
 *          |               *          *
 *        0  +--|--|--|--|--|--|--|--|--|--> Time
 *              0 15 30 45 60 75 90 105 120  (seconds)
 *
 * Example 3: Max rate limit reached at beginning of window. At the 15 second mark, the window gets updated to 60
 * seconds and the limit gets updated to 50 units. This scenario shows the direct depiction of "in flight" from the
 * previous window affecting the current window.
 *
 * Initial Rate Limit Config: For first 15 seconds
 *   limit: 100 units
 *   window: 30 seconds
 *
 * Updated Rate Limit Config: Updated at 15 second mark
 *   limit: 50 units
 *   window: 60 seconds
 *
 *                              Amount in Flight (units) vs. Time Graph (seconds)
 *      100 - *
 *            |*
 *            | *
 *            |  *
 *            |   *
 *            |    *
 *            |     *
 *       75 - |      *
 *            |       *
 *            |        *
 *            |         *
 *            |          *
 *            |           *
 *            |            *
 *            |             *
 *       50 - |              x <--(Slope changes at the 15 second mark because of the update.
 *            |               o *      Window extended to 60 seconds and limit reduced to 50 units.
 *            |                o    *      Because amountInFlight/lastUpdated do not reset, 50 units are
 *            |                 o       *      considered in flight from the previous window and the corresponding
 *            |                  o          *     decay from the previous rate.)
 *            |                   o              *
 *       25 - |                    o                 *
 *            |                     o                    *
 *            |                      o                        *
 *            |                       o                           *
 *            |                        o                              *
 *            |                         o                                  *
 *            |                          o                                     *
 *            |                           o                                        *
 *        0 - +---|----|----|----|----|----|----|----|----|----|----|----|----|----|----|----|----|----|----> Time
 *            0   5    10   15   20   25   30   35   40   45   50   55   60   65   70   75   80   85   90 (seconds)
 *            [  Initial 30 Second Window  ]
 *                          [ --------------- Extended 60 Second Window --------------- ]
 */
abstract contract RateLimiterBaseUpgradeable is Initializable, IRateLimiter {
    /// @notice ID of the default rate limit configuration.
    uint256 public constant DEFAULT_ID = 0;

    /// @notice Number of decimals to scale the rate limit amounts, usually 0.
    uint8 public immutable SCALE_DECIMALS;

    /// @dev Factor to scale the rate limit amounts by the scale decimals.
    uint256 internal immutable SCALE_FACTOR;

    /// @custom:storage-location erc7201:layerzerov2.storage.ratelimiter
    struct RateLimiterStorage {
        bool useGlobalStateFlag;
        bool isGloballyDisabledFlag;
        mapping(uint256 id => RateLimit rateLimit) rateLimits;
        mapping(address user => bool isExempt) isRateLimitAddressExempt;
    }

    // keccak256(abi.encode(uint256(keccak256("layerzerov2.storage.ratelimiter")) - 1)) & ~bytes32(uint256(0xff))
    bytes32 private constant RATELIMITER_STORAGE_LOCATION =
        0xfc4b3847e0649a09792d4c694ef28e20c43dde62a8b3de98eff85ccb4e1f3000;

    /**
     * @notice Internal function to get the rate limiter storage.
     * @return $ Storage pointer
     */
    function _getRateLimiterStorage() internal pure returns (RateLimiterStorage storage $) {
        assembly {
            $.slot := RATELIMITER_STORAGE_LOCATION
        }
    }

    /**
     * @dev Sets immutable variables.
     * @param _scaleDecimals Number of decimals to scale the rate limit amounts, usually 0
     */
    constructor(uint8 _scaleDecimals) {
        if (_scaleDecimals > 18) revert InvalidScaledDecimals(_scaleDecimals);
        SCALE_DECIMALS = _scaleDecimals;
        SCALE_FACTOR = 10 ** _scaleDecimals;
    }

    /**
     * @notice Initializes the contract.
     * @param _useGlobalState Whether to use global rules for the rate limiter, instead of per-ID rules
     */
    function __RateLimiterBase_init(bool _useGlobalState) internal onlyInitializing {
        __RateLimiterBase_init_unchained(_useGlobalState);
    }

    /**
     * @notice Unchained initialization function for the contract.
     * @param _useGlobalState Whether to use global rules for the rate limiter, instead of per-ID rules
     */
    function __RateLimiterBase_init_unchained(bool _useGlobalState) internal onlyInitializing {
        RateLimiterStorage storage $ = _getRateLimiterStorage();
        $.useGlobalStateFlag = _useGlobalState;

        /// @dev Default config is closed by default.
        $.rateLimits[DEFAULT_ID].configBitmap = RateLimiterUtils.encodeConfigBitmap(false, true, true, true, false);
        emit RateLimitConfigUpdated(
            DEFAULT_ID,
            RateLimitConfig({
                overrideDefaultConfig: false,
                outboundEnabled: true,
                inboundEnabled: true,
                netAccountingEnabled: true,
                addressExemptionEnabled: false,
                outboundLimit: 0,
                inboundLimit: 0,
                outboundWindow: 0,
                inboundWindow: 0
            })
        );
    }

    // ============ Public Getters ============

    /**
     * @inheritdoc IRateLimiter
     */
    function getRateLimitGlobalConfig() public view virtual returns (RateLimitGlobalConfig memory globalConfig) {
        RateLimiterStorage storage $ = _getRateLimiterStorage();
        return
            RateLimitGlobalConfig({
                useGlobalState: $.useGlobalStateFlag,
                isGloballyDisabled: $.isGloballyDisabledFlag
            });
    }

    /**
     * @inheritdoc IRateLimiter
     */
    function rateLimits(uint256 _id) public view virtual returns (RateLimit memory rateLimit) {
        return _getRateLimiterStorage().rateLimits[_id];
    }

    /**
     * @inheritdoc IRateLimiter
     */
    function isRateLimitAddressExempt(address _user) public view virtual returns (bool isExempt) {
        return _getRateLimiterStorage().isRateLimitAddressExempt[_user];
    }

    /**
     * @inheritdoc IRateLimiter
     */
    function getRateLimitUsages(
        uint256 _id
    )
        public
        view
        virtual
        returns (
            uint256 outboundUsage,
            uint256 outboundAvailableAmount,
            uint256 inboundUsage,
            uint256 inboundAvailableAmount
        )
    {
        (, RateLimit memory rateLimit, bool outboundEnabled, bool inboundEnabled, , ) = _getRateLimitStateAndConfig(
            _id
        );
        (outboundUsage, outboundAvailableAmount, inboundUsage, inboundAvailableAmount) = _getRateLimitUsages(rateLimit);
        if (SCALE_DECIMALS > 0) {
            (outboundUsage, outboundAvailableAmount, inboundUsage, inboundAvailableAmount) = (
                _upscaleRateLimitAmount(outboundUsage),
                _upscaleRateLimitAmount(outboundAvailableAmount),
                _upscaleRateLimitAmount(inboundUsage),
                _upscaleRateLimitAmount(inboundAvailableAmount)
            );
        }
        if (_getRateLimiterStorage().isGloballyDisabledFlag) {
            (outboundAvailableAmount, inboundAvailableAmount) = (type(uint256).max, type(uint256).max);
        } else {
            if (!outboundEnabled) {
                outboundAvailableAmount = type(uint256).max;
            }
            if (!inboundEnabled) {
                inboundAvailableAmount = type(uint256).max;
            }
        }
    }

    // ============ Internal API ============

    /**
     * @notice Applies rate limit logic for an outflow.
     * @dev To be called by the OApp.
     * @param _id ID of the rate limit
     * @param _from Sender of the action
     * @param _amount Amount of the action
     */
    function _outflow(uint256 _id, address _from, uint256 _amount) internal virtual {
        _applyRateLimit(_id, _from, _amount, true);
    }

    /**
     * @notice Applies rate limit logic for an inflow.
     * @dev To be called by the OApp.
     * @param _id ID of the rate limit
     * @param _to Recipient of the action
     * @param _amount Amount of the action
     */
    function _inflow(uint256 _id, address _to, uint256 _amount) internal virtual {
        _applyRateLimit(_id, _to, _amount, false);
    }

    // ============ Internal Functions ============

    /**
     * @notice Applies rate limit logic for an outflow or inflow.
     * @param _id ID of the rate limit
     * @param _user User performing the action
     * @param _amount Amount of the action
     * @param _isOutflow Whether the action is an outflow
     */
    function _applyRateLimit(uint256 _id, address _user, uint256 _amount, bool _isOutflow) internal virtual {
        /// @dev Early return.
        RateLimiterStorage storage $ = _getRateLimiterStorage();
        if ($.isGloballyDisabledFlag) return;

        /// @dev Optimistically assign outflow directions for outbound and inbound flags.
        ///      For outflows, forward is outbound and backward is inbound.
        ///      For inflows, forward is inbound and backward is outbound.
        (
            RateLimit storage rateLimitState,
            RateLimit memory rateLimitCache,
            bool forwardEnabled,
            bool backwardEnabled,
            bool netAccountingEnabled,
            bool addressExemptionEnabled
        ) = _getRateLimitStateAndConfig(_id);

        /// @dev Swap forward and backward flags directions for inflows.
        if (!_isOutflow) {
            (forwardEnabled, backwardEnabled) = (backwardEnabled, forwardEnabled);
        }

        /// @dev Early returns.
        if (
            (!forwardEnabled && (!backwardEnabled || !netAccountingEnabled)) ||
            (addressExemptionEnabled && isRateLimitAddressExempt(_user))
        ) return;

        /// @dev Optimistically assign outflow directions.
        (
            uint256 forwardUsage,
            uint256 forwardAvailableAmount,
            uint256 backwardUsage,
            uint256 backwardAvailableAmount
        ) = _getRateLimitUsages(rateLimitCache);

        /// @dev Swap directions for inflows.
        if (!_isOutflow) {
            (forwardUsage, forwardAvailableAmount, backwardUsage, backwardAvailableAmount) = (
                backwardUsage,
                backwardAvailableAmount,
                forwardUsage,
                forwardAvailableAmount
            );
        }

        /// @dev Allow downscaling for apps with amounts larger than `type(uint96).max`.
        uint256 amount = SCALE_DECIMALS == 0 ? _amount : _downscaleRateLimitAmount(_amount);

        if (forwardEnabled) {
            if (forwardAvailableAmount < amount) {
                revert RateLimitExceeded(forwardAvailableAmount, amount);
            }

            unchecked {
                forwardUsage += amount;
            }
        }

        if (backwardEnabled && netAccountingEnabled) {
            backwardUsage = Math.saturatingSub(backwardUsage, amount);
        }

        (rateLimitState.outboundUsage, rateLimitState.inboundUsage) = _isOutflow
            ? (uint96(forwardUsage), uint96(backwardUsage))
            : (uint96(backwardUsage), uint96(forwardUsage));
        rateLimitState.lastUpdated = uint40(block.timestamp);
    }

    /**
     * @notice Gets the rate limit state and configuration for a given ID, falling back to defaults if necessary.
     * @param _id ID of the rate limit
     * @return rateLimitState Rate limit state
     * @return rateLimitCache Rate limit configuration
     * @return outboundEnabled Whether outbound is enabled
     * @return inboundEnabled Whether inbound is enabled
     * @return netAccountingEnabled Whether net accounting is enabled
     * @return addressExemptionEnabled Whether address exemption is enabled
     */
    function _getRateLimitStateAndConfig(
        uint256 _id
    )
        internal
        view
        virtual
        returns (
            RateLimit storage rateLimitState,
            RateLimit memory rateLimitCache,
            bool outboundEnabled,
            bool inboundEnabled,
            bool netAccountingEnabled,
            bool addressExemptionEnabled
        )
    {
        RateLimiterStorage storage $ = _getRateLimiterStorage();

        uint256 stateId;
        uint256 configId;

        if ($.useGlobalStateFlag) {
            /// @dev If using global state, ID-specific config is ignored.
            stateId = DEFAULT_ID;
            configId = DEFAULT_ID;
        } else {
            stateId = _id;
            configId = RateLimiterUtils.decodeOverrideDefaultConfig($.rateLimits[_id].configBitmap) ? _id : DEFAULT_ID;
        }

        rateLimitState = $.rateLimits[stateId];
        rateLimitCache = _populateRateLimitCache(stateId, configId);

        (outboundEnabled, inboundEnabled, netAccountingEnabled, addressExemptionEnabled) = RateLimiterUtils
            .decodeConfigBitmapFlags(rateLimitCache.configBitmap);
    }

    /**
     * @notice Populates the rate limit cache for a given state and configuration ID.
     * @dev Avoids stack too deep error in `_getRateLimitStateAndConfig`.
     * @param _stateId State ID
     * @param _configId Configuration ID
     * @return rateLimitCache Rate limit cache
     */
    function _populateRateLimitCache(
        uint256 _stateId,
        uint256 _configId
    ) internal view virtual returns (RateLimit memory rateLimitCache) {
        RateLimiterStorage storage $ = _getRateLimiterStorage();

        (rateLimitCache.outboundUsage, rateLimitCache.inboundUsage, rateLimitCache.lastUpdated) = (
            $.rateLimits[_stateId].outboundUsage,
            $.rateLimits[_stateId].inboundUsage,
            $.rateLimits[_stateId].lastUpdated
        );

        (
            rateLimitCache.configBitmap,
            rateLimitCache.outboundLimit,
            rateLimitCache.inboundLimit,
            rateLimitCache.outboundWindow,
            rateLimitCache.inboundWindow
        ) = (
            $.rateLimits[_configId].configBitmap,
            $.rateLimits[_configId].outboundLimit,
            $.rateLimits[_configId].inboundLimit,
            $.rateLimits[_configId].outboundWindow,
            $.rateLimits[_configId].inboundWindow
        );
    }

    /**
     * @notice Calculates decayed usages and remaining capacities for a rate limit.
     * @param _rateLimit Rate limit state to calculate usages for
     * @return outboundUsage Current usage of the outbound rate limit
     * @return outboundAvailableAmount Remaining capacity of the outbound rate limit
     * @return inboundUsage Current usage of the inbound rate limit
     * @return inboundAvailableAmount Remaining capacity of the inbound rate limit
     */
    function _getRateLimitUsages(
        RateLimit memory _rateLimit
    )
        internal
        view
        virtual
        returns (
            uint256 outboundUsage,
            uint256 outboundAvailableAmount,
            uint256 inboundUsage,
            uint256 inboundAvailableAmount
        )
    {
        (outboundUsage, outboundAvailableAmount) = _getRateLimitUsage(
            _rateLimit.lastUpdated,
            _rateLimit.outboundUsage,
            _rateLimit.outboundLimit,
            _rateLimit.outboundWindow
        );
        (inboundUsage, inboundAvailableAmount) = _getRateLimitUsage(
            _rateLimit.lastUpdated,
            _rateLimit.inboundUsage,
            _rateLimit.inboundLimit,
            _rateLimit.inboundWindow
        );
    }

    /**
     * @notice Calculates decayed usage and remaining capacity for a rate limit direction.
     * @dev Treats 0-windows as 1-second windows.
     * @dev Decay can be stalled due to precision loss if `_limit` is not significantly larger than `_window`.
     * @param _lastUpdated Last updated timestamp
     * @param _amountInFlight Amount in flight
     * @param _limit Limit of the rate limit
     * @param _window Window of the rate limit
     * @return currentUsage Current usage of the rate limit
     * @return availableAmount Remaining capacity of the rate limit
     */
    function _getRateLimitUsage(
        uint40 _lastUpdated,
        uint96 _amountInFlight,
        uint96 _limit,
        uint32 _window
    ) internal view virtual returns (uint256 currentUsage, uint256 availableAmount) {
        uint256 timeSinceLastUpdate = block.timestamp - _lastUpdated;
        unchecked {
            uint256 decay = (_limit * timeSinceLastUpdate) / (_window > 0 ? _window : 1);
            currentUsage = Math.saturatingSub(_amountInFlight, decay);
            availableAmount = Math.saturatingSub(_limit, currentUsage);
        }
    }

    /**
     * @notice Calculates decayed usages and updates state for a rate limit.
     * @dev To be called before updating new limits and windows.
     * @param _id ID of the rate limit
     */
    function _checkpointRateLimit(uint256 _id) internal virtual {
        (RateLimit storage rateLimitState, RateLimit memory rateLimitCache, , , , ) = _getRateLimitStateAndConfig(_id);

        (uint256 outboundUsage, , uint256 inboundUsage, ) = _getRateLimitUsages(rateLimitCache);

        rateLimitState.outboundUsage = uint96(outboundUsage);
        rateLimitState.inboundUsage = uint96(inboundUsage);
        rateLimitState.lastUpdated = uint40(block.timestamp);
    }

    // ============ Internal Functions to Wrap with Access Control ============

    /**
     * @notice Checkpoints rate limits for multiple IDs, updating decayed usages to storage.
     * @dev To be called before updating new limits and windows.
     * @param _ids Array of rate limit IDs to checkpoint
     */
    function _checkpointRateLimits(uint256[] calldata _ids) internal virtual {
        for (uint256 i = 0; i < _ids.length; i++) {
            _checkpointRateLimit(_ids[i]);
        }
    }

    /**
     * @notice Internal function to set the global configuration for the rate limiter.
     * @dev To be wrapped with access control.
     * @param _globalConfig Global configuration to set
     */
    function _setRateLimitGlobalConfig(RateLimitGlobalConfig memory _globalConfig) internal virtual {
        RateLimiterStorage storage $ = _getRateLimiterStorage();
        $.useGlobalStateFlag = _globalConfig.useGlobalState;
        $.isGloballyDisabledFlag = _globalConfig.isGloballyDisabled;
        emit RateLimitGlobalConfigUpdated(_globalConfig);
    }

    /**
     * @notice Internal function to set ID-specific configurations for the rate limiter.
     * @dev To be wrapped with access control.
     * @dev Configurations must be significantly larger than windows to avoid precision loss when calculating decays.
     * @param _params Array of configurations to set
     */
    function _setRateLimitConfigs(SetRateLimitConfigParam[] calldata _params) internal virtual {
        RateLimiterStorage storage $ = _getRateLimiterStorage();

        for (uint256 i = 0; i < _params.length; i++) {
            SetRateLimitConfigParam calldata param = _params[i];
            RateLimit storage rateLimit = $.rateLimits[param.id];

            rateLimit.configBitmap = RateLimiterUtils.encodeConfigBitmap(
                param.config.overrideDefaultConfig,
                param.config.outboundEnabled,
                param.config.inboundEnabled,
                param.config.netAccountingEnabled,
                param.config.addressExemptionEnabled
            );
            rateLimit.outboundLimit = param.config.outboundLimit;
            rateLimit.inboundLimit = param.config.inboundLimit;
            rateLimit.outboundWindow = param.config.outboundWindow;
            rateLimit.inboundWindow = param.config.inboundWindow;

            emit RateLimitConfigUpdated(param.id, param.config);
        }
    }

    /**
     * @notice Internal function to set ID-specific states for the rate limiter.
     * @dev To be wrapped with access control.
     * @dev States cannot be set to a timestamp in the future.
     * @param _params Array of states to set
     */
    function _setRateLimitStates(SetRateLimitStateParam[] calldata _params) internal virtual {
        RateLimiterStorage storage $ = _getRateLimiterStorage();

        for (uint256 i = 0; i < _params.length; i++) {
            SetRateLimitStateParam calldata param = _params[i];
            RateLimit storage rateLimit = $.rateLimits[param.id];

            if (param.state.lastUpdated > block.timestamp) {
                revert LastUpdatedInFuture(param.state.lastUpdated, uint40(block.timestamp));
            }

            rateLimit.outboundUsage = param.state.outboundUsage;
            rateLimit.inboundUsage = param.state.inboundUsage;
            rateLimit.lastUpdated = param.state.lastUpdated;

            emit RateLimitStateUpdated(param.id, param.state);
        }
    }

    /**
     * @notice Internal function to set address exemptions for the rate limiter.
     * @dev To be wrapped with access control.
     * @dev Only in effect if `addressExemptionEnabled` is true for an ID.
     * @param _exemptions Array of exemptions to set
     */
    function _setRateLimitAddressExemptions(SetRateLimitAddressExemptionParam[] calldata _exemptions) internal virtual {
        RateLimiterStorage storage $ = _getRateLimiterStorage();

        for (uint256 i = 0; i < _exemptions.length; i++) {
            SetRateLimitAddressExemptionParam calldata exemption = _exemptions[i];

            if ($.isRateLimitAddressExempt[exemption.user] == exemption.isExempt) {
                revert ExemptionStateIdempotent(exemption.user, exemption.isExempt);
            }

            $.isRateLimitAddressExempt[exemption.user] = exemption.isExempt;

            emit RateLimitAddressExemptionUpdated(exemption.user, exemption.isExempt);
        }
    }

    // ============ Up/Down Scaling ============

    /**
     * @notice Downscales the rate limit amount by the scale decimals.
     * @param _amount Amount to downscale
     * @return Downscaled amount
     */
    function _downscaleRateLimitAmount(uint256 _amount) internal view virtual returns (uint256) {
        return Math.ceilDiv(_amount, SCALE_FACTOR);
    }

    /**
     * @notice Upscales the rate limit amount by the scale decimals.
     * @param _amount Amount to upscale
     * @return Upscaled amount
     */
    function _upscaleRateLimitAmount(uint256 _amount) internal view virtual returns (uint256) {
        /// @dev Safe since maximum value is `type(uint96).max` for `_amount`, and `10 ** 18` for `SCALE_FACTOR`.
        unchecked {
            return _amount * SCALE_FACTOR;
        }
    }
}
