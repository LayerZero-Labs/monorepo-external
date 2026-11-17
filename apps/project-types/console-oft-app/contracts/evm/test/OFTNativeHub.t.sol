// SPDX-License-Identifier: MIT
pragma solidity ^0.8.22;

import { Origin } from "@layerzerolabs/oapp-evm-contracts/contracts/interfaces/IOAppReceiver.sol";
import { SendParam, MessagingFee } from "@layerzerolabs/oft-evm-contracts/contracts/interfaces/IOFT.sol";
import { OFTNativeExtendedRBACUpgradeable } from "@layerzerolabs/oft-upgradeable-evm-contracts/contracts/extended/OFTNativeExtendedRBACUpgradeable.sol";
import { EndpointV2Mock } from "@layerzerolabs/test-devtools-evm-foundry/contracts/mocks/EndpointV2Mock.sol";
import { TestHelperOz5 } from "@layerzerolabs/test-devtools-evm-foundry/contracts/TestHelperOz5.sol";
import { IRateLimiter } from "@layerzerolabs/utils-evm-contracts/contracts/interfaces/IRateLimiter.sol";
import { TransparentUpgradeableProxy } from "@openzeppelin/contracts/proxy/transparent/TransparentUpgradeableProxy.sol";
import { OFTNative } from "./../contracts/OFTNative.sol";

contract OFTNativeHubTest is TestHelperOz5 {
    uint32 constant HUB_EID = 1;
    uint32 constant REMOTE_EID = 2;
    uint32 constant NO_DECAY_WINDOW = type(uint32).max;
    uint256 constant DECIMAL_CONVERSION_RATE = 1e12;
    bytes32 constant REMOTE_PEER = bytes32(uint256(1));

    address admin = makeAddr("admin");
    address newAdmin = makeAddr("newAdmin");
    address alice = makeAddr("alice");
    address bob = makeAddr("bob");

    OFTNative hub;

    function setUp() public virtual override {
        super.setUp();
        setUpEndpoints(2, LibraryType.SimpleMessageLib);

        hub = OFTNative(
            payable(
                address(
                    new TransparentUpgradeableProxy(
                        address(new OFTNative(18, endpoints[HUB_EID], 0)),
                        address(this),
                        abi.encodeWithSelector(OFTNativeExtendedRBACUpgradeable.initialize.selector, admin, admin)
                    )
                )
            )
        );

        vm.startPrank(admin);
        hub.grantRole(hub.RATE_LIMITER_MANAGER_ROLE(), admin);
        hub.setPeer(REMOTE_EID, REMOTE_PEER);
        vm.stopPrank();
    }

    function _setRateLimitWithUnlimitedOutbound(
        bool _inboundEnabled,
        uint96 _inboundLimit,
        uint32 _inboundWindow
    ) internal {
        IRateLimiter.SetRateLimitConfigParam[] memory configs = new IRateLimiter.SetRateLimitConfigParam[](1);
        configs[0] = IRateLimiter.SetRateLimitConfigParam({
            id: REMOTE_EID,
            config: IRateLimiter.RateLimitConfig({
                active: true,
                outboundEnabled: false,
                inboundEnabled: _inboundEnabled,
                netAccountingEnabled: true,
                addressExemptionEnabled: false,
                outboundLimit: 0,
                inboundLimit: _inboundLimit,
                outboundWindow: 0,
                inboundWindow: _inboundWindow
            })
        });
        vm.prank(admin);
        hub.setRateLimitConfigs(configs);
    }

    function _setUnlimitedRateLimit() internal {
        _setRateLimitWithUnlimitedOutbound(false, 0, 0);
    }

    function _quoteSend(address _to, uint256 _amountLD) internal view returns (SendParam memory, MessagingFee memory) {
        SendParam memory sendParam = SendParam({
            dstEid: REMOTE_EID,
            to: addressToBytes32(_to),
            amountLD: _amountLD,
            minAmountLD: _amountLD,
            extraOptions: bytes(""),
            composeMsg: bytes(""),
            oftCmd: bytes("")
        });
        return (sendParam, hub.quoteSend(sendParam, false));
    }

    function _lzReceive(address _to, uint256 _amountLD) internal {
        vm.prank(endpoints[HUB_EID]);
        hub.lzReceive(
            Origin({ srcEid: REMOTE_EID, sender: REMOTE_PEER, nonce: 1 }),
            bytes32(0),
            abi.encodePacked(addressToBytes32(_to), uint64(_amountLD / DECIMAL_CONVERSION_RATE)),
            address(0),
            bytes("")
        );
    }

    function _inboundAvailable() internal view returns (uint256 inboundAvailableAmount) {
        (, , , inboundAvailableAmount) = hub.getRateLimitUsages(REMOTE_EID);
    }

    function test_sendAndLzReceive_UnlimitedRateLimit_MovesFullAmount_Fuzz(uint64 _amountSD) public {
        uint256 amountLD = bound(_amountSD, 1, type(uint64).max) * DECIMAL_CONVERSION_RATE;
        _setUnlimitedRateLimit();

        (SendParam memory sendParam, MessagingFee memory fee) = _quoteSend(bob, amountLD);
        vm.deal(alice, amountLD + fee.nativeFee);
        vm.prank(alice);
        hub.send{ value: amountLD + fee.nativeFee }(sendParam, fee, alice);
        assertEq(address(hub).balance, amountLD);

        _lzReceive(bob, amountLD);
        assertEq(bob.balance, amountLD);
        assertEq(address(hub).balance, 0);
    }

    function test_lzReceive_NoDecayInboundWindow_AvailableUnchangedAfter100Years() public {
        uint96 limit = 1_000_000 ether;
        uint256 received = 300_000 ether;
        _setRateLimitWithUnlimitedOutbound(true, limit, NO_DECAY_WINDOW);
        vm.deal(address(hub), limit);

        _lzReceive(bob, received);
        assertEq(_inboundAvailable(), limit - received);

        vm.warp(block.timestamp + 100 * 365 days);
        assertEq(_inboundAvailable(), limit - received);

        uint256 overLimit = limit - received + DECIMAL_CONVERSION_RATE;
        vm.expectRevert(abi.encodeWithSelector(IRateLimiter.RateLimitExceeded.selector, limit - received, overLimit));
        _lzReceive(bob, overLimit);
    }

    function test_send_NetAccounting_RaisesInboundAvailableBySentAmount() public {
        uint96 limit = 1_000_000 ether;
        uint256 received = 300_000 ether;
        uint256 sent = 100_000 ether;
        _setRateLimitWithUnlimitedOutbound(true, limit, NO_DECAY_WINDOW);
        vm.deal(address(hub), received);

        _lzReceive(bob, received);
        assertEq(_inboundAvailable(), limit - received);

        (SendParam memory sendParam, MessagingFee memory fee) = _quoteSend(alice, sent);
        vm.deal(bob, sent + fee.nativeFee);
        vm.prank(bob);
        hub.send{ value: sent + fee.nativeFee }(sendParam, fee, bob);
        assertEq(_inboundAvailable(), limit - received + sent);
    }

    function test_send_NoRateLimitConfig_RevertsRateLimitExceeded() public {
        uint256 amountLD = 1 ether;
        (SendParam memory sendParam, MessagingFee memory fee) = _quoteSend(bob, amountLD);
        vm.deal(alice, amountLD + fee.nativeFee);

        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(IRateLimiter.RateLimitExceeded.selector, 0, amountLD));
        hub.send{ value: amountLD + fee.nativeFee }(sendParam, fee, alice);
    }

    function test_plainNativeTransfer_Reverts() public {
        vm.deal(alice, 1 ether);

        vm.prank(alice);
        (bool success, ) = payable(address(hub)).call{ value: 1 ether }("");

        assertFalse(success);
        assertEq(address(hub).balance, 0);
        assertEq(alice.balance, 1 ether);
    }

    function test_acceptDefaultAdminTransfer_MovesAdminRoleAndDelegateOnlyOnAccept() public {
        bytes32 defaultAdminRole = hub.DEFAULT_ADMIN_ROLE();
        EndpointV2Mock endpoint = EndpointV2Mock(endpoints[HUB_EID]);

        vm.prank(admin);
        hub.beginDefaultAdminTransfer(newAdmin);

        assertTrue(hub.hasRole(defaultAdminRole, admin));
        assertFalse(hub.hasRole(defaultAdminRole, newAdmin));
        assertEq(endpoint.delegates(address(hub)), admin);

        vm.prank(newAdmin);
        hub.acceptDefaultAdminTransfer();

        assertTrue(hub.hasRole(defaultAdminRole, newAdmin));
        assertFalse(hub.hasRole(defaultAdminRole, admin));
        assertEq(endpoint.delegates(address(hub)), newAdmin);
    }
}
