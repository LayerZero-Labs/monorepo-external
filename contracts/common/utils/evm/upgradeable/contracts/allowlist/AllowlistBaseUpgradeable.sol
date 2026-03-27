// SPDX-License-Identifier: MIT
pragma solidity ^0.8.22;

import { IAllowlist } from "@layerzerolabs/utils-evm-impl/contracts/interfaces/IAllowlist.sol";
import { Initializable } from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import { EnumerableSet } from "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";
import { EnumerableSetPagination } from "./../libs/EnumerableSetPagination.sol";

/**
 * @title AllowlistBaseUpgradeable
 * @author LayerZero Labs (tinom.eth)
 * @custom:version 1.0.0
 * @notice Abstract upgradeable contract that provides toggleable allowlist functionality between open, blacklist, and
 *         whitelist modes.
 * @dev No public management functions are exposed by this contract, wrappers should be used with access control.
 *      Alternatively, refer to `AllowlistRBACUpgradeable` for a permissioned implementation.
 */
abstract contract AllowlistBaseUpgradeable is IAllowlist, Initializable {
    using EnumerableSet for EnumerableSet.AddressSet;
    using EnumerableSetPagination for EnumerableSet.AddressSet;

    /// @custom:storage-location erc7201:layerzerov2.storage.allowlist
    struct AllowlistStorage {
        AllowlistMode mode;
        EnumerableSet.AddressSet blacklistedSet;
        EnumerableSet.AddressSet whitelistedSet;
    }

    // keccak256(abi.encode(uint256(keccak256("layerzerov2.storage.allowlist")) - 1)) & ~bytes32(uint256(0xff))
    bytes32 private constant ALLOWLIST_STORAGE_LOCATION =
        0xa9f917c522fb3fd8673bbc655e92a5c1f1ee3df7bf7ad06a1821b937d0205e00;

    /**
     * @notice Internal function to get the allowlist storage.
     * @return $ Storage pointer
     */
    function _getAllowlistStorage() internal pure returns (AllowlistStorage storage $) {
        assembly {
            $.slot := ALLOWLIST_STORAGE_LOCATION
        }
    }

    /**
     * @notice Initializes the contract.
     * @param _mode Initial mode
     */
    function __AllowlistBase_init(AllowlistMode _mode) internal onlyInitializing {
        __AllowlistBase_init_unchained(_mode);
    }

    /**
     * @notice Unchained initialization function for the contract.
     * @param _mode Initial mode
     */
    function __AllowlistBase_init_unchained(AllowlistMode _mode) internal onlyInitializing {
        /// @dev Not using `_setAllowlistMode` to avoid reverting if the mode is open.
        AllowlistStorage storage $ = _getAllowlistStorage();
        $.mode = _mode;
        emit AllowlistModeUpdated(_mode);
    }

    /**
     * @notice Modifier that reverts if the user is not allowlisted.
     * @param _user User address
     */
    modifier onlyAllowlisted(address _user) {
        if (!isAllowlisted(_user)) revert NotAllowlisted(_user, allowlistMode());
        _;
    }

    /**
     * @inheritdoc IAllowlist
     */
    function allowlistMode() public view virtual returns (AllowlistMode mode) {
        return _getAllowlistStorage().mode;
    }

    /**
     * @inheritdoc IAllowlist
     */
    function isBlacklisted(address _user) public view virtual returns (bool isUserBlacklisted) {
        return _getAllowlistStorage().blacklistedSet.contains(_user);
    }

    /**
     * @inheritdoc IAllowlist
     */
    function isWhitelisted(address _user) public view virtual returns (bool isUserWhitelisted) {
        return _getAllowlistStorage().whitelistedSet.contains(_user);
    }

    /**
     * @inheritdoc IAllowlist
     */
    function isAllowlisted(address _user) public view virtual returns (bool isUserAllowlisted) {
        AllowlistMode currentMode = allowlistMode();
        if (currentMode == AllowlistMode.Open) return true;
        if (currentMode == AllowlistMode.Blacklist) return !isBlacklisted(_user);
        /// @dev `currentMode == AllowlistMode.Whitelist`.
        return isWhitelisted(_user);
    }

    /**
     * @inheritdoc IAllowlist
     */
    function blacklistedCount() public view virtual returns (uint256 count) {
        return _getAllowlistStorage().blacklistedSet.length();
    }

    /**
     * @inheritdoc IAllowlist
     */
    function whitelistedCount() public view virtual returns (uint256 count) {
        return _getAllowlistStorage().whitelistedSet.length();
    }

    /**
     * @inheritdoc IAllowlist
     */
    function getBlacklist(uint256 _offset, uint256 _limit) public view virtual returns (address[] memory addresses) {
        return _getAllowlistStorage().blacklistedSet.paginate(_offset, _limit);
    }

    /**
     * @inheritdoc IAllowlist
     */
    function getWhitelist(uint256 _offset, uint256 _limit) public view virtual returns (address[] memory addresses) {
        return _getAllowlistStorage().whitelistedSet.paginate(_offset, _limit);
    }

    // ============ Internal Functions to Wrap with Access Control ============

    /**
     * @notice Internal function to set the allowlist mode.
     * @dev To be wrapped with access control.
     * @param _mode New mode
     */
    function _setAllowlistMode(AllowlistMode _mode) internal virtual {
        AllowlistStorage storage $ = _getAllowlistStorage();
        if ($.mode == _mode) revert ModeAlreadySet(_mode);
        $.mode = _mode;
        emit AllowlistModeUpdated(_mode);
    }

    /**
     * @notice Internal function to set the whitelist state for an array of users.
     * @dev To be wrapped with access control.
     * @param _params Array of users and whitelist states
     */
    function _setWhitelisted(SetAllowlistParam[] calldata _params) internal virtual {
        AllowlistStorage storage $ = _getAllowlistStorage();
        for (uint256 i = 0; i < _params.length; i++) {
            SetAllowlistParam calldata param = _params[i];
            bool addedOrRemoved;
            if (param.isEnabled) {
                addedOrRemoved = $.whitelistedSet.add(param.user);
            } else {
                addedOrRemoved = $.whitelistedSet.remove(param.user);
            }
            if (!addedOrRemoved) revert AllowlistStateIdempotent(param.user, param.isEnabled);
            emit WhitelistUpdated(param.user, param.isEnabled);
        }
    }

    /**
     * @notice Internal function to set the blacklist state for an array of users.
     * @dev To be wrapped with access control.
     * @param _params Array of users and blacklist states
     */
    function _setBlacklisted(SetAllowlistParam[] calldata _params) internal virtual {
        AllowlistStorage storage $ = _getAllowlistStorage();
        for (uint256 i = 0; i < _params.length; i++) {
            SetAllowlistParam calldata param = _params[i];
            bool addedOrRemoved;
            if (param.isEnabled) {
                addedOrRemoved = $.blacklistedSet.add(param.user);
            } else {
                addedOrRemoved = $.blacklistedSet.remove(param.user);
            }
            if (!addedOrRemoved) revert AllowlistStateIdempotent(param.user, param.isEnabled);
            emit BlacklistUpdated(param.user, param.isEnabled);
        }
    }
}
