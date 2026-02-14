use starknet::EthAddress;
use starknet::storage::{StorageMapReadAccess, StoragePointerReadAccess};
use crate::mocks::mock_enumerable_set::{IMockEnumerableSet, MockEnumerableSet};

fn signer1() -> EthAddress {
    Into::<u256, EthAddress>::into(0x9b6ababd080456f900ed64e74d122ff9ca40daa1)
}

fn signer2() -> EthAddress {
    Into::<u256, EthAddress>::into(0xc221797af9445f00b4b0ff2c4853ce7bfb968b07)
}

fn signer3() -> EthAddress {
    Into::<u256, EthAddress>::into(0x1234567890abcdef1234567890abcdef12345678)
}

fn zero_element() -> EthAddress {
    Into::<u256, EthAddress>::into(0)
}

fn enumerable_set_contract_state() -> MockEnumerableSet::ContractState {
    MockEnumerableSet::contract_state_for_testing()
}

fn assert_signer_at_slot_with_count(
    contract: @MockEnumerableSet::ContractState, signer: EthAddress, slot: u32, count: u32,
) {
    assert_eq!(contract.enumerable_set.element_to_slot.read(signer), slot);
    assert_eq!(contract.enumerable_set.slot_to_element.read(slot), signer);
    assert_eq!(contract.contains(signer), true);
    assert_eq!(contract.enumerable_set.count.read(), count);
}

#[test]
fn test_enumerable_set_add() {
    let mut contract = enumerable_set_contract_state();
    contract.add(signer1());
    assert_signer_at_slot_with_count(@contract, signer1(), 1, 1);
}

#[test]
fn test_enumerable_set_add_multiple() {
    let mut contract = enumerable_set_contract_state();
    let signers = array![signer1(), signer2(), signer3()];

    for (i, signer) in signers.into_iter().enumerate() {
        let result = contract.add(signer);
        assert_eq!(result, true);
        assert_signer_at_slot_with_count(@contract, signer, i + 1, i + 1);
    }
}

#[test]
fn test_enumerable_set_add_duplicate() {
    let mut contract = enumerable_set_contract_state();

    // Add element first time
    let result1 = contract.add(signer1());
    assert_eq!(result1, true);
    assert_signer_at_slot_with_count(@contract, signer1(), 1, 1);

    // Try to add same element again
    let result2 = contract.add(signer1());
    assert_eq!(result2, false);
    // Should still be at slot 1 and count 1
    assert_signer_at_slot_with_count(@contract, signer1(), 1, 1);
}

#[test]
fn test_enumerable_set_remove_middle_element() {
    let mut contract = enumerable_set_contract_state();

    // Add elements first
    let signers = array![signer1(), signer2(), signer3()];
    for signer in signers.clone() {
        contract.add(signer);
    }
    assert_eq!(contract.enumerable_set.count.read(), 3);

    // Remove middle element (signer2 at slot 2)
    let result = contract.remove(signer2());
    assert_eq!(result, true);
    assert_eq!(contract.enumerable_set.count.read(), 2);
    assert_eq!(contract.contains(signer2()), false);
    assert_eq!(contract.enumerable_set.element_to_slot.read(signer2()), 0); // Reset to 0

    // Due to swap-and-pop, signer3 (was at slot 3) should now be at slot 2
    assert_signer_at_slot_with_count(@contract, signer3(), 2, 2);

    // signer1 should still be at slot 1
    assert_signer_at_slot_with_count(@contract, signer1(), 1, 2);
}

#[test]
fn test_enumerable_set_remove_last_element() {
    let mut contract = enumerable_set_contract_state();

    // Add elements
    let signers = array![signer1(), signer2(), signer3()];
    for signer in signers.clone() {
        contract.add(signer);
    }

    // Remove last element (signer3 at slot 3)
    let result = contract.remove(signer3());
    assert_eq!(result, true);
    assert_eq!(contract.enumerable_set.count.read(), 2);
    assert_eq!(contract.contains(signer3()), false);
    assert_eq!(contract.enumerable_set.element_to_slot.read(signer3()), 0); // Reset to 0

    // Other elements should remain unchanged
    assert_signer_at_slot_with_count(@contract, signer1(), 1, 2);
    assert_signer_at_slot_with_count(@contract, signer2(), 2, 2);
}

#[test]
fn test_enumerable_set_remove_first_element() {
    let mut contract = enumerable_set_contract_state();

    // Add elements
    let signers = array![signer1(), signer2(), signer3()];
    for signer in signers.clone() {
        contract.add(signer);
    }

    // Remove first element (signer1 at slot 1)
    let result = contract.remove(signer1());
    assert_eq!(result, true);
    assert_eq!(contract.enumerable_set.count.read(), 2);
    assert_eq!(contract.contains(signer1()), false);
    assert_eq!(contract.enumerable_set.element_to_slot.read(signer1()), 0); // Reset to 0

    // The last element (signer3, was at slot 3) should have moved to slot 1
    assert_signer_at_slot_with_count(@contract, signer3(), 1, 2);

    // signer2 should still be at slot 2
    assert_signer_at_slot_with_count(@contract, signer2(), 2, 2);
}

#[test]
fn test_enumerable_set_remove_nonexistent() {
    let mut contract = enumerable_set_contract_state();

    // Add one element
    contract.add(signer1());
    assert_eq!(contract.enumerable_set.count.read(), 1);

    // Try to remove element that doesn't exist
    let result = contract.remove(signer2());
    assert_eq!(result, false);
    assert_signer_at_slot_with_count(@contract, signer1(), 1, 1);
}

#[test]
fn test_enumerable_set_remove_from_empty() {
    let mut contract = enumerable_set_contract_state();

    // Try to remove from empty set
    let result = contract.remove(signer1());
    assert_eq!(result, false);
    assert_eq!(contract.enumerable_set.count.read(), 0);
}

#[test]
fn test_enumerable_set_clear() {
    let mut contract = enumerable_set_contract_state();
    let signers = array![signer1(), signer2(), signer3()];

    // Add multiple elements
    for signer in signers.clone() {
        contract.add(signer);
    }
    assert_eq!(contract.enumerable_set.count.read(), 3);

    // Clear all elements
    contract.clear();
    assert_eq!(contract.enumerable_set.count.read(), 0);

    // Verify all elements are no longer members
    for signer in signers {
        assert_eq!(contract.contains(signer), false);
        assert_eq!(contract.enumerable_set.element_to_slot.read(signer), 0);
    }
}

#[test]
fn test_enumerable_set_single_element_operations() {
    let mut contract = enumerable_set_contract_state();

    // Add single element
    contract.add(signer1());
    assert_eq!(contract.enumerable_set.count.read(), 1);
    assert_eq!(contract.contains(signer1()), true);
    assert_eq!(contract.enumerable_set.element_to_slot.read(signer1()), 1);
    assert_eq!(contract.enumerable_set.slot_to_element.read(1), signer1());

    // Remove single element
    let result = contract.remove(signer1());
    assert_eq!(result, true);
    assert_eq!(contract.enumerable_set.count.read(), 0);
    assert_eq!(contract.contains(signer1()), false);
    assert_eq!(contract.enumerable_set.element_to_slot.read(signer1()), 0);
}

#[test]
fn test_enumerable_set_complex_operations() {
    let mut contract = enumerable_set_contract_state();

    // Add multiple elements
    let signers = array![signer1(), signer2(), signer3()];
    for signer in signers.clone() {
        contract.add(signer);
    }
    assert_eq!(contract.enumerable_set.count.read(), 3);

    // Remove middle one (signer2 at slot 2). signer3 (idx 3) moves to idx 2.
    contract.remove(signer2());
    assert_eq!(contract.contains(signer2()), false);
    assert_eq!(contract.enumerable_set.element_to_slot.read(signer2()), 0);
    assert_signer_at_slot_with_count(@contract, signer3(), 2, 2);

    // Add it back - signer2 should get the next available slot (3)
    contract.add(signer2());
    assert_eq!(contract.contains(signer2()), true);
    assert_signer_at_slot_with_count(@contract, signer2(), 3, 3);

    // Verify all elements are present and at their correct current indices
    assert_signer_at_slot_with_count(@contract, signer1(), 1, 3);
    assert_signer_at_slot_with_count(@contract, signer3(), 2, 3);
    assert_signer_at_slot_with_count(@contract, signer2(), 3, 3);
}

#[test]
fn test_enumerable_set_contains() {
    let mut contract = enumerable_set_contract_state();

    // Initially empty - should not contain any element
    assert_eq!(contract.contains(signer1()), false);
    assert_eq!(contract.enumerable_set.element_to_slot.read(signer1()), 0);

    // Add element
    contract.add(signer1());
    assert_eq!(contract.contains(signer1()), true);
    assert_eq!(contract.enumerable_set.element_to_slot.read(signer1()), 1);

    // Should not contain other elements
    assert_eq!(contract.contains(signer2()), false);
    assert_eq!(contract.enumerable_set.element_to_slot.read(signer2()), 0);

    // Remove element
    contract.remove(signer1());
    assert_eq!(contract.contains(signer1()), false);
    assert_eq!(contract.enumerable_set.element_to_slot.read(signer1()), 0);
}


#[test]
fn test_enumerable_set_values() {
    let mut contract = enumerable_set_contract_state();

    // Initially empty
    let elements = contract.values();
    assert_eq!(elements.len(), 0);
    assert_eq!(contract.enumerable_set.count.read(), 0);

    // Add one element
    contract.add(signer1());
    let elements = contract.values();
    assert_eq!(elements.len(), 1);
    assert_eq!(*elements[0], signer1()); // values() returns 0-sloted array
    assert_eq!(contract.enumerable_set.slot_to_element.read(1), signer1()); // storage is 1-sloted

    // Add more elements
    contract.add(signer2());
    contract.add(signer3());
    let elements = contract.values();
    assert_eq!(elements.len(), 3);
    assert_eq!(*elements[0], signer1());
    assert_eq!(*elements[1], signer2());
    assert_eq!(*elements[2], signer3());

    // Verify against storage (1-sloted)
    assert_eq!(contract.enumerable_set.slot_to_element.read(1), signer1());
    assert_eq!(contract.enumerable_set.slot_to_element.read(2), signer2());
    assert_eq!(contract.enumerable_set.slot_to_element.read(3), signer3());
}

#[test]
fn test_enumerable_set_values_after_removal() {
    let mut contract = enumerable_set_contract_state();

    // Add elements
    let signers = array![signer1(), signer2(), signer3()];
    for signer in signers.clone() {
        contract.add(signer);
    }

    // Remove middle element (signer2 from slot 2)
    // signer3 (from slot 3) moves to slot 2
    contract.remove(signer2());

    // Get all should return remaining elements
    let elements = contract.values();
    assert_eq!(elements.len(), 2);

    // Due to swap-and-pop, order is signer1, then signer3
    assert_eq!(*elements[0], signer1());
    assert_eq!(*elements[1], signer3());

    // Verify against storage (1-sloted)
    assert_signer_at_slot_with_count(@contract, signer1(), 1, 2);
    assert_signer_at_slot_with_count(@contract, signer3(), 2, 2);
}

#[test]
fn test_enumerable_set_read_functions_consistency() {
    let mut contract = enumerable_set_contract_state();

    // Add elements
    let signers = array![signer1(), signer2(), signer3()];
    for signer in signers.clone() {
        contract.add(signer);
    }

    // Test consistency between different read methods
    let length = contract.length(); // Should be 3
    let count = contract.enumerable_set.count.read(); // Should be 3
    let elements_array = contract.values(); // 0-sloted array: [s1, s2, s3]
    let is_empty = contract.is_empty();

    assert_eq!(length, count);
    assert_eq!(length, elements_array.len());
    assert_eq!(is_empty, length == 0);

    // Test each element is accessible by slot and contained in set
    // Loop uses 0-based slot for the array, but 1-based for storage access
    for i_zero_based in 0..length {
        let one_based_slot = i_zero_based + 1;
        let element_from_values = *elements_array[i_zero_based];
        let element_by_storage_slot = contract.enumerable_set.slot_to_element.read(one_based_slot);

        assert_eq!(element_by_storage_slot, element_from_values);
        assert_eq!(contract.contains(element_by_storage_slot), true);
        assert_eq!(
            contract.enumerable_set.element_to_slot.read(element_by_storage_slot), one_based_slot,
        );
    }
}

#[test]
fn test_get_by_index() {
    let mut contract = enumerable_set_contract_state();

    // Add elements
    let signers = array![signer1(), signer2(), signer3()];
    for signer in signers.clone() {
        contract.add(signer);
    }

    // Get elements by index
    assert_eq!(contract.at(0), signer1());
    assert_eq!(contract.at(1), signer2());
    assert_eq!(contract.at(2), signer3());
}

#[test]
#[should_panic]
fn test_get_by_index_out_of_bounds() {
    let mut contract = enumerable_set_contract_state();

    // Add elements
    let signers = array![signer1(), signer2(), signer3()];
    for signer in signers.clone() {
        contract.add(signer);
    }

    // Try to get element at index 3 (out of bounds)
    assert_eq!(contract.at(3), signer1());
}
