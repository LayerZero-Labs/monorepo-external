// SPDX-License-Identifier: MIT
pragma solidity ^0.8.22;

import { IPause } from "@layerzerolabs/utils-evm-impl/contracts/interfaces/IPause.sol";
import { Initializable } from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import { TransparentUpgradeableProxy } from "@openzeppelin/contracts/proxy/transparent/TransparentUpgradeableProxy.sol";
import { Test } from "forge-std/Test.sol";
import { PauseBaseUpgradeable } from "./../contracts/pause/PauseBaseUpgradeable.sol";

interface IPauseTestHelper is IPause {
    function pause() external;
    function unpause() external;
}

contract PauseBaseUpgradeableMock is PauseBaseUpgradeable {
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
    IPauseTestHelper pauseHelper;

    function setUp() public virtual {
        PauseBaseUpgradeableMock impl = new PauseBaseUpgradeableMock();
        TransparentUpgradeableProxy proxy = new TransparentUpgradeableProxy(
            address(impl),
            address(this),
            abi.encodeWithSelector(PauseBaseUpgradeableMock.initialize.selector)
        );
        pauseHelper = IPauseTestHelper(address(proxy));
    }

    function test_storageHash() public pure {
        bytes32 storageHash = keccak256(abi.encode(uint256(keccak256("layerzerov2.storage.pause")) - 1)) &
            ~bytes32(uint256(0xff));
        assertEq(storageHash, 0x27be0a968b102c71096101138efa2fc0db00aea7b287f10fdc298bfd2d4ec000);
    }

    function test_isPaused_InitialState() public view {
        assertFalse(pauseHelper.isPaused());
    }

    function test_pause() public {
        vm.expectEmit(false, false, false, true);
        emit IPause.PauseSet(true);
        pauseHelper.pause();

        assertTrue(pauseHelper.isPaused());
    }

    function test_unpause() public {
        pauseHelper.pause();
        assertTrue(pauseHelper.isPaused());

        vm.expectEmit(false, false, false, true);
        emit IPause.PauseSet(false);
        pauseHelper.unpause();

        assertFalse(pauseHelper.isPaused());
    }

    function test_setPaused_Fuzz(bool _paused) public {
        if (!_paused) {
            vm.expectRevert(abi.encodeWithSelector(IPause.PauseStateIdempotent.selector, false));
            pauseHelper.unpause();
            return;
        }

        vm.expectEmit(false, false, false, true);
        emit IPause.PauseSet(_paused);
        pauseHelper.pause();
        assertEq(pauseHelper.isPaused(), _paused);
    }

    function test_setPaused_Success_ToggleMultipleTimes() public {
        assertFalse(pauseHelper.isPaused());

        pauseHelper.pause();
        assertTrue(pauseHelper.isPaused());

        pauseHelper.unpause();
        assertFalse(pauseHelper.isPaused());

        pauseHelper.pause();
        assertTrue(pauseHelper.isPaused());

        pauseHelper.unpause();
        assertFalse(pauseHelper.isPaused());

        pauseHelper.pause();
        assertTrue(pauseHelper.isPaused());
    }

    function test_assertNotPaused_Success() public view {
        PauseBaseUpgradeableMock(address(pauseHelper)).assertNotPaused();
    }

    function test_assertNotPaused_Revert_Paused() public {
        pauseHelper.pause();
        vm.expectRevert(abi.encodeWithSelector(IPause.Paused.selector));
        PauseBaseUpgradeableMock(address(pauseHelper)).assertNotPaused();
    }

    function test_assertNotPaused_Fuzz(bool _paused) public {
        if (_paused) {
            pauseHelper.pause();
        }

        if (_paused) {
            vm.expectRevert(abi.encodeWithSelector(IPause.Paused.selector));
            PauseBaseUpgradeableMock(address(pauseHelper)).assertNotPaused();
        } else {
            PauseBaseUpgradeableMock(address(pauseHelper)).assertNotPaused();
        }
    }

    function test_initialize_Revert_AlreadyInitialized() public virtual {
        vm.expectRevert(Initializable.InvalidInitialization.selector);
        PauseBaseUpgradeableMock(address(pauseHelper)).initialize();
    }

    function test_setPaused_Idempotent_Reverts() public {
        pauseHelper.pause();

        vm.expectRevert(abi.encodeWithSelector(IPause.PauseStateIdempotent.selector, true));
        pauseHelper.pause();
    }

    function test_setPaused_Idempotent_InitialState_Reverts() public {
        assertFalse(pauseHelper.isPaused());

        vm.expectRevert(abi.encodeWithSelector(IPause.PauseStateIdempotent.selector, false));
        pauseHelper.unpause();
    }

    function test_whenNotPaused_Success() public {
        PauseBaseUpgradeableMock mock = PauseBaseUpgradeableMock(address(pauseHelper));
        mock.functionWithModifier();
        assertEq(mock.callCount(), 1);
    }

    function test_whenNotPaused_Revert_Paused() public {
        pauseHelper.pause();

        PauseBaseUpgradeableMock mock = PauseBaseUpgradeableMock(address(pauseHelper));
        vm.expectRevert(abi.encodeWithSelector(IPause.Paused.selector));
        mock.functionWithModifier();

        assertEq(mock.callCount(), 0);
    }

    function test_whenNotPaused_Success_AfterUnpause() public {
        PauseBaseUpgradeableMock mock = PauseBaseUpgradeableMock(address(pauseHelper));

        pauseHelper.pause();

        vm.expectRevert(abi.encodeWithSelector(IPause.Paused.selector));
        mock.functionWithModifier();

        pauseHelper.unpause();

        mock.functionWithModifier();
        assertEq(mock.callCount(), 1);
    }

    function test_whenNotPaused_WithReturnValue() public view {
        PauseBaseUpgradeableMock mock = PauseBaseUpgradeableMock(address(pauseHelper));
        uint256 result = mock.functionWithModifierReturns();
        assertEq(result, 42);
    }

    function test_whenNotPaused_Revert_WithReturnValue() public {
        pauseHelper.pause();

        PauseBaseUpgradeableMock mock = PauseBaseUpgradeableMock(address(pauseHelper));
        vm.expectRevert(abi.encodeWithSelector(IPause.Paused.selector));
        mock.functionWithModifierReturns();
    }

    function test_whenNotPaused_Fuzz(bool _paused) public {
        if (_paused) {
            pauseHelper.pause();
        }

        PauseBaseUpgradeableMock mock = PauseBaseUpgradeableMock(address(pauseHelper));

        if (_paused) {
            vm.expectRevert(abi.encodeWithSelector(IPause.Paused.selector));
            mock.functionWithModifier();
            assertEq(mock.callCount(), 0);
        } else {
            mock.functionWithModifier();
            assertEq(mock.callCount(), 1);
        }
    }

    function test_whenNotPaused_Success_MultipleCalls() public {
        PauseBaseUpgradeableMock mock = PauseBaseUpgradeableMock(address(pauseHelper));

        mock.functionWithModifier();
        mock.functionWithModifier();
        mock.functionWithModifier();
        assertEq(mock.callCount(), 3);

        pauseHelper.pause();

        vm.expectRevert(abi.encodeWithSelector(IPause.Paused.selector));
        mock.functionWithModifier();
        vm.expectRevert(abi.encodeWithSelector(IPause.Paused.selector));
        mock.functionWithModifier();
        assertEq(mock.callCount(), 3);

        pauseHelper.unpause();

        mock.functionWithModifier();
        mock.functionWithModifier();
        assertEq(mock.callCount(), 5);
    }
}
