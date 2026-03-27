// SPDX-License-Identifier: MIT
pragma solidity ^0.8.22;

import { IOAppCore } from "@layerzerolabs/oapp-evm-impl/contracts/interfaces/IOAppCore.sol";
import { IOAppMsgInspector } from "@layerzerolabs/oapp-evm-impl/contracts/interfaces/IOAppMsgInspector.sol";
import { MessagingFee, SendParam, OFTReceipt } from "@layerzerolabs/oft-evm-impl/contracts/interfaces/IOFT.sol";
import { RejectingMsgInspector } from "@layerzerolabs/test-utils-evm/contracts/mocks/RejectingMsgInspector.sol";

import { OFTCoreExtendedRBACUpgradeable } from "./../contracts/extended/OFTCoreExtendedRBACUpgradeable.sol";
import { OFTNativeExtendedRBACUpgradeable } from "./../contracts/extended/OFTNativeExtendedRBACUpgradeable.sol";
import { OFTExtendedRBACTestBase } from "./shared/OFTExtendedRBACTestBase.sol";

contract ETHRejecter {
    receive() external payable {
        revert("ETH rejected");
    }
}

contract OFTNativeExtendedRBACHarness is OFTNativeExtendedRBACUpgradeable {
    constructor(
        uint8 _localDecimals,
        address _endpoint
    ) OFTNativeExtendedRBACUpgradeable(_localDecimals, _endpoint, 0) {}

    function debit(
        address _from,
        uint256 _amountLD,
        uint256 _minAmountLD,
        uint32 _dstEid
    ) public returns (uint256 amountSentLD, uint256 amountReceivedLD) {
        return _debit(_from, _amountLD, _minAmountLD, _dstEid);
    }

    function credit(address _to, uint256 _amountLD, uint32 _srcEid) public returns (uint256 amountReceivedLD) {
        return _credit(_to, _amountLD, _srcEid);
    }
}

contract OFTNativeExtendedRBACTest is OFTExtendedRBACTestBase {
    address impl;
    OFTNativeExtendedRBACHarness adapter;

    function setUp() public virtual override {
        _setUpTestEndpoints();

        impl = _deployHarness();

        bytes memory initData = abi.encodeWithSelector(
            OFTNativeExtendedRBACUpgradeable.initialize.selector,
            admin,
            admin
        );

        adapter = OFTNativeExtendedRBACHarness(payable(_deployTransparentProxy(impl, address(this), initData)));

        // Grant required roles to `admin`.
        vm.startPrank(admin);
        adapter.grantRole(adapter.RATE_LIMITER_MANAGER_ROLE(), admin);
        adapter.grantRole(adapter.FEE_CONFIG_MANAGER_ROLE(), admin);
        adapter.grantRole(adapter.PAUSER_ROLE(), admin);
        adapter.grantRole(adapter.UNPAUSER_ROLE(), admin);
        adapter.setPeer(DST_EID, bytes32(uint256(1)));
        adapter.setRateLimitConfigs(_buildDefaultRateLimitConfig(DST_EID, 1_000_000 ether, 0));
        vm.stopPrank();
    }

    function _deployHarness() internal virtual returns (address) {
        return address(new OFTNativeExtendedRBACHarness(18, endpoint));
    }

    // ============ Abstract Method Implementations ============

    function _adapter() internal view override returns (OFTCoreExtendedRBACUpgradeable) {
        return OFTCoreExtendedRBACUpgradeable(address(adapter));
    }

    function _fundForDebit(uint256 _amount) internal override {
        // Native adapter debits from contract balance, not from user.
        vm.deal(address(adapter), _amount);
    }

    function _fundAdapterForCredit(uint256 _amount) internal override {
        vm.deal(address(adapter), _amount);
    }

    function _readBalance(address _account) internal view override returns (uint256) {
        return _account.balance;
    }

    // ============ Initial State Tests ============

    function test_initialize() public view {
        assertTrue(adapter.hasRole(adapter.DEFAULT_ADMIN_ROLE(), admin));
        assertEq(adapter.sharedDecimals(), 6);
        assertEq(adapter.decimalConversionRate(), 1e12);
    }

    function test_initialize_Revert_InvalidInitialAdmin() public virtual {
        vm.expectRevert(IOAppCore.InvalidDelegate.selector);
        _deployTransparentProxy(
            impl,
            address(this),
            abi.encodeWithSelector(OFTNativeExtendedRBACUpgradeable.initialize.selector, address(0), admin)
        );
    }

    // ============ Debit Tests ============

    function test_debit() public {
        uint256 amount = 1 ether;
        vm.deal(address(adapter), amount);

        (uint256 sent, uint256 received) = adapter.debit(alice, amount, amount, DST_EID);

        assertEq(sent, amount);
        assertEq(received, amount);
    }

    function test_debit_WithFee() public {
        vm.prank(admin);
        adapter.setDefaultFeeBps(FEE_BPS);

        uint256 amount = 1 ether;
        vm.deal(address(adapter), amount);

        (uint256 sent, uint256 received) = adapter.debit(alice, amount, 0.9 ether, DST_EID);

        assertEq(sent, amount);
        assertEq(received, 0.9 ether);
    }

    // ============ Fee Tests ============

    function test_send_PushesFees() public {
        uint256 amount = 1 ether;
        uint256 nativeFee = 0.01 ether;

        vm.prank(admin);
        adapter.setDefaultFeeBps(FEE_BPS);

        vm.deal(alice, amount + nativeFee);

        SendParam memory sendParam = _buildSendParam(DST_EID, bob, amount, 0);
        MessagingFee memory msgFee = MessagingFee({ nativeFee: nativeFee, lzTokenFee: 0 });

        uint256 recipientBalanceBefore = admin.balance;

        vm.prank(alice);
        adapter.send{ value: amount + nativeFee }(sendParam, msgFee, alice);

        assertEq(admin.balance, recipientBalanceBefore + 0.1 ether);
        assertEq(address(adapter).balance, 0.9 ether);
    }

    function test_send_Revert_FeeTransferFailed() public {
        ETHRejecter rejecter = new ETHRejecter();

        vm.prank(admin);
        adapter.setFeeDeposit(address(rejecter));

        vm.prank(admin);
        adapter.setDefaultFeeBps(FEE_BPS);

        vm.deal(alice, 1 ether);

        SendParam memory sendParam = _buildSendParam(DST_EID, bob, 1 ether, 0);
        MessagingFee memory msgFee = MessagingFee({ nativeFee: 0, lzTokenFee: 0 });

        vm.prank(alice);
        vm.expectRevert(
            abi.encodeWithSelector(
                OFTNativeExtendedRBACUpgradeable.FeeTransferFailed.selector,
                address(rejecter),
                0.1 ether,
                abi.encodeWithSignature("Error(string)", "ETH rejected")
            )
        );
        adapter.send{ value: 1 ether }(sendParam, msgFee, alice);
    }

    // ============ Send Tests ============

    function test_send() public {
        uint256 amount = 1 ether;
        uint256 nativeFee = 0.01 ether;
        vm.deal(alice, amount + nativeFee);

        SendParam memory sendParam = _buildSendParam(DST_EID, bob, amount, amount);
        MessagingFee memory msgFee = MessagingFee({ nativeFee: nativeFee, lzTokenFee: 0 });

        vm.prank(alice);
        (, OFTReceipt memory receipt) = adapter.send{ value: amount + nativeFee }(sendParam, msgFee, alice);

        assertEq(receipt.amountSentLD, amount);
        assertEq(receipt.amountReceivedLD, amount);
    }

    function test_send_WithFee() public {
        uint256 amount = 1 ether;
        uint256 nativeFee = 0.01 ether;

        vm.prank(admin);
        adapter.setDefaultFeeBps(FEE_BPS);

        vm.deal(alice, amount + nativeFee);

        SendParam memory sendParam = _buildSendParam(DST_EID, bob, amount, 0);
        MessagingFee memory msgFee = MessagingFee({ nativeFee: nativeFee, lzTokenFee: 0 });

        vm.prank(alice);
        (, OFTReceipt memory receipt) = adapter.send{ value: amount + nativeFee }(sendParam, msgFee, alice);

        assertEq(receipt.amountSentLD, amount);
        assertEq(receipt.amountReceivedLD, 0.9 ether);
        assertEq(address(adapter).balance, 0.9 ether);
    }

    // ============ IncorrectMessageValue Tests ============

    function test_send_Revert_IncorrectMessageValue_TooLow() public {
        uint256 amount = 1 ether;
        uint256 nativeFee = 0.01 ether;
        uint256 requiredValue = amount + nativeFee;

        vm.deal(alice, requiredValue);

        SendParam memory sendParam = _buildSendParam(DST_EID, bob, amount, amount);
        MessagingFee memory msgFee = MessagingFee({ nativeFee: nativeFee, lzTokenFee: 0 });

        vm.prank(alice);
        vm.expectRevert(
            abi.encodeWithSelector(
                OFTNativeExtendedRBACUpgradeable.IncorrectMessageValue.selector,
                requiredValue - 1,
                requiredValue
            )
        );
        adapter.send{ value: requiredValue - 1 }(sendParam, msgFee, alice);
    }

    function test_send_Revert_IncorrectMessageValue_TooHigh() public {
        uint256 amount = 1 ether;
        uint256 nativeFee = 0.01 ether;
        uint256 requiredValue = amount + nativeFee;

        vm.deal(alice, requiredValue + 1);

        SendParam memory sendParam = _buildSendParam(DST_EID, bob, amount, amount);
        MessagingFee memory msgFee = MessagingFee({ nativeFee: nativeFee, lzTokenFee: 0 });

        vm.prank(alice);
        vm.expectRevert(
            abi.encodeWithSelector(
                OFTNativeExtendedRBACUpgradeable.IncorrectMessageValue.selector,
                requiredValue + 1,
                requiredValue
            )
        );
        adapter.send{ value: requiredValue + 1 }(sendParam, msgFee, alice);
    }

    function test_send_Revert_IncorrectMessageValue_ZeroValue() public {
        uint256 amount = 1 ether;
        uint256 nativeFee = 0.01 ether;
        uint256 requiredValue = amount + nativeFee;

        SendParam memory sendParam = _buildSendParam(DST_EID, bob, amount, amount);
        MessagingFee memory msgFee = MessagingFee({ nativeFee: nativeFee, lzTokenFee: 0 });

        vm.prank(alice);
        vm.expectRevert(
            abi.encodeWithSelector(OFTNativeExtendedRBACUpgradeable.IncorrectMessageValue.selector, 0, requiredValue)
        );
        adapter.send{ value: 0 }(sendParam, msgFee, alice);
    }

    // ============ CreditFailed Tests ============

    function test_credit_Revert_CreditFailed() public {
        ETHRejecter rejecter = new ETHRejecter();

        vm.deal(address(adapter), 1 ether);

        vm.expectRevert(
            abi.encodeWithSelector(
                OFTNativeExtendedRBACUpgradeable.CreditFailed.selector,
                address(rejecter),
                1 ether,
                abi.encodeWithSignature("Error(string)", "ETH rejected")
            )
        );
        adapter.credit(address(rejecter), 1 ether, DST_EID);
    }

    // ============ View Function Tests ============

    function test_token() public view {
        assertEq(adapter.token(), address(0));
    }

    function test_approvalRequired() public view {
        assertFalse(adapter.approvalRequired());
    }

    // ============ Message Inspection Override ============

    /**
     * @dev Override for native token which requires `msg.value` to include both amount and fee.
     */
    function test_send_Revert_MsgInspection() public override {
        uint256 amount = 1 ether;
        uint256 nativeFee = 0.01 ether;

        vm.deal(alice, amount + nativeFee);

        SendParam memory sendParam = _buildSendParam(DST_EID, bob, amount, amount);

        // Set up a rejecting message inspector.
        RejectingMsgInspector inspector = new RejectingMsgInspector();
        vm.prank(admin);
        _adapter().setMsgInspector(address(inspector));

        // Build expected message using `OFTMsgCodec` format: (`sendTo`, `amountSD`).
        bytes memory message = abi.encodePacked(sendParam.to, uint64(amount / 1e12));

        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(IOAppMsgInspector.InspectionFailed.selector, alice, message, bytes("")));
        adapter.send{ value: amount + nativeFee }(
            sendParam,
            MessagingFee({ nativeFee: nativeFee, lzTokenFee: 0 }),
            alice
        );
    }
}
