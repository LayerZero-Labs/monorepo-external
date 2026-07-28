// SPDX-License-Identifier: MIT
pragma solidity ^0.8.22;

import {
    IOAppExtended,
    OAPP_EXTENDED_INTERFACE_ID
} from "@layerzerolabs/oapp-evm-contracts/contracts/interfaces/IOAppExtended.sol";
import { ICreditRedirect } from "@layerzerolabs/utils-evm-contracts/contracts/interfaces/ICreditRedirect.sol";
import { IFeeConfig } from "@layerzerolabs/utils-evm-contracts/contracts/interfaces/IFeeConfig.sol";
import { IFeeHandler } from "@layerzerolabs/utils-evm-contracts/contracts/interfaces/IFeeHandler.sol";
import { IPauseByID } from "@layerzerolabs/utils-evm-contracts/contracts/interfaces/IPauseByID.sol";
import { IRateLimiter } from "@layerzerolabs/utils-evm-contracts/contracts/interfaces/IRateLimiter.sol";
import { IOFT } from "./IOFT.sol";

/**
 * @title IOFTExtended
 * @author LayerZero Labs (@TRileySchwarz, tinom.eth)
 * @custom:version 1.1.0
 * @notice Interface for extended OFT contracts with credit redirect, fee, pause, and rate limiter functionality.
 */
interface IOFTExtended is IOFT, IOAppExtended, ICreditRedirect, IFeeConfig, IFeeHandler, IPauseByID, IRateLimiter {}

/// @dev Flatten all leaf interface IDs.
bytes4 constant OFT_EXTENDED_INTERFACE_ID = type(IOFT).interfaceId ^
    OAPP_EXTENDED_INTERFACE_ID ^
    type(ICreditRedirect).interfaceId ^
    type(IFeeConfig).interfaceId ^
    type(IFeeHandler).interfaceId ^
    type(IPauseByID).interfaceId ^
    type(IRateLimiter).interfaceId;
