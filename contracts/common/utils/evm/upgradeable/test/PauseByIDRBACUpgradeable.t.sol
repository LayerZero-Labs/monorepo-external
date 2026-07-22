// SPDX-License-Identifier: MIT
pragma solidity ^0.8.22;

import { IPauseByID } from "@layerzerolabs/utils-evm-contracts/contracts/interfaces/IPauseByID.sol";
import { Initializable } from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import { IAccessControl } from "@openzeppelin/contracts/access/IAccessControl.sol";
import { ERC1967Utils } from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Utils.sol";
import { TransparentUpgradeableProxy } from "@openzeppelin/contracts/proxy/transparent/TransparentUpgradeableProxy.sol";
import { PauseByIDRBACUpgradeable } from "./../contracts/pause-by-id/PauseByIDRBACUpgradeable.sol";
import { PauseByIDBaseUpgradeableTest, PauseByIDBaseUpgradeableHarness } from "./PauseByIDBaseUpgradeable.t.sol";

contract PauseByIDRBACUpgradeableHarness is PauseByIDRBACUpgradeable {
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
    PauseByIDRBACUpgradeableHarness pauseRbac;

    function _deployPause() internal virtual override returns (PauseByIDBaseUpgradeableHarness) {
        PauseByIDRBACUpgradeableHarness impl = new PauseByIDRBACUpgradeableHarness();

        uint256 currentNonce = vm.getNonce(address(this));
        proxyAdmin = vm.computeCreateAddress(vm.computeCreateAddress(address(this), currentNonce), 1);

        TransparentUpgradeableProxy proxy = new TransparentUpgradeableProxy(
            address(impl),
            address(this),
            abi.encodeWithSelector(PauseByIDRBACUpgradeableHarness.initialize.selector, address(this))
        );

        bytes32 adminSlot = vm.load(address(proxy), ERC1967Utils.ADMIN_SLOT);
        proxyAdmin = address(uint160(uint256(adminSlot)));

        pauseRbac = PauseByIDRBACUpgradeableHarness(address(proxy));
        return PauseByIDBaseUpgradeableHarness(address(proxy));
    }

    /// @dev `PauseByIDRBACUpgradeableHarness.initialize(address)` has a different signature.
    function test_initialize_Revert_AlreadyInitialized() public virtual override {
        vm.expectRevert(Initializable.InvalidInitialization.selector);
        pauseRbac.initialize(alice);
    }

    function test_setDefaultPaused_Success() public {
        pause.setDefaultPaused(true);
        assertTrue(pause.defaultPaused());
    }

    function test_setDefaultPaused_Revert_Unauthorized() public {
        bytes32 pauserRole = pauseRbac.PAUSER_ROLE();
        vm.expectRevert(
            abi.encodeWithSelector(IAccessControl.AccessControlUnauthorizedAccount.selector, alice, pauserRole)
        );
        vm.prank(alice);
        pause.setDefaultPaused(true);
    }

    function test_setPaused_Success() public {
        IPauseByID.SetPausedParam[] memory params = new IPauseByID.SetPausedParam[](1);
        params[0] = IPauseByID.SetPausedParam(1, true, true);
        pause.setPaused(params);
        assertTrue(pause.isPaused(1));
    }

    function test_setPaused_Revert_Unauthorized() public {
        IPauseByID.SetPausedParam[] memory params = new IPauseByID.SetPausedParam[](1);
        params[0] = IPauseByID.SetPausedParam(1, true, true);

        bytes32 pauserRole = pauseRbac.PAUSER_ROLE();
        vm.expectRevert(
            abi.encodeWithSelector(IAccessControl.AccessControlUnauthorizedAccount.selector, alice, pauserRole)
        );
        vm.prank(alice);
        pause.setPaused(params);
    }

    function test_setPaused_Success_Batch() public {
        pause.setDefaultPaused(true);
        assertTrue(pause.defaultPaused());

        IPauseByID.SetPausedParam[] memory params = new IPauseByID.SetPausedParam[](1);
        params[0] = IPauseByID.SetPausedParam(1, false, true);
        pause.setPaused(params);
        assertFalse(pause.isPaused(1));

        params[0] = IPauseByID.SetPausedParam(2, true, true);
        pause.setPaused(params);
        assertTrue(pause.isPaused(2));

        pause.setDefaultPaused(false);
        assertFalse(pause.defaultPaused());

        IPauseByID.SetPausedParam[] memory batchParams = new IPauseByID.SetPausedParam[](10);
        for (uint32 i = 0; i < 10; i++) {
            batchParams[i] = IPauseByID.SetPausedParam(i + 10, (i + 10) % 2 == 0, true);
        }
        pause.setPaused(batchParams);
    }

    function test_setPaused_Revert_UnpauserCannotCauseEffectivePause() public {
        // `defaultPaused=true` and `enabled=false`.
        bytes32 pauserRole = pauseRbac.PAUSER_ROLE();
        bytes32 unpauserRole = pauseRbac.UNPAUSER_ROLE();

        // Set default to paused.
        pause.setDefaultPaused(true);

        // Grant only `UNPAUSER_ROLE` to `alice`.
        pauseRbac.grantRole(unpauserRole, alice);

        // `alice` tries to set `enabled=false` with `paused=false` — effective state is paused.
        IPauseByID.SetPausedParam[] memory params = new IPauseByID.SetPausedParam[](1);
        params[0] = IPauseByID.SetPausedParam(1, false, false);

        vm.expectRevert(
            abi.encodeWithSelector(IAccessControl.AccessControlUnauthorizedAccount.selector, alice, pauserRole)
        );
        vm.prank(alice);
        pause.setPaused(params);
    }

    function test_setPaused_Revert_PauserCannotCauseEffectiveUnpause() public {
        // `defaultPaused=false` and `enabled=false`.
        bytes32 pauserRole = pauseRbac.PAUSER_ROLE();
        bytes32 unpauserRole = pauseRbac.UNPAUSER_ROLE();

        // Default is already false (unpaused).
        assertFalse(pause.defaultPaused());

        // Grant only `PAUSER_ROLE` to `alice`.
        pauseRbac.grantRole(pauserRole, alice);

        // `alice` tries to set `enabled=false` with `paused=true` — effective state is unpaused.
        IPauseByID.SetPausedParam[] memory params = new IPauseByID.SetPausedParam[](1);
        params[0] = IPauseByID.SetPausedParam(1, true, false);

        vm.expectRevert(
            abi.encodeWithSelector(IAccessControl.AccessControlUnauthorizedAccount.selector, alice, unpauserRole)
        );
        vm.prank(alice);
        pause.setPaused(params);
    }

    function test_setPaused_Success_PauserCanSetDisabledWhenDefaultPaused() public {
        // `defaultPaused=true` and `enabled=false`.
        bytes32 pauserRole = pauseRbac.PAUSER_ROLE();

        // Set default to paused.
        pause.setDefaultPaused(true);

        // Grant only `PAUSER_ROLE` to `alice`.
        pauseRbac.grantRole(pauserRole, alice);

        // `alice` sets `enabled=false` — effective state is paused, so `PAUSER_ROLE` suffices.
        IPauseByID.SetPausedParam[] memory params = new IPauseByID.SetPausedParam[](1);
        params[0] = IPauseByID.SetPausedParam(1, false, false);

        vm.prank(alice);
        pause.setPaused(params);

        assertTrue(pause.isPaused(1));
    }

    function test_setPaused_Success_UnpauserCanSetDisabledWhenDefaultUnpaused() public {
        bytes32 unpauserRole = pauseRbac.UNPAUSER_ROLE();

        // Default is already false (unpaused).
        assertFalse(pause.defaultPaused());

        // Grant only `UNPAUSER_ROLE` to `alice`.
        pauseRbac.grantRole(unpauserRole, alice);

        // `alice` sets `enabled=false` — effective state is unpaused (from default), so `UNPAUSER_ROLE` suffices.
        IPauseByID.SetPausedParam[] memory params = new IPauseByID.SetPausedParam[](1);
        params[0] = IPauseByID.SetPausedParam(1, true, false);

        vm.prank(alice);
        pause.setPaused(params);

        assertFalse(pause.isPaused(1));
    }

    function test_setPaused_Revert_MixedBatchWithDisabledConfigs_NeedsBothRoles() public {
        bytes32 pauserRole = pauseRbac.PAUSER_ROLE();
        bytes32 unpauserRole = pauseRbac.UNPAUSER_ROLE();

        // Set default to paused.
        pause.setDefaultPaused(true);

        // Grant only `PAUSER_ROLE` to `alice`.
        pauseRbac.grantRole(pauserRole, alice);

        // Batch: one explicitly unpauses (`enabled=true`, `paused=false`), one falls back to default paused (`enabled=false`).
        IPauseByID.SetPausedParam[] memory params = new IPauseByID.SetPausedParam[](2);
        params[0] = IPauseByID.SetPausedParam(1, false, true); // effective: unpaused → needs `UNPAUSER_ROLE`
        params[1] = IPauseByID.SetPausedParam(2, false, false); // effective: paused (default) → needs `PAUSER_ROLE`

        vm.expectRevert(
            abi.encodeWithSelector(IAccessControl.AccessControlUnauthorizedAccount.selector, alice, unpauserRole)
        );
        vm.prank(alice);
        pause.setPaused(params);
    }

    function test_setPaused_Success_MixedBatchWithDisabledConfigs_BothRoles() public {
        bytes32 pauserRole = pauseRbac.PAUSER_ROLE();
        bytes32 unpauserRole = pauseRbac.UNPAUSER_ROLE();

        // Set default to paused.
        pause.setDefaultPaused(true);

        // Grant both roles to `alice`.
        pauseRbac.grantRole(pauserRole, alice);
        pauseRbac.grantRole(unpauserRole, alice);

        // Batch: one explicitly unpauses, one falls back to default paused.
        IPauseByID.SetPausedParam[] memory params = new IPauseByID.SetPausedParam[](2);
        params[0] = IPauseByID.SetPausedParam(1, false, true); // effective: unpaused
        params[1] = IPauseByID.SetPausedParam(2, false, false); // effective: paused (default)

        vm.prank(alice);
        pause.setPaused(params);

        assertFalse(pause.isPaused(1));
        assertTrue(pause.isPaused(2));
    }

    /// @dev Dormant data planted by one role cannot be activated without the other role.
    function test_setPaused_DormantData() public {
        bytes32 pauserRole = pauseRbac.PAUSER_ROLE();
        bytes32 unpauserRole = pauseRbac.UNPAUSER_ROLE();

        address frank = address(0x456);
        pauseRbac.grantRole(unpauserRole, alice);
        pauseRbac.grantRole(pauserRole, frank);

        // `defaultPaused=false`. `UNPAUSER_ROLE` stores dormant `paused=true` (`enabled=false`).
        IPauseByID.SetPausedParam[] memory params = new IPauseByID.SetPausedParam[](1);
        params[0] = IPauseByID.SetPausedParam(1, true, false);
        vm.prank(alice);
        pause.setPaused(params);
        assertFalse(pause.isPaused(1));
        assertTrue(pause.pauseConfig(1).paused);

        // `UNPAUSER_ROLE` cannot activate dormant `paused=true`.
        params[0] = IPauseByID.SetPausedParam(1, true, true);
        vm.expectRevert(
            abi.encodeWithSelector(IAccessControl.AccessControlUnauthorizedAccount.selector, alice, pauserRole)
        );
        vm.prank(alice);
        pause.setPaused(params);

        // `PAUSER_ROLE` can activate it.
        vm.prank(frank);
        pause.setPaused(params);
        assertTrue(pause.isPaused(1));

        // Symmetric: `defaultPaused=true`. `PAUSER_ROLE` stores dormant `paused=false` (`enabled=false`).
        pause.setDefaultPaused(true);
        params[0] = IPauseByID.SetPausedParam(2, false, false);
        vm.prank(frank);
        pause.setPaused(params);
        assertTrue(pause.isPaused(2));

        // `PAUSER_ROLE` cannot activate dormant `paused=false`.
        params[0] = IPauseByID.SetPausedParam(2, false, true);
        vm.expectRevert(
            abi.encodeWithSelector(IAccessControl.AccessControlUnauthorizedAccount.selector, frank, unpauserRole)
        );
        vm.prank(frank);
        pause.setPaused(params);

        // `UNPAUSER_ROLE` can activate it.
        vm.prank(alice);
        pause.setPaused(params);
        assertFalse(pause.isPaused(2));
    }

    function test_setPaused_EmptyArrayWithUnpauserRole() public {
        pauseRbac.grantRole(pauseRbac.UNPAUSER_ROLE(), alice);

        IPauseByID.SetPausedParam[] memory params = new IPauseByID.SetPausedParam[](0);

        vm.prank(alice);
        pause.setPaused(params);
    }

    function test_setPaused_Revert_EmptyArrayUnauthorized() public {
        bytes32 unpauserRole = pauseRbac.UNPAUSER_ROLE();

        IPauseByID.SetPausedParam[] memory params = new IPauseByID.SetPausedParam[](0);

        vm.expectRevert(
            abi.encodeWithSelector(IAccessControl.AccessControlUnauthorizedAccount.selector, alice, unpauserRole)
        );
        vm.prank(alice);
        pause.setPaused(params);
    }

    /// @dev Correct role succeeds, wrong role reverts, for all effective-state combinations.
    function test_setPaused_Fuzz_EffectiveStateRoleCheck(bool _defaultPaused, bool _paused, bool _enabled) public {
        bytes32 pauserRole = pauseRbac.PAUSER_ROLE();
        bytes32 unpauserRole = pauseRbac.UNPAUSER_ROLE();

        if (_defaultPaused) {
            pause.setDefaultPaused(true);
        }

        bool effectivePaused = _enabled ? _paused : _defaultPaused;

        IPauseByID.SetPausedParam[] memory params = new IPauseByID.SetPausedParam[](1);
        params[0] = IPauseByID.SetPausedParam(1, _paused, _enabled);

        // Wrong role reverts.
        address wrongCaller = address(0xBAD);
        if (effectivePaused) {
            pauseRbac.grantRole(unpauserRole, wrongCaller);
        } else {
            pauseRbac.grantRole(pauserRole, wrongCaller);
        }
        bytes32 missingRole = effectivePaused ? pauserRole : unpauserRole;
        vm.expectRevert(
            abi.encodeWithSelector(IAccessControl.AccessControlUnauthorizedAccount.selector, wrongCaller, missingRole)
        );
        vm.prank(wrongCaller);
        pause.setPaused(params);

        // Correct role succeeds.
        if (effectivePaused) {
            pauseRbac.grantRole(pauserRole, alice);
        } else {
            pauseRbac.grantRole(unpauserRole, alice);
        }
        vm.prank(alice);
        pause.setPaused(params);
        assertEq(pause.isPaused(1), effectivePaused);
    }

    function test_roleManagement_grantAndRevoke() public {
        address newPauser = address(0x123);
        bytes32 pauserRole = pauseRbac.PAUSER_ROLE();
        bytes32 unpauserRole = pauseRbac.UNPAUSER_ROLE();

        pauseRbac.grantRole(pauserRole, newPauser);

        // `newPauser` can now pause.
        vm.prank(newPauser);
        pause.setDefaultPaused(true);
        assertTrue(pause.defaultPaused());

        // But `newPauser` cannot unpause (needs `UNPAUSER_ROLE`).
        vm.expectRevert(
            abi.encodeWithSelector(IAccessControl.AccessControlUnauthorizedAccount.selector, newPauser, unpauserRole)
        );
        vm.prank(newPauser);
        pause.setDefaultPaused(false);

        // Grant `UNPAUSER_ROLE` to `newPauser`.
        pauseRbac.grantRole(unpauserRole, newPauser);

        // Now `newPauser` can unpause.
        vm.prank(newPauser);
        pause.setDefaultPaused(false);
        assertFalse(pause.defaultPaused());

        // Revoke `PAUSER_ROLE`.
        pauseRbac.revokeRole(pauserRole, newPauser);

        // `newPauser` can no longer pause.
        vm.expectRevert(
            abi.encodeWithSelector(IAccessControl.AccessControlUnauthorizedAccount.selector, newPauser, pauserRole)
        );
        vm.prank(newPauser);
        pause.setDefaultPaused(true);
    }
}
