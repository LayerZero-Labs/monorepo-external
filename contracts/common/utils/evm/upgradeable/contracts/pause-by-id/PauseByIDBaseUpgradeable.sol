// SPDX-License-Identifier: MIT
pragma solidity ^0.8.22;

import { IPauseByID } from "@layerzerolabs/utils-evm-impl/contracts/interfaces/IPauseByID.sol";
import { Initializable } from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";

/**
 * @title PauseByIDBaseUpgradeable
 * @author LayerZero Labs (tinom.eth)
 * @custom:version 1.0.0
 * @notice Abstract upgradeable contract that implements pause configuration and enforcement per ID.
 * @dev No public management functions are exposed by this contract, wrappers should be used with access control.
 *      Alternatively, refer to `PauseByIDRBACUpgradeable` for a permissioned implementation.
 */
abstract contract PauseByIDBaseUpgradeable is IPauseByID, Initializable {
    /// @custom:storage-location erc7201:layerzerov2.storage.pausebyid
    struct PauseByIDStorage {
        bool defaultPaused;
        mapping(uint256 id => PauseConfig config) pauseConfigs;
    }

    // keccak256(abi.encode(uint256(keccak256("layerzerov2.storage.pausebyid")) - 1)) & ~bytes32(uint256(0xff))
    bytes32 private constant PAUSE_BY_ID_STORAGE_LOCATION =
        0xac2cb783706dc5ac6b91d3675ceaddc73634a37f082a72b77dcdd25ee1f51300;

    /**
     * @notice Internal function to get the pause storage.
     * @return $ Storage pointer
     */
    function _getPauseByIDStorage() internal pure returns (PauseByIDStorage storage $) {
        assembly {
            $.slot := PAUSE_BY_ID_STORAGE_LOCATION
        }
    }

    /**
     * @notice Initializes the contract.
     * @dev This function is empty on purpose, as no custom logic is needed.
     */
    function __PauseByIDBase_init() internal onlyInitializing {}

    /**
     * @notice Unchained initialization function for the contract.
     * @dev This function is empty on purpose, as no custom logic is needed.
     */
    function __PauseByIDBase_init_unchained() internal onlyInitializing {}

    /**
     * @notice Modifier that reverts if the destination ID is paused.
     * @param _id Destination ID
     */
    modifier whenNotPaused(uint256 _id) {
        if (_getPaused(_id)) revert Paused(_id);
        _;
    }

    /**
     * @inheritdoc IPauseByID
     */
    function isPaused(uint256 _id) public view virtual returns (bool paused) {
        return _getPaused(_id);
    }

    /**
     * @inheritdoc IPauseByID
     */
    function defaultPaused() public view virtual returns (bool paused) {
        PauseByIDStorage storage $ = _getPauseByIDStorage();
        return $.defaultPaused;
    }

    /**
     * @inheritdoc IPauseByID
     */
    function pauseConfig(uint256 _id) public view virtual returns (PauseConfig memory config) {
        PauseByIDStorage storage $ = _getPauseByIDStorage();
        return $.pauseConfigs[_id];
    }

    /**
     * @notice Retrieves the pause status for a specific destination ID.
     * @param _id Destination ID
     * @return paused Whether transfers are paused for the destination ID
     */
    function _getPaused(uint256 _id) internal view virtual returns (bool) {
        PauseByIDStorage storage $ = _getPauseByIDStorage();
        PauseConfig storage config = $.pauseConfigs[_id];
        return config.enabled ? config.paused : $.defaultPaused;
    }

    /**
     * @notice Enforces that transfers to a destination ID are not paused.
     * @dev Reverts with `Paused` error if the destination is paused.
     * @param _id Destination ID
     */
    function _assertNotPaused(uint256 _id) internal view virtual {
        if (_getPaused(_id)) revert Paused(_id);
    }

    // ============ Internal Functions to Wrap with Access Control ============

    /**
     * @notice Internal function to set the default pause status for all destinations.
     * @dev To be wrapped with access control.
     * @param _paused New default pause status
     */
    function _setDefaultPaused(bool _paused) internal virtual {
        PauseByIDStorage storage $ = _getPauseByIDStorage();
        if ($.defaultPaused == _paused) revert PauseStateIdempotent(_paused);
        $.defaultPaused = _paused;
        emit DefaultPauseSet(_paused);
    }

    /**
     * @notice Internal function to set the pause status for an array of destination IDs.
     * @dev To be wrapped with access control.
     * @param _params Array of pause configurations
     */
    function _setPaused(SetPausedParam[] calldata _params) internal virtual {
        PauseByIDStorage storage $ = _getPauseByIDStorage();
        for (uint256 i = 0; i < _params.length; i++) {
            SetPausedParam calldata param = _params[i];
            $.pauseConfigs[param.id] = PauseConfig(param.paused, param.enabled);
            emit PauseSet(param.id, param.paused, param.enabled);
        }
    }
}
