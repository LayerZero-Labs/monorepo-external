// SPDX-License-Identifier: MIT
pragma solidity ^0.8.22;

import { IPause } from "@layerzerolabs/utils-evm-impl/contracts/interfaces/IPause.sol";
import { Initializable } from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import { IAccessControl } from "@openzeppelin/contracts/access/IAccessControl.sol";
import { TransparentUpgradeableProxy } from "@openzeppelin/contracts/proxy/transparent/TransparentUpgradeableProxy.sol";
import { PauseRBACUpgradeable } from "./../contracts/pause/PauseRBACUpgradeable.sol";
import { PauseBaseUpgradeableTest, IPauseTestHelper } from "./PauseBaseUpgradeable.t.sol";

contract PauseRBACUpgradeableMock is PauseRBACUpgradeable {
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

    /**
     * @dev Override parent test since `PauseRBACUpgradeableMock.initialize(address)` has a different signature.
     */
    function test_initialize_Revert_AlreadyInitialized() public override {
        vm.expectRevert(Initializable.InvalidInitialization.selector);
        PauseRBACUpgradeableMock(address(pauseHelper)).initialize(address(0x999));
    }

    function setUp() public override {
        PauseRBACUpgradeableMock impl = new PauseRBACUpgradeableMock();

        uint256 currentNonce = vm.getNonce(address(this));
        proxyAdmin = vm.computeCreateAddress(vm.computeCreateAddress(address(this), currentNonce), 1);

        TransparentUpgradeableProxy proxy = new TransparentUpgradeableProxy(
            address(impl),
            address(this),
            abi.encodeWithSelector(PauseRBACUpgradeableMock.initialize.selector, address(this))
        );
        pauseHelper = IPauseTestHelper(address(proxy));

        PauseRBACUpgradeableMock(address(pauseHelper)).grantRole(
            PauseRBACUpgradeableMock(address(pauseHelper)).PAUSER_ROLE(),
            address(this)
        );
        PauseRBACUpgradeableMock(address(pauseHelper)).grantRole(
            PauseRBACUpgradeableMock(address(pauseHelper)).UNPAUSER_ROLE(),
            address(this)
        );
    }

    function test_setPaused_Revert_Unauthorized() public {
        vm.expectRevert(
            abi.encodeWithSelector(
                IAccessControl.AccessControlUnauthorizedAccount.selector,
                alice,
                PauseRBACUpgradeableMock(address(pauseHelper)).PAUSER_ROLE()
            )
        );
        vm.prank(alice);
        PauseRBACUpgradeableMock(address(pauseHelper)).pause();
    }

    function test_setPaused_Success() public {
        PauseRBACUpgradeableMock(address(pauseHelper)).pause();
        assertTrue(pauseHelper.isPaused());
    }

    function test_roleTransfer_GrantAndRevoke() public {
        address newAdmin = address(0x123);

        PauseRBACUpgradeableMock(address(pauseHelper)).grantRole(
            PauseRBACUpgradeableMock(address(pauseHelper)).PAUSER_ROLE(),
            newAdmin
        );
        PauseRBACUpgradeableMock(address(pauseHelper)).grantRole(
            PauseRBACUpgradeableMock(address(pauseHelper)).UNPAUSER_ROLE(),
            newAdmin
        );

        PauseRBACUpgradeableMock(address(pauseHelper)).pause();

        vm.prank(newAdmin);
        PauseRBACUpgradeableMock(address(pauseHelper)).unpause();
        assertFalse(pauseHelper.isPaused());

        PauseRBACUpgradeableMock(address(pauseHelper)).revokeRole(
            PauseRBACUpgradeableMock(address(pauseHelper)).PAUSER_ROLE(),
            address(this)
        );

        vm.expectRevert(
            abi.encodeWithSelector(
                IAccessControl.AccessControlUnauthorizedAccount.selector,
                address(this),
                PauseRBACUpgradeableMock(address(pauseHelper)).PAUSER_ROLE()
            )
        );
        PauseRBACUpgradeableMock(address(pauseHelper)).pause();
    }

    function test_renounceRole_Success_FunctionsRevert() public {
        PauseRBACUpgradeableMock(address(pauseHelper)).renounceRole(
            PauseRBACUpgradeableMock(address(pauseHelper)).PAUSER_ROLE(),
            address(this)
        );

        vm.expectRevert(
            abi.encodeWithSelector(
                IAccessControl.AccessControlUnauthorizedAccount.selector,
                address(this),
                PauseRBACUpgradeableMock(address(pauseHelper)).PAUSER_ROLE()
            )
        );
        PauseRBACUpgradeableMock(address(pauseHelper)).pause();

        vm.expectRevert(
            abi.encodeWithSelector(
                IAccessControl.AccessControlUnauthorizedAccount.selector,
                alice,
                PauseRBACUpgradeableMock(address(pauseHelper)).PAUSER_ROLE()
            )
        );
        vm.prank(alice);
        PauseRBACUpgradeableMock(address(pauseHelper)).pause();
    }

    function test_multipleRoleGrants() public {
        address admin1 = address(0x111);
        address admin2 = address(0x222);
        address admin3 = address(0x333);

        PauseRBACUpgradeableMock(address(pauseHelper)).grantRole(
            PauseRBACUpgradeableMock(address(pauseHelper)).PAUSER_ROLE(),
            admin1
        );

        vm.prank(admin1);
        PauseRBACUpgradeableMock(address(pauseHelper)).pause();
        assertTrue(pauseHelper.isPaused());

        PauseRBACUpgradeableMock(address(pauseHelper)).grantRole(
            PauseRBACUpgradeableMock(address(pauseHelper)).PAUSER_ROLE(),
            admin2
        );
        PauseRBACUpgradeableMock(address(pauseHelper)).grantRole(
            PauseRBACUpgradeableMock(address(pauseHelper)).UNPAUSER_ROLE(),
            admin2
        );

        vm.prank(admin2);
        PauseRBACUpgradeableMock(address(pauseHelper)).unpause();
        assertFalse(pauseHelper.isPaused());

        vm.prank(admin1);
        PauseRBACUpgradeableMock(address(pauseHelper)).pause();
        assertTrue(pauseHelper.isPaused());

        PauseRBACUpgradeableMock(address(pauseHelper)).revokeRole(
            PauseRBACUpgradeableMock(address(pauseHelper)).PAUSER_ROLE(),
            admin1
        );

        vm.expectRevert(
            abi.encodeWithSelector(
                IAccessControl.AccessControlUnauthorizedAccount.selector,
                admin1,
                PauseRBACUpgradeableMock(address(pauseHelper)).UNPAUSER_ROLE()
            )
        );
        vm.prank(admin1);
        PauseRBACUpgradeableMock(address(pauseHelper)).unpause();

        PauseRBACUpgradeableMock(address(pauseHelper)).grantRole(
            PauseRBACUpgradeableMock(address(pauseHelper)).PAUSER_ROLE(),
            admin3
        );
        PauseRBACUpgradeableMock(address(pauseHelper)).grantRole(
            PauseRBACUpgradeableMock(address(pauseHelper)).UNPAUSER_ROLE(),
            admin3
        );

        vm.prank(admin3);
        PauseRBACUpgradeableMock(address(pauseHelper)).unpause();
        assertFalse(pauseHelper.isPaused());

        vm.prank(admin2);
        PauseRBACUpgradeableMock(address(pauseHelper)).pause();
        assertTrue(pauseHelper.isPaused());
    }

    function test_setPaused_Success_MultipleOperations() public {
        PauseRBACUpgradeableMock(address(pauseHelper)).pause();
        assertTrue(pauseHelper.isPaused());

        PauseRBACUpgradeableMock(address(pauseHelper)).unpause();
        assertFalse(pauseHelper.isPaused());

        PauseRBACUpgradeableMock(address(pauseHelper)).pause();
        assertTrue(pauseHelper.isPaused());

        PauseRBACUpgradeableMock(address(pauseHelper)).unpause();
        assertFalse(pauseHelper.isPaused());
    }

    function test_initialize_Revert_AlreadyInitialized_AdminUnchanged() public {
        vm.expectRevert(Initializable.InvalidInitialization.selector);
        PauseRBACUpgradeableMock(address(pauseHelper)).initialize(address(0x999));

        PauseRBACUpgradeableMock(address(pauseHelper)).pause();
        assertTrue(pauseHelper.isPaused());
    }

    function test_modifierEnforcement_WithRoles() public {
        PauseRBACUpgradeableMock mock = PauseRBACUpgradeableMock(address(pauseHelper));

        mock.functionWithModifier();
        assertEq(mock.callCount(), 1);

        PauseRBACUpgradeableMock(address(pauseHelper)).pause();

        vm.expectRevert(abi.encodeWithSelector(IPause.Paused.selector));
        mock.functionWithModifier();
        assertEq(mock.callCount(), 1);

        address newAdmin = address(0xabc);
        mock.grantRole(mock.PAUSER_ROLE(), newAdmin);
        mock.grantRole(mock.UNPAUSER_ROLE(), newAdmin);

        vm.expectRevert(abi.encodeWithSelector(IPause.Paused.selector));
        mock.functionWithModifier();
        assertEq(mock.callCount(), 1);

        vm.prank(newAdmin);
        PauseRBACUpgradeableMock(address(pauseHelper)).unpause();

        mock.functionWithModifier();
        assertEq(mock.callCount(), 2);
    }
}
