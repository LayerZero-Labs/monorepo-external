// SPDX-License-Identifier: MIT
pragma solidity ^0.8.22;

contract MockComposer {
    address public lastFrom;
    bytes32 public lastGuid;
    bytes public lastMessage;

    function lzCompose(
        address _from,
        bytes32 _guid,
        bytes calldata _message,
        address /* _executor */,
        bytes calldata /* _extraData */
    ) public payable virtual {
        lastFrom = _from;
        lastGuid = _guid;
        lastMessage = _message;
    }
}
