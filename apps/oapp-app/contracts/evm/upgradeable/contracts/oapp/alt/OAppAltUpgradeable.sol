// SPDX-License-Identifier: MIT
pragma solidity ^0.8.22;

import { IOAppAlt } from "@layerzerolabs/oapp-evm-impl/contracts/interfaces/IOAppAlt.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { OAppCoreBaseUpgradeable } from "./../OAppCoreBaseUpgradeable.sol";

/**
 * @title OAppAltUpgradeable
 * @author LayerZero Labs (@TRileySchwarz, tinom.eth)
 * @custom:version 1.0.0
 * @notice OApp extension that pays native fees using an ERC20 token instead of `msg.value`.
 * @dev For chains where gas/native fees are paid via an ERC20 token (e.g., some L2s using `EndpointV2Alt`).
 * @dev When using multiple inheritance, inherit from `OAppAltUpgradeable` after OApp or OFT contracts to ensure
 *      `endpoint` is already set when this constructor runs.
 * @dev Overrides `OAppCoreBaseUpgradeable` instead of `OAppSenderUpgradeable` to avoid inheritance conflicts.
 */
abstract contract OAppAltUpgradeable is IOAppAlt, OAppCoreBaseUpgradeable {
    using SafeERC20 for IERC20;

    /// @dev ERC20 token used to pay native fees, cached from the endpoint.
    address internal immutable NATIVE_TOKEN;

    /**
     * @dev Sets immutable variables.
     * @dev Reverts if the endpoint has a zero address native token.
     */
    constructor() {
        /// @dev `endpoint` should already be set at this point by `OAppCoreUpgradeable`.
        NATIVE_TOKEN = endpoint.nativeToken();
        if (NATIVE_TOKEN == address(0)) revert InvalidNativeToken();
    }

    /**
     * @dev Overrides native fee payment to use an ERC20 token instead of `msg.value`, always returns 0.
     * @dev Implicitly overrides `OAppSenderUpgradeable._payNative` to return 0.
     * @param _nativeFee Native fee to be paid
     * @return nativeFee Always 0 since the fee is paid via ERC20 transfer
     */
    function _payNative(uint256 _nativeFee) internal virtual returns (uint256 nativeFee) {
        if (msg.value > 0) revert OnlyAltToken();
        if (_nativeFee > 0) {
            IERC20(NATIVE_TOKEN).safeTransferFrom(msg.sender, address(endpoint), _nativeFee);
        }
        return 0;
    }
}
