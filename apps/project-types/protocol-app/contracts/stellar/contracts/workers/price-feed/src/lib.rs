#![no_std]

pub mod events;
pub mod types;

mod errors;
pub use errors::*;

cfg_if::cfg_if! {
    // Include implementation when NOT in library mode, OR when testutils is enabled (for tests)
    if #[cfg(any(not(feature = "library"), feature = "testutils"))] {
        mod storage;
        mod price_feed;
        // Export the contract and client for testing purposes
        pub use price_feed::{LzPriceFeed, LzPriceFeedClient};
    }
}

#[cfg(test)]
mod tests;
