// SPDX-License-Identifier: BUSL-1.1

pragma solidity ^0.7.6;
pragma abicoder v2;

import "forge-std/Test.sol";

interface IPacket {
    struct Packet {
        uint64 nonce;
        uint32 srcEid;
        address sender;
        uint32 dstEid;
        bytes32 receiver;
        bytes message;
    }
}

contract TestHelper is Test {
    function setUp() public virtual {}

    function addressToBytes32(address _addr) internal pure returns (bytes32) {
        return bytes32(uint(uint160(_addr)));
    }

    function initPacket(
        uint64 nonce,
        uint32 srcEid,
        address sender,
        uint32 dstEid,
        bytes32 receiver,
        bytes memory message
    ) public pure returns (IPacket.Packet memory) {
        return IPacket.Packet(nonce, srcEid, sender, dstEid, receiver, message);
    }

    receive() external payable {}
}
