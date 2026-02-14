use core::hash::Hash;
use core::num::traits::Zero;
use core::pedersen::HashState;
use starknet::storage::{
    Map, Mutable, StorageMapReadAccess, StorageMapWriteAccess, StoragePath,
    StoragePointerReadAccess, StoragePointerWriteAccess,
};

/// `EnumerableSet` struct for managing a set of values with efficient
/// add, remove, lookup and list operations
#[starknet::storage_node]
pub struct EnumerableSet<T, +starknet::Store<T>, +Hash<T, HashState>> {
    pub count: u32,
    // slot(1-based index) to element
    pub slot_to_element: Map<u32, T>,
    // element to slot(1-based index)
    pub element_to_slot: Map<T, u32>,
}

#[generate_trait]
pub impl EnumerableSetImpl<
    T, +starknet::Store<T>, +Hash<T, HashState>, +PartialEq<T>, +Drop<T>, +Zero<T>, +Copy<T>,
> of EnumerableSetTrait<T> {
    /// Adds an element to the set. Returns true if the element was added,
    /// false if it was already present
    fn add(self: StoragePath<Mutable<EnumerableSet<T>>>, element: T) -> bool {
        if self.contains_mut(element) {
            return false;
        }

        let slot = self.count.read() + 1;
        self.slot_to_element.write(slot, element);
        self.element_to_slot.write(element, slot);
        self.count.write(slot);

        true
    }

    /// Removes an element from the set. Returns true if the element was removed,
    /// false if it wasn't present
    fn remove(self: StoragePath<Mutable<EnumerableSet<T>>>, element: T) -> bool {
        // Check if exists
        if !self.contains_mut(element) {
            return false;
        }

        let last_slot = self.count.read();
        let slot = self.element_to_slot.read(element);

        if slot != last_slot {
            // Swap element to remove with the last element
            let last_element = self.slot_to_element.read(last_slot);
            self.element_to_slot.write(last_element, slot);
            self.slot_to_element.write(slot, last_element);
        }

        // Remove the element
        self.element_to_slot.write(element, 0);
        self.slot_to_element.write(last_slot, Zero::zero());
        self.count.write(last_slot - 1);

        true
    }

    // Mutable storage function so we can use it in mutable functions
    fn contains_mut(self: StoragePath<Mutable<EnumerableSet<T>>>, element: T) -> bool {
        self.element_to_slot.read(element) != 0
    }

    /// Checks if an element is in the set
    fn contains(self: StoragePath<EnumerableSet<T>>, element: T) -> bool {
        self.element_to_slot.read(element) != 0
    }

    /// Returns the total number of elements in the set
    fn length(self: StoragePath<EnumerableSet<T>>) -> u32 {
        self.count.read()
    }

    /// Returns all elements in the set as an array
    /// WARNING: This assumes the count of entries is bounded. If it is unbounded, use at(i) to
    /// manually paginate
    fn values(self: StoragePath<EnumerableSet<T>>) -> Array<T> {
        let mut elements: Array<T> = array![];
        let count = self.count.read();

        for i in 1..=count {
            let element = self.slot_to_element.read(i);
            elements.append(element);
        }

        elements
    }

    /// Checks if the set is empty
    fn is_empty(self: StoragePath<EnumerableSet<T>>) -> bool {
        self.count.read() == 0
    }

    /// Clears all elements from the set
    /// WARNING: This assumes the count of entries is bounded
    fn clear(self: StoragePath<Mutable<EnumerableSet<T>>>) {
        let count = self.count.read();

        for i in 1..=count {
            let element = self.slot_to_element.read(i);
            self.element_to_slot.write(element, 0);
            self.slot_to_element.write(i, Zero::zero());
        }

        self.count.write(0);
    }

    fn at(self: StoragePath<EnumerableSet<T>>, index: u32) -> T {
        assert!(index < self.count.read(), "Index out of bounds");
        self.slot_to_element.read(index + 1)
    }
}
