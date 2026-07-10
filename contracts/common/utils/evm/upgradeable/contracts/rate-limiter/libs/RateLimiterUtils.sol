// SPDX-License-Identifier: MIT
pragma solidity ^0.8.22;

/**
 * @title RateLimiterUtils
 * @author LayerZero Labs (tinom.eth)
 * @custom:version 1.0.0
 * @notice Library for utility functions for the `RateLimiter` contract.
 */
library RateLimiterUtils {
    uint24 private constant BIT_MASK = 1;

    uint24 private constant OVERRIDE_DEFAULT_CONFIG_BIT = 0;
    uint24 private constant OUTBOUND_ENABLED_BIT = 1;
    uint24 private constant INBOUND_ENABLED_BIT = 2;
    uint24 private constant NET_ACCOUNTING_BIT = 3;
    uint24 private constant ADDRESS_EXEMPTION_BIT = 4;

    /**
     * @notice Decodes the override default configuration flag from the configuration bitmap.
     * @param _config Bitmap of the rate limit configuration
     * @return overrideDefaultConfig Whether to override the default configuration
     */
    function decodeOverrideDefaultConfig(uint24 _config) internal pure returns (bool overrideDefaultConfig) {
        assembly {
            overrideDefaultConfig := and(shr(OVERRIDE_DEFAULT_CONFIG_BIT, _config), BIT_MASK)
        }
    }

    /**
     * @notice Decodes the configuration bitmap into its components, excluding the override default configuration flag.
     * @param _config Bitmap of the rate limit configuration
     * @return outboundEnabled Whether outbound is enabled
     * @return inboundEnabled Whether inbound is enabled
     * @return netAccountingEnabled Whether net accounting is enabled
     * @return addressExemptionEnabled Whether address exemption is enabled
     */
    function decodeConfigBitmapFlags(
        uint24 _config
    )
        internal
        pure
        returns (bool outboundEnabled, bool inboundEnabled, bool netAccountingEnabled, bool addressExemptionEnabled)
    {
        assembly {
            outboundEnabled := and(shr(OUTBOUND_ENABLED_BIT, _config), BIT_MASK)
            inboundEnabled := and(shr(INBOUND_ENABLED_BIT, _config), BIT_MASK)
            netAccountingEnabled := and(shr(NET_ACCOUNTING_BIT, _config), BIT_MASK)
            addressExemptionEnabled := and(shr(ADDRESS_EXEMPTION_BIT, _config), BIT_MASK)
        }
    }

    /**
     * @notice Encodes the configuration bitmap into its components.
     * @param _overrideDefaultConfig Whether to override the default configuration
     * @param _outboundEnabled Whether outbound is enabled
     * @param _inboundEnabled Whether inbound is enabled
     * @param _netAccountingEnabled Whether net accounting is enabled
     * @param _addressExemptionEnabled Whether address exemption is enabled
     * @return config Configuration bitmap
     */
    function encodeConfigBitmap(
        bool _overrideDefaultConfig,
        bool _outboundEnabled,
        bool _inboundEnabled,
        bool _netAccountingEnabled,
        bool _addressExemptionEnabled
    ) internal pure returns (uint24 config) {
        assembly {
            config := or(
                or(
                    or(
                        shl(OVERRIDE_DEFAULT_CONFIG_BIT, _overrideDefaultConfig),
                        shl(OUTBOUND_ENABLED_BIT, _outboundEnabled)
                    ),
                    or(shl(INBOUND_ENABLED_BIT, _inboundEnabled), shl(NET_ACCOUNTING_BIT, _netAccountingEnabled))
                ),
                shl(ADDRESS_EXEMPTION_BIT, _addressExemptionEnabled)
            )
        }
    }
}
