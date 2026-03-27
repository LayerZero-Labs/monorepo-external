// SPDX-License-Identifier: MIT
pragma solidity ^0.8.22;

import { OFTLockUnlockExtendedRBACAltUpgradeable } from "@layerzerolabs/oft-evm-upgradeable-impl/contracts/extended/alt/OFTLockUnlockExtendedRBACAltUpgradeable.sol";

/**
 * @title OFTLockUnlockAlt
 * @author LayerZero Labs (@TRileySchwarz, tinom.eth)
 * @custom:version 1.0.0
 * @notice `OFTLockUnlock` variant that pays native fees using an ERC20 token instead of `msg.value`.
 * @dev For chains where gas/native fees are paid via an ERC20 token (e.g., some L2s using `EndpointV2Alt`).
 */
contract OFTLockUnlockAlt is OFTLockUnlockExtendedRBACAltUpgradeable {
    constructor(
        address _token,
        address _endpoint,
        uint8 _rateLimiterScaleDecimals
    ) OFTLockUnlockExtendedRBACAltUpgradeable(_token, _endpoint, _rateLimiterScaleDecimals) {}
}
