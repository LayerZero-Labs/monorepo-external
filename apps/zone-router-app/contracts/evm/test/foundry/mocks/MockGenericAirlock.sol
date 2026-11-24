// SPDX-License-Identifier: MIT
pragma solidity ^0.8.22;

import { IAirlock } from "../../../contracts/interfaces/IAirlock.sol";

/**
 * @dev Numbers `_messages` from `_first`, as `Airlock` delivers them, and returns the same array.
 */
function numbered(IAirlock.Message[] memory _messages, uint64 _first) pure returns (IAirlock.Message[] memory) {
    for (uint256 i; i < _messages.length; ++i) {
        _messages[i].nonce = _first + uint64(i);
    }
    return _messages;
}

contract MockGenericAirlock {
    error Rejected();
    error InvalidProof();
    error EmptyBatch();
    error BatchTooLarge(uint64 count, uint64 max);
    error Replay(uint64 expected, uint64 received);
    error Gap(uint64 expected, uint64 received);
    error RemoteSlotAbsent();
    error InvalidAddressLength(uint8 argument, uint256 length);
    error MemoTooLong(uint256 length, uint256 max);
    error InvalidPeerZone(uint64 zone);
    error NonceMismatch(uint64 expected, uint64 received);

    bool public fail;
    bool public authenticationFailure;
    IAirlock.Message internal sentMessage;
    uint64 public dstZone;
    bytes public dstApp;
    address public sender;
    uint64 public nonce;
    address public lastReceiver;
    uint64 public lastSrcZone;
    bytes public lastSrcApp;
    uint64 public lastFirstNonce;
    uint64 public lastCount;
    mapping(bytes32 channel => uint64 nextNonce) internal outbound;
    mapping(bytes32 channel => uint64 nextNonce) internal cursors;
    mapping(bytes32 channel => IAirlock.Message[] messages) internal queues;

    function message() external view returns (IAirlock.Message memory result) {
        return sentMessage;
    }

    function setFail(bool _fail) external {
        fail = _fail;
    }

    function setAuthenticationFailure(bool _fail) external {
        authenticationFailure = _fail;
    }

    function setMessages(
        address _receiver,
        uint64 _srcZone,
        bytes calldata _srcApp,
        IAirlock.Message[] calldata _messages
    ) external {
        bytes32 key = keccak256(abi.encode(_receiver, _srcZone, _srcApp));
        delete queues[key];
        cursors[key] = 0;
        _enqueue(key, _messages);
    }

    function appendMessages(
        address _receiver,
        uint64 _srcZone,
        bytes calldata _srcApp,
        IAirlock.Message[] calldata _messages
    ) external {
        bytes32 key = keccak256(abi.encode(_receiver, _srcZone, _srcApp));
        _enqueue(key, _messages);
    }

    /// @dev Like `Airlock`, refuses a message that does not name the nonce it is stored at on its channel.
    function _enqueue(bytes32 _key, IAirlock.Message[] calldata _messages) internal {
        for (uint256 i; i < _messages.length; ++i) {
            uint64 slot = uint64(queues[_key].length);
            if (_messages[i].nonce != slot) revert NonceMismatch(slot, _messages[i].nonce);
            queues[_key].push(_messages[i]);
        }
    }

    function queued(address _receiver, uint64 _srcZone, bytes calldata _srcApp) external view returns (uint64 count) {
        return uint64(queues[keccak256(abi.encode(_receiver, _srcZone, _srcApp))].length);
    }

    function cursor(
        address _receiver,
        uint64 _srcZone,
        bytes calldata _srcApp
    ) external view returns (uint64 nextNonce) {
        return cursors[keccak256(abi.encode(_receiver, _srcZone, _srcApp))];
    }

    function send(
        uint64 _dstZone,
        bytes calldata _dstApp,
        uint256 _amount18d,
        bytes calldata _sender,
        bytes calldata _recipient,
        bytes calldata _memo
    ) external returns (uint64 sentNonce) {
        if (fail) revert Rejected();
        if (_dstZone == 0) revert InvalidPeerZone(_dstZone);
        _validateAddress(_dstApp, 0);
        _validateAddress(_sender, 2);
        _validateAddress(_recipient, 3);
        if (_memo.length > 255) revert MemoTooLong(_memo.length, 255);
        bytes32 key = keccak256(abi.encode(msg.sender, _dstZone, _dstApp));
        sentNonce = outbound[key]++;
        sentMessage = IAirlock.Message(
            1,
            abi.encodePacked(msg.sender),
            _dstZone,
            _dstApp,
            sentNonce,
            _amount18d,
            _sender,
            _recipient,
            _memo
        );
        dstZone = _dstZone;
        dstApp = _dstApp;
        sender = msg.sender;
        nonce = sentNonce;
    }

    function _validateAddress(bytes calldata _address, uint8 _argument) internal pure {
        if (_address.length == 0 || _address.length > 255) revert InvalidAddressLength(_argument, _address.length);
    }

    function receiveMessages(
        uint64 _srcZone,
        bytes calldata _srcApp,
        uint64 _firstNonce,
        uint64 _count
    ) external returns (IAirlock.Message[] memory messages) {
        _validateAddress(_srcApp, 1);
        if (fail) revert Rejected();
        if (authenticationFailure) revert InvalidProof();
        if (_count == 0) revert EmptyBatch();
        if (_count > 64) revert BatchTooLarge(_count, 64);
        bytes32 key = keccak256(abi.encode(msg.sender, _srcZone, _srcApp));
        uint64 nextNonce = cursors[key];
        if (_firstNonce < nextNonce) revert Replay(nextNonce, _firstNonce);
        if (_firstNonce > nextNonce) revert Gap(nextNonce, _firstNonce);
        uint64 end = nextNonce + _count;
        if (end > queues[key].length) revert RemoteSlotAbsent();
        cursors[key] = end;
        lastReceiver = msg.sender;
        lastSrcZone = _srcZone;
        lastSrcApp = _srcApp;
        lastFirstNonce = _firstNonce;
        lastCount = _count;
        messages = new IAirlock.Message[](_count);
        for (uint256 i; i < _count; ++i) {
            messages[i] = queues[key][nextNonce + i];
        }
    }
}
