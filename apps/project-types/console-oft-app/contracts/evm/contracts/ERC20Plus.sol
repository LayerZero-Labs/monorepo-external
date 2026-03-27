// SPDX-License-Identifier: MIT
pragma solidity ^0.8.22;

import { IFundRecovery } from "@layerzerolabs/utils-evm-impl/contracts/interfaces/IFundRecovery.sol";
import { AllowlistRBACUpgradeable } from "@layerzerolabs/utils-evm-upgradeable-impl/contracts/allowlist/AllowlistRBACUpgradeable.sol";
import { PauseRBACUpgradeable } from "@layerzerolabs/utils-evm-upgradeable-impl/contracts/pause/PauseRBACUpgradeable.sol";
import { ERC20Upgradeable } from "@openzeppelin/contracts-upgradeable/token/ERC20/ERC20Upgradeable.sol";
import { ERC20PermitUpgradeable } from "@openzeppelin/contracts-upgradeable/token/ERC20/extensions/ERC20PermitUpgradeable.sol";
import { IERC20Metadata } from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import { IERC20Permit } from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Permit.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { IERC20Plus } from "./interfaces/IERC20Plus.sol";

/**
 * @title ERC20Plus
 * @author LayerZero Labs (@TRileySchwarz, tinom.eth)
 * @custom:version 1.0.0
 * @notice Upgradeable ERC20 token with burn-mint interface, permit, pause, toggleable allowlist, and fund recovery.
 * @dev Roles are handled through `AccessControl2StepUpgradeable`.
 */
contract ERC20Plus is IERC20Plus, ERC20PermitUpgradeable, AllowlistRBACUpgradeable, PauseRBACUpgradeable {
    /// @dev Immutable decimals of the token.
    uint8 internal immutable DECIMALS;

    /// @notice Role for minting tokens.
    bytes32 public constant MINTER_ROLE = keccak256("MINTER_ROLE");

    /// @notice Role for burning tokens.
    bytes32 public constant BURNER_ROLE = keccak256("BURNER_ROLE");

    /**
     * @dev Sets immutable variables.
     * @param _decimals Decimals of the token
     */
    constructor(uint8 _decimals) {
        _disableInitializers();

        DECIMALS = _decimals;
    }

    /**
     * @notice Initializes the contract with a name, symbol, and default admin.
     * @param _name Name of the token
     * @param _symbol Symbol of the token
     * @param _initialAdmin Address to be granted `DEFAULT_ADMIN_ROLE`
     */
    function initialize(string calldata _name, string calldata _symbol, address _initialAdmin) public initializer {
        __ERC20_init(_name, _symbol);
        __ERC20Permit_init(_name);
        __AccessControl2Step_init(_initialAdmin);
        __AllowlistBase_init(AllowlistMode.Open);
    }

    /**
     * @notice Mints tokens to address.
     * @dev It does not revert if the recipient is not allowlisted, as funds cannot be debited in that state.
     * @param _to Address to mint tokens to
     * @param _amount Amount of tokens to mint
     * @return success Always returns true
     */
    function mint(address _to, uint256 _amount) public virtual onlyRole(MINTER_ROLE) returns (bool success) {
        _mint(_to, _amount);
        return true;
    }

    /**
     * @notice Burns tokens from address without approval.
     * @param _from Address to burn tokens from
     * @param _amount Amount of tokens to burn
     * @return success Always returns true
     */
    function burn(
        address _from,
        uint256 _amount
    ) public virtual onlyRole(BURNER_ROLE) whenNotPaused onlyAllowlisted(_from) returns (bool success) {
        _burn(_from, _amount);
        return true;
    }

    // ============ ERC20 Overrides ============

    /**
     * @dev Override to set immutable decimals.
     * @inheritdoc IERC20Metadata
     */
    function decimals() public view virtual override(ERC20Upgradeable, IERC20Metadata) returns (uint8 tokenDecimals) {
        return DECIMALS;
    }

    /**
     * @dev Override to add allowlist checks.
     * @inheritdoc ERC20Upgradeable
     */
    function transfer(
        address _to,
        uint256 _amount
    )
        public
        virtual
        override(ERC20Upgradeable, IERC20)
        whenNotPaused
        onlyAllowlisted(msg.sender)
        onlyAllowlisted(_to)
        returns (bool success)
    {
        return super.transfer(_to, _amount);
    }

    /**
     * @dev Override to add allowlist checks.
     * @inheritdoc ERC20Upgradeable
     */
    function transferFrom(
        address _from,
        address _to,
        uint256 _amount
    )
        public
        virtual
        override(ERC20Upgradeable, IERC20)
        whenNotPaused
        onlyAllowlisted(msg.sender)
        onlyAllowlisted(_from)
        onlyAllowlisted(_to)
        returns (bool success)
    {
        return super.transferFrom(_from, _to, _amount);
    }

    /**
     * @inheritdoc IERC20Permit
     */
    function nonces(
        address _owner
    ) public view virtual override(ERC20PermitUpgradeable, IERC20Permit) returns (uint256 nonce) {
        return super.nonces(_owner);
    }

    // ============ Fund Recovery ============

    /**
     * @inheritdoc IFundRecovery
     */
    function recoverFunds(address _from, address _to, uint256 _amount) public virtual onlyRole(DEFAULT_ADMIN_ROLE) {
        if (isAllowlisted(_from)) revert CannotRecoverFromAllowlisted(_from);
        super._transfer(_from, _to, _amount);
    }
}
