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

contract AccessControl2StepUpgradeableHarness is AccessControl2StepUpgradeable {
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
    AccessControl2StepUpgradeableHarness accessControl;

    address initialAdmin = address(this);
    address alice = makeAddr("alice");
    address bob = makeAddr("bob");
    address charlie = makeAddr("charlie");
    address proxyAdmin;

    bytes32 defaultAdminRole;
    bytes32 testRole;

    function _deployAccessControl() internal returns (AccessControl2StepUpgradeableHarness) {
        AccessControl2StepUpgradeableHarness impl = new AccessControl2StepUpgradeableHarness();

        uint256 currentNonce = vm.getNonce(address(this));
        proxyAdmin = vm.computeCreateAddress(vm.computeCreateAddress(address(this), currentNonce), 1);

        TransparentUpgradeableProxy proxy = new TransparentUpgradeableProxy(
            address(impl),
            address(this),
            abi.encodeWithSelector(AccessControl2StepUpgradeableHarness.initialize.selector, address(this))
        );
        return AccessControl2StepUpgradeableHarness(address(proxy));
    }

    function setUp() public {
        accessControl = _deployAccessControl();
        defaultAdminRole = accessControl.DEFAULT_ADMIN_ROLE();
        testRole = accessControl.TEST_ROLE();
    }

    // ============ Initialization ============

    function test_initialize_Success_AdminHasRole() public view {
        assertTrue(accessControl.hasRole(defaultAdminRole, initialAdmin));
        assertEq(accessControl.getRoleMemberCount(defaultAdminRole), 1);
        assertEq(accessControl.getRoleMember(defaultAdminRole, 0), initialAdmin);
        assertEq(accessControl.defaultAdmin(), initialAdmin);
    }

    function test_initialize_Revert_AlreadyInitialized() public {
        vm.expectRevert(Initializable.InvalidInitialization.selector);
        accessControl.initialize(address(0x999));
    }

    function test_initialize_Revert_InvalidDefaultAdmin() public {
        AccessControl2StepUpgradeableHarness impl = new AccessControl2StepUpgradeableHarness();
        vm.expectRevert(abi.encodeWithSelector(IAccessControl2Step.InvalidDefaultAdmin.selector, address(0)));
        new TransparentUpgradeableProxy(
            address(impl),
            address(this),
            abi.encodeWithSelector(AccessControl2StepUpgradeableHarness.initialize.selector, address(0))
        );
    }

    // ============ defaultAdmin ============

    function test_defaultAdmin_ReturnsInitialAdmin() public view {
        assertEq(accessControl.defaultAdmin(), initialAdmin);
    }

    // ============ pendingDefaultAdmin ============

    function test_pendingDefaultAdmin_InitiallyZero() public view {
        assertEq(accessControl.pendingDefaultAdmin(), address(0));
    }

    // ============ beginDefaultAdminTransfer ============

    function test_beginDefaultAdminTransfer_Success() public {
        vm.expectEmit(true, true, true, true, address(accessControl));
        emit IAccessControl2Step.DefaultAdminTransferStarted(alice);

        accessControl.beginDefaultAdminTransfer(alice);

        assertEq(accessControl.pendingDefaultAdmin(), alice);
        assertEq(accessControl.defaultAdmin(), initialAdmin);
    }

    function test_beginDefaultAdminTransfer_Success_OverwritesPending() public {
        accessControl.beginDefaultAdminTransfer(alice);
        assertEq(accessControl.pendingDefaultAdmin(), alice);

        accessControl.beginDefaultAdminTransfer(bob);
        assertEq(accessControl.pendingDefaultAdmin(), bob);
    }

    function test_beginDefaultAdminTransfer_Success_CancelsBySettingZero() public {
        accessControl.beginDefaultAdminTransfer(alice);
        assertEq(accessControl.pendingDefaultAdmin(), alice);

        vm.expectEmit(true, true, true, true, address(accessControl));
        emit IAccessControl2Step.DefaultAdminTransferStarted(address(0));

        accessControl.beginDefaultAdminTransfer(address(0));
        assertEq(accessControl.pendingDefaultAdmin(), address(0));
    }

    function test_beginDefaultAdminTransfer_Revert_Unauthorized() public {
        vm.expectRevert(
            abi.encodeWithSelector(IAccessControl.AccessControlUnauthorizedAccount.selector, alice, defaultAdminRole)
        );
        vm.prank(alice);
        accessControl.beginDefaultAdminTransfer(bob);
    }

    // ============ acceptDefaultAdminTransfer ============

    function test_acceptDefaultAdminTransfer_Success() public {
        accessControl.beginDefaultAdminTransfer(alice);

        vm.prank(alice);
        accessControl.acceptDefaultAdminTransfer();

        assertTrue(accessControl.hasRole(defaultAdminRole, alice));
        assertFalse(accessControl.hasRole(defaultAdminRole, initialAdmin));
        assertEq(accessControl.getRoleMemberCount(defaultAdminRole), 1);
        assertEq(accessControl.getRoleMember(defaultAdminRole, 0), alice);
        assertEq(accessControl.defaultAdmin(), alice);
        assertEq(accessControl.pendingDefaultAdmin(), address(0));
    }

    function test_acceptDefaultAdminTransfer_Revert_NotPendingAdmin() public {
        accessControl.beginDefaultAdminTransfer(alice);

        vm.expectRevert(abi.encodeWithSelector(IAccessControl2Step.CallerNotPendingAdmin.selector, alice));
        vm.prank(bob);
        accessControl.acceptDefaultAdminTransfer();
    }

    function test_acceptDefaultAdminTransfer_Revert_NoPendingTransfer() public {
        vm.expectRevert(abi.encodeWithSelector(IAccessControl2Step.CallerNotPendingAdmin.selector, address(0)));
        vm.prank(alice);
        accessControl.acceptDefaultAdminTransfer();
    }

    // ============ grantRole ============

    function test_grantRole_Revert_DefaultAdminRole() public {
        vm.expectRevert(abi.encodeWithSelector(IAccessControl2Step.AccessControlEnforcedDefaultAdminRules.selector));
        accessControl.grantRole(defaultAdminRole, alice);
    }

    function test_grantRole_Success_NonAdminRole() public {
        accessControl.grantRole(testRole, alice);
        assertTrue(accessControl.hasRole(testRole, alice));
    }

    // ============ revokeRole ============

    function test_revokeRole_Revert_DefaultAdminRole_NonAdmin() public {
        vm.expectRevert(
            abi.encodeWithSelector(IAccessControl.AccessControlUnauthorizedAccount.selector, alice, defaultAdminRole)
        );
        vm.prank(alice);
        accessControl.revokeRole(defaultAdminRole, initialAdmin);
    }

    function test_revokeRole_Revert_DefaultAdminRole_Admin() public {
        vm.expectRevert(abi.encodeWithSelector(IAccessControl2Step.AccessControlEnforcedDefaultAdminRules.selector));
        accessControl.revokeRole(defaultAdminRole, initialAdmin);
    }

    function test_revokeRole_Success_NonAdminRole_Admin() public {
        accessControl.grantRole(testRole, alice);
        assertTrue(accessControl.hasRole(testRole, alice));

        accessControl.revokeRole(testRole, alice);
        assertFalse(accessControl.hasRole(testRole, alice));
    }

    function test_revokeRole_Revert_NonAdminRole_NonAdmin() public {
        accessControl.grantRole(testRole, alice);
        assertTrue(accessControl.hasRole(testRole, alice));

        vm.expectRevert(
            abi.encodeWithSelector(IAccessControl.AccessControlUnauthorizedAccount.selector, alice, defaultAdminRole)
        );
        vm.prank(alice);
        accessControl.revokeRole(testRole, alice);
    }

    // ============ renounceRole ============

    function test_renounceRole_Revert_DefaultAdminRole() public {
        vm.expectRevert(abi.encodeWithSelector(IAccessControl2Step.AccessControlEnforcedDefaultAdminRules.selector));
        accessControl.renounceRole(defaultAdminRole, initialAdmin);
    }

    function test_renounceRole_Revert_DefaultAdminRoleDuringPendingTransfer() public {
        accessControl.beginDefaultAdminTransfer(alice);

        vm.expectRevert(abi.encodeWithSelector(IAccessControl2Step.AccessControlEnforcedDefaultAdminRules.selector));
        accessControl.renounceRole(defaultAdminRole, initialAdmin);
    }

    function test_renounceRole_Success_NonAdminRole_NonAdmin() public {
        accessControl.grantRole(testRole, alice);

        vm.startPrank(alice);
        accessControl.renounceRole(testRole, alice);
        vm.stopPrank();

        assertFalse(accessControl.hasRole(testRole, alice));
    }

    function test_renounceRole_Success_NonAdminRole_Admin() public {
        accessControl.grantRole(testRole, initialAdmin);
        accessControl.renounceRole(testRole, initialAdmin);

        assertFalse(accessControl.hasRole(testRole, initialAdmin));
    }

    // ============ setRoleAdmin ============

    function test_setRoleAdmin_Success_NonAdminRole_Self() public {
        accessControl.exposedSetRoleAdmin(testRole, defaultAdminRole);
        assertEq(accessControl.getRoleAdmin(testRole), defaultAdminRole);
    }

    function test_setRoleAdmin_Success_NonAdminRole_Other() public {
        bytes32 otherRole = accessControl.OTHER_ROLE();
        accessControl.exposedSetRoleAdmin(testRole, otherRole);
        assertEq(accessControl.getRoleAdmin(testRole), otherRole);
    }

    function test_setRoleAdmin_Revert_DefaultAdminRole() public {
        vm.expectRevert(abi.encodeWithSelector(IAccessControl2Step.AccessControlEnforcedDefaultAdminRules.selector));
        accessControl.exposedSetRoleAdmin(defaultAdminRole, testRole);
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
        accessControl.beginDefaultAdminTransfer(_newAdmin);
        assertEq(accessControl.pendingDefaultAdmin(), _newAdmin);
        assertEq(accessControl.defaultAdmin(), initialAdmin);
    }

    function test_acceptDefaultAdminTransfer_Fuzz(address _newAdmin) public {
        vm.assume(_newAdmin != address(0));
        vm.assume(_newAdmin != proxyAdmin);
        vm.assume(_newAdmin != initialAdmin);

        accessControl.beginDefaultAdminTransfer(_newAdmin);
        vm.prank(_newAdmin);
        accessControl.acceptDefaultAdminTransfer();

        assertTrue(accessControl.hasRole(defaultAdminRole, _newAdmin));
        assertFalse(accessControl.hasRole(defaultAdminRole, initialAdmin));
        assertEq(accessControl.defaultAdmin(), _newAdmin);
        assertEq(accessControl.pendingDefaultAdmin(), address(0));
        assertEq(accessControl.getRoleMemberCount(defaultAdminRole), 1);
        assertEq(accessControl.getRoleMember(defaultAdminRole, 0), _newAdmin);
    }

    // ============ Edge Cases ============

    function test_acceptDefaultAdminTransfer_Revert_StalePendingAfterOverwrite() public {
        accessControl.beginDefaultAdminTransfer(alice);
        accessControl.beginDefaultAdminTransfer(bob); // Overwrite

        // `alice` (stale pending) cannot accept.
        vm.expectRevert(abi.encodeWithSelector(IAccessControl2Step.CallerNotPendingAdmin.selector, bob));
        vm.prank(alice);
        accessControl.acceptDefaultAdminTransfer();

        // `bob` (current pending) can accept.
        vm.prank(bob);
        accessControl.acceptDefaultAdminTransfer();

        assertTrue(accessControl.hasRole(defaultAdminRole, bob));
        assertFalse(accessControl.hasRole(defaultAdminRole, alice));
    }

    function test_acceptDefaultAdminTransfer_Revert_AfterCancel() public {
        accessControl.beginDefaultAdminTransfer(alice);
        accessControl.beginDefaultAdminTransfer(address(0)); // Cancel

        vm.expectRevert(abi.encodeWithSelector(IAccessControl2Step.CallerNotPendingAdmin.selector, address(0)));
        vm.prank(alice);
        accessControl.acceptDefaultAdminTransfer();
    }

    function test_acceptDefaultAdminTransfer_Events() public {
        accessControl.beginDefaultAdminTransfer(alice);

        vm.expectEmit(true, true, true, true, address(accessControl));
        emit IAccessControl.RoleRevoked(defaultAdminRole, initialAdmin, alice);
        vm.expectEmit(true, true, true, true, address(accessControl));
        emit IAccessControl.RoleGranted(defaultAdminRole, alice, alice);

        vm.prank(alice);
        accessControl.acceptDefaultAdminTransfer();
    }

    // ============ Integration ============

    function test_integration_TransferAndTransferAgain() public {
        // Admin transfers to `alice`.
        accessControl.beginDefaultAdminTransfer(alice);
        vm.prank(alice);
        accessControl.acceptDefaultAdminTransfer();

        // `alice` transfers to `bob`.
        vm.prank(alice);
        accessControl.beginDefaultAdminTransfer(bob);
        vm.prank(bob);
        accessControl.acceptDefaultAdminTransfer();

        // `bob` transfers to `charlie`.
        vm.prank(bob);
        accessControl.beginDefaultAdminTransfer(charlie);
        vm.prank(charlie);
        accessControl.acceptDefaultAdminTransfer();

        assertTrue(accessControl.hasRole(defaultAdminRole, charlie));
        assertFalse(accessControl.hasRole(defaultAdminRole, bob));
        assertFalse(accessControl.hasRole(defaultAdminRole, alice));
        assertFalse(accessControl.hasRole(defaultAdminRole, initialAdmin));
        assertEq(accessControl.getRoleMemberCount(defaultAdminRole), 1);
    }

    function test_integration_TransferCancelRetransfer() public {
        // Admin starts transfer to `alice` then cancels.
        accessControl.beginDefaultAdminTransfer(alice);
        accessControl.beginDefaultAdminTransfer(address(0)); // Cancel

        // Admin starts transfer to `bob` and `bob` accepts.
        accessControl.beginDefaultAdminTransfer(bob);
        vm.prank(bob);
        accessControl.acceptDefaultAdminTransfer();

        assertTrue(accessControl.hasRole(defaultAdminRole, bob));
        assertFalse(accessControl.hasRole(defaultAdminRole, initialAdmin));
        assertEq(accessControl.getRoleMemberCount(defaultAdminRole), 1);
    }
}
