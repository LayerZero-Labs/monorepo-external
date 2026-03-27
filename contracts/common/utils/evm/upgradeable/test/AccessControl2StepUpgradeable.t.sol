// SPDX-License-Identifier: MIT
pragma solidity ^0.8.22;

import { Initializable } from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import { IAccessControl } from "@openzeppelin/contracts/access/IAccessControl.sol";
import { TransparentUpgradeableProxy } from "@openzeppelin/contracts/proxy/transparent/TransparentUpgradeableProxy.sol";
import { Test } from "forge-std/Test.sol";
import {
    AccessControl2StepUpgradeable,
    IAccessControl2Step
} from "./../contracts/access/AccessControl2StepUpgradeable.sol";

contract AccessControl2StepUpgradeableMock is AccessControl2StepUpgradeable {
    bytes32 public constant TEST_ROLE = keccak256("TEST_ROLE");
    bytes32 public constant OTHER_ROLE = keccak256("OTHER_ROLE");

    constructor() {
        _disableInitializers();
    }

    function initialize(address _initialAdmin) public initializer {
        __AccessControl2Step_init(_initialAdmin);
    }

    function exposedSetRoleAdmin(bytes32 role, bytes32 adminRole) external {
        _setRoleAdmin(role, adminRole);
    }
}

contract AccessControl2StepUpgradeableTest is Test {
    AccessControl2StepUpgradeableMock mock;

    address initialAdmin = address(this);
    address alice = makeAddr("alice");
    address bob = makeAddr("bob");
    address charlie = makeAddr("charlie");
    address proxyAdmin;

    bytes32 defaultAdminRole;
    bytes32 testRole;

    function setUp() public {
        AccessControl2StepUpgradeableMock impl = new AccessControl2StepUpgradeableMock();

        uint256 currentNonce = vm.getNonce(address(this));
        proxyAdmin = vm.computeCreateAddress(vm.computeCreateAddress(address(this), currentNonce), 1);

        TransparentUpgradeableProxy proxy = new TransparentUpgradeableProxy(
            address(impl),
            address(this),
            abi.encodeWithSelector(AccessControl2StepUpgradeableMock.initialize.selector, address(this))
        );
        mock = AccessControl2StepUpgradeableMock(address(proxy));
        defaultAdminRole = mock.DEFAULT_ADMIN_ROLE();
        testRole = mock.TEST_ROLE();
    }

    // ============ Initialization ============

    function test_initialize_Success_AdminHasRole() public view {
        assertTrue(mock.hasRole(defaultAdminRole, initialAdmin));
        assertEq(mock.getRoleMemberCount(defaultAdminRole), 1);
        assertEq(mock.getRoleMember(defaultAdminRole, 0), initialAdmin);
        assertEq(mock.defaultAdmin(), initialAdmin);
    }

    function test_initialize_Revert_AlreadyInitialized() public {
        vm.expectRevert(Initializable.InvalidInitialization.selector);
        mock.initialize(address(0x999));
    }

    function test_initialize_Revert_InvalidDefaultAdmin() public {
        AccessControl2StepUpgradeableMock impl = new AccessControl2StepUpgradeableMock();
        vm.expectRevert(abi.encodeWithSelector(IAccessControl2Step.InvalidDefaultAdmin.selector, address(0)));
        new TransparentUpgradeableProxy(
            address(impl),
            address(this),
            abi.encodeWithSelector(AccessControl2StepUpgradeableMock.initialize.selector, address(0))
        );
    }

    // ============ defaultAdmin ============

    function test_defaultAdmin_ReturnsInitialAdmin() public view {
        assertEq(mock.defaultAdmin(), initialAdmin);
    }

    // ============ pendingDefaultAdmin ============

    function test_pendingDefaultAdmin_InitiallyZero() public view {
        assertEq(mock.pendingDefaultAdmin(), address(0));
    }

    // ============ beginDefaultAdminTransfer ============

    function test_beginDefaultAdminTransfer_Success() public {
        vm.expectEmit(true, true, true, true, address(mock));
        emit IAccessControl2Step.DefaultAdminTransferStarted(alice);

        mock.beginDefaultAdminTransfer(alice);

        assertEq(mock.pendingDefaultAdmin(), alice);
        assertEq(mock.defaultAdmin(), initialAdmin);
    }

    function test_beginDefaultAdminTransfer_Success_OverwritesPending() public {
        mock.beginDefaultAdminTransfer(alice);
        assertEq(mock.pendingDefaultAdmin(), alice);

        mock.beginDefaultAdminTransfer(bob);
        assertEq(mock.pendingDefaultAdmin(), bob);
    }

    function test_beginDefaultAdminTransfer_Success_CancelsBySettingZero() public {
        mock.beginDefaultAdminTransfer(alice);
        assertEq(mock.pendingDefaultAdmin(), alice);

        vm.expectEmit(true, true, true, true, address(mock));
        emit IAccessControl2Step.DefaultAdminTransferStarted(address(0));

        mock.beginDefaultAdminTransfer(address(0));
        assertEq(mock.pendingDefaultAdmin(), address(0));
    }

    function test_beginDefaultAdminTransfer_Revert_Unauthorized() public {
        vm.expectRevert(
            abi.encodeWithSelector(IAccessControl.AccessControlUnauthorizedAccount.selector, alice, defaultAdminRole)
        );
        vm.prank(alice);
        mock.beginDefaultAdminTransfer(bob);
    }

    // ============ acceptDefaultAdminTransfer ============

    function test_acceptDefaultAdminTransfer_Success() public {
        mock.beginDefaultAdminTransfer(alice);

        vm.prank(alice);
        mock.acceptDefaultAdminTransfer();

        assertTrue(mock.hasRole(defaultAdminRole, alice));
        assertFalse(mock.hasRole(defaultAdminRole, initialAdmin));
        assertEq(mock.getRoleMemberCount(defaultAdminRole), 1);
        assertEq(mock.getRoleMember(defaultAdminRole, 0), alice);
        assertEq(mock.defaultAdmin(), alice);
        assertEq(mock.pendingDefaultAdmin(), address(0));
    }

    function test_acceptDefaultAdminTransfer_Revert_NotPendingAdmin() public {
        mock.beginDefaultAdminTransfer(alice);

        vm.expectRevert(abi.encodeWithSelector(IAccessControl2Step.CallerNotPendingAdmin.selector, alice));
        vm.prank(bob);
        mock.acceptDefaultAdminTransfer();
    }

    function test_acceptDefaultAdminTransfer_Revert_NoPendingTransfer() public {
        vm.expectRevert(abi.encodeWithSelector(IAccessControl2Step.CallerNotPendingAdmin.selector, address(0)));
        vm.prank(alice);
        mock.acceptDefaultAdminTransfer();
    }

    // ============ grantRole ============

    function test_grantRole_Revert_DefaultAdminRole() public {
        vm.expectRevert(abi.encodeWithSelector(IAccessControl2Step.AccessControlEnforcedDefaultAdminRules.selector));
        mock.grantRole(defaultAdminRole, alice);
    }

    function test_grantRole_Success_NonAdminRole() public {
        mock.grantRole(testRole, alice);
        assertTrue(mock.hasRole(testRole, alice));
    }

    // ============ revokeRole ============

    function test_revokeRole_Revert_DefaultAdminRole_NonAdmin() public {
        vm.expectRevert(
            abi.encodeWithSelector(IAccessControl.AccessControlUnauthorizedAccount.selector, alice, defaultAdminRole)
        );
        vm.prank(alice);
        mock.revokeRole(defaultAdminRole, initialAdmin);
    }

    function test_revokeRole_Revert_DefaultAdminRole_Admin() public {
        vm.expectRevert(abi.encodeWithSelector(IAccessControl2Step.AccessControlEnforcedDefaultAdminRules.selector));
        mock.revokeRole(defaultAdminRole, initialAdmin);
    }

    function test_revokeRole_Success_NonAdminRole_Admin() public {
        mock.grantRole(testRole, alice);
        assertTrue(mock.hasRole(testRole, alice));

        mock.revokeRole(testRole, alice);
        assertFalse(mock.hasRole(testRole, alice));
    }

    function test_revokeRole_Revert_NonAdminRole_NonAdmin() public {
        mock.grantRole(testRole, alice);
        assertTrue(mock.hasRole(testRole, alice));

        vm.expectRevert(
            abi.encodeWithSelector(IAccessControl.AccessControlUnauthorizedAccount.selector, alice, defaultAdminRole)
        );
        vm.prank(alice);
        mock.revokeRole(testRole, alice);
    }

    // ============ renounceRole ============

    function test_renounceRole_Revert_DefaultAdminRole() public {
        vm.expectRevert(abi.encodeWithSelector(IAccessControl2Step.AccessControlEnforcedDefaultAdminRules.selector));
        mock.renounceRole(defaultAdminRole, initialAdmin);
    }

    function test_renounceRole_Revert_DefaultAdminRoleDuringPendingTransfer() public {
        mock.beginDefaultAdminTransfer(alice);

        vm.expectRevert(abi.encodeWithSelector(IAccessControl2Step.AccessControlEnforcedDefaultAdminRules.selector));
        mock.renounceRole(defaultAdminRole, initialAdmin);
    }

    function test_renounceRole_Success_NonAdminRole_NonAdmin() public {
        mock.grantRole(testRole, alice);

        vm.startPrank(alice);
        mock.renounceRole(testRole, alice);
        vm.stopPrank();

        assertFalse(mock.hasRole(testRole, alice));
    }

    function test_renounceRole_Success_NonAdminRole_Admin() public {
        mock.grantRole(testRole, initialAdmin);
        mock.renounceRole(testRole, initialAdmin);

        assertFalse(mock.hasRole(testRole, initialAdmin));
    }

    // ============ setRoleAdmin ============

    function test_setRoleAdmin_Success_NonAdminRole_Self() public {
        mock.exposedSetRoleAdmin(testRole, defaultAdminRole);
        assertEq(mock.getRoleAdmin(testRole), defaultAdminRole);
    }

    function test_setRoleAdmin_Success_NonAdminRole_Other() public {
        bytes32 otherRole = mock.OTHER_ROLE();
        mock.exposedSetRoleAdmin(testRole, otherRole);
        assertEq(mock.getRoleAdmin(testRole), otherRole);
    }

    function test_setRoleAdmin_Revert_DefaultAdminRole() public {
        vm.expectRevert(abi.encodeWithSelector(IAccessControl2Step.AccessControlEnforcedDefaultAdminRules.selector));
        mock.exposedSetRoleAdmin(defaultAdminRole, testRole);
    }

    // ============ Storage ============

    function test_storageHash() public pure {
        assertEq(
            keccak256(abi.encode(uint256(keccak256("layerzerov2.storage.accesscontrol2step")) - 1)) &
                ~bytes32(uint256(0xff)),
            0x9ab055b8fb8e38b861ceee93a65f20f7a2382a86570a6abe934fe7edfac60400
        );
    }

    // ============ Fuzz ============

    function test_beginDefaultAdminTransfer_Fuzz(address _newAdmin) public {
        mock.beginDefaultAdminTransfer(_newAdmin);
        assertEq(mock.pendingDefaultAdmin(), _newAdmin);
        assertEq(mock.defaultAdmin(), initialAdmin);
    }

    function test_acceptDefaultAdminTransfer_Fuzz(address _newAdmin) public {
        vm.assume(_newAdmin != address(0));
        vm.assume(_newAdmin != proxyAdmin);
        vm.assume(_newAdmin != initialAdmin);

        mock.beginDefaultAdminTransfer(_newAdmin);
        vm.prank(_newAdmin);
        mock.acceptDefaultAdminTransfer();

        assertTrue(mock.hasRole(defaultAdminRole, _newAdmin));
        assertFalse(mock.hasRole(defaultAdminRole, initialAdmin));
        assertEq(mock.defaultAdmin(), _newAdmin);
        assertEq(mock.pendingDefaultAdmin(), address(0));
        assertEq(mock.getRoleMemberCount(defaultAdminRole), 1);
        assertEq(mock.getRoleMember(defaultAdminRole, 0), _newAdmin);
    }

    // ============ Edge Cases ============

    function test_acceptDefaultAdminTransfer_Revert_StalePendingAfterOverwrite() public {
        mock.beginDefaultAdminTransfer(alice);
        mock.beginDefaultAdminTransfer(bob); // Overwrite

        // `alice` (stale pending) cannot accept.
        vm.expectRevert(abi.encodeWithSelector(IAccessControl2Step.CallerNotPendingAdmin.selector, bob));
        vm.prank(alice);
        mock.acceptDefaultAdminTransfer();

        // `bob` (current pending) can accept.
        vm.prank(bob);
        mock.acceptDefaultAdminTransfer();

        assertTrue(mock.hasRole(defaultAdminRole, bob));
        assertFalse(mock.hasRole(defaultAdminRole, alice));
    }

    function test_acceptDefaultAdminTransfer_Revert_AfterCancel() public {
        mock.beginDefaultAdminTransfer(alice);
        mock.beginDefaultAdminTransfer(address(0)); // Cancel

        vm.expectRevert(abi.encodeWithSelector(IAccessControl2Step.CallerNotPendingAdmin.selector, address(0)));
        vm.prank(alice);
        mock.acceptDefaultAdminTransfer();
    }

    function test_acceptDefaultAdminTransfer_Events() public {
        mock.beginDefaultAdminTransfer(alice);

        vm.expectEmit(true, true, true, true, address(mock));
        emit IAccessControl.RoleRevoked(defaultAdminRole, initialAdmin, alice);
        vm.expectEmit(true, true, true, true, address(mock));
        emit IAccessControl.RoleGranted(defaultAdminRole, alice, alice);

        vm.prank(alice);
        mock.acceptDefaultAdminTransfer();
    }

    // ============ Integration ============

    function test_integration_TransferAndTransferAgain() public {
        // Admin transfers to `alice`.
        mock.beginDefaultAdminTransfer(alice);
        vm.prank(alice);
        mock.acceptDefaultAdminTransfer();

        // `alice` transfers to `bob`.
        vm.prank(alice);
        mock.beginDefaultAdminTransfer(bob);
        vm.prank(bob);
        mock.acceptDefaultAdminTransfer();

        // `bob` transfers to `charlie`.
        vm.prank(bob);
        mock.beginDefaultAdminTransfer(charlie);
        vm.prank(charlie);
        mock.acceptDefaultAdminTransfer();

        assertTrue(mock.hasRole(defaultAdminRole, charlie));
        assertFalse(mock.hasRole(defaultAdminRole, bob));
        assertFalse(mock.hasRole(defaultAdminRole, alice));
        assertFalse(mock.hasRole(defaultAdminRole, initialAdmin));
        assertEq(mock.getRoleMemberCount(defaultAdminRole), 1);
    }

    function test_integration_TransferCancelRetransfer() public {
        // Admin starts transfer to `alice` then cancels.
        mock.beginDefaultAdminTransfer(alice);
        mock.beginDefaultAdminTransfer(address(0)); // Cancel

        // Admin starts transfer to `bob` and `bob` accepts.
        mock.beginDefaultAdminTransfer(bob);
        vm.prank(bob);
        mock.acceptDefaultAdminTransfer();

        assertTrue(mock.hasRole(defaultAdminRole, bob));
        assertFalse(mock.hasRole(defaultAdminRole, initialAdmin));
        assertEq(mock.getRoleMemberCount(defaultAdminRole), 1);
    }
}
