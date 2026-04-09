// SPDX-License-Identifier: MIT
pragma solidity ^0.8.22;

import { ECDSA } from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import { EnumerableSet } from "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";

import { OneSig } from "packages/onesig/onesig-evm/contracts/OneSig.sol";

contract OneSigHarness is OneSig {
    using EnumerableSet for EnumerableSet.AddressSet;

    error IndexOutOfBoundsError(uint256 index);

    constructor(
        uint64 _oneSigId,
        address[] memory _signers,
        uint256 _threshold,
        address[] memory _executors,
        bool _executorRequired,
        bytes32 _seed
    ) OneSig(_oneSigId, _signers, _threshold, _executors, _executorRequired, _seed) {}

    function getSigner(uint256 _index) external view returns (address signer) {
        signer = signerSet.at(_index);
    }

    function getExecutor(uint256 _index) external view returns (address executor) {
        executor = executorSet.at(_index);
    }

    function recoverSignerForIndex(
        bytes32 _digest,
        bytes calldata _signatures,
        uint256 _index
    ) public view returns (address signer) {
        // Each signature is 65 bytes (r=32, s=32, v=1).
        if (_signatures.length % 65 != 0) revert SignatureError();
        uint256 signaturesCount = _signatures.length / 65;
        if (_index >= signaturesCount) revert IndexOutOfBoundsError(_index);

        // Extract a single signature (65 bytes) for _index.
        bytes calldata signature = _signatures[_index * 65:(_index + 1) * 65];
        signer = ECDSA.recover(_digest, signature);
    }
}
