// SPDX-License-Identifier: MIT
pragma solidity ^0.8.22;

import { IOAppAlt } from "@layerzerolabs/oapp-evm-impl/contracts/interfaces/IOAppAlt.sol";
import { SendParam, MessagingFee, OFTReceipt } from "@layerzerolabs/oft-evm-impl/contracts/interfaces/IOFT.sol";
import { EndpointV2AltMock } from "@layerzerolabs/test-devtools-evm-foundry/contracts/mocks/EndpointV2AltMock.sol";
import { MockBurnerMinter } from "@layerzerolabs/test-utils-evm/contracts/mocks/MockBurnerMinter.sol";
import { MockERC20 } from "@layerzerolabs/test-utils-evm/contracts/mocks/MockERC20.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { OFTBurnMintExtendedRBACAltUpgradeable } from "./../contracts/extended/alt/OFTBurnMintExtendedRBACAltUpgradeable.sol";
import { OFTBurnMintExtendedRBACUpgradeable } from "./../contracts/extended/OFTBurnMintExtendedRBACUpgradeable.sol";
import { OFTCoreExtendedRBACUpgradeable } from "./../contracts/extended/OFTCoreExtendedRBACUpgradeable.sol";
import { OFTBurnMintExtendedRBACTest, OFTBurnMintExtendedRBACHarness } from "./OFTBurnMintExtendedRBAC.t.sol";

contract OFTBurnMintExtendedRBACAltHarness is OFTBurnMintExtendedRBACAltUpgradeable {
    constructor(
        address _token,
        address _burnerMinter,
        address _endpoint,
        bool _approvalRequired,
        bytes4 _burnSelector,
        bytes4 _mintSelector
    )
        OFTBurnMintExtendedRBACAltUpgradeable(
            _token,
            _burnerMinter,
            _endpoint,
            _approvalRequired,
            _burnSelector,
            _mintSelector,
            0
        )
    {}

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

contract OFTBurnMintExtendedRBACAltTest is OFTBurnMintExtendedRBACTest {
    OFTBurnMintExtendedRBACAltHarness altAdapter;
    EndpointV2AltMock altEndpoint;
    MockERC20 nativeToken;

    function setUp() public virtual override {
        token = new MockERC20(18);
        nativeToken = new MockERC20(18);
        burnerMinter = address(new MockBurnerMinter(address(token)));

        address[] memory nativeTokenAddrs = new address[](2);
        nativeTokenAddrs[0] = address(nativeToken);
        createEndpoints(2, LibraryType.SimpleMessageLib, nativeTokenAddrs);
        altEndpoint = EndpointV2AltMock(address(endpointSetup.endpointList[0]));
        endpoint = address(altEndpoint);
        approvalRequired = false;

        impl = _deployHarness();

        bytes memory initData = abi.encodeWithSelector(
            OFTBurnMintExtendedRBACUpgradeable.initialize.selector,
            admin,
            admin
        );
        altAdapter = OFTBurnMintExtendedRBACAltHarness(_deployTransparentProxy(impl, address(this), initData));
        adapter = OFTBurnMintExtendedRBACHarness(address(altAdapter));

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

    function _deployHarness() internal virtual override returns (address) {
        return
            address(
                new OFTBurnMintExtendedRBACAltHarness(
                    address(token),
                    burnerMinter,
                    endpoint,
                    approvalRequired,
                    bytes4(keccak256("burn(address,uint256)")),
                    bytes4(keccak256("mint(address,uint256)"))
                )
            );
    }

    function _adapter() internal view override returns (OFTCoreExtendedRBACUpgradeable) {
        return OFTCoreExtendedRBACUpgradeable(address(altAdapter));
    }

    // ============ Override Parent Send Tests ============

    /**
     * @dev Override parent test since Alt version uses ERC20 for fees instead of `msg.value`.
     */
    function test_send() public override {
        uint256 amount = 1 ether;
        uint256 nativeFee = 0.01 ether;

        token.mint(alice, amount);
        nativeToken.mint(alice, nativeFee);

        vm.startPrank(alice);
        nativeToken.approve(address(adapter), nativeFee);

        SendParam memory sendParam = _buildSendParam(DST_EID, bob, amount, amount);
        MessagingFee memory msgFee = MessagingFee({ nativeFee: nativeFee, lzTokenFee: 0 });

        vm.expectEmit(true, true, true, true, address(nativeToken));
        emit IERC20.Transfer(alice, address(altEndpoint), nativeFee);
        (, OFTReceipt memory receipt) = adapter.send(sendParam, msgFee, alice);
        vm.stopPrank();

        assertEq(receipt.amountSentLD, amount);
        assertEq(receipt.amountReceivedLD, amount);
    }

    /**
     * @dev Override parent test since Alt version uses ERC20 for fees instead of `msg.value`.
     */
    function test_send_WithFee() public override {
        uint256 amount = 1 ether;
        uint256 nativeFee = 0.01 ether;

        vm.prank(admin);
        adapter.setDefaultFeeBps(FEE_BPS);

        token.mint(alice, amount);
        nativeToken.mint(alice, nativeFee);

        vm.startPrank(alice);
        nativeToken.approve(address(adapter), nativeFee);

        SendParam memory sendParam = _buildSendParam(DST_EID, bob, amount, 0);
        MessagingFee memory msgFee = MessagingFee({ nativeFee: nativeFee, lzTokenFee: 0 });

        (, OFTReceipt memory receipt) = adapter.send(sendParam, msgFee, alice);
        vm.stopPrank();

        assertEq(receipt.amountSentLD, amount);
        assertEq(receipt.amountReceivedLD, 0.9 ether);
    }

    // ============ Alt-Specific Tests ============

    function test_send_Revert_OnlyAltToken() public {
        uint256 amount = 1 ether;
        uint256 nativeFee = 0.01 ether;

        token.mint(alice, amount);
        nativeToken.mint(alice, nativeFee);
        vm.deal(alice, nativeFee);

        vm.startPrank(alice);
        nativeToken.approve(address(adapter), nativeFee);

        SendParam memory sendParam = _buildSendParam(DST_EID, bob, amount, amount);
        MessagingFee memory msgFee = MessagingFee({ nativeFee: nativeFee, lzTokenFee: 0 });

        vm.expectRevert(IOAppAlt.OnlyAltToken.selector);
        adapter.send{ value: nativeFee }(sendParam, msgFee, alice);
        vm.stopPrank();
    }
}
