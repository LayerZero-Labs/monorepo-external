// SPDX-License-Identifier: MIT
pragma solidity ^0.8.22;

import { MockERC20 } from "@layerzerolabs/test-utils-evm-contracts/contracts/mocks/MockERC20.sol";
import { Address } from "@openzeppelin/contracts/utils/Address.sol";
import { Test } from "forge-std/Test.sol";
import { IAirlock } from "../../contracts/interfaces/IAirlock.sol";
import { IZoneRouter } from "../../contracts/interfaces/IZoneRouter.sol";
import { ZoneRouter } from "../../contracts/ZoneRouter.sol";
import { ZoneRouterFactory } from "../../contracts/ZoneRouterFactory.sol";
import { MockAdversarialRouterToken } from "./mocks/MockAdversarialRouterToken.sol";
import { MockGenericAirlock, numbered } from "./mocks/MockGenericAirlock.sol";

contract RouterSettlementToken is MockERC20 {
    constructor() MockERC20(18) {}

    function burn(uint256 _amount) external {
        _burn(msg.sender, _amount);
    }
}

contract RouterSettlementBackend {
    MockERC20 public immutable token;

    constructor(MockERC20 _token) {
        token = _token;
    }

    function redeem(address _from, uint256 _amount) external {
        token.burn(_from, _amount);
    }

    function redeem(uint256 _amount) external {
        token.burn(msg.sender, _amount);
    }

    function issue(address _to, uint256 _amount) external {
        token.mint(_to, _amount);
    }
}

contract ZoneRouterModesTest is Test {
    RouterSettlementToken internal token;
    ZoneRouterFactory internal factory;
    MockGenericAirlock internal airlock;
    address internal constant RECIPIENT = address(0xbeef);

    function setUp() public {
        token = new RouterSettlementToken();
        factory = new ZoneRouterFactory(address(new ZoneRouter()));
        vm.etch(address(0x0a1a), address(new MockGenericAirlock()).code);
        airlock = MockGenericAirlock(address(0x0a1a));
    }

    function test_initialize_ExplicitConfiguration() public {
        for (uint256 i; i < 3; ++i) {
            IZoneRouter.Config memory configuration = IZoneRouter.Config(
                address(token),
                IZoneRouter.Mode(i),
                18,
                address(token),
                bytes4(0),
                bytes4(0)
            );
            ZoneRouter router = ZoneRouter(factory.deploy(address(this), configuration, bytes32(0)));
            assertEq(abi.encode(router.config()), abi.encode(configuration));
        }
    }

    function test_initialize_ConfigStorage() public {
        IZoneRouter.Config memory configuration = IZoneRouter.Config(
            address(token),
            IZoneRouter.Mode.BurnSelfMint,
            18,
            address(0x1234),
            hex"11223344",
            hex"55667788"
        );
        ZoneRouter router = ZoneRouter(factory.deploy(address(this), configuration, bytes32(0)));
        bytes32 slot = 0x0456790dfd3b2585c24c79cad9a90da0a48da35ababc338f6e24b28613616300;
        assertEq(
            vm.load(address(router), slot),
            bytes32(
                uint256(uint160(address(token))) |
                    (uint256(IZoneRouter.Mode.BurnSelfMint) << 160) |
                    (uint256(18) << 168)
            )
        );
        assertEq(
            vm.load(address(router), bytes32(uint256(slot) + 1)),
            bytes32(uint256(0x1234) | (uint256(0x11223344) << 160) | (uint256(0x55667788) << 192))
        );
        assertEq(router.config().token, address(token));
        assertEq(abi.encode(router.config()), abi.encode(configuration));
    }

    function test_initialize_Revert_ZeroBurnerMinter() public {
        for (uint256 i = 1; i < 3; ++i) {
            vm.expectRevert(IZoneRouter.InvalidBurnerMinter.selector);
            factory.deploy(
                address(this),
                IZoneRouter.Config(address(token), IZoneRouter.Mode(i), 18, address(0), bytes4(0), bytes4(0)),
                bytes32(0)
            );
        }
    }

    function test_sendToken_Fuzz_AirlockFailureRollsBack(uint96 _amount, bool _self) public {
        uint256 amount = bound(uint256(_amount), 1, type(uint96).max);
        ZoneRouter router = _deploy(
            address(token),
            _self ? IZoneRouter.Mode.BurnSelfMint : IZoneRouter.Mode.BurnMint,
            address(0),
            bytes4(0),
            bytes4(0)
        );
        router.setZonePeer(2, abi.encodePacked(bytes32(uint256(1))));
        token.mint(address(this), amount);
        token.approve(address(router), amount);
        airlock.setFail(true);
        vm.expectRevert(MockGenericAirlock.Rejected.selector);
        router.sendToken(2, abi.encodePacked(bytes32(uint256(1))), amount, hex"");
        assertEq(token.totalSupply(), amount);
        assertEq(token.balanceOf(address(this)), amount);
        assertEq(token.balanceOf(address(router)), 0);
        assertEq(token.allowance(address(this), address(router)), amount);
    }

    function test_sendToken_BurnMint_Gas() public {
        _roundTrip(IZoneRouter.Mode.BurnMint, false, "BurnMint");
    }

    function test_sendToken_BurnSelfMint_Gas() public {
        _roundTrip(IZoneRouter.Mode.BurnSelfMint, false, "BurnSelfMint");
    }

    function test_sendToken_CustomBurnMintBackend() public {
        _roundTrip(IZoneRouter.Mode.BurnMint, true, "");
    }

    function test_sendToken_CustomBurnSelfMintBackend() public {
        _roundTrip(IZoneRouter.Mode.BurnSelfMint, true, "");
    }

    function test_sendToken_AllowanceBasedBurn() public {
        ZoneRouter router = _deploy(
            address(token),
            IZoneRouter.Mode.BurnMint,
            address(0),
            MockERC20.burnFrom.selector,
            bytes4(0)
        );
        router.setZonePeer(2, abi.encodePacked(bytes32(uint256(1))));
        token.mint(address(this), 10);
        token.approve(address(router), 10);
        router.sendToken(2, abi.encodePacked(RECIPIENT), 10, hex"");
        assertEq(token.totalSupply(), 0);
        assertEq(token.allowance(address(this), address(router)), 0);
    }

    function test_sendToken_Revert_BackendHasNoCode() public {
        ZoneRouter router = _deploy(address(token), IZoneRouter.Mode.BurnMint, RECIPIENT, bytes4(0), bytes4(0));
        router.setZonePeer(2, abi.encodePacked(bytes32(uint256(1))));
        vm.expectRevert(abi.encodeWithSelector(Address.AddressEmptyCode.selector, RECIPIENT));
        router.sendToken(2, abi.encodePacked(bytes32(uint256(1))), 10, hex"");
    }

    function test_airlockReceive_MintFailureAndRetry() public {
        MockAdversarialRouterToken asset = new MockAdversarialRouterToken();
        ZoneRouter router = _deploy(address(asset), IZoneRouter.Mode.BurnMint, address(0), bytes4(0), bytes4(0));
        asset.setOperator(address(router));
        bytes memory peer = abi.encodePacked(bytes32(uint256(77)));
        router.setZonePeer(2, peer);
        IAirlock.Message memory message = IAirlock.Message(
            2,
            peer,
            1,
            abi.encodePacked(address(router)),
            0,
            10,
            peer,
            abi.encodePacked(RECIPIENT),
            hex""
        );
        IAirlock.Message[] memory messages = new IAirlock.Message[](1);
        messages[0] = message;
        airlock.setMessages(address(router), 2, peer, numbered(messages, 0));
        asset.configure(
            MockAdversarialRouterToken.Effect.Normal,
            MockAdversarialRouterToken.Effect.Revert,
            MockAdversarialRouterToken.Effect.Normal
        );
        router.airlockReceive(2, peer, 0, 1);
        assertEq(router.cachedMessages(2, peer, 0), keccak256(abi.encode(message)));
        assertEq(asset.totalSupply(), 0);
        asset.configure(
            MockAdversarialRouterToken.Effect.Normal,
            MockAdversarialRouterToken.Effect.Normal,
            MockAdversarialRouterToken.Effect.Normal
        );
        vm.prank(RECIPIENT);
        router.retryMessage(2, peer, 0, message);
        assertEq(router.cachedMessages(2, peer, 0), bytes32(0));
        assertEq(asset.balanceOf(RECIPIENT), 10);
    }

    function test_sendToken_SuccessfulReturnDataIgnored() public {
        MockAdversarialRouterToken asset = new MockAdversarialRouterToken();
        ZoneRouter router = _deploy(address(asset), IZoneRouter.Mode.BurnMint, address(0), bytes4(0), bytes4(0));
        router.setZonePeer(2, abi.encodePacked(bytes32(uint256(1))));
        asset.setOperator(address(router));
        asset.mint(address(this), 10);
        asset.configure(
            MockAdversarialRouterToken.Effect.Normal,
            MockAdversarialRouterToken.Effect.Normal,
            MockAdversarialRouterToken.Effect.FalseReturn
        );
        router.sendToken(2, abi.encodePacked(bytes32(uint256(1))), 10, hex"");
        assertEq(asset.totalSupply(), 0);
    }

    function _roundTrip(IZoneRouter.Mode _mode, bool _custom, string memory _gasName) internal {
        address backend = _custom ? address(new RouterSettlementBackend(token)) : address(0);
        bytes4 burnSelector = !_custom
            ? bytes4(0)
            : _mode == IZoneRouter.Mode.BurnMint
                ? bytes4(keccak256("redeem(address,uint256)"))
                : bytes4(keccak256("redeem(uint256)"));
        ZoneRouter sender = _deploy(
            address(token),
            _mode,
            backend,
            burnSelector,
            _custom ? RouterSettlementBackend.issue.selector : bytes4(0)
        );
        ZoneRouter receiver = ZoneRouter(factory.deploy(address(this), sender.config(), bytes32(uint256(1))));
        sender.setZonePeer(1, abi.encodePacked(address(receiver)));
        receiver.setZonePeer(1, abi.encodePacked(address(sender)));
        token.mint(address(this), 10);
        token.approve(address(sender), 10);
        sender.sendToken(1, abi.encodePacked(RECIPIENT), 10, hex"");
        if (bytes(_gasName).length != 0) {
            vm.snapshotGasLastCall("ZoneRouterModes", string.concat("sendToken_", _gasName));
        }
        assertEq(token.totalSupply(), 0);
        assertEq(token.balanceOf(address(sender)), 0);
        IAirlock.Message[] memory messages = new IAirlock.Message[](1);
        messages[0] = airlock.message();
        airlock.setMessages(address(receiver), 1, abi.encodePacked(address(sender)), numbered(messages, 0));
        receiver.airlockReceive(1, abi.encodePacked(address(sender)), 0, 1);
        if (bytes(_gasName).length != 0) {
            vm.snapshotGasLastCall("ZoneRouterModes", string.concat("airlockReceive_", _gasName));
        }
        assertEq(token.totalSupply(), 10);
        assertEq(token.balanceOf(RECIPIENT), 10);
    }

    function _deploy(
        address _token,
        IZoneRouter.Mode _mode,
        address _backend,
        bytes4 _burn,
        bytes4 _mint
    ) internal returns (ZoneRouter router) {
        address backend = _backend == address(0) ? _token : _backend;
        bytes4 burnSelector = _burn != bytes4(0)
            ? _burn
            : _mode == IZoneRouter.Mode.BurnMint
                ? bytes4(keccak256("burn(address,uint256)"))
                : bytes4(keccak256("burn(uint256)"));
        bytes4 mintSelector = _mint == bytes4(0) ? bytes4(keccak256("mint(address,uint256)")) : _mint;
        router = ZoneRouter(
            factory.deploy(
                address(this),
                IZoneRouter.Config(_token, _mode, 18, backend, burnSelector, mintSelector),
                bytes32(0)
            )
        );
    }
}
