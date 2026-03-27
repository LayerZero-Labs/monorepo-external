// SPDX-License-Identifier: MIT
pragma solidity ^0.8.22;

import { OAppAltUpgradeable } from "@layerzerolabs/oapp-evm-upgradeable-impl/contracts/oapp/alt/OAppAltUpgradeable.sol";
import { OAppSenderUpgradeable } from "@layerzerolabs/oapp-evm-upgradeable-impl/contracts/oapp/OAppSenderUpgradeable.sol";
import { OFTLockUnlockExtendedRBACUpgradeable } from "./../OFTLockUnlockExtendedRBACUpgradeable.sol";

/**
 * @title OFTLockUnlockExtendedRBACAltUpgradeable
 * @author LayerZero Labs (@TRileySchwarz, tinom.eth)
 * @custom:version 1.0.0
 * @notice `OFTLockUnlockExtendedRBACUpgradeable` variant that pays native fees using an ERC20 token instead of `msg.value`.
 * @dev For chains where gas/native fees are paid via an ERC20 token (e.g., some L2s using `EndpointV2Alt`).
 */
contract OFTLockUnlockExtendedRBACAltUpgradeable is OFTLockUnlockExtendedRBACUpgradeable, OAppAltUpgradeable {
    /**
     * @dev Sets immutable variables.
     * @param _token Address of the underlying ERC20 token, it must implement the `IERC20Metadata` interface
     * @param _endpoint LayerZero `EndpointV2Alt` address
     */
    constructor(
        address _token,
        address _endpoint,
        uint8 _rateLimiterScaleDecimals
    ) OFTLockUnlockExtendedRBACUpgradeable(_token, _endpoint, _rateLimiterScaleDecimals) {}

    /**
     * @inheritdoc OAppAltUpgradeable
     */
    function _payNative(
        uint256 _nativeFee
    ) internal virtual override(OAppSenderUpgradeable, OAppAltUpgradeable) returns (uint256 nativeFee) {
        return OAppAltUpgradeable._payNative(_nativeFee);
    }
}
