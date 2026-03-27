// SPDX-License-Identifier: MIT
pragma solidity ^0.8.22;

import { IOAppCore, ILayerZeroEndpointV2 } from "@layerzerolabs/oapp-evm-impl/contracts/interfaces/IOAppCore.sol";
import { Initializable } from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";

/**
 * @title OAppCoreBaseUpgradeable
 * @author LayerZero Labs
 * @custom:version 1.0.0
 * @notice Abstract upgradeable contract implementing the IOAppCore interface with basic OApp configurations.
 * @dev No public management functions are exposed by this contract, wrappers should be used with access control.
 *      Alternatively, refer to `OAppCoreRBACUpgradeable` for a permissioned implementation.
 */
abstract contract OAppCoreBaseUpgradeable is IOAppCore, Initializable {
    /// @notice The LayerZero endpoint associated with the given OApp.
    ILayerZeroEndpointV2 public immutable endpoint;

    /// @custom:storage-location erc7201:layerzerov2.storage.oappcore
    struct OAppCoreStorage {
        mapping(uint32 => bytes32) peers;
    }

    // keccak256(abi.encode(uint256(keccak256("layerzerov2.storage.oappcore")) - 1)) & ~bytes32(uint256(0xff))
    bytes32 private constant OAPP_CORE_STORAGE_LOCATION =
        0x72ab1bc1039b79dc4724ffca13de82c96834302d3c7e0d4252232d4b2dd8f900;

    /**
     * @notice Internal function to get the OAppCore storage.
     * @return $ Storage pointer
     */
    function _getOAppCoreStorage() internal pure returns (OAppCoreStorage storage $) {
        assembly {
            $.slot := OAPP_CORE_STORAGE_LOCATION
        }
    }

    /**
     * @dev Constructor to initialize the OAppCoreBase with the provided endpoint.
     * @param _endpoint The address of the LOCAL LayerZero endpoint.
     */
    constructor(address _endpoint) {
        endpoint = ILayerZeroEndpointV2(_endpoint);
    }

    /**
     * @notice Initializes the OAppCoreBase with the provided delegate.
     * @param _delegate The delegate capable of making OApp configurations inside of the endpoint.
     */
    function __OAppCoreBase_init(address _delegate) internal onlyInitializing {
        __OAppCoreBase_init_unchained(_delegate);
    }

    /**
     * @notice Unchained initialization function for the contract.
     * @param _delegate The delegate capable of making OApp configurations inside of the endpoint.
     */
    function __OAppCoreBase_init_unchained(address _delegate) internal onlyInitializing {
        if (_delegate == address(0)) revert InvalidDelegate();
        endpoint.setDelegate(_delegate);
    }

    /**
     * @notice Returns the peer address (OApp instance) associated with a specific endpoint.
     * @param _eid The endpoint ID.
     * @return peer The address of the peer associated with the specified endpoint.
     */
    function peers(uint32 _eid) public view virtual override returns (bytes32 peer) {
        OAppCoreStorage storage $ = _getOAppCoreStorage();
        return $.peers[_eid];
    }

    /**
     * @notice Internal function to get the peer address associated with a specific endpoint; reverts if NOT set.
     * @param _eid The endpoint ID.
     * @return peer The address of the peer associated with the specified endpoint.
     */
    function _getPeerOrRevert(uint32 _eid) internal view virtual returns (bytes32) {
        OAppCoreStorage storage $ = _getOAppCoreStorage();
        bytes32 peer = $.peers[_eid];
        if (peer == bytes32(0)) revert NoPeer(_eid);
        return peer;
    }

    // ============ Internal Functions to Wrap with Access Control ============

    /**
     * @notice Internal function to set the peer address (OApp instance) for a corresponding endpoint.
     * @dev To be wrapped with access control.
     * @dev Indicates that the peer is trusted to send LayerZero messages to this OApp.
     * @dev Set this to bytes32(0) to remove the peer address.
     * @dev Peer is a bytes32 to accommodate non-evm chains.
     * @param _eid The endpoint ID.
     * @param _peer The address of the peer to be associated with the corresponding endpoint.
     */
    function _setPeer(uint32 _eid, bytes32 _peer) internal virtual {
        OAppCoreStorage storage $ = _getOAppCoreStorage();
        $.peers[_eid] = _peer;
        emit PeerSet(_eid, _peer);
    }

    /**
     * @notice Internal function to set the delegate address for the OApp.
     * @dev To be wrapped with access control.
     * @dev Provides the ability for a delegate to set configs, on behalf of the OApp, directly on the Endpoint contract.
     * @param _delegate The address of the delegate to be set.
     */
    function _setDelegate(address _delegate) internal virtual {
        endpoint.setDelegate(_delegate);
    }
}
