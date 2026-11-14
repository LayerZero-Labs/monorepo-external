// SPDX-License-Identifier: MIT
pragma solidity ^0.8.22;

import { OptionsBuilder } from "@layerzerolabs/oapp-evm-contracts/contracts/oapp/libs/OptionsBuilder.sol";
import {
    IOFT,
    SendParam,
    OFTReceipt,
    MessagingFee
} from "@layerzerolabs/oft-evm-contracts/contracts/interfaces/IOFT.sol";
import { TestHelperOz5 } from "@layerzerolabs/test-devtools-evm-foundry/contracts/TestHelperOz5.sol";
import { MockBurnerMinter } from "@layerzerolabs/test-utils-evm-contracts/contracts/mocks/MockBurnerMinter.sol";
import { MockERC20 } from "@layerzerolabs/test-utils-evm-contracts/contracts/mocks/MockERC20.sol";
import { IRateLimiter } from "@layerzerolabs/utils-evm-contracts/contracts/interfaces/IRateLimiter.sol";
import { TransparentUpgradeableProxy } from "@openzeppelin/contracts/proxy/transparent/TransparentUpgradeableProxy.sol";
import { DoubleEndedQueue } from "@openzeppelin/contracts/utils/structs/DoubleEndedQueue.sol";
import { OFTBurnMintExtendedRBACUpgradeable } from "./../contracts/extended/OFTBurnMintExtendedRBACUpgradeable.sol";
import { OFTCoreExtendedRBACUpgradeable } from "./../contracts/extended/OFTCoreExtendedRBACUpgradeable.sol";
import { OFTLockUnlockExtendedRBACUpgradeable } from "./../contracts/extended/OFTLockUnlockExtendedRBACUpgradeable.sol";

/**
 * @notice End-to-end tests for a lock/unlock hub that caps the inflows from each burn/mint spoke at its net outflow.
 * @dev Each spoke rate limit ID on the hub has an inbound net limit `LEDGER_LIMIT` with a no-decay window, and starts
 *      with `inboundUsage` equal to `LEDGER_LIMIT`, so the inbound headroom is the net outflow to the spoke.
 */
contract OFTExtendedRBACHubLedgerTest is TestHelperOz5 {
    using OptionsBuilder for bytes;

    uint32 constant HUB_EID = 1;
    uint32 constant SPOKE_A_EID = 2;
    uint32 constant SPOKE_B_EID = 3;
    uint32 constant NO_DECAY_WINDOW = type(uint32).max;
    uint96 constant LEDGER_LIMIT = type(uint96).max;
    uint16 constant FEE_BPS = 1_000; // 10%

    address admin = makeAddr("admin");
    address alice = makeAddr("alice");
    address bob = makeAddr("bob");

    MockERC20 hubToken;
    OFTLockUnlockExtendedRBACUpgradeable hub;
    mapping(uint32 eid => MockERC20 token) spokeTokens;
    mapping(uint32 eid => OFTBurnMintExtendedRBACUpgradeable oft) spokes;

    function setUp() public virtual override {
        super.setUp();
        setUpEndpoints(3, LibraryType.SimpleMessageLib);

        hubToken = new MockERC20(18);
        hub = OFTLockUnlockExtendedRBACUpgradeable(
            _deployProxy(address(new OFTLockUnlockExtendedRBACUpgradeable(address(hubToken), endpoints[HUB_EID], 0)))
        );
        _grantRoles(hub);

        _deploySpoke(SPOKE_A_EID);
        _deploySpoke(SPOKE_B_EID);

        vm.startPrank(admin);
        _setUpHubLedger(SPOKE_A_EID, false, 0, 0);
        _setUpHubLedger(SPOKE_B_EID, false, 0, 0);
        vm.stopPrank();
    }

    // ============ Helper Functions ============

    function _deployProxy(address _impl) internal returns (address) {
        return
            address(
                new TransparentUpgradeableProxy(
                    _impl,
                    address(this),
                    abi.encodeWithSelector(OFTLockUnlockExtendedRBACUpgradeable.initialize.selector, admin, admin)
                )
            );
    }

    function _grantRoles(OFTCoreExtendedRBACUpgradeable _oft) internal {
        vm.startPrank(admin);
        _oft.grantRole(_oft.RATE_LIMITER_MANAGER_ROLE(), admin);
        _oft.grantRole(_oft.FEE_CONFIG_MANAGER_ROLE(), admin);
        vm.stopPrank();
    }

    function _deploySpoke(uint32 _eid) internal {
        MockERC20 token = new MockERC20(18);
        OFTBurnMintExtendedRBACUpgradeable spoke = OFTBurnMintExtendedRBACUpgradeable(
            _deployProxy(
                address(
                    new OFTBurnMintExtendedRBACUpgradeable(
                        address(token),
                        address(new MockBurnerMinter(address(token))),
                        endpoints[_eid],
                        false,
                        bytes4(keccak256("burn(address,uint256)")),
                        bytes4(keccak256("mint(address,uint256)")),
                        0
                    )
                )
            )
        );
        _grantRoles(spoke);
        spokeTokens[_eid] = token;
        spokes[_eid] = spoke;

        vm.startPrank(admin);
        spoke.setPeer(HUB_EID, addressToBytes32(address(hub)));
        spoke.setRateLimitGlobalConfig(
            IRateLimiter.RateLimitGlobalConfig({ useGlobalState: false, isGloballyDisabled: true })
        );
        hub.setPeer(_eid, addressToBytes32(address(spoke)));
        vm.stopPrank();
    }

    function _setUpHubLedger(
        uint32 _spokeEid,
        bool _outboundEnabled,
        uint96 _outboundLimit,
        uint32 _outboundWindow
    ) internal {
        IRateLimiter.SetRateLimitConfigParam[] memory configs = new IRateLimiter.SetRateLimitConfigParam[](1);
        configs[0] = IRateLimiter.SetRateLimitConfigParam({
            id: _spokeEid,
            config: IRateLimiter.RateLimitConfig({
                active: true,
                outboundEnabled: _outboundEnabled,
                inboundEnabled: true,
                netAccountingEnabled: true,
                addressExemptionEnabled: false,
                outboundLimit: _outboundLimit,
                inboundLimit: LEDGER_LIMIT,
                outboundWindow: _outboundWindow,
                inboundWindow: NO_DECAY_WINDOW
            })
        });
        hub.setRateLimitConfigs(configs);

        IRateLimiter.SetRateLimitStateParam[] memory states = new IRateLimiter.SetRateLimitStateParam[](1);
        states[0] = IRateLimiter.SetRateLimitStateParam({
            id: _spokeEid,
            state: IRateLimiter.RateLimitState({
                outboundUsage: 0,
                inboundUsage: LEDGER_LIMIT,
                lastUpdated: uint40(block.timestamp)
            })
        });
        hub.setRateLimitStates(states);
    }

    function _send(
        OFTCoreExtendedRBACUpgradeable _oft,
        uint32 _dstEid,
        address _from,
        address _to,
        uint256 _amountLD
    ) internal returns (OFTReceipt memory receipt) {
        SendParam memory sendParam = SendParam({
            dstEid: _dstEid,
            to: addressToBytes32(_to),
            amountLD: _amountLD,
            minAmountLD: 0,
            extraOptions: OptionsBuilder.newOptions().addExecutorLzReceiveOption(200_000, 0),
            composeMsg: bytes(""),
            oftCmd: bytes("")
        });
        MessagingFee memory fee = _oft.quoteSend(sendParam, false);
        vm.deal(_from, fee.nativeFee);

        vm.startPrank(_from);
        MockERC20(_oft.token()).approve(address(_oft), _amountLD);
        (, receipt) = _oft.send{ value: fee.nativeFee }(sendParam, fee, _from);
        vm.stopPrank();
    }

    function _sendToSpoke(uint32 _spokeEid, uint256 _amountLD) internal returns (OFTReceipt memory receipt) {
        hubToken.mint(alice, _amountLD);
        receipt = _send(hub, _spokeEid, alice, bob, _amountLD);
        verifyPackets(_spokeEid, address(spokes[_spokeEid]));
    }

    function _sendFromSpoke(uint32 _spokeEid, uint256 _amountLD) internal {
        _send(spokes[_spokeEid], HUB_EID, bob, alice, _amountLD);
    }

    function _hubHeadroom(uint32 _spokeEid) internal view returns (uint256 inAvail) {
        (, , , inAvail) = hub.getRateLimitUsages(_spokeEid);
    }

    // ============ send Tests ============

    function test_send_HubLedger_DecayingOutboundLimit() public {
        vm.startPrank(admin);
        _setUpHubLedger(SPOKE_A_EID, true, 100 ether, 1 days);
        vm.stopPrank();

        _sendToSpoke(SPOKE_A_EID, 100 ether);
        assertEq(_hubHeadroom(SPOKE_A_EID), 100 ether);

        hubToken.mint(alice, 1 ether);
        vm.expectRevert(abi.encodeWithSelector(IRateLimiter.RateLimitExceeded.selector, 0, 1 ether));
        this.sendExternal(hub, SPOKE_A_EID, alice, bob, 1 ether);

        vm.warp(block.timestamp + 1 days);
        _sendToSpoke(SPOKE_A_EID, 100 ether);
        assertEq(_hubHeadroom(SPOKE_A_EID), 200 ether);

        _sendFromSpoke(SPOKE_A_EID, 200 ether);
        verifyPackets(HUB_EID, address(hub));
        assertEq(_hubHeadroom(SPOKE_A_EID), 0);
    }

    // ============ lzReceive Tests ============

    function test_lzReceive_HubLedger() public {
        _sendToSpoke(SPOKE_A_EID, 300 ether);
        assertEq(_hubHeadroom(SPOKE_A_EID), 300 ether);

        _sendFromSpoke(SPOKE_A_EID, 100 ether);
        verifyPackets(HUB_EID, address(hub));
        assertEq(_hubHeadroom(SPOKE_A_EID), 200 ether);

        _sendFromSpoke(SPOKE_A_EID, 200 ether);
        verifyPackets(HUB_EID, address(hub));
        assertEq(_hubHeadroom(SPOKE_A_EID), 0);
        assertEq(hubToken.balanceOf(alice), 300 ether);
    }

    function test_lzReceive_HubLedger_LongWarp() public {
        _sendToSpoke(SPOKE_A_EID, 300 ether);

        vm.warp(block.timestamp + 100 * 365 days);
        assertEq(_hubHeadroom(SPOKE_A_EID), 300 ether);

        _sendFromSpoke(SPOKE_A_EID, 300 ether);
        verifyPackets(HUB_EID, address(hub));
        assertEq(_hubHeadroom(SPOKE_A_EID), 0);

        vm.warp(block.timestamp + 100 * 365 days);
        spokeTokens[SPOKE_A_EID].mint(bob, 1e12);
        _sendFromSpoke(SPOKE_A_EID, 1e12);

        vm.expectRevert(abi.encodeWithSelector(IRateLimiter.RateLimitExceeded.selector, 0, 1e12));
        this.verifyPackets(HUB_EID, address(hub));
    }

    function test_lzReceive_HubLedger_OutOfOrderReturns() public {
        _sendToSpoke(SPOKE_A_EID, 300 ether);

        _sendFromSpoke(SPOKE_A_EID, 50 ether);
        _sendFromSpoke(SPOKE_A_EID, 100 ether);
        _sendFromSpoke(SPOKE_A_EID, 150 ether);
        assertEq(spokeTokens[SPOKE_A_EID].totalSupply(), 0);
        assertEq(_hubHeadroom(SPOKE_A_EID), 300 ether);

        vm.expectEmit(false, true, true, true, address(hub));
        emit IOFT.OFTReceived(bytes32(0), SPOKE_A_EID, alice, 150 ether);
        vm.expectEmit(false, true, true, true, address(hub));
        emit IOFT.OFTReceived(bytes32(0), SPOKE_A_EID, alice, 100 ether);
        vm.expectEmit(false, true, true, true, address(hub));
        emit IOFT.OFTReceived(bytes32(0), SPOKE_A_EID, alice, 50 ether);
        this.deliverToHubInReverse();
        assertEq(_hubHeadroom(SPOKE_A_EID), 0);
        assertEq(hubToken.balanceOf(alice), 300 ether);
    }

    function test_lzReceive_HubLedger_OutOfOrderReturnsWithHubSendInFlight() public {
        _sendToSpoke(SPOKE_A_EID, 300 ether);

        _sendFromSpoke(SPOKE_A_EID, 100 ether);
        _sendFromSpoke(SPOKE_A_EID, 200 ether);

        hubToken.mint(alice, 200 ether);
        _send(hub, SPOKE_A_EID, alice, bob, 200 ether);
        assertEq(_hubHeadroom(SPOKE_A_EID), 500 ether);

        this.deliverToHubInReverse();
        assertEq(_hubHeadroom(SPOKE_A_EID), 200 ether);

        verifyPackets(SPOKE_A_EID, address(spokes[SPOKE_A_EID]));
        assertEq(spokeTokens[SPOKE_A_EID].totalSupply(), _hubHeadroom(SPOKE_A_EID));
    }

    function test_lzReceive_HubLedger_WithFee() public {
        vm.prank(admin);
        hub.setDefaultFeeBps(FEE_BPS);

        OFTReceipt memory receipt = _sendToSpoke(SPOKE_A_EID, 100 ether);
        assertEq(receipt.amountReceivedLD, 90 ether);
        assertEq(_hubHeadroom(SPOKE_A_EID), receipt.amountReceivedLD);

        _sendFromSpoke(SPOKE_A_EID, 90 ether);
        verifyPackets(HUB_EID, address(hub));
        assertEq(_hubHeadroom(SPOKE_A_EID), 0);
    }

    function test_lzReceive_HubLedger_Revert_ExceedsNetOutflow() public {
        _sendToSpoke(SPOKE_A_EID, 300 ether);

        spokeTokens[SPOKE_A_EID].mint(bob, 1e12);
        _sendFromSpoke(SPOKE_A_EID, 300 ether + 1e12);

        vm.expectRevert(abi.encodeWithSelector(IRateLimiter.RateLimitExceeded.selector, 300 ether, 300 ether + 1e12));
        this.verifyPackets(HUB_EID, address(hub));
    }

    function test_lzReceive_HubLedger_Revert_OtherSpoke() public {
        _sendToSpoke(SPOKE_A_EID, 300 ether);
        assertEq(_hubHeadroom(SPOKE_B_EID), 0);

        spokeTokens[SPOKE_B_EID].mint(bob, 1 ether);
        _sendFromSpoke(SPOKE_B_EID, 1 ether);

        vm.expectRevert(abi.encodeWithSelector(IRateLimiter.RateLimitExceeded.selector, 0, 1 ether));
        this.verifyPackets(HUB_EID, address(hub));
        assertEq(_hubHeadroom(SPOKE_A_EID), 300 ether);
    }

    // ============ External Wrappers ============

    function sendExternal(
        OFTCoreExtendedRBACUpgradeable _oft,
        uint32 _dstEid,
        address _from,
        address _to,
        uint256 _amountLD
    ) external {
        _send(_oft, _dstEid, _from, _to, _amountLD);
    }

    function deliverToHubInReverse() external {
        DoubleEndedQueue.Bytes32Deque storage queue = packetsQueue[HUB_EID][addressToBytes32(address(hub))];
        bytes32[] memory guids = new bytes32[](DoubleEndedQueue.length(queue));
        for (uint256 i = 0; i < guids.length; i++) {
            guids[i] = DoubleEndedQueue.popBack(queue);
            this.validatePacket(packets[guids[i]], bytes(""));
        }
        for (uint256 i = guids.length; i > 0; i--) {
            this.lzReceive(packets[guids[i - 1]], optionsLookup[guids[i - 1]]);
        }
    }
}
