// SPDX-License-Identifier: MIT
pragma solidity ^0.8.22;

import { Test } from "forge-std/Test.sol";
import { IOFTDecimalUtils } from "./../contracts/interfaces/IOFTDecimalUtils.sol";
import { OFTDecimalUtils } from "./../contracts/utils/OFTDecimalUtils.sol";

contract OFTDecimalUtilsHarness is OFTDecimalUtils {
    constructor(uint8 _localDecimals, uint8 _sharedDecimals) OFTDecimalUtils(_localDecimals, _sharedDecimals) {}

    function removeDust(uint256 _amountLD) external view returns (uint256) {
        return _removeDust(_amountLD);
    }

    function toLD(uint64 _amountSD) external view returns (uint256) {
        return _toLD(_amountSD);
    }

    function toSD(uint256 _amountLD) external view returns (uint64) {
        return _toSD(_amountLD);
    }
}

contract OFTDecimalUtilsTest is Test {
    OFTDecimalUtilsHarness harness18_6;
    OFTDecimalUtilsHarness harness18_8;
    OFTDecimalUtilsHarness harness6_6;
    OFTDecimalUtilsHarness harness8_6;
    OFTDecimalUtilsHarness harness0_0;

    function setUp() public {
        harness18_6 = new OFTDecimalUtilsHarness(18, 6);
        harness18_8 = new OFTDecimalUtilsHarness(18, 8);
        harness6_6 = new OFTDecimalUtilsHarness(6, 6);
        harness8_6 = new OFTDecimalUtilsHarness(8, 6);
        harness0_0 = new OFTDecimalUtilsHarness(0, 0);
    }

    // ============ Constructor / Getter Tests ============

    function test_constructor_18_6() public view {
        assertEq(harness18_6.localDecimals(), 18);
        assertEq(harness18_6.sharedDecimals(), 6);
        assertEq(harness18_6.decimalConversionRate(), 10 ** 12);
    }

    function test_constructor_18_8() public view {
        assertEq(harness18_8.localDecimals(), 18);
        assertEq(harness18_8.sharedDecimals(), 8);
        assertEq(harness18_8.decimalConversionRate(), 10 ** 10);
    }

    function test_constructor_6_6() public view {
        assertEq(harness6_6.localDecimals(), 6);
        assertEq(harness6_6.sharedDecimals(), 6);
        assertEq(harness6_6.decimalConversionRate(), 1);
    }

    function test_constructor_8_6() public view {
        assertEq(harness8_6.localDecimals(), 8);
        assertEq(harness8_6.sharedDecimals(), 6);
        assertEq(harness8_6.decimalConversionRate(), 100);
    }

    function test_constructor_0_0() public view {
        assertEq(harness0_0.localDecimals(), 0);
        assertEq(harness0_0.sharedDecimals(), 0);
        assertEq(harness0_0.decimalConversionRate(), 1);
    }

    function test_constructor_Fuzz(uint8 _localDecimals, uint8 _sharedDecimals) public {
        vm.assume(_localDecimals >= _sharedDecimals);
        // Max safe value is around 77 (10^77 < 2^256).
        vm.assume(_localDecimals - _sharedDecimals <= 77);

        OFTDecimalUtilsHarness harness = new OFTDecimalUtilsHarness(_localDecimals, _sharedDecimals);

        assertEq(harness.localDecimals(), _localDecimals);
        assertEq(harness.sharedDecimals(), _sharedDecimals);
        assertEq(harness.decimalConversionRate(), 10 ** (_localDecimals - _sharedDecimals));
    }

    function test_constructor_Revert_SharedGreaterThanLocal() public {
        vm.expectRevert(IOFTDecimalUtils.InvalidLocalDecimals.selector);
        new OFTDecimalUtilsHarness(6, 8);
    }

    // ============ Remove Dust Tests ============

    function test_removeDust_18_6_NoDust() public view {
        uint256 amountLD = 1e18;
        uint256 result = harness18_6.removeDust(amountLD);
        assertEq(result, amountLD);
    }

    function test_removeDust_18_6_WithDust() public view {
        uint256 amountLD = 1e18 + 123456789012;
        uint256 result = harness18_6.removeDust(amountLD);
        assertEq(result, 1e18);
    }

    function test_removeDust_18_6_OnlyDust() public view {
        uint256 amountLD = 999999999999;
        uint256 result = harness18_6.removeDust(amountLD);
        assertEq(result, 0);
    }

    function test_removeDust_18_6_Zero() public view {
        uint256 result = harness18_6.removeDust(0);
        assertEq(result, 0);
    }

    function test_removeDust_6_6() public view {
        uint256 amountLD = 123456;
        uint256 result = harness6_6.removeDust(amountLD);
        assertEq(result, amountLD);
    }

    function test_removeDust_8_6_WithDust() public view {
        uint256 amountLD = 12345678;
        uint256 result = harness8_6.removeDust(amountLD);
        assertEq(result, 12345600);
    }

    function test_removeDust_0_0() public view {
        uint256 amountLD = 12345;
        uint256 result = harness0_0.removeDust(amountLD);
        assertEq(result, amountLD);
    }

    function test_removeDust_Fuzz_18_6(uint256 amountLD) public view {
        uint256 result1 = harness18_6.removeDust(amountLD);
        uint256 result2 = harness18_6.removeDust(result1);
        assertEq(result1, (amountLD / harness18_6.decimalConversionRate()) * harness18_6.decimalConversionRate());
        assertEq(result2, result1);
    }

    function test_removeDust_Fuzz_6_6(uint256 amountLD) public view {
        uint256 result1 = harness6_6.removeDust(amountLD);
        uint256 result2 = harness6_6.removeDust(result1);
        assertEq(result1, amountLD);
        assertEq(result2, result1);
    }

    function test_removeDust_Fuzz_8_6(uint256 amountLD) public view {
        uint256 result1 = harness8_6.removeDust(amountLD);
        uint256 result2 = harness8_6.removeDust(result1);
        assertEq(result1, (amountLD / 100) * 100);
        assertEq(result2, result1);
    }

    function test_removeDust_Fuzz_0_0(uint256 amountLD) public view {
        uint256 result1 = harness0_0.removeDust(amountLD);
        uint256 result2 = harness0_0.removeDust(result1);
        assertEq(result1, amountLD);
        assertEq(result2, result1);
    }

    // ============ To Local Decimals Tests ============

    function test_toLD_18_6() public view {
        uint64 amountSD = 1e6;
        uint256 result = harness18_6.toLD(amountSD);
        assertEq(result, 1e18);
    }

    function test_toLD_18_6_Zero() public view {
        uint256 result = harness18_6.toLD(0);
        assertEq(result, 0);
    }

    function test_toLD_18_6_MaxUint64() public view {
        uint64 amountSD = type(uint64).max;
        uint256 result = harness18_6.toLD(amountSD);
        assertEq(result, uint256(type(uint64).max) * 1e12);
    }

    function test_toLD_6_6() public view {
        uint64 amountSD = 123456;
        uint256 result = harness6_6.toLD(amountSD);
        assertEq(result, amountSD);
    }

    function test_toLD_8_6() public view {
        uint64 amountSD = 1e6;
        uint256 result = harness8_6.toLD(amountSD);
        assertEq(result, 1e8);
    }

    function test_toLD_0_0() public view {
        uint64 amountSD = 12345;
        uint256 result = harness0_0.toLD(amountSD);
        assertEq(result, amountSD);
    }

    function test_toLD_Fuzz_18_6(uint64 _amountSD) public view {
        uint256 result = harness18_6.toLD(_amountSD);
        assertEq(result, uint256(_amountSD) * 10 ** 12);
    }

    function test_toLD_Fuzz_6_6(uint64 _amountSD) public view {
        uint256 result = harness6_6.toLD(_amountSD);
        assertEq(result, uint256(_amountSD));
    }

    function test_toLD_Fuzz_8_6(uint64 _amountSD) public view {
        uint256 result = harness8_6.toLD(_amountSD);
        assertEq(result, uint256(_amountSD) * 100);
    }

    function test_toLD_Fuzz_0_0(uint64 _amountSD) public view {
        uint256 result = harness0_0.toLD(_amountSD);
        assertEq(result, uint256(_amountSD));
    }

    // ============ To Shared Decimals Tests ============

    function test_toSD_18_6() public view {
        uint256 amountLD = 1e18;
        uint64 result = harness18_6.toSD(amountLD);
        assertEq(result, 1e6);
    }

    function test_toSD_18_6_Zero() public view {
        uint64 result = harness18_6.toSD(0);
        assertEq(result, 0);
    }

    function test_toSD_18_6_Truncates() public view {
        uint256 amountLD = 1e18 + 999999999999;
        uint64 result = harness18_6.toSD(amountLD);
        assertEq(result, 1e6);
    }

    function test_toSD_18_6_LessThanConversionRate() public view {
        uint256 amountLD = 1e11;
        uint64 result = harness18_6.toSD(amountLD);
        assertEq(result, 0);
    }

    function test_toSD_6_6() public view {
        uint256 amountLD = 123456;
        uint64 result = harness6_6.toSD(amountLD);
        assertEq(result, 123456);
    }

    function test_toSD_8_6() public view {
        uint256 amountLD = 1e8;
        uint64 result = harness8_6.toSD(amountLD);
        assertEq(result, 1e6);
    }

    function test_toSD_0_0() public view {
        uint256 amountLD = 1234;
        uint64 result = harness0_0.toSD(amountLD);
        assertEq(result, amountLD);
    }

    function test_toSD_Fuzz_18_6(uint104 _amountLD) public view {
        uint256 amountLD = uint256(_amountLD);
        vm.assume(amountLD <= uint256(type(uint64).max) * 1e12);
        uint64 result = harness18_6.toSD(amountLD);
        assertEq(result, amountLD / harness18_6.decimalConversionRate());
    }

    function test_toSD_Fuzz_6_6(uint64 _amountLD) public view {
        uint256 amountLD = uint256(_amountLD);
        uint64 result = harness6_6.toSD(amountLD);
        assertEq(result, amountLD);
    }

    function test_toSD_Fuzz_8_6(uint72 _amountLD) public view {
        uint256 amountLD = uint256(_amountLD);
        vm.assume(amountLD <= uint256(type(uint64).max) * 100);
        uint64 result = harness8_6.toSD(amountLD);
        assertEq(result, amountLD / 100);
    }

    function test_toSD_Fuzz_0_0(uint64 _amountLD) public view {
        uint256 amountLD = uint256(_amountLD);
        uint64 result = harness0_0.toSD(amountLD);
        assertEq(result, amountLD);
    }

    function test_toSD_Revert_AmountSDOverflowed_18_6() public {
        uint256 amountLD = uint256(type(uint64).max) * 1e12 + 1e12;
        uint256 expectedAmountSD = amountLD / 1e12;

        vm.expectRevert(abi.encodeWithSelector(IOFTDecimalUtils.AmountSDOverflowed.selector, expectedAmountSD));
        harness18_6.toSD(amountLD);
    }

    function test_toSD_Revert_AmountSDOverflowed_6_6() public {
        uint256 amountLD = uint256(type(uint64).max) + 1;

        vm.expectRevert(abi.encodeWithSelector(IOFTDecimalUtils.AmountSDOverflowed.selector, amountLD));
        harness6_6.toSD(amountLD);
    }

    function test_toSD_Revert_AmountSDOverflowed_0_0() public {
        uint256 amountLD = uint256(type(uint64).max) + 1;

        vm.expectRevert(abi.encodeWithSelector(IOFTDecimalUtils.AmountSDOverflowed.selector, amountLD));
        harness0_0.toSD(amountLD);
    }

    function test_toSD_Fuzz_Revert_AmountSDOverflowed_18_6(uint256 _amountLD) public {
        uint256 maxAmountLD = uint256(type(uint64).max) * 1e12 + (1e12 - 1);
        vm.assume(_amountLD > maxAmountLD);

        uint256 expectedAmountSD = _amountLD / 1e12;
        vm.expectRevert(abi.encodeWithSelector(IOFTDecimalUtils.AmountSDOverflowed.selector, expectedAmountSD));
        harness18_6.toSD(_amountLD);
    }

    function test_toSD_Fuzz_Revert_AmountSDOverflowed_6_6(uint256 _amountLD) public {
        vm.assume(_amountLD > type(uint64).max);

        vm.expectRevert(abi.encodeWithSelector(IOFTDecimalUtils.AmountSDOverflowed.selector, _amountLD));
        harness6_6.toSD(_amountLD);
    }

    // ============ Roundtrip Tests ============

    function test_Roundtrip_toSD_toLD_18_6() public view {
        uint256 amountLD = 12345678901234567890;
        uint256 dustRemoved = harness18_6.removeDust(amountLD);
        uint64 amountSD = harness18_6.toSD(amountLD);
        uint256 amountLDBack = harness18_6.toLD(amountSD);
        assertEq(amountLDBack, dustRemoved);
    }

    function test_Roundtrip_toLD_toSD_18_6() public view {
        uint64 amountSD = 123456;
        uint256 amountLD = harness18_6.toLD(amountSD);
        uint64 amountSDBack = harness18_6.toSD(amountLD);
        assertEq(amountSDBack, amountSD);
    }

    function test_Roundtrip_Fuzz_toSD_toLD_18_6(uint104 _amountLD) public view {
        uint256 amountLD = uint256(_amountLD);
        vm.assume(amountLD <= uint256(type(uint64).max) * 1e12);
        uint256 dustRemoved = harness18_6.removeDust(amountLD);
        uint64 amountSD = harness18_6.toSD(amountLD);
        uint256 amountLDBack = harness18_6.toLD(amountSD);
        assertEq(amountLDBack, dustRemoved);
    }

    function test_Roundtrip_Fuzz_toLD_toSD_18_6(uint64 _amountSD) public view {
        uint256 amountLD = harness18_6.toLD(_amountSD);
        uint64 amountSDBack = harness18_6.toSD(amountLD);
        assertEq(amountSDBack, _amountSD);
    }
}
