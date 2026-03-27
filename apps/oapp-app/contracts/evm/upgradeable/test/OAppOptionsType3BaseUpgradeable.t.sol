// SPDX-License-Identifier: MIT
pragma solidity ^0.8.22;

import { IOAppOptionsType3 } from "@layerzerolabs/oapp-evm-impl/contracts/interfaces/IOAppOptionsType3.sol";
import { OptionsBuilder } from "@layerzerolabs/oapp-evm-impl/contracts/oapp/libs/OptionsBuilder.sol";
import { Initializable } from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import { TransparentUpgradeableProxy } from "@openzeppelin/contracts/proxy/transparent/TransparentUpgradeableProxy.sol";
import { Test } from "forge-std/Test.sol";
import { OAppOptionsType3BaseUpgradeable } from "./../contracts/oapp/options-type-3/OAppOptionsType3BaseUpgradeable.sol";

contract OAppOptionsType3BaseHarness is OAppOptionsType3BaseUpgradeable {
    constructor() {
        _disableInitializers();
    }

    function initialize() public initializer {
        __OAppOptionsType3Base_init();
    }

    function setEnforcedOptions(IOAppOptionsType3.EnforcedOptionParam[] calldata _enforcedOptions) external {
        _setEnforcedOptions(_enforcedOptions);
    }
}

contract OAppOptionsType3BaseUpgradeableTest is Test {
    using OptionsBuilder for bytes;

    IOAppOptionsType3 oapp;

    uint16 internal constant SEND = 1;
    uint16 internal constant SEND_AND_CALL = 2;

    function _createOApp() internal virtual returns (IOAppOptionsType3) {
        OAppOptionsType3BaseHarness impl = new OAppOptionsType3BaseHarness();
        TransparentUpgradeableProxy proxy = new TransparentUpgradeableProxy(
            address(impl),
            address(this),
            abi.encodeWithSelector(OAppOptionsType3BaseHarness.initialize.selector)
        );
        return IOAppOptionsType3(address(proxy));
    }

    function setUp() public virtual {
        oapp = _createOApp();
    }

    // ============ initialize ============

    function test_initialize_Revert_AlreadyInitialized() public virtual {
        vm.expectRevert(Initializable.InvalidInitialization.selector);
        OAppOptionsType3BaseHarness(address(oapp)).initialize();
    }

    // ============ enforcedOptions ============

    function test_enforcedOptions() public {
        uint32 eid = 30101;
        bytes memory options = OptionsBuilder.newOptions().addExecutorLzReceiveOption(200_000, 0);

        IOAppOptionsType3.EnforcedOptionParam[] memory params = new IOAppOptionsType3.EnforcedOptionParam[](1);
        params[0] = IOAppOptionsType3.EnforcedOptionParam(eid, SEND, options);
        oapp.setEnforcedOptions(params);

        assertEq(oapp.enforcedOptions(eid, SEND), options);
    }

    function test_enforcedOptions_Empty() public view {
        assertEq(oapp.enforcedOptions(1, SEND), bytes(""));
    }

    // ============ setEnforcedOptions ============

    function test_setEnforcedOptions() public {
        uint32 eid = 30101;
        bytes memory sendOptions = OptionsBuilder.newOptions().addExecutorLzReceiveOption(200_000, 0);
        bytes memory sendAndCallOptions = OptionsBuilder
            .newOptions()
            .addExecutorLzReceiveOption(200_000, 0)
            .addExecutorLzComposeOption(0, 500_000, 0);

        IOAppOptionsType3.EnforcedOptionParam[] memory params = new IOAppOptionsType3.EnforcedOptionParam[](2);
        params[0] = IOAppOptionsType3.EnforcedOptionParam(eid, SEND, sendOptions);
        params[1] = IOAppOptionsType3.EnforcedOptionParam(eid, SEND_AND_CALL, sendAndCallOptions);

        vm.expectEmit(true, true, true, true, address(oapp));
        emit IOAppOptionsType3.EnforcedOptionSet(params);

        oapp.setEnforcedOptions(params);

        assertEq(oapp.enforcedOptions(eid, SEND), sendOptions);
        assertEq(oapp.enforcedOptions(eid, SEND_AND_CALL), sendAndCallOptions);
    }

    function test_setEnforcedOptions_EmptyOptionsResetsEnforced() public {
        uint32 eid = 30101;
        bytes memory sendOptions = OptionsBuilder.newOptions().addExecutorLzReceiveOption(200_000, 0);

        IOAppOptionsType3.EnforcedOptionParam[] memory params = new IOAppOptionsType3.EnforcedOptionParam[](1);
        params[0] = IOAppOptionsType3.EnforcedOptionParam(eid, SEND, sendOptions);
        oapp.setEnforcedOptions(params);
        assertEq(oapp.enforcedOptions(eid, SEND), sendOptions);

        // Reset enforced options with empty bytes.
        params[0] = IOAppOptionsType3.EnforcedOptionParam(eid, SEND, bytes(""));
        oapp.setEnforcedOptions(params);
        assertEq(oapp.enforcedOptions(eid, SEND), bytes(""));
    }

    function test_setEnforcedOptions_Fuzz(uint32 _eid, uint16 _msgType, uint128 _gas) public {
        _gas = uint128(bound(_gas, 1, type(uint128).max));

        bytes memory options = OptionsBuilder.newOptions().addExecutorLzReceiveOption(_gas, 0);

        IOAppOptionsType3.EnforcedOptionParam[] memory params = new IOAppOptionsType3.EnforcedOptionParam[](1);
        params[0] = IOAppOptionsType3.EnforcedOptionParam(_eid, _msgType, options);
        oapp.setEnforcedOptions(params);

        assertEq(oapp.enforcedOptions(_eid, _msgType), options);
    }

    function test_setEnforcedOptions_Fuzz_Revert_InvalidOptionsType(uint16 _optionsType) public {
        vm.assume(_optionsType != 3);

        bytes memory options = abi.encodePacked(_optionsType);

        IOAppOptionsType3.EnforcedOptionParam[] memory params = new IOAppOptionsType3.EnforcedOptionParam[](1);
        params[0] = IOAppOptionsType3.EnforcedOptionParam(1, SEND, options);
        vm.expectRevert(abi.encodeWithSelector(IOAppOptionsType3.InvalidOptions.selector, options));
        oapp.setEnforcedOptions(params);
    }

    // ============ combineOptions ============

    function test_combineOptions_CombinesType3Options() public {
        uint32 eid = 30101;
        bytes memory enforced = OptionsBuilder.newOptions().addExecutorLzReceiveOption(200_000, 0);
        bytes32 receiver = bytes32(uint256(uint160(makeAddr("receiver"))));

        IOAppOptionsType3.EnforcedOptionParam[] memory params = new IOAppOptionsType3.EnforcedOptionParam[](1);
        params[0] = IOAppOptionsType3.EnforcedOptionParam(eid, SEND, enforced);
        oapp.setEnforcedOptions(params);

        bytes memory extraOptions = OptionsBuilder.newOptions().addExecutorNativeDropOption(1.2345 ether, receiver);
        bytes memory expected = OptionsBuilder
            .newOptions()
            .addExecutorLzReceiveOption(200_000, 0)
            .addExecutorNativeDropOption(1.2345 ether, receiver);

        assertEq(oapp.combineOptions(eid, SEND, extraOptions), expected);
    }

    function test_combineOptions_NoExtraOptions() public {
        uint32 eid = 30101;
        bytes memory enforced = OptionsBuilder
            .newOptions()
            .addExecutorLzReceiveOption(200_000, 0)
            .addExecutorLzComposeOption(0, 500_000, 0);

        IOAppOptionsType3.EnforcedOptionParam[] memory params = new IOAppOptionsType3.EnforcedOptionParam[](1);
        params[0] = IOAppOptionsType3.EnforcedOptionParam(eid, SEND_AND_CALL, enforced);
        oapp.setEnforcedOptions(params);

        assertEq(oapp.combineOptions(eid, SEND_AND_CALL, bytes("")), enforced);
    }

    function test_combineOptions_NoEnforcedOptions() public view {
        bytes memory callerOptions = OptionsBuilder.newOptions().addExecutorLzReceiveOption(100_000, 0);
        assertEq(oapp.combineOptions(1, SEND, callerOptions), callerOptions);
    }

    function test_combineOptions_PassthroughAfterReset() public {
        uint32 eid = 30101;
        bytes memory enforced = OptionsBuilder
            .newOptions()
            .addExecutorLzReceiveOption(200_000, 0)
            .addExecutorLzComposeOption(0, 500_000, 0);

        // Set enforced options.
        IOAppOptionsType3.EnforcedOptionParam[] memory params = new IOAppOptionsType3.EnforcedOptionParam[](1);
        params[0] = IOAppOptionsType3.EnforcedOptionParam(eid, SEND_AND_CALL, enforced);
        oapp.setEnforcedOptions(params);

        // Reset enforced options with empty bytes.
        params[0] = IOAppOptionsType3.EnforcedOptionParam(eid, SEND_AND_CALL, bytes(""));
        oapp.setEnforcedOptions(params);

        // After reset, `combineOptions` should pass through caller options as-is.
        bytes memory callerOptions = OptionsBuilder
            .newOptions()
            .addExecutorLzReceiveOption(100_000, 0)
            .addExecutorLzComposeOption(0, 300_000, 0);
        assertEq(oapp.combineOptions(eid, SEND_AND_CALL, callerOptions), callerOptions);
    }

    function test_combineOptions_Revert_SingleByteExtraOptions() public {
        uint32 eid = 30101;
        bytes memory enforced = OptionsBuilder.newOptions().addExecutorLzReceiveOption(200_000, 0);

        IOAppOptionsType3.EnforcedOptionParam[] memory params = new IOAppOptionsType3.EnforcedOptionParam[](1);
        params[0] = IOAppOptionsType3.EnforcedOptionParam(eid, SEND, enforced);
        oapp.setEnforcedOptions(params);

        vm.expectRevert(abi.encodeWithSelector(IOAppOptionsType3.InvalidOptions.selector, hex"03"));
        oapp.combineOptions(eid, SEND, hex"03");
    }

    function test_combineOptions_Fuzz(uint32 _eid, uint16 _msgType, uint128 _enforcedGas, uint128 _extraGas) public {
        _enforcedGas = uint128(bound(_enforcedGas, 1, type(uint128).max));
        _extraGas = uint128(bound(_extraGas, 1, type(uint128).max));

        bytes memory enforced = OptionsBuilder.newOptions().addExecutorLzReceiveOption(_enforcedGas, 0);

        IOAppOptionsType3.EnforcedOptionParam[] memory params = new IOAppOptionsType3.EnforcedOptionParam[](1);
        params[0] = IOAppOptionsType3.EnforcedOptionParam(_eid, _msgType, enforced);
        oapp.setEnforcedOptions(params);

        bytes memory extra = OptionsBuilder.newOptions().addExecutorLzReceiveOption(_extraGas, 0);
        bytes memory expected = OptionsBuilder
            .newOptions()
            .addExecutorLzReceiveOption(_enforcedGas, 0)
            .addExecutorLzReceiveOption(_extraGas, 0);

        assertEq(oapp.combineOptions(_eid, _msgType, extra), expected);
    }

    function test_combineOptions_Fuzz_Revert_InvalidExtraOptionsType(uint16 _optionsType) public {
        vm.assume(_optionsType != 3);

        bytes memory enforced = OptionsBuilder.newOptions().addExecutorLzReceiveOption(200_000, 0);

        IOAppOptionsType3.EnforcedOptionParam[] memory params = new IOAppOptionsType3.EnforcedOptionParam[](1);
        params[0] = IOAppOptionsType3.EnforcedOptionParam(1, SEND, enforced);
        oapp.setEnforcedOptions(params);

        bytes memory invalidOptions = abi.encodePacked(_optionsType);
        vm.expectRevert(abi.encodeWithSelector(IOAppOptionsType3.InvalidOptions.selector, invalidOptions));
        oapp.combineOptions(1, SEND, invalidOptions);
    }
}
