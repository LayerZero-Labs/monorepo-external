// SPDX-License-Identifier: MIT
pragma solidity ^0.8.22;

import { IFundRecovery } from "@layerzerolabs/utils-evm-impl/contracts/interfaces/IFundRecovery.sol";
import { AccessControl2StepUpgradeable } from "@layerzerolabs/utils-evm-upgradeable-impl/contracts/access/AccessControl2StepUpgradeable.sol";
import { ERC20Upgradeable } from "@openzeppelin/contracts-upgradeable/token/ERC20/ERC20Upgradeable.sol";
import { ERC20PermitUpgradeable } from "@openzeppelin/contracts-upgradeable/token/ERC20/extensions/ERC20PermitUpgradeable.sol";
import { IERC20Metadata } from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import { IERC20Permit } from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Permit.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { INexusERC20 } from "./interfaces/INexusERC20.sol";
import { INexusERC20Guard } from "./interfaces/INexusERC20Guard.sol";

/**
 * @title NexusERC20
 * @author LayerZero Labs (tinom.eth)
 * @custom:version 1.0.0
 * @notice Upgradeable ERC20 token with burn-mint interface, permit, and fund recovery.
 * @dev Allowlist and pause checks are delegated to a shared `NexusERC20Guard` contract.
 */
contract NexusERC20 is INexusERC20, ERC20PermitUpgradeable, AccessControl2StepUpgradeable {
    /// @dev Immutable decimals of the token.
    uint8 internal immutable DECIMALS;

    /// @custom:storage-location erc7201:layerzerov2.storage.nexuserc20
    struct NexusERC20Storage {
        INexusERC20Guard guard;
    }

    // keccak256(abi.encode(uint256(keccak256("layerzerov2.storage.nexuserc20")) - 1)) & ~bytes32(uint256(0xff))
    bytes32 private constant NEXUS_ERC20_STORAGE_LOCATION =
        0x74fa4edb434516930211f9db1b9cccb141bed2597670b3f631577904153f6200;

    /**
     * @notice Internal function to get the contract storage.
     * @return $ Storage pointer
     */
    function _getNexusERC20Storage() internal pure returns (NexusERC20Storage storage $) {
        assembly {
            $.slot := NEXUS_ERC20_STORAGE_LOCATION
        }
    }

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
     * @notice Initializes the contract with a name, symbol, default admin, and guard.
     * @param _name Name of the token
     * @param _symbol Symbol of the token
     * @param _initialAdmin Address to be granted `DEFAULT_ADMIN_ROLE`
     * @param _guard Address of the `NexusERC20Guard` contract
     */
    function initialize(
        string calldata _name,
        string calldata _symbol,
        address _initialAdmin,
        address _guard
    ) public initializer {
        __ERC20_init(_name, _symbol);
        __ERC20Permit_init(_name);
        __AccessControl2Step_init(_initialAdmin);

        _setGuard(_guard);
    }

    /**
     * @inheritdoc INexusERC20
     */
    function getGuard() external view returns (INexusERC20Guard guard) {
        return _getNexusERC20Storage().guard;
    }

    /**
     * @inheritdoc INexusERC20
     */
    function setGuard(address _guard) public virtual onlyRole(DEFAULT_ADMIN_ROLE) {
        _setGuard(_guard);
    }

    /**
     * @notice Internal function to set the guard contract.
     * @param _guard New guard address
     */
    function _setGuard(address _guard) internal {
        if (_guard == address(0)) revert InvalidGuardAddress();
        _getNexusERC20Storage().guard = INexusERC20Guard(_guard);
        emit GuardSet(address(_guard));
    }

    // ============ Token Operations ============

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
    function burn(address _from, uint256 _amount) public virtual onlyRole(BURNER_ROLE) returns (bool success) {
        _getNexusERC20Storage().guard.checkTransfer(address(this), address(0), _from, address(0), _amount);
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
     * @dev Override to add guard checks.
     * @inheritdoc IERC20
     */
    function transfer(
        address _to,
        uint256 _amount
    ) public virtual override(ERC20Upgradeable, IERC20) returns (bool success) {
        _getNexusERC20Storage().guard.checkTransfer(address(this), msg.sender, address(0), _to, _amount);
        return super.transfer(_to, _amount);
    }

    /**
     * @dev Override to add guard checks.
     * @inheritdoc IERC20
     */
    function transferFrom(
        address _from,
        address _to,
        uint256 _amount
    ) public virtual override(ERC20Upgradeable, IERC20) returns (bool success) {
        _getNexusERC20Storage().guard.checkTransfer(address(this), msg.sender, _from, _to, _amount);
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
        if (_getNexusERC20Storage().guard.isAllowlisted(_from)) revert CannotRecoverFromAllowlisted(_from);
        super._transfer(_from, _to, _amount);
    }
}
