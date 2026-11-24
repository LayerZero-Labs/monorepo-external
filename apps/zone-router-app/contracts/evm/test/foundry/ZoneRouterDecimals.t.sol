// SPDX-License-Identifier: MIT
pragma solidity ^0.8.22;

import { ERC20 } from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import { Test } from "forge-std/Test.sol";
import { IAirlock } from "../../contracts/interfaces/IAirlock.sol";
import { IZoneRouter } from "../../contracts/interfaces/IZoneRouter.sol";
import { ZoneRouter } from "../../contracts/ZoneRouter.sol";
import { ZoneRouterFactory } from "../../contracts/ZoneRouterFactory.sol";
import { MockGenericAirlock, numbered } from "./mocks/MockGenericAirlock.sol";

contract RouterToken is ERC20 {
    uint8 internal tokenDecimals;

    constructor() ERC20("Token", "TKN") {}

    function mint(address _to, uint256 _amount) external {
        _mint(_to, _amount);
    }

    function burn(address _from, uint256 _amount) external {
        _burn(_from, _amount);
    }

    function burn(uint256 _amount) external {
        _burn(msg.sender, _amount);
    }

    function setDecimals(uint8 _decimals) external {
        tokenDecimals = _decimals;
    }

    function decimals() public view override returns (uint8) {
        return tokenDecimals;
    }
}

contract ZoneRouterDecimalsTest is Test {
    struct Amounts {
        uint256 wire;
        uint256 received;
    }

    ZoneRouterFactory internal factory;
    MockGenericAirlock internal airlock;
    address internal constant RECIPIENT = address(0xbeef);

    function setUp() public {
        factory = new ZoneRouterFactory(address(new ZoneRouter()));
        vm.etch(address(0x0a1a), address(new MockGenericAirlock()).code);
        airlock = MockGenericAirlock(address(0x0a1a));
    }

    function test_sendToken_Fuzz_DifferentDecimals(
        uint128 _amountLD,
        uint8 _srcDecimals,
        uint8 _dstDecimals,
        uint8 _mode
    ) public {
        uint256 amountLD = bound(_amountLD, 1, type(uint128).max);
        uint8 srcDecimals = uint8(bound(_srcDecimals, 0, 18));
        uint8 dstDecimals = uint8(bound(_dstDecimals, 0, 18));
        IZoneRouter.Mode mode = IZoneRouter.Mode(bound(_mode, 0, 2));
        _roundTrip(amountLD, srcDecimals, dstDecimals, mode);
    }

    function test_sendToken_ScalesUpTo18Decimals() public {
        for (uint256 i; i < 3; ++i) {
            Amounts memory amounts = _roundTrip(1_500_000, 6, 6, IZoneRouter.Mode(i));
            assertEq(amounts.wire, 1.5e18);
            assertEq(amounts.received, 1_500_000);
        }
    }

    function test_airlockReceive_DropsDustBelowOneLocalUnit() public {
        for (uint256 i; i < 3; ++i) {
            Amounts memory amounts = _roundTrip(1_234_567_800_000_000_000, 18, 6, IZoneRouter.Mode(i));
            assertEq(amounts.wire, 1_234_567_800_000_000_000);
            assertEq(amounts.received, 1_234_567);
        }
    }

    function test_sendToken_ZeroAndMaximumDecimals() public {
        for (uint256 i; i < 3; ++i) {
            assertEq(_roundTrip(1, 0, 18, IZoneRouter.Mode(i)).wire, 1e18);
            assertEq(_roundTrip(1, 18, 0, IZoneRouter.Mode(i)).received, 0);
        }
    }

    function test_sendToken_Revert_ScaledAmountOverflow() public {
        RouterToken token = new RouterToken();
        ZoneRouter router = _deploy(token, IZoneRouter.Mode.LockUnlock, 0);
        router.setZonePeer(1, hex"01");
        uint256 amountLD = type(uint256).max / 1e18 + 1;
        token.mint(address(this), amountLD);
        token.approve(address(router), amountLD);
        vm.expectRevert(abi.encodeWithSignature("Panic(uint256)", 0x11));
        router.sendToken(1, abi.encodePacked(RECIPIENT), amountLD, hex"");
        assertEq(token.balanceOf(address(this)), amountLD);
        assertEq(token.balanceOf(address(router)), 0);
    }

    function test_initialize_Fuzz_Revert_InvalidLocalDecimals(uint8 _localDecimals) public {
        uint8 localDecimals = uint8(bound(_localDecimals, 19, 255));
        RouterToken token = new RouterToken();
        vm.expectRevert(abi.encodeWithSelector(IZoneRouter.InvalidLocalDecimals.selector, localDecimals));
        factory.deploy(address(this), _config(token, IZoneRouter.Mode.LockUnlock, localDecimals), bytes32(0));
    }

    function test_initialize_Revert_LocalDecimalsMismatch() public {
        RouterToken token = new RouterToken();
        token.setDecimals(6);
        vm.expectRevert(abi.encodeWithSelector(IZoneRouter.LocalDecimalsMismatch.selector, uint8(18), uint8(6)));
        factory.deploy(address(this), _config(token, IZoneRouter.Mode.LockUnlock, 18), bytes32(0));
    }

    function test_initialize_Revert_TokenWithoutDecimals() public {
        IZoneRouter.Config memory configuration = _config(
            RouterToken(address(factory)),
            IZoneRouter.Mode.LockUnlock,
            18
        );
        configuration.burnerMinter = address(0);
        vm.expectRevert();
        factory.deploy(address(this), configuration, bytes32(0));
    }

    function test_initialize_Revert_ValidationOrder() public {
        RouterToken token = new RouterToken();
        IZoneRouter.Config memory configuration = _config(token, IZoneRouter.Mode.BurnMint, 19);
        configuration.token = address(0);
        configuration.burnerMinter = address(0);
        vm.expectRevert(IZoneRouter.InvalidToken.selector);
        factory.deploy(address(this), configuration, bytes32(0));
        configuration.token = address(token);
        vm.expectRevert(IZoneRouter.InvalidBurnerMinter.selector);
        factory.deploy(address(this), configuration, bytes32(0));
        configuration.burnerMinter = address(token);
        vm.expectRevert(abi.encodeWithSelector(IZoneRouter.InvalidLocalDecimals.selector, uint8(19)));
        factory.deploy(address(this), configuration, bytes32(0));
    }

    function test_airlockReceive_RetryConvertsAmount() public {
        RouterToken source = new RouterToken();
        RouterToken destination = new RouterToken();
        ZoneRouter sender = _deploy(source, IZoneRouter.Mode.LockUnlock, 16);
        ZoneRouter receiver = _deploy(destination, IZoneRouter.Mode.LockUnlock, 14);
        bytes memory peer = abi.encodePacked(address(sender));
        sender.setZonePeer(1, abi.encodePacked(address(receiver)));
        receiver.setZonePeer(1, peer);
        source.mint(address(this), 101);
        source.approve(address(sender), 101);
        sender.sendToken(1, abi.encodePacked(RECIPIENT), 101, hex"");
        IAirlock.Message[] memory messages = new IAirlock.Message[](1);
        messages[0] = airlock.message();
        assertEq(messages[0].amount18d, 10_100);
        airlock.setMessages(address(receiver), 1, peer, numbered(messages, 0));
        receiver.airlockReceive(1, peer, 0, 1);
        assertEq(receiver.cachedMessages(1, peer, 0), keccak256(abi.encode(messages[0])));
        destination.mint(address(receiver), 1);
        vm.prank(RECIPIENT);
        receiver.retryMessage(1, peer, 0, messages[0]);
        assertEq(destination.balanceOf(RECIPIENT), 1);
        assertEq(source.balanceOf(address(this)), 0);
        assertEq(receiver.cachedMessages(1, peer, 0), bytes32(0));
        vm.expectRevert(IZoneRouter.InvalidCachedMessage.selector);
        receiver.retryMessage(1, peer, 0, messages[0]);
    }

    function test_rescueMessage_Fuzz_ModesAndDecimals(uint96 _amount18d, uint8 _mode, uint8 _localDecimals) public {
        uint256 amount18d = _amount18d;
        uint8 localDecimals = uint8(bound(_localDecimals, 0, 18));
        IZoneRouter.Mode mode = IZoneRouter.Mode(bound(_mode, 0, 2));
        RouterToken asset = new RouterToken();
        ZoneRouter receiver = _deploy(asset, mode, localDecimals);
        uint256 amountLD = amount18d / 10 ** uint256(18 - localDecimals);
        if (mode == IZoneRouter.Mode.LockUnlock) asset.mint(address(receiver), amountLD);
        bytes memory peer = hex"01";
        receiver.setZonePeer(1, peer);
        IAirlock.Message[] memory messages = new IAirlock.Message[](1);
        messages[0] = IAirlock.Message(
            1,
            peer,
            2,
            abi.encodePacked(address(receiver)),
            0,
            amount18d,
            peer,
            hex"01",
            hex""
        );
        airlock.setMessages(address(receiver), 1, peer, numbered(messages, 0));
        receiver.airlockReceive(1, peer, 0, 1);
        vm.expectEmit(true, true, true, true, address(receiver));
        emit IZoneRouter.MessageRescued(1, peer, 0, RECIPIENT, amountLD);
        receiver.rescueMessage(1, peer, 0, messages[0], RECIPIENT);
        assertEq(asset.balanceOf(RECIPIENT), amountLD);
        assertEq(asset.balanceOf(address(receiver)), 0);
        assertEq(asset.totalSupply(), amountLD);
        assertEq(receiver.cachedMessagesCount(1, peer), 0);
        assertEq(receiver.cachedMessages(1, peer, 0), bytes32(0));
    }

    function _roundTrip(
        uint256 _amountLD,
        uint8 _srcDecimals,
        uint8 _dstDecimals,
        IZoneRouter.Mode _mode
    ) internal returns (Amounts memory amounts) {
        RouterToken source = new RouterToken();
        RouterToken destination = new RouterToken();
        ZoneRouter sender = _deploy(source, _mode, _srcDecimals);
        ZoneRouter receiver = _deploy(destination, _mode, _dstDecimals);
        bytes memory peer = abi.encodePacked(address(sender));
        sender.setZonePeer(1, abi.encodePacked(address(receiver)));
        receiver.setZonePeer(1, peer);
        amounts.wire = _amountLD * 10 ** uint256(18 - _srcDecimals);
        amounts.received = amounts.wire / 10 ** uint256(18 - _dstDecimals);
        source.mint(address(this), _amountLD);
        source.approve(address(sender), _amountLD);
        if (_mode == IZoneRouter.Mode.LockUnlock) destination.mint(address(receiver), amounts.received);
        vm.expectEmit(true, true, true, true, address(sender));
        emit IZoneRouter.Sent(
            1,
            abi.encodePacked(address(receiver)),
            0,
            address(this),
            abi.encodePacked(RECIPIENT),
            _amountLD
        );
        sender.sendToken(1, abi.encodePacked(RECIPIENT), _amountLD, hex"");
        assertEq(source.balanceOf(address(this)), 0);
        assertEq(source.balanceOf(address(sender)), _mode == IZoneRouter.Mode.LockUnlock ? _amountLD : 0);
        assertEq(source.totalSupply(), _mode == IZoneRouter.Mode.LockUnlock ? _amountLD : 0);
        IAirlock.Message[] memory messages = new IAirlock.Message[](1);
        messages[0] = airlock.message();
        assertEq(messages[0].amount18d, amounts.wire);
        airlock.setMessages(address(receiver), 1, peer, numbered(messages, 0));
        vm.expectEmit(true, true, true, true, address(receiver));
        emit IZoneRouter.Received(1, peer, 0, RECIPIENT, amounts.received);
        receiver.airlockReceive(1, peer, 0, 1);
        assertEq(destination.balanceOf(RECIPIENT), amounts.received);
        assertEq(destination.totalSupply(), amounts.received);
        assertEq(destination.balanceOf(address(receiver)), 0);
        assertEq(receiver.cachedMessages(1, peer, 0), bytes32(0));
    }

    function _deploy(
        RouterToken _token,
        IZoneRouter.Mode _mode,
        uint8 _localDecimals
    ) internal returns (ZoneRouter router) {
        _token.setDecimals(_localDecimals);
        router = ZoneRouter(factory.deploy(address(this), _config(_token, _mode, _localDecimals), bytes32(0)));
    }

    function _config(
        RouterToken _token,
        IZoneRouter.Mode _mode,
        uint8 _localDecimals
    ) internal pure returns (IZoneRouter.Config memory configuration) {
        return
            IZoneRouter.Config(
                address(_token),
                _mode,
                _localDecimals,
                address(_token),
                _mode == IZoneRouter.Mode.BurnMint
                    ? bytes4(keccak256("burn(address,uint256)"))
                    : bytes4(keccak256("burn(uint256)")),
                bytes4(keccak256("mint(address,uint256)"))
            );
    }
}
