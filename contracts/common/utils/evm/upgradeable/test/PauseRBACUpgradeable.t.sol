// SPDX-License-Identifier: MIT
pragma solidity ^0.8.22;

import { IPause } from "@layerzerolabs/utils-evm-contracts/contracts/interfaces/IPause.sol";
import { Initializable } from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import { IAccessControl } from "@openzeppelin/contracts/access/IAccessControl.sol";
import { TransparentUpgradeableProxy } from "@openzeppelin/contracts/proxy/transparent/TransparentUpgradeableProxy.sol";
import { PauseRBACUpgradeable } from "./../contracts/pause/PauseRBACUpgradeable.sol";
import { PauseBaseUpgradeableTest, PauseBaseUpgradeableHarness } from "./PauseBaseUpgradeable.t.sol";

contract PauseRBACUpgradeableHarness is PauseRBACUpgradeable {
    uint256 public callCount;

    constructor() {
        _disableInitializers();
    }

    function initialize(address _initialAdmin) public initializer {
        __AccessControl2Step_init(_initialAdmin);
    }

    function assertNotPaused() public view {
        _assertNotPaused();
    }

    function functionWithModifier() public whenNotPaused {
        callCount++;
    }

    function functionWithModifierReturns() public view whenNotPaused returns (uint256) {
        return 42;
    }
}

contract PauseRBACUpgradeableTest is PauseBaseUpgradeableTest {
    address alice = makeAddr("alice");
    address proxyAdmin;
    PauseRBACUpgradeableHarness pauseRbac;

    /**
     * @dev Override parent test since `PauseRBACUpgradeableHarness.initialize(address)` has a different signature.
     */
    function test_initialize_Revert_AlreadyInitialized() public override {
        vm.expectRevert(Initializable.InvalidInitialization.selector);
        pauseRbac.initialize(address(0x999));
    }

    function _deployPause() internal virtual override returns (PauseBaseUpgradeableHarness) {
        PauseRBACUpgradeableHarness impl = new PauseRBACUpgradeableHarness();

        uint256 currentNonce = vm.getNonce(address(this));
        proxyAdmin = vm.computeCreateAddress(vm.computeCreateAddress(address(this), currentNonce), 1);

        TransparentUpgradeableProxy proxy = new TransparentUpgradeableProxy(
            address(impl),
            address(this),
            abi.encodeWithSelector(PauseRBACUpgradeableHarness.initialize.selector, address(this))
        );
        pauseRbac = PauseRBACUpgradeableHarness(address(proxy));
        return PauseBaseUpgradeableHarness(address(proxy));
    }

    function setUp() public override {
        super.setUp();

        pauseRbac.grantRole(pauseRbac.PAUSER_ROLE(), address(this));
        pauseRbac.grantRole(pauseRbac.UNPAUSER_ROLE(), address(this));
    }

    function test_setPaused_Revert_Unauthorized() public {
        vm.expectRevert(
            abi.encodeWithSelector(
                IAccessControl.AccessControlUnauthorizedAccount.selector,
                alice,
                pauseRbac.PAUSER_ROLE()
            )
        );
        vm.prank(alice);
        pauseRbac.pause();
    }

    function test_setPaused_Success() public {
        pauseRbac.pause();
        assertTrue(pause.isPaused());
    }

    function test_roleTransfer_GrantAndRevoke() public {
        address newAdmin = address(0x123);

        pauseRbac.grantRole(pauseRbac.PAUSER_ROLE(), newAdmin);
        pauseRbac.grantRole(pauseRbac.UNPAUSER_ROLE(), newAdmin);

        pauseRbac.pause();

        vm.prank(newAdmin);
        pauseRbac.unpause();
        assertFalse(pause.isPaused());

        pauseRbac.revokeRole(pauseRbac.PAUSER_ROLE(), address(this));

        vm.expectRevert(
            abi.encodeWithSelector(
                IAccessControl.AccessControlUnauthorizedAccount.selector,
                address(this),
                pauseRbac.PAUSER_ROLE()
            )
        );
        pauseRbac.pause();
    }

    function test_renounceRole_Success_FunctionsRevert() public {
        pauseRbac.renounceRole(pauseRbac.PAUSER_ROLE(), address(this));

        vm.expectRevert(
            abi.encodeWithSelector(
                IAccessControl.AccessControlUnauthorizedAccount.selector,
                address(this),
                pauseRbac.PAUSER_ROLE()
            )
        );
        pauseRbac.pause();

        vm.expectRevert(
            abi.encodeWithSelector(
                IAccessControl.AccessControlUnauthorizedAccount.selector,
                alice,
                pauseRbac.PAUSER_ROLE()
            )
        );
        vm.prank(alice);
        pauseRbac.pause();
    }

    function test_multipleRoleGrants() public {
        address admin1 = address(0x111);
        address admin2 = address(0x222);
        address admin3 = address(0x333);

        pauseRbac.grantRole(pauseRbac.PAUSER_ROLE(), admin1);

        vm.prank(admin1);
        pauseRbac.pause();
        assertTrue(pause.isPaused());

        pauseRbac.grantRole(pauseRbac.PAUSER_ROLE(), admin2);
        pauseRbac.grantRole(pauseRbac.UNPAUSER_ROLE(), admin2);

        vm.prank(admin2);
        pauseRbac.unpause();
        assertFalse(pause.isPaused());

        vm.prank(admin1);
        pauseRbac.pause();
        assertTrue(pause.isPaused());

        pauseRbac.revokeRole(pauseRbac.PAUSER_ROLE(), admin1);

        vm.expectRevert(
            abi.encodeWithSelector(
                IAccessControl.AccessControlUnauthorizedAccount.selector,
                admin1,
                pauseRbac.UNPAUSER_ROLE()
            )
        );
        vm.prank(admin1);
        pauseRbac.unpause();

        pauseRbac.grantRole(pauseRbac.PAUSER_ROLE(), admin3);
        pauseRbac.grantRole(pauseRbac.UNPAUSER_ROLE(), admin3);

        vm.prank(admin3);
        pauseRbac.unpause();
        assertFalse(pause.isPaused());

        vm.prank(admin2);
        pauseRbac.pause();
        assertTrue(pause.isPaused());
    }

    function test_setPaused_Success_MultipleOperations() public {
        pauseRbac.pause();
        assertTrue(pause.isPaused());

        pauseRbac.unpause();
        assertFalse(pause.isPaused());

        pauseRbac.pause();
        assertTrue(pause.isPaused());

        pauseRbac.unpause();
        assertFalse(pause.isPaused());
    }

    function test_initialize_Revert_AlreadyInitialized_AdminUnchanged() public {
        vm.expectRevert(Initializable.InvalidInitialization.selector);
        pauseRbac.initialize(address(0x999));

        pauseRbac.pause();
        assertTrue(pause.isPaused());
    }

    function test_modifierEnforcement_WithRoles() public {
        pauseRbac.functionWithModifier();
        assertEq(pauseRbac.callCount(), 1);

        pauseRbac.pause();

        vm.expectRevert(abi.encodeWithSelector(IPause.Paused.selector));
        pauseRbac.functionWithModifier();
        assertEq(pauseRbac.callCount(), 1);

        address newAdmin = address(0xabc);
        pauseRbac.grantRole(pauseRbac.PAUSER_ROLE(), newAdmin);
        pauseRbac.grantRole(pauseRbac.UNPAUSER_ROLE(), newAdmin);

        vm.expectRevert(abi.encodeWithSelector(IPause.Paused.selector));
        pauseRbac.functionWithModifier();
        assertEq(pauseRbac.callCount(), 1);

        vm.prank(newAdmin);
        pauseRbac.unpause();

        pauseRbac.functionWithModifier();
        assertEq(pauseRbac.callCount(), 2);
    }
}
