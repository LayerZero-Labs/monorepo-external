// SPDX-License-Identifier: MIT
pragma solidity ^0.8.22;

import { IAccessControl2Step } from "@layerzerolabs/utils-evm-impl/contracts/interfaces/IAccessControl2Step.sol";
import { IAllowlist } from "@layerzerolabs/utils-evm-impl/contracts/interfaces/IAllowlist.sol";
import { IPauseByID } from "@layerzerolabs/utils-evm-impl/contracts/interfaces/IPauseByID.sol";
import { IAccessControl } from "@openzeppelin/contracts/access/IAccessControl.sol";
import { TransparentUpgradeableProxy } from "@openzeppelin/contracts/proxy/transparent/TransparentUpgradeableProxy.sol";
import { Test } from "forge-std/Test.sol";
import { INexusERC20 } from "./../contracts/interfaces/INexusERC20.sol";
import { NexusERC20 } from "./../contracts/NexusERC20.sol";
import { NexusERC20Guard } from "./../contracts/NexusERC20Guard.sol";

contract NexusERC20Test is Test {
    NexusERC20 token;
    NexusERC20Guard guard;

    address alice = makeAddr("alice");
    address bob = makeAddr("bob");
    address charlie = makeAddr("charlie");

    address admin = makeAddr("admin");
    address proxyAdmin = makeAddr("proxyAdmin");

    function setUp() public {
        // Deploy guard (upgradeable).
        NexusERC20Guard guardImpl = new NexusERC20Guard();
        TransparentUpgradeableProxy guardProxy = new TransparentUpgradeableProxy(
            address(guardImpl),
            proxyAdmin,
            abi.encodeWithSelector(NexusERC20Guard.initialize.selector, address(this))
        );
        guard = NexusERC20Guard(address(guardProxy));

        // Deploy token (upgradeable).
        NexusERC20 impl = new NexusERC20(18);
        TransparentUpgradeableProxy proxy = new TransparentUpgradeableProxy(
            address(impl),
            proxyAdmin,
            abi.encodeWithSelector(NexusERC20.initialize.selector, "Nexus Token", "NXT", address(this), address(guard))
        );
        token = NexusERC20(address(proxy));

        // Grant token roles.
        token.grantRole(token.MINTER_ROLE(), address(this));
        token.grantRole(token.BURNER_ROLE(), address(this));

        // Grant guard roles.
        guard.grantRole(guard.PAUSER_ROLE(), address(this));
        guard.grantRole(guard.WHITELISTER_ROLE(), address(this));
        guard.grantRole(guard.BLACKLISTER_ROLE(), address(this));
    }

    // ============ Initialization Tests ============

    function test_initialize() public view {
        assertEq(token.name(), "Nexus Token");
        assertEq(token.symbol(), "NXT");
        assertEq(token.decimals(), 18);
        assertEq(address(token.getGuard()), address(guard));
    }

    function test_initialize_Revert_InvalidInitialAdmin() public {
        NexusERC20 impl = new NexusERC20(18);
        vm.expectRevert(abi.encodeWithSelector(IAccessControl2Step.InvalidDefaultAdmin.selector, address(0)));
        new TransparentUpgradeableProxy(
            address(impl),
            proxyAdmin,
            abi.encodeWithSelector(NexusERC20.initialize.selector, "Test", "TST", address(0), address(guard))
        );
    }

    function test_initialize_Revert_InvalidGuardAddress() public {
        NexusERC20 impl = new NexusERC20(18);
        vm.expectRevert(INexusERC20.InvalidGuardAddress.selector);
        new TransparentUpgradeableProxy(
            address(impl),
            proxyAdmin,
            abi.encodeWithSelector(NexusERC20.initialize.selector, "Test", "TST", address(this), address(0))
        );
    }

    // ============ Storage Location Test ============

    function test_storageLocation() public pure {
        bytes32 expected = keccak256(abi.encode(uint256(keccak256("layerzerov2.storage.nexuserc20")) - 1)) &
            ~bytes32(uint256(0xff));
        assertEq(expected, 0x74fa4edb434516930211f9db1b9cccb141bed2597670b3f631577904153f6200);
    }

    // ============ Guard Tests ============

    function test_getGuard() public view {
        assertEq(address(token.getGuard()), address(guard));
    }

    function test_setGuard() public {
        NexusERC20Guard newGuardImpl = new NexusERC20Guard();
        TransparentUpgradeableProxy newGuardProxy = new TransparentUpgradeableProxy(
            address(newGuardImpl),
            proxyAdmin,
            abi.encodeWithSelector(NexusERC20Guard.initialize.selector, address(this))
        );
        NexusERC20Guard newGuard = NexusERC20Guard(address(newGuardProxy));

        vm.expectEmit(true, false, false, false, address(token));
        emit INexusERC20.GuardSet(address(newGuard));
        token.setGuard(address(newGuard));

        assertEq(address(token.getGuard()), address(newGuard));
    }

    function test_setGuard_Revert_InvalidGuardAddress() public {
        vm.expectRevert(INexusERC20.InvalidGuardAddress.selector);
        token.setGuard(address(0));
    }

    function test_setGuard_Revert_Unauthorized() public {
        vm.expectRevert(
            abi.encodeWithSelector(
                IAccessControl.AccessControlUnauthorizedAccount.selector,
                alice,
                token.DEFAULT_ADMIN_ROLE()
            )
        );
        vm.prank(alice);
        token.setGuard(address(guard));
    }

    // ============ Mint Tests ============

    function test_mint() public {
        token.mint(alice, 1000e18);
        assertEq(token.balanceOf(alice), 1000e18);
    }

    function test_mint_Revert_Unauthorized() public {
        vm.expectRevert(
            abi.encodeWithSelector(IAccessControl.AccessControlUnauthorizedAccount.selector, alice, token.MINTER_ROLE())
        );
        vm.prank(alice);
        token.mint(alice, 1000e18);
    }

    // ============ Burn Tests ============

    function test_burn() public {
        token.mint(alice, 1000e18);
        token.burn(alice, 500e18);
        assertEq(token.balanceOf(alice), 500e18);
    }

    function test_burn_Revert_Unauthorized() public {
        token.mint(alice, 1000e18);
        vm.expectRevert(
            abi.encodeWithSelector(IAccessControl.AccessControlUnauthorizedAccount.selector, alice, token.BURNER_ROLE())
        );
        vm.prank(alice);
        token.burn(alice, 500e18);
    }

    function test_burn_Revert_Paused() public {
        token.mint(alice, 1000e18);

        IPauseByID.SetPausedParam[] memory params = new IPauseByID.SetPausedParam[](1);
        params[0] = IPauseByID.SetPausedParam(uint160(address(token)), true, true);
        guard.setPaused(params);

        vm.expectRevert(abi.encodeWithSelector(IPauseByID.Paused.selector, uint160(address(token))));
        token.burn(alice, 500e18);
    }

    function test_burn_Revert_NotAllowlisted() public {
        token.mint(alice, 1000e18);

        guard.setAllowlistMode(IAllowlist.AllowlistMode.Whitelist);

        vm.expectRevert(
            abi.encodeWithSelector(IAllowlist.NotAllowlisted.selector, alice, IAllowlist.AllowlistMode.Whitelist)
        );
        token.burn(alice, 500e18);
    }

    // ============ Transfer Tests ============

    function test_transfer() public {
        token.mint(alice, 1000e18);

        vm.prank(alice);
        token.transfer(bob, 500e18);

        assertEq(token.balanceOf(alice), 500e18);
        assertEq(token.balanceOf(bob), 500e18);
    }

    function test_transfer_Revert_Paused() public {
        token.mint(alice, 1000e18);

        IPauseByID.SetPausedParam[] memory params = new IPauseByID.SetPausedParam[](1);
        params[0] = IPauseByID.SetPausedParam(uint160(address(token)), true, true);
        guard.setPaused(params);

        vm.expectRevert(abi.encodeWithSelector(IPauseByID.Paused.selector, uint160(address(token))));
        vm.prank(alice);
        token.transfer(bob, 500e18);
    }

    function test_transfer_Revert_SenderNotAllowlisted() public {
        token.mint(alice, 1000e18);

        guard.setAllowlistMode(IAllowlist.AllowlistMode.Whitelist);

        vm.expectRevert(
            abi.encodeWithSelector(IAllowlist.NotAllowlisted.selector, alice, IAllowlist.AllowlistMode.Whitelist)
        );
        vm.prank(alice);
        token.transfer(bob, 500e18);
    }

    function test_transfer_Revert_RecipientNotAllowlisted() public {
        token.mint(alice, 1000e18);

        guard.setAllowlistMode(IAllowlist.AllowlistMode.Whitelist);

        IAllowlist.SetAllowlistParam[] memory params = new IAllowlist.SetAllowlistParam[](1);
        params[0] = IAllowlist.SetAllowlistParam(alice, true);
        guard.setWhitelisted(params);

        vm.expectRevert(
            abi.encodeWithSelector(IAllowlist.NotAllowlisted.selector, bob, IAllowlist.AllowlistMode.Whitelist)
        );
        vm.prank(alice);
        token.transfer(bob, 500e18);
    }

    // ============ TransferFrom Tests ============

    function test_transferFrom() public {
        token.mint(alice, 1000e18);

        vm.prank(alice);
        token.approve(bob, 500e18);

        vm.prank(bob);
        token.transferFrom(alice, charlie, 500e18);

        assertEq(token.balanceOf(alice), 500e18);
        assertEq(token.balanceOf(charlie), 500e18);
    }

    function test_transferFrom_Revert_Paused() public {
        token.mint(alice, 1000e18);

        vm.prank(alice);
        token.approve(bob, 500e18);

        IPauseByID.SetPausedParam[] memory params = new IPauseByID.SetPausedParam[](1);
        params[0] = IPauseByID.SetPausedParam(uint160(address(token)), true, true);
        guard.setPaused(params);

        vm.expectRevert(abi.encodeWithSelector(IPauseByID.Paused.selector, uint160(address(token))));
        vm.prank(bob);
        token.transferFrom(alice, charlie, 500e18);
    }

    function test_transferFrom_Revert_CallerNotAllowlisted() public {
        token.mint(alice, 1000e18);

        vm.prank(alice);
        token.approve(bob, 500e18);

        guard.setAllowlistMode(IAllowlist.AllowlistMode.Whitelist);

        vm.expectRevert(
            abi.encodeWithSelector(IAllowlist.NotAllowlisted.selector, bob, IAllowlist.AllowlistMode.Whitelist)
        );
        vm.prank(bob);
        token.transferFrom(alice, charlie, 500e18);
    }

    // ============ Fund Recovery Tests ============

    function test_recoverFunds() public {
        token.mint(alice, 1000e18);

        guard.setAllowlistMode(IAllowlist.AllowlistMode.Blacklist);

        IAllowlist.SetAllowlistParam[] memory params = new IAllowlist.SetAllowlistParam[](1);
        params[0] = IAllowlist.SetAllowlistParam(alice, true);
        guard.setBlacklisted(params);

        token.recoverFunds(alice, bob, 500e18);

        assertEq(token.balanceOf(alice), 500e18);
        assertEq(token.balanceOf(bob), 500e18);
    }

    function test_recoverFunds_Revert_Allowlisted() public {
        token.mint(alice, 1000e18);

        vm.expectRevert(abi.encodeWithSelector(INexusERC20.CannotRecoverFromAllowlisted.selector, alice));
        token.recoverFunds(alice, bob, 500e18);
    }

    function test_recoverFunds_Revert_Unauthorized() public {
        token.mint(alice, 1000e18);

        vm.expectRevert(
            abi.encodeWithSelector(
                IAccessControl.AccessControlUnauthorizedAccount.selector,
                alice,
                token.DEFAULT_ADMIN_ROLE()
            )
        );
        vm.prank(alice);
        token.recoverFunds(alice, bob, 500e18);
    }

    // ============ Blacklist Mode Tests ============

    function test_transfer_Blacklist_Blocked() public {
        token.mint(alice, 1000e18);

        guard.setAllowlistMode(IAllowlist.AllowlistMode.Blacklist);

        IAllowlist.SetAllowlistParam[] memory params = new IAllowlist.SetAllowlistParam[](1);
        params[0] = IAllowlist.SetAllowlistParam(alice, true);
        guard.setBlacklisted(params);

        vm.expectRevert(
            abi.encodeWithSelector(IAllowlist.NotAllowlisted.selector, alice, IAllowlist.AllowlistMode.Blacklist)
        );
        vm.prank(alice);
        token.transfer(bob, 500e18);
    }

    function test_transfer_Blacklist_Allowed() public {
        token.mint(alice, 1000e18);

        guard.setAllowlistMode(IAllowlist.AllowlistMode.Blacklist);

        vm.prank(alice);
        token.transfer(bob, 500e18);

        assertEq(token.balanceOf(alice), 500e18);
        assertEq(token.balanceOf(bob), 500e18);
    }

    // ============ Whitelist Mode Tests ============

    function test_transfer_Whitelist_Allowed() public {
        token.mint(alice, 1000e18);

        guard.setAllowlistMode(IAllowlist.AllowlistMode.Whitelist);

        IAllowlist.SetAllowlistParam[] memory params = new IAllowlist.SetAllowlistParam[](2);
        params[0] = IAllowlist.SetAllowlistParam(alice, true);
        params[1] = IAllowlist.SetAllowlistParam(bob, true);
        guard.setWhitelisted(params);

        vm.prank(alice);
        token.transfer(bob, 500e18);

        assertEq(token.balanceOf(alice), 500e18);
        assertEq(token.balanceOf(bob), 500e18);
    }
}
