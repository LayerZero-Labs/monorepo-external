// SPDX-License-Identifier: UNLICENSED

pragma solidity ^0.8.0;

import { Test } from "forge-std/Test.sol";

import { SimpleMessageLib } from "./../../contracts/messagelib/SimpleMessageLib.sol";
import { EndpointV2 } from "./../../contracts/EndpointV2.sol";
import { TreasuryMock } from "./../mocks/TreasuryMock.sol";

import { AddressCast } from "../../contracts/libs/AddressCast.sol";
import { Origin } from "../../contracts/interfaces/ILayerZeroEndpointV2.sol";

abstract contract EndpointV2lzReceiveGasMeasuringFixture is Test {
    uint32 internal constant localEid = 1;
    uint32 internal constant remoteEid = 2;
    EndpointV2 internal endpoint;
    SimpleMessageLib internal simpleMsgLib;

    function setUp() public virtual {
        endpoint = new EndpointV2(localEid, address(this));
        simpleMsgLib = new SimpleMessageLib(address(endpoint), address(new TreasuryMock()));
        endpoint.registerLibrary(address(simpleMsgLib));
        endpoint.setDefaultReceiveLibrary(remoteEid, address(simpleMsgLib), 0);
    }

    function run() public {
        test_lzReceive();
    }

    function test_lzReceive() public {
        address receiver = getContractAddress();
        bytes memory message = getMessage();
        bytes32 guid = getGuid();

        // verify
        uint8 nonces = 2;
        for (uint64 nonce = 0; nonce < nonces; nonce++) {
            verifyMessage(receiver, guid, message, nonce + 1);
        }

        // deliver the first message
        deliverMessage(receiver, guid, message, nonces - 1);
    }

    function test_lzReceive_outOfOrder() public {
        address receiver = getContractAddress();
        bytes memory message = getMessage();
        bytes32 guid = getGuid();

        // verify
        uint8 nonces = 2;
        for (uint64 nonce = 0; nonce < nonces; nonce++) {
            verifyMessage(receiver, guid, message, nonce + 1);
        }

        // deliver the second message before delivering the first one
        deliverMessage(receiver, guid, message, nonces);
    }

    // Verifies a message.
    function verifyMessage(address receiver, bytes32 guid, bytes memory message, uint64 nonce) private {
        vm.prank(address(simpleMsgLib));
        Origin memory originVerified = Origin(remoteEid, AddressCast.toBytes32(address(this)), nonce);
        endpoint.verify(originVerified, receiver, keccak256(abi.encodePacked(guid, message)));
    }

    // Delivers a previously verified message.
    function deliverMessage(address receiver, bytes32 guid, bytes memory message, uint64 nonce) private {
        Origin memory origin = Origin(remoteEid, AddressCast.toBytes32(address(this)), nonce);
        bytes memory callData = abi.encodeCall(endpoint.lzReceive, (origin, receiver, guid, message, ""));

        // instrumentation
        uint256 gasBefore = 1;
        uint256 gasAfter = 1;
        address endpointAddress = address(endpoint);

        assembly {
            let callDataSize := mload(callData) // first slot stores array length
            let callDataOffset := add(0x20, callData)

            // Store gas right before
            gasBefore := gas()

            let result := call(
                gas(), // gas
                endpointAddress, // address
                0, // value
                callDataOffset, // argsOffset
                callDataSize, // argsSize
                0, // retOffset
                0 // retSize
            )

            // Store gas right after
            gasAfter := gas()
        }

        emit log_named_uint("gas used in lzReceive", gasBefore - gasAfter);
    }

    // Return a message to relay to your contract.
    function getMessage() internal pure virtual returns (bytes memory);

    // Return a guid. Override if needed, but all guids are the same length, so it should not matter.
    function getGuid() internal pure virtual returns (bytes32) {
        return keccak256("guid");
    }

    // Return the address of your lzReceiver contract so that the Endpoint can relay the message.
    function getContractAddress() internal view virtual returns (address);
}
