// SPDX-License-Identifier: MIT
pragma solidity ^0.8.22;

import { EnumerableSet } from "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";
import { Test } from "forge-std/Test.sol";
import { EnumerableSetPagination } from "./../contracts/libs/EnumerableSetPagination.sol";

contract AddressPaginationHarness {
    using EnumerableSet for EnumerableSet.AddressSet;
    using EnumerableSetPagination for EnumerableSet.AddressSet;

    EnumerableSet.AddressSet set;

    function add(address _addr) external {
        set.add(_addr);
    }
    function remove(address _addr) external {
        set.remove(_addr);
    }
    function length() external view returns (uint256) {
        return set.length();
    }
    function paginate(uint256 _offset, uint256 _limit) external view returns (address[] memory) {
        return set.paginate(_offset, _limit);
    }
}

contract UintPaginationHarness {
    using EnumerableSet for EnumerableSet.UintSet;
    using EnumerableSetPagination for EnumerableSet.UintSet;

    EnumerableSet.UintSet set;

    function add(uint256 _val) external {
        set.add(_val);
    }
    function remove(uint256 _val) external {
        set.remove(_val);
    }
    function length() external view returns (uint256) {
        return set.length();
    }
    function paginate(uint256 _offset, uint256 _limit) external view returns (uint256[] memory) {
        return set.paginate(_offset, _limit);
    }
}

contract EnumerableSetPaginationTest is Test {
    using EnumerableSet for EnumerableSet.AddressSet;
    using EnumerableSet for EnumerableSet.UintSet;
    using EnumerableSetPagination for EnumerableSet.AddressSet;
    using EnumerableSetPagination for EnumerableSet.UintSet;

    AddressPaginationHarness addrHarness;
    UintPaginationHarness uintHarness;

    EnumerableSet.AddressSet addrSet;
    EnumerableSet.UintSet uintSet;

    uint256 constant SET_SIZE = 1_000;

    function setUp() public {
        addrHarness = new AddressPaginationHarness();
        uintHarness = new UintPaginationHarness();

        for (uint256 i = 1; i <= SET_SIZE; i++) {
            addrHarness.add(address(uint160(i)));
            addrSet.add(address(uint160(i)));
            uintHarness.add(i);
            uintSet.add(i);
        }
    }

    // ============ AddressSet — Empty / Single ============

    function test_address_paginate_EmptySet() public {
        AddressPaginationHarness empty = new AddressPaginationHarness();
        assertEq(empty.paginate(0, 10).length, 0);
    }

    function test_address_paginate_SingleElement() public {
        AddressPaginationHarness single = new AddressPaginationHarness();
        single.add(address(0xBEEF));
        address[] memory result = single.paginate(0, 100);
        assertEq(result.length, 1);
        assertEq(result[0], address(0xBEEF));
    }

    // ============ AddressSet — Offset ============

    function test_address_paginate_OffsetZero() public {
        address[] memory result = addrHarness.paginate(0, 10);
        assertEq(result.length, 10);
        for (uint256 i = 0; i < 10; i++) {
            assertEq(result[i], address(uint160(i + 1)));
        }
    }

    function test_address_paginate_MiddleOffset() public {
        address[] memory result = addrHarness.paginate(500, 10);
        assertEq(result.length, 10);
        for (uint256 i = 0; i < 10; i++) {
            assertEq(result[i], address(uint160(501 + i)));
        }
    }

    function test_address_paginate_OffsetAtEnd() public {
        address[] memory result = addrHarness.paginate(SET_SIZE - 1, 100);
        assertEq(result.length, 1);
        assertEq(result[0], address(uint160(SET_SIZE)));
    }

    function test_address_paginate_OffsetBeyondEnd() public {
        assertEq(addrHarness.paginate(SET_SIZE, 10).length, 0);
        assertEq(addrHarness.paginate(SET_SIZE + 1000, 10).length, 0);
    }

    // ============ AddressSet — Limit ============

    function test_address_paginate_LimitZero() public {
        assertEq(addrHarness.paginate(0, 0).length, 0);
    }

    function test_address_paginate_LimitOne() public {
        address[] memory result = addrHarness.paginate(0, 1);
        assertEq(result.length, 1);
        assertEq(result[0], address(uint160(1)));
    }

    function test_address_paginate_LimitExceedsRemaining() public {
        address[] memory result = addrHarness.paginate(SET_SIZE - 5, 100);
        assertEq(result.length, 5);
    }

    function test_address_paginate_LimitExceedsTotal() public {
        assertEq(addrHarness.paginate(0, SET_SIZE + 50).length, SET_SIZE);
    }

    function test_address_paginate_MaxUint256Limit() public {
        assertEq(addrHarness.paginate(0, type(uint256).max).length, SET_SIZE);
    }

    // ============ AddressSet — Multi-Page ============

    function test_address_paginate_SequentialPagesCompleteSet() public {
        uint256 pageSize = 137;
        uint256 collected;

        for (uint256 offset = 0; offset < SET_SIZE; offset += pageSize) {
            address[] memory page = addrHarness.paginate(offset, pageSize);
            collected += page.length;

            for (uint256 i = 0; i < page.length; i++) {
                assertEq(page[i], address(uint160(offset + i + 1)));
            }
        }

        assertEq(collected, SET_SIZE);
    }

    // ============ AddressSet — Dynamic (add/remove) ============

    function test_address_paginate_AfterRemovingElements() public {
        AddressPaginationHarness h = new AddressPaginationHarness();
        for (uint256 i = 1; i <= 20; i++) h.add(address(uint160(i)));

        h.remove(address(uint160(5)));
        h.remove(address(uint160(10)));
        h.remove(address(uint160(15)));

        address[] memory result = h.paginate(0, 100);
        assertEq(result.length, 17);

        for (uint256 i = 0; i < result.length; i++) {
            assertTrue(result[i] != address(uint160(5)));
            assertTrue(result[i] != address(uint160(10)));
            assertTrue(result[i] != address(uint160(15)));
        }
    }

    // ============ AddressSet — Fuzz ============

    function test_address_paginate_Fuzz(uint256 _offset, uint256 _limit) public view {
        _offset = bound(_offset, 0, SET_SIZE * 2);
        _limit = bound(_limit, 0, SET_SIZE * 2);

        address[] memory result = addrSet.paginate(_offset, _limit);

        if (_offset >= SET_SIZE) {
            assertEq(result.length, 0);
        } else {
            uint256 expected = _offset + _limit > SET_SIZE ? SET_SIZE - _offset : _limit;
            assertEq(result.length, expected);
            for (uint256 i = 0; i < result.length; i++) {
                assertEq(result[i], address(uint160(_offset + i + 1)));
            }
        }
    }

    function test_address_paginate_VaryingSize_Fuzz(uint8 _size, uint256 _offset, uint256 _limit) public {
        EnumerableSet.AddressSet storage s = addrSet;
        while (s.length() > 0) s.remove(s.at(0));

        uint256 size = uint256(_size);
        _offset = bound(_offset, 0, size + 50);
        _limit = bound(_limit, 0, 300);

        for (uint256 i = 0; i < size; i++) s.add(address(uint160(i + 1000)));

        address[] memory result = s.paginate(_offset, _limit);

        if (size == 0 || _offset >= size) {
            assertEq(result.length, 0);
        } else {
            uint256 remaining = size - _offset;
            assertEq(result.length, remaining < _limit ? remaining : _limit);
        }
    }

    // ============ AddressSet — Properties ============

    function test_address_property_ReturnedLengthNeverExceedsLimit() public view {
        for (uint256 limit = 1; limit <= 50; limit++) {
            for (uint256 offset = 0; offset < SET_SIZE; offset += 2000) {
                assertLe(addrSet.paginate(offset, limit).length, limit);
            }
        }
    }

    function test_address_property_ConsecutivePagesNoOverlap() public view {
        uint256 pageSize = 1337;
        for (uint256 offset = 0; offset + pageSize < SET_SIZE; offset += pageSize) {
            address[] memory p1 = addrSet.paginate(offset, pageSize);
            address[] memory p2 = addrSet.paginate(offset + pageSize, pageSize);
            if (p1.length > 0 && p2.length > 0) {
                assertTrue(p1[p1.length - 1] != p2[0]);
            }
        }
    }

    // ============ UintSet — Empty / Single ============

    function test_uint_paginate_EmptySet() public {
        UintPaginationHarness empty = new UintPaginationHarness();
        assertEq(empty.paginate(0, 10).length, 0);
    }

    function test_uint_paginate_SingleElement() public {
        UintPaginationHarness single = new UintPaginationHarness();
        single.add(42);
        uint256[] memory result = single.paginate(0, 100);
        assertEq(result.length, 1);
        assertEq(result[0], 42);
    }

    // ============ UintSet — Offset ============

    function test_uint_paginate_OffsetZero() public {
        uint256[] memory result = uintHarness.paginate(0, 10);
        assertEq(result.length, 10);
        for (uint256 i = 0; i < 10; i++) {
            assertEq(result[i], i + 1);
        }
    }

    function test_uint_paginate_MiddleOffset() public {
        uint256[] memory result = uintHarness.paginate(500, 10);
        assertEq(result.length, 10);
        for (uint256 i = 0; i < 10; i++) {
            assertEq(result[i], 501 + i);
        }
    }

    function test_uint_paginate_OffsetAtEnd() public {
        uint256[] memory result = uintHarness.paginate(SET_SIZE - 1, 100);
        assertEq(result.length, 1);
        assertEq(result[0], SET_SIZE);
    }

    function test_uint_paginate_OffsetBeyondEnd() public {
        assertEq(uintHarness.paginate(SET_SIZE, 10).length, 0);
        assertEq(uintHarness.paginate(SET_SIZE + 1000, 10).length, 0);
    }

    // ============ UintSet — Limit ============

    function test_uint_paginate_LimitZero() public {
        assertEq(uintHarness.paginate(0, 0).length, 0);
    }

    function test_uint_paginate_LimitOne() public {
        uint256[] memory result = uintHarness.paginate(0, 1);
        assertEq(result.length, 1);
        assertEq(result[0], 1);
    }

    function test_uint_paginate_LimitExceedsRemaining() public {
        uint256[] memory result = uintHarness.paginate(SET_SIZE - 5, 100);
        assertEq(result.length, 5);
    }

    function test_uint_paginate_LimitExceedsTotal() public {
        assertEq(uintHarness.paginate(0, SET_SIZE + 50).length, SET_SIZE);
    }

    function test_uint_paginate_MaxUint256Limit() public {
        assertEq(uintHarness.paginate(0, type(uint256).max).length, SET_SIZE);
    }

    // ============ UintSet — Multi-Page ============

    function test_uint_paginate_SequentialPagesCompleteSet() public {
        uint256 pageSize = 137;
        uint256 collected;

        for (uint256 offset = 0; offset < SET_SIZE; offset += pageSize) {
            uint256[] memory page = uintHarness.paginate(offset, pageSize);
            collected += page.length;

            for (uint256 i = 0; i < page.length; i++) {
                assertEq(page[i], offset + i + 1);
            }
        }

        assertEq(collected, SET_SIZE);
    }

    // ============ UintSet — Dynamic (add/remove) ============

    function test_uint_paginate_AfterRemovingElements() public {
        UintPaginationHarness h = new UintPaginationHarness();
        for (uint256 i = 1; i <= 20; i++) h.add(i);

        h.remove(5);
        h.remove(10);
        h.remove(15);

        uint256[] memory result = h.paginate(0, 100);
        assertEq(result.length, 17);

        for (uint256 i = 0; i < result.length; i++) {
            assertTrue(result[i] != 5);
            assertTrue(result[i] != 10);
            assertTrue(result[i] != 15);
        }
    }

    // ============ UintSet — Fuzz ============

    function test_uint_paginate_Fuzz(uint256 _offset, uint256 _limit) public view {
        _offset = bound(_offset, 0, SET_SIZE * 2);
        _limit = bound(_limit, 0, SET_SIZE * 2);

        uint256[] memory result = uintSet.paginate(_offset, _limit);

        if (_offset >= SET_SIZE) {
            assertEq(result.length, 0);
        } else {
            uint256 expected = _offset + _limit > SET_SIZE ? SET_SIZE - _offset : _limit;
            assertEq(result.length, expected);
            for (uint256 i = 0; i < result.length; i++) {
                assertEq(result[i], _offset + i + 1);
            }
        }
    }

    function test_uint_paginate_VaryingSize_Fuzz(uint8 _size, uint256 _offset, uint256 _limit) public {
        EnumerableSet.UintSet storage s = uintSet;
        while (s.length() > 0) s.remove(s.at(0));

        uint256 size = uint256(_size);
        _offset = bound(_offset, 0, size + 50);
        _limit = bound(_limit, 0, 300);

        for (uint256 i = 0; i < size; i++) s.add(i + 1000);

        uint256[] memory result = s.paginate(_offset, _limit);

        if (size == 0 || _offset >= size) {
            assertEq(result.length, 0);
        } else {
            uint256 remaining = size - _offset;
            assertEq(result.length, remaining < _limit ? remaining : _limit);
        }
    }

    // ============ UintSet — Properties ============

    function test_uint_property_ReturnedLengthNeverExceedsLimit() public view {
        for (uint256 limit = 1; limit <= 50; limit++) {
            for (uint256 offset = 0; offset < SET_SIZE; offset += 2000) {
                assertLe(uintSet.paginate(offset, limit).length, limit);
            }
        }
    }

    function test_uint_property_ConsecutivePagesNoOverlap() public view {
        uint256 pageSize = 137;
        for (uint256 offset = 0; offset + pageSize < SET_SIZE; offset += pageSize) {
            uint256[] memory p1 = uintSet.paginate(offset, pageSize);
            uint256[] memory p2 = uintSet.paginate(offset + pageSize, pageSize);
            if (p1.length > 0 && p2.length > 0) {
                assertTrue(p1[p1.length - 1] != p2[0]);
            }
        }
    }

    // ============ Large Set (10,000 items) ============

    function test_address_paginate_LargeSet() public {
        AddressPaginationHarness large = new AddressPaginationHarness();
        uint256 size = 10_000;
        for (uint256 i = 1; i <= size; i++) large.add(address(uint160(i)));

        assertEq(large.length(), size);
        assertEq(large.paginate(0, 50).length, 50);
        assertEq(large.paginate(9990, 50).length, 10);
        assertEq(large.paginate(size, 10).length, 0);

        uint256 collected;
        uint256 pageSize = 500;
        for (uint256 offset = 0; offset < size; offset += pageSize) {
            collected += large.paginate(offset, pageSize).length;
        }
        assertEq(collected, size);
    }

    function test_uint_paginate_LargeSet() public {
        UintPaginationHarness large = new UintPaginationHarness();
        uint256 size = 10_000;
        for (uint256 i = 1; i <= size; i++) large.add(i);

        assertEq(large.length(), size);
        assertEq(large.paginate(0, 50).length, 50);
        assertEq(large.paginate(9990, 50).length, 10);
        assertEq(large.paginate(size, 10).length, 0);

        uint256 collected;
        uint256 pageSize = 500;
        for (uint256 offset = 0; offset < size; offset += pageSize) {
            collected += large.paginate(offset, pageSize).length;
        }
        assertEq(collected, size);
    }
}
