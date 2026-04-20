#![no_std]

pub mod events;

mod errors;
mod interfaces;

pub use errors::*;
pub use interfaces::*;

cfg_if::cfg_if! {
    if #[cfg(any(not(feature = "library"), feature = "testutils"))] {
        mod storage;
        mod dvn;

        pub use dvn::{LzDVN, LzDVNClient};
    }
}

#[cfg(test)]
extern crate std;

#[cfg(test)]
mod tests;
