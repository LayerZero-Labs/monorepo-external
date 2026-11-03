// SPDX-License-Identifier: UNLICENSE

pragma solidity ^0.8.0;

import "forge-std/Test.sol";

import { ILayerZeroDVN } from "../../contracts/uln/interfaces/ILayerZeroDVN.sol";

contract MessageLibMock {
    event PayloadSubmitted(bytes header, bytes32 payloadHash);
    event PayloadVerified(bytes header, bytes32 proofHash, uint256 confirmations);

    ILayerZeroDVN internal sendAdapter;

    function setSendDVNAdapter(address _sendAdapter) external {
        sendAdapter = ILayerZeroDVN(_sendAdapter);
    }

    // --- Send ---
    function assignJob(ILayerZeroDVN.AssignJobParam calldata _param, bytes calldata _options) external payable {
        emit PayloadSubmitted(_param.packetHeader, _param.payloadHash);
        sendAdapter.assignJob(_param, _options);
    }

    // --- Receive ---
    function verify(bytes calldata _packetHeader, bytes32 _payloadHash, uint64 _confirmations) external {
        emit PayloadVerified(_packetHeader, _payloadHash, _confirmations);
    }
}
