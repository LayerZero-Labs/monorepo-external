// SPDX-License-Identifier: MIT
pragma solidity ^0.8.22;

import { MultiHopComposerGasTest } from "./MultiHopComposerGas.t.sol";

/**
 * @notice Every `MultiHopComposerGasTest` snapshot for a `MultiHopComposerNative` joining `NativeOFTAdapter`s, plus
 *         `receive`, written to `generated/snapshots/MultiHopComposerNative.json`.
 */
contract MultiHopComposerNativeGasTest is MultiHopComposerGasTest {
    function _oftKind() internal pure virtual override returns (OFTKind) {
        return OFTKind.NativeOFTAdapter;
    }

    function _group() internal pure virtual override returns (string memory) {
        return "MultiHopComposerNative";
    }

    function test_receive() public {
        vm.deal(arbMeshA, arbMeshA.balance + 1 ether);
        vm.prank(arbMeshA);
        (bool success, ) = address(composer).call{ value: 1 ether }("");
        vm.snapshotGasLastCall(_group(), "receive");
        assertTrue(success);
    }
}
