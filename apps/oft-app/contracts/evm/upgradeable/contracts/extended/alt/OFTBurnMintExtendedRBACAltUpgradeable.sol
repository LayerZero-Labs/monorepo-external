// SPDX-License-Identifier: MIT
pragma solidity ^0.8.22;

import { OAppAltUpgradeable } from "@layerzerolabs/oapp-evm-upgradeable-impl/contracts/oapp/alt/OAppAltUpgradeable.sol";
import { OAppSenderUpgradeable } from "@layerzerolabs/oapp-evm-upgradeable-impl/contracts/oapp/OAppSenderUpgradeable.sol";
import { OFTBurnMintExtendedRBACUpgradeable } from "./../OFTBurnMintExtendedRBACUpgradeable.sol";

/**
 * @title OFTBurnMintExtendedRBACAltUpgradeable
 * @author LayerZero Labs (@TRileySchwarz, tinom.eth)
 * @custom:version 1.0.0
 * @notice `OFTBurnMintExtendedRBACUpgradeable` variant that pays native fees using an ERC20 token instead of `msg.value`.
 * @dev For chains where gas/native fees are paid via an ERC20 token (e.g., some L2s using `EndpointV2Alt`).
 */
contract OFTBurnMintExtendedRBACAltUpgradeable is OFTBurnMintExtendedRBACUpgradeable, OAppAltUpgradeable {
    /**
     * @dev Sets immutable variables.
     * @param _token Address of the underlying ERC20 token, must implement `IERC20Metadata`
     * @param _burnerMinter Contract with burn and mint capabilities for `_token`
     * @param _endpoint LayerZero `EndpointV2Alt` address
     * @param _approvalRequired Whether the OFT contract requires approval of the underlying token to send
     * @param _burnSelector Function selector for the burn function, `0x9dc29fac` for `burn(address,uint256)`
     * @param _mintSelector Function selector for the mint function, `0x40c10f19` for `mint(address,uint256)`
     * @param _rateLimiterScaleDecimals Number of decimals to scale rate limit amounts (usually 0)
     */
    constructor(
        address _token,
        address _burnerMinter,
        address _endpoint,
        bool _approvalRequired,
        bytes4 _burnSelector,
        bytes4 _mintSelector,
        uint8 _rateLimiterScaleDecimals
    )
        OFTBurnMintExtendedRBACUpgradeable(
            _token,
            _burnerMinter,
            _endpoint,
            _approvalRequired,
            _burnSelector,
            _mintSelector,
            _rateLimiterScaleDecimals
        )
    {}

    /**
     * @inheritdoc OAppAltUpgradeable
     */
    function _payNative(
        uint256 _nativeFee
    ) internal virtual override(OAppSenderUpgradeable, OAppAltUpgradeable) returns (uint256 nativeFee) {
        return OAppAltUpgradeable._payNative(_nativeFee);
    }
}
