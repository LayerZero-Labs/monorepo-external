// SPDX-License-Identifier: MIT
pragma solidity ^0.8.22;

import { IOFT } from "@layerzerolabs/oft-evm-impl/contracts/interfaces/IOFT.sol";
import { OFTDecimalUtils } from "@layerzerolabs/oft-evm-impl/contracts/utils/OFTDecimalUtils.sol";
import { Initializable } from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import { IERC20Metadata } from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import { INexusOFT } from "./../interfaces/INexusOFT.sol";
import { IOFTRegistry } from "./../interfaces/IOFTRegistry.sol";

/**
 * @title OFTRegistryBaseUpgradeable
 * @author LayerZero Labs (@TRileySchwarz)
 * @custom:version 1.0.0
 * @notice Abstract upgradeable contract that implements OFT registry functionality with decimal conversions.
 * @dev No public management functions are exposed by this contract, wrappers should be used with access control.
 *      Alternatively, refer to `OFTRegistryRBACUpgradeable` for a permissioned implementation.
 */
abstract contract OFTRegistryBaseUpgradeable is IOFTRegistry, OFTDecimalUtils, Initializable {
    /// @custom:storage-location erc7201:layerzerov2.storage.oftregistry
    struct OFTRegistryStorage {
        mapping(uint32 tokenId => address oftAddress) idToOft;
        mapping(uint32 tokenId => address burnerMinterAddress) idToBurnerMinter;
        mapping(address oftAddress => uint32 tokenId) oftToId;
    }

    // keccak256(abi.encode(uint256(keccak256("layerzerov2.storage.oftregistry")) - 1)) & ~bytes32(uint256(0xff))
    bytes32 private constant OFT_REGISTRY_STORAGE_LOCATION =
        0x6939e24df0ee44eebf982e30da61bb082fb6a50870e9086efcbf20101d7ac300;

    /**
     * @dev Sets immutable variables.
     * @dev Cross-chain shared decimals are hardcoded to `6`.
     * @param _localDecimals Local decimals for tokens on this chain
     */
    constructor(uint8 _localDecimals) OFTDecimalUtils(_localDecimals, 6) {}

    /**
     * @notice Initializes the contract.
     * @dev This function is empty on purpose, as no custom logic is needed.
     */
    function __OFTRegistryBase_init() internal onlyInitializing {}

    /**
     * @notice Unchained initialization function for the contract.
     * @dev This function is empty on purpose, as no custom logic is needed.
     */
    function __OFTRegistryBase_init_unchained() internal onlyInitializing {}

    /**
     * @notice Internal function to get the registry storage.
     * @return $ Storage pointer
     */
    function _getOFTRegistryStorage() internal pure returns (OFTRegistryStorage storage $) {
        assembly {
            $.slot := OFT_REGISTRY_STORAGE_LOCATION
        }
    }

    // ============ View Functions ============

    /**
     * @inheritdoc IOFTRegistry
     */
    function getTokenId(address _oftAddress) public view virtual returns (uint32 tokenId) {
        OFTRegistryStorage storage $ = _getOFTRegistryStorage();
        return $.oftToId[_oftAddress];
    }

    /**
     * @inheritdoc IOFTRegistry
     */
    function getBurnerMinterAddress(uint32 _tokenId) public view virtual returns (address burnerMinterAddress) {
        OFTRegistryStorage storage $ = _getOFTRegistryStorage();
        return $.idToBurnerMinter[_tokenId];
    }

    /**
     * @inheritdoc IOFTRegistry
     */
    function getOFTAddress(uint32 _tokenId) public view virtual returns (address oftAddress) {
        OFTRegistryStorage storage $ = _getOFTRegistryStorage();
        return $.idToOft[_tokenId];
    }

    // ============ Internal Assertion Helpers ============

    /**
     * @notice Returns tokenId for a given OFT address, reverting if not registered.
     * @param _oftAddress Address of the OFT contract
     * @return tokenId Unique identifier for the token
     */
    function _getAndAssertTokenId(address _oftAddress) internal view virtual returns (uint32 tokenId) {
        tokenId = getTokenId(_oftAddress);
        if (tokenId == 0) revert InvalidOFT(_oftAddress);
    }

    /**
     * @notice Returns burner minter address for a given token ID, reverting if not registered.
     * @param _tokenId Unique identifier for the token
     * @return burnerMinterAddress Address of the burner minter contract
     */
    function _getAndAssertBurnerMinterAddress(
        uint32 _tokenId
    ) internal view virtual returns (address burnerMinterAddress) {
        burnerMinterAddress = getBurnerMinterAddress(_tokenId);
        if (burnerMinterAddress == address(0)) revert InvalidTokenId(_tokenId);
    }

    /**
     * @notice Returns OFT address for a given token ID, reverting if not registered.
     * @param _tokenId Unique identifier for the token
     * @return oftAddress Address of the OFT contract
     */
    function _getAndAssertOFTAddress(uint32 _tokenId) internal view virtual returns (address oftAddress) {
        oftAddress = getOFTAddress(_tokenId);
        if (oftAddress == address(0)) revert InvalidTokenId(_tokenId);
    }

    // ============ Internal Functions to Wrap with Access Control ============

    /**
     * @notice Internal function to register a token with an OFT contract.
     * @dev To be wrapped with access control.
     * @dev Validates decimal compatibility.
     * @param _tokenId Unique identifier for the token
     * @param _oftAddress Address of the OFT contract
     * @param _burnerMinterAddress Address of the burner minter contract
     */
    function _registerToken(uint32 _tokenId, address _oftAddress, address _burnerMinterAddress) internal virtual {
        if (_tokenId == 0 || _burnerMinterAddress == address(0) || _oftAddress == address(0)) {
            revert InvalidTokenRegistration(_tokenId, _burnerMinterAddress, _oftAddress);
        }

        /// @dev Sanity check token ID.
        uint32 oftTokenId = INexusOFT(_oftAddress).tokenId();
        if (oftTokenId != _tokenId) {
            revert InvalidTokenId(oftTokenId);
        }

        /// @dev Validate token decimals.
        address tokenAddress = IOFT(_oftAddress).token();
        uint8 tokenDecimals = IERC20Metadata(tokenAddress).decimals();
        if (tokenDecimals != localDecimals()) {
            revert InvalidTokenDecimals(tokenAddress, localDecimals(), tokenDecimals);
        }

        /// @dev Validate OFT shared decimals.
        uint8 oftSharedDecimals = IOFT(_oftAddress).sharedDecimals();
        if (oftSharedDecimals != sharedDecimals()) {
            revert InvalidOFTSharedDecimals(_oftAddress, sharedDecimals(), oftSharedDecimals);
        }

        OFTRegistryStorage storage $ = _getOFTRegistryStorage();

        if (
            $.idToOft[_tokenId] != address(0) ||
            $.idToBurnerMinter[_tokenId] != address(0) ||
            $.oftToId[_oftAddress] != 0
        ) {
            revert TokenAlreadyRegistered(_tokenId, tokenAddress, _oftAddress);
        }

        $.idToOft[_tokenId] = _oftAddress;
        $.idToBurnerMinter[_tokenId] = _burnerMinterAddress;
        $.oftToId[_oftAddress] = _tokenId;

        emit TokenRegistered(_tokenId, _oftAddress, _burnerMinterAddress, tokenAddress);
    }

    /**
     * @notice Internal function to deregister a token.
     * @dev To be wrapped with access control.
     * @param _tokenId Unique identifier for the token to deregister
     */
    function _deregisterToken(uint32 _tokenId) internal virtual {
        OFTRegistryStorage storage $ = _getOFTRegistryStorage();

        address oftAddress = $.idToOft[_tokenId];

        if (oftAddress == address(0)) {
            revert TokenNotRegistered(_tokenId);
        }

        delete $.idToOft[_tokenId];
        delete $.idToBurnerMinter[_tokenId];
        delete $.oftToId[oftAddress];

        emit TokenDeregistered(_tokenId);
    }
}
