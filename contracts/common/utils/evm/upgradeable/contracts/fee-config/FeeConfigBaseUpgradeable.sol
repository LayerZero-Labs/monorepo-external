// SPDX-License-Identifier: MIT
pragma solidity ^0.8.22;

import { IFeeConfig } from "@layerzerolabs/utils-evm-impl/contracts/interfaces/IFeeConfig.sol";
import { Initializable } from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";

/**
 * @title FeeConfigBaseUpgradeable
 * @author LayerZero Labs (@TRileySchwarz, tinom.eth)
 * @custom:version 1.0.0
 * @notice Abstract upgradeable contract that implements fee configuration and calculation.
 * @dev No public management functions are exposed by this contract, wrappers should be used with access control.
 *      Alternatively, refer to `FeeConfigRBACUpgradeable` for a permissioned implementation.
 * @dev Does not include fee receiver management. See `FeeHandlerBaseUpgradeable` for that.
 */
abstract contract FeeConfigBaseUpgradeable is IFeeConfig, Initializable {
    /// @notice Constant with which fee basis points (BPS) are divided to get the fee amount.
    uint16 public constant BPS_DENOMINATOR = 10_000;

    /// @custom:storage-location erc7201:layerzerov2.storage.feeconfig
    struct FeeConfigStorage {
        uint16 defaultFeeBps;
        mapping(uint256 id => FeeConfig config) feeBps;
    }

    // keccak256(abi.encode(uint256(keccak256("layerzerov2.storage.feeconfig")) - 1)) & ~bytes32(uint256(0xff))
    bytes32 private constant FEE_CONFIG_STORAGE_LOCATION =
        0x19c40dd5c7b9d6e4dbe259e67955cccfb75eaf6c218fbfbd413bfcd8248dd800;

    /**
     * @notice Internal function to get the fee config storage.
     * @return $ Storage pointer
     */
    function _getFeeConfigStorage() internal pure returns (FeeConfigStorage storage $) {
        assembly {
            $.slot := FEE_CONFIG_STORAGE_LOCATION
        }
    }

    /**
     * @notice Initializes the contract.
     * @dev This function is empty on purpose, as no custom logic is needed.
     */
    function __FeeConfigBase_init() internal onlyInitializing {}

    /**
     * @notice Unchained initialization function for the contract.
     * @dev This function is empty on purpose, as no custom logic is needed.
     */
    function __FeeConfigBase_init_unchained() internal onlyInitializing {}

    /**
     * @inheritdoc IFeeConfig
     */
    function getFee(uint256 _id, uint256 _amount) public view virtual returns (uint256 fee) {
        uint16 bps = _getFeeBps(_id);
        /// @dev If `amount * bps < BPS_DENOMINATOR`, there is no fee.
        return bps == 0 ? 0 : (_amount * bps) / BPS_DENOMINATOR;
    }

    /**
     * @inheritdoc IFeeConfig
     */
    function getAmountBeforeFee(
        uint256 _id,
        uint256 _amountAfterFee
    ) public view virtual returns (uint256 amountBeforeFee) {
        uint16 bps = _getFeeBps(_id);
        if (bps == BPS_DENOMINATOR) return 0;
        if (bps == 0) return _amountAfterFee;
        return (_amountAfterFee * BPS_DENOMINATOR) / (BPS_DENOMINATOR - bps);
    }

    /**
     * @inheritdoc IFeeConfig
     */
    function defaultFeeBps() public view virtual returns (uint16 fee) {
        FeeConfigStorage storage $ = _getFeeConfigStorage();
        return $.defaultFeeBps;
    }

    /**
     * @inheritdoc IFeeConfig
     */
    function feeBps(uint256 _id) public view virtual returns (FeeConfig memory config) {
        FeeConfigStorage storage $ = _getFeeConfigStorage();
        return $.feeBps[_id];
    }

    /**
     * @notice Retrieves the fee basis points (BPS) for a specific destination ID.
     * @param _id Destination ID
     * @return bps Fee basis points (BPS) for the destination ID
     */
    function _getFeeBps(uint256 _id) internal view virtual returns (uint16) {
        FeeConfigStorage storage $ = _getFeeConfigStorage();
        FeeConfig storage config = $.feeBps[_id];
        return config.enabled ? config.feeBps : $.defaultFeeBps;
    }

    // ============ Internal Functions to Wrap with Access Control ============

    /**
     * @notice Internal function to set the default fee basis points (BPS) for all destinations.
     * @dev To be wrapped with access control.
     * @param _feeBps New default fee basis points (BPS)
     */
    function _setDefaultFeeBps(uint16 _feeBps) internal virtual {
        if (_feeBps > BPS_DENOMINATOR) revert IFeeConfig.InvalidBps(_feeBps);
        FeeConfigStorage storage $ = _getFeeConfigStorage();
        $.defaultFeeBps = _feeBps;
        emit DefaultFeeBpsSet(_feeBps);
    }

    /**
     * @notice Internal function to set the fee basis points (BPS) for a specific destination ID.
     * @dev To be wrapped with access control.
     * @param _id Destination ID
     * @param _feeBps New fee basis points (BPS)
     * @param _enabled Whether the fee is enabled for the destination
     */
    function _setFeeBps(uint256 _id, uint16 _feeBps, bool _enabled) internal virtual {
        if (_feeBps > BPS_DENOMINATOR) revert IFeeConfig.InvalidBps(_feeBps);
        FeeConfigStorage storage $ = _getFeeConfigStorage();
        $.feeBps[_id] = FeeConfig(_feeBps, _enabled);
        emit FeeBpsSet(_id, _feeBps, _enabled);
    }
}
