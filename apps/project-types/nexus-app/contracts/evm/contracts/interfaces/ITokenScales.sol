// SPDX-License-Identifier: MIT
pragma solidity ^0.8.22;

/**
 * @title ITokenScales
 * @author LayerZero Labs (tinom.eth)
 * @custom:version 1.0.0
 * @notice Interface for per-token scale configuration. Scales convert token amounts to a common unit (e.g., USD) via
 *         fixed-point multiplication against `SCALE_DENOMINATOR`.
 */
interface ITokenScales {
    /**
     * @notice Configuration for a scale.
     * @param scale Fixed-point scale numerator (denominator is `SCALE_DENOMINATOR`)
     * @param enabled Whether `scale` is active for the token, otherwise a 1:1 conversion is used
     */
    struct ScaleConfig {
        uint128 scale;
        bool enabled;
    }

    /**
     * @notice Parameter for batch-setting scales.
     * @param tokenId Token identifier to configure
     * @param scale Fixed-point scale numerator
     * @param enabled Whether the scale is active for the token
     */
    struct SetScaleParam {
        uint32 tokenId;
        uint128 scale;
        bool enabled;
    }

    /**
     * @notice Emitted when a scale is set for a token.
     * @param tokenId Token identifier whose scale was set
     * @param scale Scale numerator
     * @param enabled Whether the scale is active
     */
    event ScaleSet(uint32 indexed tokenId, uint128 scale, bool enabled);

    /**
     * @notice Returns the fixed-point denominator used in scale calculations.
     * @return denominator Scale denominator (`1e18`)
     */
    function SCALE_DENOMINATOR() external view returns (uint256 denominator);

    /**
     * @notice Retrieves the scale configuration for a given token.
     * @param _tokenId Token identifier to query
     * @return config Scale configuration
     */
    function scales(uint32 _tokenId) external view returns (ScaleConfig memory config);

    /**
     * @notice Batch-sets scale configurations.
     * @param _params Array of scale parameters to set
     */
    function setScales(SetScaleParam[] calldata _params) external;
}
