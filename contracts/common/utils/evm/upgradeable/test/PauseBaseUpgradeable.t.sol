// SPDX-License-Identifier: MIT
pragma solidity ^0.8.22;

import { IPause } from "@layerzerolabs/utils-evm-contracts/contracts/interfaces/IPause.sol";
import { Initializable } from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import { TransparentUpgradeableProxy } from "@openzeppelin/contracts/proxy/transparent/TransparentUpgradeableProxy.sol";
import { Test } from "forge-std/Test.sol";
import { PauseBaseUpgradeable } from "./../contracts/pause/PauseBaseUpgradeable.sol";

contract PauseBaseUpgradeableHarness is PauseBaseUpgradeable {
    uint256 public callCount;

    constructor() {
        _disableInitializers();
    }

    function initialize() public initializer {}

    function pause() public {
        _pause();
    }

    function unpause() public {
        _unpause();
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

contract PauseBaseUpgradeableTest is Test {
    PauseBaseUpgradeableHarness pause;

    function _deployPause() internal virtual returns (PauseBaseUpgradeableHarness) {
        PauseBaseUpgradeableHarness impl = new PauseBaseUpgradeableHarness();
        TransparentUpgradeableProxy proxy = new TransparentUpgradeableProxy(
            address(impl),
            address(this),
            abi.encodeWithSelector(PauseBaseUpgradeableHarness.initialize.selector)
        );
        return PauseBaseUpgradeableHarness(address(proxy));
    }

    function setUp() public virtual {
        pause = _deployPause();
    }

    function test_storageHash() public pure {
        bytes32 storageHash = keccak256(abi.encode(uint256(keccak256("layerzerov2.storage.pause")) - 1)) &
            ~bytes32(uint256(0xff));
        assertEq(storageHash, 0x27be0a968b102c71096101138efa2fc0db00aea7b287f10fdc298bfd2d4ec000);
    }

    function test_isPaused_InitialState() public view {
        assertFalse(pause.isPaused());
    }

    function test_pause() public {
        vm.expectEmit(false, false, false, true);
        emit IPause.PauseSet(true);
        pause.pause();

        assertTrue(pause.isPaused());
    }

    function test_unpause() public {
        pause.pause();
        assertTrue(pause.isPaused());

        vm.expectEmit(false, false, false, true);
        emit IPause.PauseSet(false);
        pause.unpause();

        assertFalse(pause.isPaused());
    }

    function test_setPaused_Fuzz(bool _paused) public {
        if (!_paused) {
            vm.expectRevert(abi.encodeWithSelector(IPause.PauseStateIdempotent.selector, false));
            pause.unpause();
            return;
        }

        vm.expectEmit(false, false, false, true);
        emit IPause.PauseSet(_paused);
        pause.pause();
        assertEq(pause.isPaused(), _paused);
    }

    function test_setPaused_Success_ToggleMultipleTimes() public {
        assertFalse(pause.isPaused());

        pause.pause();
        assertTrue(pause.isPaused());

        pause.unpause();
        assertFalse(pause.isPaused());

        pause.pause();
        assertTrue(pause.isPaused());

        pause.unpause();
        assertFalse(pause.isPaused());

        pause.pause();
        assertTrue(pause.isPaused());
    }

    function test_assertNotPaused_Success() public view {
        pause.assertNotPaused();
    }

    function test_assertNotPaused_Revert_Paused() public {
        pause.pause();
        vm.expectRevert(abi.encodeWithSelector(IPause.Paused.selector));
        pause.assertNotPaused();
    }

    function test_assertNotPaused_Fuzz(bool _paused) public {
        if (_paused) {
            pause.pause();
        }

        if (_paused) {
            vm.expectRevert(abi.encodeWithSelector(IPause.Paused.selector));
            pause.assertNotPaused();
        } else {
            pause.assertNotPaused();
        }
    }

    function test_initialize_Revert_AlreadyInitialized() public virtual {
        vm.expectRevert(Initializable.InvalidInitialization.selector);
        pause.initialize();
    }

    function test_setPaused_Idempotent_Reverts() public {
        pause.pause();

        vm.expectRevert(abi.encodeWithSelector(IPause.PauseStateIdempotent.selector, true));
        pause.pause();
    }

    function test_setPaused_Idempotent_InitialState_Reverts() public {
        assertFalse(pause.isPaused());

        vm.expectRevert(abi.encodeWithSelector(IPause.PauseStateIdempotent.selector, false));
        pause.unpause();
    }

    function test_whenNotPaused_Success() public {
        pause.functionWithModifier();
        assertEq(pause.callCount(), 1);
    }

    function test_whenNotPaused_Revert_Paused() public {
        pause.pause();
        vm.expectRevert(abi.encodeWithSelector(IPause.Paused.selector));
        pause.functionWithModifier();

        assertEq(pause.callCount(), 0);
    }

    function test_whenNotPaused_Success_AfterUnpause() public {
        pause.pause();

        vm.expectRevert(abi.encodeWithSelector(IPause.Paused.selector));
        pause.functionWithModifier();

        pause.unpause();

        pause.functionWithModifier();
        assertEq(pause.callCount(), 1);
    }

    function test_whenNotPaused_WithReturnValue() public view {
        uint256 result = pause.functionWithModifierReturns();
        assertEq(result, 42);
    }

    function test_whenNotPaused_Revert_WithReturnValue() public {
        pause.pause();
        vm.expectRevert(abi.encodeWithSelector(IPause.Paused.selector));
        pause.functionWithModifierReturns();
    }

    function test_whenNotPaused_Fuzz(bool _paused) public {
        if (_paused) {
            pause.pause();
        }

        if (_paused) {
            vm.expectRevert(abi.encodeWithSelector(IPause.Paused.selector));
            pause.functionWithModifier();
            assertEq(pause.callCount(), 0);
        } else {
            pause.functionWithModifier();
            assertEq(pause.callCount(), 1);
        }
    }

    function test_whenNotPaused_Success_MultipleCalls() public {
        pause.functionWithModifier();
        pause.functionWithModifier();
        pause.functionWithModifier();
        assertEq(pause.callCount(), 3);

        pause.pause();

        vm.expectRevert(abi.encodeWithSelector(IPause.Paused.selector));
        pause.functionWithModifier();
        vm.expectRevert(abi.encodeWithSelector(IPause.Paused.selector));
        pause.functionWithModifier();
        assertEq(pause.callCount(), 3);

        pause.unpause();

        pause.functionWithModifier();
        pause.functionWithModifier();
        assertEq(pause.callCount(), 5);
    }
}
