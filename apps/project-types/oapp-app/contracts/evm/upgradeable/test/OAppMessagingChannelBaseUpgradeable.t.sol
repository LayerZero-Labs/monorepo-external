// SPDX-License-Identifier: MIT
pragma solidity ^0.8.22;

import { Origin } from "@layerzerolabs/lz-evm-protocol-v2/contracts/interfaces/ILayerZeroEndpointV2.sol";
import { IMessagingChannel } from "@layerzerolabs/lz-evm-protocol-v2/contracts/interfaces/IMessagingChannel.sol";
import { EndpointV2Mock } from "@layerzerolabs/test-devtools-evm-foundry/contracts/mocks/EndpointV2Mock.sol";
import { TestHelperOz5 } from "@layerzerolabs/test-devtools-evm-foundry/contracts/TestHelperOz5.sol";
import { TransparentUpgradeableProxy } from "@openzeppelin/contracts/proxy/transparent/TransparentUpgradeableProxy.sol";
import { OAppMessagingChannelBaseUpgradeable } from "./../contracts/oapp/messaging-channel/OAppMessagingChannelBaseUpgradeable.sol";
import { OAppCoreBaseUpgradeable } from "./../contracts/oapp/OAppCoreBaseUpgradeable.sol";

contract OAppMessagingChannelBaseHarness is OAppMessagingChannelBaseUpgradeable {
    constructor(address _endpoint) OAppCoreBaseUpgradeable(_endpoint) {
        _disableInitializers();
    }

    function initialize(address _delegate) public initializer {
        __OAppCoreBase_init(_delegate);
    }

    function oAppVersion() public pure returns (uint64 senderVersion, uint64 receiverVersion) {
        return (1, 1);
    }

    function allowInitializePath(Origin calldata _origin) public view returns (bool isAllowed) {
        return peers(_origin.srcEid) == _origin.sender;
    }

    function setPeer(uint32 _eid, bytes32 _peer) public {
        _setPeer(_eid, _peer);
    }

    function setDelegate(address _delegate) public {
        _setDelegate(_delegate);
    }

    function clear(Origin calldata _origin, bytes32 _guid, bytes calldata _message) public {
        _clear(_origin, _guid, _message);
    }

    function skip(uint32 _srcEid, bytes32 _sender, uint64 _nonce) public {
        _skip(_srcEid, _sender, _nonce);
    }

    function burn(uint32 _srcEid, bytes32 _sender, uint64 _nonce, bytes32 _payloadHash) public {
        _burn(_srcEid, _sender, _nonce, _payloadHash);
    }

    function nilify(uint32 _srcEid, bytes32 _sender, uint64 _nonce, bytes32 _payloadHash) public {
        _nilify(_srcEid, _sender, _nonce, _payloadHash);
    }
}

contract OAppMessagingChannelBaseUpgradeableTest is TestHelperOz5 {
    OAppMessagingChannelBaseHarness oapp;
    EndpointV2Mock endpoint;

    uint32 internal constant SRC_EID = 2;
    bytes32 internal constant SENDER = bytes32(uint256(uint160(address(0xBEEF))));
    bytes32 internal constant PAYLOAD_HASH = keccak256("payload");
    bytes32 internal constant GUID = keccak256("guid");
    bytes internal constant MESSAGE = hex"01";

    function _deployOApp() internal virtual returns (OAppMessagingChannelBaseHarness) {
        OAppMessagingChannelBaseHarness impl = new OAppMessagingChannelBaseHarness(address(endpoint));
        TransparentUpgradeableProxy proxy = new TransparentUpgradeableProxy(
            address(impl),
            address(this),
            abi.encodeWithSelector(OAppMessagingChannelBaseHarness.initialize.selector, address(this))
        );
        return OAppMessagingChannelBaseHarness(address(proxy));
    }

    function _setPeer(uint32 _eid, bytes32 _peer) internal virtual {
        oapp.setPeer(_eid, _peer);
    }

    function setUp() public virtual override {
        setUpEndpoints(2, LibraryType.UltraLightNode);
        endpoint = endpointSetup.endpointList[0];
        oapp = _deployOApp();
        _setPeer(SRC_EID, SENDER);
    }

    function _origin(uint64 _nonce) internal pure returns (Origin memory origin) {
        return Origin({ srcEid: SRC_EID, sender: SENDER, nonce: _nonce });
    }

    function _verify(uint64 _nonce, bytes32 _payloadHash) internal {
        Origin memory origin = _origin(_nonce);
        vm.prank(address(endpointSetup.receiveLibs[0]));
        endpoint.verify(origin, address(oapp), _payloadHash);
    }

    // ============ clear ============

    function test_clear() public {
        bytes32 payloadHash = keccak256(abi.encodePacked(GUID, MESSAGE));
        _verify(1, payloadHash);

        oapp.clear(_origin(1), GUID, MESSAGE);

        assertEq(endpoint.inboundPayloadHash(address(oapp), SRC_EID, SENDER, 1), bytes32(0));
        assertEq(endpoint.lazyInboundNonce(address(oapp), SRC_EID, SENDER), 1);
    }

    // ============ skip ============

    function test_skip() public {
        vm.expectEmit(true, true, true, true, address(endpoint));
        emit IMessagingChannel.InboundNonceSkipped(SRC_EID, SENDER, address(oapp), 1);

        oapp.skip(SRC_EID, SENDER, 1);

        assertEq(endpoint.lazyInboundNonce(address(oapp), SRC_EID, SENDER), 1);
    }

    // ============ burn ============

    function test_burn() public {
        _verify(1, PAYLOAD_HASH);

        /// @dev Advance `lazyInboundNonce` past the verified nonce without consuming its payload hash.
        oapp.skip(SRC_EID, SENDER, 2);

        vm.expectEmit(true, true, true, true, address(endpoint));
        emit IMessagingChannel.PacketBurnt(SRC_EID, SENDER, address(oapp), 1, PAYLOAD_HASH);

        oapp.burn(SRC_EID, SENDER, 1, PAYLOAD_HASH);

        assertEq(endpoint.inboundPayloadHash(address(oapp), SRC_EID, SENDER, 1), bytes32(0));
    }

    // ============ nilify ============

    function test_nilify() public {
        _verify(1, PAYLOAD_HASH);

        vm.expectEmit(true, true, true, true, address(endpoint));
        emit IMessagingChannel.PacketNilified(SRC_EID, SENDER, address(oapp), 1, PAYLOAD_HASH);

        oapp.nilify(SRC_EID, SENDER, 1, PAYLOAD_HASH);

        assertEq(endpoint.inboundPayloadHash(address(oapp), SRC_EID, SENDER, 1), bytes32(type(uint256).max));
    }

    function test_nilify_Unverified() public {
        vm.expectEmit(true, true, true, true, address(endpoint));
        emit IMessagingChannel.PacketNilified(SRC_EID, SENDER, address(oapp), 1, bytes32(0));

        oapp.nilify(SRC_EID, SENDER, 1, bytes32(0));

        assertEq(endpoint.inboundPayloadHash(address(oapp), SRC_EID, SENDER, 1), bytes32(type(uint256).max));
    }
}
