// SPDX-License-Identifier: MIT
pragma solidity ^0.8.22;

import { IMessagingComposer } from "@layerzerolabs/lz-evm-protocol-v2/contracts/interfaces/IMessagingComposer.sol";
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
import { OFTNativeExtendedRBACUpgradeable } from "@layerzerolabs/oft-upgradeable-evm-contracts/contracts/extended/OFTNativeExtendedRBACUpgradeable.sol";
import { EndpointV2Mock } from "@layerzerolabs/test-devtools-evm-foundry/contracts/mocks/EndpointV2Mock.sol";
import { TestHelperOz5 } from "@layerzerolabs/test-devtools-evm-foundry/contracts/TestHelperOz5.sol";
import { MockBurnerMinter } from "@layerzerolabs/test-utils-evm-contracts/contracts/mocks/MockBurnerMinter.sol";
import { MockERC20 } from "@layerzerolabs/test-utils-evm-contracts/contracts/mocks/MockERC20.sol";
import { IAllowlist } from "@layerzerolabs/utils-evm-contracts/contracts/interfaces/IAllowlist.sol";
import { ICreditRedirect } from "@layerzerolabs/utils-evm-contracts/contracts/interfaces/ICreditRedirect.sol";
import { IRateLimiter } from "@layerzerolabs/utils-evm-contracts/contracts/interfaces/IRateLimiter.sol";
import { AllowlistRBACUpgradeable } from "@layerzerolabs/utils-upgradeable-evm-contracts/contracts/allowlist/AllowlistRBACUpgradeable.sol";
import { IAirlock } from "@layerzerolabs/zone-router-evm-contracts/contracts/interfaces/IAirlock.sol";
import { Ownable } from "@openzeppelin/contracts/access/Ownable.sol";
import { Ownable2Step } from "@openzeppelin/contracts/access/Ownable2Step.sol";
import { TransparentUpgradeableProxy } from "@openzeppelin/contracts/proxy/transparent/TransparentUpgradeableProxy.sol";
import { Address } from "@openzeppelin/contracts/utils/Address.sol";
import { IZoneComposer } from "../../contracts/interfaces/IZoneComposer.sol";
import { IZoneComposerNative } from "../../contracts/interfaces/IZoneComposerNative.sol";
import { ZoneComposerMsgCodec } from "../../contracts/libs/ZoneComposerMsgCodec.sol";
import { ZoneComposerNative } from "../../contracts/ZoneComposerNative.sol";

contract AllowlistRBACUpgradeableHarness is AllowlistRBACUpgradeable {
    constructor() {
        _disableInitializers();
    }

    function initialize(AllowlistMode _mode) public initializer {
        __AllowlistBase_init(_mode);
        __AccessControl2Step_init(msg.sender);
    }
}

contract MockOFTConfig {
    address public immutable endpoint;
    address public immutable token;

    constructor(address _endpoint, address _token) {
        endpoint = _endpoint;
        token = _token;
    }
}

contract MockAirlock {
    uint64 public dstZone;
    bytes public recipient;
    bytes public memo;
    uint256 public amount;
    uint64 public nonce;
    bool public fail;
    bool public failQuery;
    mapping(uint64 => bool) internal activeZones;

    event ZroSent(
        uint64 indexed dstZone,
        uint64 nonce,
        address indexed sender,
        bytes recipient,
        uint256 value,
        bytes memo
    );

    error Rejected();
    error InvalidAddressLength(uint8 argument, uint256 length);
    error MemoTooLong(uint256 length, uint256 max);
    error InvalidPeerZone(uint64 zone);
    error InactiveZone(uint64 zone);

    function setFail(bool _fail) external {
        fail = _fail;
    }

    function setZoneActive(uint64 _zone, bool _active) external {
        activeZones[_zone] = _active;
    }

    function setQueryFail(bool _fail) external {
        failQuery = _fail;
    }

    function isActiveZone(uint64 _zone) external view returns (bool active) {
        if (failQuery) revert Rejected();
        return _zone != 0 && activeZones[_zone];
    }

    function sendZro(
        uint64 _dstZone,
        bytes calldata _recipient,
        bytes calldata _memo
    ) external payable returns (uint64) {
        if (fail) revert Rejected();
        if (_dstZone == 0) revert InvalidPeerZone(_dstZone);
        if (_recipient.length == 0 || _recipient.length > 255) revert InvalidAddressLength(3, _recipient.length);
        if (_memo.length > 255) revert MemoTooLong(_memo.length, 255);
        if (!activeZones[_dstZone]) revert InactiveZone(_dstZone);
        dstZone = _dstZone;
        recipient = _recipient;
        memo = _memo;
        amount = msg.value;
        emit MockAirlock.ZroSent(_dstZone, ++nonce, msg.sender, _recipient, msg.value, _memo);
        return nonce;
    }
}

contract MockRejectingRecipient {
    receive() external payable {
        revert();
    }
}

contract ZoneComposerNativeTest is TestHelperOz5 {
    using OptionsBuilder for bytes;

    uint32 internal constant A_EID = 1;
    uint32 internal constant B_EID = 2;
    uint256 internal constant RESERVE = 1_000 ether;
    bytes internal constant RECIPIENT = hex"000000000000000000000000000000000000beef";

    MockERC20 internal tokenA;
    OFTBurnMintExtendedRBACUpgradeable internal oftA;
    OFTNativeExtendedRBACUpgradeable internal oftB;
    ZoneComposerNative internal composer;
    EndpointV2Mock internal endpoint;
    MockAirlock internal airlock;
    address internal user = makeAddr("user");
    address internal proxyOwner = makeAddr("proxyOwner");

    function setUp() public override {
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
        oftB = _deployNativeOFT(B_EID);
        oftA.setPeer(B_EID, addressToBytes32(address(oftB)));
        oftB.setPeer(A_EID, addressToBytes32(address(oftA)));
        composer = new ZoneComposerNative(address(this), address(oftB));
        endpoint = EndpointV2Mock(endpoints[B_EID]);
        MockAirlock implementation = new MockAirlock();
        vm.etch(address(composer.ROUTER()), address(implementation).code);
        airlock = MockAirlock(address(composer.ROUTER()));
        airlock.setZoneActive(1, true);
        vm.deal(address(oftB), RESERVE);
        vm.deal(user, RESERVE);
        vm.deal(address(this), RESERVE);
    }

    function test_constructor() public view {
        assertEq(composer.OFT(), address(oftB));
        assertEq(composer.ENDPOINT(), address(endpoint));
        assertEq(oftB.token(), address(0));
        assertEq(composer.owner(), address(this));
        assertTrue(oftB.hasRole(oftB.DEFAULT_ADMIN_ROLE(), address(this)));
        assertEq(composer.TOKEN(), address(0));
        assertEq(composer.ROUTER(), address(0x0a1a));
    }

    function test_constructor_NoAirlockGetter() public view {
        (bool success, bytes memory result) = address(composer).staticcall(abi.encodeWithSignature("AIRLOCK()"));
        assertFalse(success);
        assertEq(result, bytes(""));
    }

    function test_constructor_Revert_ZeroOFT() public {
        vm.expectRevert(IZoneComposer.InvalidOFT.selector);
        new ZoneComposerNative(address(this), address(0));
    }

    function test_constructor_Revert_NonNativeOFT() public {
        MockOFTConfig nonNative = new MockOFTConfig(address(endpoint), address(1));
        vm.expectRevert(IZoneComposer.InvalidOFT.selector);
        new ZoneComposerNative(address(this), address(nonNative));
    }

    function test_constructor_Revert_ZeroEndpoint() public {
        MockOFTConfig invalid = new MockOFTConfig(address(0), address(0));
        vm.expectRevert(IZoneComposer.InvalidEndpoint.selector);
        new ZoneComposerNative(address(this), address(invalid));
    }

    function test_constructor_Revert_ZeroOwner() public {
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableInvalidOwner.selector, address(0)));
        new ZoneComposerNative(address(0), address(oftB));
    }

    function test_receive() public {
        _land(1 ether, _payload());
        assertEq(address(composer).balance, 1 ether);
        assertEq(address(oftB).balance, RESERVE - 1 ether);
        assertEq(address(airlock).balance, 0);
    }

    function test_receive_Revert_OnlyOFT() public {
        vm.expectRevert(abi.encodeWithSelector(IZoneComposer.OnlyOFT.selector, address(this)));
        Address.sendValue(payable(address(composer)), 1 ether);
        assertEq(address(composer).balance, 0);
    }

    function test_lzCompose() public {
        (bytes32 guid, bytes memory message, ) = _land(1 ether, _payload());
        vm.expectEmit(true, true, true, true, address(airlock));
        emit MockAirlock.ZroSent(1, 1, address(composer), RECIPIENT, 1 ether, bytes(""));
        vm.expectEmit(true, true, true, true, address(composer));
        emit IZoneComposer.Sent(guid, 1, 1);
        vm.expectEmit(true, true, true, true, address(endpoint));
        emit IMessagingComposer.ComposeDelivered(address(oftB), address(composer), guid, 0);
        _deliver(guid, message);
        assertEq(address(composer).balance, 0);
        assertEq(address(airlock).balance, 1 ether);
        assertEq(endpoint.composeQueue(address(oftB), address(composer), guid, 0), bytes32(uint256(1)));
    }

    function test_lzCompose_Gas_EndpointDelivery_WithMemo() public {
        bytes memory memo = abi.encode(uint256(1), uint256(2));
        (bytes32 guid, bytes memory message, ) = _land(1 ether, ZoneComposerMsgCodec.encode(1, RECIPIENT, memo));
        vm.expectEmit(true, true, true, true, address(airlock));
        emit MockAirlock.ZroSent(1, 1, address(composer), RECIPIENT, 1 ether, memo);
        _deliver(guid, message);
        vm.snapshotGasLastCall("ZoneComposerNative", "lzCompose_Gas_EndpointDelivery_WithMemo");
    }

    function test_lzCompose_Gas_EndpointDelivery_WithoutMemo() public {
        (bytes32 guid, bytes memory message, ) = _land(1 ether, ZoneComposerMsgCodec.encode(1, RECIPIENT));
        vm.expectEmit(true, true, true, true, address(airlock));
        emit MockAirlock.ZroSent(1, 1, address(composer), RECIPIENT, 1 ether, bytes(""));
        _deliver(guid, message);
        vm.snapshotGasLastCall("ZoneComposerNative", "lzCompose_Gas_EndpointDelivery_WithoutMemo");
    }

    function test_lzCompose_AddressAndMemoBounds() public {
        bytes memory recipient = new bytes(255);
        bytes memory memo = new bytes(255);
        (bytes32 guid, bytes memory message, ) = _land(1 ether, ZoneComposerMsgCodec.encode(1, recipient, memo));
        _deliver(guid, message);
        assertEq(airlock.recipient(), recipient);
        assertEq(airlock.memo(), memo);
        (guid, message, ) = _land(1 ether, ZoneComposerMsgCodec.encode(1, hex"01", bytes("")));
        _deliver(guid, message);
        assertEq(airlock.recipient(), hex"01");
        assertEq(airlock.memo(), bytes(""));
    }

    function test_lzCompose_PendingCreditsInReverseOrder() public {
        (bytes32 firstGuid, bytes memory firstMessage, ) = _land(2 ether, _payload());
        (bytes32 secondGuid, bytes memory secondMessage, ) = _land(3 ether, _payload());
        _deliver(secondGuid, secondMessage);
        assertEq(address(composer).balance, 2 ether);
        assertEq(address(airlock).balance, 3 ether);
        _deliver(firstGuid, firstMessage);
        assertEq(address(composer).balance, 0);
        assertEq(address(airlock).balance, 5 ether);
        assertEq(airlock.nonce(), 2);
    }

    function test_lzCompose_PrecompileWithNoBytecode() public {
        (bytes32 guid, bytes memory message, ) = _land(1 ether, _payload());
        bytes memory callData = abi.encodeCall(IAirlock.sendZro, (uint64(1), RECIPIENT, bytes("")));
        vm.mockCall(address(airlock), 1 ether, callData, abi.encode(uint64(1)));
        vm.mockCall(address(airlock), abi.encodeCall(IAirlock.isActiveZone, (uint64(1))), abi.encode(true));
        vm.etch(address(airlock), "");
        assertEq(address(airlock).code.length, 0);
        vm.expectCall(address(airlock), 1 ether, callData);
        _deliver(guid, message);
        assertEq(endpoint.composeQueue(address(oftB), address(composer), guid, 0), bytes32(uint256(1)));
    }

    function test_lzCompose_WithoutMemo() public {
        (bytes32 guid, bytes memory message, ) = _land(1 ether, ZoneComposerMsgCodec.encode(1, RECIPIENT));
        _deliver(guid, message);
        assertEq(airlock.recipient(), RECIPIENT);
        assertEq(airlock.memo(), bytes(""));
        assertEq(address(composer).balance, 0);
        assertEq(address(airlock).balance, 1 ether);
    }

    function test_lzCompose_InactiveZoneOneThenRetry() public {
        airlock.setZoneActive(1, false);
        (bytes32 guid, bytes memory message, uint256 credited) = _land(1 ether, _payload());
        vm.expectEmit(true, true, true, true, address(composer));
        emit IZoneComposer.UnroutableZone(guid, 1, RECIPIENT, bytes(""));
        _deliver(guid, message);
        assertEq(composer.rescuableMessages(guid), credited);
        assertEq(composer.retryableMessages(guid), keccak256(abi.encode(uint64(1), RECIPIENT, bytes(""))));
        assertEq(endpoint.composeQueue(address(oftB), address(composer), guid, 0), bytes32(uint256(1)));
        assertEq(airlock.nonce(), 0);
        airlock.setZoneActive(1, true);
        composer.retry(guid, 1, RECIPIENT, hex"");
        assertEq(airlock.dstZone(), 1);
        assertEq(airlock.amount(), credited);
        assertEq(composer.rescuableMessages(guid), 0);
        assertEq(composer.retryableMessages(guid), bytes32(0));
    }

    function test_lzCompose_Fuzz_ActiveZone(bool _withMemo) public {
        airlock.setZoneActive(999, true);
        bytes memory memo = _withMemo ? bytes(hex"01") : bytes("");
        bytes memory payload = _withMemo
            ? ZoneComposerMsgCodec.encode(999, RECIPIENT, memo)
            : ZoneComposerMsgCodec.encode(999, RECIPIENT);
        (bytes32 guid, bytes memory message, uint256 credited) = _land(1 ether, payload);
        _deliver(guid, message);
        assertEq(airlock.dstZone(), 999);
        assertEq(airlock.recipient(), RECIPIENT);
        assertEq(airlock.memo(), memo);
        assertEq(airlock.amount(), credited);
        assertEq(composer.rescuableMessages(guid), 0);
        assertEq(address(composer).balance, 0);
        assertEq(endpoint.composeQueue(address(oftB), address(composer), guid, 0), bytes32(uint256(1)));
    }

    function test_lzCompose_Fuzz_UnroutableZone(bool _withMemo, bool _previouslyActive) public {
        if (_previouslyActive) {
            airlock.setZoneActive(999, true);
            airlock.setZoneActive(999, false);
        }
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
        assertEq(address(composer).balance, credited);
        assertEq(address(airlock).balance, 0);
        assertEq(airlock.nonce(), 0);
        airlock.setZoneActive(999, true);
        vm.expectRevert(
            abi.encodeWithSelector(Errors.LZ_ComposeNotFound.selector, bytes32(uint256(1)), keccak256(message))
        );
        _deliver(guid, message);
        vm.prank(user);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, user));
        composer.rescue(guid, user);
        address rejectingRecipient = address(new MockRejectingRecipient());
        vm.expectRevert(IZoneComposerNative.NativeTransferFailed.selector);
        composer.rescue(guid, rejectingRecipient);
        assertEq(composer.rescuableMessages(guid), credited);
        assertEq(composer.retryableMessages(guid), keccak256(abi.encode(uint64(999), RECIPIENT, memo)));
        uint256 balance = user.balance;
        composer.rescue(guid, user);
        assertEq(composer.rescuableMessages(guid), 0);
        assertEq(composer.retryableMessages(guid), bytes32(0));
        assertEq(user.balance, balance + credited);
    }

    function test_lzCompose_Fuzz_Revert_ZoneQueryThenRetry(bool _withMemo, bool _malformedReturn) public {
        bytes memory payload = _withMemo
            ? ZoneComposerMsgCodec.encode(1, RECIPIENT, bytes(hex"01"))
            : ZoneComposerMsgCodec.encode(1, RECIPIENT);
        (bytes32 guid, bytes memory message, uint256 credited) = _land(1 ether, payload);
        if (_malformedReturn) {
            vm.mockCall(address(airlock), abi.encodeCall(IAirlock.isActiveZone, (uint64(1))), hex"01");
            vm.expectRevert(bytes(""));
        } else {
            airlock.setQueryFail(true);
            vm.expectRevert(MockAirlock.Rejected.selector);
        }
        _deliver(guid, message);
        assertEq(endpoint.composeQueue(address(oftB), address(composer), guid, 0), keccak256(message));
        assertEq(composer.rescuableMessages(guid), 0);
        assertEq(address(composer).balance, credited);
        assertEq(address(airlock).balance, 0);
        vm.clearMockedCalls();
        airlock.setQueryFail(false);
        _deliver(guid, message);
        assertEq(address(composer).balance, 0);
        assertEq(address(airlock).balance, credited);
    }

    function test_lzCompose_Fuzz_Revert_UnknownZoneThenRetry(bool _withMemo) public {
        bytes memory payload = _withMemo
            ? ZoneComposerMsgCodec.encode(999, RECIPIENT, bytes(hex"01"))
            : ZoneComposerMsgCodec.encode(999, RECIPIENT);
        (bytes32 guid, bytes memory message, uint256 credited) = _land(1 ether, payload);
        vm.mockCall(address(airlock), abi.encodeCall(IAirlock.isActiveZone, (uint64(999))), abi.encode(true));
        vm.expectRevert(abi.encodeWithSelector(MockAirlock.InactiveZone.selector, uint64(999)));
        _deliver(guid, message);
        assertEq(endpoint.composeQueue(address(oftB), address(composer), guid, 0), keccak256(message));
        assertEq(composer.rescuableMessages(guid), 0);
        assertEq(address(composer).balance, credited);
        assertEq(address(airlock).balance, 0);
        assertEq(airlock.nonce(), 0);
        vm.clearMockedCalls();
        airlock.setZoneActive(999, true);
        _deliver(guid, message);
        assertEq(address(airlock).balance, credited);
        assertEq(address(composer).balance, 0);
    }

    function test_lzCompose_SourceDust() public {
        (bytes32 guid, bytes memory message, uint256 credited) = _land(1 ether + 1, _payload());
        assertEq(credited, 1 ether);
        _deliver(guid, message);
        assertEq(airlock.amount(), credited);
        assertEq(address(airlock).balance, credited);
        assertEq(address(composer).balance, 0);
    }

    function test_lzCompose_DecodeFailed_ShortPayload() public {
        _cache(1 ether, hex"01");
    }

    function test_lzCompose_DecodeFailed_LongPayload() public {
        _cache(1 ether, new bytes(129));
    }

    function test_lzCompose_DecodeFailed_NonCanonicalZone() public {
        _cache(1 ether, abi.encode(type(uint256).max, RECIPIENT, bytes("")));
    }

    function test_lzCompose_Gas_EndpointDelivery_DecodeFailed() public {
        (bytes32 guid, bytes memory message, ) = _land(1 ether, hex"01");
        vm.expectEmit(true, true, true, true, address(composer));
        emit IZoneComposer.DecodeFailed(guid, hex"01");
        _deliver(guid, message);
        vm.snapshotGasLastCall("ZoneComposerNative", "lzCompose_Gas_EndpointDelivery_DecodeFailed");
    }

    function test_lzCompose_Gas_EndpointDelivery_UnroutableZone() public {
        (bytes32 guid, bytes memory message, ) = _land(1 ether, ZoneComposerMsgCodec.encode(999, RECIPIENT));
        vm.expectEmit(true, true, true, true, address(composer));
        emit IZoneComposer.UnroutableZone(guid, 999, RECIPIENT, bytes(""));
        _deliver(guid, message);
        vm.snapshotGasLastCall("ZoneComposerNative", "lzCompose_Gas_EndpointDelivery_UnroutableZone");
    }

    function test_lzCompose_Fuzz_ExactReceivedAmount(
        uint96 _amount,
        uint96 _pending,
        uint64 _zone,
        bytes memory _recipient,
        bytes memory _memo,
        bool _withMemo
    ) public {
        _recipient = abi.encodePacked(keccak256(_recipient));
        _memo = abi.encodePacked(keccak256(_memo));
        uint256 amount = bound(_amount, 1e12, 100 ether);
        uint256 pending = bound(_pending, 1e12, 100 ether);
        _zone = uint64(bound(_zone, 1, type(uint64).max));
        airlock.setZoneActive(_zone, true);
        bytes memory payload = _withMemo
            ? ZoneComposerMsgCodec.encode(_zone, _recipient, _memo)
            : ZoneComposerMsgCodec.encode(_zone, _recipient);
        (, , uint256 pendingCredit) = _land(pending, _payload());
        (bytes32 guid, bytes memory message, uint256 credited) = _land(amount, payload);
        _deliver(guid, message);
        assertEq(airlock.amount(), credited);
        assertEq(airlock.dstZone(), _zone);
        assertEq(airlock.recipient(), _recipient);
        assertEq(airlock.memo(), _withMemo ? _memo : bytes(""));
        assertEq(address(airlock).balance, credited);
        assertEq(address(composer).balance, pendingCredit);
        assertEq(address(oftB).balance, RESERVE - pendingCredit - credited);
    }

    function test_lzCompose_Fuzz_DecodeFailed_ZeroFilled(uint16 _length) public {
        uint256 length = bound(_length, 1, 256);
        _cache(1 ether, new bytes(length));
    }

    function test_lzCompose_Revert_OnlyEndpoint() public {
        vm.expectRevert(abi.encodeWithSelector(IZoneComposer.OnlyEndpoint.selector, address(this)));
        composer.lzCompose(address(oftB), bytes32(0), _message(1, hex"01"), address(this), "");
        assertEq(composer.rescuableMessages(bytes32(0)), 0);
    }

    function test_lzCompose_Revert_OnlyOFT() public {
        bytes memory message = _message(1, hex"01");
        endpoint.sendCompose(address(composer), bytes32(0), 0, message);
        vm.expectRevert(abi.encodeWithSelector(IZoneComposer.OnlyOFT.selector, address(this)));
        endpoint.lzCompose(address(this), address(composer), bytes32(0), 0, message, "");
        assertEq(composer.rescuableMessages(bytes32(0)), 0);
    }

    function test_lzCompose_Revert_UnexpectedValueThenRetry() public {
        (bytes32 guid, bytes memory message, ) = _land(1 ether, _payload());
        vm.expectRevert(abi.encodeWithSelector(IZoneComposer.UnexpectedValue.selector, 1));
        endpoint.lzCompose{ value: 1 }(address(oftB), address(composer), guid, 0, message, "");
        assertEq(address(composer).balance, 1 ether);
        assertEq(endpoint.composeQueue(address(oftB), address(composer), guid, 0), keccak256(message));
        _deliver(guid, message);
        assertEq(address(composer).balance, 0);
    }

    function test_lzCompose_Revert_Replay() public {
        (bytes32 guid, bytes memory message, ) = _land(1 ether, _payload());
        _deliver(guid, message);
        vm.expectRevert(
            abi.encodeWithSelector(Errors.LZ_ComposeNotFound.selector, bytes32(uint256(1)), keccak256(message))
        );
        _deliver(guid, message);
        assertEq(airlock.nonce(), 1);
        assertEq(address(airlock).balance, 1 ether);
    }

    function test_lzCompose_Fuzz_Revert_AirlockThenRetry(bool _withMemo) public {
        bytes memory payload = _withMemo
            ? ZoneComposerMsgCodec.encode(1, RECIPIENT, bytes(hex"01"))
            : ZoneComposerMsgCodec.encode(1, RECIPIENT);
        (bytes32 guid, bytes memory message, ) = _land(1 ether, payload);
        airlock.setFail(true);
        vm.expectRevert(MockAirlock.Rejected.selector);
        _deliver(guid, message);
        assertEq(address(composer).balance, 1 ether);
        assertEq(endpoint.composeQueue(address(oftB), address(composer), guid, 0), keccak256(message));
        airlock.setFail(false);
        _deliver(guid, message);
        assertEq(address(composer).balance, 0);
        assertEq(address(airlock).balance, 1 ether);
    }

    function test_lzCompose_Fuzz_DecodeFailed_EmptyRecipient(bool _withMemo) public {
        bytes memory payload = _withMemo
            ? ZoneComposerMsgCodec.encode(1, bytes(""), bytes(""))
            : ZoneComposerMsgCodec.encode(1, bytes(""));
        (bytes32 guid, uint256 credited) = _cache(1 ether, payload);
        uint256 balance = user.balance;
        composer.rescue(guid, user);
        assertEq(user.balance, balance + credited);
        assertEq(composer.rescuableMessages(guid), 0);
    }

    function test_lzCompose_Fuzz_DecodeFailed_OversizedRecipient(bool _withMemo) public {
        bytes memory payload = _withMemo
            ? ZoneComposerMsgCodec.encode(1, new bytes(256), bytes(""))
            : ZoneComposerMsgCodec.encode(1, new bytes(256));
        (bytes32 guid, uint256 credited) = _cache(1 ether, payload);
        uint256 balance = user.balance;
        composer.rescue(guid, user);
        assertEq(user.balance, balance + credited);
        assertEq(composer.rescuableMessages(guid), 0);
    }

    function test_lzCompose_DecodeFailed_OversizedMemo() public {
        (bytes32 guid, uint256 credited) = _cache(1 ether, ZoneComposerMsgCodec.encode(1, RECIPIENT, new bytes(256)));
        uint256 balance = user.balance;
        composer.rescue(guid, user);
        assertEq(user.balance, balance + credited);
        assertEq(composer.rescuableMessages(guid), 0);
    }

    function test_lzCompose_Fuzz_DecodeFailed_ZeroZone(bool _withMemo) public {
        bytes memory payload = _withMemo
            ? ZoneComposerMsgCodec.encode(0, RECIPIENT, bytes(""))
            : ZoneComposerMsgCodec.encode(0, RECIPIENT);
        (bytes32 guid, uint256 credited) = _cache(1 ether, payload);
        uint256 balance = user.balance;
        composer.rescue(guid, user);
        assertEq(user.balance, balance + credited);
        assertEq(composer.rescuableMessages(guid), 0);
    }

    function test_lzCompose_Revert_ZeroCreditRedirectedToEscrow() public {
        _land(2 ether, _payload());
        AllowlistRBACUpgradeableHarness implementation = new AllowlistRBACUpgradeableHarness();
        address allowlist = address(
            new TransparentUpgradeableProxy(
                address(implementation),
                proxyOwner,
                abi.encodeCall(AllowlistRBACUpgradeableHarness.initialize, (IAllowlist.AllowlistMode.Whitelist))
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
        assertEq(escrow.balance, 1 ether);
        assertEq(address(oftB).balance, RESERVE - 3 ether);
        assertEq(address(composer).balance, 2 ether);
        assertEq(endpoint.composeQueue(address(oftB), address(composer), receipt.guid, 0), keccak256(message));
        vm.expectRevert(IZoneComposer.ZeroAmount.selector);
        _deliver(receipt.guid, message);
        assertEq(address(composer).balance, 2 ether);
        assertEq(address(airlock).balance, 0);
    }

    function test_lzCompose_Fuzz_Revert_TruncatedHeader(uint8 _length) public {
        uint256 length = bound(_length, 0, 75);
        bytes memory fullMessage = _message(1, hex"01");
        bytes memory message = new bytes(length);
        for (uint256 i; i < length; ++i) message[i] = fullMessage[i];
        vm.prank(address(endpoint));
        vm.expectRevert(bytes(""));
        composer.lzCompose(address(oftB), bytes32(0), message, address(this), "");
        assertEq(composer.rescuableMessages(bytes32(0)), 0);
    }

    function test_retry() public {
        (bytes32 guid, uint256 credited) = _cacheUnroutable(true);
        airlock.setZoneActive(999, true);
        vm.expectEmit(true, true, true, true, address(airlock));
        emit MockAirlock.ZroSent(999, 1, address(composer), RECIPIENT, credited, hex"01");
        vm.expectEmit(true, true, true, true, address(composer));
        emit IZoneComposer.Sent(guid, 999, 1);
        vm.expectEmit(true, true, true, true, address(composer));
        emit IZoneComposer.Retried(guid);
        vm.prank(user);
        composer.retry(guid, 999, RECIPIENT, hex"01");
        assertEq(composer.rescuableMessages(guid), 0);
        assertEq(composer.retryableMessages(guid), bytes32(0));
        assertEq(address(composer).balance, 0);
        assertEq(address(airlock).balance, credited);
    }

    function test_retry_Gas() public {
        (bytes32 guid, uint256 credited) = _cacheUnroutable(true);
        airlock.setZoneActive(999, true);
        vm.expectEmit(true, true, true, true, address(airlock));
        emit MockAirlock.ZroSent(999, 1, address(composer), RECIPIENT, credited, hex"01");
        composer.retry(guid, 999, RECIPIENT, hex"01");
        vm.snapshotGasLastCall("ZoneComposerNative", "retry_Gas");
    }

    function test_retry_WithoutMemo() public {
        (bytes32 guid, uint256 credited) = _cacheUnroutable(false);
        airlock.setZoneActive(999, true);
        composer.retry(guid, 999, RECIPIENT, hex"");
        assertEq(airlock.memo(), hex"");
        assertEq(airlock.amount(), credited);
    }

    function test_retry_Fuzz_OnlyCachedAmount(uint96 _amount, uint96 _pending, uint96 _donation) public {
        (bytes32 pendingGuid, bytes memory pendingMessage, uint256 pending) = _land(
            bound(_pending, 1e12, 100 ether),
            _payload()
        );
        (bytes32 guid, bytes memory message, uint256 credited) = _land(
            bound(_amount, 1e12, 100 ether),
            ZoneComposerMsgCodec.encode(999, RECIPIENT)
        );
        _deliver(guid, message);
        uint256 donation = bound(_donation, 0, 100 ether);
        vm.deal(address(composer), address(composer).balance + donation);
        airlock.setZoneActive(999, true);
        composer.retry(guid, 999, RECIPIENT, hex"");
        assertEq(airlock.amount(), credited);
        assertEq(address(airlock).balance, credited);
        assertEq(address(composer).balance, pending + donation);
        _deliver(pendingGuid, pendingMessage);
        assertEq(address(airlock).balance, credited + pending);
        assertEq(address(composer).balance, donation);
    }

    function test_retry_Revert_AlreadyRetried() public {
        (bytes32 guid, uint256 credited) = _cacheUnroutable(true);
        airlock.setZoneActive(999, true);
        composer.retry(guid, 999, RECIPIENT, hex"01");
        vm.expectRevert(abi.encodeWithSelector(IZoneComposer.NothingToRetry.selector, guid));
        composer.retry(guid, 999, RECIPIENT, hex"01");
        assertEq(airlock.nonce(), 1);
        assertEq(address(airlock).balance, credited);
    }

    function test_retry_Revert_AirlockThenRetry() public {
        (bytes32 guid, uint256 credited) = _cacheUnroutable(true);
        airlock.setZoneActive(999, true);
        airlock.setFail(true);
        vm.expectRevert(MockAirlock.Rejected.selector);
        composer.retry(guid, 999, RECIPIENT, hex"01");
        assertEq(composer.rescuableMessages(guid), credited);
        assertEq(composer.retryableMessages(guid), keccak256(abi.encode(uint64(999), RECIPIENT, bytes(hex"01"))));
        assertEq(address(composer).balance, credited);
        airlock.setFail(false);
        composer.retry(guid, 999, RECIPIENT, hex"01");
        assertEq(address(airlock).balance, credited);
    }

    function test_retry_Revert_DecodeFailed() public {
        (bytes32 guid, uint256 amount) = _cache(1 ether, hex"01");
        vm.expectRevert(abi.encodeWithSelector(IZoneComposer.NothingToRetry.selector, guid));
        composer.retry(guid, 0, hex"", hex"");
        assertEq(composer.rescuableMessages(guid), amount);
    }

    function test_retry_Revert_Rescued() public {
        (bytes32 guid, uint256 credited) = _cacheUnroutable(true);
        uint256 balance = user.balance;
        composer.rescue(guid, user);
        airlock.setZoneActive(999, true);
        vm.expectRevert(abi.encodeWithSelector(IZoneComposer.NothingToRetry.selector, guid));
        composer.retry(guid, 999, RECIPIENT, hex"01");
        assertEq(user.balance, balance + credited);
        assertEq(address(airlock).balance, 0);
    }

    function test_retry_Revert_InactiveZone() public {
        (bytes32 guid, uint256 credited) = _cacheUnroutable(true);
        vm.expectRevert(abi.encodeWithSelector(MockAirlock.InactiveZone.selector, uint64(999)));
        composer.retry(guid, 999, RECIPIENT, hex"01");
        assertEq(composer.rescuableMessages(guid), credited);
        assertEq(composer.retryableMessages(guid), keccak256(abi.encode(uint64(999), RECIPIENT, bytes(hex"01"))));
        assertEq(address(composer).balance, credited);
        assertEq(airlock.nonce(), 0);
    }

    function test_retry_Fuzz_Revert_WrongTransfer(uint64 _dstZone, bytes memory _recipient, bytes memory _memo) public {
        vm.assume(
            keccak256(abi.encode(_dstZone, _recipient, _memo)) !=
                keccak256(abi.encode(uint64(999), RECIPIENT, bytes(hex"01")))
        );
        (bytes32 guid, uint256 credited) = _cacheUnroutable(true);
        airlock.setZoneActive(999, true);
        vm.expectRevert(abi.encodeWithSelector(IZoneComposer.NothingToRetry.selector, guid));
        composer.retry(guid, _dstZone, _recipient, _memo);
        assertEq(composer.rescuableMessages(guid), credited);
    }

    function test_rescue() public {
        (bytes32 guid, uint256 amount) = _cache(1 ether, hex"01");
        uint256 balance = user.balance;
        vm.expectEmit(true, true, true, true, address(composer));
        emit IZoneComposer.Rescued(guid, user, amount);
        composer.rescue(guid, user);
        assertEq(user.balance, balance + amount);
        assertEq(composer.rescuableMessages(guid), 0);
        assertEq(address(composer).balance, 0);
    }

    function test_rescue_Gas() public {
        (bytes32 guid, uint256 amount) = _cache(1 ether, hex"01");
        vm.expectEmit(true, true, true, true, address(composer));
        emit IZoneComposer.Rescued(guid, user, amount);
        composer.rescue(guid, user);
        vm.snapshotGasLastCall("ZoneComposerNative", "rescue_Gas");
    }

    function test_rescue_Fuzz_OnlyCachedAmount(
        uint96 _first,
        uint96 _second,
        uint96 _pending,
        uint96 _donation
    ) public {
        (bytes32 firstGuid, uint256 firstAmount) = _cache(bound(_first, 1e12, 100 ether), hex"01");
        (bytes32 secondGuid, uint256 secondAmount) = _cache(bound(_second, 1e12, 100 ether), new bytes(129));
        (bytes32 pendingGuid, bytes memory pendingMessage, uint256 pendingAmount) = _land(
            bound(_pending, 1e12, 100 ether),
            _payload()
        );
        uint256 donation = bound(_donation, 0, 100 ether);
        vm.deal(address(composer), address(composer).balance + donation);
        uint256 balance = user.balance;
        composer.rescue(firstGuid, user);
        assertEq(user.balance, balance + firstAmount);
        assertEq(address(composer).balance, secondAmount + pendingAmount + donation);
        assertEq(composer.rescuableMessages(firstGuid), 0);
        assertEq(composer.rescuableMessages(secondGuid), secondAmount);
        assertEq(endpoint.composeQueue(address(oftB), address(composer), pendingGuid, 0), keccak256(pendingMessage));
        composer.rescue(secondGuid, user);
        _deliver(pendingGuid, pendingMessage);
        assertEq(user.balance, balance + firstAmount + secondAmount);
        assertEq(address(airlock).balance, pendingAmount);
        assertEq(address(composer).balance, donation);
    }

    function test_rescue_Revert_InvalidRecipientBeforeUnknownGUID() public {
        vm.expectRevert(IZoneComposer.InvalidRescueRecipient.selector);
        composer.rescue(bytes32(0), address(0));
        vm.prank(user);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, user));
        composer.rescue(bytes32(0), address(0));
    }

    function test_rescue_Revert_NotOwner() public {
        (bytes32 guid, uint256 amount) = _cache(1 ether, hex"01");
        vm.prank(user);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, user));
        composer.rescue(guid, user);
        assertEq(composer.rescuableMessages(guid), amount);
    }

    function test_rescue_Revert_UnknownGUID() public {
        vm.expectRevert(abi.encodeWithSelector(IZoneComposer.NothingToRescue.selector, bytes32(0)));
        composer.rescue(bytes32(0), user);
    }

    function test_rescue_Revert_AlreadyRescued() public {
        (bytes32 guid, ) = _cache(1 ether, hex"01");
        composer.rescue(guid, user);
        vm.expectRevert(abi.encodeWithSelector(IZoneComposer.NothingToRescue.selector, guid));
        composer.rescue(guid, user);
    }

    function test_rescue_Revert_ValidPendingMessage() public {
        (bytes32 guid, bytes memory message, ) = _land(1 ether, _payload());
        vm.deal(address(composer), 2 ether);
        vm.expectRevert(abi.encodeWithSelector(IZoneComposer.NothingToRescue.selector, guid));
        composer.rescue(guid, user);
        assertEq(address(composer).balance, 2 ether);
        assertEq(endpoint.composeQueue(address(oftB), address(composer), guid, 0), keccak256(message));
    }

    function test_rescue_Revert_Retried() public {
        (bytes32 guid, ) = _cacheUnroutable(true);
        airlock.setZoneActive(999, true);
        composer.retry(guid, 999, RECIPIENT, hex"01");
        vm.expectRevert(abi.encodeWithSelector(IZoneComposer.NothingToRescue.selector, guid));
        composer.rescue(guid, user);
    }

    function test_rescue_Revert_InvalidRecipient() public {
        (bytes32 guid, uint256 amount) = _cache(1 ether, hex"01");
        vm.expectRevert(IZoneComposer.InvalidRescueRecipient.selector);
        composer.rescue(guid, address(0));
        assertEq(composer.rescuableMessages(guid), amount);
    }

    function test_rescue_Revert_RejectingRecipient() public {
        (bytes32 guid, uint256 amount) = _cache(1 ether, hex"01");
        MockRejectingRecipient rejectingRecipient = new MockRejectingRecipient();
        vm.expectRevert(IZoneComposerNative.NativeTransferFailed.selector);
        composer.rescue(guid, address(rejectingRecipient));
        assertEq(composer.rescuableMessages(guid), amount);
        assertEq(address(composer).balance, amount);
        composer.rescue(guid, user);
        assertEq(composer.rescuableMessages(guid), 0);
    }

    function test_renounceOwnership_Revert_CannotRenounceOwnership() public {
        vm.expectRevert(IZoneComposer.CannotRenounceOwnership.selector);
        composer.renounceOwnership();
    }

    function test_renounceOwnership_Revert_NotOwner() public {
        vm.prank(user);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, user));
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

    function test_decode_Revert_InvalidLength() public {
        vm.expectRevert(abi.encodeWithSelector(ZoneComposerMsgCodec.InvalidPayload.selector));
        composer.decode(hex"01");
    }

    function test_transferOwnership() public {
        vm.expectEmit(true, true, true, true, address(composer));
        emit Ownable2Step.OwnershipTransferStarted(address(this), user);
        composer.transferOwnership(user);
        assertEq(composer.owner(), address(this));
        assertEq(composer.pendingOwner(), user);
    }

    function test_acceptOwnership() public {
        composer.transferOwnership(user);
        vm.expectEmit(true, true, true, true, address(composer));
        emit Ownable.OwnershipTransferred(address(this), user);
        vm.prank(user);
        composer.acceptOwnership();
        assertEq(composer.owner(), user);
        assertEq(composer.pendingOwner(), address(0));
    }

    function test_acceptOwnership_Revert_NotPendingOwner() public {
        composer.transferOwnership(user);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, address(this)));
        composer.acceptOwnership();
    }

    function _cache(uint256 _amount, bytes memory _payloadBytes) internal returns (bytes32 guid, uint256 amount) {
        bytes memory message;
        (guid, message, amount) = _land(_amount, _payloadBytes);
        vm.expectEmit(true, true, true, true, address(composer));
        emit IZoneComposer.DecodeFailed(guid, _payloadBytes);
        _deliver(guid, message);
        assertEq(composer.rescuableMessages(guid), amount);
        assertEq(endpoint.composeQueue(address(oftB), address(composer), guid, 0), bytes32(uint256(1)));
        assertEq(address(airlock).balance, 0);
    }

    function _cacheUnroutable(bool _withMemo) internal returns (bytes32 guid, uint256 credited) {
        bytes memory memo = _withMemo ? bytes(hex"01") : bytes("");
        bytes memory message;
        (guid, message, credited) = _land(
            1 ether,
            _withMemo ? ZoneComposerMsgCodec.encode(999, RECIPIENT, memo) : ZoneComposerMsgCodec.encode(999, RECIPIENT)
        );
        _deliver(guid, message);
        assertEq(composer.retryableMessages(guid), keccak256(abi.encode(uint64(999), RECIPIENT, memo)));
    }

    function _deployNativeOFT(uint32 _eid) internal returns (OFTNativeExtendedRBACUpgradeable oft) {
        OFTNativeExtendedRBACUpgradeable implementation = new OFTNativeExtendedRBACUpgradeable(18, endpoints[_eid], 0);
        oft = OFTNativeExtendedRBACUpgradeable(
            payable(
                address(
                    new TransparentUpgradeableProxy(
                        address(implementation),
                        proxyOwner,
                        abi.encodeCall(OFTNativeExtendedRBACUpgradeable.initialize, (address(this), address(this)))
                    )
                )
            )
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

    function _payload() internal pure returns (bytes memory) {
        return ZoneComposerMsgCodec.encode(1, RECIPIENT, bytes(""));
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
        uint256 nativeBalance = address(oftB).balance;
        uint256 composerBalance = address(composer).balance;
        verifyPackets(B_EID, address(oftB));
        assertEq(address(oftB).balance, nativeBalance - oftReceipt.amountReceivedLD);
        assertEq(address(composer).balance, composerBalance + oftReceipt.amountReceivedLD);
        assertEq(endpoint.composeQueue(address(oftB), address(composer), receipt.guid, 0), keccak256(message));
        return (receipt.guid, message, oftReceipt.amountReceivedLD);
    }

    function _deliver(bytes32 _guid, bytes memory _messageBytes) internal {
        endpoint.lzCompose(address(oftB), address(composer), _guid, 0, _messageBytes, "");
    }
}
