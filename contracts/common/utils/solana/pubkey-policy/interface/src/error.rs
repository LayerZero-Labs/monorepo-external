//! Shared policy error codes: the record reader's errors and the blocked/not-blocked outcomes
//! consumers raise.

/// Declares an error enum that starts with the shared policy variants (codes 8000-8004).
///
/// The reader raises its record errors as [`PolicyError`]; consumers raise `Blocked` and
/// `NotBlocked` themselves. Anchor 1.1.2 puts only a program's own error enum in its IDL, never a
/// dependency's, so a consumer declares its local enum through this macro to get the same codes
/// and messages without redefining them. Give the first local variant an explicit code; implicit
/// ones would continue from 8005.
#[macro_export]
macro_rules! declare_policy_errors {
    ($vis:vis enum $name:ident { $($local:tt)* }) => {
        #[anchor_lang::error_code(offset = 0)]
        $vis enum $name {
            #[msg("Not the canonical subject record for this policy")]
            WrongRecord = 8000,
            #[msg("Subject record is not owned by the pubkey policy program")]
            WrongOwner = 8001,
            #[msg("Malformed subject record")]
            InvalidRecord = 8002,
            #[msg("Pubkey is blocked")]
            Blocked = 8003,
            #[msg("Pubkey is not blocked")]
            NotBlocked = 8004,
            $($local)*
        }
    };
}

declare_policy_errors! { pub enum PolicyError {} }
