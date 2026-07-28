// SPDX-License-Identifier: MIT
pragma solidity ^0.8.22;

import { ICreditRedirect } from "@layerzerolabs/utils-evm-contracts/contracts/interfaces/ICreditRedirect.sol";
import { ICreditRedirectAllowlist } from "@layerzerolabs/utils-evm-contracts/contracts/interfaces/ICreditRedirectAllowlist.sol";
import { Initializable } from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";

/**
 * @title CreditRedirectBaseUpgradeable
 * @author LayerZero Labs (tinom.eth)
 * @custom:version 1.0.0
 * @notice Abstract upgradeable contract that implements configuration to redirect credits from non-allowlisted
 *         addresses to an escrow address.
 * @dev No public management functions are exposed by this contract, wrappers should be used with access control.
 *      Alternatively, refer to `CreditRedirectRBACUpgradeable` for a permissioned implementation.
 */
abstract contract CreditRedirectBaseUpgradeable is ICreditRedirect, Initializable {
    /// @custom:storage-location erc7201:layerzerov2.storage.creditredirect
    struct CreditRedirectStorage {
        address allowlist;
        address escrow;
    }

    // keccak256(abi.encode(uint256(keccak256("layerzerov2.storage.creditredirect")) - 1)) & ~bytes32(uint256(0xff))
    bytes32 private constant CREDIT_REDIRECT_STORAGE_LOCATION =
        0xb868bd7fc06fef88c81262b11fe9b85cff6f00e2736baf361fa258c33ba8cd00;

    /**
     * @notice Internal function to get the credit redirect storage.
     * @return $ Storage pointer
     */
    function _getCreditRedirectStorage() internal pure returns (CreditRedirectStorage storage $) {
        assembly {
            $.slot := CREDIT_REDIRECT_STORAGE_LOCATION
        }
    }

    /**
     * @notice Initializes the contract.
     * @dev This function is empty on purpose, as no custom logic is needed.
     */
    function __CreditRedirectBase_init() internal onlyInitializing {}

    /**
     * @notice Unchained initialization function for the contract.
     * @dev This function is empty on purpose, as no custom logic is needed.
     */
    function __CreditRedirectBase_init_unchained() internal onlyInitializing {}

    /**
     * @inheritdoc ICreditRedirect
     */
    function creditRedirectConfig() public view virtual returns (CreditRedirectConfig memory config) {
        CreditRedirectStorage storage $ = _getCreditRedirectStorage();
        return CreditRedirectConfig({ allowlist: $.allowlist, escrow: $.escrow });
    }

    /**
     * @notice Checks whether a user is allowlisted, for credit redirection purposes.
     * @param _user Address to check
     * @return isUserAllowlisted Whether the user is allowlisted
     */
    function _isAllowlisted(address _user) internal view virtual returns (bool isUserAllowlisted) {
        address allowlist = _getCreditRedirectStorage().allowlist;
        if (allowlist == address(0)) return true;
        return ICreditRedirectAllowlist(allowlist).isAllowlisted(_user);
    }

    /**
     * @notice Redirects a credit to the escrow when the recipient is not allowlisted.
     * @dev Returns `_to` unchanged when credit redirect is disabled or the recipient is allowlisted.
     * @param _to Intended credit recipient
     * @param _amountLD Amount to credit in local decimals
     * @return recipient Effective credit recipient
     */
    function _redirectCredit(address _to, uint256 _amountLD) internal virtual returns (address recipient) {
        if (!_isAllowlisted(_to)) {
            /// @dev `escrow` is guaranteed to be non-zero here.
            address escrow = _getCreditRedirectStorage().escrow;
            emit CreditRedirected(_to, escrow, _amountLD);
            return escrow;
        }
        return _to;
    }

    // ============ Internal Functions to Wrap with Access Control ============

    /**
     * @notice Internal function to set the credit redirect configuration.
     * @dev `allowlist` and `escrow` must both be set or both be `address(0)` (disabled).
     * @dev To be wrapped with access control.
     * @param _config New credit redirect configuration
     */
    function _setCreditRedirectConfig(CreditRedirectConfig memory _config) internal virtual {
        if ((_config.allowlist == address(0)) != (_config.escrow == address(0))) {
            revert InvalidCreditRedirectConfig();
        }
        CreditRedirectStorage storage $ = _getCreditRedirectStorage();
        $.allowlist = _config.allowlist;
        $.escrow = _config.escrow;
        emit CreditRedirectConfigSet(_config);
    }
}
