// SPDX-License-Identifier: MIT
pragma solidity ^0.8.22;

import { INexusModule } from "./../../contracts/interfaces/INexusModule.sol";
import { NexusModule } from "./../../contracts/modules/NexusModule.sol";
import { NexusTestHelper } from "./../shared/NexusTestHelper.sol";

contract NexusModuleHarness is NexusModule {
    constructor(address _nexus) NexusModule(_nexus) {}

    function decodeNexusId(uint256 _nexusId) external pure returns (uint32 eid, uint32 tokenId) {
        return _decodeNexusId(_nexusId);
    }
}

contract NexusModuleTest is NexusTestHelper {
    NexusModuleHarness harness;

    function setUp() public override {
        super.setUp();
        harness = new NexusModuleHarness(address(aNexus));
    }

    function test_constructor_Revert_ZeroAddress() public {
        vm.expectRevert(INexusModule.InvalidNexus.selector);
        new NexusModuleHarness(address(0));
    }

    function test_decodeNexusId_Fuzz_Equivalence(uint256 _nexusId) public view {
        (uint32 eid, uint32 tokenId) = harness.decodeNexusId(_nexusId);
        assertEq(eid, uint32(_nexusId));
        assertEq(tokenId, uint32(_nexusId >> 32));
    }

    function test_decodeNexusId_Fuzz_ZeroTokenID(uint32 _eid) public view {
        uint256 nexusId = uint256(_eid);
        (uint32 eid, uint32 tokenId) = harness.decodeNexusId(nexusId);
        assertEq(eid, _eid);
        assertEq(tokenId, 0);
    }

    function test_decodeNexusId_Fuzz_ZeroEID(uint32 _tokenId) public view {
        uint256 nexusId = uint256(_tokenId) << 32;
        (uint32 eid, uint32 tokenId) = harness.decodeNexusId(nexusId);
        assertEq(eid, 0);
        assertEq(tokenId, _tokenId);
    }

    function test_decodeNexusId_Fuzz_Roundtrip(uint32 _eid, uint32 _tokenId) public view {
        uint256 nexusId = (uint256(_tokenId) << 32) | uint256(_eid);
        (uint32 eid, uint32 tokenId) = harness.decodeNexusId(nexusId);
        assertEq(eid, _eid);
        assertEq(tokenId, _tokenId);
    }

    function test_decodeNexusId_Fuzz_MatchesGetNexusId(uint32 _eid, uint32 _tokenId) public view {
        uint256 nexusId = aNexus.getNexusId(_tokenId, _eid);
        (uint32 eid, uint32 tokenId) = harness.decodeNexusId(nexusId);
        assertEq(eid, _eid);
        assertEq(tokenId, _tokenId);
    }

    function test_decodeNexusId_Fuzz_IgnoresUpperBits(uint256 _garbage, uint32 _eid, uint32 _tokenId) public view {
        uint256 nexusId = (uint256(_tokenId) << 32) | uint256(_eid);
        nexusId |= uint256(_garbage) << 64;

        (uint32 eid, uint32 tokenId) = harness.decodeNexusId(nexusId);
        assertEq(eid, _eid);
        assertEq(tokenId, _tokenId);
    }
}
