use anchor_lang::prelude::*;

/// The answer is compiled into the build. The program account is the only input, so the accounts
/// struct has the `'info` lifetime Anchor's generated `cpi` module expects.
#[derive(Accounts)]
pub struct GetVersion<'info> {
    pub program: Program<'info, crate::program::PubkeyPolicy>,
}
