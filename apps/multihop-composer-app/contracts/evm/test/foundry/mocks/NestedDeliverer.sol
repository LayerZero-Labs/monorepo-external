// SPDX-License-Identifier: MIT
pragma solidity ^0.8.22;

import {
    ILayerZeroEndpointV2,
    MessagingParams
} from "@layerzerolabs/lz-evm-protocol-v2/contracts/interfaces/ILayerZeroEndpointV2.sol";

/// @dev Starts its own endpoint send and delivers a compose from the leftover refund, so inside the send context.
contract NestedDeliverer {
    ILayerZeroEndpointV2 internal immutable endpoint;
    bytes public composeRevert;

    address internal from;
    address internal composer;
    bytes32 internal guid;
    bytes internal message;
    uint256 internal value;

    constructor(address _endpoint) {
        endpoint = ILayerZeroEndpointV2(_endpoint);
    }

    function deliverDuringSend(
        address _from,
        address _composer,
        bytes32 _guid,
        bytes calldata _message,
        uint256 _value,
        uint32 _dstEid,
        bytes calldata _options
    ) external payable {
        (from, composer, guid, message, value) = (_from, _composer, _guid, _message, _value);
        endpoint.send{ value: msg.value }(
            MessagingParams(_dstEid, bytes32(uint256(1)), "", _options, false),
            address(this)
        );
    }

    receive() external payable {
        address to = composer;
        if (to == address(0)) return;
        composer = address(0);
        try endpoint.lzCompose{ value: value }(from, to, guid, 0, message, "") {} catch (bytes memory reason) {
            composeRevert = reason;
        }
    }
}
