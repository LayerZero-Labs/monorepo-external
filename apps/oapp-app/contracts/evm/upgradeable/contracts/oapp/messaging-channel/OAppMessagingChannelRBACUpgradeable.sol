// SPDX-License-Identifier: MIT
pragma solidity ^0.8.22;

import { Origin } from "@layerzerolabs/lz-evm-protocol-v2/contracts/interfaces/ILayerZeroEndpointV2.sol";
import { IOAppMessagingChannel } from "@layerzerolabs/oapp-evm-contracts/contracts/interfaces/IOAppMessagingChannel.sol";
import { AccessControl2StepUpgradeable } from "@layerzerolabs/utils-upgradeable-evm-contracts/contracts/access/AccessControl2StepUpgradeable.sol";
import { OAppMessagingChannelBaseUpgradeable } from "./OAppMessagingChannelBaseUpgradeable.sol";

/**
 * @title OAppMessagingChannelRBACUpgradeable
 * @author LayerZero Labs (tinom.eth)
 * @custom:version 1.0.0
 * @notice Abstract upgradeable contract that wraps endpoint messaging channel operations with RBAC.
 * @dev Exposes public management functions through `AccessControl2StepUpgradeable`.
 * @dev `MESSAGING_CHANNEL_MANAGER_ROLE` gates non-reversible operations (`clear`, `skip`, `burn`).
 *      `MESSAGE_NILIFIER_ROLE` gates the reversible `nilify` operation.
 * @dev `IOAppMessagingChannel` must precede `OAppMessagingChannelBaseUpgradeable` for C3 linearization compatibility
 *      with other OApp extensions that place their interfaces before `Initializable`.
 */
abstract contract OAppMessagingChannelRBACUpgradeable is
    IOAppMessagingChannel,
    OAppMessagingChannelBaseUpgradeable,
    AccessControl2StepUpgradeable
{
    /// @notice Role for non-reversible messaging channel operations (`clear`, `skip`, `burn`).
    bytes32 public constant MESSAGING_CHANNEL_MANAGER_ROLE = keccak256("MESSAGING_CHANNEL_MANAGER_ROLE");

    /// @notice Role for the reversible messaging channel operation (`nilify`).
    bytes32 public constant MESSAGE_NILIFIER_ROLE = keccak256("MESSAGE_NILIFIER_ROLE");

    /**
     * @notice Initializes the contract.
     * @dev This function is empty on purpose, as no custom logic is needed.
     */
    function __OAppMessagingChannelRBAC_init() internal onlyInitializing {}

    /**
     * @notice Unchained initialization function for the contract.
     * @dev This function is empty on purpose, as no custom logic is needed.
     */
    function __OAppMessagingChannelRBAC_init_unchained() internal onlyInitializing {}

    /**
     * @inheritdoc IOAppMessagingChannel
     */
    function clear(
        Origin calldata _origin,
        bytes32 _guid,
        bytes calldata _message
    ) public virtual onlyRole(MESSAGING_CHANNEL_MANAGER_ROLE) {
        _clear(_origin, _guid, _message);
    }

    /**
     * @inheritdoc IOAppMessagingChannel
     */
    function skip(
        uint32 _srcEid,
        bytes32 _sender,
        uint64 _nonce
    ) public virtual onlyRole(MESSAGING_CHANNEL_MANAGER_ROLE) {
        _skip(_srcEid, _sender, _nonce);
    }

    /**
     * @inheritdoc IOAppMessagingChannel
     */
    function burn(
        uint32 _srcEid,
        bytes32 _sender,
        uint64 _nonce,
        bytes32 _payloadHash
    ) public virtual onlyRole(MESSAGING_CHANNEL_MANAGER_ROLE) {
        _burn(_srcEid, _sender, _nonce, _payloadHash);
    }

    /**
     * @inheritdoc IOAppMessagingChannel
     */
    function nilify(
        uint32 _srcEid,
        bytes32 _sender,
        uint64 _nonce,
        bytes32 _payloadHash
    ) public virtual onlyRole(MESSAGE_NILIFIER_ROLE) {
        _nilify(_srcEid, _sender, _nonce, _payloadHash);
    }
}
