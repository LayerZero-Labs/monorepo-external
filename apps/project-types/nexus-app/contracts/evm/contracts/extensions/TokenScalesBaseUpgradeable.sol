// SPDX-License-Identifier: MIT
pragma solidity ^0.8.22;

import { Initializable } from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import { Math } from "@openzeppelin/contracts/utils/math/Math.sol";
import { ITokenScales } from "./../interfaces/ITokenScales.sol";

/**
 * @title TokenScalesBaseUpgradeable
 * @author LayerZero Labs (tinom.eth)
 * @custom:version 1.0.0
 * @notice Abstract upgradeable contract that implements token scaling conversions from base units to scaled amounts.
 * @dev No public management functions are exposed by this contract, wrappers should be used with access control.
 * @dev Scales convert token amounts to a common unit (e.g., USD) via fixed-point multiplication against
 *      `SCALE_DENOMINATOR`. A scale equal to `SCALE_DENOMINATOR` is a 1:1 conversion. Setting `enabled = true` with a
 *      scale of `0` effectively prices the token at zero.
 */
abstract contract TokenScalesBaseUpgradeable is Initializable, ITokenScales {
    /// @inheritdoc ITokenScales
    uint256 public constant SCALE_DENOMINATOR = 1e18;

    /// @custom:storage-location erc7201:layerzerov2.storage.tokenscales
    struct TokenScalesStorage {
        mapping(uint32 tokenId => ScaleConfig config) scales;
    }

    // keccak256(abi.encode(uint256(keccak256("layerzerov2.storage.tokenscales")) - 1)) & ~bytes32(uint256(0xff))
    bytes32 private constant TOKEN_SCALES_STORAGE_LOCATION =
        0xceb972fd3814c37156c133544054ec98282d351e249128053f31fdd9c6efb800;

    /**
     * @notice Internal function to get the token scales storage.
     * @return $ Storage pointer
     */
    function _getTokenScalesStorage() internal pure returns (TokenScalesStorage storage $) {
        assembly {
            $.slot := TOKEN_SCALES_STORAGE_LOCATION
        }
    }

    /**
     * @notice Initializes the contract.
     * @dev This function is empty on purpose, as no custom logic is needed.
     */
    function __TokenScalesBase_init() internal onlyInitializing {}

    /**
     * @notice Unchained initialization function for the contract.
     * @dev This function is empty on purpose, as no custom logic is needed.
     */
    function __TokenScalesBase_init_unchained() internal onlyInitializing {}

    // ============ View Functions ============

    /**
     * @inheritdoc ITokenScales
     */
    function scales(uint32 _tokenId) public view virtual returns (ScaleConfig memory config) {
        TokenScalesStorage storage $ = _getTokenScalesStorage();
        return $.scales[_tokenId];
    }

    // ============ Conversion Functions ============

    /**
     * @notice Converts a raw token amount to a scaled amount for the given token, rounding up.
     * @dev Looks up the scale config from storage. Returns the amount unchanged if the scale is not enabled.
     * @param _tokenId Token identifier
     * @param _amount Raw token amount
     * @return Scaled amount
     */
    function _toScaledAmount(uint32 _tokenId, uint256 _amount) internal view returns (uint256) {
        ScaleConfig memory config = scales(_tokenId);
        if (!config.enabled) return _amount;
        return Math.mulDiv(_amount, config.scale, SCALE_DENOMINATOR, Math.Rounding.Ceil);
    }

    /**
     * @notice Converts a scaled amount back to a raw token amount for the given token, rounding down.
     * @dev Looks up the scale config from storage. Returns the scaled amount unchanged if the scale is not enabled.
     * @dev Returns `type(uint256).max` when `scale == 0` and enabled, since a zero-price token has no effective limit.
     * @param _tokenId Token identifier
     * @param _scaledAmount Scaled amount
     * @return Raw token amount
     */
    function _fromScaledAmount(uint32 _tokenId, uint256 _scaledAmount) internal view returns (uint256) {
        ScaleConfig memory config = scales(_tokenId);
        if (!config.enabled) return _scaledAmount;
        if (config.scale == 0) return type(uint256).max;
        return Math.mulDiv(_scaledAmount, SCALE_DENOMINATOR, config.scale, Math.Rounding.Floor);
    }

    // ============ Internal Functions to Wrap with Access Control ============

    /**
     * @notice Internal function to batch-set scale configurations.
     * @dev To be wrapped with access control.
     * @param _params Array of scale parameters to set
     */
    function _setScales(SetScaleParam[] calldata _params) internal virtual {
        TokenScalesStorage storage $ = _getTokenScalesStorage();
        for (uint256 i = 0; i < _params.length; i++) {
            $.scales[_params[i].tokenId] = ScaleConfig(_params[i].scale, _params[i].enabled);
            emit ScaleSet(_params[i].tokenId, _params[i].scale, _params[i].enabled);
        }
    }
}
