#![no_std]

cfg_if::cfg_if! {
    if #[cfg(any(not(feature = "library"), feature = "testutils"))] {
        mod errors;
        mod simple_message_lib;
        mod storage;

        pub use simple_message_lib::{SimpleMessageLib, SimpleMessageLibClient};
    }
}

#[cfg(test)]
mod tests;
