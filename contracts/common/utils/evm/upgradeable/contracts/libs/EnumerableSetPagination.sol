// SPDX-License-Identifier: MIT
pragma solidity ^0.8.22;

import { EnumerableSet } from "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";

/**
 * @title EnumerableSetPagination
 * @author LayerZero Labs (tinom.eth)
 * @custom:version 1.0.0
 * @notice Library providing pagination utilities for `EnumerableSet.AddressSet` and `EnumerableSet.UintSet`.
 */
library EnumerableSetPagination {
    using EnumerableSet for EnumerableSet.AddressSet;
    using EnumerableSet for EnumerableSet.UintSet;

    /**
     * @notice Returns a paginated subset of addresses from an `EnumerableSet`.
     * @param _set `EnumerableSet.AddressSet` to paginate
     * @param _offset Starting index
     * @param _limit Maximum number of addresses to return
     * @return addresses Array of addresses in the specified range
     */
    function paginate(
        EnumerableSet.AddressSet storage _set,
        uint256 _offset,
        uint256 _limit
    ) internal view returns (address[] memory addresses) {
        uint256 total = _set.length();

        if (_offset >= total) {
            return new address[](0);
        }

        uint256 end = _offset + _limit;
        if (end > total) {
            end = total;
        }

        uint256 resultLength = end - _offset;
        addresses = new address[](resultLength);

        for (uint256 i = 0; i < resultLength; i++) {
            addresses[i] = _set.at(_offset + i);
        }
    }

    /**
     * @notice Returns a paginated subset of `uint256` values from an `EnumerableSet`.
     * @param _set `EnumerableSet.UintSet` to paginate
     * @param _offset Starting index
     * @param _limit Maximum number of values to return
     * @return values Array of `uint256` values in the specified range
     */
    function paginate(
        EnumerableSet.UintSet storage _set,
        uint256 _offset,
        uint256 _limit
    ) internal view returns (uint256[] memory values) {
        uint256 total = _set.length();

        if (_offset >= total) {
            return new uint256[](0);
        }

        uint256 end = _offset + _limit;
        if (end > total) {
            end = total;
        }

        uint256 resultLength = end - _offset;
        values = new uint256[](resultLength);

        for (uint256 i = 0; i < resultLength; i++) {
            values[i] = _set.at(_offset + i);
        }
    }
}
