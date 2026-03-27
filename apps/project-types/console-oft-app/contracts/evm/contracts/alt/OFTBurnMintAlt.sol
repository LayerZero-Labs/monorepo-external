// SPDX-License-Identifier: MIT
pragma solidity ^0.8.22;

import { OFTBurnMintExtendedRBACAltUpgradeable } from "@layerzerolabs/oft-evm-upgradeable-impl/contracts/extended/alt/OFTBurnMintExtendedRBACAltUpgradeable.sol";

/**
 * @title OFTBurnMintAlt
 * @author LayerZero Labs (@TRileySchwarz, tinom.eth)
 * @custom:version 1.0.0
 * @notice `OFTBurnMint` variant that pays native fees using an ERC20 token instead of `msg.value`.
 * @dev For chains where gas/native fees are paid via an ERC20 token (e.g., some L2s using `EndpointV2Alt`).
 */
contract OFTBurnMintAlt is OFTBurnMintExtendedRBACAltUpgradeable {
    constructor(
        address _token,
        address _burnerMinter,
        address _endpoint,
        bool _approvalRequired,
        bytes4 _burnSelector,
        bytes4 _mintSelector,
        uint8 _rateLimiterScaleDecimals
    )
        OFTBurnMintExtendedRBACAltUpgradeable(
            _token,
            _burnerMinter,
            _endpoint,
            _approvalRequired,
            _burnSelector,
            _mintSelector,
            _rateLimiterScaleDecimals
        )
    {}
}
