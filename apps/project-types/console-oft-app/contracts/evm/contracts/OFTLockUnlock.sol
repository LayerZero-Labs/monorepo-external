// SPDX-License-Identifier: MIT
pragma solidity ^0.8.22;

import { OFTLockUnlockExtendedRBACUpgradeable } from "@layerzerolabs/oft-evm-upgradeable-impl/contracts/extended/OFTLockUnlockExtendedRBACUpgradeable.sol";

/**
 * @title OFTLockUnlock
 * @author LayerZero Labs (@TRileySchwarz, tinom.eth)
 * @custom:version 1.0.0
 * @notice Upgradeable OFT lock-unlock adapter with toggleable pause, fee, and rate limit functionality.
 * @dev Roles are handled through `AccessControl2StepUpgradeable`.
 */
contract OFTLockUnlock is OFTLockUnlockExtendedRBACUpgradeable {
    constructor(
        address _token,
        address _endpoint,
        uint8 _rateLimiterScaleDecimals
    ) OFTLockUnlockExtendedRBACUpgradeable(_token, _endpoint, _rateLimiterScaleDecimals) {}
}
