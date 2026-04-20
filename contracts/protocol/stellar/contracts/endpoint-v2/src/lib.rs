#![no_std]

pub mod events;
pub mod util;

mod errors;
mod interfaces;

pub use errors::*;
pub use interfaces::*;

cfg_if::cfg_if! {
    // Include implementation when NOT in library mode, OR when testutils is enabled (for tests)
    if #[cfg(any(not(feature = "library"), feature = "testutils"))] {
        mod endpoint_v2;
        mod storage;
        // Export the contract and client for testing purposes
        pub use endpoint_v2::{EndpointV2, EndpointV2Client};
    }
}

#[cfg(test)]
mod tests;
