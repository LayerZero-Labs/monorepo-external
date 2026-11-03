// SPDX-License-Identifier: UNLICENSE

pragma solidity ^0.8.0;

import "forge-std/Test.sol";

import { Packet } from "@layerzerolabs/lz-evm-protocol-v2/contracts/interfaces/ISendLib.sol";
import { PacketV1Codec } from "@layerzerolabs/lz-evm-protocol-v2/contracts/messagelib/libs/PacketV1Codec.sol";
import { ILayerZeroDVN } from "../../contracts/uln/interfaces/ILayerZeroDVN.sol";
import { MessageLibMock } from "./MessageLibMock.sol";

contract DVNAdapterBaseTest is Test {
    MessageLibMock internal sendMsgLib301;
    MessageLibMock internal receiveMsgLib301;
    MessageLibMock internal sendMsgLib302;
    MessageLibMock internal receiveMsgLib302;
    address[] internal admins;
    uint32 internal ethereumEidV1 = 1;
    uint32 internal ethereumEidV2 = 30001;
    uint32 internal optimismEidV1 = 2;
    uint32 internal optimismEidV2 = 30002;

    function setUp() public virtual {
        // admins
        address admin = address(this);
        admins.push(admin);

        // msgLibs
        sendMsgLib301 = new MessageLibMock();
        sendMsgLib302 = new MessageLibMock();
        receiveMsgLib301 = new MessageLibMock();
        receiveMsgLib302 = new MessageLibMock();
    }
}

/// @notice common test cases for Send and Receive adapters
abstract contract DVNAdapterSendReceiveTest is DVNAdapterBaseTest {
    function test_Send_Receive_V1V1() public {
        // send to v1
        Packet memory packet = Packet({
            nonce: 0,
            srcEid: ethereumEidV1,
            sender: address(0),
            dstEid: optimismEidV1,
            receiver: bytes32(0),
            guid: bytes32(uint(0xabcd)),
            message: ""
        });
        bytes memory packetHeader = PacketV1Codec.encodePacketHeader(packet);
        bytes32 payloadHash = keccak256(PacketV1Codec.encodePayload(packet));

        // payload submitted
        vm.expectEmit(true, true, true, true, address(sendMsgLib301));
        emit MessageLibMock.PayloadSubmitted(packetHeader, payloadHash);

        // payload verified
        vm.expectEmit(true, true, true, true, address(receiveMsgLib301));
        emit MessageLibMock.PayloadVerified(packetHeader, payloadHash, type(uint64).max);

        sendMsgLib301.assignJob(
            ILayerZeroDVN.AssignJobParam({
                dstEid: optimismEidV1,
                packetHeader: packetHeader,
                payloadHash: payloadHash,
                confirmations: 0,
                sender: address(0)
            }),
            ""
        );
    }

    function test_Send_Receive_V1V2() public {
        // send to v1
        Packet memory packet = Packet({
            nonce: 0,
            srcEid: ethereumEidV1,
            sender: address(0),
            dstEid: optimismEidV2,
            receiver: bytes32(0),
            guid: bytes32(uint(0xabcd)),
            message: ""
        });
        bytes memory packetHeader = PacketV1Codec.encodePacketHeader(packet);
        bytes32 payloadHash = keccak256(PacketV1Codec.encodePayload(packet));

        // payload submitted
        vm.expectEmit(true, true, true, true, address(sendMsgLib301));
        emit MessageLibMock.PayloadSubmitted(packetHeader, payloadHash);

        // payload verified
        vm.expectEmit(true, true, true, true, address(receiveMsgLib302));
        emit MessageLibMock.PayloadVerified(packetHeader, payloadHash, type(uint64).max);

        sendMsgLib301.assignJob(
            ILayerZeroDVN.AssignJobParam({
                dstEid: optimismEidV2,
                packetHeader: packetHeader,
                payloadHash: payloadHash,
                confirmations: 0,
                sender: address(0)
            }),
            ""
        );
    }

    function test_Send_Receive_V2V1() public {
        // send to v1
        Packet memory packet = Packet({
            nonce: 0,
            srcEid: ethereumEidV2,
            sender: address(0),
            dstEid: optimismEidV2,
            receiver: bytes32(0),
            guid: bytes32(uint(0xabcd)),
            message: ""
        });
        bytes memory packetHeader = PacketV1Codec.encodePacketHeader(packet);
        bytes32 payloadHash = keccak256(PacketV1Codec.encodePayload(packet));

        // payload submitted
        vm.expectEmit(true, true, true, true, address(sendMsgLib302));
        emit MessageLibMock.PayloadSubmitted(packetHeader, payloadHash);

        // payload verified
        vm.expectEmit(true, true, true, true, address(receiveMsgLib301));
        emit MessageLibMock.PayloadVerified(packetHeader, payloadHash, type(uint64).max);

        sendMsgLib302.assignJob(
            ILayerZeroDVN.AssignJobParam({
                dstEid: optimismEidV1,
                packetHeader: PacketV1Codec.encodePacketHeader(packet),
                payloadHash: keccak256(PacketV1Codec.encodePayload(packet)),
                confirmations: 0,
                sender: address(0)
            }),
            ""
        );
    }

    function test_Send_Receive_V2V2() public {
        // send to v2
        Packet memory packet = Packet({
            nonce: 0,
            srcEid: ethereumEidV2,
            sender: address(0),
            dstEid: optimismEidV2,
            receiver: bytes32(0),
            guid: bytes32(uint(0xabcd)),
            message: ""
        });
        bytes memory packetHeader = PacketV1Codec.encodePacketHeader(packet);
        bytes32 payloadHash = keccak256(PacketV1Codec.encodePayload(packet));

        // payload submitted
        vm.expectEmit(true, true, true, true, address(sendMsgLib302));
        emit MessageLibMock.PayloadSubmitted(packetHeader, payloadHash);

        // payload verified
        vm.expectEmit(true, true, true, true, address(receiveMsgLib302));
        emit MessageLibMock.PayloadVerified(packetHeader, payloadHash, type(uint64).max);

        sendMsgLib302.assignJob(
            ILayerZeroDVN.AssignJobParam({
                dstEid: optimismEidV2,
                packetHeader: packetHeader,
                payloadHash: payloadHash,
                confirmations: 0,
                sender: address(0)
            }),
            ""
        );
    }
}
