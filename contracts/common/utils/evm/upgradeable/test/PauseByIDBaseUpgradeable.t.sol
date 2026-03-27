// SPDX-License-Identifier: MIT
pragma solidity ^0.8.22;

import { IPauseByID } from "@layerzerolabs/utils-evm-impl/contracts/interfaces/IPauseByID.sol";
import { Initializable } from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import { TransparentUpgradeableProxy } from "@openzeppelin/contracts/proxy/transparent/TransparentUpgradeableProxy.sol";
import { Test } from "forge-std/Test.sol";
import { PauseByIDBaseUpgradeable } from "./../contracts/pause-by-id/PauseByIDBaseUpgradeable.sol";

/// @dev Interface for pause mock with management and test helper functions.
interface IPauseByIDBaseMock is IPauseByID {
    function setDefaultPaused(bool _paused) external;
    function setPaused(SetPausedParam[] calldata _params) external;
    function assertNotPaused(uint256 _id) external view;
    function functionWithModifier(uint256 _id) external;
    function functionWithModifierReturns(uint256 _id) external view returns (uint256);
    function callCount() external view returns (uint256);
}

contract PauseByIDBaseUpgradeableMock is PauseByIDBaseUpgradeable {
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
    IPauseByIDBaseMock pauseHelper;

    uint32 constant ID_1 = 1;
    uint32 constant ID_2 = 2;

    function _createPause() internal virtual returns (IPauseByIDBaseMock) {
        PauseByIDBaseUpgradeableMock impl = new PauseByIDBaseUpgradeableMock();
        TransparentUpgradeableProxy proxy = new TransparentUpgradeableProxy(
            address(impl),
            address(this),
            abi.encodeWithSelector(PauseByIDBaseUpgradeableMock.initialize.selector)
        );
        return IPauseByIDBaseMock(address(proxy));
    }

    function setUp() public virtual {
        pauseHelper = _createPause();
    }

    function test_storageHash() public pure {
        bytes32 storageHash = keccak256(abi.encode(uint256(keccak256("layerzerov2.storage.pausebyid")) - 1)) &
            ~bytes32(uint256(0xff));
        assertEq(storageHash, 0xac2cb783706dc5ac6b91d3675ceaddc73634a37f082a72b77dcdd25ee1f51300);
    }

    function test_defaultPaused_InitialState() public view {
        assertFalse(pauseHelper.defaultPaused());
    }

    function test_isPaused_InitialState() public view {
        assertFalse(pauseHelper.isPaused(ID_1));
        assertFalse(pauseHelper.isPaused(ID_2));
    }

    function test_setDefaultPaused() public {
        vm.expectEmit(false, false, false, true);
        emit IPauseByID.DefaultPauseSet(true);
        pauseHelper.setDefaultPaused(true);

        assertTrue(pauseHelper.defaultPaused());
    }

    function test_setDefaultPaused_Fuzz(bool _paused) public {
        if (!_paused) {
            vm.expectRevert(abi.encodeWithSelector(IPauseByID.PauseStateIdempotent.selector, false));
            pauseHelper.setDefaultPaused(_paused);
            return;
        }

        vm.expectEmit(false, false, false, true);
        emit IPauseByID.DefaultPauseSet(_paused);
        pauseHelper.setDefaultPaused(_paused);
        assertEq(pauseHelper.defaultPaused(), _paused);
    }

    function test_setPaused() public {
        IPauseByID.SetPausedParam[] memory params = new IPauseByID.SetPausedParam[](1);
        params[0] = IPauseByID.SetPausedParam(ID_1, true, true);

        vm.expectEmit(false, false, false, true);
        emit IPauseByID.PauseSet(ID_1, true, true);
        pauseHelper.setPaused(params);

        IPauseByID.PauseConfig memory config = pauseHelper.pauseConfig(ID_1);
        assertTrue(config.paused);
        assertTrue(config.enabled);
    }

    function test_setPaused_Fuzz(uint256 _id, bool _paused, bool _enabled) public {
        IPauseByID.SetPausedParam[] memory params = new IPauseByID.SetPausedParam[](1);
        params[0] = IPauseByID.SetPausedParam(_id, _paused, _enabled);

        vm.expectEmit(false, false, false, true);
        emit IPauseByID.PauseSet(_id, _paused, _enabled);
        pauseHelper.setPaused(params);

        IPauseByID.PauseConfig memory config = pauseHelper.pauseConfig(_id);
        assertEq(config.paused, _paused);
        assertEq(config.enabled, _enabled);
    }

    function test_setPaused_EmptyArray() public {
        IPauseByID.SetPausedParam[] memory params = new IPauseByID.SetPausedParam[](0);
        pauseHelper.setPaused(params);
    }

    function test_isPaused_Default() public {
        pauseHelper.setDefaultPaused(true);
        assertTrue(pauseHelper.isPaused(ID_1));
        assertTrue(pauseHelper.isPaused(ID_2));
    }

    function test_isPaused_Specific() public {
        IPauseByID.SetPausedParam[] memory params = new IPauseByID.SetPausedParam[](1);
        params[0] = IPauseByID.SetPausedParam(ID_1, true, true);
        pauseHelper.setPaused(params);

        assertTrue(pauseHelper.isPaused(ID_1));
        assertFalse(pauseHelper.isPaused(ID_2));
    }

    function test_isPaused_SpecificDisabled() public {
        pauseHelper.setDefaultPaused(true);

        IPauseByID.SetPausedParam[] memory params = new IPauseByID.SetPausedParam[](1);
        params[0] = IPauseByID.SetPausedParam(ID_1, true, true);
        pauseHelper.setPaused(params);

        params[0] = IPauseByID.SetPausedParam(ID_1, false, false);
        pauseHelper.setPaused(params);

        // When disabled, falls back to default.
        assertTrue(pauseHelper.isPaused(ID_1));
    }

    function test_isPaused_Override() public {
        pauseHelper.setDefaultPaused(true);
        IPauseByID.SetPausedParam[] memory params = new IPauseByID.SetPausedParam[](1);
        params[0] = IPauseByID.SetPausedParam(ID_1, false, true);
        pauseHelper.setPaused(params);

        assertFalse(pauseHelper.isPaused(ID_1));
        assertTrue(pauseHelper.isPaused(ID_2));
    }

    function test_assertNotPaused_Success() public view {
        pauseHelper.assertNotPaused(ID_1);
    }

    function test_assertNotPaused_Revert_DefaultPaused() public {
        pauseHelper.setDefaultPaused(true);
        vm.expectRevert(abi.encodeWithSelector(IPauseByID.Paused.selector, ID_1));
        pauseHelper.assertNotPaused(ID_1);
    }

    function test_assertNotPaused_Revert_SpecificPaused() public {
        IPauseByID.SetPausedParam[] memory params = new IPauseByID.SetPausedParam[](1);
        params[0] = IPauseByID.SetPausedParam(ID_1, true, true);
        pauseHelper.setPaused(params);
        vm.expectRevert(abi.encodeWithSelector(IPauseByID.Paused.selector, ID_1));
        pauseHelper.assertNotPaused(ID_1);
    }

    function test_pauseConfig() public {
        IPauseByID.SetPausedParam[] memory params = new IPauseByID.SetPausedParam[](1);
        params[0] = IPauseByID.SetPausedParam(ID_1, true, true);
        pauseHelper.setPaused(params);

        IPauseByID.PauseConfig memory config = pauseHelper.pauseConfig(ID_1);
        assertTrue(config.paused);
        assertTrue(config.enabled);

        config = pauseHelper.pauseConfig(ID_2);
        assertFalse(config.paused);
        assertFalse(config.enabled);
    }

    function test_isPaused_MultipleIDs() public {
        IPauseByID.SetPausedParam[] memory params = new IPauseByID.SetPausedParam[](2);
        params[0] = IPauseByID.SetPausedParam(ID_1, true, true);
        params[1] = IPauseByID.SetPausedParam(ID_2, false, true);
        pauseHelper.setPaused(params);

        assertTrue(pauseHelper.isPaused(ID_1));
        assertFalse(pauseHelper.isPaused(ID_2));
        assertFalse(pauseHelper.isPaused(3));
    }

    function test_setPaused_Success_Toggle() public {
        assertFalse(pauseHelper.isPaused(ID_1));

        IPauseByID.SetPausedParam[] memory params = new IPauseByID.SetPausedParam[](1);
        params[0] = IPauseByID.SetPausedParam(ID_1, true, true);
        pauseHelper.setPaused(params);
        assertTrue(pauseHelper.isPaused(ID_1));

        params[0] = IPauseByID.SetPausedParam(ID_1, false, true);
        pauseHelper.setPaused(params);
        assertFalse(pauseHelper.isPaused(ID_1));
    }

    function test_defaultPause_AffectsMultipleIDs() public {
        pauseHelper.setDefaultPaused(true);
        assertTrue(pauseHelper.isPaused(1));
        assertTrue(pauseHelper.isPaused(2));
        assertTrue(pauseHelper.isPaused(100));
        assertTrue(pauseHelper.isPaused(type(uint256).max));
    }

    function test_specificOverridesDefault_Fuzz(bool _defaultPaused, bool _specificPaused) public {
        if (_defaultPaused) {
            pauseHelper.setDefaultPaused(_defaultPaused);
        }

        IPauseByID.SetPausedParam[] memory params = new IPauseByID.SetPausedParam[](1);
        params[0] = IPauseByID.SetPausedParam(ID_1, _specificPaused, true);
        pauseHelper.setPaused(params);

        assertEq(pauseHelper.isPaused(ID_1), _specificPaused);
        assertEq(pauseHelper.isPaused(ID_2), _defaultPaused);
    }

    function test_initialize_Revert_AlreadyInitialized() public virtual {
        vm.expectRevert(Initializable.InvalidInitialization.selector);
        PauseByIDBaseUpgradeableMock(address(pauseHelper)).initialize();
    }

    function test_setPaused_Success_EdgeCase_IDZero() public {
        IPauseByID.SetPausedParam[] memory params = new IPauseByID.SetPausedParam[](1);
        params[0] = IPauseByID.SetPausedParam(0, true, true);
        pauseHelper.setPaused(params);
        assertTrue(pauseHelper.isPaused(0));
    }

    function test_setPaused_Success_EdgeCase_IDMaxUint256() public {
        IPauseByID.SetPausedParam[] memory params = new IPauseByID.SetPausedParam[](1);
        params[0] = IPauseByID.SetPausedParam(type(uint256).max, true, true);
        pauseHelper.setPaused(params);
        assertTrue(pauseHelper.isPaused(type(uint256).max));
    }

    function test_setDefaultPaused_Idempotent_Reverts() public {
        pauseHelper.setDefaultPaused(true);

        vm.expectRevert(abi.encodeWithSelector(IPauseByID.PauseStateIdempotent.selector, true));
        pauseHelper.setDefaultPaused(true);
    }

    function test_setDefaultPaused_Idempotent_InitialState_Reverts() public {
        assertFalse(pauseHelper.defaultPaused());

        vm.expectRevert(abi.encodeWithSelector(IPauseByID.PauseStateIdempotent.selector, false));
        pauseHelper.setDefaultPaused(false);
    }

    // ============ Modifier Tests ============

    function test_whenNotPaused_Success() public {
        pauseHelper.functionWithModifier(ID_1);
        assertEq(pauseHelper.callCount(), 1);
    }

    function test_whenNotPaused_Revert_DefaultPaused() public {
        pauseHelper.setDefaultPaused(true);

        vm.expectRevert(abi.encodeWithSelector(IPauseByID.Paused.selector, ID_1));
        pauseHelper.functionWithModifier(ID_1);

        assertEq(pauseHelper.callCount(), 0);
    }

    function test_whenNotPaused_Revert_SpecificPaused() public {
        IPauseByID.SetPausedParam[] memory params = new IPauseByID.SetPausedParam[](1);
        params[0] = IPauseByID.SetPausedParam(ID_1, true, true);
        pauseHelper.setPaused(params);

        vm.expectRevert(abi.encodeWithSelector(IPauseByID.Paused.selector, ID_1));
        pauseHelper.functionWithModifier(ID_1);

        assertEq(pauseHelper.callCount(), 0);
    }

    function test_whenNotPaused_Success_SpecificUnpaused() public {
        pauseHelper.setDefaultPaused(true);

        IPauseByID.SetPausedParam[] memory params = new IPauseByID.SetPausedParam[](1);
        params[0] = IPauseByID.SetPausedParam(ID_1, false, true);
        pauseHelper.setPaused(params);

        pauseHelper.functionWithModifier(ID_1);
        assertEq(pauseHelper.callCount(), 1);
    }

    function test_whenNotPaused_WithReturnValue() public view {
        uint256 result = pauseHelper.functionWithModifierReturns(ID_1);
        assertEq(result, 42);
    }

    function test_whenNotPaused_WithReturnValue_Reverts() public {
        IPauseByID.SetPausedParam[] memory params = new IPauseByID.SetPausedParam[](1);
        params[0] = IPauseByID.SetPausedParam(ID_1, true, true);
        pauseHelper.setPaused(params);

        vm.expectRevert(abi.encodeWithSelector(IPauseByID.Paused.selector, ID_1));
        pauseHelper.functionWithModifierReturns(ID_1);
    }
}
