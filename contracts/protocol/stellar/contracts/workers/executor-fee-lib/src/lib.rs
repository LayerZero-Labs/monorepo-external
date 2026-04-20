#![no_std]

pub mod executor_option;

mod errors;

pub use errors::*;

cfg_if::cfg_if! {
    // Include implementation when NOT in library mode, OR when testutils is enabled (for tests)
    if #[cfg(any(not(feature = "library"), feature = "testutils"))] {
        mod executor_fee_lib;
        // Export the contract and client for testing purposes
        pub use executor_fee_lib::{ExecutorFeeLib, ExecutorFeeLibClient};
    }
}

#[cfg(test)]
mod tests;
