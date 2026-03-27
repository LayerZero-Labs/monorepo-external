// SPDX-License-Identifier: MIT
pragma solidity ^0.8.22;

import { IERC20Metadata } from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import { Address } from "@openzeppelin/contracts/utils/Address.sol";
import { OFTCoreBaseUpgradeable } from "./../oft/OFTCoreBaseUpgradeable.sol";
import { OFTCoreExtendedRBACUpgradeable } from "./OFTCoreExtendedRBACUpgradeable.sol";

/**
 * @title OFTBurnMintExtendedRBACUpgradeable
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
contract OFTBurnMintExtendedRBACUpgradeable is OFTCoreExtendedRBACUpgradeable {
    using Address for address;

    /// @dev Contract with burn and mint capabilities for the underlying token.
    address internal immutable BURNER_MINTER;

    /// @dev Function selector for the burn function (e.g., `burn(address,uint256)`).
    bytes4 internal immutable BURN_SELECTOR;

    /// @dev Function selector for the mint function (e.g., `mint(address,uint256)`).
    bytes4 internal immutable MINT_SELECTOR;

    /**
     * @dev Sets immutable variables.
     * @param _token Address of the underlying ERC20 token, must implement `IERC20Metadata`
     * @param _burnerMinter Contract with burn and mint capabilities for `_token`
     * @param _endpoint LayerZero endpoint address
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
        OFTCoreExtendedRBACUpgradeable(
            IERC20Metadata(_token).decimals(),
            _approvalRequired,
            _token,
            _endpoint,
            _rateLimiterScaleDecimals
        )
    {
        BURNER_MINTER = _burnerMinter;
        BURN_SELECTOR = _burnSelector;
        MINT_SELECTOR = _mintSelector;

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
     * @notice Retrieves the address of the contract responsible for burning and minting tokens.
     * @dev `burnerMinter` may or may not match `token`.
     * @return burnerMinterAddress Address of the contract responsible for burning and minting tokens
     */
    function burnerMinter() public view virtual returns (address burnerMinterAddress) {
        return BURNER_MINTER;
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

        /// @dev Burn tokens from the user and collect fee if existing.
        _burnAndCollectFee(_from, amountSentLD, amountReceivedLD);
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
        /// @dev Most ERC20 implementations do not support minting to `address(0x0)`.
        if (_to == address(0)) _to = address(0xdead);

        /// @dev Apply rate limit.
        _inflow(_srcEid, _to, _amountLD);

        /// @dev Mint the tokens to the recipient.
        _mint(_to, _amountLD);

        /// @dev In the case of a non-default OFT adapter, `_amountLD` might not be equal to `amountReceivedLD`.
        return _amountLD;
    }

    /**
     * @notice Burns tokens from the specified address and transfers fees to the fee deposit.
     * @param _from Address to burn tokens from
     * @param _amountSentLD Amount of tokens sent in local decimals, amount burned from user
     * @param _amountReceivedLD Amount of tokens to be received in destination chain in local decimals
     */
    function _burnAndCollectFee(address _from, uint256 _amountSentLD, uint256 _amountReceivedLD) internal virtual {
        _callBurnerMinter(abi.encodeWithSelector(BURN_SELECTOR, _from, _amountSentLD));

        /// @dev Collect fee by minting directly to the fee deposit.
        if (_amountSentLD > _amountReceivedLD) {
            unchecked {
                _mint(feeDeposit(), _amountSentLD - _amountReceivedLD);
            }
        }
    }

    /**
     * @notice Mints tokens to the specified address using the configured mint interface.
     * @param _to Address to mint tokens to
     * @param _amount Amount of tokens to mint
     */
    function _mint(address _to, uint256 _amount) internal virtual {
        _callBurnerMinter(abi.encodeWithSelector(MINT_SELECTOR, _to, _amount));
    }

    /**
     * @notice Executes a low-level call to `BURNER_MINTER` with the given data.
     *         Propagates revert reasons. Does not handle non-standard return values.
     * @dev Burner minter is expected to revert if the call fails.
     * @param _data Calldata to send
     */
    function _callBurnerMinter(bytes memory _data) internal virtual {
        BURNER_MINTER.functionCall(_data);
    }
}
