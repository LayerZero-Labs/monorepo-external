use soroban_sdk::{panic_with_error, Env, Error};

/// Extension trait for `Option<T>` that provides Soroban-specific unwrapping utilities.
///
/// This trait extends the standard `Option` type with methods that integrate with
/// Soroban's error handling system, allowing for more descriptive panics when
/// unwrapping fails.
pub trait OptionExt<T> {
    /// Unwraps the `Option`, returning the contained value if `Some`,
    /// or panics with the provided error if `None`.
    ///
    /// # Arguments
    /// * `env` - The Soroban environment, required for error propagation.
    /// * `error` - The error to emit if the `Option` is `None`. Must be convertible into a `soroban_sdk::Error`.
    ///
    /// # Returns
    /// The contained value if `Some`.
    ///
    /// # Panics
    /// Panics with the specified error if the `Option` is `None`.
    fn unwrap_or_panic<E>(self, env: &Env, error: E) -> T
    where
        E: Into<Error>;
}

impl<T> OptionExt<T> for Option<T> {
    fn unwrap_or_panic<E>(self, env: &Env, error: E) -> T
    where
        E: Into<Error>,
    {
        match self {
            // Return the inner value if present
            Some(val) => val,
            // Panic with the provided error if None, using Soroban's error macro
            None => panic_with_error!(env, error),
        }
    }
}
