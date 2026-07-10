// SPDX-License-Identifier: MIT
pragma solidity ^0.8.22;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { OFTBurnMintExtendedRBACUpgradeable } from "./OFTBurnMintExtendedRBACUpgradeable.sol";

/**
 * @title OFTBurnSelfMintExtendedRBACUpgradeable
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
contract OFTBurnSelfMintExtendedRBACUpgradeable is OFTBurnMintExtendedRBACUpgradeable {
    using SafeERC20 for IERC20;

    /**
     * @dev Sets immutable variables.
     * @dev Approval is assumed to be required since burning tokens performs `transferFrom`.
     * @param _token Address of the underlying ERC20 token, must implement `IERC20Metadata`
     * @param _burnerMinter Contract with burn and mint capabilities for `_token`
     * @param _endpoint LayerZero endpoint address
     * @param _burnSelector Function selector for the burn function, `0x42966c68` for `burn(uint256)`
     * @param _mintSelector Function selector for the mint function, `0x40c10f19` for `mint(address,uint256)`
     * @param _rateLimiterScaleDecimals Number of decimals to scale rate limit amounts (usually 0)
     */
    constructor(
        address _token,
        address _burnerMinter,
        address _endpoint,
        bytes4 _burnSelector,
        bytes4 _mintSelector,
        uint8 _rateLimiterScaleDecimals
    )
        OFTBurnMintExtendedRBACUpgradeable(
            _token,
            _burnerMinter,
            _endpoint,
            true,
            _burnSelector,
            _mintSelector,
            _rateLimiterScaleDecimals
        )
    {}

    /**
     * @dev Override to execute the 2-step burn process.
     * @inheritdoc OFTBurnMintExtendedRBACUpgradeable
     */
    function _burnAndCollectFee(
        address _from,
        uint256 _amountSentLD,
        uint256 _amountReceivedLD
    ) internal virtual override {
        /// @dev Transfer tokens to self and burn. Assumes lossless transfer.
        IERC20(token()).safeTransferFrom(_from, address(this), _amountSentLD);
        _callBurnerMinter(abi.encodeWithSelector(BURN_SELECTOR, _amountReceivedLD));

        /// @dev Fee tokens remain in the contract after partial burn, transfer to fee deposit.
        if (_amountSentLD > _amountReceivedLD) {
            unchecked {
                IERC20(token()).safeTransfer(feeDeposit(), _amountSentLD - _amountReceivedLD);
            }
        }
    }
}
