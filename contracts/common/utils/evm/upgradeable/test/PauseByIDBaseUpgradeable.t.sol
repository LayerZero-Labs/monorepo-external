// SPDX-License-Identifier: MIT
pragma solidity ^0.8.22;

import { IPauseByID } from "@layerzerolabs/utils-evm-contracts/contracts/interfaces/IPauseByID.sol";
import { Initializable } from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import { TransparentUpgradeableProxy } from "@openzeppelin/contracts/proxy/transparent/TransparentUpgradeableProxy.sol";
import { Test } from "forge-std/Test.sol";
import { PauseByIDBaseUpgradeable } from "./../contracts/pause-by-id/PauseByIDBaseUpgradeable.sol";

contract PauseByIDBaseUpgradeableHarness is PauseByIDBaseUpgradeable {
    uint256 public callCount;

    constructor() {
        _disableInitializers();
    }

    function initialize() public initializer {}

    function setDefaultPaused(bool _paused) public {
        _setDefaultPaused(_paused);
    }

    function setPaused(SetPausedParam[] calldata _params) public {
        _setPaused(_params);
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

contract PauseByIDBaseUpgradeableTest is Test {
    PauseByIDBaseUpgradeableHarness pause;

    uint32 constant ID_1 = 1;
    uint32 constant ID_2 = 2;

    function _deployPause() internal virtual returns (PauseByIDBaseUpgradeableHarness) {
        PauseByIDBaseUpgradeableHarness impl = new PauseByIDBaseUpgradeableHarness();
        TransparentUpgradeableProxy proxy = new TransparentUpgradeableProxy(
            address(impl),
            address(this),
            abi.encodeWithSelector(PauseByIDBaseUpgradeableHarness.initialize.selector)
        );
        return PauseByIDBaseUpgradeableHarness(address(proxy));
    }

    function setUp() public virtual {
        pause = _deployPause();
    }

    function test_storageHash() public pure {
        bytes32 storageHash = keccak256(abi.encode(uint256(keccak256("layerzerov2.storage.pausebyid")) - 1)) &
            ~bytes32(uint256(0xff));
        assertEq(storageHash, 0xac2cb783706dc5ac6b91d3675ceaddc73634a37f082a72b77dcdd25ee1f51300);
    }

    function test_defaultPaused_InitialState() public view {
        assertFalse(pause.defaultPaused());
    }

    function test_isPaused_InitialState() public view {
        assertFalse(pause.isPaused(ID_1));
        assertFalse(pause.isPaused(ID_2));
    }

    function test_setDefaultPaused() public {
        vm.expectEmit(false, false, false, true);
        emit IPauseByID.DefaultPauseSet(true);
        pause.setDefaultPaused(true);

        assertTrue(pause.defaultPaused());
    }

    function test_setDefaultPaused_Fuzz(bool _paused) public {
        if (!_paused) {
            vm.expectRevert(abi.encodeWithSelector(IPauseByID.PauseStateIdempotent.selector, false));
            pause.setDefaultPaused(_paused);
            return;
        }

        vm.expectEmit(false, false, false, true);
        emit IPauseByID.DefaultPauseSet(_paused);
        pause.setDefaultPaused(_paused);
        assertEq(pause.defaultPaused(), _paused);
    }

    function test_setPaused() public {
        IPauseByID.SetPausedParam[] memory params = new IPauseByID.SetPausedParam[](1);
        params[0] = IPauseByID.SetPausedParam(ID_1, true, true);

        vm.expectEmit(false, false, false, true);
        emit IPauseByID.PauseSet(ID_1, true, true);
        pause.setPaused(params);

        IPauseByID.PauseConfig memory config = pause.pauseConfig(ID_1);
        assertTrue(config.paused);
        assertTrue(config.enabled);
    }

    function test_setPaused_Fuzz(uint256 _id, bool _paused, bool _enabled) public {
        IPauseByID.SetPausedParam[] memory params = new IPauseByID.SetPausedParam[](1);
        params[0] = IPauseByID.SetPausedParam(_id, _paused, _enabled);

        vm.expectEmit(false, false, false, true);
        emit IPauseByID.PauseSet(_id, _paused, _enabled);
        pause.setPaused(params);

        IPauseByID.PauseConfig memory config = pause.pauseConfig(_id);
        assertEq(config.paused, _paused);
        assertEq(config.enabled, _enabled);
    }

    function test_setPaused_EmptyArray() public {
        IPauseByID.SetPausedParam[] memory params = new IPauseByID.SetPausedParam[](0);
        pause.setPaused(params);
    }

    function test_isPaused_Default() public {
        pause.setDefaultPaused(true);
        assertTrue(pause.isPaused(ID_1));
        assertTrue(pause.isPaused(ID_2));
    }

    function test_isPaused_Specific() public {
        IPauseByID.SetPausedParam[] memory params = new IPauseByID.SetPausedParam[](1);
        params[0] = IPauseByID.SetPausedParam(ID_1, true, true);
        pause.setPaused(params);

        assertTrue(pause.isPaused(ID_1));
        assertFalse(pause.isPaused(ID_2));
    }

    function test_isPaused_SpecificDisabled() public {
        pause.setDefaultPaused(true);

        IPauseByID.SetPausedParam[] memory params = new IPauseByID.SetPausedParam[](1);
        params[0] = IPauseByID.SetPausedParam(ID_1, true, true);
        pause.setPaused(params);

        params[0] = IPauseByID.SetPausedParam(ID_1, false, false);
        pause.setPaused(params);

        // When disabled, falls back to default.
        assertTrue(pause.isPaused(ID_1));
    }

    function test_isPaused_Override() public {
        pause.setDefaultPaused(true);
        IPauseByID.SetPausedParam[] memory params = new IPauseByID.SetPausedParam[](1);
        params[0] = IPauseByID.SetPausedParam(ID_1, false, true);
        pause.setPaused(params);

        assertFalse(pause.isPaused(ID_1));
        assertTrue(pause.isPaused(ID_2));
    }

    function test_assertNotPaused_Success() public view {
        pause.assertNotPaused(ID_1);
    }

    function test_assertNotPaused_Revert_DefaultPaused() public {
        pause.setDefaultPaused(true);
        vm.expectRevert(abi.encodeWithSelector(IPauseByID.Paused.selector, ID_1));
        pause.assertNotPaused(ID_1);
    }

    function test_assertNotPaused_Revert_SpecificPaused() public {
        IPauseByID.SetPausedParam[] memory params = new IPauseByID.SetPausedParam[](1);
        params[0] = IPauseByID.SetPausedParam(ID_1, true, true);
        pause.setPaused(params);
        vm.expectRevert(abi.encodeWithSelector(IPauseByID.Paused.selector, ID_1));
        pause.assertNotPaused(ID_1);
    }

    function test_pauseConfig() public {
        IPauseByID.SetPausedParam[] memory params = new IPauseByID.SetPausedParam[](1);
        params[0] = IPauseByID.SetPausedParam(ID_1, true, true);
        pause.setPaused(params);

        IPauseByID.PauseConfig memory config = pause.pauseConfig(ID_1);
        assertTrue(config.paused);
        assertTrue(config.enabled);

        config = pause.pauseConfig(ID_2);
        assertFalse(config.paused);
        assertFalse(config.enabled);
    }

    function test_isPaused_MultipleIDs() public {
        IPauseByID.SetPausedParam[] memory params = new IPauseByID.SetPausedParam[](2);
        params[0] = IPauseByID.SetPausedParam(ID_1, true, true);
        params[1] = IPauseByID.SetPausedParam(ID_2, false, true);
        pause.setPaused(params);

        assertTrue(pause.isPaused(ID_1));
        assertFalse(pause.isPaused(ID_2));
        assertFalse(pause.isPaused(3));
    }

    function test_setPaused_Success_Toggle() public {
        assertFalse(pause.isPaused(ID_1));

        IPauseByID.SetPausedParam[] memory params = new IPauseByID.SetPausedParam[](1);
        params[0] = IPauseByID.SetPausedParam(ID_1, true, true);
        pause.setPaused(params);
        assertTrue(pause.isPaused(ID_1));

        params[0] = IPauseByID.SetPausedParam(ID_1, false, true);
        pause.setPaused(params);
        assertFalse(pause.isPaused(ID_1));
    }

    function test_defaultPause_AffectsMultipleIDs() public {
        pause.setDefaultPaused(true);
        assertTrue(pause.isPaused(1));
        assertTrue(pause.isPaused(2));
        assertTrue(pause.isPaused(100));
        assertTrue(pause.isPaused(type(uint256).max));
    }

    function test_specificOverridesDefault_Fuzz(bool _defaultPaused, bool _specificPaused) public {
        if (_defaultPaused) {
            pause.setDefaultPaused(_defaultPaused);
        }

        IPauseByID.SetPausedParam[] memory params = new IPauseByID.SetPausedParam[](1);
        params[0] = IPauseByID.SetPausedParam(ID_1, _specificPaused, true);
        pause.setPaused(params);

        assertEq(pause.isPaused(ID_1), _specificPaused);
        assertEq(pause.isPaused(ID_2), _defaultPaused);
    }

    function test_initialize_Revert_AlreadyInitialized() public virtual {
        vm.expectRevert(Initializable.InvalidInitialization.selector);
        pause.initialize();
    }

    function test_setPaused_Success_EdgeCase_IDZero() public {
        IPauseByID.SetPausedParam[] memory params = new IPauseByID.SetPausedParam[](1);
        params[0] = IPauseByID.SetPausedParam(0, true, true);
        pause.setPaused(params);
        assertTrue(pause.isPaused(0));
    }

    function test_setPaused_Success_EdgeCase_IDMaxUint256() public {
        IPauseByID.SetPausedParam[] memory params = new IPauseByID.SetPausedParam[](1);
        params[0] = IPauseByID.SetPausedParam(type(uint256).max, true, true);
        pause.setPaused(params);
        assertTrue(pause.isPaused(type(uint256).max));
    }

    function test_setDefaultPaused_Idempotent_Reverts() public {
        pause.setDefaultPaused(true);

        vm.expectRevert(abi.encodeWithSelector(IPauseByID.PauseStateIdempotent.selector, true));
        pause.setDefaultPaused(true);
    }

    function test_setDefaultPaused_Idempotent_InitialState_Reverts() public {
        assertFalse(pause.defaultPaused());

        vm.expectRevert(abi.encodeWithSelector(IPauseByID.PauseStateIdempotent.selector, false));
        pause.setDefaultPaused(false);
    }

    // ============ Modifier Tests ============

    function test_whenNotPaused_Success() public {
        pause.functionWithModifier(ID_1);
        assertEq(pause.callCount(), 1);
    }

    function test_whenNotPaused_Revert_DefaultPaused() public {
        pause.setDefaultPaused(true);

        vm.expectRevert(abi.encodeWithSelector(IPauseByID.Paused.selector, ID_1));
        pause.functionWithModifier(ID_1);

        assertEq(pause.callCount(), 0);
    }

    function test_whenNotPaused_Revert_SpecificPaused() public {
        IPauseByID.SetPausedParam[] memory params = new IPauseByID.SetPausedParam[](1);
        params[0] = IPauseByID.SetPausedParam(ID_1, true, true);
        pause.setPaused(params);

        vm.expectRevert(abi.encodeWithSelector(IPauseByID.Paused.selector, ID_1));
        pause.functionWithModifier(ID_1);

        assertEq(pause.callCount(), 0);
    }

    function test_whenNotPaused_Success_SpecificUnpaused() public {
        pause.setDefaultPaused(true);

        IPauseByID.SetPausedParam[] memory params = new IPauseByID.SetPausedParam[](1);
        params[0] = IPauseByID.SetPausedParam(ID_1, false, true);
        pause.setPaused(params);

        pause.functionWithModifier(ID_1);
        assertEq(pause.callCount(), 1);
    }

    function test_whenNotPaused_WithReturnValue() public view {
        uint256 result = pause.functionWithModifierReturns(ID_1);
        assertEq(result, 42);
    }

    function test_whenNotPaused_WithReturnValue_Reverts() public {
        IPauseByID.SetPausedParam[] memory params = new IPauseByID.SetPausedParam[](1);
        params[0] = IPauseByID.SetPausedParam(ID_1, true, true);
        pause.setPaused(params);

        vm.expectRevert(abi.encodeWithSelector(IPauseByID.Paused.selector, ID_1));
        pause.functionWithModifierReturns(ID_1);
    }
}
