// SPDX-License-Identifier: MIT
pragma solidity ^0.8.22;

import { IOAppAlt } from "@layerzerolabs/oapp-evm-impl/contracts/interfaces/IOAppAlt.sol";
import { OAppSenderUpgradeable } from "@layerzerolabs/oapp-evm-upgradeable-impl/contracts/oapp/OAppSenderUpgradeable.sol";

import { Nexus } from "./Nexus.sol";

/**
 * @title NexusAlt
 * @author LayerZero Labs (@TRileySchwarz, tinom.eth)
 * @custom:version 1.0.0
 * @notice `Nexus` variant that pays native fees using an ERC20 token instead of `msg.value`.
 * @dev For chains where gas/native fees are paid via an ERC20 token (e.g., some L2s using `EndpointV2Alt`).
 * @dev `NexusOFTAlt.send` handles pushing the native ERC20 fee to the endpoint. This alters conventional OFT flow,
 *      where the fee is paid after the OFT token transfer, and can result in native fee griefing if the OFT uses
 *      tokens that have hooks or allow arbitrary calls.
 */
contract NexusAlt is Nexus {
    /**
     * @dev Sets immutable variables.
     * @dev Cross-chain shared decimals are hardcoded to `6`.
     * @param _endpoint LayerZero `EndpointV2Alt` address
     * @param _localDecimals Local decimals for tokens on this chain
     * @param _burnSelector Function selector for the burn function, `0x9dc29fac` for `burn(address,uint256)`
     * @param _mintSelector Function selector for the mint function, `0x40c10f19` for `mint(address,uint256)`
     */
    constructor(
        address _endpoint,
        uint8 _localDecimals,
        bytes4 _burnSelector,
        bytes4 _mintSelector
    ) Nexus(_endpoint, _localDecimals, _burnSelector, _mintSelector) {
        if (endpoint.nativeToken() == address(0)) revert IOAppAlt.InvalidNativeToken();
    }

    /**
     * @dev `NexusOFTAlt.send` handles pushing native ERC20 fee to the endpoint. This alters conventional OFT flow,
     *      where the fee is paid after the OFT token transfer, and can result in native fee griefing if the OFT uses
     *      tokens that have hooks or allow arbitrary calls.
     * @inheritdoc OAppSenderUpgradeable
     */
    function _payNative(uint256 /* _nativeFee */) internal virtual override returns (uint256 nativeFee) {
        return 0;
    }
}
