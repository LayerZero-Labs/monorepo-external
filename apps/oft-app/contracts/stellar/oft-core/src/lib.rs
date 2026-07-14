#![no_std]

pub mod events;
pub mod storage;
pub mod utils;

mod codec;
mod errors;
mod oft_core;
mod types;

pub use codec::*;
pub use errors::*;
pub use oft_core::*;
pub use types::*;

#[cfg(test)]
#[path = "../integration-tests/mod.rs"]
mod integration_tests;

#[cfg(test)]
mod tests;
