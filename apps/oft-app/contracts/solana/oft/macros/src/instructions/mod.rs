mod oft_type;
mod quote_oft;
mod quote_send;
mod send;
mod shared_decimals;
mod token;

use anchor_trait::declare_instructions;

/// OFT codegen context type used to bind `InstructionSpec` and `InstructionSet`.
///
/// The current OFT instruction specs do not read shared context data, so this
/// remains empty until a generated instruction needs domain-specific inputs.
pub(crate) struct CodegenContext {}

declare_instructions! {
    name    = OftInstructionSet;
    context = CodegenContext;

    OftType                  => oft_type,
    Token                    => token,
    SharedDecimals           => shared_decimals,
    QuoteOft                 => quote_oft,
    QuoteSend                => quote_send,
    Send                     => send,
}
