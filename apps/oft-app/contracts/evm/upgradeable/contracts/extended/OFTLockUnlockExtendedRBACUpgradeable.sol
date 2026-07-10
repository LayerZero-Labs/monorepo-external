// SPDX-License-Identifier: MIT
pragma solidity ^0.8.22;

import { IERC20Metadata, IERC20 } from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { OFTCoreBaseUpgradeable } from "./../oft/OFTCoreBaseUpgradeable.sol";
import { OFTCoreExtendedRBACUpgradeable } from "./OFTCoreExtendedRBACUpgradeable.sol";

/**
 * @title OFTLockUnlockExtendedRBACUpgradeable
 * @author LayerZero Labs (@TRileySchwarz, tinom.eth)
 * @custom:version 1.0.0
 * @notice Upgradeable OFT lock-unlock adapter with toggleable pause, fee, and rate limit functionality.
 * @dev Roles are handled through `AccessControl2StepUpgradeable`.
 */
contract OFTLockUnlockExtendedRBACUpgradeable is OFTCoreExtendedRBACUpgradeable {
    using SafeERC20 for IERC20;

    /**
     * @dev Sets immutable variables.
     * @param _token Address of the underlying ERC20 token, it must implement the `IERC20Metadata` interface
     * @param _endpoint LayerZero endpoint address
     * @param _rateLimiterScaleDecimals Number of decimals to scale rate limit amounts (usually 0)
     */
    constructor(
        address _token,
        address _endpoint,
        uint8 _rateLimiterScaleDecimals
    )
        OFTCoreExtendedRBACUpgradeable(
            IERC20Metadata(_token).decimals(),
            true,
            _token,
            _endpoint,
            _rateLimiterScaleDecimals
        )
    {
        _disableInitializers();
    }

    /**
     * @notice Initializes the contract.
     * @param _initialAdmin Address to be granted `DEFAULT_ADMIN_ROLE` and endpoint delegate
     * @param _feeDeposit Address that will receive any accrued fees
     */
    function initialize(address _initialAdmin, address _feeDeposit) public initializer {
        __OFTCoreExtendedRBAC_init(_initialAdmin, _feeDeposit);
    }

    /**
     * @dev Override to apply rate limit, fee collection, and pausability.
     * @inheritdoc OFTCoreBaseUpgradeable
     */
    function _debit(
        address _from,
        uint256 _amountLD,
        uint256 _minAmountLD,
        uint32 _dstEid
    ) internal virtual override whenNotPaused(_dstEid) returns (uint256 amountSentLD, uint256 amountReceivedLD) {
        (amountSentLD, amountReceivedLD) = _debitView(_amountLD, _minAmountLD, _dstEid);

        /// @dev Apply rate limit.
        _outflow(_dstEid, _from, amountReceivedLD);

        /// @dev Lock tokens by moving them into this contract from the caller. Assumes lossless transfer.
        INNER_TOKEN.safeTransferFrom(_from, address(this), amountSentLD);

        /// @dev Fee is already received at this point, transfer to fee deposit.
        if (amountSentLD > amountReceivedLD) {
            unchecked {
                INNER_TOKEN.safeTransfer(feeDeposit(), amountSentLD - amountReceivedLD);
            }
        }
    }

    /**
     * @dev Override to apply rate limit.
     * @inheritdoc OFTCoreBaseUpgradeable
     */
    function _credit(
        address _to,
        uint256 _amountLD,
        uint32 _srcEid
    ) internal virtual override returns (uint256 amountReceivedLD) {
        /// @dev Most ERC20 implementations do not support transferring to `address(0x0)`.
        if (_to == address(0)) _to = address(0xdead);

        _inflow(_srcEid, _to, _amountLD);

        /// @dev Unlock the tokens and transfer to the recipient.
        INNER_TOKEN.safeTransfer(_to, _amountLD);
        /// @dev In the case of a non-default OFT adapter, `_amountLD` might not be equal to `amountReceivedLD`.
        return _amountLD;
    }
}
