// SPDX-License-Identifier: UNLICENSE

pragma solidity ^0.8.0;

import { AddressToString } from "@axelar-network/axelar-gmp-sdk-solidity/contracts/libs/AddressString.sol";

import { AddressCast } from "@layerzerolabs/lz-evm-protocol-v2/contracts/libs/AddressCast.sol";
import { ILayerZeroDVN } from "../../contracts/uln/interfaces/ILayerZeroDVN.sol";
import { ReceiveLibParam } from "../../contracts/uln/dvn/adapters/DVNAdapterBase.sol";
import { AxelarDVNAdapter } from "../../contracts/uln/dvn/adapters/axelar/AxelarDVNAdapter.sol";
import { IAxelarDVNAdapter } from "../../contracts/uln/interfaces/adapters/IAxelarDVNAdapter.sol";
import { MessageLibMock } from "./MessageLibMock.sol";
import "./DVNAdapterBase.sol";
import "../../contracts/uln/dvn/adapters/axelar/AxelarDVNAdapterFeeLib.sol";

contract GatewayMock {
    AxelarDVNAdapter public sendAdapter;
    AxelarDVNAdapter public receiveAdapter;

    function setSenderAdapter(address _adapter) external {
        sendAdapter = AxelarDVNAdapter(payable(_adapter));
    }

    function setReceiveAdapter(address _adapter) external {
        receiveAdapter = AxelarDVNAdapter(payable(_adapter));
    }

    // @notice force from ethereum to optimism
    function callContract(
        string calldata /*destinationChain*/,
        string calldata /*contractAddress*/,
        bytes calldata payload
    ) external {
        string memory sourceChain = "ethereum";
        string memory sourceAddress = AddressToString.toString(address(sendAdapter));
        receiveAdapter.execute(bytes32(0), sourceChain, sourceAddress, payload);
    }

    function validateContractCall(
        bytes32 /*commandId*/,
        string calldata /*sourceChain*/,
        string calldata /*sourceAddress*/,
        bytes32 /*payloadHash*/
    ) external pure returns (bool) {
        return true;
    }
}

contract GasServiceMock {
    function payNativeGasForContractCall(
        address sender,
        string calldata destinationChain,
        string calldata destinationAddress,
        bytes calldata payload,
        address refundAddress
    ) external payable {
        // do nothing
    }
}

contract AxelarDVNAdapterTest is DVNAdapterSendReceiveTest {
    using AddressCast for address;

    AxelarDVNAdapter internal sendAdapter;
    AxelarDVNAdapter internal receiveAdapter;

    GatewayMock internal gateway;
    GasServiceMock internal gasService;

    function setUp() public override {
        super.setUp();
        gateway = new GatewayMock();
        gasService = new GasServiceMock();
        // router
        sendAdapter = new AxelarDVNAdapter(admins, address(gateway));
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

        AxelarDVNAdapterFeeLib sendAdapterFeeLib = new AxelarDVNAdapterFeeLib();
        vm.deal(address(sendAdapterFeeLib), 1 ether);
        sendAdapterFeeLib.initialize(address(gasService), address(sendAdapter), 25000);
        sendAdapter.setWorkerFeeLib(address(sendAdapterFeeLib));

        receiveAdapter = new AxelarDVNAdapter(admins, address(gateway));
        AxelarDVNAdapterFeeLib receiveAdapterFeeLib = new AxelarDVNAdapterFeeLib();
        receiveAdapterFeeLib.initialize(address(gasService), address(receiveAdapter), 25000);
        receiveAdapter.setWorkerFeeLib(address(receiveAdapterFeeLib));

        // setup send adapter
        AxelarDVNAdapter.DstConfigParam[] memory dstConfig = new AxelarDVNAdapter.DstConfigParam[](2);
        dstConfig[0] = IAxelarDVNAdapter.DstConfigParam({
            eid: optimismEidV1,
            multiplierBps: 10000,
            nativeGasFee: 1,
            peer: AddressToString.toString(address(receiveAdapter)),
            chainName: "optimism"
        });
        sendAdapter.setDstConfig(dstConfig);
        // setup receive adapter
        dstConfig[0] = IAxelarDVNAdapter.DstConfigParam({
            eid: ethereumEidV1,
            multiplierBps: 10000,
            nativeGasFee: 0,
            peer: AddressToString.toString(address(sendAdapter)),
            chainName: "ethereum"
        });
        receiveAdapter.setDstConfig(dstConfig);
        // setup gateway mock
        gateway.setSenderAdapter(address(sendAdapter));
        gateway.setReceiveAdapter(address(receiveAdapter));
        // setup sendLib
        sendMsgLib301.setSendDVNAdapter(address(sendAdapter));
        sendMsgLib302.setSendDVNAdapter(address(sendAdapter));
    }
}
