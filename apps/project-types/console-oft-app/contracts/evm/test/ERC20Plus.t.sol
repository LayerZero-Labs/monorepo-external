// SPDX-License-Identifier: MIT
pragma solidity ^0.8.22;

import { IAccessControl2Step } from "@layerzerolabs/utils-evm-impl/contracts/interfaces/IAccessControl2Step.sol";
import { IAllowlist } from "@layerzerolabs/utils-evm-impl/contracts/interfaces/IAllowlist.sol";
import { IPause } from "@layerzerolabs/utils-evm-impl/contracts/interfaces/IPause.sol";
import { Initializable } from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import { ERC20Upgradeable } from "@openzeppelin/contracts-upgradeable/token/ERC20/ERC20Upgradeable.sol";
import { IAccessControl } from "@openzeppelin/contracts/access/IAccessControl.sol";
import { IERC20Errors } from "@openzeppelin/contracts/interfaces/draft-IERC6093.sol";
import { ERC1967Utils } from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Utils.sol";
import { ProxyAdmin } from "@openzeppelin/contracts/proxy/transparent/ProxyAdmin.sol";
import {
    TransparentUpgradeableProxy,
    ITransparentUpgradeableProxy
} from "@openzeppelin/contracts/proxy/transparent/TransparentUpgradeableProxy.sol";
import { IERC20Metadata } from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { Test } from "forge-std/Test.sol";
import { ERC20Plus } from "../contracts/ERC20Plus.sol";
import { IERC20Plus } from "../contracts/interfaces/IERC20Plus.sol";

contract ERC20PlusV2 is ERC20Plus {
    constructor(uint8 _decimals) ERC20Plus(_decimals) {}

    function reinitialize(address /* _additionalAdmin */) public reinitializer(2) {}

    function name() public pure override(ERC20Upgradeable, IERC20Metadata) returns (string memory) {
        return "Upgraded";
    }

    function symbol() public pure override(ERC20Upgradeable, IERC20Metadata) returns (string memory) {
        return "UPG";
    }
}

contract ERC20PlusTest is Test {
    ERC20Plus impl;
    ERC20Plus proxy;
    ProxyAdmin proxyAdmin;

    address alice = makeAddr("alice");
    address bob = makeAddr("bob");
    address charlie = makeAddr("charlie");
    address dave = makeAddr("dave");
    address erin = makeAddr("erin");

    function _getProxyAdminAddress(address _proxy) internal view returns (address) {
        bytes32 adminSlot = vm.load(_proxy, ERC1967Utils.ADMIN_SLOT);
        return address(uint160(uint256(adminSlot)));
    }

    function _deployTUP(string memory _name, string memory _symbol, address _initialAdmin) internal {
        TransparentUpgradeableProxy _proxy = new TransparentUpgradeableProxy(
            address(impl),
            dave, // Proxy Admin Owner
            abi.encodeWithSelector(ERC20Plus.initialize.selector, _name, _symbol, _initialAdmin)
        );
        proxy = ERC20Plus(address(_proxy));
    }

    function setUp() public {
        // Label accounts.
        vm.label(address(this), "this");
        vm.label(alice, "alice");
        vm.label(bob, "bob");
        vm.label(charlie, "charlie");
        vm.label(dave, "dave");
        vm.label(erin, "erin");

        // Deploy.
        impl = new ERC20Plus(6); // 6 decimals
        _deployTUP("TRX Token", "TRX", address(this));
        proxyAdmin = ProxyAdmin(_getProxyAdminAddress(address(proxy)));

        // Grant all roles to this contract for testing.
        proxy.grantRole(proxy.MINTER_ROLE(), address(this));
        proxy.grantRole(proxy.BURNER_ROLE(), address(this));
        proxy.grantRole(proxy.BLACKLISTER_ROLE(), address(this));
        proxy.grantRole(proxy.WHITELISTER_ROLE(), address(this));
        proxy.grantRole(proxy.PAUSER_ROLE(), address(this));
        proxy.grantRole(proxy.UNPAUSER_ROLE(), address(this));
    }

    // ============ Setup ============

    function test_constructor() public {
        ERC20Plus newImpl = new ERC20Plus(6);
        // Constructor should disable initializers.
        vm.expectRevert(Initializable.InvalidInitialization.selector);
        newImpl.initialize("Name", "Symbol", address(this));
    }

    function test_initialize_Success() public view {
        assertEq(proxy.name(), "TRX Token");
        assertEq(proxy.symbol(), "TRX");
        assertEq(proxy.decimals(), 6);
        assertEq(proxy.totalSupply(), 0);
        assertTrue(proxy.hasRole(proxy.DEFAULT_ADMIN_ROLE(), address(this)));
    }

    function test_initialize_Revert_AlreadyInitialized() public {
        vm.expectRevert(Initializable.InvalidInitialization.selector);
        proxy.initialize("Name", "Symbol", address(this));
    }

    function test_initialize_Revert_ZeroAddress() public {
        vm.expectRevert(abi.encodeWithSelector(IAccessControl2Step.InvalidDefaultAdmin.selector, address(0)));
        new TransparentUpgradeableProxy(
            address(impl),
            dave,
            abi.encodeWithSelector(ERC20Plus.initialize.selector, "Name", "Symbol", address(0))
        );
    }

    // ============ Allowlist ============

    function test_setAllowlistMode_Success() public {
        vm.expectEmit(true, true, true, true, address(proxy));
        emit IAllowlist.AllowlistModeUpdated(IAllowlist.AllowlistMode.Blacklist);

        proxy.setAllowlistMode(IAllowlist.AllowlistMode.Blacklist);

        assertTrue(proxy.allowlistMode() == IAllowlist.AllowlistMode.Blacklist);
    }

    function test_setAllowlistMode_Revert_Unauthorized() public {
        vm.expectRevert(
            abi.encodeWithSelector(
                IAccessControl.AccessControlUnauthorizedAccount.selector,
                alice,
                proxy.DEFAULT_ADMIN_ROLE()
            )
        );
        vm.prank(alice);
        proxy.setAllowlistMode(IAllowlist.AllowlistMode.Blacklist);
    }

    function test_setBlacklisted_Success() public {
        // Switch to blacklist mode to make it relevant.
        proxy.setAllowlistMode(IAllowlist.AllowlistMode.Blacklist);

        assertFalse(proxy.isBlacklisted(bob));

        IAllowlist.SetAllowlistParam[] memory params = new IAllowlist.SetAllowlistParam[](1);
        params[0] = IAllowlist.SetAllowlistParam(bob, true);

        vm.expectEmit(true, true, true, true, address(proxy));
        emit IAllowlist.BlacklistUpdated(bob, true);

        proxy.setBlacklisted(params);

        assertTrue(proxy.isBlacklisted(bob));
        assertTrue(proxy.isAllowlisted(charlie)); // `charlie` not blacklisted
        assertFalse(proxy.isAllowlisted(bob)); // `bob` is blacklisted
    }

    function test_setBlacklisted_Revert_Unauthorized() public {
        IAllowlist.SetAllowlistParam[] memory params = new IAllowlist.SetAllowlistParam[](1);
        params[0] = IAllowlist.SetAllowlistParam(bob, true);

        vm.expectRevert(
            abi.encodeWithSelector(
                IAccessControl.AccessControlUnauthorizedAccount.selector,
                alice,
                proxy.BLACKLISTER_ROLE()
            )
        );
        vm.prank(alice);
        proxy.setBlacklisted(params);
    }

    function test_setWhitelisted_Success() public {
        // Switch to whitelist mode.
        proxy.setAllowlistMode(IAllowlist.AllowlistMode.Whitelist);

        assertFalse(proxy.isWhitelisted(bob));
        assertFalse(proxy.isAllowlisted(bob));

        IAllowlist.SetAllowlistParam[] memory params = new IAllowlist.SetAllowlistParam[](1);
        params[0] = IAllowlist.SetAllowlistParam(bob, true);

        vm.expectEmit(true, true, true, true, address(proxy));
        emit IAllowlist.WhitelistUpdated(bob, true);

        proxy.setWhitelisted(params);

        assertTrue(proxy.isWhitelisted(bob));
        assertTrue(proxy.isAllowlisted(bob));
        assertFalse(proxy.isAllowlisted(charlie));
    }

    function test_setWhitelisted_Revert_Unauthorized() public {
        IAllowlist.SetAllowlistParam[] memory params = new IAllowlist.SetAllowlistParam[](1);
        params[0] = IAllowlist.SetAllowlistParam(bob, true);

        vm.expectRevert(
            abi.encodeWithSelector(
                IAccessControl.AccessControlUnauthorizedAccount.selector,
                alice,
                proxy.WHITELISTER_ROLE()
            )
        );
        vm.prank(alice);
        proxy.setWhitelisted(params);
    }

    // ============ Mint ============

    function test_mint_Success() public {
        vm.expectEmit(true, true, true, true, address(proxy));
        emit IERC20.Transfer(address(0), bob, 1000);

        bool success = proxy.mint(bob, 1000);

        assertTrue(success);
        assertEq(proxy.balanceOf(bob), 1000);
        assertEq(proxy.totalSupply(), 1000);
    }

    function test_mint_Success_ZeroAmount() public {
        vm.expectEmit(true, true, true, true, address(proxy));
        emit IERC20.Transfer(address(0), bob, 0);

        bool success = proxy.mint(bob, 0);

        assertTrue(success);
        assertEq(proxy.balanceOf(bob), 0);
        assertEq(proxy.totalSupply(), 0);
    }

    function test_mint_Success_Fuzz(uint256 _amount) public {
        vm.expectEmit(true, true, true, true, address(proxy));
        emit IERC20.Transfer(address(0), bob, _amount);

        bool success = proxy.mint(bob, _amount);

        assertTrue(success);
        assertEq(proxy.balanceOf(bob), _amount);
    }

    function test_mint_Revert_Unauthorized() public {
        vm.expectRevert(
            abi.encodeWithSelector(IAccessControl.AccessControlUnauthorizedAccount.selector, alice, proxy.MINTER_ROLE())
        );
        vm.prank(alice);
        proxy.mint(bob, 1000);
    }

    // ============ Burn ============

    function test_burn_Success() public {
        proxy.mint(bob, 1000);

        vm.expectEmit(true, true, true, true, address(proxy));
        emit IERC20.Transfer(bob, address(0), 500);

        bool success = proxy.burn(bob, 500);

        assertTrue(success);
        assertEq(proxy.balanceOf(bob), 500);
        assertEq(proxy.totalSupply(), 500);
    }

    function test_burn_Success_ZeroAmount() public {
        proxy.mint(bob, 1000);

        vm.expectEmit(true, true, true, true, address(proxy));
        emit IERC20.Transfer(bob, address(0), 0);

        bool success = proxy.burn(bob, 0);

        assertTrue(success);
        assertEq(proxy.balanceOf(bob), 1000);
        assertEq(proxy.totalSupply(), 1000);
    }

    function test_burn_Success_AllBalance() public {
        proxy.mint(bob, 1000);

        vm.expectEmit(true, true, true, true, address(proxy));
        emit IERC20.Transfer(bob, address(0), 1000);

        bool success = proxy.burn(bob, 1000);

        assertTrue(success);
        assertEq(proxy.balanceOf(bob), 0);
        assertEq(proxy.totalSupply(), 0);
    }

    function test_burn_Success_Fuzz(uint256 _mintAmount, uint256 _burnAmount) public {
        _burnAmount = bound(_burnAmount, 0, _mintAmount);

        proxy.mint(bob, _mintAmount);

        vm.expectEmit(true, true, true, true, address(proxy));
        emit IERC20.Transfer(bob, address(0), _burnAmount);

        bool success = proxy.burn(bob, _burnAmount);

        assertTrue(success);
        assertEq(proxy.balanceOf(bob), _mintAmount - _burnAmount);
    }

    function test_burn_Revert_Unauthorized() public {
        vm.expectRevert(
            abi.encodeWithSelector(IAccessControl.AccessControlUnauthorizedAccount.selector, alice, proxy.BURNER_ROLE())
        );
        vm.prank(alice);
        proxy.burn(bob, 1000);
    }

    function test_burn_Revert_InsufficientBalance() public {
        proxy.mint(bob, 500);

        vm.expectRevert(abi.encodeWithSelector(IERC20Errors.ERC20InsufficientBalance.selector, bob, 500, 1000));
        proxy.burn(bob, 1000);
    }

    function test_burn_Revert_BlacklistedFrom() public {
        proxy.mint(bob, 1000);

        // Switch to blacklist mode.
        proxy.setAllowlistMode(IAllowlist.AllowlistMode.Blacklist);

        // Blacklist `bob`.
        IAllowlist.SetAllowlistParam[] memory params = new IAllowlist.SetAllowlistParam[](1);
        params[0] = IAllowlist.SetAllowlistParam(bob, true);
        proxy.setBlacklisted(params);

        // Attempt burn.
        vm.expectRevert(
            abi.encodeWithSelector(IAllowlist.NotAllowlisted.selector, bob, IAllowlist.AllowlistMode.Blacklist)
        );
        proxy.burn(bob, 500);
    }

    function test_burn_Revert_NotWhitelistedFrom() public {
        proxy.mint(bob, 1000);

        // Switch to whitelist mode.
        proxy.setAllowlistMode(IAllowlist.AllowlistMode.Whitelist);

        // `bob` is not whitelisted by default.

        // Attempt burn.
        vm.expectRevert(
            abi.encodeWithSelector(IAllowlist.NotAllowlisted.selector, bob, IAllowlist.AllowlistMode.Whitelist)
        );
        proxy.burn(bob, 500);
    }

    function test_burn_Success_WhitelistedFrom() public {
        proxy.mint(bob, 1000);

        // Switch to whitelist mode.
        proxy.setAllowlistMode(IAllowlist.AllowlistMode.Whitelist);

        // Whitelist `bob`.
        IAllowlist.SetAllowlistParam[] memory params = new IAllowlist.SetAllowlistParam[](1);
        params[0] = IAllowlist.SetAllowlistParam(bob, true);
        proxy.setWhitelisted(params);

        // Burn should succeed.
        vm.expectEmit(true, true, true, true, address(proxy));
        emit IERC20.Transfer(bob, address(0), 500);

        bool success = proxy.burn(bob, 500);

        assertTrue(success);
        assertEq(proxy.balanceOf(bob), 500);
    }

    // ============ Transfer ============

    function test_transfer_Success() public {
        proxy.mint(bob, 1000);

        vm.expectEmit(true, true, true, true, address(proxy));
        emit IERC20.Transfer(bob, charlie, 500);

        vm.prank(bob);
        bool success = proxy.transfer(charlie, 500);

        assertTrue(success);
        assertEq(proxy.balanceOf(bob), 500);
        assertEq(proxy.balanceOf(charlie), 500);
    }

    function test_transfer_Success_ZeroAmount() public {
        proxy.mint(bob, 1000);

        vm.expectEmit(true, true, true, true, address(proxy));
        emit IERC20.Transfer(bob, charlie, 0);

        vm.prank(bob);
        bool success = proxy.transfer(charlie, 0);

        assertTrue(success);
        assertEq(proxy.balanceOf(bob), 1000);
        assertEq(proxy.balanceOf(charlie), 0);
    }

    function test_transfer_Revert_BlacklistedSender() public {
        proxy.mint(bob, 1000);

        proxy.setAllowlistMode(IAllowlist.AllowlistMode.Blacklist);

        IAllowlist.SetAllowlistParam[] memory params = new IAllowlist.SetAllowlistParam[](1);
        params[0] = IAllowlist.SetAllowlistParam(bob, true);
        proxy.setBlacklisted(params);

        vm.expectRevert(
            abi.encodeWithSelector(IAllowlist.NotAllowlisted.selector, bob, IAllowlist.AllowlistMode.Blacklist)
        );
        vm.prank(bob);
        proxy.transfer(charlie, 500);
    }

    function test_transfer_Revert_BlacklistedReceiver() public {
        proxy.mint(bob, 1000);

        proxy.setAllowlistMode(IAllowlist.AllowlistMode.Blacklist);

        IAllowlist.SetAllowlistParam[] memory params = new IAllowlist.SetAllowlistParam[](1);
        params[0] = IAllowlist.SetAllowlistParam(charlie, true);
        proxy.setBlacklisted(params);

        vm.expectRevert(
            abi.encodeWithSelector(IAllowlist.NotAllowlisted.selector, charlie, IAllowlist.AllowlistMode.Blacklist)
        );
        vm.prank(bob);
        proxy.transfer(charlie, 500);
    }

    function test_transfer_Revert_NotWhitelistedSender() public {
        proxy.mint(bob, 1000);

        proxy.setAllowlistMode(IAllowlist.AllowlistMode.Whitelist);

        // `bob` is not whitelisted by default.
        vm.expectRevert(
            abi.encodeWithSelector(IAllowlist.NotAllowlisted.selector, bob, IAllowlist.AllowlistMode.Whitelist)
        );
        vm.prank(bob);
        proxy.transfer(charlie, 500);
    }

    function test_transfer_Revert_NotWhitelistedReceiver() public {
        proxy.mint(bob, 1000);

        proxy.setAllowlistMode(IAllowlist.AllowlistMode.Whitelist);

        IAllowlist.SetAllowlistParam[] memory params = new IAllowlist.SetAllowlistParam[](1);
        params[0] = IAllowlist.SetAllowlistParam(bob, true);
        proxy.setWhitelisted(params);

        // `charlie` is not whitelisted.
        vm.expectRevert(
            abi.encodeWithSelector(IAllowlist.NotAllowlisted.selector, charlie, IAllowlist.AllowlistMode.Whitelist)
        );
        vm.prank(bob);
        proxy.transfer(charlie, 500);
    }

    function test_transfer_Revert_InsufficientBalance() public {
        proxy.mint(bob, 500);

        vm.expectRevert(abi.encodeWithSelector(IERC20Errors.ERC20InsufficientBalance.selector, bob, 500, 1000));
        vm.prank(bob);
        proxy.transfer(charlie, 1000);
    }

    function test_transfer_Revert_ToZeroAddress() public {
        proxy.mint(bob, 1000);

        vm.expectRevert(abi.encodeWithSelector(IERC20Errors.ERC20InvalidReceiver.selector, address(0)));
        vm.prank(bob);
        proxy.transfer(address(0), 500);
    }

    // ============ transferFrom ============

    function test_transferFrom_Success() public {
        proxy.mint(bob, 1000);

        vm.prank(bob);
        proxy.approve(alice, 500);

        vm.expectEmit(true, true, true, true, address(proxy));
        emit IERC20.Transfer(bob, charlie, 500);

        vm.prank(alice);
        bool success = proxy.transferFrom(bob, charlie, 500);

        assertTrue(success);
        assertEq(proxy.balanceOf(bob), 500);
        assertEq(proxy.balanceOf(charlie), 500);
        assertEq(proxy.allowance(bob, alice), 0);
    }

    function test_transferFrom_Revert_BlacklistedSpender() public {
        proxy.mint(bob, 1000);

        vm.prank(bob);
        proxy.approve(alice, 500);

        proxy.setAllowlistMode(IAllowlist.AllowlistMode.Blacklist);

        IAllowlist.SetAllowlistParam[] memory params = new IAllowlist.SetAllowlistParam[](1);
        params[0] = IAllowlist.SetAllowlistParam(alice, true); // Blacklist spender
        proxy.setBlacklisted(params);

        vm.expectRevert(
            abi.encodeWithSelector(IAllowlist.NotAllowlisted.selector, alice, IAllowlist.AllowlistMode.Blacklist)
        );
        vm.prank(alice);
        proxy.transferFrom(bob, charlie, 500);
    }

    function test_transferFrom_Revert_BlacklistedFrom() public {
        proxy.mint(bob, 1000);

        vm.prank(bob);
        proxy.approve(alice, 500);

        proxy.setAllowlistMode(IAllowlist.AllowlistMode.Blacklist);

        IAllowlist.SetAllowlistParam[] memory params = new IAllowlist.SetAllowlistParam[](1);
        params[0] = IAllowlist.SetAllowlistParam(bob, true); // Blacklist sender (owner of funds)
        proxy.setBlacklisted(params);

        vm.expectRevert(
            abi.encodeWithSelector(IAllowlist.NotAllowlisted.selector, bob, IAllowlist.AllowlistMode.Blacklist)
        );
        vm.prank(alice);
        proxy.transferFrom(bob, charlie, 500);
    }

    function test_transferFrom_Revert_InsufficientAllowance() public {
        proxy.mint(bob, 1000);

        vm.prank(bob);
        proxy.approve(alice, 400);

        vm.expectRevert(abi.encodeWithSelector(IERC20Errors.ERC20InsufficientAllowance.selector, alice, 400, 500));
        vm.prank(alice);
        proxy.transferFrom(bob, charlie, 500);
    }

    // ============ View Functions & Constants ============

    function test_decimals() public view {
        assertEq(proxy.decimals(), 6);
    }

    function test_name() public view {
        assertEq(proxy.name(), "TRX Token");
    }

    function test_symbol() public view {
        assertEq(proxy.symbol(), "TRX");
    }

    // ============ Inherited ERC20 Functions ============

    function test_approve_Success() public {
        vm.expectEmit(true, true, true, true, address(proxy));
        emit IERC20.Approval(alice, bob, 1000);

        vm.prank(alice);
        bool success = proxy.approve(bob, 1000);

        assertTrue(success);
        assertEq(proxy.allowance(alice, bob), 1000);
    }

    // ============ Pause ============

    function test_pause_Success() public {
        assertFalse(proxy.isPaused());

        vm.expectEmit(false, false, false, true, address(proxy));
        emit IPause.PauseSet(true);

        proxy.pause();

        assertTrue(proxy.isPaused());
    }

    function test_unpause_Success() public {
        proxy.pause();
        assertTrue(proxy.isPaused());

        vm.expectEmit(false, false, false, true, address(proxy));
        emit IPause.PauseSet(false);

        proxy.unpause();

        assertFalse(proxy.isPaused());
    }

    function test_pause_Revert_Unauthorized() public {
        vm.expectRevert(
            abi.encodeWithSelector(IAccessControl.AccessControlUnauthorizedAccount.selector, alice, proxy.PAUSER_ROLE())
        );
        vm.prank(alice);
        proxy.pause();
    }

    function test_pause_Revert_Idempotent() public {
        proxy.pause();

        vm.expectRevert(abi.encodeWithSelector(IPause.PauseStateIdempotent.selector, true));
        proxy.pause();
    }

    function test_unpause_Revert_Idempotent() public {
        // Default is false/unpaused.
        vm.expectRevert(abi.encodeWithSelector(IPause.PauseStateIdempotent.selector, false));
        proxy.unpause();
    }

    function test_unpause_Revert_Unauthorized() public {
        proxy.pause();

        vm.expectRevert(
            abi.encodeWithSelector(
                IAccessControl.AccessControlUnauthorizedAccount.selector,
                alice,
                proxy.UNPAUSER_ROLE()
            )
        );
        vm.prank(alice);
        proxy.unpause();
    }

    function test_transfer_Revert_Paused() public {
        proxy.mint(alice, 1000);
        proxy.pause();

        vm.expectRevert(abi.encodeWithSelector(IPause.Paused.selector));
        vm.prank(alice);
        proxy.transfer(bob, 100);
    }

    function test_transfer_Success_AfterUnpause() public {
        proxy.mint(alice, 1000);
        proxy.pause();

        proxy.unpause();

        vm.expectEmit(true, true, true, true, address(proxy));
        emit IERC20.Transfer(alice, bob, 100);

        vm.prank(alice);
        proxy.transfer(bob, 100);

        assertEq(proxy.balanceOf(alice), 900);
        assertEq(proxy.balanceOf(bob), 100);
    }

    function test_transferFrom_Revert_Paused() public {
        proxy.mint(alice, 1000);

        vm.prank(alice);
        proxy.approve(bob, 500);

        proxy.pause();

        vm.expectRevert(abi.encodeWithSelector(IPause.Paused.selector));
        vm.prank(bob);
        proxy.transferFrom(alice, charlie, 100);
    }

    function test_transferFrom_Success_AfterUnpause() public {
        proxy.mint(alice, 1000);

        vm.prank(alice);
        proxy.approve(bob, 500);

        proxy.pause();
        proxy.unpause();

        vm.expectEmit(true, true, true, true, address(proxy));
        emit IERC20.Transfer(alice, charlie, 100);

        vm.prank(bob);
        proxy.transferFrom(alice, charlie, 100);

        assertEq(proxy.balanceOf(alice), 900);
        assertEq(proxy.balanceOf(charlie), 100);
    }

    function test_mint_Success_WhenPaused() public {
        proxy.pause();

        vm.expectEmit(true, true, true, true, address(proxy));
        emit IERC20.Transfer(address(0), bob, 1000);

        bool success = proxy.mint(bob, 1000);

        assertTrue(success);
        assertEq(proxy.balanceOf(bob), 1000);
    }

    function test_burn_Revert_Paused() public {
        proxy.mint(bob, 1000);
        proxy.pause();

        vm.expectRevert(abi.encodeWithSelector(IPause.Paused.selector));
        proxy.burn(bob, 500);
    }

    function test_approve_Success_WhenPaused() public {
        proxy.pause();

        vm.expectEmit(true, true, true, true, address(proxy));
        emit IERC20.Approval(alice, bob, 500);

        vm.prank(alice);
        proxy.approve(bob, 500);

        assertEq(proxy.allowance(alice, bob), 500);
    }

    function test_recoverFunds_Success_WhenPaused() public {
        proxy.mint(bob, 1000);

        IAllowlist.SetAllowlistParam[] memory blacklistParams = new IAllowlist.SetAllowlistParam[](1);
        blacklistParams[0] = IAllowlist.SetAllowlistParam(bob, true);

        proxy.setAllowlistMode(IAllowlist.AllowlistMode.Blacklist);
        proxy.setBlacklisted(blacklistParams);

        proxy.pause();

        vm.expectEmit(true, true, true, true, address(proxy));
        emit IERC20.Transfer(bob, charlie, 100);

        proxy.recoverFunds(bob, charlie, 100);

        assertEq(proxy.balanceOf(bob), 900);
        assertEq(proxy.balanceOf(charlie), 100);
    }

    function test_isPaused_InitialState() public view {
        assertFalse(proxy.isPaused());
    }

    // ============ Integration ============

    function test_integration_RecoverFunds() public {
        // 1. Mint tokens to `bob`.
        proxy.mint(bob, 100);

        // 2. Blacklist `bob`.
        proxy.setAllowlistMode(IAllowlist.AllowlistMode.Blacklist);

        IAllowlist.SetAllowlistParam[] memory params = new IAllowlist.SetAllowlistParam[](1);
        params[0] = IAllowlist.SetAllowlistParam(bob, true);
        proxy.setBlacklisted(params);

        // 3. Recover funds from `bob` to `charlie`.
        vm.expectEmit(true, true, true, true, address(proxy));
        emit IERC20.Transfer(bob, charlie, 100);

        proxy.recoverFunds(bob, charlie, 100);

        assertEq(proxy.balanceOf(bob), 0);
        assertEq(proxy.balanceOf(charlie), 100);
    }

    function test_recoverFunds_Revert_CannotRecoverFromAllowlisted() public {
        vm.expectRevert(abi.encodeWithSelector(IERC20Plus.CannotRecoverFromAllowlisted.selector, bob));
        proxy.recoverFunds(bob, charlie, 100);
    }

    function test_recoverFunds_Revert_Unauthorized() public {
        vm.expectRevert(
            abi.encodeWithSelector(
                IAccessControl.AccessControlUnauthorizedAccount.selector,
                bob,
                proxy.DEFAULT_ADMIN_ROLE()
            )
        );
        vm.prank(bob);
        proxy.recoverFunds(bob, charlie, 100);
    }

    function test_recoverFunds_Success_ZeroAmount() public {
        // Mint tokens to `bob`.
        proxy.mint(bob, 1000);

        // Blacklist `bob`.
        proxy.setAllowlistMode(IAllowlist.AllowlistMode.Blacklist);
        IAllowlist.SetAllowlistParam[] memory params = new IAllowlist.SetAllowlistParam[](1);
        params[0] = IAllowlist.SetAllowlistParam(bob, true);
        proxy.setBlacklisted(params);

        // Recover zero amount - should succeed.
        vm.expectEmit(true, true, true, true, address(proxy));
        emit IERC20.Transfer(bob, charlie, 0);

        proxy.recoverFunds(bob, charlie, 0);

        assertEq(proxy.balanceOf(bob), 1000);
        assertEq(proxy.balanceOf(charlie), 0);
    }

    function test_recoverFunds_Success_Fuzz(uint256 _mintAmount, uint256 _recoverAmount) public {
        _mintAmount = bound(_mintAmount, 1, type(uint256).max);
        _recoverAmount = bound(_recoverAmount, 0, _mintAmount);

        // Mint tokens to `bob`.
        proxy.mint(bob, _mintAmount);

        // Blacklist `bob`.
        proxy.setAllowlistMode(IAllowlist.AllowlistMode.Blacklist);
        IAllowlist.SetAllowlistParam[] memory params = new IAllowlist.SetAllowlistParam[](1);
        params[0] = IAllowlist.SetAllowlistParam(bob, true);
        proxy.setBlacklisted(params);

        // Recover funds.
        vm.expectEmit(true, true, true, true, address(proxy));
        emit IERC20.Transfer(bob, charlie, _recoverAmount);

        proxy.recoverFunds(bob, charlie, _recoverAmount);

        assertEq(proxy.balanceOf(bob), _mintAmount - _recoverAmount);
        assertEq(proxy.balanceOf(charlie), _recoverAmount);
    }

    // ============ Upgradeability ============

    function test_upgrade_Success() public {
        // Deploy new implementation.
        ERC20PlusV2 newImpl = new ERC20PlusV2(6);

        // Only proxy admin can upgrade.
        vm.prank(dave);
        proxyAdmin.upgradeAndCall(
            ITransparentUpgradeableProxy(address(proxy)),
            address(newImpl),
            abi.encodeWithSelector(ERC20PlusV2.reinitialize.selector, erin)
        );

        // Verify upgrade successful.
        ERC20PlusV2 upgradedProxy = ERC20PlusV2(address(proxy));
        assertEq(upgradedProxy.name(), "Upgraded");
        assertEq(upgradedProxy.symbol(), "UPG");
        assertEq(upgradedProxy.decimals(), 6);

        // Verify state preservation - `DEFAULT_ADMIN_ROLE` should still be held by `address(this)`.
        assertTrue(upgradedProxy.hasRole(upgradedProxy.DEFAULT_ADMIN_ROLE(), address(this)));
    }
}
