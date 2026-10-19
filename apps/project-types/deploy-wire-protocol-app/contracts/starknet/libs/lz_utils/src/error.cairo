/// Trait to get the error name for an error code.
/// This trait is intended to be implemented for enum types.
use core::panics::panic_with_byte_array;

pub trait Error<T> {
    fn name(self: T) -> ByteArray;
    fn prefix() -> ByteArray;
}

/// Generic format function that works with any type implementing Error trait
/// ERROR_CODE::MESSAGE
pub fn format_error<T, +Error<T>, +Drop<T>>(error: T, message: ByteArray) -> ByteArray {
    format!("{}_{}::{}", Error::<T>::prefix(), error.name(), message)
}

/// Assert that a condition is true and panic with a byte array error message
pub fn assert_with_byte_array(condition: bool, err: ByteArray) {
    #[allow(manual_assert)]
    if !condition {
        panic_with_byte_array(err: @err)
    }
}
