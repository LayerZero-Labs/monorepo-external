// SPDX-License-Identifier: MIT
pragma solidity ^0.8.22;

import { OFTBurnMintExtendedRBACUpgradeable } from "@layerzerolabs/oft-evm-upgradeable-impl/contracts/extended/OFTBurnMintExtendedRBACUpgradeable.sol";

/**
 * @title OFTBurnMint
 * @author LayerZero Labs (@TRileySchwarz, tinom.eth)
 * @custom:version 1.0.0
 * @notice Upgradeable OFT burn-mint adapter with toggleable pause, fee, and rate limit functionality.
 *         Supports dynamic mint/burn function selectors and configurable approval requirements.
 * @dev Roles are handled through `AccessControl2StepUpgradeable`.
 * @dev Burner-minter configurations supported:
 *      - Any mint function if it has `(address,uint256)` parameters.
 *      - Any burn function if it has `(address,uint256)` parameters.
 *      - Non-privileged burn functions, by burning through ERC20 approvals of the OFT contract with `(address,uint256)` parameters.
 *      - Examples:
 *        - `mint(address,uint256)`, `burn(address,uint256)`:
 *          - `_mintSelector`: `0x40c10f19`
 *          - `_burnSelector`: `0x9dc29fac`
 *        - `issue(address,uint256)`, `redeem(address,uint256)`:
 *          - `_mintSelector`: `0x867904b4`
 *          - `_burnSelector`: `0x1e9a6950`
 */
contract OFTBurnMint is OFTBurnMintExtendedRBACUpgradeable {
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
}
