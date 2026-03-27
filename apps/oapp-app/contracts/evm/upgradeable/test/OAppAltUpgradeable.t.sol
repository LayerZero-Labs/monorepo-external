// SPDX-License-Identifier: MIT
pragma solidity ^0.8.22;

import { IOAppAlt } from "@layerzerolabs/oapp-evm-impl/contracts/interfaces/IOAppAlt.sol";
import { EndpointV2AltMock } from "@layerzerolabs/test-devtools-evm-foundry/contracts/mocks/EndpointV2AltMock.sol";
import { TestHelperOz5 } from "@layerzerolabs/test-devtools-evm-foundry/contracts/TestHelperOz5.sol";
import { MockERC20 } from "@layerzerolabs/test-utils-evm/contracts/mocks/MockERC20.sol";
import { TransparentUpgradeableProxy } from "@openzeppelin/contracts/proxy/transparent/TransparentUpgradeableProxy.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { OAppAltUpgradeable } from "./../contracts/oapp/alt/OAppAltUpgradeable.sol";
import { OAppCoreBaseUpgradeable } from "./../contracts/oapp/OAppCoreBaseUpgradeable.sol";

contract OAppAltUpgradeableHarness is OAppCoreBaseUpgradeable, OAppAltUpgradeable {
    constructor(address _endpoint) OAppCoreBaseUpgradeable(_endpoint) {}

    function initialize(address _delegate) public initializer {
        __OAppCoreBase_init(_delegate);
    }

    function oAppVersion() public pure returns (uint64 senderVersion, uint64 receiverVersion) {
        return (1, 1);
    }

    function payNative(uint256 _nativeFee) public payable returns (uint256 nativeFee) {
        return _payNative(_nativeFee);
    }

    function _payNative(uint256 _nativeFee) internal virtual override(OAppAltUpgradeable) returns (uint256 nativeFee) {
        return OAppAltUpgradeable._payNative(_nativeFee);
    }

    function setPeer(uint32 _eid, bytes32 _peer) external {
        _setPeer(_eid, _peer);
    }

    function setDelegate(address _delegate) external {
        _setDelegate(_delegate);
    }
}

contract OAppAltUpgradeableTest is TestHelperOz5 {
    OAppAltUpgradeableHarness impl;
    OAppAltUpgradeableHarness oapp;
    MockERC20 nativeToken;
    address endpoint;

    address delegate = makeAddr("delegate");
    address alice = makeAddr("alice");
    address bob = makeAddr("bob");

    function setUp() public override {
        nativeToken = new MockERC20(18);

        address[] memory nativeTokenAddrs = new address[](2);
        nativeTokenAddrs[0] = address(nativeToken);
        createEndpoints(2, LibraryType.SimpleMessageLib, nativeTokenAddrs);
        endpoint = address(endpointSetup.endpointList[0]);

        impl = new OAppAltUpgradeableHarness(endpoint);

        bytes memory initData = abi.encodeWithSelector(OAppAltUpgradeableHarness.initialize.selector, delegate);
        TransparentUpgradeableProxy proxy = new TransparentUpgradeableProxy(address(impl), delegate, initData);

        oapp = OAppAltUpgradeableHarness(address(proxy));
    }

    function test_constructor() public view {
        assertEq(address(oapp.endpoint()), endpoint);
    }

    function test_constructor_Revert_InvalidNativeToken() public {
        EndpointV2AltMock endpointZeroNative = new EndpointV2AltMock(1, address(this), address(0));

        vm.expectRevert(IOAppAlt.InvalidNativeToken.selector);
        new OAppAltUpgradeableHarness(address(endpointZeroNative));
    }

    function test_payNative() public {
        uint256 fee = 0.1 ether;
        nativeToken.mint(alice, fee);

        vm.startPrank(alice);
        nativeToken.approve(address(oapp), fee);

        uint256 returnedFee = oapp.payNative(fee);
        vm.stopPrank();

        assertEq(returnedFee, 0, "Should return 0 as fee is paid via ERC20");
        assertEq(nativeToken.balanceOf(alice), 0, "Alice should have 0 balance");
        assertEq(nativeToken.balanceOf(endpoint), fee, "Endpoint should have the fee");
    }

    function test_payNative_ZeroFee() public {
        /// @dev Expects `transferFrom` to never be called on the native token.
        vm.expectCall(address(nativeToken), abi.encodeWithSelector(IERC20.transferFrom.selector), 0);

        vm.prank(alice);
        uint256 returnedFee = oapp.payNative(0);

        assertEq(returnedFee, 0);
    }

    function test_payNative_Revert_OnlyAltToken() public {
        uint256 fee = 0.1 ether;
        nativeToken.mint(alice, fee);
        vm.deal(alice, 1 wei);

        vm.startPrank(alice);
        nativeToken.approve(address(oapp), fee);

        vm.expectRevert(IOAppAlt.OnlyAltToken.selector);
        oapp.payNative{ value: 1 wei }(fee);
        vm.stopPrank();
    }

    function test_payNative_Fuzz(uint96 _fee) public {
        _fee = uint96(bound(_fee, 1, 1_000_000 ether));
        nativeToken.mint(alice, _fee);

        vm.startPrank(alice);
        nativeToken.approve(address(oapp), _fee);

        uint256 returnedFee = oapp.payNative(_fee);
        vm.stopPrank();

        assertEq(returnedFee, 0);
        assertEq(nativeToken.balanceOf(alice), 0);
        assertEq(nativeToken.balanceOf(endpoint), _fee);
    }
}
