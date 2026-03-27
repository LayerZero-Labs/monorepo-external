// SPDX-License-Identifier: MIT
pragma solidity ^0.8.22;

import { IFeeConfig } from "@layerzerolabs/utils-evm-impl/contracts/interfaces/IFeeConfig.sol";
import { TransparentUpgradeableProxy } from "@openzeppelin/contracts/proxy/transparent/TransparentUpgradeableProxy.sol";
import { Test } from "forge-std/Test.sol";
import { FeeConfigBaseUpgradeable } from "./../contracts/fee-config/FeeConfigBaseUpgradeable.sol";

interface IFeeConfigTestHelper is IFeeConfig {}

contract FeeConfigBaseUpgradeableMock is FeeConfigBaseUpgradeable {
    constructor() {
        _disableInitializers();
    }

    function initialize() public initializer {}

    function setDefaultFeeBps(uint16 _feeBps) public {
        _setDefaultFeeBps(_feeBps);
    }

    function setFeeBps(uint256 _id, uint16 _feeBps, bool _enabled) public {
        _setFeeBps(_id, _feeBps, _enabled);
    }
}

contract FeeConfigBaseUpgradeableTest is Test {
    IFeeConfigTestHelper public feeConfigHelper;

    uint32 constant EID_1 = 1;
    uint32 constant EID_2 = 2;
    uint16 constant BPS_DENOMINATOR = 10000;

    function _deployFeeConfigHelper() internal virtual returns (IFeeConfigTestHelper) {
        FeeConfigBaseUpgradeableMock impl = new FeeConfigBaseUpgradeableMock();
        TransparentUpgradeableProxy proxy = new TransparentUpgradeableProxy(
            address(impl),
            address(this),
            abi.encodeWithSelector(FeeConfigBaseUpgradeableMock.initialize.selector)
        );

        return IFeeConfigTestHelper(address(proxy));
    }

    function setUp() public virtual {
        feeConfigHelper = _deployFeeConfigHelper();
    }

    function test_setDefaultFeeBps_Fuzz(uint16 _feeBps) public {
        if (_feeBps > BPS_DENOMINATOR) {
            vm.expectRevert(abi.encodeWithSelector(IFeeConfig.InvalidBps.selector, _feeBps));
            feeConfigHelper.setDefaultFeeBps(_feeBps);
        } else {
            vm.expectEmit(false, false, false, true);
            emit IFeeConfig.DefaultFeeBpsSet(_feeBps);
            feeConfigHelper.setDefaultFeeBps(_feeBps);
            assertEq(feeConfigHelper.defaultFeeBps(), _feeBps);
        }
    }

    function test_setDefaultFeeBps() public {
        test_setDefaultFeeBps_Fuzz(500);
    }

    function test_setFeeBps_Fuzz(uint16 _defaultFeeBps, uint32 _dstEid, uint16 _feeBps, bool _enabled) public {
        _defaultFeeBps = uint16(bound(_defaultFeeBps, 0, BPS_DENOMINATOR));
        feeConfigHelper.setDefaultFeeBps(_defaultFeeBps);
        assertEq(feeConfigHelper.defaultFeeBps(), _defaultFeeBps);

        if (_feeBps > BPS_DENOMINATOR) {
            vm.expectRevert(abi.encodeWithSelector(IFeeConfig.InvalidBps.selector, _feeBps));
            feeConfigHelper.setFeeBps(_dstEid, _feeBps, _enabled);
        } else {
            vm.expectEmit(false, false, false, true);
            emit IFeeConfig.FeeBpsSet(_dstEid, _feeBps, _enabled);
            feeConfigHelper.setFeeBps(_dstEid, _feeBps, _enabled);

            IFeeConfig.FeeConfig memory config = feeConfigHelper.feeBps(_dstEid);
            assertEq(config.feeBps, _feeBps);
            assertEq(config.enabled, _enabled);

            uint256 fee = feeConfigHelper.getFee(_dstEid, 10000);
            uint16 expectedBps = _enabled ? _feeBps : _defaultFeeBps;
            assertEq(fee, expectedBps);
        }
    }

    function test_setFeeBps() public {
        test_setFeeBps_Fuzz(500, EID_1, 200, true);
    }

    function test_getFee_Fuzz(uint16 _defaultFeeBps, uint32 _dstEid, uint240 _amount) public {
        _defaultFeeBps = uint16(bound(_defaultFeeBps, 0, BPS_DENOMINATOR));
        feeConfigHelper.setDefaultFeeBps(_defaultFeeBps);

        uint256 expectedFee = _defaultFeeBps == 0 ? 0 : (uint256(_amount) * _defaultFeeBps) / BPS_DENOMINATOR;
        assertEq(feeConfigHelper.getFee(_dstEid, _amount), expectedFee);
    }

    function test_setDefaultFeeBps_RevertInvalid() public {
        vm.expectRevert(abi.encodeWithSelector(IFeeConfig.InvalidBps.selector, 10001));
        feeConfigHelper.setDefaultFeeBps(10001);
    }

    function test_setFeeBps_RevertInvalid() public {
        vm.expectRevert(abi.encodeWithSelector(IFeeConfig.InvalidBps.selector, 10001));
        feeConfigHelper.setFeeBps(EID_1, 10001, true);
    }

    function test_getFee_Default() public {
        feeConfigHelper.setDefaultFeeBps(500);
        uint256 amount = 1000;
        uint256 expectedFee = 50;
        assertEq(feeConfigHelper.getFee(EID_1, amount), expectedFee);
    }

    function test_getFee_Specific() public {
        feeConfigHelper.setDefaultFeeBps(500);
        feeConfigHelper.setFeeBps(EID_1, 200, true);
        uint256 amount = 1000;
        uint256 expectedFee = 20;
        assertEq(feeConfigHelper.getFee(EID_1, amount), expectedFee);
    }

    function test_getFee_SpecificDisabled() public {
        feeConfigHelper.setDefaultFeeBps(500);
        feeConfigHelper.setFeeBps(EID_1, 200, false);
        uint256 amount = 1000;
        uint256 expectedFee = 50;
        assertEq(feeConfigHelper.getFee(EID_1, amount), expectedFee);
    }

    function test_getFee_BoundaryConditions() public {
        feeConfigHelper.setDefaultFeeBps(500);
        assertEq(feeConfigHelper.getFee(EID_1, 0), 0);
        feeConfigHelper.setFeeBps(EID_1, 10000, true);
        assertEq(feeConfigHelper.getFee(EID_1, 100), 100);
        feeConfigHelper.setFeeBps(EID_1, 0, true);
        assertEq(feeConfigHelper.getFee(EID_1, 1000), 0);
    }

    function test_getFee_Rounding() public {
        feeConfigHelper.setDefaultFeeBps(1000);
        assertEq(feeConfigHelper.getFee(EID_1, 15), 1);
        assertEq(feeConfigHelper.getFee(EID_1, 9), 0);
    }

    // ============ getAmountBeforeFee Tests ============

    function test_getAmountBeforeFee_ZeroBps() public view {
        assertEq(feeConfigHelper.getAmountBeforeFee(EID_1, 0), 0);
        assertEq(feeConfigHelper.getAmountBeforeFee(EID_1, 1000), 1000);
        assertEq(feeConfigHelper.getAmountBeforeFee(EID_1, type(uint256).max), type(uint256).max);
    }

    function test_getAmountBeforeFee_MaxBps() public {
        feeConfigHelper.setDefaultFeeBps(BPS_DENOMINATOR);
        assertEq(feeConfigHelper.getAmountBeforeFee(EID_1, 0), 0);
        assertEq(feeConfigHelper.getAmountBeforeFee(EID_1, 1000), 0);
        assertEq(feeConfigHelper.getAmountBeforeFee(EID_1, type(uint256).max), 0);
    }

    function test_getAmountBeforeFee_Default() public {
        feeConfigHelper.setDefaultFeeBps(500);
        assertEq(feeConfigHelper.getAmountBeforeFee(EID_1, 950), 1000);
        assertEq(feeConfigHelper.getAmountBeforeFee(EID_2, 950), 1000);
    }

    function test_getAmountBeforeFee_Specific() public {
        feeConfigHelper.setDefaultFeeBps(500);
        feeConfigHelper.setFeeBps(EID_1, 200, true);
        assertEq(feeConfigHelper.getAmountBeforeFee(EID_1, 980), 1000);
        assertEq(feeConfigHelper.getAmountBeforeFee(EID_2, 950), 1000);
    }

    function test_getAmountBeforeFee_SpecificDisabled() public {
        feeConfigHelper.setDefaultFeeBps(500);
        feeConfigHelper.setFeeBps(EID_1, 200, false);
        assertEq(feeConfigHelper.getAmountBeforeFee(EID_1, 950), 1000);
    }

    function test_getAmountBeforeFee_ZeroAmount() public {
        feeConfigHelper.setDefaultFeeBps(500);
        assertEq(feeConfigHelper.getAmountBeforeFee(EID_1, 0), 0);
    }

    function test_getAmountBeforeFee_Rounding() public {
        feeConfigHelper.setDefaultFeeBps(1000);

        // (15 * 10000) / 9000 = 16, getFee(16) = 1, 16-1 = 15.
        assertEq(feeConfigHelper.getAmountBeforeFee(EID_1, 15), 16);
        // (9 * 10000) / 9000 = 10, getFee(10) = 1, 10-1 = 9.
        assertEq(feeConfigHelper.getAmountBeforeFee(EID_1, 9), 10);
        // (1 * 10000) / 9000 = 1, getFee(1) = 0, 1-0 = 1.
        assertEq(feeConfigHelper.getAmountBeforeFee(EID_1, 1), 1);
    }

    function test_getAmountBeforeFee_BoundaryConditions() public {
        // 1 bps (0.01%) — near-zero fee.
        feeConfigHelper.setDefaultFeeBps(1);
        assertEq(feeConfigHelper.getAmountBeforeFee(EID_1, 9999), 10000);
        assertEq(feeConfigHelper.getAmountBeforeFee(EID_1, 1), 1);

        // 9999 bps (99.99%) — near-total fee.
        feeConfigHelper.setDefaultFeeBps(9999);
        // (1 * 10000) / 1 = 10000, getFee(10000) = 9999, 10000-9999 = 1.
        assertEq(feeConfigHelper.getAmountBeforeFee(EID_1, 1), 10000);
    }

    function test_getAmountBeforeFee_Fuzz(uint16 _feeBps, uint224 _amountAfterFee) public {
        _feeBps = uint16(bound(_feeBps, 0, BPS_DENOMINATOR));
        feeConfigHelper.setDefaultFeeBps(_feeBps);

        uint256 amountBefore = feeConfigHelper.getAmountBeforeFee(EID_1, _amountAfterFee);

        if (_feeBps == BPS_DENOMINATOR) {
            assertEq(amountBefore, 0);
        } else if (_feeBps == 0) {
            assertEq(amountBefore, _amountAfterFee);
        } else {
            // Core inverse invariant: `amountBefore - getFee(amountBefore) == amountAfterFee`.
            uint256 fee = feeConfigHelper.getFee(EID_1, amountBefore);
            assertEq(amountBefore - fee, _amountAfterFee);
        }
    }

    function test_storageHash() public pure {
        bytes32 storageHash = keccak256(abi.encode(uint256(keccak256("layerzerov2.storage.feeconfig")) - 1)) &
            ~bytes32(uint256(0xff));
        assertEq(storageHash, 0x19c40dd5c7b9d6e4dbe259e67955cccfb75eaf6c218fbfbd413bfcd8248dd800);
    }
}
