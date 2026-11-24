// SPDX-License-Identifier: MIT
pragma solidity ^0.8.22;

import {
    MessagingFee,
    MessagingReceipt,
    OFTReceipt,
    SendParam
} from "@layerzerolabs/oft-evm-contracts/contracts/interfaces/IOFT.sol";

/// @dev Registers like an OFT on the hub chain, and its `send` burns `sendGas`, then succeeds.
contract GasHeavyOFT {
    address public immutable endpoint;
    address public immutable token;
    uint256 internal immutable sendGas;

    constructor(address _endpoint, address _token, uint256 _sendGas) {
        endpoint = _endpoint;
        token = _token;
        sendGas = _sendGas;
    }

    function send(
        SendParam calldata,
        MessagingFee calldata,
        address
    ) external payable returns (MessagingReceipt memory receipt, OFTReceipt memory oftReceipt) {
        uint256 start = gasleft();
        while (start - gasleft() < sendGas) {}
    }
}
