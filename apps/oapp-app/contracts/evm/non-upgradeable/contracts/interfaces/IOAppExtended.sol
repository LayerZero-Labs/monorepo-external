// SPDX-License-Identifier: MIT
pragma solidity ^0.8.22;

import { ILayerZeroReceiver } from "@layerzerolabs/lz-evm-protocol-v2/contracts/interfaces/ILayerZeroReceiver.sol";
import { IOAppCore } from "./IOAppCore.sol";
import { IOAppMessagingChannel } from "./IOAppMessagingChannel.sol";
import { IOAppMsgInspection } from "./IOAppMsgInspection.sol";
import { IOAppOptionsType3 } from "./IOAppOptionsType3.sol";
import { IOAppReceiver } from "./IOAppReceiver.sol";

/**
 * @title IOAppExtended
 * @author LayerZero Labs (@TRileySchwarz, tinom.eth)
 * @custom:version 1.1.0
 * @notice Aggregate interface for extended OApp contracts.
 * @dev `IOAppReceiver` must precede `IOAppCore` for C3 linearization compatibility with `OApp`, where `OAppReceiver`'s
 *      linearization places `IOAppReceiver` before `IOAppCore`.
 * @dev `IOAppMessagingChannel` must precede `IOAppCore` for C3 linearization compatibility with messaging-channel OApp
 *      extensions that declare `IOAppMessagingChannel` before `OAppCoreBaseUpgradeable`.
 */
interface IOAppExtended is IOAppReceiver, IOAppMessagingChannel, IOAppCore, IOAppOptionsType3, IOAppMsgInspection {}

/// @dev Flatten all leaf interface IDs.
bytes4 constant OAPP_EXTENDED_INTERFACE_ID = type(ILayerZeroReceiver).interfaceId ^
    type(IOAppReceiver).interfaceId ^
    type(IOAppMessagingChannel).interfaceId ^
    type(IOAppCore).interfaceId ^
    type(IOAppOptionsType3).interfaceId ^
    type(IOAppMsgInspection).interfaceId;
