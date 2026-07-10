// SPDX-License-Identifier: MIT
pragma solidity ^0.8.22;

import { IOAppCore } from "./IOAppCore.sol";
import { IOAppMsgInspection } from "./IOAppMsgInspection.sol";
import { IOAppOptionsType3 } from "./IOAppOptionsType3.sol";
import { IOAppReceiver } from "./IOAppReceiver.sol";

/**
 * @title IOAppExtended
 * @author LayerZero Labs (@TRileySchwarz, tinom.eth)
 * @custom:version 1.0.0
 * @notice Aggregate interface for extended OApp contracts.
 * @dev `IOAppReceiver` must precede `IOAppCore` for C3 linearization compatibility with `OApp`,
 *      where `OAppReceiver`'s linearization places `IOAppReceiver` before `IOAppCore`.
 */
interface IOAppExtended is IOAppReceiver, IOAppCore, IOAppOptionsType3, IOAppMsgInspection {}
