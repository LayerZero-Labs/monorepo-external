// SPDX-License-Identifier: UNLICENSED

pragma solidity ^0.8.0;

import { Test } from "forge-std/Test.sol";

import { GUID } from "../../contracts/libs/GUID.sol";

contract AddressCastTest is Test {
    function test_generate() public {
        bytes32 guid = GUID.generate(
            1,
            10121,
            address(0x7Cff4181f857B06114643D495648A95b3E0B0B81),
            10108,
            bytes32(0x6552e1c444f6a2ce35b22de6a554da8c32c5650db0e0158df2eb0daa51289968)
        );
        assertEq(guid, bytes32(0x0cecfadce0afea44ddb59197996d51aa04ff867c32d9a864f7fe30c7da97a978), "should be equal");
    }
}
