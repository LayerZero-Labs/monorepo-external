// SPDX-License-Identifier: MIT
pragma solidity ^0.8.22;

import { Ownable } from "@openzeppelin/contracts/access/Ownable.sol";
import { Ownable2Step } from "@openzeppelin/contracts/access/Ownable2Step.sol";
import { ERC1967Proxy } from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import { ERC1967Utils } from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Utils.sol";
import { ITransparentUpgradeableProxy } from "@openzeppelin/contracts/proxy/transparent/TransparentUpgradeableProxy.sol";
import { Test } from "forge-std/Test.sol";

import { IProxyAdmin2Step } from "../contracts/interfaces/IProxyAdmin2Step.sol";
import { ProxyAdmin2Step } from "../contracts/ProxyAdmin2Step.sol";
import { TransparentUpgradeableProxy2Step } from "../contracts/TransparentUpgradeableProxy2Step.sol";

contract ImplementationV1 {
    uint256 public value;
    bool public initialized;

    function initialize() external {
        initialized = true;
    }

    function setValue(uint256 _value) external {
        value = _value;
    }
}

contract ImplementationV2 {
    uint256 public value;

    function setValue(uint256 _value) external {
        value = _value * 2;
    }
}

contract TransparentUpgradeableProxy2StepTest is Test {
    ImplementationV1 implV1;
    ImplementationV2 implV2;
    TransparentUpgradeableProxy2Step proxy;
    ProxyAdmin2Step proxyAdmin;

    address alice = makeAddr("alice");
    address bob = makeAddr("bob");
    address charlie = makeAddr("charlie");
    address dave = makeAddr("dave");

    function _getProxyAdminAddress(address _proxy) internal view returns (address) {
        bytes32 adminSlot = vm.load(_proxy, ERC1967Utils.ADMIN_SLOT);
        return address(uint160(uint256(adminSlot)));
    }

    function setUp() public {
        implV1 = new ImplementationV1();
        implV2 = new ImplementationV2();

        proxy = new TransparentUpgradeableProxy2Step(
            address(implV1),
            dave,
            abi.encodeCall(ImplementationV1.initialize, ())
        );
        proxyAdmin = ProxyAdmin2Step(_getProxyAdminAddress(address(proxy)));
    }

    // ============ Constructor ============

    function test_constructor_DeploysProxyAdmin2StepOwnedByInitialOwner() public view {
        assertEq(proxyAdmin.owner(), dave);
        assertEq(proxyAdmin.pendingOwner(), address(0));
        assertEq(ImplementationV1(address(proxy)).value(), 0);
        assertTrue(ImplementationV1(address(proxy)).initialized());
    }

    function test_constructor_RevertsOnEmptyData() public {
        vm.expectRevert(ERC1967Proxy.ERC1967ProxyUninitialized.selector);
        new TransparentUpgradeableProxy2Step(address(implV1), dave, "");
    }

    // ============ transferOwnership ============

    function test_transferOwnership_Success() public {
        vm.expectEmit(true, true, true, true, address(proxyAdmin));
        emit Ownable2Step.OwnershipTransferStarted(dave, alice);

        vm.prank(dave);
        proxyAdmin.transferOwnership(alice);

        assertEq(proxyAdmin.owner(), dave);
        assertEq(proxyAdmin.pendingOwner(), alice);
    }

    function test_transferOwnership_Success_OverwritesPending() public {
        vm.prank(dave);
        proxyAdmin.transferOwnership(alice);
        assertEq(proxyAdmin.pendingOwner(), alice);

        vm.prank(dave);
        proxyAdmin.transferOwnership(bob);
        assertEq(proxyAdmin.owner(), dave);
        assertEq(proxyAdmin.pendingOwner(), bob);
    }

    function test_transferOwnership_Success_CancelsBySettingZero() public {
        vm.prank(dave);
        proxyAdmin.transferOwnership(alice);
        assertEq(proxyAdmin.pendingOwner(), alice);

        vm.expectEmit(true, true, true, true, address(proxyAdmin));
        emit Ownable2Step.OwnershipTransferStarted(dave, address(0));

        vm.prank(dave);
        proxyAdmin.transferOwnership(address(0));

        assertEq(proxyAdmin.owner(), dave);
        assertEq(proxyAdmin.pendingOwner(), address(0));

        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, alice));
        vm.prank(alice);
        proxyAdmin.acceptOwnership();
    }

    function test_transferOwnership_Revert_Unauthorized() public {
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, alice));
        vm.prank(alice);
        proxyAdmin.transferOwnership(bob);
    }

    function test_transferOwnership_Fuzz(address _newOwner) public {
        vm.prank(dave);
        proxyAdmin.transferOwnership(_newOwner);

        assertEq(proxyAdmin.pendingOwner(), _newOwner);
        assertEq(proxyAdmin.owner(), dave);
    }

    // ============ acceptOwnership ============

    function test_acceptOwnership_Success() public {
        vm.prank(dave);
        proxyAdmin.transferOwnership(alice);

        vm.expectEmit(true, true, true, true, address(proxyAdmin));
        emit Ownable.OwnershipTransferred(dave, alice);

        vm.prank(alice);
        proxyAdmin.acceptOwnership();

        assertEq(proxyAdmin.owner(), alice);
        assertEq(proxyAdmin.pendingOwner(), address(0));
    }

    function test_acceptOwnership_Revert_NotPendingOwner() public {
        vm.prank(dave);
        proxyAdmin.transferOwnership(alice);

        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, bob));
        vm.prank(bob);
        proxyAdmin.acceptOwnership();

        assertEq(proxyAdmin.owner(), dave);
        assertEq(proxyAdmin.pendingOwner(), alice);
    }

    function test_acceptOwnership_Revert_NoPendingTransfer() public {
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, alice));
        vm.prank(alice);
        proxyAdmin.acceptOwnership();
    }

    function test_acceptOwnership_Fuzz(address _newOwner) public {
        vm.assume(_newOwner != address(0));
        vm.assume(_newOwner != dave);

        vm.prank(dave);
        proxyAdmin.transferOwnership(_newOwner);
        vm.prank(_newOwner);
        proxyAdmin.acceptOwnership();

        assertEq(proxyAdmin.owner(), _newOwner);
        assertEq(proxyAdmin.pendingOwner(), address(0));

        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, dave));
        vm.prank(dave);
        proxyAdmin.upgradeAndCall(ITransparentUpgradeableProxy(address(proxy)), address(implV2), "");

        vm.prank(_newOwner);
        proxyAdmin.upgradeAndCall(ITransparentUpgradeableProxy(address(proxy)), address(implV2), "");
        assertEq(address(uint160(uint256(vm.load(address(proxy), ERC1967Utils.IMPLEMENTATION_SLOT)))), address(implV2));
    }

    function test_acceptOwnership_Fuzz_Revert_NotPendingOwner(address _newOwner, address _caller) public {
        vm.assume(_newOwner != address(0));
        vm.assume(_caller != _newOwner);

        vm.prank(dave);
        proxyAdmin.transferOwnership(_newOwner);

        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, _caller));
        vm.prank(_caller);
        proxyAdmin.acceptOwnership();

        assertEq(proxyAdmin.owner(), dave);
        assertEq(proxyAdmin.pendingOwner(), _newOwner);
    }

    // ============ upgradeAndCall ============

    function test_upgradeAndCall_Success() public {
        vm.prank(dave);
        proxyAdmin.upgradeAndCall(ITransparentUpgradeableProxy(address(proxy)), address(implV2), "");

        ImplementationV2(address(proxy)).setValue(4);
        assertEq(ImplementationV2(address(proxy)).value(), 8);
    }

    function test_upgradeAndCall_Success_AfterOwnershipTransfer() public {
        vm.prank(dave);
        proxyAdmin.transferOwnership(alice);
        vm.prank(alice);
        proxyAdmin.acceptOwnership();

        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, dave));
        vm.prank(dave);
        proxyAdmin.upgradeAndCall(ITransparentUpgradeableProxy(address(proxy)), address(implV2), "");

        vm.prank(alice);
        proxyAdmin.upgradeAndCall(ITransparentUpgradeableProxy(address(proxy)), address(implV2), "");

        ImplementationV2(address(proxy)).setValue(3);
        assertEq(ImplementationV2(address(proxy)).value(), 6);
    }

    function test_upgradeAndCall_Revert_Unauthorized() public {
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, charlie));
        vm.prank(charlie);
        proxyAdmin.upgradeAndCall(ITransparentUpgradeableProxy(address(proxy)), address(implV2), "");
    }

    // ============ Fallback ============

    function test_fallback_Revert_ProxyDeniedAdminAccess() public {
        vm.expectRevert(TransparentUpgradeableProxy2Step.ProxyDeniedAdminAccess.selector);
        vm.prank(address(proxyAdmin));
        ImplementationV1(address(proxy)).setValue(1);
    }

    // ============ renounceOwnership ============

    function test_renounceOwnership_Revert() public {
        vm.expectRevert(IProxyAdmin2Step.CannotRenounceOwnership.selector);
        vm.prank(dave);
        proxyAdmin.renounceOwnership();

        assertEq(proxyAdmin.owner(), dave);
        assertEq(proxyAdmin.pendingOwner(), address(0));
    }

    function test_renounceOwnership_Revert_DuringPendingTransfer() public {
        vm.prank(dave);
        proxyAdmin.transferOwnership(alice);

        vm.expectRevert(IProxyAdmin2Step.CannotRenounceOwnership.selector);
        vm.prank(dave);
        proxyAdmin.renounceOwnership();

        assertEq(proxyAdmin.owner(), dave);
        assertEq(proxyAdmin.pendingOwner(), alice);
    }

    function test_renounceOwnership_Fuzz_Revert(address _caller) public {
        vm.expectRevert(IProxyAdmin2Step.CannotRenounceOwnership.selector);
        vm.prank(_caller);
        proxyAdmin.renounceOwnership();

        assertEq(proxyAdmin.owner(), dave);
    }
}
