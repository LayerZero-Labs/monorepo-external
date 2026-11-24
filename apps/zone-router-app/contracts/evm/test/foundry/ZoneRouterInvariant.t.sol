// SPDX-License-Identifier: MIT
pragma solidity ^0.8.22;

import { StdInvariant } from "forge-std/StdInvariant.sol";
import { Test } from "forge-std/Test.sol";
import { IAirlock, AIRLOCK_ADDRESS } from "../../contracts/interfaces/IAirlock.sol";
import { IZoneRouter } from "../../contracts/interfaces/IZoneRouter.sol";
import { ZoneRouter } from "../../contracts/ZoneRouter.sol";
import { ZoneRouterFactory } from "../../contracts/ZoneRouterFactory.sol";
import { MockAdversarialRouterToken } from "./mocks/MockAdversarialRouterToken.sol";
import { MockGenericAirlock, numbered } from "./mocks/MockGenericAirlock.sol";

contract ZoneRouterHandler is Test {
    struct CachedTransfer {
        uint64 nonce;
        uint256 amount;
        IAirlock.Message message;
        bool pending;
    }

    CachedTransfer[] internal claims;
    MockAdversarialRouterToken public immutable token;
    ZoneRouter public immutable router;
    MockGenericAirlock public immutable airlock;
    uint256 public sent;
    uint256 public received;
    uint256 public accepted;
    uint256 public cached;
    uint64 public cursor;
    bytes internal PEER = abi.encodePacked(keccak256("invariant full-width zonePeer"));
    uint256 internal constant INITIAL = 1_000_000 ether;

    constructor() {
        token = new MockAdversarialRouterToken();
        vm.mockCall(address(token), abi.encodeWithSignature("decimals()"), abi.encode(uint8(16)));
        router = ZoneRouter(
            new ZoneRouterFactory(address(new ZoneRouter())).deploy(
                address(this),
                IZoneRouter.Config(address(token), IZoneRouter.Mode.LockUnlock, 16, address(0), bytes4(0), bytes4(0)),
                bytes32(0)
            )
        );
        airlock = MockGenericAirlock(AIRLOCK_ADDRESS);
        router.setZonePeer(2, PEER);
        token.setOperator(address(router));
        token.mint(address(this), INITIAL);
        token.mint(address(router), INITIAL);
        token.approve(address(router), type(uint256).max);
    }

    function sendToken(uint96 _amount, bool _fail) public {
        uint256 balance = token.balanceOf(address(this));
        if (balance == 0) return;
        uint256 amount = bound(_amount, 1, balance);
        airlock.setFail(_fail);
        if (_fail) {
            vm.expectRevert(MockGenericAirlock.Rejected.selector);
            router.sendToken(2, abi.encodePacked(bytes32(uint256(1))), amount, hex"");
        } else {
            router.sendToken(2, abi.encodePacked(bytes32(uint256(1))), amount, hex"");
            sent += amount;
        }
        airlock.setFail(false);
    }

    function receiveTransfer(uint96 _amount, bool _fail, bool _skip, bool _cache, bool _malformed) public {
        uint256 limit = token.balanceOf(address(router));
        if (limit == 0) return;
        uint256 amount = bound(_amount, 1, limit);
        IAirlock.Message memory transfer = IAirlock.Message(
            2,
            PEER,
            1,
            abi.encodePacked(address(router)),
            0,
            amount * 100 + (uint256(_amount) % 100),
            hex"01",
            _malformed ? bytes(hex"01") : abi.encodePacked(address(this)),
            hex""
        );
        IAirlock.Message[] memory messages = new IAirlock.Message[](1);
        messages[0] = transfer;

        airlock.appendMessages(address(router), 2, PEER, numbered(messages, airlock.queued(address(router), 2, PEER)));
        if (_fail) {
            airlock.setAuthenticationFailure(true);
            uint256 balance = token.balanceOf(address(this));
            uint256 supply = token.totalSupply();
            vm.expectRevert(MockGenericAirlock.InvalidProof.selector);
            router.airlockReceive(2, PEER, cursor, 1);
            assertEq(token.balanceOf(address(this)), balance);
            assertEq(token.totalSupply(), supply);
            assertEq(airlock.cursor(address(router), 2, PEER), cursor);
            airlock.setAuthenticationFailure(false);
        }
        if (_skip) router.markMessageForCaching(2, PEER, cursor);
        if (_cache) {
            token.configure(
                MockAdversarialRouterToken.Effect.Revert,
                MockAdversarialRouterToken.Effect.Revert,
                MockAdversarialRouterToken.Effect.Normal
            );
        }
        router.airlockReceive(2, PEER, cursor, 1);
        token.configure(
            MockAdversarialRouterToken.Effect.Normal,
            MockAdversarialRouterToken.Effect.Normal,
            MockAdversarialRouterToken.Effect.Normal
        );
        accepted += amount;
        if (_cache || _skip || _malformed) {
            cached += amount;
            claims.push(CachedTransfer(cursor, amount, messages[0], true));
            assertEq(router.cachedMessages(2, PEER, cursor), keccak256(abi.encode(messages[0])));
        } else {
            received += amount;
        }
        ++cursor;
    }

    function retry(uint256 _index, bool _fail) public {
        if (claims.length == 0) return;
        CachedTransfer storage claim = claims[bound(_index, 0, claims.length - 1)];
        if (!claim.pending || token.balanceOf(address(router)) < claim.amount) return;
        if (_fail) {
            token.configure(
                MockAdversarialRouterToken.Effect.Revert,
                MockAdversarialRouterToken.Effect.Revert,
                MockAdversarialRouterToken.Effect.Normal
            );
            vm.expectRevert(MockAdversarialRouterToken.Rejected.selector);
            _settle(claim);
            token.configure(
                MockAdversarialRouterToken.Effect.Normal,
                MockAdversarialRouterToken.Effect.Normal,
                MockAdversarialRouterToken.Effect.Normal
            );
        } else {
            _settle(claim);
            claim.pending = false;
            cached -= claim.amount;
            received += claim.amount;
        }
    }

    function _settle(CachedTransfer storage _claim) internal {
        if (_claim.message.recipient.length == 20) {
            router.retryMessage(2, PEER, _claim.nonce, _claim.message);
        } else {
            router.rescueMessage(2, PEER, _claim.nonce, _claim.message, address(this));
        }
    }

    function assertConservation() public view {
        uint256 pending;
        uint256 pendingCount;
        for (uint256 i; i < claims.length; ++i) {
            CachedTransfer storage claim = claims[i];
            if (claim.pending) {
                pending += claim.amount;
                ++pendingCount;
            }
            assertEq(
                router.cachedMessages(2, PEER, claim.nonce),
                claim.pending ? keccak256(abi.encode(claim.message)) : bytes32(0)
            );
        }
        assertEq(router.cachedMessagesCount(2, PEER), pendingCount);
        assertEq(cached, pending);
        assertEq(accepted, received + cached);
        assertEq(token.balanceOf(address(this)) + sent, INITIAL + received);
        assertEq(airlock.cursor(address(router), 2, PEER), cursor);
        assertEq(token.balanceOf(address(router)) + received, INITIAL + sent);
        assertEq(token.totalSupply(), INITIAL * 2);
    }
}

contract ZoneRouterInvariantTest is StdInvariant, Test {
    ZoneRouterHandler internal lockUnlock;

    function setUp() public {
        MockGenericAirlock implementation = new MockGenericAirlock();
        vm.etch(address(0x0a1a), address(implementation).code);
        lockUnlock = new ZoneRouterHandler();
        bytes4[] memory selectors = new bytes4[](3);
        selectors[0] = ZoneRouterHandler.sendToken.selector;
        selectors[1] = ZoneRouterHandler.receiveTransfer.selector;
        selectors[2] = ZoneRouterHandler.retry.selector;
        targetContract(address(lockUnlock));
        targetSelector(FuzzSelector(address(lockUnlock), selectors));
    }

    function invariant_conservesEveryCreditedToken() public view {
        lockUnlock.assertConservation();
    }
}
