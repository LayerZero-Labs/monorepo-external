// SPDX-License-Identifier: MIT
pragma solidity ^0.8.22;

import {
    IOFT,
    SendParam,
    OFTLimit,
    OFTReceipt,
    OFTFeeDetail
} from "@layerzerolabs/oft-evm-impl/contracts/interfaces/IOFT.sol";
import { IOFTExtended } from "@layerzerolabs/oft-evm-impl/contracts/interfaces/IOFTExtended.sol";
import { AccessControl2StepUpgradeable } from "@layerzerolabs/utils-evm-upgradeable-impl/contracts/access/AccessControl2StepUpgradeable.sol";
import { FeeHandlerRBACUpgradeable } from "@layerzerolabs/utils-evm-upgradeable-impl/contracts/fee-accounting/FeeHandlerRBACUpgradeable.sol";
import { FeeConfigRBACUpgradeable } from "@layerzerolabs/utils-evm-upgradeable-impl/contracts/fee-config/FeeConfigRBACUpgradeable.sol";
import { PauseByIDRBACUpgradeable } from "@layerzerolabs/utils-evm-upgradeable-impl/contracts/pause-by-id/PauseByIDRBACUpgradeable.sol";
import { RateLimiterRBACUpgradeable } from "@layerzerolabs/utils-evm-upgradeable-impl/contracts/rate-limiter/RateLimiterRBACUpgradeable.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import { OFTCoreBaseUpgradeable } from "./../oft/OFTCoreBaseUpgradeable.sol";
import { OFTCoreRBACUpgradeable } from "./../oft/OFTCoreRBACUpgradeable.sol";

/**
 * @title OFTCoreExtendedRBACUpgradeable
 * @author LayerZero Labs (@TRileySchwarz, tinom.eth)
 * @custom:version 1.0.0
 * @notice Abstract upgradeable contract that implements the core functionality of an extended OFT token.
 * @dev Includes Fee, RateLimiter, and Pause extensions with RBAC access control.
 * @dev Roles are handled through `AccessControl2StepUpgradeable`.
 */
abstract contract OFTCoreExtendedRBACUpgradeable is
    IOFTExtended,
    OFTCoreRBACUpgradeable,
    FeeConfigRBACUpgradeable,
    FeeHandlerRBACUpgradeable,
    RateLimiterRBACUpgradeable,
    PauseByIDRBACUpgradeable
{
    /// @dev Immutable address of the underlying ERC20 token.
    IERC20 internal immutable INNER_TOKEN;

    /// @dev Immutable flag indicating whether the OFT contract requires ERC20 approval to send.
    bool internal immutable APPROVAL_REQUIRED;

    /**
     * @dev Sets immutable variables.
     * @param _localDecimals Decimals of the token on the local chain (this chain)
     * @param _approvalRequired Whether the OFT contract requires approval of the underlying token to send
     * @param _innerToken Address of the underlying ERC20 token
     * @param _endpoint LayerZero endpoint address
     * @param _rateLimiterScaleDecimals Number of decimals to scale rate limit amounts (usually 0)
     */
    constructor(
        uint8 _localDecimals,
        bool _approvalRequired,
        address _innerToken,
        address _endpoint,
        uint8 _rateLimiterScaleDecimals
    ) OFTCoreRBACUpgradeable(_localDecimals, _endpoint) RateLimiterRBACUpgradeable(_rateLimiterScaleDecimals) {
        INNER_TOKEN = IERC20(_innerToken);
        APPROVAL_REQUIRED = _approvalRequired;
    }

    /**
     * @notice Initializes the contract with the provided initial admin.
     * @param _initialAdmin Address to be granted `DEFAULT_ADMIN_ROLE` and endpoint delegate
     * @param _feeDeposit Address that will receive any accrued fees
     */
    function __OFTCoreExtendedRBAC_init(address _initialAdmin, address _feeDeposit) internal onlyInitializing {
        __OAppCoreBase_init_unchained(_initialAdmin);
        __AccessControl2Step_init_unchained(_initialAdmin);
        __FeeHandlerBase_init_unchained(_feeDeposit);
        __RateLimiterBase_init_unchained(false);
    }

    /**
     * @notice Unchained initialization function for the contract.
     * @dev This function is empty on purpose, as no custom logic is needed.
     */
    function __OFTCoreExtendedRBAC_init_unchained() internal onlyInitializing {}

    /**
     * @inheritdoc IOFT
     */
    function oftVersion()
        public
        pure
        virtual
        override(IOFT, OFTCoreBaseUpgradeable)
        returns (bytes4 interfaceId, uint64 version)
    {
        return (type(IOFTExtended).interfaceId, 1);
    }

    /**
     * @inheritdoc IOFT
     */
    function approvalRequired() public view virtual override returns (bool requiresApproval) {
        return APPROVAL_REQUIRED;
    }

    /**
     * @dev Contrary to other OFT implementations, `token() != address(this)`.
     * @inheritdoc IOFT
     */
    function token() public view virtual override returns (address tokenAddress) {
        return address(INNER_TOKEN);
    }

    /**
     * @dev Override to apply rate limit and pausability maximum amount rules and add fee details.
     * @inheritdoc OFTCoreBaseUpgradeable
     */
    function quoteOFT(
        SendParam calldata _sendParam
    )
        public
        view
        virtual
        override(IOFT, OFTCoreBaseUpgradeable)
        returns (OFTLimit memory oftLimit, OFTFeeDetail[] memory oftFeeDetails, OFTReceipt memory oftReceipt)
    {
        /// @dev Override `maxAmountLD` with rate limit and pausability rules.
        uint256 maxAmountLD;

        if (isPaused(_sendParam.dstEid)) {
            maxAmountLD = 0;
        } else {
            (, maxAmountLD, , ) = getRateLimitUsages(_sendParam.dstEid);
        }

        if (maxAmountLD != 0 && maxAmountLD != type(uint256).max) {
            maxAmountLD = getAmountBeforeFee(_sendParam.dstEid, maxAmountLD);
        }

        oftLimit = OFTLimit(0, maxAmountLD);

        (uint256 amountSentLD, uint256 amountReceivedLD) = _debitView(
            _sendParam.amountLD,
            _sendParam.minAmountLD,
            _sendParam.dstEid
        );
        oftReceipt = OFTReceipt(amountSentLD, amountReceivedLD);

        if (amountSentLD > amountReceivedLD) {
            oftFeeDetails = new OFTFeeDetail[](1);
            unchecked {
                oftFeeDetails[0] = OFTFeeDetail(int256(amountSentLD - amountReceivedLD), "Fee");
            }
        } else {
            oftFeeDetails = new OFTFeeDetail[](0);
        }
    }

    /**
     * @dev Override to apply fee to `amountReceivedLD`.
     * @inheritdoc OFTCoreBaseUpgradeable
     */
    function _debitView(
        uint256 _amountLD,
        uint256 _minAmountLD,
        uint32 _dstEid
    ) internal view virtual override returns (uint256 amountSentLD, uint256 amountReceivedLD) {
        /// @dev Apply the fee, then de-dust the amount afterwards.
        ///      This means the fee is taken from the amount before the dust is removed.
        uint256 fee = getFee(_dstEid, _amountLD);
        amountReceivedLD = _removeDust(_amountLD - fee);

        /// @dev `amountSentLD` is never de-dusted, UI needs to ensure the amount sent doesn't have dust, otherwise it
        ///      will be taken as a fee, even if no fees are enabled.
        amountSentLD = _amountLD;

        /// @dev Check for slippage.
        if (amountReceivedLD < _minAmountLD) {
            revert SlippageExceeded(amountReceivedLD, _minAmountLD);
        }
    }

    /**
     * @inheritdoc OFTCoreRBACUpgradeable
     */
    function acceptDefaultAdminTransfer()
        public
        virtual
        override(OFTCoreRBACUpgradeable, AccessControl2StepUpgradeable)
    {
        super.acceptDefaultAdminTransfer();
    }
}
