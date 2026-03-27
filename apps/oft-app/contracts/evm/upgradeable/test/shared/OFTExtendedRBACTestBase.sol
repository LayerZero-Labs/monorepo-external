// SPDX-License-Identifier: MIT
pragma solidity ^0.8.22;

import { IOAppMsgInspector } from "@layerzerolabs/oapp-evm-impl/contracts/interfaces/IOAppMsgInspector.sol";
import {
    IOFT,
    SendParam,
    OFTLimit,
    OFTFeeDetail,
    OFTReceipt,
    MessagingFee
} from "@layerzerolabs/oft-evm-impl/contracts/interfaces/IOFT.sol";
import { TestHelperOz5 } from "@layerzerolabs/test-devtools-evm-foundry/contracts/TestHelperOz5.sol";
import { RejectingMsgInspector } from "@layerzerolabs/test-utils-evm/contracts/mocks/RejectingMsgInspector.sol";
import { IPauseByID } from "@layerzerolabs/utils-evm-impl/contracts/interfaces/IPauseByID.sol";
import { IRateLimiter } from "@layerzerolabs/utils-evm-impl/contracts/interfaces/IRateLimiter.sol";
import { IAccessControl } from "@openzeppelin/contracts/access/IAccessControl.sol";
import { TransparentUpgradeableProxy } from "@openzeppelin/contracts/proxy/transparent/TransparentUpgradeableProxy.sol";
import { OFTCoreExtendedRBACUpgradeable } from "./../../contracts/extended/OFTCoreExtendedRBACUpgradeable.sol";

/**
 * @notice Interface for OFT Extended harness test methods.
 * @dev Exposes internal `_debit` and `_credit` functions for testing.
 */
interface IOFTExtendedHarness {
    function debit(
        address _from,
        uint256 _amountLD,
        uint256 _minAmountLD,
        uint32 _dstEid
    ) external returns (uint256 amountSentLD, uint256 amountReceivedLD);

    function credit(address _to, uint256 _amountLD, uint32 _srcEid) external returns (uint256 amountReceivedLD);
}

/**
 * @notice Base test contract for OFT Extended RBAC tests.
 * @dev Provides common state variables, helper functions, and shared tests for
 * `OFTBurnMintExtendedRBACUpgradeable`, `OFTLockUnlockExtendedRBACUpgradeable`, and `OFTNativeExtendedRBACUpgradeable` tests.
 */
abstract contract OFTExtendedRBACTestBase is TestHelperOz5 {
    address endpoint;

    address admin = makeAddr("admin");
    address alice = makeAddr("alice");
    address bob = makeAddr("bob");

    uint32 constant DST_EID = 2;
    uint16 constant BPS_DENOMINATOR = 10_000;
    uint16 constant FEE_BPS = 1_000; // 10%

    // ============ Endpoint Setup ============

    /** @notice Sets up two `SimpleMessageLib` endpoints and assigns `endpoint`. */
    function _setUpTestEndpoints() internal {
        setUpEndpoints(2, LibraryType.SimpleMessageLib);
        endpoint = address(endpointSetup.endpointList[0]);
    }

    // ============ Abstract Methods ============

    /**
     * @notice Returns the adapter instance for shared tests.
     * @dev Must be implemented by child contracts.
     */
    function _adapter() internal view virtual returns (OFTCoreExtendedRBACUpgradeable);

    /**
     * @notice Funds alice for debit operations.
     * @dev For ERC20: mints tokens and approves adapter. For Native: uses vm.deal on adapter.
     */
    function _fundForDebit(uint256 _amount) internal virtual;

    /**
     * @notice Funds the adapter for credit operations.
     * @dev For ERC20: mints tokens to adapter. For Native: uses vm.deal on adapter.
     */
    function _fundAdapterForCredit(uint256 _amount) internal virtual;

    /**
     * @notice Reads the underlying token balance of `_account`.
     * @dev For ERC20: returns `token.balanceOf(_account)`. For Native: returns `_account.balance`.
     */
    function _readBalance(address _account) internal view virtual returns (uint256);

    // ============ Internal Helpers ============

    /** @notice Returns the adapter as `IOFTExtendedHarness` for calling `debit` and `credit`. */
    function _harness() internal view returns (IOFTExtendedHarness) {
        return IOFTExtendedHarness(address(_adapter()));
    }

    // ============ Helper Functions ============

    function _deployTransparentProxy(
        address _impl,
        address _proxyAdmin,
        bytes memory _initData
    ) internal returns (address) {
        return address(new TransparentUpgradeableProxy(_impl, _proxyAdmin, _initData));
    }

    function _buildSendParam(
        uint32 _dstEid,
        address _to,
        uint256 _amountLD,
        uint256 _minAmountLD
    ) internal pure returns (SendParam memory) {
        return
            SendParam({
                dstEid: _dstEid,
                to: bytes32(uint256(uint160(_to))),
                amountLD: _amountLD,
                minAmountLD: _minAmountLD,
                extraOptions: bytes(""),
                composeMsg: bytes(""),
                oftCmd: bytes("")
            });
    }

    function _buildDefaultRateLimitConfig(
        uint256 _id,
        uint96 _limit,
        uint32 _window
    ) internal pure returns (IRateLimiter.SetRateLimitConfigParam[] memory configs) {
        configs = new IRateLimiter.SetRateLimitConfigParam[](1);
        configs[0] = IRateLimiter.SetRateLimitConfigParam({
            id: _id,
            config: IRateLimiter.RateLimitConfig({
                overrideDefaultConfig: true,
                outboundEnabled: true,
                inboundEnabled: true,
                netAccountingEnabled: true,
                addressExemptionEnabled: false,
                outboundLimit: _limit,
                inboundLimit: _limit,
                outboundWindow: _window,
                inboundWindow: _window
            })
        });
    }

    function _buildRateLimitConfig(
        uint256 _id,
        uint96 _outboundLimit,
        uint96 _inboundLimit,
        uint32 _outboundWindow,
        uint32 _inboundWindow
    ) internal pure returns (IRateLimiter.SetRateLimitConfigParam[] memory configs) {
        configs = new IRateLimiter.SetRateLimitConfigParam[](1);
        configs[0] = IRateLimiter.SetRateLimitConfigParam({
            id: _id,
            config: IRateLimiter.RateLimitConfig({
                overrideDefaultConfig: true,
                outboundEnabled: true,
                inboundEnabled: true,
                netAccountingEnabled: true,
                addressExemptionEnabled: false,
                outboundLimit: _outboundLimit,
                inboundLimit: _inboundLimit,
                outboundWindow: _outboundWindow,
                inboundWindow: _inboundWindow
            })
        });
    }

    // ============ Shared Tests: quoteOFT ============

    function test_quoteOFT() public {
        vm.prank(admin);
        _adapter().setDefaultFeeBps(FEE_BPS);

        SendParam memory sendParam = _buildSendParam(DST_EID, bob, 1 ether, 0);

        (OFTLimit memory limit, OFTFeeDetail[] memory details, OFTReceipt memory receipt) = _adapter().quoteOFT(
            sendParam
        );

        assertEq(limit.minAmountLD, 0);
        assertEq(limit.maxAmountLD, (uint256(1_000_000 ether) * BPS_DENOMINATOR) / (BPS_DENOMINATOR - FEE_BPS));

        assertEq(receipt.amountSentLD, 1 ether);
        assertEq(receipt.amountReceivedLD, 0.9 ether);

        assertEq(details.length, 1);
        assertEq(details[0].feeAmountLD, int256(0.1 ether));
    }

    function test_quoteOFT_Paused() public {
        vm.prank(admin);
        _adapter().setDefaultPaused(true);

        SendParam memory sendParam = _buildSendParam(DST_EID, bob, 1 ether, 0);

        (OFTLimit memory limit, , ) = _adapter().quoteOFT(sendParam);

        assertEq(limit.minAmountLD, 0);
        assertEq(limit.maxAmountLD, 0); // `maxAmountLD` is 0 when paused
    }

    function test_quoteOFT_RateLimiterUsage() public {
        vm.prank(admin);
        _adapter().setRateLimitConfigs(_buildDefaultRateLimitConfig(DST_EID, 100 ether, 100));

        SendParam memory sendParam = _buildSendParam(DST_EID, bob, 1 ether, 0);

        // Initially, `maxAmountLD` should match outbound limit.
        (OFTLimit memory limit, , ) = _adapter().quoteOFT(sendParam);
        assertEq(limit.maxAmountLD, 100 ether);

        // Use up 60 ether of the rate limit.
        _fundForDebit(60 ether);
        _harness().debit(alice, 60 ether, 60 ether, DST_EID);

        // After usage, `maxAmountLD` should be reduced.
        (limit, , ) = _adapter().quoteOFT(sendParam);
        assertEq(limit.maxAmountLD, 40 ether);

        // Use up another 40 ether to max out the limit.
        _fundForDebit(40 ether);
        _harness().debit(alice, 40 ether, 40 ether, DST_EID);

        // After maxing out, `maxAmountLD` should be 0.
        (limit, , ) = _adapter().quoteOFT(sendParam);
        assertEq(limit.maxAmountLD, 0);
    }

    function test_quoteOFT_OutboundRateLimitDisabled() public {
        IRateLimiter.SetRateLimitConfigParam[] memory configs = new IRateLimiter.SetRateLimitConfigParam[](1);
        configs[0] = IRateLimiter.SetRateLimitConfigParam({
            id: DST_EID,
            config: IRateLimiter.RateLimitConfig({
                overrideDefaultConfig: true,
                outboundEnabled: false,
                inboundEnabled: true,
                netAccountingEnabled: false,
                addressExemptionEnabled: false,
                outboundLimit: 100 ether,
                inboundLimit: 100 ether,
                outboundWindow: 100,
                inboundWindow: 100
            })
        });

        vm.prank(admin);
        _adapter().setRateLimitConfigs(configs);

        SendParam memory sendParam = _buildSendParam(DST_EID, bob, 1 ether, 0);

        (OFTLimit memory limit, , ) = _adapter().quoteOFT(sendParam);

        // When outbound rate limit is disabled, `maxAmountLD` should be unlimited.
        assertEq(limit.maxAmountLD, type(uint256).max);
    }

    function test_quoteOFT_GloballyDisabled() public {
        vm.startPrank(admin);
        _adapter().setRateLimitConfigs(_buildDefaultRateLimitConfig(DST_EID, 100 ether, 100));
        _adapter().setRateLimitGlobalConfig(
            IRateLimiter.RateLimitGlobalConfig({ useGlobalState: false, isGloballyDisabled: true })
        );
        vm.stopPrank();

        SendParam memory sendParam = _buildSendParam(DST_EID, bob, 1 ether, 0);

        (OFTLimit memory limit, , ) = _adapter().quoteOFT(sendParam);

        // When rate limiter is globally disabled, `maxAmountLD` should be unlimited.
        assertEq(limit.maxAmountLD, type(uint256).max);
    }

    function test_quoteOFT_RateLimiterWithFee() public {
        uint96 outboundLimit = 100 ether;

        vm.startPrank(admin);
        _adapter().setRateLimitConfigs(_buildDefaultRateLimitConfig(DST_EID, outboundLimit, 100));
        _adapter().setDefaultFeeBps(FEE_BPS);
        vm.stopPrank();

        SendParam memory sendParam = _buildSendParam(DST_EID, bob, 1 ether, 0);

        /// @dev `maxAmountLD` = `rateLimitAvailable` * `BPS_DENOMINATOR` / (`BPS_DENOMINATOR` - `feeBps`).
        (OFTLimit memory limit, , ) = _adapter().quoteOFT(sendParam);
        assertEq(limit.maxAmountLD, (uint256(outboundLimit) * BPS_DENOMINATOR) / (BPS_DENOMINATOR - FEE_BPS));

        /// @dev Send 50 ether with 10% fee: fee = 5 ether, received = 45 ether.
        _fundForDebit(50 ether);
        _harness().debit(alice, 50 ether, 0, DST_EID);

        /// @dev Remaining outbound capacity = 100 - 45 = 55 ether.
        uint256 remainingAvailable = 55 ether;
        (limit, , ) = _adapter().quoteOFT(sendParam);
        assertEq(limit.maxAmountLD, (remainingAvailable * BPS_DENOMINATOR) / (BPS_DENOMINATOR - FEE_BPS));

        /// @dev Sending the reported `maxAmountLD` should succeed (rate limit not exceeded).
        uint256 maxSendable = limit.maxAmountLD;
        _fundForDebit(maxSendable);
        (, uint256 received) = _harness().debit(alice, maxSendable, 0, DST_EID);
        assertLe(received, remainingAvailable);
    }

    function test_quoteOFT_RateLimiterWithMaxFee() public {
        uint96 outboundLimit = 100 ether;

        vm.startPrank(admin);
        _adapter().setRateLimitConfigs(_buildDefaultRateLimitConfig(DST_EID, outboundLimit, 100));
        _adapter().setDefaultFeeBps(BPS_DENOMINATOR);
        vm.stopPrank();

        SendParam memory sendParam = _buildSendParam(DST_EID, bob, 1 ether, 0);

        (OFTLimit memory limit, , ) = _adapter().quoteOFT(sendParam);
        assertEq(limit.maxAmountLD, 0);
    }

    function test_quoteOFT_RateLimiterWithFee_Fuzz(uint96 _limit, uint16 _feeBps) public {
        _limit = uint96(bound(_limit, 1 ether, 1_000_000 ether));
        _feeBps = uint16(bound(_feeBps, 1, 5000)); // 0.01% to 50%

        vm.startPrank(admin);
        _adapter().setRateLimitConfigs(_buildDefaultRateLimitConfig(DST_EID, _limit, 100));
        _adapter().setDefaultFeeBps(_feeBps);
        vm.stopPrank();

        SendParam memory sendParam = _buildSendParam(DST_EID, bob, 1 ether, 0);
        (OFTLimit memory limit, , ) = _adapter().quoteOFT(sendParam);

        /// @dev Verify `maxAmountLD` formula: `rateLimitAvailable * BPS_DENOMINATOR / (BPS_DENOMINATOR - feeBps)`.
        uint256 expectedMax = (uint256(_limit) * BPS_DENOMINATOR) / (BPS_DENOMINATOR - uint256(_feeBps));
        assertEq(limit.maxAmountLD, expectedMax);

        /// @dev Verify sending `maxAmountLD` succeeds and received does not exceed the rate limit.
        _fundForDebit(limit.maxAmountLD);
        (, uint256 received) = _harness().debit(alice, limit.maxAmountLD, 0, DST_EID);
        assertLe(received, _limit);
    }

    // ============ Shared Tests: Rate Limiter ============

    function test_setRateLimitConfig_Fuzz(uint96 _limit) public {
        vm.prank(admin);
        _adapter().setRateLimitConfigs(_buildDefaultRateLimitConfig(DST_EID, _limit, 0));

        IRateLimiter.RateLimit memory limit = _adapter().rateLimits(uint256(DST_EID));
        assertEq(limit.outboundLimit, _limit);
        assertEq(limit.inboundLimit, _limit);
    }

    function test_rateLimit_Inflow() public {
        vm.prank(admin);
        _adapter().setRateLimitConfigs(_buildRateLimitConfig(DST_EID, 0, 100 ether, 0, 100));

        _fundAdapterForCredit(1000 ether);

        // Credit 50 ether - should pass.
        _harness().credit(alice, 50 ether, DST_EID);

        // Credit 51 ether - should fail (exceeds 100).
        vm.expectRevert();
        _harness().credit(alice, 51 ether, DST_EID);
    }

    function test_rateLimit_Outflow_WithFee_Success() public {
        vm.startPrank(admin);
        _adapter().setRateLimitConfigs(_buildRateLimitConfig(DST_EID, 90 ether, 100 ether, 100, 100));
        _adapter().setDefaultFeeBps(FEE_BPS);
        vm.stopPrank();

        _fundForDebit(100 ether);

        // Fee = 10 ether, Received = 90 ether, Limit = 90 ether.
        // Should PASS because rate limit applies to received (90) which is <= Limit (90).
        _harness().debit(alice, 100 ether, 90 ether, DST_EID);
    }

    function test_rateLimit_Outflow_WithFee_Revert_ExceedsLimit() public {
        vm.startPrank(admin);
        _adapter().setRateLimitConfigs(_buildRateLimitConfig(DST_EID, 90 ether, 100 ether, 100, 100));
        _adapter().setDefaultFeeBps(FEE_BPS);
        vm.stopPrank();

        _fundForDebit(102 ether);

        // Fee = 10.2 ether, Received = 91.8 ether, Limit = 90 ether.
        // Should FAIL because received (91.8) > Limit (90). Available = 90, Requested = 91.8.
        vm.expectRevert(abi.encodeWithSelector(IRateLimiter.RateLimitExceeded.selector, 90 ether, 91.8 ether));
        _harness().debit(alice, 102 ether, 0, DST_EID);
    }

    // ============ Shared Tests: Pausable ============

    function test_pause_unpause() public {
        vm.startPrank(admin);
        _adapter().setDefaultPaused(true);
        assertTrue(_adapter().isPaused(DST_EID));
        vm.stopPrank();

        _fundForDebit(100 ether);

        vm.expectRevert(abi.encodeWithSelector(IPauseByID.Paused.selector, DST_EID));
        _harness().debit(alice, 100 ether, 100 ether, DST_EID);

        vm.prank(admin);
        _adapter().setDefaultPaused(false);
        assertFalse(_adapter().isPaused(DST_EID));

        _harness().debit(alice, 100 ether, 100 ether, DST_EID);
    }

    // ============ Shared Tests: Fee Configuration ============

    function test_setFeeDeposit() public {
        vm.prank(admin);
        _adapter().setFeeDeposit(bob);
        assertEq(_adapter().feeDeposit(), bob);
    }

    function test_setFeeDeposit_Revert_Unauthorized() public {
        vm.expectRevert(
            abi.encodeWithSelector(
                IAccessControl.AccessControlUnauthorizedAccount.selector,
                alice,
                _adapter().DEFAULT_ADMIN_ROLE()
            )
        );
        vm.prank(alice);
        _adapter().setFeeDeposit(bob);
    }

    function test_debit_PushesFees() public {
        vm.prank(admin);
        _adapter().setDefaultFeeBps(FEE_BPS);

        _fundForDebit(1 ether);

        uint256 feeRecipientBefore = _readBalance(admin);
        _harness().debit(alice, 1 ether, 0, DST_EID);

        assertEq(_readBalance(admin) - feeRecipientBefore, 0.1 ether);
    }

    // ============ Shared Tests: Message Inspection ============

    function test_send_Revert_MsgInspection() public virtual {
        uint256 amount = 1 ether;
        uint256 nativeFee = 0.01 ether;

        _fundForDebit(amount);
        vm.deal(alice, nativeFee);

        SendParam memory sendParam = _buildSendParam(DST_EID, bob, amount, amount);

        // Set up a rejecting message inspector.
        RejectingMsgInspector inspector = new RejectingMsgInspector();
        vm.prank(admin);
        _adapter().setMsgInspector(address(inspector));

        // Build expected message using `OFTMsgCodec` format: (`sendTo`, `amountSD`).
        bytes memory message = abi.encodePacked(sendParam.to, uint64(amount / 1e12));

        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(IOAppMsgInspector.InspectionFailed.selector, alice, message, bytes("")));
        _adapter().send{ value: nativeFee }(sendParam, MessagingFee({ nativeFee: nativeFee, lzTokenFee: 0 }), alice);
    }

    // ============ Shared Tests: Credit ============

    function test_credit() public {
        _fundAdapterForCredit(1 ether);

        uint256 balanceBefore = _readBalance(alice);
        uint256 received = _harness().credit(alice, 1 ether, DST_EID);

        assertEq(received, 1 ether);
        assertEq(_readBalance(alice) - balanceBefore, 1 ether);
    }

    function test_credit_Fuzz(uint256 _amount) public {
        _amount = bound(_amount, 0, 1_000_000 ether);
        _fundAdapterForCredit(_amount);

        uint256 balanceBefore = _readBalance(alice);
        uint256 received = _harness().credit(alice, _amount, DST_EID);

        assertEq(received, _amount);
        assertEq(_readBalance(alice) - balanceBefore, _amount);
    }

    // ============ Shared Tests: Slippage ============

    function test_debit_Revert_SlippageExceeded() public {
        vm.prank(admin);
        _adapter().setDefaultFeeBps(FEE_BPS);

        uint256 amount = 1 ether;
        _fundForDebit(amount);

        vm.expectRevert(abi.encodeWithSelector(IOFT.SlippageExceeded.selector, 0.9 ether, 0.95 ether));
        _harness().debit(alice, amount, 0.95 ether, DST_EID);
    }

    // ============ Shared Tests: Dust ============

    function test_debit_Dust() public virtual {
        uint256 amount = 1 ether + 1e6; // 1e6 wei of dust
        _fundForDebit(amount);

        (uint256 sent, uint256 received) = _harness().debit(alice, amount, 1 ether, DST_EID);

        assertEq(sent, amount);
        assertEq(received, 1 ether);
        assertEq(_readBalance(admin), sent - received);
    }

    function test_debit_WithFee_Dust() public {
        vm.prank(admin);
        _adapter().setDefaultFeeBps(FEE_BPS);

        uint256 amount = 1 ether + 1e6;
        _fundForDebit(amount);

        uint256 fee = (amount * FEE_BPS) / BPS_DENOMINATOR;
        uint256 afterFee = amount - fee;
        uint256 dust = afterFee % 1e12;
        uint256 expectedReceived = afterFee - dust;

        (uint256 sent, uint256 received) = _harness().debit(alice, amount, 0, DST_EID);

        assertEq(sent, amount);
        assertEq(received, expectedReceived);
        assertEq(_readBalance(admin), sent - received);
    }

    function test_debit_SmallAmount_DustOnly() public {
        uint256 amount = 1e11; // Less than 1e12, entirely dust
        _fundForDebit(amount);

        (uint256 sent, uint256 received) = _harness().debit(alice, amount, 0, DST_EID);

        assertEq(sent, amount);
        assertEq(received, 0);
        assertEq(_readBalance(admin), sent - received);
    }

    // ============ Shared Tests: Fuzz ============

    function test_debit_NoFee_Fuzz(uint256 _amount) public {
        _amount = bound(_amount, 0, 1_000_000 ether);
        _fundForDebit(_amount);

        uint256 dust = _amount % 1e12;
        uint256 expectedSent = _amount;
        uint256 expectedReceived = _amount - dust;

        (uint256 sent, uint256 received) = _harness().debit(alice, _amount, expectedReceived, DST_EID);

        assertEq(sent, expectedSent);
        assertEq(received, expectedReceived);
        assertEq(_readBalance(admin), sent - received);
    }

    function test_debit_WithFee_Fuzz(uint256 _amount, uint16 _feeBps) public {
        _amount = bound(_amount, 0, 1_000_000 ether);
        _feeBps = uint16(bound(_feeBps, 0, FEE_BPS));

        vm.prank(admin);
        _adapter().setDefaultFeeBps(_feeBps);

        _fundForDebit(_amount);

        uint256 fee = (_amount * _feeBps) / BPS_DENOMINATOR;
        uint256 amountAfterFee = _amount - fee;
        uint256 dust = amountAfterFee % 1e12;
        uint256 expectedReceived = amountAfterFee - dust;
        uint256 expectedSent = _amount;

        (uint256 sent, uint256 received) = _harness().debit(alice, _amount, expectedReceived, DST_EID);

        assertEq(sent, expectedSent);
        assertEq(received, expectedReceived);
        assertEq(_readBalance(admin), sent - received);
    }
}
