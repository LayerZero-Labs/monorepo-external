// SPDX-License-Identifier: MIT
pragma solidity ^0.8.22;

import { EnumerableSet } from "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";

import { ExecutorStore } from "packages/onesig/onesig-evm/contracts/ExecutorStore.sol";

contract ExecutorStoreHarness is ExecutorStore {
    using EnumerableSet for EnumerableSet.AddressSet;

    constructor(address[] memory _executors, bool _executorRequired) ExecutorStore(_executors, _executorRequired) {}

    function getExecutor(uint256 _index) external view returns (address executor) {
        executor = executorSet.at(_index);
    }
}
