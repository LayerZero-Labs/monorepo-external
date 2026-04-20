#![no_std]

mod extensions;
mod interfaces;
mod oft_types;

pub use extensions::*;
pub use interfaces::*;
pub use oft_types::*;

cfg_if::cfg_if! {
    // Include implementation when NOT in library mode, OR when testutils is enabled (for tests)
    if #[cfg(any(not(feature = "library"), feature = "testutils"))] {
        mod oft;
        pub use oft::*;
    }
}

#[cfg(test)]
#[path = "../integration-tests/mod.rs"]
pub mod integration_tests;

#[cfg(test)]
mod tests;
