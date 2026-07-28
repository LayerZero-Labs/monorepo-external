// SPDX-License-Identifier: MIT
pragma solidity ^0.8.22;

import { Origin } from "@layerzerolabs/lz-evm-protocol-v2/contracts/interfaces/ILayerZeroEndpointV2.sol";
import { OAppCoreBaseUpgradeable } from "./../OAppCoreBaseUpgradeable.sol";

/**
 * @title OAppMessagingChannelBaseUpgradeable
 * @author LayerZero Labs (tinom.eth)
 * @custom:version 1.0.0
 * @notice Abstract upgradeable contract that wraps endpoint messaging channel operations.
 * @dev No public management functions are exposed by this contract, wrappers should be used with access control.
 *      Alternatively, refer to `OAppMessagingChannelRBACUpgradeable` for a permissioned implementation.
 */
abstract contract OAppMessagingChannelBaseUpgradeable is OAppCoreBaseUpgradeable {
    /**
     * @notice Initializes the contract.
     * @dev This function is empty on purpose, as no custom logic is needed.
     */
    function __OAppMessagingChannelBase_init() internal onlyInitializing {}

    /**
     * @notice Unchained initialization function for the contract.
     * @dev This function is empty on purpose, as no custom logic is needed.
     */
    function __OAppMessagingChannelBase_init_unchained() internal onlyInitializing {}

    // ============ Internal Functions to Wrap with Access Control ============

    /**
     * @notice Internal function to permanently consume a verified inbound message without the `lzReceive` callback.
     * @dev To be wrapped with access control.
     * @param _origin Origin of the message
     * @param _guid GUID of the message
     * @param _message Message payload
     */
    function _clear(Origin calldata _origin, bytes32 _guid, bytes calldata _message) internal virtual {
        endpoint.clear(address(this), _origin, _guid, _message);
    }

    /**
     * @notice Internal function to permanently skip the next inbound nonce for a path.
     * @dev To be wrapped with access control.
     * @param _srcEid Source endpoint ID
     * @param _sender Sender address on the source chain
     * @param _nonce Nonce to skip, must equal `inboundNonce + 1`
     */
    function _skip(uint32 _srcEid, bytes32 _sender, uint64 _nonce) internal virtual {
        endpoint.skip(address(this), _srcEid, _sender, _nonce);
    }

    /**
     * @notice Internal function to permanently burn a verified or nilified inbound nonce so it can never be executed or
     *         re-verified.
     * @dev To be wrapped with access control.
     * @param _srcEid Source endpoint ID
     * @param _sender Sender address on the source chain
     * @param _nonce Nonce to burn, must be `<= lazyInboundNonce`
     * @param _payloadHash Expected payload hash for the nonce
     */
    function _burn(uint32 _srcEid, bytes32 _sender, uint64 _nonce, bytes32 _payloadHash) internal virtual {
        endpoint.burn(address(this), _srcEid, _sender, _nonce, _payloadHash);
    }

    /**
     * @notice Internal function to nilify an inbound nonce, preventing execution until it is re-verified.
     * @dev To be wrapped with access control.
     * @dev An unverified nonce can be nilified by passing `bytes32(0)` for `_payloadHash`.
     * @param _srcEid Source endpoint ID
     * @param _sender Sender address on the source chain
     * @param _nonce Nonce to nilify
     * @param _payloadHash Expected payload hash for the nonce
     */
    function _nilify(uint32 _srcEid, bytes32 _sender, uint64 _nonce, bytes32 _payloadHash) internal virtual {
        endpoint.nilify(address(this), _srcEid, _sender, _nonce, _payloadHash);
    }
}
