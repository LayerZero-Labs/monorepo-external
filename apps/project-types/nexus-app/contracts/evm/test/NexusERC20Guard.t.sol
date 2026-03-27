// SPDX-License-Identifier: MIT
pragma solidity ^0.8.22;

import { IAccessControl2Step } from "@layerzerolabs/utils-evm-impl/contracts/interfaces/IAccessControl2Step.sol";
import { IAllowlist } from "@layerzerolabs/utils-evm-impl/contracts/interfaces/IAllowlist.sol";
import { IPauseByID } from "@layerzerolabs/utils-evm-impl/contracts/interfaces/IPauseByID.sol";
import { IAccessControl } from "@openzeppelin/contracts/access/IAccessControl.sol";
import { TransparentUpgradeableProxy } from "@openzeppelin/contracts/proxy/transparent/TransparentUpgradeableProxy.sol";
import { Test } from "forge-std/Test.sol";
import { NexusERC20 } from "./../contracts/NexusERC20.sol";
import { NexusERC20Guard } from "./../contracts/NexusERC20Guard.sol";

/**
 * @title NexusERC20GuardTest
 * @notice Tests for multi-token scenarios with shared `NexusERC20Guard`.
 */
contract NexusERC20GuardTest is Test {
    NexusERC20Guard guard;
    NexusERC20 token1;
    NexusERC20 token2;

    address alice = makeAddr("alice");
    address bob = makeAddr("bob");
    address charlie = makeAddr("charlie");

    address proxyAdmin = makeAddr("proxyAdmin");

    function setUp() public {
        // Deploy shared guard (upgradeable).
        NexusERC20Guard guardImpl = new NexusERC20Guard();
        TransparentUpgradeableProxy guardProxy = new TransparentUpgradeableProxy(
            address(guardImpl),
            proxyAdmin,
            abi.encodeWithSelector(NexusERC20Guard.initialize.selector, address(this))
        );
        guard = NexusERC20Guard(address(guardProxy));

        // Grant roles to this test contract for calling restricted functions.
        guard.grantRole(guard.WHITELISTER_ROLE(), address(this));
        guard.grantRole(guard.BLACKLISTER_ROLE(), address(this));
        guard.grantRole(guard.PAUSER_ROLE(), address(this));
        guard.grantRole(guard.UNPAUSER_ROLE(), address(this));

        // Deploy first token.
        NexusERC20 impl1 = new NexusERC20(18);
        TransparentUpgradeableProxy proxy1 = new TransparentUpgradeableProxy(
            address(impl1),
            proxyAdmin,
            abi.encodeWithSelector(NexusERC20.initialize.selector, "Token One", "TK1", address(this), address(guard))
        );
        token1 = NexusERC20(address(proxy1));
        token1.grantRole(token1.MINTER_ROLE(), address(this));

        // Deploy second token.
        NexusERC20 impl2 = new NexusERC20(18);
        TransparentUpgradeableProxy proxy2 = new TransparentUpgradeableProxy(
            address(impl2),
            proxyAdmin,
            abi.encodeWithSelector(NexusERC20.initialize.selector, "Token Two", "TK2", address(this), address(guard))
        );
        token2 = NexusERC20(address(proxy2));
        token2.grantRole(token2.MINTER_ROLE(), address(this));
    }

    // ============ Initialization Tests ============

    function test_initialize_Revert_InvalidInitialAdmin() public {
        NexusERC20Guard guardImpl = new NexusERC20Guard();
        vm.expectRevert(abi.encodeWithSelector(IAccessControl2Step.InvalidDefaultAdmin.selector, address(0)));
        new TransparentUpgradeableProxy(
            address(guardImpl),
            proxyAdmin,
            abi.encodeWithSelector(NexusERC20Guard.initialize.selector, address(0))
        );
    }

    // ============ Multi-Token Shared Allowlist Tests ============

    function test_multiToken_SharedAllowlist() public {
        token1.mint(alice, 1000e18);
        token2.mint(alice, 1000e18);

        // Switch to whitelist mode.
        guard.setAllowlistMode(IAllowlist.AllowlistMode.Whitelist);

        // Both tokens should fail.
        vm.expectRevert(
            abi.encodeWithSelector(IAllowlist.NotAllowlisted.selector, alice, IAllowlist.AllowlistMode.Whitelist)
        );
        vm.prank(alice);
        token1.transfer(bob, 100e18);

        vm.expectRevert(
            abi.encodeWithSelector(IAllowlist.NotAllowlisted.selector, alice, IAllowlist.AllowlistMode.Whitelist)
        );
        vm.prank(alice);
        token2.transfer(bob, 100e18);

        // Whitelist `alice` and `bob`.
        IAllowlist.SetAllowlistParam[] memory params = new IAllowlist.SetAllowlistParam[](2);
        params[0] = IAllowlist.SetAllowlistParam(alice, true);
        params[1] = IAllowlist.SetAllowlistParam(bob, true);
        guard.setWhitelisted(params);

        // Both tokens should work now.
        vm.prank(alice);
        token1.transfer(bob, 100e18);

        vm.prank(alice);
        token2.transfer(bob, 100e18);

        assertEq(token1.balanceOf(bob), 100e18);
        assertEq(token2.balanceOf(bob), 100e18);
    }

    // ============ Multi-Token Independent Pause Tests ============

    function test_multiToken_IndependentPause() public {
        token1.mint(alice, 1000e18);
        token2.mint(alice, 1000e18);

        // Pause only first token.
        IPauseByID.SetPausedParam[] memory params = new IPauseByID.SetPausedParam[](1);
        params[0] = IPauseByID.SetPausedParam(uint160(address(token1)), true, true);
        guard.setPaused(params);

        // First token should fail.
        vm.expectRevert(abi.encodeWithSelector(IPauseByID.Paused.selector, uint160(address(token1))));
        vm.prank(alice);
        token1.transfer(bob, 100e18);

        // Second token should succeed.
        vm.prank(alice);
        token2.transfer(bob, 100e18);
        assertEq(token2.balanceOf(bob), 100e18);
    }

    function test_multiToken_GlobalPause() public {
        token1.mint(alice, 1000e18);
        token2.mint(alice, 1000e18);

        // Set global pause.
        guard.setDefaultPaused(true);

        // Both tokens should fail.
        vm.expectRevert(abi.encodeWithSelector(IPauseByID.Paused.selector, uint160(address(token1))));
        vm.prank(alice);
        token1.transfer(bob, 100e18);

        vm.expectRevert(abi.encodeWithSelector(IPauseByID.Paused.selector, uint160(address(token2))));
        vm.prank(alice);
        token2.transfer(bob, 100e18);

        // Override for first token only.
        IPauseByID.SetPausedParam[] memory params = new IPauseByID.SetPausedParam[](1);
        params[0] = IPauseByID.SetPausedParam(uint160(address(token1)), false, true);
        guard.setPaused(params);

        // First token should now work.
        vm.prank(alice);
        token1.transfer(bob, 100e18);
        assertEq(token1.balanceOf(bob), 100e18);

        // Second token should still fail.
        vm.expectRevert(abi.encodeWithSelector(IPauseByID.Paused.selector, uint160(address(token2))));
        vm.prank(alice);
        token2.transfer(bob, 100e18);
    }

    // ============ RBAC Tests ============

    function test_setAllowlistMode_Revert_Unauthorized() public {
        address unauthorized = makeAddr("unauthorized");
        bytes32 defaultAdminRole = guard.DEFAULT_ADMIN_ROLE();

        vm.prank(unauthorized);
        vm.expectRevert(
            abi.encodeWithSelector(
                IAccessControl.AccessControlUnauthorizedAccount.selector,
                unauthorized,
                defaultAdminRole
            )
        );
        guard.setAllowlistMode(IAllowlist.AllowlistMode.Whitelist);
    }

    function test_setPaused_Revert_Unauthorized() public {
        address unauthorized = makeAddr("unauthorized");
        bytes32 pauserRole = guard.PAUSER_ROLE();

        IPauseByID.SetPausedParam[] memory params = new IPauseByID.SetPausedParam[](1);
        params[0] = IPauseByID.SetPausedParam(uint160(address(token1)), true, true);

        vm.prank(unauthorized);
        vm.expectRevert(
            abi.encodeWithSelector(IAccessControl.AccessControlUnauthorizedAccount.selector, unauthorized, pauserRole)
        );
        guard.setPaused(params);
    }

    // ============ checkTransfer Tests ============

    function test_checkTransfer_Success() public view {
        guard.checkTransfer(address(token1), alice, bob, charlie, 100e18);
    }

    function test_checkTransfer_Revert_Paused() public {
        IPauseByID.SetPausedParam[] memory params = new IPauseByID.SetPausedParam[](1);
        params[0] = IPauseByID.SetPausedParam(uint160(address(token1)), true, true);
        guard.setPaused(params);

        vm.expectRevert(abi.encodeWithSelector(IPauseByID.Paused.selector, uint160(address(token1))));
        guard.checkTransfer(address(token1), alice, bob, charlie, 100e18);
    }

    function test_checkTransfer_Revert_CallerNotAllowlisted() public {
        guard.setAllowlistMode(IAllowlist.AllowlistMode.Whitelist);

        vm.expectRevert(
            abi.encodeWithSelector(IAllowlist.NotAllowlisted.selector, alice, IAllowlist.AllowlistMode.Whitelist)
        );
        guard.checkTransfer(address(token1), alice, bob, charlie, 100e18);
    }

    function test_checkTransfer_SkipsZeroAddresses() public {
        guard.setAllowlistMode(IAllowlist.AllowlistMode.Whitelist);

        // Should not revert even in whitelist mode for zero addresses.
        guard.checkTransfer(address(token1), address(0), address(0), address(0), 100e18);
    }
}
