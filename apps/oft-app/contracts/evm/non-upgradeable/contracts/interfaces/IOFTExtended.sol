// SPDX-License-Identifier: MIT
pragma solidity ^0.8.22;

import { IOAppExtended } from "@layerzerolabs/oapp-evm-contracts/contracts/interfaces/IOAppExtended.sol";
import { IFeeConfig } from "@layerzerolabs/utils-evm-contracts/contracts/interfaces/IFeeConfig.sol";
import { IFeeHandler } from "@layerzerolabs/utils-evm-contracts/contracts/interfaces/IFeeHandler.sol";
import { IPauseByID } from "@layerzerolabs/utils-evm-contracts/contracts/interfaces/IPauseByID.sol";
import { IRateLimiter } from "@layerzerolabs/utils-evm-contracts/contracts/interfaces/IRateLimiter.sol";
import { IOFT } from "./IOFT.sol";

/**
 * @title IOFTExtended
 * @author LayerZero Labs (@TRileySchwarz, tinom.eth)
 * @custom:version 1.0.0
 * @notice Interface for extended OFT contracts with fee, pause, and rate limiter functionality.
 */
interface IOFTExtended is IOFT, IOAppExtended, IFeeConfig, IFeeHandler, IPauseByID, IRateLimiter {}
