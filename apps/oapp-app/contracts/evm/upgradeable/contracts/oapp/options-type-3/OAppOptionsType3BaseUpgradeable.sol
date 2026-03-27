// SPDX-License-Identifier: MIT
pragma solidity ^0.8.22;

import { IOAppOptionsType3 } from "@layerzerolabs/oapp-evm-impl/contracts/interfaces/IOAppOptionsType3.sol";
import { Initializable } from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";

/**
 * @title OAppOptionsType3BaseUpgradeable
 * @author LayerZero Labs
 * @custom:version 1.0.0
 * @notice Abstract upgradeable contract implementing type 3 OApp options.
 * @dev No public management functions are exposed by this contract, wrappers should be used with access control.
 *      Alternatively, refer to `OAppOptionsType3RBACUpgradeable` for a permissioned implementation.
 */
abstract contract OAppOptionsType3BaseUpgradeable is IOAppOptionsType3, Initializable {
    /// @dev Option type 3 prefix (`0x0003`).
    uint16 internal constant OPTION_TYPE_3 = 3;

    /// @custom:storage-location erc7201:layerzerov2.storage.oappoptionstype3
    struct OAppOptionsType3Storage {
        /// @dev `msgType` must be defined in the child contract. E.g., `SEND` or `SEND_AND_CALL`.
        mapping(uint32 eid => mapping(uint16 msgType => bytes options)) enforcedOptions;
    }

    // keccak256(abi.encode(uint256(keccak256("layerzerov2.storage.oappoptionstype3")) - 1)) & ~bytes32(uint256(0xff))
    bytes32 private constant OAPP_OPTIONS_TYPE_3_STORAGE_LOCATION =
        0x8d2bda5d9f6ffb5796910376005392955773acee5548d0fcdb10e7c264ea0000;

    /**
     * @notice Internal function to get the OAppOptionsType3 storage.
     * @return $ Storage pointer
     */
    function _getOAppOptionsType3Storage() internal pure returns (OAppOptionsType3Storage storage $) {
        assembly {
            $.slot := OAPP_OPTIONS_TYPE_3_STORAGE_LOCATION
        }
    }

    /**
     * @notice Initializes the contract.
     * @dev This function is empty on purpose, as no custom logic is needed.
     */
    function __OAppOptionsType3Base_init() internal onlyInitializing {}

    /**
     * @notice Unchained initialization function for the contract.
     * @dev This function is empty on purpose, as no custom logic is needed.
     */
    function __OAppOptionsType3Base_init_unchained() internal onlyInitializing {}

    /**
     * @inheritdoc IOAppOptionsType3
     */
    function enforcedOptions(uint32 _eid, uint16 _msgType) public view returns (bytes memory options) {
        OAppOptionsType3Storage storage $ = _getOAppOptionsType3Storage();
        return $.enforcedOptions[_eid][_msgType];
    }

    /**
     * @dev If there is an enforced `lzReceive` option `{ gasLimit: 200k, msg.value: 1 ether }` AND a caller supplies a
     *      `lzReceive` option `{ gasLimit: 100k, msg.value: 0.5 ether }`, the resulting options will be
     *      `{ gasLimit: 300k, msg.value: 1.5 ether }` when the message is executed on the remote `lzReceive` function.
     * @dev The presence of duplicated options is handled off-chain in the verifier/executor.
     * @inheritdoc IOAppOptionsType3
     */
    function combineOptions(
        uint32 _eid,
        uint16 _msgType,
        bytes calldata _extraOptions
    ) public view virtual returns (bytes memory options) {
        OAppOptionsType3Storage storage $ = _getOAppOptionsType3Storage();
        bytes memory enforced = $.enforcedOptions[_eid][_msgType];

        // No enforced options, pass whatever the caller supplied, even if it's empty or legacy type 1/2 options.
        if (enforced.length == 0) return _extraOptions;

        // No caller options, return enforced
        if (_extraOptions.length == 0) return enforced;

        /// @dev If caller provided `_extraOptions`, they must be type 3 as it's the ONLY type that can be combined.
        if (_extraOptions.length >= 2) {
            _assertOptionsType3(_extraOptions);
            /// @dev Remove the first 2 bytes containing the type from the `_extraOptions` and combine with enforced.
            return bytes.concat(enforced, _extraOptions[2:]);
        }

        // No valid set of options was found.
        revert InvalidOptions(_extraOptions);
    }

    /**
     * @dev Internal function to assert that options are of type 3.
     * @param _options Options to be checked
     */
    function _assertOptionsType3(bytes memory _options) internal pure virtual {
        uint16 optionsType;
        assembly {
            optionsType := mload(add(_options, 2))
        }
        if (optionsType != OPTION_TYPE_3) revert InvalidOptions(_options);
    }

    // ============ Internal Functions to Wrap with Access Control ============

    /**
     * @notice Internal function to set the enforced options for specific endpoint and message type combinations.
     * @dev To be wrapped with access control.
     * @dev Provides a way for the OApp to enforce things like paying for minimum destination `lzReceive` gas amounts.
     * @dev These enforced options can vary as the potential options/execution on the remote may differ as per the
     *      `msgType`. E.g., the amount of `lzReceive` gas necessary to deliver a `lzCompose` message adds overhead you
     *      don't want to pay if you are only sending a standard message such as `lzReceive` WITHOUT `sendCompose`.
     * @param _enforcedOptions Array of `EnforcedOptionParam` structures specifying enforced options
     */
    function _setEnforcedOptions(IOAppOptionsType3.EnforcedOptionParam[] memory _enforcedOptions) internal virtual {
        OAppOptionsType3Storage storage $ = _getOAppOptionsType3Storage();
        for (uint256 i = 0; i < _enforcedOptions.length; i++) {
            /// @dev Enforced options are only available for option type 3, as types 1 and 2 don't support combining.
            if (_enforcedOptions[i].options.length != 0) {
                _assertOptionsType3(_enforcedOptions[i].options);
            }
            $.enforcedOptions[_enforcedOptions[i].eid][_enforcedOptions[i].msgType] = _enforcedOptions[i].options;
        }

        emit EnforcedOptionSet(_enforcedOptions);
    }
}
