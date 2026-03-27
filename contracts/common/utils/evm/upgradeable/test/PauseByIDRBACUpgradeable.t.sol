// SPDX-License-Identifier: MIT
pragma solidity ^0.8.22;

import { IPauseByID } from "@layerzerolabs/utils-evm-impl/contracts/interfaces/IPauseByID.sol";
import { Initializable } from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import { IAccessControl } from "@openzeppelin/contracts/access/IAccessControl.sol";
import { ERC1967Utils } from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Utils.sol";
import { TransparentUpgradeableProxy } from "@openzeppelin/contracts/proxy/transparent/TransparentUpgradeableProxy.sol";
import { PauseByIDRBACUpgradeable } from "./../contracts/pause-by-id/PauseByIDRBACUpgradeable.sol";
import { PauseByIDBaseUpgradeableTest, IPauseByIDBaseMock } from "./PauseByIDBaseUpgradeable.t.sol";

contract PauseByIDRBACUpgradeableMock is PauseByIDRBACUpgradeable {
    uint256 public callCount;

    constructor() {
        _disableInitializers();
    }

    function initialize(address _initialAdmin) public initializer {
        __AccessControl2Step_init(_initialAdmin);
        _grantRole(PAUSER_ROLE, _initialAdmin);
        _grantRole(UNPAUSER_ROLE, _initialAdmin);
    }

    function assertNotPaused(uint256 _id) public view {
        _assertNotPaused(_id);
    }

    function functionWithModifier(uint256 _id) public whenNotPaused(_id) {
        callCount++;
    }

    function functionWithModifierReturns(uint256 _id) public view whenNotPaused(_id) returns (uint256) {
        return 42;
    }
}

contract PauseByIDRBACUpgradeableTest is PauseByIDBaseUpgradeableTest {
    address alice = makeAddr("alice");
    address proxyAdmin;

    function _createPause() internal virtual override returns (IPauseByIDBaseMock) {
        PauseByIDRBACUpgradeableMock impl = new PauseByIDRBACUpgradeableMock();

        uint256 currentNonce = vm.getNonce(address(this));
        proxyAdmin = vm.computeCreateAddress(vm.computeCreateAddress(address(this), currentNonce), 1);

        TransparentUpgradeableProxy proxy = new TransparentUpgradeableProxy(
            address(impl),
            address(this),
            abi.encodeWithSelector(PauseByIDRBACUpgradeableMock.initialize.selector, address(this))
        );

        bytes32 adminSlot = vm.load(address(proxy), ERC1967Utils.ADMIN_SLOT);
        proxyAdmin = address(uint160(uint256(adminSlot)));

        return IPauseByIDBaseMock(address(proxy));
    }

    function setUp() public override {
        pauseHelper = _createPause();
    }

    /// @dev `PauseByIDRBACUpgradeableMock.initialize(address)` has a different signature.
    function test_initialize_Revert_AlreadyInitialized() public virtual override {
        vm.expectRevert(Initializable.InvalidInitialization.selector);
        PauseByIDRBACUpgradeableMock(address(pauseHelper)).initialize(alice);
    }

    function test_setDefaultPaused_Success() public {
        pauseHelper.setDefaultPaused(true);
        assertTrue(pauseHelper.defaultPaused());
    }

    function test_setDefaultPaused_Revert_Unauthorized() public {
        bytes32 pauserRole = PauseByIDRBACUpgradeableMock(address(pauseHelper)).PAUSER_ROLE();
        vm.expectRevert(
            abi.encodeWithSelector(IAccessControl.AccessControlUnauthorizedAccount.selector, alice, pauserRole)
        );
        vm.prank(alice);
        pauseHelper.setDefaultPaused(true);
    }

    function test_setPaused_Success() public {
        IPauseByID.SetPausedParam[] memory params = new IPauseByID.SetPausedParam[](1);
        params[0] = IPauseByID.SetPausedParam(1, true, true);
        pauseHelper.setPaused(params);
        assertTrue(pauseHelper.isPaused(1));
    }

    function test_setPaused_Revert_Unauthorized() public {
        IPauseByID.SetPausedParam[] memory params = new IPauseByID.SetPausedParam[](1);
        params[0] = IPauseByID.SetPausedParam(1, true, true);

        bytes32 pauserRole = PauseByIDRBACUpgradeableMock(address(pauseHelper)).PAUSER_ROLE();
        vm.expectRevert(
            abi.encodeWithSelector(IAccessControl.AccessControlUnauthorizedAccount.selector, alice, pauserRole)
        );
        vm.prank(alice);
        pauseHelper.setPaused(params);
    }

    function test_setPaused_Success_Batch() public {
        pauseHelper.setDefaultPaused(true);
        assertTrue(pauseHelper.defaultPaused());

        IPauseByID.SetPausedParam[] memory params = new IPauseByID.SetPausedParam[](1);
        params[0] = IPauseByID.SetPausedParam(1, false, true);
        pauseHelper.setPaused(params);
        assertFalse(pauseHelper.isPaused(1));

        params[0] = IPauseByID.SetPausedParam(2, true, true);
        pauseHelper.setPaused(params);
        assertTrue(pauseHelper.isPaused(2));

        pauseHelper.setDefaultPaused(false);
        assertFalse(pauseHelper.defaultPaused());

        IPauseByID.SetPausedParam[] memory batchParams = new IPauseByID.SetPausedParam[](10);
        for (uint32 i = 0; i < 10; i++) {
            batchParams[i] = IPauseByID.SetPausedParam(i + 10, (i + 10) % 2 == 0, true);
        }
        pauseHelper.setPaused(batchParams);
    }

    function test_setPaused_Revert_UnpauserCannotCauseEffectivePause() public {
        // `defaultPaused=true` and `enabled=false`.
        PauseByIDRBACUpgradeableMock mock = PauseByIDRBACUpgradeableMock(address(pauseHelper));
        bytes32 pauserRole = mock.PAUSER_ROLE();
        bytes32 unpauserRole = mock.UNPAUSER_ROLE();

        // Set default to paused.
        pauseHelper.setDefaultPaused(true);

        // Grant only `UNPAUSER_ROLE` to `alice`.
        mock.grantRole(unpauserRole, alice);

        // `alice` tries to set `enabled=false` with `paused=false` — effective state is paused.
        IPauseByID.SetPausedParam[] memory params = new IPauseByID.SetPausedParam[](1);
        params[0] = IPauseByID.SetPausedParam(1, false, false);

        vm.expectRevert(
            abi.encodeWithSelector(IAccessControl.AccessControlUnauthorizedAccount.selector, alice, pauserRole)
        );
        vm.prank(alice);
        pauseHelper.setPaused(params);
    }

    function test_setPaused_Revert_PauserCannotCauseEffectiveUnpause() public {
        // `defaultPaused=false` and `enabled=false`.
        PauseByIDRBACUpgradeableMock mock = PauseByIDRBACUpgradeableMock(address(pauseHelper));
        bytes32 pauserRole = mock.PAUSER_ROLE();
        bytes32 unpauserRole = mock.UNPAUSER_ROLE();

        // Default is already false (unpaused).
        assertFalse(pauseHelper.defaultPaused());

        // Grant only `PAUSER_ROLE` to `alice`.
        mock.grantRole(pauserRole, alice);

        // `alice` tries to set `enabled=false` with `paused=true` — effective state is unpaused.
        IPauseByID.SetPausedParam[] memory params = new IPauseByID.SetPausedParam[](1);
        params[0] = IPauseByID.SetPausedParam(1, true, false);

        vm.expectRevert(
            abi.encodeWithSelector(IAccessControl.AccessControlUnauthorizedAccount.selector, alice, unpauserRole)
        );
        vm.prank(alice);
        pauseHelper.setPaused(params);
    }

    function test_setPaused_Success_PauserCanSetDisabledWhenDefaultPaused() public {
        // `defaultPaused=true` and `enabled=false`.
        PauseByIDRBACUpgradeableMock mock = PauseByIDRBACUpgradeableMock(address(pauseHelper));
        bytes32 pauserRole = mock.PAUSER_ROLE();

        // Set default to paused.
        pauseHelper.setDefaultPaused(true);

        // Grant only `PAUSER_ROLE` to `alice`.
        mock.grantRole(pauserRole, alice);

        // `alice` sets `enabled=false` — effective state is paused, so `PAUSER_ROLE` suffices.
        IPauseByID.SetPausedParam[] memory params = new IPauseByID.SetPausedParam[](1);
        params[0] = IPauseByID.SetPausedParam(1, false, false);

        vm.prank(alice);
        pauseHelper.setPaused(params);

        assertTrue(pauseHelper.isPaused(1));
    }

    function test_setPaused_Success_UnpauserCanSetDisabledWhenDefaultUnpaused() public {
        PauseByIDRBACUpgradeableMock mock = PauseByIDRBACUpgradeableMock(address(pauseHelper));
        bytes32 unpauserRole = mock.UNPAUSER_ROLE();

        // Default is already false (unpaused).
        assertFalse(pauseHelper.defaultPaused());

        // Grant only `UNPAUSER_ROLE` to `alice`.
        mock.grantRole(unpauserRole, alice);

        // `alice` sets `enabled=false` — effective state is unpaused (from default), so `UNPAUSER_ROLE` suffices.
        IPauseByID.SetPausedParam[] memory params = new IPauseByID.SetPausedParam[](1);
        params[0] = IPauseByID.SetPausedParam(1, true, false);

        vm.prank(alice);
        pauseHelper.setPaused(params);

        assertFalse(pauseHelper.isPaused(1));
    }

    function test_setPaused_Revert_MixedBatchWithDisabledConfigs_NeedsBothRoles() public {
        PauseByIDRBACUpgradeableMock mock = PauseByIDRBACUpgradeableMock(address(pauseHelper));
        bytes32 pauserRole = mock.PAUSER_ROLE();
        bytes32 unpauserRole = mock.UNPAUSER_ROLE();

        // Set default to paused.
        pauseHelper.setDefaultPaused(true);

        // Grant only `PAUSER_ROLE` to `alice`.
        mock.grantRole(pauserRole, alice);

        // Batch: one explicitly unpauses (`enabled=true`, `paused=false`), one falls back to default paused (`enabled=false`).
        IPauseByID.SetPausedParam[] memory params = new IPauseByID.SetPausedParam[](2);
        params[0] = IPauseByID.SetPausedParam(1, false, true); // effective: unpaused → needs `UNPAUSER_ROLE`
        params[1] = IPauseByID.SetPausedParam(2, false, false); // effective: paused (default) → needs `PAUSER_ROLE`

        vm.expectRevert(
            abi.encodeWithSelector(IAccessControl.AccessControlUnauthorizedAccount.selector, alice, unpauserRole)
        );
        vm.prank(alice);
        pauseHelper.setPaused(params);
    }

    function test_setPaused_Success_MixedBatchWithDisabledConfigs_BothRoles() public {
        PauseByIDRBACUpgradeableMock mock = PauseByIDRBACUpgradeableMock(address(pauseHelper));
        bytes32 pauserRole = mock.PAUSER_ROLE();
        bytes32 unpauserRole = mock.UNPAUSER_ROLE();

        // Set default to paused.
        pauseHelper.setDefaultPaused(true);

        // Grant both roles to `alice`.
        mock.grantRole(pauserRole, alice);
        mock.grantRole(unpauserRole, alice);

        // Batch: one explicitly unpauses, one falls back to default paused.
        IPauseByID.SetPausedParam[] memory params = new IPauseByID.SetPausedParam[](2);
        params[0] = IPauseByID.SetPausedParam(1, false, true); // effective: unpaused
        params[1] = IPauseByID.SetPausedParam(2, false, false); // effective: paused (default)

        vm.prank(alice);
        pauseHelper.setPaused(params);

        assertFalse(pauseHelper.isPaused(1));
        assertTrue(pauseHelper.isPaused(2));
    }

    /// @dev Dormant data planted by one role cannot be activated without the other role.
    function test_setPaused_DormantData() public {
        PauseByIDRBACUpgradeableMock mock = PauseByIDRBACUpgradeableMock(address(pauseHelper));
        bytes32 pauserRole = mock.PAUSER_ROLE();
        bytes32 unpauserRole = mock.UNPAUSER_ROLE();

        address frank = address(0x456);
        mock.grantRole(unpauserRole, alice);
        mock.grantRole(pauserRole, frank);

        // `defaultPaused=false`. `UNPAUSER_ROLE` stores dormant `paused=true` (`enabled=false`).
        IPauseByID.SetPausedParam[] memory params = new IPauseByID.SetPausedParam[](1);
        params[0] = IPauseByID.SetPausedParam(1, true, false);
        vm.prank(alice);
        pauseHelper.setPaused(params);
        assertFalse(pauseHelper.isPaused(1));
        assertTrue(pauseHelper.pauseConfig(1).paused);

        // `UNPAUSER_ROLE` cannot activate dormant `paused=true`.
        params[0] = IPauseByID.SetPausedParam(1, true, true);
        vm.expectRevert(
            abi.encodeWithSelector(IAccessControl.AccessControlUnauthorizedAccount.selector, alice, pauserRole)
        );
        vm.prank(alice);
        pauseHelper.setPaused(params);

        // `PAUSER_ROLE` can activate it.
        vm.prank(frank);
        pauseHelper.setPaused(params);
        assertTrue(pauseHelper.isPaused(1));

        // Symmetric: `defaultPaused=true`. `PAUSER_ROLE` stores dormant `paused=false` (`enabled=false`).
        pauseHelper.setDefaultPaused(true);
        params[0] = IPauseByID.SetPausedParam(2, false, false);
        vm.prank(frank);
        pauseHelper.setPaused(params);
        assertTrue(pauseHelper.isPaused(2));

        // `PAUSER_ROLE` cannot activate dormant `paused=false`.
        params[0] = IPauseByID.SetPausedParam(2, false, true);
        vm.expectRevert(
            abi.encodeWithSelector(IAccessControl.AccessControlUnauthorizedAccount.selector, frank, unpauserRole)
        );
        vm.prank(frank);
        pauseHelper.setPaused(params);

        // `UNPAUSER_ROLE` can activate it.
        vm.prank(alice);
        pauseHelper.setPaused(params);
        assertFalse(pauseHelper.isPaused(2));
    }

    function test_setPaused_EmptyArrayWithUnpauserRole() public {
        PauseByIDRBACUpgradeableMock mock = PauseByIDRBACUpgradeableMock(address(pauseHelper));

        mock.grantRole(mock.UNPAUSER_ROLE(), alice);

        IPauseByID.SetPausedParam[] memory params = new IPauseByID.SetPausedParam[](0);

        vm.prank(alice);
        pauseHelper.setPaused(params);
    }

    function test_setPaused_Revert_EmptyArrayUnauthorized() public {
        PauseByIDRBACUpgradeableMock mock = PauseByIDRBACUpgradeableMock(address(pauseHelper));
        bytes32 unpauserRole = mock.UNPAUSER_ROLE();

        IPauseByID.SetPausedParam[] memory params = new IPauseByID.SetPausedParam[](0);

        vm.expectRevert(
            abi.encodeWithSelector(IAccessControl.AccessControlUnauthorizedAccount.selector, alice, unpauserRole)
        );
        vm.prank(alice);
        pauseHelper.setPaused(params);
    }

    /// @dev Correct role succeeds, wrong role reverts, for all effective-state combinations.
    function test_setPaused_Fuzz_EffectiveStateRoleCheck(bool _defaultPaused, bool _paused, bool _enabled) public {
        PauseByIDRBACUpgradeableMock mock = PauseByIDRBACUpgradeableMock(address(pauseHelper));
        bytes32 pauserRole = mock.PAUSER_ROLE();
        bytes32 unpauserRole = mock.UNPAUSER_ROLE();

        if (_defaultPaused) {
            pauseHelper.setDefaultPaused(true);
        }

        bool effectivePaused = _enabled ? _paused : _defaultPaused;

        IPauseByID.SetPausedParam[] memory params = new IPauseByID.SetPausedParam[](1);
        params[0] = IPauseByID.SetPausedParam(1, _paused, _enabled);

        // Wrong role reverts.
        address wrongCaller = address(0xBAD);
        if (effectivePaused) {
            mock.grantRole(unpauserRole, wrongCaller);
        } else {
            mock.grantRole(pauserRole, wrongCaller);
        }
        bytes32 missingRole = effectivePaused ? pauserRole : unpauserRole;
        vm.expectRevert(
            abi.encodeWithSelector(IAccessControl.AccessControlUnauthorizedAccount.selector, wrongCaller, missingRole)
        );
        vm.prank(wrongCaller);
        pauseHelper.setPaused(params);

        // Correct role succeeds.
        if (effectivePaused) {
            mock.grantRole(pauserRole, alice);
        } else {
            mock.grantRole(unpauserRole, alice);
        }
        vm.prank(alice);
        pauseHelper.setPaused(params);
        assertEq(pauseHelper.isPaused(1), effectivePaused);
    }

    function test_roleManagement_grantAndRevoke() public {
        address newPauser = address(0x123);
        PauseByIDRBACUpgradeableMock mock = PauseByIDRBACUpgradeableMock(address(pauseHelper));
        bytes32 pauserRole = mock.PAUSER_ROLE();
        bytes32 unpauserRole = mock.UNPAUSER_ROLE();

        mock.grantRole(pauserRole, newPauser);

        // `newPauser` can now pause.
        vm.prank(newPauser);
        pauseHelper.setDefaultPaused(true);
        assertTrue(pauseHelper.defaultPaused());

        // But `newPauser` cannot unpause (needs `UNPAUSER_ROLE`).
        vm.expectRevert(
            abi.encodeWithSelector(IAccessControl.AccessControlUnauthorizedAccount.selector, newPauser, unpauserRole)
        );
        vm.prank(newPauser);
        pauseHelper.setDefaultPaused(false);

        // Grant `UNPAUSER_ROLE` to `newPauser`.
        mock.grantRole(unpauserRole, newPauser);

        // Now `newPauser` can unpause.
        vm.prank(newPauser);
        pauseHelper.setDefaultPaused(false);
        assertFalse(pauseHelper.defaultPaused());

        // Revoke `PAUSER_ROLE`.
        mock.revokeRole(pauserRole, newPauser);

        // `newPauser` can no longer pause.
        vm.expectRevert(
            abi.encodeWithSelector(IAccessControl.AccessControlUnauthorizedAccount.selector, newPauser, pauserRole)
        );
        vm.prank(newPauser);
        pauseHelper.setDefaultPaused(true);
    }
}
