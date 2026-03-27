// SPDX-License-Identifier: MIT
pragma solidity ^0.8.22;

import { IOAppCore } from "@layerzerolabs/oapp-evm-impl/contracts/interfaces/IOAppCore.sol";
import { SendParam, MessagingFee, OFTReceipt } from "@layerzerolabs/oft-evm-impl/contracts/interfaces/IOFT.sol";
import { MockMinterBurnerMsgSender } from "@layerzerolabs/test-utils-evm/contracts/mocks/MockBurnerMinterVariants.sol";
import { MockERC20 } from "@layerzerolabs/test-utils-evm/contracts/mocks/MockERC20.sol";

import { OFTBurnMintExtendedRBACUpgradeable } from "./../contracts/extended/OFTBurnMintExtendedRBACUpgradeable.sol";
import { OFTBurnSelfMintExtendedRBACUpgradeable } from "./../contracts/extended/OFTBurnSelfMintExtendedRBACUpgradeable.sol";
import { OFTCoreExtendedRBACUpgradeable } from "./../contracts/extended/OFTCoreExtendedRBACUpgradeable.sol";
import { OFTExtendedRBACTestBase } from "./shared/OFTExtendedRBACTestBase.sol";

contract OFTBurnSelfMintExtendedRBACHarness is OFTBurnSelfMintExtendedRBACUpgradeable {
    constructor(
        address _token,
        address _burnerMinter,
        address _endpoint,
        bytes4 _burnSelector,
        bytes4 _mintSelector
    ) OFTBurnSelfMintExtendedRBACUpgradeable(_token, _burnerMinter, _endpoint, _burnSelector, _mintSelector, 0) {}

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

contract OFTBurnSelfMintExtendedRBACTest is OFTExtendedRBACTestBase {
    address impl;
    OFTBurnSelfMintExtendedRBACHarness adapter;
    MockERC20 token;
    address burnerMinter;

    function setUp() public virtual override {
        token = new MockERC20(18);
        burnerMinter = address(new MockMinterBurnerMsgSender(address(token)));
        _setUpTestEndpoints();

        impl = _deployHarness();

        bytes memory initData = abi.encodeWithSelector(
            OFTBurnMintExtendedRBACUpgradeable.initialize.selector,
            admin,
            admin
        );

        adapter = OFTBurnSelfMintExtendedRBACHarness(_deployTransparentProxy(impl, address(this), initData));

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
        return
            address(
                new OFTBurnSelfMintExtendedRBACHarness(
                    address(token),
                    burnerMinter,
                    endpoint,
                    bytes4(keccak256("burn(uint256)")),
                    bytes4(keccak256("mint(address,uint256)"))
                )
            );
    }

    // ============ Abstract Method Implementations ============

    function _adapter() internal view virtual override returns (OFTCoreExtendedRBACUpgradeable) {
        return OFTCoreExtendedRBACUpgradeable(address(adapter));
    }

    function _fundForDebit(uint256 _amount) internal override {
        token.mint(alice, _amount);
        vm.prank(alice);
        token.approve(address(adapter), _amount);
    }

    function _fundAdapterForCredit(uint256 _amount) internal override {
        // `BurnSelfMint` doesn't need pre-funding for credit — it mints.
    }

    function _readBalance(address _account) internal view override returns (uint256) {
        return token.balanceOf(_account);
    }

    // ============ Initial State Tests ============

    function test_initialize() public view {
        assertEq(adapter.token(), address(token));
        assertTrue(adapter.hasRole(adapter.DEFAULT_ADMIN_ROLE(), admin));
        assertEq(adapter.sharedDecimals(), 6);
    }

    function test_initialize_Revert_InvalidInitialAdmin() public virtual {
        vm.expectRevert(IOAppCore.InvalidDelegate.selector);
        _deployTransparentProxy(
            impl,
            address(this),
            abi.encodeWithSelector(OFTBurnMintExtendedRBACUpgradeable.initialize.selector, address(0), admin)
        );
    }

    // ============ Debit Tests ============

    function test_debit() public {
        uint256 amount = 1 ether;
        token.mint(alice, amount);
        vm.prank(alice);
        token.approve(address(adapter), amount);

        (uint256 sent, uint256 received) = adapter.debit(alice, amount, amount, DST_EID);

        assertEq(sent, amount);
        assertEq(received, amount);
        assertEq(token.balanceOf(alice), 0);
        // Verify tokens were burned (`adapter` should have 0 balance after burn).
        assertEq(token.balanceOf(address(adapter)), 0);
    }

    function test_debit_WithFee() public {
        vm.prank(admin);
        adapter.setDefaultFeeBps(FEE_BPS);

        uint256 amount = 1 ether;
        token.mint(alice, amount);
        vm.prank(alice);
        token.approve(address(adapter), amount);

        (uint256 sent, uint256 received) = adapter.debit(alice, amount, 0, DST_EID);

        assertEq(sent, 1 ether);
        assertEq(received, 0.9 ether);
        assertEq(token.balanceOf(alice), 0);
        // Fee is pushed to fee recipient.
        assertEq(token.balanceOf(address(adapter)), 0);
        assertEq(token.balanceOf(admin), 0.1 ether);
    }

    // ============ Send Tests ============

    function test_send() public virtual {
        uint256 amount = 1 ether;
        uint256 nativeFee = 0.01 ether;

        token.mint(alice, amount);
        vm.deal(alice, nativeFee);

        vm.startPrank(alice);
        token.approve(address(adapter), amount);

        SendParam memory sendParam = _buildSendParam(DST_EID, bob, amount, amount);
        MessagingFee memory msgFee = MessagingFee({ nativeFee: nativeFee, lzTokenFee: 0 });

        (, OFTReceipt memory receipt) = adapter.send{ value: nativeFee }(sendParam, msgFee, alice);
        vm.stopPrank();

        assertEq(receipt.amountSentLD, amount);
        assertEq(receipt.amountReceivedLD, amount);
    }

    function test_send_WithFee() public virtual {
        uint256 amount = 1 ether;
        uint256 nativeFee = 0.01 ether;

        vm.prank(admin);
        adapter.setDefaultFeeBps(FEE_BPS);

        token.mint(alice, amount);
        vm.deal(alice, nativeFee);

        vm.startPrank(alice);
        token.approve(address(adapter), amount);

        SendParam memory sendParam = _buildSendParam(DST_EID, bob, amount, 0);
        MessagingFee memory msgFee = MessagingFee({ nativeFee: nativeFee, lzTokenFee: 0 });

        (, OFTReceipt memory receipt) = adapter.send{ value: nativeFee }(sendParam, msgFee, alice);
        vm.stopPrank();

        assertEq(receipt.amountSentLD, amount);
        assertEq(receipt.amountReceivedLD, 0.9 ether);
    }

    // ============ SelfBurn-Specific Tests ============

    function test_debit_TokensTransferredToSelfThenBurned() public {
        uint256 amount = 1 ether;
        token.mint(alice, amount);
        vm.prank(alice);
        token.approve(address(adapter), amount);

        // Before debit: `alice` has tokens, adapter has none.
        assertEq(token.balanceOf(alice), amount);
        assertEq(token.balanceOf(address(adapter)), 0);

        adapter.debit(alice, amount, amount, DST_EID);

        // After debit: both should have 0 (tokens transferred to `adapter` then burned).
        assertEq(token.balanceOf(alice), 0);
        assertEq(token.balanceOf(address(adapter)), 0);
    }
}
