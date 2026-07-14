#![no_std]

mod interfaces;

pub use interfaces::{SACAdminWrapper, SACAdminWrapperClient};

cfg_if::cfg_if! {
    // Include implementation when NOT in library mode, OR when testutils is enabled (for tests)
    if #[cfg(any(not(feature = "library"), feature = "testutils"))] {
        mod storage;
        mod sac_manager;

        // Export the contract and client for testing purposes
        pub use sac_manager::{SACManager, SACManagerClient};
    }
}

#[cfg(test)]
mod tests;
