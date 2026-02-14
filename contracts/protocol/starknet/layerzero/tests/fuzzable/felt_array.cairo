//! Fuzzable felt252 array

use snforge_std::fuzzable::{Fuzzable, FuzzableU32};

/// Generate a random felt252 array - max length 100
pub(crate) impl FuzzableFelt252Array of Fuzzable<Array<felt252>> {
    fn generate() -> Array<felt252> {
        const MAX_LENGTH: usize = 100;
        let length = FuzzableU32::generate() % MAX_LENGTH;
        let mut array = array![];

        for _ in 0..length {
            array.append(Fuzzable::generate());
        }

        array
    }

    fn blank() -> Array<felt252> {
        array![]
    }
}

// A wrapper type around an array of felt252 to help fuzzer argument parsing
#[derive(Drop, Serde, Debug, PartialEq, Clone, Default)]
pub(crate) struct Felt252ArrayList {
    pub arr: Array<felt252>,
}

pub(crate) impl FuzzableFelt252ArrayList of Fuzzable<Felt252ArrayList> {
    fn blank() -> Felt252ArrayList {
        Default::default()
    }

    fn generate() -> Felt252ArrayList {
        Felt252ArrayList { arr: FuzzableFelt252Array::generate() }
    }
}
