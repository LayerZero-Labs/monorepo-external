#![no_std]

pub mod events;

mod errors;
mod interfaces;

pub use errors::*;
pub use interfaces::*;

cfg_if::cfg_if! {
    // Include implementation when NOT in library mode, OR when testutils is enabled (for tests)
    if #[cfg(any(not(feature = "library"), feature = "testutils"))] {
        mod storage;
        mod treasury;
        pub use treasury::{Treasury, TreasuryClient};
    }
}

#[cfg(test)]
mod tests;
