// SPDX-License-Identifier: MIT
pragma solidity ^0.8.22;

import { Errors } from "@layerzerolabs/lz-evm-protocol-v2/contracts/libs/Errors.sol";
import { OptionsBuilder } from "@layerzerolabs/oapp-evm-contracts/contracts/oapp/libs/OptionsBuilder.sol";
import {
    MessagingFee,
    MessagingReceipt,
    OFTReceipt,
    SendParam
} from "@layerzerolabs/oft-evm-contracts/contracts/interfaces/IOFT.sol";
import { OFTComposeMsgCodec } from "@layerzerolabs/oft-evm-contracts/contracts/libs/OFTComposeMsgCodec.sol";
import { OFTBurnMintExtendedRBACUpgradeable } from "@layerzerolabs/oft-upgradeable-evm-contracts/contracts/extended/OFTBurnMintExtendedRBACUpgradeable.sol";
import { OFTCoreExtendedRBACUpgradeable } from "@layerzerolabs/oft-upgradeable-evm-contracts/contracts/extended/OFTCoreExtendedRBACUpgradeable.sol";
import { OFTLockUnlockExtendedRBACUpgradeable } from "@layerzerolabs/oft-upgradeable-evm-contracts/contracts/extended/OFTLockUnlockExtendedRBACUpgradeable.sol";
import { EndpointV2Mock } from "@layerzerolabs/test-devtools-evm-foundry/contracts/mocks/EndpointV2Mock.sol";
import { TestHelperOz5 } from "@layerzerolabs/test-devtools-evm-foundry/contracts/TestHelperOz5.sol";
import { MockBurnerMinter } from "@layerzerolabs/test-utils-evm-contracts/contracts/mocks/MockBurnerMinter.sol";
import { MockERC20 } from "@layerzerolabs/test-utils-evm-contracts/contracts/mocks/MockERC20.sol";
import { IAllowlist } from "@layerzerolabs/utils-evm-contracts/contracts/interfaces/IAllowlist.sol";
import { ICreditRedirect } from "@layerzerolabs/utils-evm-contracts/contracts/interfaces/ICreditRedirect.sol";
import { IRateLimiter } from "@layerzerolabs/utils-evm-contracts/contracts/interfaces/IRateLimiter.sol";
import { AllowlistRBACUpgradeable } from "@layerzerolabs/utils-upgradeable-evm-contracts/contracts/allowlist/AllowlistRBACUpgradeable.sol";
import { IAirlock, AIRLOCK_ADDRESS } from "@layerzerolabs/zone-router-evm-contracts/contracts/interfaces/IAirlock.sol";
import { IZoneRouter } from "@layerzerolabs/zone-router-evm-contracts/contracts/interfaces/IZoneRouter.sol";
import { ZoneRouter } from "@layerzerolabs/zone-router-evm-contracts/contracts/ZoneRouter.sol";
import { ZoneRouterFactory } from "@layerzerolabs/zone-router-evm-contracts/contracts/ZoneRouterFactory.sol";
import { MockGenericAirlock } from "@layerzerolabs/zone-router-evm-contracts/test/foundry/mocks/MockGenericAirlock.sol";
import { MockZoneRouterV2 } from "@layerzerolabs/zone-router-evm-contracts/test/foundry/mocks/MockZoneRouterV2.sol";
import { Ownable } from "@openzeppelin/contracts/access/Ownable.sol";
import { IERC20Errors } from "@openzeppelin/contracts/interfaces/draft-IERC6093.sol";
import { TransparentUpgradeableProxy } from "@openzeppelin/contracts/proxy/transparent/TransparentUpgradeableProxy.sol";
import { IZoneComposer } from "../../contracts/interfaces/IZoneComposer.sol";
import { ZoneComposerMsgCodec } from "../../contracts/libs/ZoneComposerMsgCodec.sol";
import { ZoneComposer } from "../../contracts/ZoneComposer.sol";

contract ZeroAllowlistRBACUpgradeableHarness is AllowlistRBACUpgradeable {
    constructor() {
        _disableInitializers();
    }

    function initialize(AllowlistMode _mode) public initializer {
        __AllowlistBase_init(_mode);
        __AccessControl2Step_init(msg.sender);
    }
}

contract MockZeroOFTConfig {
    address public immutable endpoint;
    address public immutable token;

    constructor(address _endpoint, address _token) {
        endpoint = _endpoint;
        token = _token;
    }
}

contract MockReentrantComposerToken is MockERC20 {
    address public callbackTarget;
    bytes public callbackData;
    bytes public callbackResult;
    bool public callbackSuccess;

    constructor() MockERC20(18) {}

    function setCallback(address _target, bytes calldata _data) external {
        callbackTarget = _target;
        callbackData = _data;
    }

    function _update(address _from, address _to, uint256 _amount) internal override {
        super._update(_from, _to, _amount);
        address target = callbackTarget;
        if (target != address(0)) {
            callbackTarget = address(0);
            (callbackSuccess, callbackResult) = target.call(callbackData);
        }
    }
}

abstract contract ZoneComposerFixture is TestHelperOz5 {
    using OptionsBuilder for bytes;

    uint32 internal constant A_EID = 1;
    uint32 internal constant B_EID = 2;
    /// The destination zone, above `uint32` so that a zone narrowed to 32 bits fails.
    uint64 internal constant ZONE = uint64(type(uint32).max) + 1;
    uint256 internal constant RESERVE = 1_000 ether;
    bytes internal RECIPIENT = abi.encodePacked(address(0xBEEF));

    MockERC20 internal tokenA;
    OFTBurnMintExtendedRBACUpgradeable internal oftA;
    OFTCoreExtendedRBACUpgradeable internal oftB;
    MockERC20 internal tokenB;
    ZoneRouter internal router;
    ZoneRouterFactory internal routerFactory;
    ZoneRouter internal routerImplementation;
    ZoneComposer internal composer;
    EndpointV2Mock internal endpoint;
    MockGenericAirlock internal airlock;
    address internal user = makeAddr("user");
    address internal proxyOwner = makeAddr("proxyOwner");

    function setUp() public virtual override {
        super.setUp();
        setUpEndpoints(2, LibraryType.UltraLightNode);
        tokenA = new MockERC20(18);
        MockBurnerMinter burnerMinterA = new MockBurnerMinter(address(tokenA));
        OFTBurnMintExtendedRBACUpgradeable implementationA = new OFTBurnMintExtendedRBACUpgradeable(
            address(tokenA),
            address(burnerMinterA),
            endpoints[A_EID],
            false,
            MockBurnerMinter.burn.selector,
            MockBurnerMinter.mint.selector,
            0
        );
        oftA = OFTBurnMintExtendedRBACUpgradeable(
            address(
                new TransparentUpgradeableProxy(
                    address(implementationA),
                    proxyOwner,
                    abi.encodeCall(OFTBurnMintExtendedRBACUpgradeable.initialize, (address(this), address(this)))
                )
            )
        );
        _configureRateLimit(oftA, B_EID);
        tokenA.mint(user, RESERVE);
        tokenB = new MockERC20(18);
        oftB = _deployOFT(B_EID, tokenB, false);
        routerImplementation = new ZoneRouter();
        routerFactory = new ZoneRouterFactory(address(routerImplementation));
        router = ZoneRouter(
            routerFactory.deploy(
                address(this),
                IZoneRouter.Config(address(tokenB), IZoneRouter.Mode.LockUnlock, 18, address(0), bytes4(0), bytes4(0)),
                bytes32(0)
            )
        );
        router.setZonePeer(ZONE, RECIPIENT);
        oftA.setPeer(B_EID, addressToBytes32(address(oftB)));
        oftB.setPeer(A_EID, addressToBytes32(address(oftA)));
        composer = new ZoneComposer(address(this), address(oftB), address(router));
        endpoint = EndpointV2Mock(endpoints[B_EID]);
        MockGenericAirlock implementation = new MockGenericAirlock();
        vm.etch(AIRLOCK_ADDRESS, address(implementation).code);
        airlock = MockGenericAirlock(AIRLOCK_ADDRESS);

        vm.deal(user, RESERVE);
        vm.deal(address(this), RESERVE);
    }

    function _returnFlow() internal {
        (bytes32 guid, bytes memory message, uint256 credited) = _land(1 ether, _payload());
        _deliver(guid, message);
        IAirlock.Message[] memory messages = new IAirlock.Message[](1);
        messages[0] = IAirlock.Message({
            srcZone: ZONE,
            srcApp: RECIPIENT,
            dstZone: B_EID,
            dstApp: abi.encodePacked(address(router)),
            nonce: 0,
            amount18d: credited,
            sender: RECIPIENT,
            recipient: abi.encodePacked(user),
            memo: hex""
        });
        airlock.setMessages(address(router), ZONE, RECIPIENT, messages);
        router.airlockReceive(ZONE, RECIPIENT, 0, 1);
        assertEq(tokenB.balanceOf(user), credited);
        assertEq(tokenB.balanceOf(address(router)), 0);
        SendParam memory sendParam = SendParam(
            A_EID,
            addressToBytes32(user),
            credited,
            credited,
            OptionsBuilder.newOptions().addExecutorLzReceiveOption(1_000_000, 0),
            "",
            ""
        );
        MessagingFee memory fee = oftB.quoteSend(sendParam, false);
        vm.startPrank(user);
        tokenB.approve(address(oftB), credited);
        oftB.send{ value: fee.nativeFee }(sendParam, fee, user);
        vm.stopPrank();
        verifyPackets(A_EID, address(oftA));
        assertEq(tokenA.balanceOf(user), RESERVE);
        assertEq(tokenB.balanceOf(user), 0);
        assertEq(tokenB.balanceOf(address(composer)), 0);
    }

    function _cache(uint256 _amount, bytes memory _payloadBytes) internal returns (bytes32 guid, uint256 amount) {
        bytes memory message;
        (guid, message, amount) = _land(_amount, _payloadBytes);
        vm.expectEmit(true, true, true, true, address(composer));
        emit IZoneComposer.DecodeFailed(guid, _payloadBytes);
        _deliver(guid, message);
        assertEq(composer.rescuableMessages(guid), amount);
        assertEq(endpoint.composeQueue(address(oftB), address(composer), guid, 0), bytes32(uint256(1)));
    }

    function _useCallbackToken() internal returns (MockReentrantComposerToken callbackToken) {
        callbackToken = new MockReentrantComposerToken();
        tokenB = callbackToken;
        oftB = _deployOFT(B_EID, tokenB, false);
        oftA.setPeer(B_EID, addressToBytes32(address(oftB)));
        oftB.setPeer(A_EID, addressToBytes32(address(oftA)));
        router = ZoneRouter(
            routerFactory.deploy(
                address(this),
                IZoneRouter.Config(address(tokenB), IZoneRouter.Mode.LockUnlock, 18, address(0), bytes4(0), bytes4(0)),
                bytes32(0)
            )
        );
        router.setZonePeer(ZONE, RECIPIENT);
        composer = new ZoneComposer(address(this), address(oftB), address(router));
    }

    function _useLockUnlockOFT() internal {
        oftB = _deployOFT(B_EID, tokenB, true);
        oftA.setPeer(B_EID, addressToBytes32(address(oftB)));
        oftB.setPeer(A_EID, addressToBytes32(address(oftA)));
        tokenB.mint(address(oftB), RESERVE);
        composer = new ZoneComposer(address(this), address(oftB), address(router));
    }

    function _deployOFT(
        uint32 _eid,
        MockERC20 _token,
        bool _lockUnlock
    ) internal returns (OFTCoreExtendedRBACUpgradeable oft) {
        address implementation;
        bytes memory initialize;
        if (_lockUnlock) {
            implementation = address(new OFTLockUnlockExtendedRBACUpgradeable(address(_token), endpoints[_eid], 0));
            initialize = abi.encodeCall(
                OFTLockUnlockExtendedRBACUpgradeable.initialize,
                (address(this), address(this))
            );
        } else {
            MockBurnerMinter burnerMinter = new MockBurnerMinter(address(_token));
            implementation = address(
                new OFTBurnMintExtendedRBACUpgradeable(
                    address(_token),
                    address(burnerMinter),
                    endpoints[_eid],
                    false,
                    MockBurnerMinter.burn.selector,
                    MockBurnerMinter.mint.selector,
                    0
                )
            );
            initialize = abi.encodeCall(OFTBurnMintExtendedRBACUpgradeable.initialize, (address(this), address(this)));
        }
        oft = OFTCoreExtendedRBACUpgradeable(
            address(new TransparentUpgradeableProxy(implementation, proxyOwner, initialize))
        );
        _configureRateLimit(oft, A_EID);
    }

    function _configureRateLimit(OFTCoreExtendedRBACUpgradeable _oft, uint32 _remoteEid) internal {
        _oft.grantRole(_oft.RATE_LIMITER_MANAGER_ROLE(), address(this));
        IRateLimiter.SetRateLimitConfigParam[] memory configs = new IRateLimiter.SetRateLimitConfigParam[](1);
        configs[0] = IRateLimiter.SetRateLimitConfigParam({
            id: _remoteEid,
            config: IRateLimiter.RateLimitConfig({
                active: true,
                outboundEnabled: true,
                inboundEnabled: true,
                netAccountingEnabled: true,
                addressExemptionEnabled: false,
                outboundLimit: uint96(RESERVE),
                inboundLimit: uint96(RESERVE),
                outboundWindow: 0,
                inboundWindow: 0
            })
        });
        _oft.setRateLimitConfigs(configs);
    }

    function _payload() internal view returns (bytes memory) {
        return ZoneComposerMsgCodec.encode(ZONE, RECIPIENT, hex"");
    }

    function _message(uint256 _amount, bytes memory _payloadBytes) internal view returns (bytes memory) {
        return OFTComposeMsgCodec.encode(1, A_EID, _amount, abi.encodePacked(addressToBytes32(user), _payloadBytes));
    }

    function _send(
        uint256 _amount,
        bytes memory _payloadBytes
    ) internal returns (MessagingReceipt memory receipt, OFTReceipt memory oftReceipt) {
        SendParam memory sendParam = SendParam(
            B_EID,
            addressToBytes32(address(composer)),
            _amount,
            0,
            OptionsBuilder.newOptions().addExecutorLzReceiveOption(1_000_000, 0).addExecutorLzComposeOption(
                0,
                1_000_000,
                0
            ),
            _payloadBytes,
            ""
        );
        MessagingFee memory fee = oftA.quoteSend(sendParam, false);
        uint256 balance = tokenA.balanceOf(user);
        uint256 supply = tokenA.totalSupply();
        vm.prank(user);
        (receipt, oftReceipt) = oftA.send{ value: fee.nativeFee }(sendParam, fee, user);
        assertEq(tokenA.balanceOf(user), balance - oftReceipt.amountSentLD);
        assertEq(tokenA.totalSupply(), supply - oftReceipt.amountReceivedLD);
    }

    function _land(
        uint256 _amount,
        bytes memory _payloadBytes
    ) internal returns (bytes32 guid, bytes memory message, uint256 credited) {
        (MessagingReceipt memory receipt, OFTReceipt memory oftReceipt) = _send(_amount, _payloadBytes);
        message = OFTComposeMsgCodec.encode(
            receipt.nonce,
            A_EID,
            oftReceipt.amountReceivedLD,
            abi.encodePacked(addressToBytes32(user), _payloadBytes)
        );
        uint256 composerBalance = tokenB.balanceOf(address(composer));
        verifyPackets(B_EID, address(oftB));
        assertEq(tokenB.balanceOf(address(composer)), composerBalance + oftReceipt.amountReceivedLD);
        assertEq(endpoint.composeQueue(address(oftB), address(composer), receipt.guid, 0), keccak256(message));
        return (receipt.guid, message, oftReceipt.amountReceivedLD);
    }

    function _deliver(bytes32 _guid, bytes memory _messageBytes) internal {
        endpoint.lzCompose(address(oftB), address(composer), _guid, 0, _messageBytes, "");
    }
}

contract ComposerSettlementBackend {
    MockERC20 public immutable token;

    constructor(MockERC20 _token) {
        token = _token;
    }

    function redeem(address _from, uint256 _amount) external {
        token.burnFrom(_from, _amount);
    }

    function redeem(uint256 _amount) external {
        token.burn(msg.sender, _amount);
    }

    function issue(address _to, uint256 _amount) external {
        token.mint(_to, _amount);
    }
}

contract ZoneComposerTest is ZoneComposerFixture {
    using OptionsBuilder for bytes;

    function test_constructor() public view {
        assertEq(composer.OFT(), address(oftB));
        assertEq(composer.ENDPOINT(), address(endpoint));
        assertEq(composer.TOKEN(), address(tokenB));
        assertEq(composer.ROUTER(), address(router));
        assertEq(composer.owner(), address(this));
        assertEq(tokenB.allowance(address(composer), address(router)), type(uint256).max);
    }

    function test_constructor_Revert_NativeOFT() public {
        MockZeroOFTConfig invalid = new MockZeroOFTConfig(address(endpoint), address(0));
        vm.expectRevert(IZoneComposer.InvalidOFT.selector);
        new ZoneComposer(address(this), address(invalid), address(router));
    }

    function test_constructor_Revert_NativeOFTWithoutRouter() public {
        MockZeroOFTConfig invalid = new MockZeroOFTConfig(address(endpoint), address(0));
        vm.expectRevert(IZoneComposer.InvalidOFT.selector);
        new ZoneComposer(address(this), address(invalid), address(0));
    }

    function test_constructor_Revert_WrongRouterToken() public {
        ZoneRouter wrong = ZoneRouter(
            routerFactory.deploy(
                address(this),
                IZoneRouter.Config(address(tokenA), IZoneRouter.Mode.LockUnlock, 18, address(0), bytes4(0), bytes4(0)),
                bytes32(0)
            )
        );
        vm.expectRevert(IZoneComposer.InvalidRouter.selector);
        new ZoneComposer(address(this), address(oftB), address(wrong));
    }

    function test_constructor_Revert_ZeroEndpoint() public {
        MockZeroOFTConfig invalid = new MockZeroOFTConfig(address(0), address(tokenB));
        vm.expectRevert(IZoneComposer.InvalidEndpoint.selector);
        new ZoneComposer(address(this), address(invalid), address(router));
    }

    function test_constructor_Revert_ZeroOFT() public {
        vm.expectRevert(IZoneComposer.InvalidOFT.selector);
        new ZoneComposer(address(this), address(0), address(router));
    }

    function test_constructor_Revert_ZeroOwner() public {
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableInvalidOwner.selector, address(0)));
        new ZoneComposer(address(0), address(oftB), address(router));
    }

    function test_constructor_Revert_ZoneRouter() public {
        vm.expectRevert(IZoneComposer.InvalidRouter.selector);
        new ZoneComposer(address(this), address(oftB), address(0));
    }

    function test_lzCompose() public {
        (bytes32 guid, bytes memory message, uint256 credited) = _land(1 ether, _payload());
        _deliver(guid, message);
        assertEq(tokenB.balanceOf(address(composer)), 0);
        assertEq(tokenB.balanceOf(address(router)), credited);
        assertEq(tokenB.allowance(address(composer), address(router)), type(uint256).max);
        assertEq(endpoint.composeQueue(address(oftB), address(composer), guid, 0), bytes32(uint256(1)));
    }

    function test_lzCompose_DirectTokenBurn() public {
        router = ZoneRouter(
            routerFactory.deploy(
                address(this),
                IZoneRouter.Config(
                    address(tokenB),
                    IZoneRouter.Mode.BurnMint,
                    18,
                    address(tokenB),
                    MockERC20.burnFrom.selector,
                    MockERC20.mint.selector
                ),
                bytes32(uint256(4))
            )
        );
        router.setZonePeer(ZONE, RECIPIENT);
        composer = new ZoneComposer(address(this), address(oftB), address(router));
        assertEq(tokenB.allowance(address(composer), address(router)), type(uint256).max);
        assertEq(tokenB.allowance(address(composer), address(tokenB)), 0);
        (bytes32 guid, bytes memory message, uint256 credited) = _land(1 ether, _payload());
        uint256 supply = tokenB.totalSupply();
        _deliver(guid, message);
        assertEq(tokenB.totalSupply(), supply - credited);
        assertEq(tokenB.balanceOf(address(composer)), 0);
        assertEq(endpoint.composeQueue(address(oftB), address(composer), guid, 0), bytes32(uint256(1)));
    }

    function test_lzCompose_BurnMintBackend() public {
        _composeBurnMode(IZoneRouter.Mode.BurnMint, bytes4(keccak256("redeem(address,uint256)")));
    }

    function test_lzCompose_BurnSelfMintBackend() public {
        _composeBurnMode(IZoneRouter.Mode.BurnSelfMint, bytes4(keccak256("redeem(uint256)")));
    }

    function _composeBurnMode(IZoneRouter.Mode _mode, bytes4 _burnSelector) internal {
        ComposerSettlementBackend backend = new ComposerSettlementBackend(tokenB);
        router = ZoneRouter(
            routerFactory.deploy(
                address(this),
                IZoneRouter.Config(
                    address(tokenB),
                    _mode,
                    18,
                    address(backend),
                    _burnSelector,
                    ComposerSettlementBackend.issue.selector
                ),
                bytes32(uint256(3))
            )
        );
        router.setZonePeer(ZONE, RECIPIENT);
        composer = new ZoneComposer(address(this), address(oftB), address(router));
        (bytes32 guid, bytes memory message, uint256 credited) = _land(1 ether, _payload());
        uint256 supply = tokenB.totalSupply();
        assertEq(
            tokenB.allowance(address(composer), address(router)),
            _mode == IZoneRouter.Mode.BurnMint ? 0 : type(uint256).max
        );
        assertEq(
            tokenB.allowance(address(composer), address(backend)),
            _mode == IZoneRouter.Mode.BurnMint ? type(uint256).max : 0
        );
        _deliver(guid, message);
        assertEq(tokenB.totalSupply(), supply - credited);
        assertEq(tokenB.balanceOf(address(composer)), 0);
        assertEq(tokenB.balanceOf(address(router)), 0);
        assertEq(airlock.message().amount18d, credited);
        assertEq(endpoint.composeQueue(address(oftB), address(composer), guid, 0), bytes32(uint256(1)));
    }

    function test_lzCompose_ZeroRecipient() public {
        (bytes32 guid, bytes memory message, uint256 credited) = _land(
            1 ether,
            ZoneComposerMsgCodec.encode(ZONE, abi.encodePacked(address(0)))
        );
        _deliver(guid, message);
        IAirlock.Message memory transfer = airlock.message();
        assertEq(transfer.recipient, abi.encodePacked(address(0)));
        assertEq(transfer.amount18d, credited);
        assertEq(airlock.sender(), address(router));
        assertEq(tokenB.balanceOf(address(composer)), 0);
        assertEq(tokenB.balanceOf(address(router)), credited);
        assertEq(endpoint.composeQueue(address(oftB), address(composer), guid, 0), bytes32(uint256(1)));
    }

    function test_lzCompose_DecodeFailed_LongPayload() public {
        _cache(1 ether, new bytes(129));
    }

    function test_lzCompose_DecodeFailed_NonCanonicalZone() public {
        _cache(1 ether, abi.encode(type(uint256).max, RECIPIENT));
    }

    function test_lzCompose_DecodeFailed_ShortPayload() public {
        _cache(1 ether, hex"01");
    }

    function test_lzCompose_AfterImplementationCodeUpdate() public {
        (bytes32 guid, bytes memory message, uint256 credited) = _land(1 ether, _payload());
        address original = address(router);
        uint256 allowance = tokenB.allowance(address(composer), original);
        vm.etch(address(routerImplementation), address(new MockZoneRouterV2()).code);
        assertEq(address(router), original);
        assertEq(MockZoneRouterV2(original).version(), 2);
        assertEq(tokenB.allowance(address(composer), original), allowance);
        _deliver(guid, message);
        assertEq(tokenB.balanceOf(original), credited);
        assertEq(airlock.sender(), original);
        assertEq(airlock.message().srcApp, abi.encodePacked(original));
        assertEq(endpoint.composeQueue(address(oftB), address(composer), guid, 0), bytes32(uint256(1)));
    }

    function test_lzCompose_Gas_EndpointDelivery() public {
        (bytes32 guid, bytes memory message, ) = _land(1 ether, _payload());
        vm.expectEmit(true, true, true, true, address(router));
        emit IZoneRouter.Sent(ZONE, RECIPIENT, 0, address(composer), RECIPIENT, 1 ether);
        _deliver(guid, message);
        vm.snapshotGasLastCall("ZoneComposer", "lzCompose_Gas_EndpointDelivery");
    }

    function test_lzCompose_SentCarriesAirlockNonce() public {
        (bytes32 first, bytes memory firstMessage, ) = _land(1 ether, _payload());
        _deliver(first, firstMessage);
        (bytes32 guid, bytes memory message, ) = _land(1 ether, _payload());
        vm.expectEmit(true, true, true, true, address(composer));
        emit IZoneComposer.Sent(guid, ZONE, 1);
        _deliver(guid, message);
    }

    function test_lzCompose_Gas_EndpointDelivery_UnroutableZone() public {
        router.setZonePeer(999, hex"");
        (bytes32 guid, bytes memory message, ) = _land(1 ether, ZoneComposerMsgCodec.encode(999, RECIPIENT));
        vm.expectEmit(true, true, true, true, address(composer));
        emit IZoneComposer.UnroutableZone(guid, 999, RECIPIENT, bytes(""));
        _deliver(guid, message);
        vm.snapshotGasLastCall("ZoneComposer", "lzCompose_Gas_EndpointDelivery_UnroutableZone");
    }

    function test_lzCompose_LockUnlockOFT() public {
        _useLockUnlockOFT();
        (bytes32 guid, bytes memory message, uint256 credited) = _land(1 ether, _payload());
        _deliver(guid, message);
        assertEq(tokenB.balanceOf(address(oftB)), RESERVE - credited);
        assertEq(tokenB.balanceOf(address(router)), credited);
        assertEq(tokenB.balanceOf(address(composer)), 0);
    }

    function test_lzCompose_OtherZoneWithMemo() public {
        router.setZonePeer(999, RECIPIENT);
        (bytes32 guid, bytes memory message, uint256 credited) = _land(
            1 ether,
            ZoneComposerMsgCodec.encode(999, RECIPIENT, hex"01")
        );
        _deliver(guid, message);
        IAirlock.Message memory transfer = airlock.message();
        assertEq(transfer.dstZone, 999);
        assertEq(transfer.recipient, RECIPIENT);
        assertEq(transfer.memo, hex"01");
        assertEq(transfer.amount18d, credited);
        assertEq(endpoint.composeQueue(address(oftB), address(composer), guid, 0), bytes32(uint256(1)));
    }

    function test_lzCompose_PendingCreditsInReverseOrder() public {
        (bytes32 firstGuid, bytes memory firstMessage, ) = _land(2 ether, _payload());
        (bytes32 secondGuid, bytes memory secondMessage, ) = _land(3 ether, _payload());
        _deliver(secondGuid, secondMessage);
        assertEq(tokenB.balanceOf(address(composer)), 2 ether);
        assertEq(tokenB.balanceOf(address(router)), 3 ether);
        _deliver(firstGuid, firstMessage);
        assertEq(tokenB.balanceOf(address(composer)), 0);
        assertEq(tokenB.balanceOf(address(router)), 5 ether);
    }

    function test_lzCompose_ReentrantPendingDelivery() public {
        MockReentrantComposerToken callbackToken = _useCallbackToken();
        (bytes32 firstGuid, bytes memory firstMessage, ) = _land(2 ether, _payload());
        (bytes32 secondGuid, bytes memory secondMessage, ) = _land(3 ether, _payload());
        callbackToken.setCallback(
            address(endpoint),
            abi.encodeCall(
                endpoint.lzCompose,
                (address(oftB), address(composer), secondGuid, uint16(0), secondMessage, bytes(""))
            )
        );
        _deliver(firstGuid, firstMessage);
        assertTrue(callbackToken.callbackSuccess());
        assertEq(tokenB.balanceOf(address(composer)), 0);
        assertEq(tokenB.balanceOf(address(router)), 5 ether);
        assertEq(endpoint.composeQueue(address(oftB), address(composer), secondGuid, 0), bytes32(uint256(1)));
    }

    function test_lzCompose_SourceDust() public {
        (bytes32 guid, bytes memory message, uint256 credited) = _land(1 ether + 1, _payload());
        assertEq(credited, 1 ether);
        _deliver(guid, message);
        assertEq(tokenB.balanceOf(address(router)), credited);
    }

    function test_lzCompose_SourceFeeAndDust() public {
        oftA.grantRole(oftA.FEE_CONFIG_MANAGER_ROLE(), address(this));
        oftA.setDefaultFeeBps(100);
        (bytes32 guid, bytes memory message, uint256 credited) = _land(1 ether + 1, _payload());
        assertEq(credited, 0.99 ether);
        assertEq(tokenA.balanceOf(address(this)), 0.01 ether + 1);
        _deliver(guid, message);
        assertEq(tokenB.balanceOf(address(router)), credited);
    }

    function test_lzCompose_WithoutMemo() public {
        (bytes32 guid, bytes memory message, ) = _land(1 ether, ZoneComposerMsgCodec.encode(ZONE, RECIPIENT));
        _deliver(guid, message);
        assertEq(tokenB.balanceOf(address(router)), 1 ether);
    }

    function test_lzCompose_Fuzz_UnroutableZone(bool _withMemo) public {
        bytes memory memo = _withMemo ? bytes(hex"01") : bytes("");
        bytes memory payload = _withMemo
            ? ZoneComposerMsgCodec.encode(999, RECIPIENT, memo)
            : ZoneComposerMsgCodec.encode(999, RECIPIENT);
        (bytes32 guid, bytes memory message, uint256 credited) = _land(1 ether, payload);
        vm.expectEmit(true, true, true, true, address(composer));
        emit IZoneComposer.UnroutableZone(guid, 999, RECIPIENT, memo);
        _deliver(guid, message);
        assertEq(composer.rescuableMessages(guid), credited);
        assertEq(composer.retryableMessages(guid), keccak256(abi.encode(uint64(999), RECIPIENT, memo)));
        assertEq(endpoint.composeQueue(address(oftB), address(composer), guid, 0), bytes32(uint256(1)));
        assertEq(tokenB.balanceOf(address(router)), 0);

        router.setZonePeer(999, RECIPIENT);
        vm.expectRevert(
            abi.encodeWithSelector(Errors.LZ_ComposeNotFound.selector, bytes32(uint256(1)), keccak256(message))
        );
        _deliver(guid, message);
        assertEq(composer.rescuableMessages(guid), credited);
        assertEq(tokenB.balanceOf(address(composer)), credited);
        composer.rescue(guid, user);
        assertEq(composer.rescuableMessages(guid), 0);
        assertEq(composer.retryableMessages(guid), bytes32(0));
        assertEq(tokenB.balanceOf(user), credited);
    }

    function test_lzCompose_Fuzz_UnroutableZone_DifferentOwners(bool _withMemo) public {
        address composerOwner = makeAddr("composerOwner");
        composer = new ZoneComposer(composerOwner, address(oftB), address(router));
        assertEq(router.owner(), address(this));
        assertEq(composer.owner(), composerOwner);
        bytes memory memo = _withMemo ? bytes(hex"01") : bytes("");
        bytes memory payload = _withMemo
            ? ZoneComposerMsgCodec.encode(ZONE, RECIPIENT, memo)
            : ZoneComposerMsgCodec.encode(ZONE, RECIPIENT);
        (bytes32 guid, bytes memory message, uint256 credited) = _land(1 ether, payload);
        router.setZonePeer(ZONE, hex"");
        vm.expectEmit(true, true, true, true, address(composer));
        emit IZoneComposer.UnroutableZone(guid, ZONE, RECIPIENT, memo);
        vm.prank(user);
        _deliver(guid, message);
        assertEq(composer.rescuableMessages(guid), credited);
        assertEq(tokenB.balanceOf(address(composer)), credited);
        assertEq(endpoint.composeQueue(address(oftB), address(composer), guid, 0), bytes32(uint256(1)));

        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, address(this)));
        composer.rescue(guid, user);
        vm.prank(composerOwner);
        vm.expectRevert(IZoneComposer.InvalidRescueRecipient.selector);
        composer.rescue(guid, address(0));
        assertEq(composer.rescuableMessages(guid), credited);

        tokenB.burn(address(composer), 1);
        vm.prank(composerOwner);
        vm.expectRevert(
            abi.encodeWithSelector(
                IERC20Errors.ERC20InsufficientBalance.selector,
                address(composer),
                credited - 1,
                credited
            )
        );
        composer.rescue(guid, user);
        assertEq(composer.rescuableMessages(guid), credited);
        assertEq(endpoint.composeQueue(address(oftB), address(composer), guid, 0), bytes32(uint256(1)));
        tokenB.mint(address(composer), 1);
        vm.prank(composerOwner);
        composer.rescue(guid, user);
        assertEq(composer.rescuableMessages(guid), 0);
        assertEq(tokenB.balanceOf(user), credited);
    }

    function test_lzCompose_Fuzz_DecodeFailed_ZeroFilled(uint16 _length) public {
        uint256 length = bound(_length, 1, 256);
        _cache(1 ether, new bytes(length));
    }

    function test_lzCompose_Fuzz_ExactReceivedAmount(uint96 _amount, uint96 _pending) public {
        (, , uint256 pending) = _land(bound(_pending, 1e12, 100 ether), _payload());
        (bytes32 guid, bytes memory message, uint256 credited) = _land(bound(_amount, 1e12, 100 ether), _payload());
        _deliver(guid, message);
        assertEq(tokenB.balanceOf(address(router)), credited);
        assertEq(tokenB.balanceOf(address(composer)), pending);
    }

    function test_lzCompose_Fuzz_DecodeFailed_OversizedRecipient(bool _withMemo) public {
        bytes memory payload = _withMemo
            ? ZoneComposerMsgCodec.encode(ZONE, new bytes(256), bytes(""))
            : ZoneComposerMsgCodec.encode(ZONE, new bytes(256));
        (bytes32 guid, uint256 credited) = _cache(1 ether, payload);
        composer.rescue(guid, user);
        assertEq(tokenB.balanceOf(user), credited);
        assertEq(composer.rescuableMessages(guid), 0);
    }

    function test_lzCompose_DecodeFailed_OversizedMemo() public {
        (bytes32 guid, uint256 credited) = _cache(
            1 ether,
            ZoneComposerMsgCodec.encode(ZONE, RECIPIENT, new bytes(256))
        );
        composer.rescue(guid, user);
        assertEq(tokenB.balanceOf(user), credited);
        assertEq(composer.rescuableMessages(guid), 0);
    }

    function test_lzCompose_Fuzz_DecodeFailed_EmptyRecipient(bool _withMemo) public {
        bytes memory payload = _withMemo
            ? ZoneComposerMsgCodec.encode(ZONE, bytes(""), bytes(""))
            : ZoneComposerMsgCodec.encode(ZONE, bytes(""));
        (bytes32 guid, uint256 credited) = _cache(1 ether, payload);
        composer.rescue(guid, user);
        assertEq(tokenB.balanceOf(user), credited);
        assertEq(tokenB.balanceOf(address(router)), 0);
        assertEq(composer.rescuableMessages(guid), 0);
    }

    function test_lzCompose_Fuzz_DecodeFailed_ZeroZone(bool _withMemo) public {
        bytes memory payload = _withMemo
            ? ZoneComposerMsgCodec.encode(0, RECIPIENT, bytes(""))
            : ZoneComposerMsgCodec.encode(0, RECIPIENT);
        (bytes32 guid, uint256 credited) = _cache(1 ether, payload);
        composer.rescue(guid, user);
        assertEq(tokenB.balanceOf(user), credited);
        assertEq(tokenB.balanceOf(address(router)), 0);
        assertEq(composer.rescuableMessages(guid), 0);
    }

    function test_lzCompose_Revert_AirlockThenRetry() public {
        (bytes32 guid, bytes memory message, ) = _land(1 ether, _payload());
        airlock.setFail(true);
        vm.expectRevert(MockGenericAirlock.Rejected.selector);
        _deliver(guid, message);
        assertEq(tokenB.balanceOf(address(composer)), 1 ether);
        assertEq(tokenB.balanceOf(address(router)), 0);
        assertEq(tokenB.allowance(address(composer), address(router)), type(uint256).max);
        assertEq(endpoint.composeQueue(address(oftB), address(composer), guid, 0), keccak256(message));
        airlock.setFail(false);
        _deliver(guid, message);
        assertEq(tokenB.balanceOf(address(router)), 1 ether);
    }

    function test_lzCompose_Revert_OnlyEndpoint() public {
        vm.expectRevert(abi.encodeWithSelector(IZoneComposer.OnlyEndpoint.selector, address(this)));
        composer.lzCompose(address(oftB), bytes32(0), _message(1, hex"01"), address(this), "");
    }

    function test_lzCompose_Revert_OnlyOFT() public {
        bytes memory message = _message(1, hex"01");
        endpoint.sendCompose(address(composer), bytes32(0), 0, message);
        vm.expectRevert(abi.encodeWithSelector(IZoneComposer.OnlyOFT.selector, address(this)));
        endpoint.lzCompose(address(this), address(composer), bytes32(0), 0, message, "");
    }

    function test_lzCompose_Revert_Replay() public {
        (bytes32 guid, bytes memory message, ) = _land(1 ether, _payload());
        _deliver(guid, message);
        vm.expectRevert(
            abi.encodeWithSelector(Errors.LZ_ComposeNotFound.selector, bytes32(uint256(1)), keccak256(message))
        );
        _deliver(guid, message);
        assertEq(tokenB.balanceOf(address(router)), 1 ether);
    }

    function test_lzCompose_Revert_UnexpectedValueThenRetry() public {
        (bytes32 guid, bytes memory message, ) = _land(1 ether, _payload());
        vm.expectRevert(abi.encodeWithSelector(IZoneComposer.UnexpectedValue.selector, 1));
        endpoint.lzCompose{ value: 1 }(address(oftB), address(composer), guid, 0, message, "");
        assertEq(tokenB.balanceOf(address(composer)), 1 ether);
        assertEq(endpoint.composeQueue(address(oftB), address(composer), guid, 0), keccak256(message));
        _deliver(guid, message);
    }

    function test_lzCompose_Revert_ZeroCreditRedirectedToEscrow() public {
        _land(2 ether, _payload());
        ZeroAllowlistRBACUpgradeableHarness implementation = new ZeroAllowlistRBACUpgradeableHarness();
        address allowlist = address(
            new TransparentUpgradeableProxy(
                address(implementation),
                proxyOwner,
                abi.encodeCall(ZeroAllowlistRBACUpgradeableHarness.initialize, (IAllowlist.AllowlistMode.Whitelist))
            )
        );
        address escrow = makeAddr("escrow");
        oftB.setCreditRedirectConfig(ICreditRedirect.CreditRedirectConfig(allowlist, escrow));
        (MessagingReceipt memory receipt, ) = _send(1 ether, _payload());
        bytes memory message = OFTComposeMsgCodec.encode(
            receipt.nonce,
            A_EID,
            0,
            abi.encodePacked(addressToBytes32(user), _payload())
        );
        verifyPackets(B_EID, address(oftB));
        assertEq(tokenB.balanceOf(escrow), 1 ether);
        vm.expectRevert(IZoneComposer.ZeroAmount.selector);
        _deliver(receipt.guid, message);
        assertEq(tokenB.balanceOf(address(composer)), 2 ether);
        assertEq(tokenB.balanceOf(address(router)), 0);
    }

    function test_lzCompose_Fuzz_Revert_TruncatedHeader(uint8 _length) public {
        uint256 length = bound(_length, 0, 75);
        bytes memory fullMessage = _message(1, hex"01");
        bytes memory message = new bytes(length);
        for (uint256 i; i < length; ++i) {
            message[i] = fullMessage[i];
        }
        tokenB.mint(address(composer), 1);
        vm.prank(address(endpoint));
        vm.expectRevert(bytes(""));
        composer.lzCompose(address(oftB), bytes32(0), message, address(this), "");
    }

    function test_retry() public {
        (bytes32 first, bytes memory firstMessage, uint256 firstCredited) = _land(1 ether, _payload());
        _deliver(first, firstMessage);
        (bytes32 guid, uint256 credited) = _cacheUnroutable(true);
        router.setZonePeer(ZONE, RECIPIENT);
        vm.expectEmit(true, true, true, true, address(router));
        emit IZoneRouter.Sent(ZONE, RECIPIENT, 1, address(composer), RECIPIENT, credited);
        vm.expectEmit(true, true, true, true, address(composer));
        emit IZoneComposer.Sent(guid, ZONE, 1);
        vm.expectEmit(true, true, true, true, address(composer));
        emit IZoneComposer.Retried(guid);
        vm.prank(user);
        composer.retry(guid, ZONE, RECIPIENT, hex"01");
        assertEq(airlock.message().memo, hex"01");
        assertEq(composer.rescuableMessages(guid), 0);
        assertEq(composer.retryableMessages(guid), bytes32(0));
        assertEq(tokenB.balanceOf(address(composer)), 0);
        assertEq(tokenB.balanceOf(address(router)), firstCredited + credited);
    }

    function test_retry_Gas() public {
        (bytes32 guid, uint256 credited) = _cacheUnroutable(true);
        router.setZonePeer(ZONE, RECIPIENT);
        vm.expectEmit(true, true, true, true, address(router));
        emit IZoneRouter.Sent(ZONE, RECIPIENT, 0, address(composer), RECIPIENT, credited);
        composer.retry(guid, ZONE, RECIPIENT, hex"01");
        vm.snapshotGasLastCall("ZoneComposer", "retry_Gas");
    }

    function test_retry_WithoutMemo() public {
        (bytes32 guid, uint256 credited) = _cacheUnroutable(false);
        router.setZonePeer(ZONE, RECIPIENT);
        composer.retry(guid, ZONE, RECIPIENT, hex"");
        assertEq(airlock.message().memo, hex"");
        assertEq(tokenB.balanceOf(address(router)), credited);
    }

    function test_retry_CallbackCannotRepeatClaim() public {
        MockReentrantComposerToken callbackToken = _useCallbackToken();
        (bytes32 guid, uint256 credited) = _cacheUnroutable(true);
        router.setZonePeer(ZONE, RECIPIENT);
        callbackToken.setCallback(
            address(composer),
            abi.encodeCall(composer.retry, (guid, ZONE, RECIPIENT, bytes(hex"01")))
        );
        composer.retry(guid, ZONE, RECIPIENT, hex"01");
        assertFalse(callbackToken.callbackSuccess());
        assertEq(callbackToken.callbackResult(), abi.encodeWithSelector(IZoneComposer.NothingToRetry.selector, guid));
        assertEq(composer.rescuableMessages(guid), 0);
        assertEq(composer.retryableMessages(guid), bytes32(0));
        assertEq(tokenB.balanceOf(address(composer)), 0);
        assertEq(tokenB.balanceOf(address(router)), credited);
    }

    function test_retry_Revert_AlreadyRetried() public {
        (bytes32 guid, uint256 credited) = _cacheUnroutable(true);
        router.setZonePeer(ZONE, RECIPIENT);
        composer.retry(guid, ZONE, RECIPIENT, hex"01");
        vm.expectRevert(abi.encodeWithSelector(IZoneComposer.NothingToRetry.selector, guid));
        composer.retry(guid, ZONE, RECIPIENT, hex"01");
        assertEq(tokenB.balanceOf(address(router)), credited);
    }

    function test_retry_Revert_AirlockThenRetry() public {
        (bytes32 guid, uint256 credited) = _cacheUnroutable(true);
        router.setZonePeer(ZONE, RECIPIENT);
        airlock.setFail(true);
        vm.expectRevert(MockGenericAirlock.Rejected.selector);
        composer.retry(guid, ZONE, RECIPIENT, hex"01");
        assertEq(composer.rescuableMessages(guid), credited);
        assertEq(composer.retryableMessages(guid), keccak256(abi.encode(ZONE, RECIPIENT, bytes(hex"01"))));
        assertEq(tokenB.balanceOf(address(composer)), credited);
        airlock.setFail(false);
        composer.retry(guid, ZONE, RECIPIENT, hex"01");
        assertEq(tokenB.balanceOf(address(router)), credited);
    }

    function test_retry_Revert_DecodeFailed() public {
        (bytes32 guid, uint256 amount) = _cache(1 ether, hex"01");
        vm.expectRevert(abi.encodeWithSelector(IZoneComposer.NothingToRetry.selector, guid));
        composer.retry(guid, 0, hex"", hex"");
        assertEq(composer.rescuableMessages(guid), amount);
    }

    function test_retry_Revert_PendingMessage() public {
        (bytes32 guid, bytes memory message, ) = _land(1 ether, _payload());
        vm.expectRevert(abi.encodeWithSelector(IZoneComposer.NothingToRetry.selector, guid));
        composer.retry(guid, ZONE, RECIPIENT, hex"");
        assertEq(endpoint.composeQueue(address(oftB), address(composer), guid, 0), keccak256(message));
    }

    function test_retry_Revert_Rescued() public {
        (bytes32 guid, uint256 credited) = _cacheUnroutable(true);
        composer.rescue(guid, user);
        router.setZonePeer(ZONE, RECIPIENT);
        vm.expectRevert(abi.encodeWithSelector(IZoneComposer.NothingToRetry.selector, guid));
        composer.retry(guid, ZONE, RECIPIENT, hex"01");
        assertEq(tokenB.balanceOf(user), credited);
        assertEq(tokenB.balanceOf(address(router)), 0);
    }

    function test_retry_Revert_UnknownGuid() public {
        bytes32 guid = bytes32(uint256(1));
        vm.expectRevert(abi.encodeWithSelector(IZoneComposer.NothingToRetry.selector, guid));
        composer.retry(guid, ZONE, RECIPIENT, hex"");
        assertEq(composer.rescuableMessages(guid), 0);
        assertEq(composer.retryableMessages(guid), bytes32(0));
    }

    function test_retry_Revert_UntrustedZonePeer() public {
        (bytes32 guid, uint256 credited) = _cacheUnroutable(true);
        vm.expectRevert(abi.encodeWithSelector(IZoneRouter.UntrustedZonePeer.selector, ZONE, bytes("")));
        composer.retry(guid, ZONE, RECIPIENT, hex"01");
        assertEq(composer.rescuableMessages(guid), credited);
        assertEq(composer.retryableMessages(guid), keccak256(abi.encode(ZONE, RECIPIENT, bytes(hex"01"))));
        assertEq(tokenB.balanceOf(address(composer)), credited);
        assertEq(tokenB.balanceOf(address(router)), 0);
    }

    function test_retry_Fuzz_Revert_WrongTransfer(uint64 _dstZone, bytes memory _recipient, bytes memory _memo) public {
        vm.assume(
            keccak256(abi.encode(_dstZone, _recipient, _memo)) != keccak256(abi.encode(ZONE, RECIPIENT, bytes(hex"01")))
        );
        (bytes32 guid, uint256 credited) = _cacheUnroutable(true);
        router.setZonePeer(ZONE, RECIPIENT);
        vm.expectRevert(abi.encodeWithSelector(IZoneComposer.NothingToRetry.selector, guid));
        composer.retry(guid, _dstZone, _recipient, _memo);
        assertEq(composer.rescuableMessages(guid), credited);
    }

    function test_rescue() public {
        (bytes32 guid, uint256 amount) = _cache(1 ether, hex"01");
        composer.rescue(guid, user);
        assertEq(tokenB.balanceOf(user), amount);
        assertEq(composer.rescuableMessages(guid), 0);
        assertEq(tokenB.balanceOf(address(composer)), 0);
    }

    function test_rescue_Gas() public {
        (bytes32 guid, uint256 amount) = _cache(1 ether, hex"01");
        vm.expectEmit(true, true, true, true, address(composer));
        emit IZoneComposer.Rescued(guid, user, amount);
        composer.rescue(guid, user);
        vm.snapshotGasLastCall("ZoneComposer", "rescue_Gas");
    }

    function test_rescue_ReentrantPendingDelivery() public {
        MockReentrantComposerToken callbackToken = _useCallbackToken();
        (bytes32 cachedGuid, ) = _cache(2 ether, hex"01");
        (bytes32 pendingGuid, bytes memory message, ) = _land(3 ether, _payload());
        callbackToken.setCallback(
            address(endpoint),
            abi.encodeCall(
                endpoint.lzCompose,
                (address(oftB), address(composer), pendingGuid, uint16(0), message, bytes(""))
            )
        );
        composer.rescue(cachedGuid, user);
        assertTrue(callbackToken.callbackSuccess());
        assertEq(tokenB.balanceOf(user), 2 ether);
        assertEq(tokenB.balanceOf(address(composer)), 0);
        assertEq(tokenB.balanceOf(address(router)), 3 ether);
        assertEq(endpoint.composeQueue(address(oftB), address(composer), pendingGuid, 0), bytes32(uint256(1)));
    }

    function test_rescue_Fuzz_OnlyCachedAmount(
        uint96 _first,
        uint96 _second,
        uint96 _pending,
        uint96 _donation
    ) public {
        (bytes32 firstGuid, uint256 first) = _cache(bound(_first, 1e12, 100 ether), hex"01");
        (bytes32 secondGuid, uint256 second) = _cache(bound(_second, 1e12, 100 ether), hex"02");
        (bytes32 pendingGuid, bytes memory message, uint256 pending) = _land(
            bound(_pending, 1e12, 100 ether),
            _payload()
        );
        uint256 donation = bound(_donation, 0, 100 ether);
        tokenB.mint(address(composer), donation);
        composer.rescue(firstGuid, user);
        assertEq(tokenB.balanceOf(address(composer)), second + pending + donation);
        composer.rescue(secondGuid, user);
        _deliver(pendingGuid, message);
        assertEq(tokenB.balanceOf(user), first + second);
        assertEq(tokenB.balanceOf(address(composer)), donation);
    }

    function test_rescue_Revert_AlreadyRescued() public {
        (bytes32 guid, ) = _cache(1 ether, hex"01");
        composer.rescue(guid, user);
        vm.expectRevert(abi.encodeWithSelector(IZoneComposer.NothingToRescue.selector, guid));
        composer.rescue(guid, user);
    }

    function test_rescue_Revert_UnroutableInsufficientBalanceThenRetry() public {
        (bytes32 guid, uint256 credited) = _cacheUnroutable(true);
        tokenB.burn(address(composer), 1);
        vm.expectRevert(
            abi.encodeWithSelector(
                IERC20Errors.ERC20InsufficientBalance.selector,
                address(composer),
                credited - 1,
                credited
            )
        );
        composer.rescue(guid, user);
        assertEq(composer.rescuableMessages(guid), credited);
        assertEq(composer.retryableMessages(guid), keccak256(abi.encode(ZONE, RECIPIENT, bytes(hex"01"))));
        tokenB.mint(address(composer), 1);
        router.setZonePeer(ZONE, RECIPIENT);
        vm.prank(user);
        composer.retry(guid, ZONE, RECIPIENT, hex"01");
        assertEq(composer.rescuableMessages(guid), 0);
        assertEq(composer.retryableMessages(guid), bytes32(0));
        assertEq(tokenB.balanceOf(address(router)), credited);
    }

    function test_rescue_Revert_Retried() public {
        (bytes32 guid, ) = _cacheUnroutable(true);
        router.setZonePeer(ZONE, RECIPIENT);
        composer.retry(guid, ZONE, RECIPIENT, hex"01");
        vm.expectRevert(abi.encodeWithSelector(IZoneComposer.NothingToRescue.selector, guid));
        composer.rescue(guid, user);
    }

    function test_rescue_Revert_InsufficientBalanceThenRetry() public {
        (bytes32 guid, uint256 cached) = _cache(2 ether, hex"01");
        tokenB.burn(address(composer), 1);
        vm.expectRevert(
            abi.encodeWithSelector(
                IERC20Errors.ERC20InsufficientBalance.selector,
                address(composer),
                cached - 1,
                cached
            )
        );
        composer.rescue(guid, user);
        assertEq(composer.rescuableMessages(guid), cached);
        tokenB.mint(address(composer), 1);
        composer.rescue(guid, user);
        assertEq(tokenB.balanceOf(user), cached);
    }

    function test_rescue_Revert_InvalidRecipient() public {
        (bytes32 guid, ) = _cache(1 ether, hex"01");
        vm.expectRevert(IZoneComposer.InvalidRescueRecipient.selector);
        composer.rescue(guid, address(0));
    }

    function test_rescue_Revert_InvalidRecipientBeforeUnknownGUID() public {
        vm.expectRevert(IZoneComposer.InvalidRescueRecipient.selector);
        composer.rescue(bytes32(0), address(0));
        vm.prank(user);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, user));
        composer.rescue(bytes32(0), address(0));
    }

    function test_rescue_Revert_NotOwner() public {
        (bytes32 guid, ) = _cache(1 ether, hex"01");
        vm.prank(user);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, user));
        composer.rescue(guid, user);
    }

    function test_rescue_RecipientSelf() public {
        (bytes32 guid, uint256 amount) = _cache(1 ether, hex"01");
        composer.rescue(guid, address(composer));
        assertEq(composer.rescuableMessages(guid), 0);
        assertEq(tokenB.balanceOf(address(composer)), amount);
    }

    function test_rescue_Revert_UnknownGUID() public {
        vm.expectRevert(abi.encodeWithSelector(IZoneComposer.NothingToRescue.selector, bytes32(0)));
        composer.rescue(bytes32(0), user);
    }

    function test_rescue_Revert_ValidPendingMessage() public {
        (bytes32 guid, bytes memory message, ) = _land(1 ether, _payload());
        vm.expectRevert(abi.encodeWithSelector(IZoneComposer.NothingToRescue.selector, guid));
        composer.rescue(guid, user);
        assertEq(endpoint.composeQueue(address(oftB), address(composer), guid, 0), keccak256(message));
    }

    function test_renounceOwnership_Revert_CannotRenounceOwnership() public {
        vm.expectRevert(IZoneComposer.CannotRenounceOwnership.selector);
        composer.renounceOwnership();
    }

    function test_decode_Fuzz(uint64 _zone, bytes memory _recipient, bytes memory _memo, bool _withMemo) public {
        _zone = uint64(bound(_zone, 1, type(uint64).max));
        vm.assume(_recipient.length > 0 && _recipient.length <= 255 && (!_withMemo || _memo.length <= 255));
        bytes memory payload = _withMemo
            ? ZoneComposerMsgCodec.encode(_zone, _recipient, _memo)
            : ZoneComposerMsgCodec.encode(_zone, _recipient);
        (uint64 zone, bytes memory recipient, bytes memory memo) = composer.decode(payload);
        assertEq(zone, _zone);
        assertEq(recipient, _recipient);
        assertEq(memo, _withMemo ? _memo : bytes(""));
    }

    function _cacheUnroutable(bool _withMemo) internal returns (bytes32 guid, uint256 credited) {
        bytes memory memo = _withMemo ? bytes(hex"01") : bytes("");
        bytes memory message;
        (guid, message, credited) = _land(
            1 ether,
            _withMemo
                ? ZoneComposerMsgCodec.encode(ZONE, RECIPIENT, memo)
                : ZoneComposerMsgCodec.encode(ZONE, RECIPIENT)
        );
        router.setZonePeer(ZONE, hex"");
        _deliver(guid, message);
        assertEq(composer.retryableMessages(guid), keccak256(abi.encode(ZONE, RECIPIENT, memo)));
    }

    function test_airlockReceive_ReturnFlow() public {
        _returnFlow();
    }

    function test_airlockReceive_ReturnFlow_AfterImplementationCodeUpdate() public {
        vm.etch(address(routerImplementation), address(new MockZoneRouterV2()).code);
        assertEq(MockZoneRouterV2(address(router)).version(), 2);
        _returnFlow();
    }

    function test_airlockReceive_ReturnFlow_LockUnlockOFT() public {
        _useLockUnlockOFT();
        _returnFlow();
    }

    function test_send_Revert_SourceRateLimit() public {
        SendParam memory sendParam = SendParam(
            B_EID,
            addressToBytes32(address(composer)),
            RESERVE + 1 ether,
            0,
            OptionsBuilder.newOptions().addExecutorLzReceiveOption(1_000_000, 0),
            _payload(),
            ""
        );
        MessagingFee memory fee = oftA.quoteSend(sendParam, false);
        vm.prank(user);
        vm.expectRevert(abi.encodeWithSelector(IRateLimiter.RateLimitExceeded.selector, RESERVE, RESERVE + 1 ether));
        oftA.send{ value: fee.nativeFee }(sendParam, fee, user);
        assertEq(tokenA.balanceOf(user), RESERVE);
        assertEq(tokenB.balanceOf(address(composer)), 0);
    }
}
