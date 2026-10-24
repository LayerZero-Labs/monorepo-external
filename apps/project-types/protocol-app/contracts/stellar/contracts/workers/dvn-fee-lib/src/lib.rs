#![no_std]

mod errors;

pub use errors::*;

cfg_if::cfg_if! {
    // Include implementation when NOT in library mode, OR when testutils is enabled (for tests)
    if #[cfg(any(not(feature = "library"), feature = "testutils"))] {
        mod dvn_fee_lib;
        // Export the contract and client for testing purposes
        pub use dvn_fee_lib::{DvnFeeLib, DvnFeeLibClient};
    }
}

// Re-export test helpers module for integration tests
#[cfg(test)]
use dvn_fee_lib::test;

#[cfg(test)]
extern crate std;
#[cfg(test)]
mod tests;
