//// SPDX-License-Identifier: UNLICENSE
//
pragma solidity ^0.8.0;
//
//import { ILayerZeroDVN } from "../../contracts/uln/interfaces/ILayerZeroDVN.sol";
//import { OptimismDVNAdapterL1 } from "../../contracts/uln/dvn/adapters/optimism/OptimismDVNAdapterL1.sol";
//import { OptimismDVNAdapterL2 } from "../../contracts/uln/dvn/adapters/optimism/OptimismDVNAdapterL2.sol";
//import { MessageLibMock } from "./MessageLibMock.sol";
//import { AddressCast } from "@layerzerolabs/lz-evm-protocol-v2/contracts/libs/AddressCast.sol";
//import { ReceiveLibParam } from "../../contracts/uln/dvn/adapters/DVNAdapterBase.sol";
//import "./DVNAdapterBase.sol";
//
//contract MessengerMock {
//    OptimismDVNAdapterL1 public adapterL1;
//    OptimismDVNAdapterL2 public adapterL2;
//
//    function setAdapterL1(address _adapter) external {
//        adapterL1 = OptimismDVNAdapterL1(payable(_adapter));
//    }
//
//    function setAdapterL2(address _adapter) external {
//        adapterL2 = OptimismDVNAdapterL2(payable(_adapter));
//    }
//
//    function sendMessage(address _target, bytes calldata _message, uint32 /**_gasLimit**/) external {
//        bytes memory payload = abi.decode(_message[4:], (bytes));
//        require(_target == address(adapterL2), "MessengerMock: invalid target");
//        adapterL2.verify(payload);
//    }
//
//    function xDomainMessageSender() external view returns (address) {
//        return address(adapterL1);
//    }
//}
//
//contract OptimismDVNAdapterTest is DVNAdapterSendReceiveTest {
//    using AddressCast for address;
//
//    MessengerMock internal messenger;
//
//    OptimismDVNAdapterL1 internal sendAdapter;
//    OptimismDVNAdapterL2 internal receiveAdapter;
//
//    function setUp() public override {
//        super.setUp();
//        // messenger
//        messenger = new MessengerMock();
//        // sendAdapter
//        sendAdapter = new OptimismDVNAdapterL1(admins, optimismEidV1, address(messenger));
//        ReceiveLibParam[] memory receiveLibsParams = new ReceiveLibParam[](4);
//        receiveLibsParams[0] = ReceiveLibParam(
//            address(sendMsgLib301),
//            optimismEidV1,
//            address(receiveMsgLib301).toBytes32()
//        );
//        receiveLibsParams[1] = ReceiveLibParam(
//            address(sendMsgLib301),
//            optimismEidV2,
//            address(receiveMsgLib302).toBytes32()
//        );
//        receiveLibsParams[2] = ReceiveLibParam(
//            address(sendMsgLib302),
//            optimismEidV1,
//            address(receiveMsgLib301).toBytes32()
//        );
//        receiveLibsParams[3] = ReceiveLibParam(
//            address(sendMsgLib302),
//            optimismEidV2,
//            address(receiveMsgLib302).toBytes32()
//        );
//        sendAdapter.setReceiveLibs(receiveLibsParams);
//
//        receiveAdapter = new OptimismDVNAdapterL2(admins, address(messenger));
//        // setup adapter
//        sendAdapter.setPeer(address(receiveAdapter));
//        receiveAdapter.setPeer(address(sendAdapter));
//        // setup messenger mock
//        messenger.setAdapterL1(address(sendAdapter));
//        messenger.setAdapterL2(address(receiveAdapter));
//        // setup sendLib
//        sendMsgLib301.setSendDVNAdapter(address(sendAdapter));
//        sendMsgLib302.setSendDVNAdapter(address(sendAdapter));
//    }
//}
