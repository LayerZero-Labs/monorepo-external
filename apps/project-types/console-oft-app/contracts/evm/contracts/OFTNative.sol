// SPDX-License-Identifier: MIT
pragma solidity ^0.8.22;

import { OFTNativeExtendedRBACUpgradeable } from "@layerzerolabs/oft-evm-upgradeable-impl/contracts/extended/OFTNativeExtendedRBACUpgradeable.sol";

/**
 * @title OFTNative
 * @author LayerZero Labs (@TRileySchwarz, tinom.eth)
 * @custom:version 1.0.0
 * @notice Upgradeable OFT native adapter with toggleable pause, fee, and rate limit functionality.
 * @dev Roles are handled through `AccessControl2StepUpgradeable`.
 */
contract OFTNative is OFTNativeExtendedRBACUpgradeable {
    constructor(
        uint8 _localDecimals,
        address _endpoint,
        uint8 _rateLimiterScaleDecimals
    ) OFTNativeExtendedRBACUpgradeable(_localDecimals, _endpoint, _rateLimiterScaleDecimals) {}
}
