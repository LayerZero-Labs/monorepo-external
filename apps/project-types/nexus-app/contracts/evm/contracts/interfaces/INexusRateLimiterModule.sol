// SPDX-License-Identifier: MIT
pragma solidity ^0.8.22;

import { IRateLimiter } from "@layerzerolabs/utils-evm-impl/contracts/interfaces/IRateLimiter.sol";

import { INexusModule } from "./INexusModule.sol";
import { INexusRateLimiter } from "./INexusRateLimiter.sol";
import { ITokenScales } from "./ITokenScales.sol";

/**
 * @title INexusRateLimiterModule
 * @author LayerZero Labs (tinom.eth)
 * @custom:version 1.0.0
 * @notice Interface for the Nexus rate limiter module.
 */
interface INexusRateLimiterModule is INexusRateLimiter, IRateLimiter, ITokenScales, INexusModule {}
