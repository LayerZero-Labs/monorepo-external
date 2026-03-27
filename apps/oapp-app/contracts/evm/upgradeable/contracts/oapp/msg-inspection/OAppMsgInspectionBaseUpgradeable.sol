// SPDX-License-Identifier: MIT
pragma solidity ^0.8.22;

import { IOAppMsgInspection } from "@layerzerolabs/oapp-evm-impl/contracts/interfaces/IOAppMsgInspection.sol";
import { Initializable } from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";

/**
 * @title OAppMsgInspectionBaseUpgradeable
 * @author LayerZero Labs (@TRileySchwarz, tinom.eth)
 * @custom:version 1.0.0
 * @notice Abstract upgradeable contract that implements message inspection functionality.
 * @dev No public management functions are exposed by this contract, wrappers should be used with access control.
 *      Alternatively, refer to `OAppMsgInspectionRBACUpgradeable` for a permissioned implementation.
 */
abstract contract OAppMsgInspectionBaseUpgradeable is IOAppMsgInspection, Initializable {
    /// @custom:storage-location erc7201:layerzerov2.storage.oappmsginspection
    struct OAppMsgInspectionStorage {
        address msgInspector;
    }

    // keccak256(abi.encode(uint256(keccak256("layerzerov2.storage.oappmsginspection")) - 1)) & ~bytes32(uint256(0xff))
    bytes32 private constant OAPP_MSG_INSPECTION_STORAGE_LOCATION =
        0x24c2aca717bd6504b7874a40f547315f719b854b33e7ff8940b1b271c2deaf00;

    /**
     * @notice Internal function to get the message inspection storage.
     * @return $ Storage pointer
     */
    function _getOAppMsgInspectionStorage() internal pure returns (OAppMsgInspectionStorage storage $) {
        assembly {
            $.slot := OAPP_MSG_INSPECTION_STORAGE_LOCATION
        }
    }

    /**
     * @notice Initializes the contract.
     * @dev This function is empty on purpose, as no custom logic is needed.
     */
    function __OAppMsgInspectionBase_init() internal onlyInitializing {}

    /**
     * @notice Unchained initialization function for the contract.
     * @dev This function is empty on purpose, as no custom logic is needed.
     */
    function __OAppMsgInspectionBase_init_unchained() internal onlyInitializing {}

    /**
     * @inheritdoc IOAppMsgInspection
     */
    function msgInspector() public view virtual returns (address inspector) {
        OAppMsgInspectionStorage storage $ = _getOAppMsgInspectionStorage();
        return $.msgInspector;
    }

    // ============ Internal Functions to Wrap with Access Control ============

    /**
     * @notice Internal function to set the message inspector address.
     * @dev To be wrapped with access control.
     * @param _msgInspector Address of the new message inspector
     */
    function _setMsgInspector(address _msgInspector) internal virtual {
        OAppMsgInspectionStorage storage $ = _getOAppMsgInspectionStorage();
        $.msgInspector = _msgInspector;
        emit MsgInspectorSet(_msgInspector);
    }
}
