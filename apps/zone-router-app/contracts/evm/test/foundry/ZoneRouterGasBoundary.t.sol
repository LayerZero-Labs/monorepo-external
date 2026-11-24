// SPDX-License-Identifier: MIT
pragma solidity ^0.8.22;

import { MockERC20 } from "@layerzerolabs/test-utils-evm-contracts/contracts/mocks/MockERC20.sol";
import { Test } from "forge-std/Test.sol";
import { IAirlock, AIRLOCK_ADDRESS } from "../../contracts/interfaces/IAirlock.sol";
import { IZoneRouter } from "../../contracts/interfaces/IZoneRouter.sol";
import { ZoneRouter } from "../../contracts/ZoneRouter.sol";
import { ZoneRouterFactory } from "../../contracts/ZoneRouterFactory.sol";
import { MockGenericAirlock, numbered } from "./mocks/MockGenericAirlock.sol";

contract GasExhaustingZoneRouter is ZoneRouter {
    function _credit(address, uint256) internal pure override {
        assembly ("memory-safe") {
            invalid()
        }
    }
}

contract ZoneRouterGasBoundaryTest is Test {
    uint64 internal constant LOCAL = 7;
    uint64 internal constant REMOTE = 99;
    bytes internal PEER = abi.encodePacked(keccak256("full-width remote application"));
    uint256 internal constant INITIAL = 1_000 ether;

    MockERC20 internal token;
    GasExhaustingZoneRouter internal router;
    MockGenericAirlock internal airlock;
    IAirlock.Message internal message;

    function setUp() public {
        token = new MockERC20(18);
        router = GasExhaustingZoneRouter(
            new ZoneRouterFactory(address(new GasExhaustingZoneRouter())).deploy(
                address(this),
                IZoneRouter.Config(address(token), IZoneRouter.Mode.LockUnlock, 18, address(0), bytes4(0), bytes4(0)),
                bytes32(0)
            )
        );
        MockGenericAirlock implementation = new MockGenericAirlock();
        vm.etch(AIRLOCK_ADDRESS, address(implementation).code);
        airlock = MockGenericAirlock(AIRLOCK_ADDRESS);
        router.setZonePeer(REMOTE, PEER);
        token.mint(address(router), INITIAL);
        message = IAirlock.Message({
            srcZone: REMOTE,
            srcApp: PEER,
            dstZone: LOCAL,
            dstApp: abi.encodePacked(address(router)),
            nonce: 0,
            amount18d: 1,
            sender: hex"01",
            recipient: abi.encodePacked(address(0xbeef)),
            memo: hex""
        });
    }

    function test_airlockReceive_MarkedDoesNotExecuteGasExhaustingFrame() public {
        _queue(64);
        for (uint64 i; i < 64; ++i) {
            router.markMessageForCaching(REMOTE, PEER, i);
        }
        vm.expectCall(address(router), abi.encodeWithSelector(router.receiveMessage.selector), uint64(0));
        router.airlockReceive{ gas: 8_000_000 }(REMOTE, PEER, 0, 64);
        _assertCached(64);
    }

    function test_airlockReceive_FullFrameOOGRollsBackUntilMarked() public {
        _queue(1);
        (bool success, ) = address(router).call{ gas: 250_000 }(
            abi.encodeCall(router.airlockReceive, (REMOTE, PEER, uint64(0), uint64(1)))
        );
        assertFalse(success);
        assertEq(airlock.cursor(address(router), REMOTE, PEER), 0);
        assertEq(router.cachedMessages(REMOTE, PEER, 0), bytes32(0));
        assertFalse(router.messagesToCache(REMOTE, PEER, 0));
        router.markMessageForCaching(REMOTE, PEER, 0);
        router.airlockReceive{ gas: 250_000 }(REMOTE, PEER, 0, 1);
        _assertCached(1);
    }

    function _queue(uint64 _count) internal {
        IAirlock.Message[] memory messages = new IAirlock.Message[](_count);
        for (uint256 i; i < _count; ++i) {
            messages[i] = message;
        }
        airlock.setMessages(address(router), REMOTE, PEER, numbered(messages, 0));
    }

    function _assertCached(uint64 _count) internal view {
        assertEq(airlock.cursor(address(router), REMOTE, PEER), _count);
        for (uint64 i; i < _count; ++i) {
            IAirlock.Message memory expected = message;
            expected.nonce = i;
            assertEq(router.cachedMessages(REMOTE, PEER, i), keccak256(abi.encode(expected)));
        }
        assertEq(token.balanceOf(address(router)), INITIAL);
        assertEq(token.balanceOf(address(0xbeef)), 0);
    }
}
