// SPDX-License-Identifier: UNLICENSE

pragma solidity ^0.8.0;

import { Client } from "@chainlink/contracts-ccip/src/v0.8/ccip/libraries/Client.sol";

import { ILayerZeroDVN } from "../../contracts/uln/interfaces/ILayerZeroDVN.sol";
import { ICCIPDVNAdapter } from "../../contracts/uln/interfaces/adapters/ICCIPDVNAdapter.sol";
import { CCIPDVNAdapter } from "../../contracts/uln/dvn/adapters/CCIP/CCIPDVNAdapter.sol";
import { MessageLibMock } from "./MessageLibMock.sol";
import { DVNAdapterSendReceiveTest } from "./DVNAdapterBase.sol";
import { CCIPDVNAdapterFeeLib } from "../../contracts/uln/dvn/adapters/CCIP/CCIPDVNAdapterFeeLib.sol";
import { AddressCast } from "@layerzerolabs/lz-evm-protocol-v2/contracts/libs/AddressCast.sol";
import { ReceiveLibParam } from "../../contracts/uln/dvn/adapters/DVNAdapterBase.sol";

contract CCIPRouterMock {
    CCIPDVNAdapter public sendAdapter;
    CCIPDVNAdapter public receiveAdapter;

    function setSendAdapter(address _adapter) external {
        sendAdapter = CCIPDVNAdapter(payable(_adapter));
    }

    function setReceiveAdapter(address _adapter) external {
        receiveAdapter = CCIPDVNAdapter(payable(_adapter));
    }

    function ccipSend(
        uint64 /*destinationChainSelector*/,
        Client.EVM2AnyMessage memory message
    ) external payable returns (bytes32) {
        Client.Any2EVMMessage memory evmMessage = Client.Any2EVMMessage({
            messageId: bytes32(uint(0xabcd)),
            sourceChainSelector: 0x00000001, // from 1 to 2
            sender: abi.encode(address(sendAdapter)),
            data: message.data,
            destTokenAmounts: message.tokenAmounts
        });
        receiveAdapter.ccipReceive(evmMessage);
        return bytes32(0);
    }

    function getFee(
        uint64 /*destinationChainSelector*/,
        Client.EVM2AnyMessage memory /*message*/
    ) external pure returns (uint256 fee) {
        fee = 0;
    }
}

contract CCIPDVNAdapterTest is DVNAdapterSendReceiveTest {
    using AddressCast for address;

    CCIPDVNAdapter internal sendAdapter;
    CCIPDVNAdapter internal receiveAdapter;

    CCIPRouterMock internal router;

    function setUp() public override {
        super.setUp();
        // router
        router = new CCIPRouterMock();
        // adapters
        sendAdapter = new CCIPDVNAdapter(admins, address(router));
        ReceiveLibParam[] memory receiveLibsParams = new ReceiveLibParam[](4);
        receiveLibsParams[0] = ReceiveLibParam(
            address(sendMsgLib301),
            optimismEidV1,
            address(receiveMsgLib301).toBytes32()
        );
        receiveLibsParams[1] = ReceiveLibParam(
            address(sendMsgLib301),
            optimismEidV2,
            address(receiveMsgLib302).toBytes32()
        );
        receiveLibsParams[2] = ReceiveLibParam(
            address(sendMsgLib302),
            optimismEidV1,
            address(receiveMsgLib301).toBytes32()
        );
        receiveLibsParams[3] = ReceiveLibParam(
            address(sendMsgLib302),
            optimismEidV2,
            address(receiveMsgLib302).toBytes32()
        );
        sendAdapter.setReceiveLibs(receiveLibsParams);

        CCIPDVNAdapterFeeLib sendAdapterFeeLib = new CCIPDVNAdapterFeeLib();
        sendAdapterFeeLib.initialize();
        sendAdapter.setWorkerFeeLib(address(sendAdapterFeeLib));

        receiveAdapter = new CCIPDVNAdapter(admins, address(router));
        CCIPDVNAdapterFeeLib receiveAdapterFeeLib = new CCIPDVNAdapterFeeLib();
        receiveAdapterFeeLib.initialize();
        receiveAdapter.setWorkerFeeLib(address(receiveAdapterFeeLib));

        // setup send adapter
        ICCIPDVNAdapter.DstConfigParam[] memory dstConfig = new ICCIPDVNAdapter.DstConfigParam[](2);
        dstConfig[0] = ICCIPDVNAdapter.DstConfigParam({
            eid: optimismEidV1,
            multiplierBps: 10000,
            gas: 1000000,
            chainSelector: 0x00000002, // from 1 to 2
            peer: abi.encode(address(receiveAdapter))
        });
        sendAdapter.setDstConfig(dstConfig);
        // setup receive adapter
        dstConfig[0] = ICCIPDVNAdapter.DstConfigParam({
            eid: ethereumEidV1,
            multiplierBps: 10000,
            gas: 1000000,
            chainSelector: 0x00000001, // from 2 to 1
            peer: abi.encode(address(sendAdapter))
        });
        receiveAdapter.setDstConfig(dstConfig);
        // setup router mock
        router.setSendAdapter(address(sendAdapter));
        router.setReceiveAdapter(address(receiveAdapter));
        // setup sendLib
        sendMsgLib301.setSendDVNAdapter(address(sendAdapter));
        sendMsgLib302.setSendDVNAdapter(address(sendAdapter));
    }
}
