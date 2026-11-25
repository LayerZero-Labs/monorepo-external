//! Cargo-tracked program IDs for Solana programs whose address is supplied at build time.
//!
//! `solana_helper::program_id_from_env!` reads the variable inside a proc macro, which cargo's
//! fingerprint cannot observe: a rebuild with a changed value re-emits the previous program ID.
//! `declare_program_id!` pairs that read with an `option_env!` marker, which rustc records as an
//! environment dependency of the calling crate, so cargo rebuilds when the variable changes.
//!
//! ```ignore
//! use anchor_lang::prelude::*;
//! use program_id::declare_program_id;
//!
//! declare_program_id!("OFT_ID", "9UovNrJD8pQyBLheeHNayuG1wJSEAoxkmM14vw5gcsTT");
//! ```
//!
//! No `anchor-lang` dependency: `declare_id!` and `Pubkey` resolve at the call site.

#[doc(hidden)]
pub use solana_helper::program_id_from_env as __program_id_from_env;

/// Declares the program ID from `$var`, falling back to `$default`, and registers `$var` with
/// cargo so that changing it forces a rebuild.
///
/// Expand this in a crate that has `anchor_lang::prelude::*` in scope.
#[macro_export]
macro_rules! declare_program_id {
    ($var:literal, $default:literal) => {
        // Sibling item: this expansion is matched under `cargo expand` to repair the IDL address.
        const _: Option<&str> = option_env!($var);
        declare_id!(Pubkey::new_from_array($crate::__program_id_from_env!($var, $default)));
    };
}

#[cfg(test)]
mod tests {
    use super::__program_id_from_env as program_id_from_env;

    // `const` position: `declare_id!` consumes the bytes in const context.

    #[test]
    fn falls_back_to_the_default_when_the_variable_is_absent() {
        const ID: [u8; 32] = program_id_from_env!(
            "LZ_PROGRAM_ID_ABSENT_IN_TESTS",
            "11111111111111111111111111111111"
        );
        assert_eq!(ID, [0u8; 32]);
    }

    #[test]
    fn decodes_the_default_from_base58() {
        const DEFAULT: &str = "9UovNrJD8pQyBLheeHNayuG1wJSEAoxkmM14vw5gcsTT";
        const ID: [u8; 32] = program_id_from_env!(
            "LZ_PROGRAM_ID_ABSENT_IN_TESTS",
            "9UovNrJD8pQyBLheeHNayuG1wJSEAoxkmM14vw5gcsTT"
        );
        assert_eq!(ID.to_vec(), bs58::decode(DEFAULT).into_vec().unwrap());
    }
}
