// SPDX-License-Identifier: MIT
pragma solidity ^0.8.22;

import { INexusFeeConfigModule } from "./../../contracts/interfaces/INexusFeeConfigModule.sol";
import { INexusModule } from "./../../contracts/interfaces/INexusModule.sol";
import { NexusTestHelper } from "./../shared/NexusTestHelper.sol";

contract NexusFeeConfigModuleTest is NexusTestHelper {
    uint16 constant BPS_DENOMINATOR = 10_000;
    uint32 constant TOKEN_A = 1;
    uint32 constant DST_EID = 2;

    function _compositeKey() internal view returns (uint256) {
        return aNexus.getNexusId(TOKEN_A, DST_EID);
    }

    function _tokenKey() internal pure returns (uint256) {
        return uint256(TOKEN_A) << 32;
    }

    function _destinationKey() internal pure returns (uint256) {
        return uint256(DST_EID);
    }

    function _globalKey() internal pure returns (uint256) {
        return 0;
    }

    function _feeParam(
        uint256 _id,
        uint128 _priority,
        uint16 _feeBps
    ) internal pure returns (INexusFeeConfigModule.SetFeeBpsParam[] memory params) {
        params = new INexusFeeConfigModule.SetFeeBpsParam[](1);
        params[0] = INexusFeeConfigModule.SetFeeBpsParam({ id: _id, priority: _priority, feeBps: _feeBps });
    }

    // ============ setFeeBps Tests ============

    function test_setFeeBps() public {
        vm.expectEmit(address(aFeeConfigModule));
        emit INexusFeeConfigModule.FeeConfigSet(42, 7, 500);
        aFeeConfigModule.setFeeBps(_feeParam(42, 7, 500));

        INexusFeeConfigModule.FeeConfig memory config = aFeeConfigModule.feeConfig(42);
        assertEq(config.priority, 7);
        assertEq(config.feeBps, 500);
    }

    function test_setFeeBps_MaxBPS() public {
        aFeeConfigModule.setFeeBps(_feeParam(0, 1, BPS_DENOMINATOR));

        INexusFeeConfigModule.FeeConfig memory config = aFeeConfigModule.feeConfig(0);
        assertEq(config.feeBps, BPS_DENOMINATOR);
    }

    function test_setFeeBps_Revert_UnauthorizedRole() public {
        bytes32 role = aFeeConfigModule.FEE_CONFIG_MANAGER_ROLE();
        INexusFeeConfigModule.SetFeeBpsParam[] memory params = _feeParam(0, 1, 100);

        vm.expectRevert(abi.encodeWithSelector(INexusModule.UnauthorizedRole.selector, role, alice));
        vm.prank(alice);
        aFeeConfigModule.setFeeBps(params);
    }

    function test_setFeeBps_Revert_InvalidBps() public {
        vm.expectRevert(abi.encodeWithSelector(INexusFeeConfigModule.InvalidBps.selector, uint16(BPS_DENOMINATOR + 1)));
        aFeeConfigModule.setFeeBps(_feeParam(0, 1, BPS_DENOMINATOR + 1));
    }

    function test_setFeeBps_Fuzz(uint256 _id, uint128 _priority, uint16 _feeBps) public {
        if (_feeBps > BPS_DENOMINATOR) {
            vm.expectRevert(abi.encodeWithSelector(INexusFeeConfigModule.InvalidBps.selector, _feeBps));
            aFeeConfigModule.setFeeBps(_feeParam(_id, _priority, _feeBps));
        } else {
            vm.expectEmit(address(aFeeConfigModule));
            emit INexusFeeConfigModule.FeeConfigSet(_id, _priority, _feeBps);
            aFeeConfigModule.setFeeBps(_feeParam(_id, _priority, _feeBps));

            INexusFeeConfigModule.FeeConfig memory config = aFeeConfigModule.feeConfig(_id);
            assertEq(config.priority, _priority);
            assertEq(config.feeBps, _feeBps);
        }
    }

    // ============ feeConfig Tests ============

    function test_feeConfig() public {
        aFeeConfigModule.setFeeBps(_feeParam(42, 7, 500));

        INexusFeeConfigModule.FeeConfig memory config = aFeeConfigModule.feeConfig(42);
        assertEq(config.priority, 7);
        assertEq(config.feeBps, 500);
    }

    function test_feeConfig_DefaultZero() public view {
        INexusFeeConfigModule.FeeConfig memory config = aFeeConfigModule.feeConfig(1);
        assertEq(config.priority, 0);
        assertEq(config.feeBps, 0);
    }

    // ============ getFee Tests ============

    function test_getFee_DefaultZero() public view {
        assertEq(aFeeConfigModule.getFee(_compositeKey(), 1 ether), 0);
    }

    function test_getFee_GlobalConfig() public {
        aFeeConfigModule.setFeeBps(_feeParam(_globalKey(), 1, 1000)); // 10%

        assertEq(aFeeConfigModule.getFee(_compositeKey(), 1 ether), 0.1 ether);
    }

    function test_getFee_TokenOnlyConfig() public {
        aFeeConfigModule.setFeeBps(_feeParam(_tokenKey(), 1, 500)); // 5%

        assertEq(aFeeConfigModule.getFee(_compositeKey(), 1 ether), 0.05 ether);
    }

    function test_getFee_DestinationOnlyConfig() public {
        aFeeConfigModule.setFeeBps(_feeParam(_destinationKey(), 1, 200)); // 2%

        assertEq(aFeeConfigModule.getFee(_compositeKey(), 1 ether), 0.02 ether);
    }

    function test_getFee_CompositeConfig() public {
        aFeeConfigModule.setFeeBps(_feeParam(_compositeKey(), 1, 300)); // 3%

        assertEq(aFeeConfigModule.getFee(_compositeKey(), 1 ether), 0.03 ether);
    }

    function test_getFee_BoundaryConditions() public {
        aFeeConfigModule.setFeeBps(_feeParam(_globalKey(), 1, 500)); // 5%
        assertEq(aFeeConfigModule.getFee(_compositeKey(), 0), 0);

        aFeeConfigModule.setFeeBps(_feeParam(_globalKey(), 1, BPS_DENOMINATOR)); // 100%
        assertEq(aFeeConfigModule.getFee(_compositeKey(), 100), 100);

        aFeeConfigModule.setFeeBps(_feeParam(_globalKey(), 1, 0)); // 0%
        assertEq(aFeeConfigModule.getFee(_compositeKey(), 1000), 0);
    }

    function test_getFee_Rounding() public {
        aFeeConfigModule.setFeeBps(_feeParam(_globalKey(), 1, 1000)); // 10%
        assertEq(aFeeConfigModule.getFee(_compositeKey(), 15), 1);
        assertEq(aFeeConfigModule.getFee(_compositeKey(), 9), 0);
    }

    function test_getFee_DoesNotAffectOtherKeys() public {
        uint32 otherToken = 2;
        uint256 otherComposite = aNexus.getNexusId(otherToken, DST_EID);
        aFeeConfigModule.setFeeBps(_feeParam(_compositeKey(), 1, 1000));

        assertEq(aFeeConfigModule.getFee(_compositeKey(), 1 ether), 0.1 ether);
        assertEq(aFeeConfigModule.getFee(otherComposite, 1 ether), 0);
    }

    function test_getFee_Fuzz_Amount(uint16 _feeBps, uint240 _amount) public {
        _feeBps = uint16(bound(_feeBps, 0, BPS_DENOMINATOR));
        aFeeConfigModule.setFeeBps(_feeParam(_globalKey(), 1, _feeBps));

        uint256 expectedFee = _feeBps == 0 ? 0 : (uint256(_amount) * _feeBps) / BPS_DENOMINATOR;
        assertEq(aFeeConfigModule.getFee(_compositeKey(), _amount), expectedFee);
    }

    function test_getFee_Tiebreak_GlobalOverridesComposite() public {
        aFeeConfigModule.setFeeBps(_feeParam(_compositeKey(), 1, 500)); // 5%
        aFeeConfigModule.setFeeBps(_feeParam(_globalKey(), 1, 1000)); // 10%

        assertEq(aFeeConfigModule.getFee(_compositeKey(), 1 ether), 0.1 ether);
    }

    function test_getFee_Tiebreak_GlobalOverridesTokenOnly() public {
        aFeeConfigModule.setFeeBps(_feeParam(_tokenKey(), 1, 300));
        aFeeConfigModule.setFeeBps(_feeParam(_globalKey(), 1, 1000));

        assertEq(aFeeConfigModule.getFee(_compositeKey(), 1 ether), 0.1 ether);
    }

    function test_getFee_Tiebreak_GlobalOverridesDestOnly() public {
        aFeeConfigModule.setFeeBps(_feeParam(_destinationKey(), 1, 200));
        aFeeConfigModule.setFeeBps(_feeParam(_globalKey(), 1, 1000));

        assertEq(aFeeConfigModule.getFee(_compositeKey(), 1 ether), 0.1 ether);
    }

    function test_getFee_Tiebreak_DestOnlyOverridesTokenOnly() public {
        aFeeConfigModule.setFeeBps(_feeParam(_tokenKey(), 1, 500));
        aFeeConfigModule.setFeeBps(_feeParam(_destinationKey(), 1, 1000));

        assertEq(aFeeConfigModule.getFee(_compositeKey(), 1 ether), 0.1 ether);
    }

    function test_getFee_HigherPriorityWins_CompositeOverridesGlobal() public {
        aFeeConfigModule.setFeeBps(_feeParam(_globalKey(), 1, 1000));
        aFeeConfigModule.setFeeBps(_feeParam(_compositeKey(), 5, 500));

        assertEq(aFeeConfigModule.getFee(_compositeKey(), 1 ether), 0.05 ether);
    }

    function test_getFee_HigherPriorityWins_TokenOverridesGlobal() public {
        aFeeConfigModule.setFeeBps(_feeParam(_globalKey(), 1, 1000));
        aFeeConfigModule.setFeeBps(_feeParam(_tokenKey(), 5, 300));

        assertEq(aFeeConfigModule.getFee(_compositeKey(), 1 ether), 0.03 ether);
    }

    function test_getFee_MaxPriority_EarlyReturn_Global() public {
        aFeeConfigModule.setFeeBps(_feeParam(_compositeKey(), type(uint128).max, 500));
        aFeeConfigModule.setFeeBps(_feeParam(_globalKey(), type(uint128).max, 1000));

        assertEq(aFeeConfigModule.getFee(_compositeKey(), 1 ether), 0.1 ether);
    }

    function test_getFee_MaxPriority_EarlyReturn_DestOnly() public {
        aFeeConfigModule.setFeeBps(_feeParam(_compositeKey(), type(uint128).max, 500));
        aFeeConfigModule.setFeeBps(_feeParam(_destinationKey(), type(uint128).max, 200));

        assertEq(aFeeConfigModule.getFee(_compositeKey(), 1 ether), 0.02 ether);
    }

    function test_getFee_MaxPriority_EarlyReturn_TokenOnly() public {
        aFeeConfigModule.setFeeBps(_feeParam(_compositeKey(), type(uint128).max, 500));
        aFeeConfigModule.setFeeBps(_feeParam(_tokenKey(), type(uint128).max, 200));

        assertEq(aFeeConfigModule.getFee(_compositeKey(), 1 ether), 0.02 ether);
    }

    function test_getFee_Fuzz_Priority(uint128 _globalPriority, uint128 _compositePriority) public {
        uint16 globalBps = 1000;
        uint16 compositeBps = 500;

        aFeeConfigModule.setFeeBps(_feeParam(_globalKey(), _globalPriority, globalBps));
        aFeeConfigModule.setFeeBps(_feeParam(_compositeKey(), _compositePriority, compositeBps));

        uint256 fee = aFeeConfigModule.getFee(_compositeKey(), 1 ether);
        if (_compositePriority > _globalPriority) {
            assertEq(fee, 0.05 ether);
        } else {
            assertEq(fee, 0.1 ether);
        }
    }

    // ============ getAmountBeforeFee Tests ============

    function test_getAmountBeforeFee_ZeroBps() public view {
        assertEq(aFeeConfigModule.getAmountBeforeFee(_compositeKey(), 0), 0);
        assertEq(aFeeConfigModule.getAmountBeforeFee(_compositeKey(), 1000), 1000);
        assertEq(aFeeConfigModule.getAmountBeforeFee(_compositeKey(), type(uint256).max), type(uint256).max);
    }

    function test_getAmountBeforeFee_MaxBps() public {
        aFeeConfigModule.setFeeBps(_feeParam(_globalKey(), 1, BPS_DENOMINATOR));

        assertEq(aFeeConfigModule.getAmountBeforeFee(_compositeKey(), 0), 0);
        assertEq(aFeeConfigModule.getAmountBeforeFee(_compositeKey(), 1000), 0);
        assertEq(aFeeConfigModule.getAmountBeforeFee(_compositeKey(), type(uint256).max), 0);
    }

    function test_getAmountBeforeFee_NormalFee() public {
        aFeeConfigModule.setFeeBps(_feeParam(_globalKey(), 1, 1000)); // 10%

        uint256 beforeFee = aFeeConfigModule.getAmountBeforeFee(_compositeKey(), 0.9 ether);
        assertEq(beforeFee, 1 ether);
    }

    function test_getAmountBeforeFee_ZeroAmount() public {
        aFeeConfigModule.setFeeBps(_feeParam(_globalKey(), 1, 500));
        assertEq(aFeeConfigModule.getAmountBeforeFee(_compositeKey(), 0), 0);
    }

    function test_getAmountBeforeFee_Rounding() public {
        aFeeConfigModule.setFeeBps(_feeParam(_globalKey(), 1, 1000)); // 10%

        // (15 * 10000) / 9000 = 16, getFee(16) = 1, 16 - 1 = 15.
        assertEq(aFeeConfigModule.getAmountBeforeFee(_compositeKey(), 15), 16);
        // (9 * 10000) / 9000 = 10, getFee(10) = 1, 10 - 1 = 9.
        assertEq(aFeeConfigModule.getAmountBeforeFee(_compositeKey(), 9), 10);
        // (1 * 10000) / 9000 = 1, getFee(1) = 0, 1 - 0 = 1.
        assertEq(aFeeConfigModule.getAmountBeforeFee(_compositeKey(), 1), 1);
    }

    function test_getAmountBeforeFee_BoundaryConditions() public {
        // 1 bps (0.01%) — near-zero fee.
        aFeeConfigModule.setFeeBps(_feeParam(_globalKey(), 1, 1));
        assertEq(aFeeConfigModule.getAmountBeforeFee(_compositeKey(), 9999), 10000);
        assertEq(aFeeConfigModule.getAmountBeforeFee(_compositeKey(), 1), 1);

        // 9999 bps (99.99%) — near-total fee.
        aFeeConfigModule.setFeeBps(_feeParam(_globalKey(), 1, 9999));
        // (1 * 10000) / 1 = 10000, getFee(10000) = 9999, 10000 - 9999 = 1.
        assertEq(aFeeConfigModule.getAmountBeforeFee(_compositeKey(), 1), 10000);
    }

    function test_getAmountBeforeFee_Fuzz(uint16 _feeBps, uint224 _amountAfterFee) public {
        _feeBps = uint16(bound(_feeBps, 0, BPS_DENOMINATOR));
        aFeeConfigModule.setFeeBps(_feeParam(_globalKey(), 1, _feeBps));

        uint256 amountBefore = aFeeConfigModule.getAmountBeforeFee(_compositeKey(), _amountAfterFee);

        if (_feeBps == BPS_DENOMINATOR) {
            assertEq(amountBefore, 0);
        } else if (_feeBps == 0) {
            assertEq(amountBefore, _amountAfterFee);
        } else {
            // Core inverse invariant: `amountBefore - getFee(amountBefore) == amountAfterFee`.
            uint256 fee = aFeeConfigModule.getFee(_compositeKey(), amountBefore);
            assertEq(amountBefore - fee, _amountAfterFee);
        }
    }

    // ============ feeConfigCount Tests ============

    function test_feeConfigCount_DefaultZero() public view {
        assertEq(aFeeConfigModule.feeConfigCount(), 0);
    }

    function test_feeConfigCount_IncrementsOnNewKeys() public {
        aFeeConfigModule.setFeeBps(_feeParam(1, 1, 100));
        assertEq(aFeeConfigModule.feeConfigCount(), 1);

        aFeeConfigModule.setFeeBps(_feeParam(2, 1, 200));
        assertEq(aFeeConfigModule.feeConfigCount(), 2);

        aFeeConfigModule.setFeeBps(_feeParam(3, 1, 300));
        assertEq(aFeeConfigModule.feeConfigCount(), 3);
    }

    function test_feeConfigCount_DuplicateKeyDoesNotIncrement() public {
        aFeeConfigModule.setFeeBps(_feeParam(1, 1, 100));
        assertEq(aFeeConfigModule.feeConfigCount(), 1);

        aFeeConfigModule.setFeeBps(_feeParam(1, 5, 500));
        assertEq(aFeeConfigModule.feeConfigCount(), 1);
    }

    function test_feeConfigCount_RemovesOnZeroConfig() public {
        aFeeConfigModule.setFeeBps(_feeParam(1, 5, 500));
        assertEq(aFeeConfigModule.feeConfigCount(), 1);

        aFeeConfigModule.setFeeBps(_feeParam(1, 0, 0));
        assertEq(aFeeConfigModule.feeConfigCount(), 0);
        (uint256[] memory ids, ) = aFeeConfigModule.getFeeConfigs(0, 10);
        assertEq(ids.length, 0);
    }

    function test_feeConfigCount_PartialRemoval() public {
        aFeeConfigModule.setFeeBps(_feeParam(1, 5, 500));
        aFeeConfigModule.setFeeBps(_feeParam(2, 3, 300));
        aFeeConfigModule.setFeeBps(_feeParam(3, 1, 100));
        assertEq(aFeeConfigModule.feeConfigCount(), 3);

        aFeeConfigModule.setFeeBps(_feeParam(2, 0, 0));
        assertEq(aFeeConfigModule.feeConfigCount(), 2);

        (uint256[] memory ids, ) = aFeeConfigModule.getFeeConfigs(0, 10);
        assertEq(ids.length, 2);
    }

    function test_feeConfigCount_ReAddAfterRemoval() public {
        aFeeConfigModule.setFeeBps(_feeParam(1, 5, 500));
        aFeeConfigModule.setFeeBps(_feeParam(1, 0, 0));
        assertEq(aFeeConfigModule.feeConfigCount(), 0);

        aFeeConfigModule.setFeeBps(_feeParam(1, 10, 999));
        assertEq(aFeeConfigModule.feeConfigCount(), 1);
    }

    function test_feeConfigCount_PriorityZeroFeeBpsNonZeroNotRemoved() public {
        aFeeConfigModule.setFeeBps(_feeParam(1, 0, 500));
        assertEq(aFeeConfigModule.feeConfigCount(), 1);
    }

    function test_feeConfigCount_FeeBpsZeroPriorityNonZeroNotRemoved() public {
        aFeeConfigModule.setFeeBps(_feeParam(1, 5, 0));
        assertEq(aFeeConfigModule.feeConfigCount(), 1);
    }

    // ============ getFeeConfigs Tests ============

    function test_getFeeConfigs_Empty() public view {
        (uint256[] memory ids, INexusFeeConfigModule.FeeConfig[] memory configs) = aFeeConfigModule.getFeeConfigs(
            0,
            10
        );
        assertEq(ids.length, 0);
        assertEq(configs.length, 0);
    }

    function test_getFeeConfigs_ReturnsAllKeys() public {
        aFeeConfigModule.setFeeBps(_feeParam(10, 1, 100));
        aFeeConfigModule.setFeeBps(_feeParam(20, 2, 200));
        aFeeConfigModule.setFeeBps(_feeParam(30, 3, 300));

        (uint256[] memory ids, INexusFeeConfigModule.FeeConfig[] memory configs) = aFeeConfigModule.getFeeConfigs(
            0,
            10
        );
        assertEq(ids.length, 3);
        assertEq(configs.length, 3);

        for (uint256 i = 0; i < ids.length; i++) {
            assertTrue(configs[i].priority > 0);
        }
    }

    function test_getFeeConfigs_Pagination() public {
        for (uint256 i = 1; i <= 5; i++) {
            aFeeConfigModule.setFeeBps(_feeParam(i, uint128(i), uint16(i * 100)));
        }

        (uint256[] memory page1, INexusFeeConfigModule.FeeConfig[] memory configs1) = aFeeConfigModule.getFeeConfigs(
            0,
            2
        );
        assertEq(page1.length, 2);
        assertEq(configs1.length, 2);

        (uint256[] memory page2, ) = aFeeConfigModule.getFeeConfigs(2, 2);
        assertEq(page2.length, 2);

        (uint256[] memory page3, ) = aFeeConfigModule.getFeeConfigs(4, 2);
        assertEq(page3.length, 1);
    }

    // ============ Storage Hash Tests ============

    function test_storageHash() public pure {
        bytes32 storageHash = keccak256(abi.encode(uint256(keccak256("layerzerov2.storage.nexusfeeconfig")) - 1)) &
            ~bytes32(uint256(0xff));
        assertEq(storageHash, 0x5268a9a613634dcf33189cc90ebb850aa75d29be6bcd96969ede23ed9c30ee00);
    }
}
