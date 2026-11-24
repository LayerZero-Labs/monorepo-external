// SPDX-License-Identifier: MIT
pragma solidity ^0.8.22;

import { AddressCast } from "@layerzerolabs/lz-evm-protocol-v2/contracts/libs/AddressCast.sol";
import { MockERC20 } from "@layerzerolabs/test-utils-evm-contracts/contracts/mocks/MockERC20.sol";
import { Ownable } from "@openzeppelin/contracts/access/Ownable.sol";
import { IERC20Errors } from "@openzeppelin/contracts/interfaces/draft-IERC6093.sol";
import { Initializable } from "@openzeppelin/contracts/proxy/utils/Initializable.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { Test } from "forge-std/Test.sol";
import { Vm } from "forge-std/Vm.sol";
import { IAirlock, AIRLOCK_ADDRESS } from "../../contracts/interfaces/IAirlock.sol";
import { IAirlockReceiver } from "../../contracts/interfaces/IAirlockReceiver.sol";
import { IZoneRouter } from "../../contracts/interfaces/IZoneRouter.sol";
import { ZoneRouter } from "../../contracts/ZoneRouter.sol";
import { ZoneRouterFactory } from "../../contracts/ZoneRouterFactory.sol";
import { MockAdversarialRouterToken } from "./mocks/MockAdversarialRouterToken.sol";
import { MockGenericAirlock, numbered } from "./mocks/MockGenericAirlock.sol";

contract ZoneRouterTest is Test {
    uint64 internal constant LOCAL = 7;
    /// Above `uint32`, so that a zone narrowed to 32 bits fails.
    uint64 internal constant REMOTE = uint64(type(uint32).max) + 99;
    bytes internal PEER = abi.encodePacked(keccak256("full-width remote application"));
    address internal constant RECIPIENT = address(0xbeef);
    uint256 internal constant INITIAL = 1_000 ether;
    MockERC20 internal token;
    ZoneRouter internal router;
    ZoneRouterFactory internal factory;
    uint96 internal routerSalt;
    MockGenericAirlock internal airlock;
    bool internal retryCallbackSuccess;
    bytes internal retryCallbackResult;

    function setUp() public virtual {
        token = new MockERC20(18);
        factory = new ZoneRouterFactory(address(new ZoneRouter()));
        router = _createRouter(address(token));
        MockGenericAirlock implementation = new MockGenericAirlock();
        vm.etch(AIRLOCK_ADDRESS, address(implementation).code);
        airlock = MockGenericAirlock(AIRLOCK_ADDRESS);
        router.setZonePeer(REMOTE, PEER);
        token.mint(address(this), INITIAL);
        token.mint(address(router), INITIAL);
        token.approve(address(router), type(uint256).max);
    }

    function test_constructor_Revert_ImplementationInitialization() public {
        ZoneRouter implementation = new ZoneRouter();
        vm.expectRevert(Initializable.InvalidInitialization.selector);
        implementation.initialize(
            address(this),
            IZoneRouter.Config(address(token), IZoneRouter.Mode.LockUnlock, 18, address(0), bytes4(0), bytes4(0))
        );
    }

    function test_initialize() public view {
        assertEq(router.owner(), address(this));
        assertEq(router.config().token, address(token));
    }

    function test_initialize_NamespacedStorage() public view {
        bytes32 slot = bytes32(
            uint256(keccak256(abi.encode(uint256(keccak256("layerzerov2.storage.zonerouter")) - 1))) & ~uint256(0xff)
        );
        assertEq(slot, 0x0456790dfd3b2585c24c79cad9a90da0a48da35ababc338f6e24b28613616300);
        assertEq(vm.load(address(router), slot), bytes32(uint256(uint160(address(token))) | (uint256(18) << 168)));
        assertEq(vm.load(address(router), keccak256(abi.encode(REMOTE, uint256(slot) + 2))), bytes32(uint256(65)));
        assertEq(vm.load(address(router), bytes32(uint256(slot) + 3)), bytes32(uint256(1)));
        assertEq(vm.load(address(router), keccak256(abi.encode(uint256(slot) + 3))), bytes32(uint256(REMOTE)));
        for (uint256 i; i < 4; ++i) {
            assertEq(vm.load(address(router), bytes32(i)), bytes32(0));
        }
    }

    function test_initialize_Revert_AlreadyInitialized() public {
        vm.expectRevert(Initializable.InvalidInitialization.selector);
        router.initialize(
            RECIPIENT,
            IZoneRouter.Config(address(token), IZoneRouter.Mode.LockUnlock, 18, address(0), bytes4(0), bytes4(0))
        );
    }

    function test_getZonePeers() public {
        IZoneRouter.ZonePeer[] memory peers = router.getZonePeers();
        assertEq(peers.length, 1);
        assertEq(peers[0].zone, REMOTE);
        assertEq(peers[0].zonePeer, PEER);
        router.setZonePeer(REMOTE, abi.encodePacked(bytes32(uint256(1))));
        router.setZonePeer(0, abi.encodePacked(bytes32(uint256(2))));
        peers = router.getZonePeers();
        assertEq(peers.length, 2);
        assertEq(peers[0].zonePeer, abi.encodePacked(bytes32(uint256(1))));
        assertEq(peers[1].zone, 0);
        router.setZonePeer(REMOTE, hex"");
        router.setZonePeer(REMOTE, hex"");
        peers = router.getZonePeers();
        assertEq(peers.length, 1);
        assertEq(peers[0].zone, 0);
        assertEq(peers[0].zonePeer, abi.encodePacked(bytes32(uint256(2))));
        router.setZonePeer(0, hex"");
        assertEq(router.getZonePeers().length, 0);
    }

    function test_getExtraInboundPeers() public {
        bytes memory extra = hex"010203";
        assertEq(router.getExtraInboundPeers(REMOTE).length, 0);
        router.setExtraInboundPeer(REMOTE, PEER, true);
        router.setExtraInboundPeer(REMOTE, extra, true);
        vm.expectRevert(
            abi.encodeWithSelector(IZoneRouter.ExtraInboundPeerStateIdempotent.selector, REMOTE, PEER, true)
        );
        router.setExtraInboundPeer(REMOTE, PEER, true);
        router.setExtraInboundPeer(REMOTE + 1, extra, true);
        assertEq(router.getExtraInboundPeers(REMOTE).length, 2);
        assertEq(router.getExtraInboundPeers(REMOTE + 1).length, 1);
        router.setExtraInboundPeer(REMOTE, PEER, false);
        vm.expectRevert(
            abi.encodeWithSelector(IZoneRouter.ExtraInboundPeerStateIdempotent.selector, REMOTE, PEER, false)
        );
        router.setExtraInboundPeer(REMOTE, PEER, false);
        bytes[] memory peers = router.getExtraInboundPeers(REMOTE);
        assertEq(peers.length, 1);
        assertEq(peers[0], extra);
        assertFalse(router.extraInboundPeers(REMOTE, PEER));
        assertTrue(router.extraInboundPeers(REMOTE, extra));
        assertTrue(router.extraInboundPeers(REMOTE + 1, extra));
        assertEq(router.zonePeers(REMOTE), PEER);
        router.setExtraInboundPeer(REMOTE, PEER, true);
        assertEq(router.getExtraInboundPeers(REMOTE).length, 2);
        router.setExtraInboundPeer(REMOTE, extra, false);
        router.setExtraInboundPeer(REMOTE, PEER, false);
        assertEq(router.getExtraInboundPeers(REMOTE).length, 0);
        assertEq(router.getExtraInboundPeers(REMOTE + 1).length, 1);
    }

    function test_sendToken_Gas() public {
        bytes memory memo = hex"0304";
        vm.expectEmit(true, true, true, true, address(router));
        emit IZoneRouter.Sent(REMOTE, PEER, 0, address(this), _address(RECIPIENT), 1 ether);
        uint64 nonce = router.sendToken(REMOTE, _address(RECIPIENT), 1 ether, memo);
        vm.snapshotGasLastCall(_group(), "sendToken_Gas");
        assertEq(nonce, 0);
        _assertSent(1 ether, _address(RECIPIENT), memo);
    }

    function test_sendToken_NoncesAreChannelScoped() public {
        bytes memory memo;
        assertEq(router.sendToken(REMOTE, _address(RECIPIENT), 1, memo), 0);
        assertEq(router.sendToken(REMOTE, _address(RECIPIENT), 1, memo), 1);
        router.setZonePeer(REMOTE + 1, PEER);
        assertEq(router.sendToken(REMOTE + 1, _address(RECIPIENT), 1, memo), 0);
    }

    function test_sendToken_EmptyReturnAccepted() public {
        MockAdversarialRouterToken adversary = new MockAdversarialRouterToken();
        ZoneRouter target = _createRouter(address(adversary));
        target.setZonePeer(REMOTE, PEER);
        adversary.setOperator(address(target));
        adversary.mint(address(this), 100);
        adversary.approve(address(target), 100);
        adversary.configure(
            MockAdversarialRouterToken.Effect.EmptyReturn,
            MockAdversarialRouterToken.Effect.EmptyReturn,
            MockAdversarialRouterToken.Effect.EmptyReturn
        );
        target.sendToken(REMOTE, _address(RECIPIENT), 10, hex"");
        assertEq(adversary.balanceOf(address(this)), 90);
        assertEq(adversary.balanceOf(address(target)), 10);
    }

    function test_sendToken_ZeroRecipient() public {
        bytes memory memo;
        vm.expectEmit(true, true, true, true, address(router));
        emit IZoneRouter.Sent(REMOTE, PEER, 0, address(this), abi.encodePacked(address(0)), 1);
        assertEq(router.sendToken(REMOTE, abi.encodePacked(address(0)), 1, memo), 0);
        _assertSent(1, abi.encodePacked(address(0)), memo);
    }

    function test_sendToken_ReentrantDebitRequiresAllowance() public {
        MockAdversarialRouterToken adversary = new MockAdversarialRouterToken();
        ZoneRouter target = _createRouter(address(adversary));
        target.setZonePeer(REMOTE, PEER);
        adversary.mint(address(this), 100);
        adversary.approve(address(target), 100);
        adversary.setCallback(
            address(target),
            abi.encodeCall(target.sendToken, (REMOTE, _address(RECIPIENT), 1, hex""))
        );
        adversary.configure(
            MockAdversarialRouterToken.Effect.Reenter,
            MockAdversarialRouterToken.Effect.Normal,
            MockAdversarialRouterToken.Effect.Normal
        );
        vm.expectRevert(
            abi.encodeWithSelector(IERC20Errors.ERC20InsufficientAllowance.selector, address(target), 0, 1)
        );
        target.sendToken(REMOTE, _address(RECIPIENT), 10, hex"");
        assertEq(adversary.balanceOf(address(this)), 100);
    }

    function test_sendToken_ReentrantDebitFundsEachSend() public {
        MockAdversarialRouterToken adversary = new MockAdversarialRouterToken();
        ZoneRouter target = _createRouter(address(adversary));
        target.setZonePeer(REMOTE, PEER);
        adversary.setOperator(address(target));
        adversary.mint(address(this), 100);
        adversary.mint(address(adversary), 1);
        adversary.approve(address(target), 100);
        vm.prank(address(adversary));
        adversary.approve(address(target), 1);
        adversary.setCallback(
            address(target),
            abi.encodeCall(target.sendToken, (REMOTE, _address(RECIPIENT), 1, hex""))
        );
        adversary.configure(
            MockAdversarialRouterToken.Effect.Reenter,
            MockAdversarialRouterToken.Effect.Normal,
            MockAdversarialRouterToken.Effect.Normal
        );
        assertEq(target.sendToken(REMOTE, _address(RECIPIENT), 10, hex""), 1);
        assertEq(adversary.balanceOf(address(this)), 90);
        assertEq(adversary.balanceOf(address(adversary)), 0);
        assertEq(adversary.balanceOf(address(target)), 11);
        assertEq(adversary.totalSupply(), 101);
    }

    function test_sendToken_Fuzz(uint96 _amount, bytes memory _recipient, bytes memory _memo) public {
        vm.assume(_recipient.length > 0 && _recipient.length <= 255);
        vm.assume(_memo.length <= 255);
        uint256 amount = bound(_amount, 1, INITIAL);
        vm.expectEmit(true, true, true, true, address(router));
        emit IZoneRouter.Sent(REMOTE, PEER, 0, address(this), _recipient, amount);
        assertEq(router.sendToken(REMOTE, _recipient, amount, _memo), 0);
        _assertSent(amount, _recipient, _memo);
    }

    function test_sendToken_Revert_UntrustedZonePeer() public {
        router.setZonePeer(REMOTE, hex"");
        vm.expectRevert(abi.encodeWithSelector(IZoneRouter.UntrustedZonePeer.selector, REMOTE, hex""));
        router.sendToken(REMOTE, _address(RECIPIENT), 1, hex"");
    }

    function test_sendToken_Revert_ZeroAmount() public {
        vm.expectRevert(IZoneRouter.ZeroAmount.selector);
        router.sendToken(REMOTE, _address(RECIPIENT), 0, hex"");
    }

    function test_sendToken_Revert_InsufficientAllowance() public {
        token.approve(address(router), 0);
        vm.expectRevert(
            abi.encodeWithSelector(IERC20Errors.ERC20InsufficientAllowance.selector, address(router), 0, 1)
        );
        router.sendToken(REMOTE, _address(RECIPIENT), 1, hex"");
    }

    function test_sendToken_Revert_AirlockRollbackThenRetry() public {
        airlock.setFail(true);
        vm.expectRevert(MockGenericAirlock.Rejected.selector);
        router.sendToken(REMOTE, _address(RECIPIENT), 3 ether, hex"");
        assertEq(token.balanceOf(address(this)), INITIAL);
        assertEq(token.balanceOf(address(router)), INITIAL);
        assertEq(token.totalSupply(), INITIAL * 2);
        airlock.setFail(false);
        assertEq(router.sendToken(REMOTE, _address(RECIPIENT), 3 ether, hex""), 0);
    }

    function test_sendToken_Revert_FalseReturn() public {
        MockAdversarialRouterToken adversary = new MockAdversarialRouterToken();
        ZoneRouter target = _createRouter(address(adversary));
        target.setZonePeer(REMOTE, PEER);
        adversary.setOperator(address(target));
        adversary.mint(address(this), 100);
        adversary.approve(address(target), 100);
        adversary.configure(
            MockAdversarialRouterToken.Effect.FalseReturn,
            MockAdversarialRouterToken.Effect.Normal,
            MockAdversarialRouterToken.Effect.Normal
        );
        vm.expectRevert(abi.encodeWithSelector(SafeERC20.SafeERC20FailedOperation.selector, address(adversary)));
        target.sendToken(REMOTE, _address(RECIPIENT), 10, hex"");
        assertEq(adversary.balanceOf(address(this)), 100);
        assertEq(adversary.balanceOf(address(target)), 0);
        assertEq(adversary.totalSupply(), 100);
    }

    function test_airlockReceive_MarkedThenValid() public {
        IAirlock.Message memory message = _incoming(10, _address(RECIPIENT));
        IAirlock.Message[] memory messages = new IAirlock.Message[](2);
        messages[0] = message;
        messages[1] = _at(message, 1);
        airlock.setMessages(address(router), REMOTE, PEER, numbered(messages, 0));
        router.markMessageForCaching(REMOTE, PEER, 0);
        vm.expectCall(address(router), abi.encodeCall(router.receiveMessage, (REMOTE, PEER, uint64(0), message)), 1);
        vm.expectCall(
            address(router),
            abi.encodeCall(router.receiveMessage, (REMOTE, PEER, uint64(1), messages[1])),
            1
        );
        vm.recordLogs();
        vm.prank(address(0x1234));
        router.airlockReceive(REMOTE, PEER, 0, 2);
        Vm.Log[] memory logs = vm.getRecordedLogs();
        IAirlock.Message memory retryPayload;
        for (uint256 i; i < logs.length; ++i) {
            if (logs[i].emitter == address(router) && logs[i].topics[0] == IZoneRouter.MessageCached.selector) {
                assertEq(logs[i].topics.length, 3);
                assertEq(logs[i].topics[1], bytes32(uint256(REMOTE)));
                assertEq(logs[i].topics[2], bytes32(0));
                bytes memory srcApp;
                (srcApp, retryPayload) = abi.decode(logs[i].data, (bytes, IAirlock.Message));
                assertEq(srcApp, PEER);
            }
        }
        assertEq(abi.encode(retryPayload), abi.encode(message));
        assertEq(router.cachedMessages(REMOTE, PEER, 0), keccak256(abi.encode(message)));
        assertEq(router.cachedMessages(REMOTE, PEER, 1), bytes32(0));
        assertTrue(router.messagesToCache(REMOTE, PEER, 0));
        _assertReceived(10, 2);
        vm.expectRevert(IZoneRouter.InvalidCachedMessage.selector);
        router.retryMessage(REMOTE, PEER, 0, _tampered(message));
        vm.prank(address(0x1234));
        router.retryMessage(REMOTE, PEER, 0, retryPayload);
        _assertReceived(20, 2);
        assertEq(router.cachedMessages(REMOTE, PEER, 0), bytes32(0));
        vm.expectRevert(IZoneRouter.InvalidCachedMessage.selector);
        router.retryMessage(REMOTE, PEER, 0, retryPayload);
        assertTrue(router.messagesToCache(REMOTE, PEER, 0));
        vm.expectRevert(abi.encodeWithSelector(IZoneRouter.MessageAlreadyMarkedForCaching.selector, REMOTE, PEER, 0));
        router.markMessageForCaching(REMOTE, PEER, 0);
    }

    function test_airlockReceive_MarkedMalformedPreservesClaim() public {
        IAirlock.Message[] memory messages = new IAirlock.Message[](1);
        messages[0] = _incoming(1, hex"01");
        airlock.setMessages(address(router), REMOTE, PEER, numbered(messages, 0));
        router.markMessageForCaching(REMOTE, PEER, 0);
        vm.expectCall(address(router), abi.encodeWithSelector(router.receiveMessage.selector), uint64(1));
        vm.expectEmit(true, true, true, true, address(router));
        emit IZoneRouter.MessageCached(REMOTE, PEER, 0, messages[0]);
        router.airlockReceive(REMOTE, PEER, 0, 1);
        assertEq(router.cachedMessages(REMOTE, PEER, 0), keccak256(abi.encode(messages[0])));
        vm.expectRevert(AddressCast.AddressCast_InvalidAddress.selector);
        router.retryMessage(REMOTE, PEER, 0, messages[0]);
        assertEq(router.cachedMessages(REMOTE, PEER, 0), keccak256(abi.encode(messages[0])));
        _assertReceived(0, 1);
    }

    function test_airlockReceive_MarkedLowGasRollsBackCursorAndClaim() public {
        _queue(_incoming(10, _address(RECIPIENT)));
        router.markMessageForCaching(REMOTE, PEER, 0);
        (bool success, ) = address(router).call{ gas: 110_000 }(
            abi.encodeCall(router.airlockReceive, (REMOTE, PEER, uint64(0), uint64(1)))
        );
        assertFalse(success);
        _assertUntouched();
        assertTrue(router.messagesToCache(REMOTE, PEER, 0));
        assertEq(router.cachedMessages(REMOTE, PEER, 0), bytes32(0));
        router.airlockReceive(REMOTE, PEER, 0, 1);
        _assertReceived(0, 1);
    }

    function test_airlockReceive_Gas_Marked() public {
        _queue(_incoming(10, _address(RECIPIENT)));
        router.markMessageForCaching(REMOTE, PEER, 0);
        vm.expectEmit(true, true, true, true, address(router));
        emit IZoneRouter.MessageCached(REMOTE, PEER, 0, _incoming(10, _address(RECIPIENT)));
        router.airlockReceive(REMOTE, PEER, 0, 1);
        vm.snapshotGasLastCall(_group(), "airlockReceive_Gas_Marked");
        _assertReceived(0, 1);
    }

    function test_airlockReceive_Gas_Failed() public {
        IAirlock.Message[] memory messages = new IAirlock.Message[](1);
        messages[0] = _incoming(1, hex"01");
        airlock.setMessages(address(router), REMOTE, PEER, numbered(messages, 0));
        vm.expectEmit(true, true, true, true, address(router));
        emit IZoneRouter.MessageCached(REMOTE, PEER, 0, messages[0]);
        router.airlockReceive(REMOTE, PEER, 0, 1);
        vm.snapshotGasLastCall(_group(), "airlockReceive_Gas_Failed");
        assertEq(router.cachedMessages(REMOTE, PEER, 0), keccak256(abi.encode(messages[0])));
        _assertReceived(0, 1);
    }

    function test_airlockReceive_TokenFailureDoesNotBlockNextRecipient() public {
        (MockAdversarialRouterToken adversary, ZoneRouter target, IAirlock.Message memory message) = _failedTransfer();
        address nextRecipient = address(0xabcd);
        IAirlock.Message memory transfer = abi.decode(abi.encode(message), (IAirlock.Message));
        transfer.recipient = _address(nextRecipient);
        IAirlock.Message[] memory messages = new IAirlock.Message[](1);
        messages[0] = transfer;
        airlock.appendMessages(
            address(target),
            REMOTE,
            PEER,
            numbered(messages, airlock.queued(address(target), REMOTE, PEER))
        );
        adversary.setEffectRecipient(RECIPIENT);
        target.airlockReceive(REMOTE, PEER, 1, 1);
        assertEq(adversary.balanceOf(nextRecipient), 10);
        assertEq(target.cachedMessages(REMOTE, PEER, 1), bytes32(0));
        assertEq(target.cachedMessages(REMOTE, PEER, 0), keccak256(abi.encode(message)));
        assertEq(target.cachedMessagesCount(REMOTE, PEER), 1);
    }

    function test_airlockReceive_MarkedGasBombDoesNotBlockNextRecipient() public {
        (MockAdversarialRouterToken adversary, ZoneRouter target, IAirlock.Message memory message) = _failedTransfer();
        IAirlock.Message memory transfer = abi.decode(abi.encode(message), (IAirlock.Message));
        transfer.recipient = _address(address(0xabcd));
        IAirlock.Message[] memory messages = new IAirlock.Message[](2);
        messages[0] = _at(message, 1);
        messages[1] = transfer;
        airlock.appendMessages(
            address(target),
            REMOTE,
            PEER,
            numbered(messages, airlock.queued(address(target), REMOTE, PEER))
        );
        adversary.setEffectRecipient(RECIPIENT);
        adversary.configure(
            MockAdversarialRouterToken.Effect.GasBomb,
            MockAdversarialRouterToken.Effect.GasBomb,
            MockAdversarialRouterToken.Effect.Normal
        );
        target.markMessageForCaching(REMOTE, PEER, 1);
        vm.expectCall(
            address(target),
            abi.encodeCall(target.receiveMessage, (REMOTE, PEER, uint64(1), messages[0])),
            0
        );
        target.airlockReceive{ gas: 500_000 }(REMOTE, PEER, 1, 2);
        assertEq(target.cachedMessages(REMOTE, PEER, 1), keccak256(abi.encode(messages[0])));
        assertEq(target.cachedMessages(REMOTE, PEER, 2), bytes32(0));
        assertEq(adversary.balanceOf(address(0xabcd)), 10);
        assertEq(airlock.cursor(address(target), REMOTE, PEER), 3);
    }

    function test_airlockReceive_ReturnBombCannotBlockLaterMessage() public {
        (MockAdversarialRouterToken adversary, ZoneRouter target, IAirlock.Message memory message) = _failedTransfer();
        IAirlock.Message memory transfer = abi.decode(abi.encode(message), (IAirlock.Message));
        transfer.recipient = _address(address(0xabcd));
        IAirlock.Message[] memory messages = new IAirlock.Message[](2);
        messages[0] = _at(message, 1);
        messages[1] = transfer;
        airlock.appendMessages(
            address(target),
            REMOTE,
            PEER,
            numbered(messages, airlock.queued(address(target), REMOTE, PEER))
        );
        adversary.setEffectRecipient(RECIPIENT);
        adversary.configure(
            MockAdversarialRouterToken.Effect.LargeRevert,
            MockAdversarialRouterToken.Effect.LargeRevert,
            MockAdversarialRouterToken.Effect.Normal
        );
        target.airlockReceive{ gas: 12_000_000 }(REMOTE, PEER, 1, 2);
        assertEq(target.cachedMessages(REMOTE, PEER, 0), keccak256(abi.encode(message)));
        assertEq(target.cachedMessagesCount(REMOTE, PEER), 2);
        assertEq(target.cachedMessages(REMOTE, PEER, 2), bytes32(0));
        assertEq(adversary.balanceOf(address(0xabcd)), 10);
        assertEq(airlock.cursor(address(target), REMOTE, PEER), 3);
    }

    function test_airlockReceive_LargeSuccessReturnRemainsIsolated() public {
        (MockAdversarialRouterToken adversary, ZoneRouter target, IAirlock.Message memory message) = _failedTransfer();
        IAirlock.Message[] memory messages = new IAirlock.Message[](1);
        messages[0] = _at(message, 1);
        airlock.appendMessages(
            address(target),
            REMOTE,
            PEER,
            numbered(messages, airlock.queued(address(target), REMOTE, PEER))
        );
        adversary.configure(
            MockAdversarialRouterToken.Effect.LargeReturn,
            MockAdversarialRouterToken.Effect.LargeReturn,
            MockAdversarialRouterToken.Effect.Normal
        );
        target.airlockReceive{ gas: 3_000_000 }(REMOTE, PEER, 1, 1);
        assertEq(airlock.cursor(address(target), REMOTE, PEER), 2);
        assertEq(target.cachedMessages(REMOTE, PEER, 1), bytes32(0));
        assertEq(adversary.balanceOf(RECIPIENT), 10);
    }

    function test_airlockReceive_LowGasRollsBackCursor() public {
        _queue(_incoming(10, _address(RECIPIENT)));
        (bool success, ) = address(router).call{ gas: 160_000 }(
            abi.encodeCall(router.airlockReceive, (REMOTE, PEER, uint64(0), uint64(1)))
        );
        assertFalse(success);
        _assertUntouched();
        assertEq(router.cachedMessages(REMOTE, PEER, 0), bytes32(0));
        router.airlockReceive(REMOTE, PEER, 0, 1);
        _assertReceived(10, 1);
    }

    function test_airlockReceive_Gas() public {
        _queue(_incoming(1 ether, _address(RECIPIENT)));
        vm.expectEmit(true, true, true, true, address(router));
        emit IZoneRouter.Received(REMOTE, PEER, 0, RECIPIENT, 1 ether);
        IAirlockReceiver(address(router)).airlockReceive(REMOTE, PEER, 0, 1);
        vm.snapshotGasLastCall(_group(), "airlockReceive_Gas");
        _assertReceived(1 ether, 1);
    }

    function test_airlockReceive_FullBatch() public {
        IAirlock.Message[] memory messages = new IAirlock.Message[](64);
        for (uint256 i = 0; i < 64; ++i) {
            messages[i] = _incoming(i + 1, _address(RECIPIENT));
        }
        airlock.setMessages(address(router), REMOTE, PEER, numbered(messages, 0));
        router.airlockReceive(REMOTE, PEER, 0, 64);
        _assertReceived(2_080, 64);
    }

    function test_airlockReceive_RouterRecipient() public {
        _queue(_incoming(10, _address(address(router))));
        vm.expectEmit(true, true, true, true, address(router));
        emit IZoneRouter.Received(REMOTE, PEER, 0, address(router), 10);
        router.airlockReceive(REMOTE, PEER, 0, 1);
        assertEq(token.balanceOf(address(router)), INITIAL);
        assertEq(airlock.cursor(address(router), REMOTE, PEER), 1);
        assertEq(router.cachedMessages(REMOTE, PEER, 0), bytes32(0));
    }

    function test_airlockReceive_IgnoresEmbeddedChannel() public {
        for (uint256 field; field < 4; ++field) {
            IAirlock.Message memory transfer = _incoming(1, _address(RECIPIENT));
            if (field == 0) transfer.srcZone += 1;
            if (field == 1) transfer.srcApp = abi.encodePacked(bytes32(uint256(1)));
            if (field == 2) transfer.dstZone += 1;
            if (field == 3) transfer.dstApp = abi.encodePacked(bytes32(uint256(1)));
            _queue(transfer);
            vm.expectEmit(true, true, true, true, address(router));
            emit IZoneRouter.Received(REMOTE, PEER, 0, RECIPIENT, 1);
            router.airlockReceive(REMOTE, PEER, 0, 1);
            _assertReceived(field + 1, 1);
            assertEq(router.cachedMessages(REMOTE, PEER, 0), bytes32(0));
        }
    }

    function test_airlockReceive_ZeroAmount() public {
        _queue(_incoming(0, _address(RECIPIENT)));
        vm.expectEmit(true, true, true, true, address(router));
        emit IZoneRouter.Received(REMOTE, PEER, 0, RECIPIENT, 0);
        router.airlockReceive(REMOTE, PEER, 0, 1);
        _assertReceived(0, 1);
        assertEq(router.cachedMessages(REMOTE, PEER, 0), bytes32(0));
        assertEq(router.cachedMessagesCount(REMOTE, PEER), 0);
    }

    function test_airlockReceive_FailureDoesNotRollBackEarlierCredit() public {
        IAirlock.Message[] memory messages = new IAirlock.Message[](2);
        messages[0] = _incoming(7 ether, _address(RECIPIENT));
        messages[1] = _incoming(1, hex"01");
        airlock.setMessages(address(router), REMOTE, PEER, numbered(messages, 0));
        router.airlockReceive(REMOTE, PEER, 0, 2);
        _assertReceived(7 ether, 2);
        assertEq(router.cachedMessages(REMOTE, PEER, 0), bytes32(0));
        assertEq(router.cachedMessages(REMOTE, PEER, 1), keccak256(abi.encode(messages[1])));
    }

    function test_airlockReceive_CachesTokenFailureAndReplayCallback() public {
        (MockAdversarialRouterToken adversary, ZoneRouter target, IAirlock.Message memory message) = _failedTransfer();
        assertEq(adversary.balanceOf(address(target)), 100);
        assertEq(adversary.balanceOf(RECIPIENT), 0);
        assertEq(airlock.cursor(address(target), REMOTE, PEER), 1);
        adversary.setCallback(
            address(target),
            abi.encodeCall(target.airlockReceive, (REMOTE, PEER, uint64(0), uint64(1)))
        );
        adversary.configure(
            MockAdversarialRouterToken.Effect.Reenter,
            MockAdversarialRouterToken.Effect.Reenter,
            MockAdversarialRouterToken.Effect.Normal
        );
        vm.expectRevert(abi.encodeWithSelector(MockGenericAirlock.Replay.selector, uint64(1), uint64(0)));
        target.retryMessage(REMOTE, PEER, 0, message);
        assertEq(target.cachedMessages(REMOTE, PEER, 0), keccak256(abi.encode(message)));
        assertEq(target.cachedMessagesCount(REMOTE, PEER), 1);
        assertEq(adversary.balanceOf(RECIPIENT), 0);
    }

    function test_airlockReceive_ReentrantNextBatch() public {
        MockAdversarialRouterToken adversary = new MockAdversarialRouterToken();
        ZoneRouter target = _createRouter(address(adversary));
        target.setZonePeer(REMOTE, PEER);
        adversary.setOperator(address(target));
        adversary.mint(address(target), 100);
        IAirlock.Message memory transfer = _incoming(10, _address(RECIPIENT));
        transfer.dstApp = _address(address(target));
        IAirlock.Message[] memory messages = new IAirlock.Message[](2);
        messages[0] = transfer;
        messages[1] = _at(transfer, 1);
        airlock.setMessages(address(target), REMOTE, PEER, numbered(messages, 0));
        adversary.setCallback(
            address(target),
            abi.encodeCall(target.airlockReceive, (REMOTE, PEER, uint64(1), uint64(1)))
        );
        adversary.configure(
            MockAdversarialRouterToken.Effect.Reenter,
            MockAdversarialRouterToken.Effect.Reenter,
            MockAdversarialRouterToken.Effect.Normal
        );
        target.airlockReceive(REMOTE, PEER, 0, 1);
        assertEq(adversary.balanceOf(RECIPIENT), 20);
        assertEq(adversary.balanceOf(address(target)), 80);
        assertEq(adversary.totalSupply(), 100);
        assertEq(airlock.cursor(address(target), REMOTE, PEER), 2);
    }

    function test_airlockReceive_CachesLiquidityShortageThenRetries() public {
        ZoneRouter target = _createRouter(address(token));
        target.setZonePeer(REMOTE, PEER);
        token.mint(address(target), 10);
        IAirlock.Message memory transfer = _incoming(7, _address(RECIPIENT));
        transfer.dstApp = _address(address(target));
        IAirlock.Message[] memory messages = new IAirlock.Message[](2);
        messages[0] = transfer;
        messages[1] = _at(transfer, 1);
        airlock.setMessages(address(target), REMOTE, PEER, numbered(messages, 0));
        target.airlockReceive(REMOTE, PEER, 0, 2);
        assertEq(token.balanceOf(address(target)), 3);
        assertEq(token.balanceOf(RECIPIENT), 7);
        assertEq(airlock.cursor(address(target), REMOTE, PEER), 2);
        assertEq(target.cachedMessages(REMOTE, PEER, 1), keccak256(abi.encode(messages[1])));
        token.mint(address(target), 4);
        target.retryMessage(REMOTE, PEER, 1, messages[1]);
        assertEq(token.balanceOf(RECIPIENT), 14);
        assertEq(target.cachedMessages(REMOTE, PEER, 1), bytes32(0));
    }

    function test_airlockReceive_Fuzz_GasBudget(uint24 _gas, uint8 _count) public {
        uint64 count = uint64(bound(_count, 1, 64));
        uint256 gasBudget = bound(_gas, 100_000, 4_000_000);
        IAirlock.Message[] memory messages = new IAirlock.Message[](count);
        for (uint256 i; i < messages.length; ++i) {
            messages[i] = _incoming(1, hex"01");
        }
        airlock.setMessages(address(router), REMOTE, PEER, numbered(messages, 0));
        (bool success, ) = address(router).call{ gas: gasBudget }(
            abi.encodeCall(router.airlockReceive, (REMOTE, PEER, uint64(0), count))
        );
        if (!success) {
            _assertUntouched();
            for (uint64 i; i < count; ++i) {
                assertEq(router.cachedMessages(REMOTE, PEER, i), bytes32(0));
            }
            router.airlockReceive(REMOTE, PEER, 0, count);
        }
        _assertReceived(0, count);
        for (uint64 i; i < count; ++i) {
            assertEq(router.cachedMessages(REMOTE, PEER, i), keccak256(abi.encode(messages[i])));
        }
    }

    function test_airlockReceive_ZeroRecipientCachesTokenFailure() public {
        IAirlock.Message memory message = _incoming(1, abi.encodePacked(address(0)));
        _receiveFailed(message);
        vm.expectRevert(abi.encodeWithSelector(IERC20Errors.ERC20InvalidReceiver.selector, address(0)));
        router.retryMessage(REMOTE, PEER, 0, message);
        assertEq(router.cachedMessages(REMOTE, PEER, 0), keccak256(abi.encode(message)));
    }

    function test_airlockReceive_Fuzz_InvalidRecipientThenValid(uint8 _length) public {
        uint256 length = bound(_length, 1, 255);
        if (length == 20) length = 21;
        IAirlock.Message[] memory messages = new IAirlock.Message[](2);
        messages[0] = _incoming(10, new bytes(length));
        messages[1] = _incoming(7, _address(RECIPIENT));
        airlock.setMessages(address(router), REMOTE, PEER, numbered(messages, 0));
        router.airlockReceive(REMOTE, PEER, 0, 2);
        _assertReceived(7, 2);
        assertEq(router.cachedMessages(REMOTE, PEER, 0), keccak256(abi.encode(messages[0])));
        assertEq(router.cachedMessages(REMOTE, PEER, 1), bytes32(0));
    }

    function test_airlockReceive_MaximumMessage() public {
        bytes memory sourceApp = new bytes(255);
        router.setZonePeer(REMOTE, sourceApp);
        IAirlock.Message[] memory messages = new IAirlock.Message[](1);
        messages[0] = IAirlock.Message(
            REMOTE,
            sourceApp,
            LOCAL,
            abi.encodePacked(address(router)),
            0,
            1,
            new bytes(255),
            new bytes(255),
            new bytes(255)
        );
        airlock.setMessages(address(router), REMOTE, sourceApp, numbered(messages, 0));
        router.airlockReceive(REMOTE, sourceApp, 0, 1);
        assertEq(airlock.cursor(address(router), REMOTE, sourceApp), 1);
        assertEq(router.cachedMessages(REMOTE, sourceApp, 0), keccak256(abi.encode(messages[0])));
        assertEq(token.balanceOf(address(router)), INITIAL);
    }

    function test_airlockReceive_Fuzz_CachesWrongLength(uint8 _length) public {
        uint256 length = bound(_length, 1, 255);
        if (length == 20) length = 21;
        _receiveFailed(_incoming(1, new bytes(length)));
    }

    function test_airlockReceive_Fuzz(uint96 _amount) public {
        uint256 amount = bound(_amount, 1, INITIAL);
        _queue(_incoming(amount, _address(RECIPIENT)));
        vm.prank(address(0x1234));
        router.airlockReceive(REMOTE, PEER, 0, 1);
        _assertReceived(amount, 1);
        assertEq(airlock.lastReceiver(), address(router));
        assertEq(airlock.lastSrcZone(), REMOTE);
        assertEq(airlock.lastSrcApp(), PEER);
        assertEq(airlock.lastFirstNonce(), 0);
        assertEq(airlock.lastCount(), 1);
    }

    function test_airlockReceive_Revert_EmptySourceApp() public {
        router.setZonePeer(REMOTE, hex"");
        IAirlock.Message[] memory messages = new IAirlock.Message[](1);
        messages[0] = _incoming(10, _address(RECIPIENT));
        airlock.setMessages(address(router), REMOTE, hex"", numbered(messages, 0));
        vm.expectRevert(abi.encodeWithSelector(MockGenericAirlock.InvalidAddressLength.selector, 1, 0));
        router.airlockReceive(REMOTE, hex"", 0, 1);
        assertEq(airlock.cursor(address(router), REMOTE, hex""), 0);
        assertEq(router.cachedMessages(REMOTE, hex"", 0), bytes32(0));
        assertEq(token.balanceOf(RECIPIENT), 0);
    }

    function test_airlockReceive_Revert_MarkedAuthentication() public {
        _queue(_incoming(10, _address(RECIPIENT)));
        router.markMessageForCaching(REMOTE, PEER, 0);
        airlock.setAuthenticationFailure(true);
        vm.expectRevert(MockGenericAirlock.InvalidProof.selector);
        router.airlockReceive(REMOTE, PEER, 0, 1);
        _assertUntouched();
        assertTrue(router.messagesToCache(REMOTE, PEER, 0));
        assertEq(router.cachedMessages(REMOTE, PEER, 0), bytes32(0));
    }

    function test_airlockReceive_ExtraInboundPeerAndIndependentChannels() public {
        bytes memory extra = hex"010203";
        router.setExtraInboundPeer(REMOTE, extra, true);
        IAirlock.Message[] memory messages = new IAirlock.Message[](1);
        messages[0] = _incoming(7, _address(RECIPIENT));
        airlock.setMessages(address(router), REMOTE, extra, numbered(messages, 0));
        router.markMessageForCaching(REMOTE, extra, 0);
        router.airlockReceive(REMOTE, extra, 0, 1);
        assertEq(router.cachedMessagesCount(REMOTE, extra), 1);
        assertEq(router.cachedMessagesCount(REMOTE, PEER), 0);
        assertEq(airlock.cursor(address(router), REMOTE, extra), 1);
        assertEq(airlock.cursor(address(router), REMOTE, PEER), 0);
        router.setExtraInboundPeer(REMOTE, extra, false);
        vm.expectRevert(abi.encodeWithSelector(IZoneRouter.UntrustedZonePeer.selector, REMOTE, extra));
        router.airlockReceive(REMOTE, extra, 1, 1);
        router.retryMessage(REMOTE, extra, 0, messages[0]);
        assertEq(router.cachedMessagesCount(REMOTE, extra), 0);
        assertEq(token.balanceOf(RECIPIENT), 7);
        assertEq(router.zonePeers(REMOTE), PEER);
    }

    function test_airlockReceive_ExtraInboundPeerAfterDefaultDisabled() public {
        router.setExtraInboundPeer(REMOTE, PEER, true);
        router.setZonePeer(REMOTE, hex"");
        _queue(_incoming(1, _address(RECIPIENT)));
        router.airlockReceive(REMOTE, PEER, 0, 1);
        assertEq(token.balanceOf(RECIPIENT), 1);
        vm.expectRevert(abi.encodeWithSelector(IZoneRouter.UntrustedZonePeer.selector, REMOTE, hex""));
        router.sendToken(REMOTE, _address(RECIPIENT), 1, hex"");
    }

    function test_airlockReceive_Fuzz_CachedMessagesCount(uint8 _count) public {
        uint64 count = uint64(bound(_count, 1, 64));
        IAirlock.Message[] memory messages = new IAirlock.Message[](count);
        for (uint64 i; i < count; ++i) {
            messages[i] = _incoming(0, _address(RECIPIENT));
            router.markMessageForCaching(REMOTE, PEER, i);
        }
        airlock.setMessages(address(router), REMOTE, PEER, numbered(messages, 0));
        router.airlockReceive(REMOTE, PEER, 0, count);
        assertEq(router.cachedMessagesCount(REMOTE, PEER), count);
        for (uint64 i; i < count; ++i) {
            router.retryMessage(REMOTE, PEER, i, messages[i]);
            assertEq(router.cachedMessagesCount(REMOTE, PEER), count - i - 1);
        }
    }

    function test_airlockReceive_Revert_UnconfiguredZone() public {
        vm.expectRevert(abi.encodeWithSelector(IZoneRouter.UntrustedZonePeer.selector, REMOTE + 1, PEER));
        router.airlockReceive(REMOTE + 1, PEER, 0, 1);
        router.setZonePeer(REMOTE, hex"");
        vm.expectRevert(abi.encodeWithSelector(IZoneRouter.UntrustedZonePeer.selector, REMOTE, PEER));
        router.airlockReceive(REMOTE, PEER, 0, 1);
    }

    function test_airlockReceive_Revert_ZeroExtraPeerEvenWhenMarked() public {
        router.markMessageForCaching(REMOTE, hex"", 0);
        vm.expectRevert(abi.encodeWithSelector(IZoneRouter.UntrustedZonePeer.selector, REMOTE, hex""));
        router.airlockReceive(REMOTE, hex"", 0, 1);
        vm.expectRevert(IZoneRouter.InvalidCachedMessage.selector);
        router.retryMessage(REMOTE, hex"", 0, _incoming(1, hex"01"));
        assertEq(airlock.cursor(address(router), REMOTE, hex""), 0);
    }

    function test_airlockReceive_Revert_WrongSourceApplication() public {
        bytes memory otherApp = abi.encodePacked(keccak256("other source application"));
        vm.expectRevert(abi.encodeWithSelector(IZoneRouter.UntrustedZonePeer.selector, REMOTE, otherApp));
        router.airlockReceive(REMOTE, otherApp, 0, 1);
        vm.expectRevert(abi.encodeWithSelector(IZoneRouter.UntrustedZonePeer.selector, REMOTE, hex""));
        router.airlockReceive(REMOTE, hex"", 0, 1);
        assertEq(airlock.cursor(address(router), REMOTE, PEER), 0);
    }

    function test_airlockReceive_Revert_ForgedProof() public {
        _queue(_incoming(1, _address(RECIPIENT)));
        airlock.setAuthenticationFailure(true);
        vm.expectRevert(MockGenericAirlock.InvalidProof.selector);
        router.airlockReceive(REMOTE, PEER, 0, 1);
        _assertUntouched();
    }

    function test_airlockReceive_Revert_InvalidCounts() public {
        vm.expectRevert(MockGenericAirlock.EmptyBatch.selector);
        router.airlockReceive(REMOTE, PEER, 0, 0);
        vm.expectRevert(abi.encodeWithSelector(MockGenericAirlock.BatchTooLarge.selector, uint64(65), uint64(64)));
        router.airlockReceive(REMOTE, PEER, 0, 65);
    }

    function test_airlockReceive_Revert_GapAndReplay() public {
        _queue(_incoming(1, _address(RECIPIENT)));
        vm.expectRevert(abi.encodeWithSelector(MockGenericAirlock.Gap.selector, uint64(0), uint64(1)));
        router.airlockReceive(REMOTE, PEER, 1, 1);
        router.airlockReceive(REMOTE, PEER, 0, 1);
        vm.expectRevert(abi.encodeWithSelector(MockGenericAirlock.Replay.selector, uint64(1), uint64(0)));
        router.airlockReceive(REMOTE, PEER, 0, 1);
        assertEq(token.balanceOf(RECIPIENT), 1);
        assertEq(router.cachedMessagesCount(REMOTE, PEER), 0);
    }

    function test_airlockReceive_Revert_AirlockFailure() public {
        _queue(_incoming(1, _address(RECIPIENT)));
        airlock.setFail(true);
        vm.expectRevert(MockGenericAirlock.Rejected.selector);
        router.airlockReceive(REMOTE, PEER, 0, 1);
        _assertUntouched();
    }

    function test_receiveMessage_Revert_OnlySelf() public {
        IAirlock.Message memory message = _incoming(1, _address(RECIPIENT));
        vm.expectRevert(abi.encodeWithSelector(IZoneRouter.OnlySelf.selector, address(this)));
        router.receiveMessage(REMOTE, PEER, 0, message);
        _assertUntouched();
    }

    function test_retryMessage_UsesAuthenticatedChannel() public {
        IAirlock.Message memory transfer = _incoming(1, _address(RECIPIENT));
        transfer.srcZone += 1;
        transfer.srcApp = abi.encodePacked(bytes32(uint256(1)));
        transfer.dstZone += 1;
        transfer.dstApp = abi.encodePacked(bytes32(uint256(1)));
        IAirlock.Message memory message = transfer;
        router.markMessageForCaching(REMOTE, PEER, 0);
        _receiveFailed(message);
        assertEq(router.cachedMessages(transfer.srcZone, transfer.srcApp, 0), bytes32(0));
        router.setZonePeer(transfer.srcZone, transfer.srcApp);
        vm.expectRevert(IZoneRouter.InvalidCachedMessage.selector);
        router.retryMessage(transfer.srcZone, transfer.srcApp, 0, message);
        vm.expectEmit(true, true, true, true, address(router));
        emit IZoneRouter.Received(REMOTE, PEER, 0, RECIPIENT, 1);
        vm.prank(RECIPIENT);
        router.retryMessage(REMOTE, PEER, 0, message);
        _assertReceived(1, 1);
        assertEq(router.cachedMessages(REMOTE, PEER, 0), bytes32(0));
        vm.expectRevert(IZoneRouter.InvalidCachedMessage.selector);
        router.retryMessage(REMOTE, PEER, 0, message);
    }

    function test_retryMessage_Gas() public {
        (MockAdversarialRouterToken adversary, ZoneRouter target, IAirlock.Message memory message) = _failedTransfer();
        adversary.configure(
            MockAdversarialRouterToken.Effect.Normal,
            MockAdversarialRouterToken.Effect.Normal,
            MockAdversarialRouterToken.Effect.Normal
        );
        vm.expectEmit(true, true, true, true, address(target));
        emit IZoneRouter.Received(REMOTE, PEER, 0, RECIPIENT, 10);
        vm.prank(address(0x1234));
        target.retryMessage(REMOTE, PEER, 0, message);
        vm.snapshotGasLastCall(_group(), "retryMessage_Gas");
        assertEq(target.cachedMessages(REMOTE, PEER, 0), bytes32(0));
        assertEq(target.cachedMessagesCount(REMOTE, PEER), 0);
        assertEq(adversary.balanceOf(RECIPIENT), 10);
        assertEq(adversary.balanceOf(address(target)), 90);
        vm.expectRevert(IZoneRouter.InvalidCachedMessage.selector);
        target.retryMessage(REMOTE, PEER, 0, message);
    }

    function test_retryMessage_AfterPeerRevocationAndRotation() public {
        (MockAdversarialRouterToken adversary, ZoneRouter target, IAirlock.Message memory message) = _failedTransfer();
        target.setZonePeer(REMOTE, hex"");
        target.setExtraInboundPeer(REMOTE, PEER, true);
        target.setExtraInboundPeer(REMOTE, PEER, false);
        target.setZonePeer(REMOTE, hex"01");
        adversary.configure(
            MockAdversarialRouterToken.Effect.Normal,
            MockAdversarialRouterToken.Effect.Normal,
            MockAdversarialRouterToken.Effect.Normal
        );
        vm.expectEmit(true, true, true, true, address(target));
        emit IZoneRouter.Received(REMOTE, PEER, 0, RECIPIENT, 10);
        target.retryMessage(REMOTE, PEER, 0, message);
        assertEq(target.cachedMessages(REMOTE, PEER, 0), bytes32(0));
        assertEq(target.cachedMessagesCount(REMOTE, PEER), 0);
        assertEq(adversary.balanceOf(RECIPIENT), 10);
    }

    function test_retryMessage_FailureRestoresClaim() public {
        (, ZoneRouter target, IAirlock.Message memory message) = _failedTransfer();
        vm.expectRevert(MockAdversarialRouterToken.Rejected.selector);
        target.retryMessage(REMOTE, PEER, 0, message);
        assertEq(target.cachedMessages(REMOTE, PEER, 0), keccak256(abi.encode(message)));
        assertEq(target.cachedMessagesCount(REMOTE, PEER), 1);
        assertEq(airlock.cursor(address(target), REMOTE, PEER), 1);
    }

    function test_retryMessage_CallbackCannotRepeatClaim() public {
        (MockAdversarialRouterToken adversary, ZoneRouter target, IAirlock.Message memory message) = _failedTransfer();
        adversary.setCallback(address(this), abi.encodeCall(this.captureRetry, (address(target), message)));
        adversary.configure(
            MockAdversarialRouterToken.Effect.Reenter,
            MockAdversarialRouterToken.Effect.Reenter,
            MockAdversarialRouterToken.Effect.Normal
        );
        target.retryMessage(REMOTE, PEER, 0, message);
        assertFalse(retryCallbackSuccess);
        assertEq(retryCallbackResult, abi.encodeWithSelector(IZoneRouter.InvalidCachedMessage.selector));
        assertEq(target.cachedMessages(REMOTE, PEER, 0), bytes32(0));
        assertEq(target.cachedMessagesCount(REMOTE, PEER), 0);
        assertEq(adversary.balanceOf(RECIPIENT), 10);
    }

    function test_retryMessage_CallbackCanSettleAnotherClaim() public {
        (MockAdversarialRouterToken adversary, ZoneRouter target, IAirlock.Message memory message) = _failedTransfer();
        IAirlock.Message[] memory messages = new IAirlock.Message[](1);
        messages[0] = _at(message, 1);
        airlock.appendMessages(
            address(target),
            REMOTE,
            PEER,
            numbered(messages, airlock.queued(address(target), REMOTE, PEER))
        );
        target.airlockReceive(REMOTE, PEER, 1, 1);
        adversary.setCallback(
            address(target),
            abi.encodeCall(target.retryMessage, (REMOTE, PEER, uint64(1), messages[0]))
        );
        adversary.configure(
            MockAdversarialRouterToken.Effect.Reenter,
            MockAdversarialRouterToken.Effect.Reenter,
            MockAdversarialRouterToken.Effect.Normal
        );
        target.retryMessage(REMOTE, PEER, 0, message);
        assertEq(target.cachedMessages(REMOTE, PEER, 0), bytes32(0));
        assertEq(target.cachedMessages(REMOTE, PEER, 1), bytes32(0));
        assertEq(target.cachedMessagesCount(REMOTE, PEER), 0);
        assertEq(adversary.balanceOf(RECIPIENT), 20);
        assertEq(adversary.balanceOf(address(target)), 80);
    }

    function test_retryMessage_GasBombRetainsClaim() public {
        (MockAdversarialRouterToken adversary, ZoneRouter target, IAirlock.Message memory message) = _failedTransfer();
        adversary.configure(
            MockAdversarialRouterToken.Effect.GasBomb,
            MockAdversarialRouterToken.Effect.GasBomb,
            MockAdversarialRouterToken.Effect.Normal
        );
        (bool success, ) = address(target).call{ gas: 200_000 }(
            abi.encodeCall(target.retryMessage, (REMOTE, PEER, uint64(0), message))
        );
        assertFalse(success);
        assertEq(target.cachedMessages(REMOTE, PEER, 0), keccak256(abi.encode(message)));
        assertEq(target.cachedMessagesCount(REMOTE, PEER), 1);
        assertEq(adversary.balanceOf(RECIPIENT), 0);
    }

    function test_retryMessage_Revert_EmptySourceApp() public {
        router.setZonePeer(REMOTE, hex"");
        router.markMessageForCaching(REMOTE, hex"", 0);
        vm.expectRevert(IZoneRouter.InvalidCachedMessage.selector);
        router.retryMessage(REMOTE, hex"", 0, _incoming(10, _address(RECIPIENT)));
        assertEq(router.cachedMessages(REMOTE, hex"", 0), bytes32(0));
        assertTrue(router.messagesToCache(REMOTE, hex"", 0));
        assertEq(token.balanceOf(RECIPIENT), 0);
    }

    function test_retryMessage_Revert_PayloadOrChannelMismatch() public {
        (, ZoneRouter target, IAirlock.Message memory message) = _failedTransfer();
        vm.expectRevert(IZoneRouter.InvalidCachedMessage.selector);
        target.retryMessage(REMOTE, PEER, 0, _tampered(message));
        vm.expectRevert(IZoneRouter.InvalidCachedMessage.selector);
        target.retryMessage(REMOTE, PEER, 1, message);
        target.setZonePeer(REMOTE + 1, PEER);
        vm.expectRevert(IZoneRouter.InvalidCachedMessage.selector);
        target.retryMessage(REMOTE + 1, PEER, 0, message);
        assertEq(target.cachedMessages(REMOTE, PEER, 0), keccak256(abi.encode(message)));
        assertEq(target.cachedMessagesCount(REMOTE, PEER), 1);
    }

    function test_retryMessage_Fuzz_Revert_FieldMismatch(uint8 _field) public {
        (, ZoneRouter target, IAirlock.Message memory message) = _failedTransfer();
        bytes32 originalHash = keccak256(abi.encode(message));
        uint256 field = bound(_field, 0, 8);
        if (field == 0) message.srcZone ^= 1;
        if (field == 1) message.srcApp = bytes.concat(message.srcApp, hex"01");
        if (field == 2) message.dstZone ^= 1;
        if (field == 3) message.dstApp = bytes.concat(message.dstApp, hex"01");
        if (field == 4) message.amount18d ^= 1;
        if (field == 5) message.sender = bytes.concat(message.sender, hex"01");
        if (field == 6) message.recipient = bytes.concat(message.recipient, hex"01");
        if (field == 7) message.memo = bytes.concat(message.memo, hex"01");
        // The claim is looked up at nonce 0, but the message names another nonce.
        if (field == 8) message.nonce ^= 1;
        vm.expectRevert(IZoneRouter.InvalidCachedMessage.selector);
        target.retryMessage(REMOTE, PEER, 0, message);
        assertEq(target.cachedMessages(REMOTE, PEER, 0), originalHash);
    }

    function test_rescueMessage_Gas() public {
        IAirlock.Message memory message = _incoming(10, hex"01");
        _receiveFailed(message);
        vm.expectEmit(true, true, true, true, address(router));
        emit IZoneRouter.MessageRescued(REMOTE, PEER, 0, RECIPIENT, 10);
        router.rescueMessage(REMOTE, PEER, 0, message, RECIPIENT);
        vm.snapshotGasLastCall(_group(), "rescueMessage_Gas");
        assertEq(router.cachedMessages(REMOTE, PEER, 0), bytes32(0));
        assertEq(router.cachedMessagesCount(REMOTE, PEER), 0);
        _assertReceived(10, 1);
        vm.expectRevert(IZoneRouter.InvalidCachedMessage.selector);
        router.rescueMessage(REMOTE, PEER, 0, message, RECIPIENT);
        vm.expectRevert(IZoneRouter.InvalidCachedMessage.selector);
        router.retryMessage(REMOTE, PEER, 0, message);
    }

    function test_rescueMessage_RecipientLengths() public {
        uint256[6] memory lengths = [uint256(0), 1, 19, 21, 32, 255];
        IAirlock.Message[] memory messages = new IAirlock.Message[](lengths.length);
        for (uint256 i; i < lengths.length; ++i) messages[i] = _incoming(1, new bytes(lengths[i]));
        airlock.setMessages(address(router), REMOTE, PEER, numbered(messages, 0));
        router.airlockReceive(REMOTE, PEER, 0, uint64(messages.length));
        assertEq(router.cachedMessagesCount(REMOTE, PEER), lengths.length);
        for (uint64 i; i < messages.length; ++i) {
            router.rescueMessage(REMOTE, PEER, i, messages[i], RECIPIENT);
            assertEq(router.cachedMessages(REMOTE, PEER, i), bytes32(0));
            assertEq(router.cachedMessagesCount(REMOTE, PEER), lengths.length - i - 1);
        }
        _assertReceived(lengths.length, uint64(lengths.length));
    }

    function test_rescueMessage_AfterPeerRevocationUsesAuthenticatedChannel() public {
        IAirlock.Message memory message = _incoming(10, hex"01");
        message.srcZone += 1;
        message.srcApp = hex"02";
        _receiveFailed(message);
        router.setZonePeer(REMOTE, hex"");
        vm.recordLogs();
        vm.expectEmit(true, true, true, true, address(router));
        emit IZoneRouter.MessageRescued(REMOTE, PEER, 0, RECIPIENT, 10);
        router.rescueMessage(REMOTE, PEER, 0, message, RECIPIENT);
        Vm.Log[] memory logs = vm.getRecordedLogs();
        Vm.Log memory entry = logs[logs.length - 1];
        assertEq(entry.emitter, address(router));
        assertEq(entry.topics.length, 4);
        assertEq(entry.topics[0], IZoneRouter.MessageRescued.selector);
        assertEq(entry.topics[1], bytes32(uint256(REMOTE)));
        assertEq(entry.topics[2], bytes32(0));
        assertEq(entry.topics[3], bytes32(uint256(uint160(RECIPIENT))));
        (bytes memory srcApp, uint256 amountLD) = abi.decode(entry.data, (bytes, uint256));
        assertEq(srcApp, PEER);
        assertEq(amountLD, 10);
        assertEq(router.cachedMessagesCount(REMOTE, PEER), 0);
        assertEq(router.cachedMessagesCount(message.srcZone, message.srcApp), 0);
        _assertReceived(10, 1);
    }

    function test_rescueMessage_SelfRecipient() public {
        IAirlock.Message memory message = _incoming(1, hex"01");
        _receiveFailed(message);
        router.rescueMessage(REMOTE, PEER, 0, message, address(router));
        assertEq(router.cachedMessagesCount(REMOTE, PEER), 0);
        assertEq(token.balanceOf(address(router)), INITIAL);
    }

    function test_rescueMessage_FailureRestoresClaimAndCallbackCannotRepeat() public {
        MockAdversarialRouterToken asset = new MockAdversarialRouterToken();
        ZoneRouter target = _createRouter(address(asset));
        target.setZonePeer(REMOTE, PEER);
        asset.mint(address(target), 100);
        IAirlock.Message memory message = _incoming(10, hex"01");
        IAirlock.Message[] memory messages = new IAirlock.Message[](1);
        messages[0] = message;
        airlock.setMessages(address(target), REMOTE, PEER, numbered(messages, 0));
        target.airlockReceive(REMOTE, PEER, 0, 1);
        asset.configure(
            MockAdversarialRouterToken.Effect.Revert,
            MockAdversarialRouterToken.Effect.Normal,
            MockAdversarialRouterToken.Effect.Normal
        );
        vm.expectRevert(MockAdversarialRouterToken.Rejected.selector);
        target.rescueMessage(REMOTE, PEER, 0, message, RECIPIENT);
        assertEq(target.cachedMessages(REMOTE, PEER, 0), keccak256(abi.encode(message)));
        assertEq(target.cachedMessagesCount(REMOTE, PEER), 1);
        asset.setCallback(address(this), abi.encodeCall(this.captureRescue, (address(target), message)));
        asset.configure(
            MockAdversarialRouterToken.Effect.Reenter,
            MockAdversarialRouterToken.Effect.Normal,
            MockAdversarialRouterToken.Effect.Normal
        );
        target.rescueMessage(REMOTE, PEER, 0, message, RECIPIENT);
        assertFalse(retryCallbackSuccess);
        assertEq(retryCallbackResult, abi.encodeWithSelector(IZoneRouter.InvalidCachedMessage.selector));
        assertEq(target.cachedMessagesCount(REMOTE, PEER), 0);
        assertEq(target.cachedMessages(REMOTE, PEER, 0), bytes32(0));
        assertEq(asset.balanceOf(RECIPIENT), 10);
    }

    function test_rescueMessage_Revert_NotOwner() public {
        IAirlock.Message memory message = _incoming(1, hex"01");
        _receiveFailed(message);
        vm.prank(RECIPIENT);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, RECIPIENT));
        router.rescueMessage(REMOTE, PEER, 0, message, RECIPIENT);
        assertEq(router.cachedMessagesCount(REMOTE, PEER), 1);
    }

    function test_rescueMessage_Revert_ZeroRecipient() public {
        IAirlock.Message memory message = _incoming(1, hex"01");
        _receiveFailed(message);
        vm.expectRevert(IZoneRouter.InvalidRescueRecipient.selector);
        router.rescueMessage(REMOTE, PEER, 0, message, address(0));
        assertEq(router.cachedMessagesCount(REMOTE, PEER), 1);
    }

    function test_rescueMessage_Revert_ValidOriginalRecipient() public {
        IAirlock.Message[] memory messages = new IAirlock.Message[](2);
        messages[0] = _incoming(1, _address(RECIPIENT));
        messages[1] = _incoming(1, _address(address(0)));
        airlock.setMessages(address(router), REMOTE, PEER, numbered(messages, 0));
        router.markMessageForCaching(REMOTE, PEER, 0);
        router.airlockReceive(REMOTE, PEER, 0, 2);
        for (uint64 i; i < messages.length; ++i) {
            vm.expectRevert(IZoneRouter.InvalidRescueMessage.selector);
            router.rescueMessage(REMOTE, PEER, i, messages[i], RECIPIENT);
            assertEq(router.cachedMessages(REMOTE, PEER, i), keccak256(abi.encode(messages[i])));
        }
        assertEq(router.cachedMessagesCount(REMOTE, PEER), 2);
    }

    function test_rescueMessage_Revert_WrongPayloadOrChannel() public {
        IAirlock.Message memory message = _incoming(1, hex"01");
        _receiveFailed(message);
        vm.expectRevert(IZoneRouter.InvalidCachedMessage.selector);
        router.rescueMessage(REMOTE, PEER, 0, _tampered(message), RECIPIENT);
        vm.expectRevert(IZoneRouter.InvalidCachedMessage.selector);
        router.rescueMessage(REMOTE + 1, PEER, 0, message, RECIPIENT);
        vm.expectRevert(IZoneRouter.InvalidCachedMessage.selector);
        router.rescueMessage(REMOTE, hex"02", 0, message, RECIPIENT);
        vm.expectRevert(IZoneRouter.InvalidCachedMessage.selector);
        router.rescueMessage(REMOTE, PEER, 1, message, RECIPIENT);
        assertEq(router.cachedMessagesCount(REMOTE, PEER), 1);
    }

    function test_setZonePeer() public {
        vm.expectEmit(true, true, true, true, address(router));
        emit IZoneRouter.ZonePeerSet(REMOTE, hex"");
        router.setZonePeer(REMOTE, hex"");
        assertEq(router.zonePeers(REMOTE), hex"");
    }

    function test_setZonePeer_Unchanged() public {
        vm.expectEmit(true, true, true, true, address(router));
        emit IZoneRouter.ZonePeerSet(REMOTE, PEER);
        router.setZonePeer(REMOTE, PEER);
        assertEq(router.getZonePeers().length, 1);
        router.setZonePeer(REMOTE, hex"");
        vm.expectEmit(true, true, true, true, address(router));
        emit IZoneRouter.ZonePeerSet(REMOTE, hex"");
        router.setZonePeer(REMOTE, hex"");
        assertEq(router.getZonePeers().length, 0);
    }

    function test_setZonePeer_Fuzz(uint64 _zone, bytes memory _zonePeer) public {
        vm.expectEmit(true, true, true, true, address(router));
        emit IZoneRouter.ZonePeerSet(_zone, _zonePeer);
        router.setZonePeer(_zone, _zonePeer);
        assertEq(router.zonePeers(_zone), _zonePeer);
    }

    function test_setZonePeer_Revert_NotOwner() public {
        vm.prank(RECIPIENT);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, RECIPIENT));
        router.setZonePeer(REMOTE, PEER);
    }

    function test_setExtraInboundPeer() public {
        vm.recordLogs();
        vm.expectEmit(true, true, true, true, address(router));
        emit IZoneRouter.ExtraInboundPeerSet(REMOTE, PEER, true);
        router.setExtraInboundPeer(REMOTE, PEER, true);
        Vm.Log[] memory logs = vm.getRecordedLogs();
        Vm.Log memory entry = logs[logs.length - 1];
        assertEq(entry.emitter, address(router));
        assertEq(entry.topics.length, 2);
        assertEq(entry.topics[0], IZoneRouter.ExtraInboundPeerSet.selector);
        assertEq(entry.topics[1], bytes32(uint256(REMOTE)));
        (bytes memory srcApp, bool allowed) = abi.decode(entry.data, (bytes, bool));
        assertEq(srcApp, PEER);
        assertTrue(allowed);
        assertTrue(router.extraInboundPeers(REMOTE, PEER));
        router.setExtraInboundPeer(REMOTE, PEER, false);
        assertFalse(router.extraInboundPeers(REMOTE, PEER));
        assertEq(router.zonePeers(REMOTE), PEER);
    }

    function test_setExtraInboundPeer_Fuzz(uint64 _zone, bytes memory _app, bool _allowed) public {
        if (!_allowed) router.setExtraInboundPeer(_zone, _app, true);
        vm.expectEmit(true, true, true, true, address(router));
        emit IZoneRouter.ExtraInboundPeerSet(_zone, _app, _allowed);
        router.setExtraInboundPeer(_zone, _app, _allowed);
        assertEq(router.extraInboundPeers(_zone, _app), _allowed);
        bytes[] memory peers = router.getExtraInboundPeers(_zone);
        assertEq(peers.length, _allowed ? 1 : 0);
        if (_allowed) assertEq(peers[0], _app);
    }

    function test_setExtraInboundPeer_Revert_NotOwner() public {
        vm.prank(RECIPIENT);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, RECIPIENT));
        router.setExtraInboundPeer(REMOTE, PEER, true);
        assertFalse(router.extraInboundPeers(REMOTE, PEER));
        assertEq(router.getExtraInboundPeers(REMOTE).length, 0);
    }

    function test_setExtraInboundPeer_Fuzz_Revert_StateIdempotent(
        uint64 _zone,
        bytes memory _app,
        bool _allowed
    ) public {
        if (_allowed) router.setExtraInboundPeer(_zone, _app, true);
        vm.recordLogs();
        vm.expectRevert(
            abi.encodeWithSelector(IZoneRouter.ExtraInboundPeerStateIdempotent.selector, _zone, _app, _allowed)
        );
        router.setExtraInboundPeer(_zone, _app, _allowed);
        assertEq(vm.getRecordedLogs().length, 0);
        assertEq(router.extraInboundPeers(_zone, _app), _allowed);
        assertEq(router.getExtraInboundPeers(_zone).length, _allowed ? 1 : 0);
    }

    function test_markMessageForCaching() public {
        vm.recordLogs();
        vm.expectEmit(true, true, true, true, address(router));
        emit IZoneRouter.MessageMarkedForCaching(REMOTE, PEER, 0);
        router.markMessageForCaching(REMOTE, PEER, 0);
        Vm.Log[] memory logs = vm.getRecordedLogs();
        Vm.Log memory entry = logs[logs.length - 1];
        assertEq(entry.emitter, address(router));
        assertEq(entry.topics.length, 3);
        assertEq(entry.topics[0], IZoneRouter.MessageMarkedForCaching.selector);
        assertEq(entry.topics[1], bytes32(uint256(REMOTE)));
        assertEq(entry.topics[2], bytes32(0));
        assertEq(abi.decode(entry.data, (bytes)), PEER);
        assertTrue(router.messagesToCache(REMOTE, PEER, 0));
        assertEq(router.cachedMessages(REMOTE, PEER, 0), bytes32(0));
        _assertUntouched();
    }

    function test_markMessageForCaching_Gas() public {
        vm.expectEmit(true, true, true, true, address(router));
        emit IZoneRouter.MessageMarkedForCaching(REMOTE, PEER, 0);
        router.markMessageForCaching(REMOTE, PEER, 0);
        vm.snapshotGasLastCall(_group(), "markMessageForCaching_Gas");
        assertTrue(router.messagesToCache(REMOTE, PEER, 0));
    }

    function test_markMessageForCaching_NamespacedStorage() public {
        router.markMessageForCaching(REMOTE, PEER, 5);
        bytes32 slot = 0x0456790dfd3b2585c24c79cad9a90da0a48da35ababc338f6e24b28613616300;
        bytes32 zoneSlot = keccak256(abi.encode(REMOTE, uint256(slot) + 8));
        bytes32 appSlot = keccak256(abi.encodePacked(PEER, zoneSlot));
        assertEq(vm.load(address(router), keccak256(abi.encode(uint256(0), appSlot))), bytes32(uint256(1) << 5));
        (, ZoneRouter target, IAirlock.Message memory message) = _failedTransfer();
        zoneSlot = keccak256(abi.encode(REMOTE, uint256(slot) + 6));
        appSlot = keccak256(abi.encodePacked(PEER, zoneSlot));
        assertEq(vm.load(address(target), keccak256(abi.encode(uint64(0), appSlot))), keccak256(abi.encode(message)));
        zoneSlot = keccak256(abi.encode(REMOTE, uint256(slot) + 7));
        assertEq(vm.load(address(target), keccak256(abi.encodePacked(PEER, zoneSlot))), bytes32(uint256(1)));
        target.setExtraInboundPeer(REMOTE, PEER, true);
        zoneSlot = keccak256(abi.encode(REMOTE, uint256(slot) + 5));
        assertEq(vm.load(address(target), zoneSlot), bytes32(uint256(1)));
        bytes32 positionsSlot = bytes32(uint256(zoneSlot) + 1);
        assertEq(vm.load(address(target), keccak256(abi.encodePacked(PEER, positionsSlot))), bytes32(uint256(1)));
    }

    function test_markMessageForCaching_BitmapBuckets() public {
        uint64[4] memory nonces = [uint64(0), uint64(255), uint64(256), type(uint64).max];
        for (uint256 i; i < nonces.length; ++i) {
            uint64 nonce = nonces[i];
            assertFalse(router.messagesToCache(REMOTE, PEER, nonce));
            router.markMessageForCaching(REMOTE, PEER, nonce);
            vm.expectRevert(
                abi.encodeWithSelector(IZoneRouter.MessageAlreadyMarkedForCaching.selector, REMOTE, PEER, nonce)
            );
            router.markMessageForCaching(REMOTE, PEER, nonce);
            assertTrue(router.messagesToCache(REMOTE, PEER, nonce));
            assertFalse(router.messagesToCache(REMOTE, PEER, nonce ^ 1));
            assertFalse(router.messagesToCache(REMOTE + 1, PEER, nonce));
            assertFalse(router.messagesToCache(REMOTE, bytes.concat(PEER, hex"01"), nonce));
        }
        for (uint256 i; i < nonces.length; ++i) {
            assertTrue(router.messagesToCache(REMOTE, PEER, nonces[i]));
        }
    }

    function test_markMessageForCaching_Fuzz_IsolatesChannelAndNonce(
        uint64 _zone,
        bytes memory _app,
        uint64 _nonce
    ) public {
        router.markMessageForCaching(_zone, _app, _nonce);
        assertTrue(router.messagesToCache(_zone, _app, _nonce));
        assertFalse(router.messagesToCache(_zone ^ 1, _app, _nonce));
        assertFalse(router.messagesToCache(_zone, bytes.concat(_app, hex"01"), _nonce));
        assertFalse(router.messagesToCache(_zone, _app, _nonce ^ 1));
    }

    function test_markMessageForCaching_Revert_NotOwner() public {
        vm.prank(RECIPIENT);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, RECIPIENT));
        router.markMessageForCaching(REMOTE, PEER, 0);
        assertFalse(router.messagesToCache(REMOTE, PEER, 0));
    }

    function test_markMessageForCaching_UnconfiguredOrRemovedZonePeer() public {
        bytes memory otherPeer = abi.encodePacked(bytes32(uint256(1)));
        router.markMessageForCaching(REMOTE, otherPeer, 0);
        router.setZonePeer(REMOTE, hex"");
        router.markMessageForCaching(REMOTE, PEER, 0);
        router.markMessageForCaching(REMOTE, hex"", 0);
        assertTrue(router.messagesToCache(REMOTE, otherPeer, 0));
        assertTrue(router.messagesToCache(REMOTE, PEER, 0));
        assertTrue(router.messagesToCache(REMOTE, hex"", 0));
    }

    function test_renounceOwnership_Revert() public {
        vm.expectRevert(IZoneRouter.CannotRenounceOwnership.selector);
        router.renounceOwnership();
        assertEq(router.owner(), address(this));
    }

    function test_transferOwnership_TwoSteps() public {
        router.transferOwnership(RECIPIENT);
        assertEq(router.owner(), address(this));
        assertEq(router.pendingOwner(), RECIPIENT);
        vm.prank(RECIPIENT);
        router.acceptOwnership();
        assertEq(router.owner(), RECIPIENT);
    }

    function captureRetry(address _target, IAirlock.Message calldata _message) public {
        (retryCallbackSuccess, retryCallbackResult) = _target.call(
            abi.encodeCall(ZoneRouter.retryMessage, (REMOTE, PEER, uint64(0), _message))
        );
    }

    function captureRescue(address _target, IAirlock.Message calldata _message) public {
        (retryCallbackSuccess, retryCallbackResult) = _target.call(
            abi.encodeCall(ZoneRouter.rescueMessage, (REMOTE, PEER, uint64(0), _message, RECIPIENT))
        );
    }

    function _receiveFailed(IAirlock.Message memory _message) internal {
        IAirlock.Message[] memory messages = new IAirlock.Message[](1);
        messages[0] = _message;
        airlock.setMessages(address(router), REMOTE, PEER, numbered(messages, 0));
        vm.expectEmit(true, true, true, true, address(router));
        emit IZoneRouter.MessageCached(REMOTE, PEER, 0, _message);
        router.airlockReceive(REMOTE, PEER, 0, 1);
        _assertReceived(0, 1);
        assertEq(router.cachedMessages(REMOTE, PEER, 0), keccak256(abi.encode(_message)));
    }

    function _failedTransfer()
        internal
        returns (MockAdversarialRouterToken adversary, ZoneRouter target, IAirlock.Message memory message)
    {
        adversary = new MockAdversarialRouterToken();
        target = _createRouter(address(adversary));
        target.setZonePeer(REMOTE, PEER);
        adversary.setOperator(address(target));
        adversary.mint(address(target), 100);
        IAirlock.Message memory transfer = _incoming(10, _address(RECIPIENT));
        transfer.dstApp = _address(address(target));
        message = transfer;
        IAirlock.Message[] memory messages = new IAirlock.Message[](1);
        messages[0] = message;
        airlock.setMessages(address(target), REMOTE, PEER, numbered(messages, 0));
        adversary.configure(
            MockAdversarialRouterToken.Effect.Revert,
            MockAdversarialRouterToken.Effect.Revert,
            MockAdversarialRouterToken.Effect.Normal
        );
        target.airlockReceive(REMOTE, PEER, 0, 1);
        assertEq(target.cachedMessages(REMOTE, PEER, 0), keccak256(abi.encode(message)));
        assertEq(target.cachedMessagesCount(REMOTE, PEER), 1);
    }

    function _createRouter(address _token) internal virtual returns (ZoneRouter target) {
        return
            ZoneRouter(
                factory.deploy(
                    address(this),
                    IZoneRouter.Config(_token, IZoneRouter.Mode.LockUnlock, 18, address(0), bytes4(0), bytes4(0)),
                    bytes32(uint256(++routerSalt))
                )
            );
    }

    function _tampered(IAirlock.Message memory _message) internal pure returns (IAirlock.Message memory changed) {
        changed = abi.decode(abi.encode(_message), (IAirlock.Message));
        changed.amount18d ^= 1;
    }

    function _group() internal pure virtual returns (string memory name) {
        return "ZoneRouter";
    }

    function _address(address _value) internal pure returns (bytes memory encoded) {
        return abi.encodePacked(_value);
    }

    function _incoming(
        uint256 _amount,
        bytes memory _recipient
    ) internal view returns (IAirlock.Message memory transfer) {
        transfer = IAirlock.Message(
            REMOTE,
            PEER,
            LOCAL,
            _address(address(router)),
            0,
            _amount,
            hex"7b",
            _recipient,
            hex"0304"
        );
    }

    /// @dev A copy of `_message` at `_nonce`: the same transfer delivered at another position.
    function _at(IAirlock.Message memory _message, uint64 _nonce) internal pure returns (IAirlock.Message memory copy) {
        copy = abi.decode(abi.encode(_message), (IAirlock.Message));
        copy.nonce = _nonce;
    }

    function _queue(IAirlock.Message memory _transfer) internal {
        IAirlock.Message[] memory messages = new IAirlock.Message[](1);
        messages[0] = _transfer;
        airlock.setMessages(address(router), REMOTE, PEER, numbered(messages, 0));
    }

    function _assertSent(uint256 _amount, bytes memory _recipient, bytes memory _memo) internal view {
        IAirlock.Message memory transfer = airlock.message();
        assertEq(transfer.srcZone, 1);
        assertEq(transfer.srcApp, _address(address(router)));
        assertEq(transfer.dstZone, REMOTE);
        assertEq(transfer.dstApp, PEER);
        assertEq(transfer.amount18d, _amount);
        assertEq(transfer.sender, _address(address(this)));
        assertEq(transfer.recipient, _recipient);
        assertEq(transfer.memo, _memo);
        assertEq(airlock.dstApp(), PEER);
        assertEq(airlock.sender(), address(router));
        assertEq(token.balanceOf(address(this)), INITIAL - _amount);
        assertEq(token.balanceOf(address(router)), INITIAL + _amount);
        assertEq(token.totalSupply(), INITIAL * 2);
    }

    function _assertReceived(uint256 _amount, uint64 _cursor) internal view {
        assertEq(token.balanceOf(RECIPIENT), _amount);
        assertEq(token.balanceOf(address(router)), INITIAL - _amount);
        assertEq(token.totalSupply(), INITIAL * 2);
        assertEq(airlock.cursor(address(router), REMOTE, PEER), _cursor);
    }

    function _assertUntouched() internal view {
        assertEq(token.balanceOf(RECIPIENT), 0);
        assertEq(token.balanceOf(address(router)), INITIAL);
        assertEq(token.totalSupply(), INITIAL * 2);
        assertEq(airlock.cursor(address(router), REMOTE, PEER), 0);
    }
}
