// SPDX-License-Identifier: MIT
pragma solidity ^0.8.22;

import { IFeeHandler } from "@layerzerolabs/utils-evm-impl/contracts/interfaces/IFeeHandler.sol";
import { Initializable } from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";

/**
 * @title FeeHandlerBaseUpgradeable
 * @author LayerZero Labs (tinom.eth)
 * @custom:version 1.0.0
 * @notice Abstract upgradeable contract that stores the fee deposit address, for push-based fee handling.
 * @dev Fee transfer logic is handled by the inheriting contract. This contract only manages the `feeDeposit` state.
 * @dev No public management functions are exposed by this contract, wrappers should be used with access control.
 *      Alternatively, refer to `FeeHandlerRBACUpgradeable` for a permissioned implementation.
 * @dev Does not include fee configuration (BPS / calculation). See `FeeConfigBaseUpgradeable` for that.
 */
abstract contract FeeHandlerBaseUpgradeable is IFeeHandler, Initializable {
    /// @custom:storage-location erc7201:layerzerov2.storage.feehandler
    struct FeeHandlerStorage {
        address feeDeposit;
    }

    // keccak256(abi.encode(uint256(keccak256("layerzerov2.storage.feehandler")) - 1)) & ~bytes32(uint256(0xff))
    bytes32 private constant FEE_HANDLER_STORAGE_LOCATION =
        0xe32e0c5f1df3081ca85b86156deac82a46e8fb7b21b412e09f7ccdc5fca29900;

    /**
     * @notice Internal function to get the fee handler storage.
     * @return $ Storage pointer
     */
    function _getFeeHandlerStorage() internal pure returns (FeeHandlerStorage storage $) {
        assembly {
            $.slot := FEE_HANDLER_STORAGE_LOCATION
        }
    }

    /**
     * @notice Initializes the contract with a fee deposit.
     * @param _feeDeposit Address that will receive any accrued fees
     */
    function __FeeHandlerBase_init(address _feeDeposit) internal onlyInitializing {
        __FeeHandlerBase_init_unchained(_feeDeposit);
    }

    /**
     * @notice Unchained initialization function for the contract.
     * @param _feeDeposit Address that will receive any accrued fees
     */
    function __FeeHandlerBase_init_unchained(address _feeDeposit) internal onlyInitializing {
        _setFeeDeposit(_feeDeposit);
    }

    /**
     * @inheritdoc IFeeHandler
     */
    function feeDeposit() public view virtual returns (address deposit) {
        return _getFeeHandlerStorage().feeDeposit;
    }

    /**
     * @notice Sets the fee deposit address.
     * @param _feeDeposit New fee deposit address
     */
    function _setFeeDeposit(address _feeDeposit) internal virtual {
        if (_feeDeposit == address(0)) revert InvalidFeeDeposit();
        _getFeeHandlerStorage().feeDeposit = _feeDeposit;
        emit FeeDepositSet(_feeDeposit);
    }
}
