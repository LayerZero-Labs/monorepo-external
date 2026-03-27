// SPDX-License-Identifier: MIT
pragma solidity ^0.8.22;

import { IPause } from "@layerzerolabs/utils-evm-impl/contracts/interfaces/IPause.sol";
import { Initializable } from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";

/**
 * @title PauseBaseUpgradeable
 * @author LayerZero Labs (tinom.eth)
 * @custom:version 1.0.0
 * @notice Abstract upgradeable contract that implements pause configuration and enforcement.
 * @dev No public management functions are exposed by this contract, wrappers should be used with access control.
 *      Alternatively, refer to `PauseRBACUpgradeable` for a permissioned implementation.
 */
abstract contract PauseBaseUpgradeable is IPause, Initializable {
    /// @custom:storage-location erc7201:layerzerov2.storage.pause
    struct PauseStorage {
        bool paused;
    }

    // keccak256(abi.encode(uint256(keccak256("layerzerov2.storage.pause")) - 1)) & ~bytes32(uint256(0xff))
    bytes32 private constant PAUSE_STORAGE_LOCATION =
        0x27be0a968b102c71096101138efa2fc0db00aea7b287f10fdc298bfd2d4ec000;

    /**
     * @notice Internal function to get the pause storage.
     * @return $ Storage pointer
     */
    function _getPauseStorage() internal pure returns (PauseStorage storage $) {
        assembly {
            $.slot := PAUSE_STORAGE_LOCATION
        }
    }

    /**
     * @notice Initializes the contract.
     * @dev This function is empty on purpose, as no custom logic is needed.
     */
    function __PauseBase_init() internal onlyInitializing {}

    /**
     * @notice Unchained initialization function for the contract.
     * @dev This function is empty on purpose, as no custom logic is needed.
     */
    function __PauseBase_init_unchained() internal onlyInitializing {}

    /**
     * @notice Modifier that reverts if the system is paused.
     */
    modifier whenNotPaused() {
        if (_getPaused()) revert Paused();
        _;
    }

    /**
     * @inheritdoc IPause
     */
    function isPaused() public view virtual returns (bool paused) {
        return _getPaused();
    }

    /**
     * @notice Retrieves the pause status.
     * @return paused Whether the system is paused
     */
    function _getPaused() internal view virtual returns (bool) {
        PauseStorage storage $ = _getPauseStorage();
        return $.paused;
    }

    /**
     * @notice Enforces that the system is not paused.
     * @dev Reverts with `Paused` error if the system is paused.
     */
    function _assertNotPaused() internal view virtual {
        if (_getPaused()) revert Paused();
    }

    /**
     * @notice Internal function to set the pause status.
     * @param _paused New pause status
     */
    function _setPaused(bool _paused) internal virtual {
        PauseStorage storage $ = _getPauseStorage();
        if ($.paused == _paused) revert PauseStateIdempotent(_paused);
        $.paused = _paused;
        emit PauseSet(_paused);
    }

    // ============ Internal Functions to Wrap with Access Control ============

    /**
     * @notice Internal function to set the pause status to true.
     * @dev To be wrapped with access control.
     */
    function _pause() internal virtual {
        _setPaused(true);
    }

    /**
     * @notice Internal function to set the pause status to false.
     * @dev To be wrapped with access control.
     */
    function _unpause() internal virtual {
        _setPaused(false);
    }
}
