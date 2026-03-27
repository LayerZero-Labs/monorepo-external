// SPDX-License-Identifier: MIT
pragma solidity ^0.8.22;

import { OFTBurnSelfMintExtendedRBACUpgradeable } from "@layerzerolabs/oft-evm-upgradeable-impl/contracts/extended/OFTBurnSelfMintExtendedRBACUpgradeable.sol";

/**
 * @title OFTBurnSelfMint
 * @author LayerZero Labs (@TRileySchwarz, tinom.eth)
 * @custom:version 1.0.0
 * @notice Upgradeable OFT burn-mint adapter with toggleable pause, fee, and rate limit functionality.
 *         Supports dynamic mint/burn function selectors, assuming that the burn operation happens in 2 steps:
 *         - First, the OFT transfers the tokens to itself.
 *         - Then, the OFT burns the tokens.
 * @dev Roles are handled through `AccessControl2StepUpgradeable`.
 * @dev Approval is always required since burning performs `transferFrom`.
 * @dev Burner-minter configurations supported:
 *      - Any mint function if it has `(address,uint256)` parameters.
 *      - Any burn function if it has `(uint256)` parameters and burns from self.
 *      - Examples:
 *        - `mint(address,uint256)`, `burn(uint256)`:
 *          - `_mintSelector`: `0x40c10f19`
 *          - `_burnSelector`: `0x42966c68`
 *        - `issue(address,uint256)`, `redeem(uint256)`:
 *          - `_mintSelector`: `0x867904b4`
 *          - `_burnSelector`: `0xdb006a75`
 */
contract OFTBurnSelfMint is OFTBurnSelfMintExtendedRBACUpgradeable {
    constructor(
        address _token,
        address _burnerMinter,
        address _endpoint,
        bytes4 _burnSelector,
        bytes4 _mintSelector,
        uint8 _rateLimiterScaleDecimals
    )
        OFTBurnSelfMintExtendedRBACUpgradeable(
            _token,
            _burnerMinter,
            _endpoint,
            _burnSelector,
            _mintSelector,
            _rateLimiterScaleDecimals
        )
    {}
}
