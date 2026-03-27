// SPDX-License-Identifier: MIT
pragma solidity ^0.8.22;

import { OFTBurnSelfMintExtendedRBACAltUpgradeable } from "@layerzerolabs/oft-evm-upgradeable-impl/contracts/extended/alt/OFTBurnSelfMintExtendedRBACAltUpgradeable.sol";

/**
 * @title OFTBurnSelfMintAlt
 * @author LayerZero Labs (@TRileySchwarz, tinom.eth)
 * @custom:version 1.0.0
 * @notice `OFTBurnSelfMint` variant that pays native fees using an ERC20 token instead of `msg.value`.
 * @dev For chains where gas/native fees are paid via an ERC20 token (e.g., some L2s using `EndpointV2Alt`).
 */
contract OFTBurnSelfMintAlt is OFTBurnSelfMintExtendedRBACAltUpgradeable {
    constructor(
        address _token,
        address _burnerMinter,
        address _endpoint,
        bytes4 _burnSelector,
        bytes4 _mintSelector,
        uint8 _rateLimiterScaleDecimals
    )
        OFTBurnSelfMintExtendedRBACAltUpgradeable(
            _token,
            _burnerMinter,
            _endpoint,
            _burnSelector,
            _mintSelector,
            _rateLimiterScaleDecimals
        )
    {}
}
