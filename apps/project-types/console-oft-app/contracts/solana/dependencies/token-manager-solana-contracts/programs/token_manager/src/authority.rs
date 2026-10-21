//! Native-authority proofs and signer-PDA signing. The root never signs; `invoke_as` signs only as
//! `[SIGNER_SEED, state, kind]` PDAs.
use crate::{errors::TokenManagerError, SignerKind, SIGNER_SEED};
use anchor_lang::{
    prelude::*,
    solana_program::{instruction::Instruction, program::invoke_signed},
};
use spl_token_2022::processor::Processor;

/// Prove control of a native mint/extension authority: a plain signer, a CPI-signing PDA, or a
/// legacy-SPL/T22 native multisig whose member signatures are in `signers`.
pub(crate) fn authorize_native(
    expected: &Pubkey,
    authority: &AccountInfo,
    signers: &[AccountInfo],
) -> Result<()> {
    // Pass T22 as program_id, never this program: validate_owner treats any account owned by
    // program_id with multisig length as a multisig.
    Processor::validate_owner(
        &spl_token_2022_interface::ID,
        expected,
        authority,
        authority.data_len(),
        signers,
    )
    .map_err(|_| error!(TokenManagerError::InvalidAuthority))
}

/// Invokes `ix` signed by `state`'s signer PDAs, given as (kind, bump). This only supplies seeds:
/// callers pin the signer accounts by seeds and the target program by type or address.
pub(crate) fn invoke_as(
    state: &Pubkey,
    signers: &[(SignerKind, u8)],
    ix: &Instruction,
    accounts: &[AccountInfo],
) -> Result<()> {
    let seeds: Vec<[[u8; 1]; 2]> =
        signers.iter().map(|(kind, bump)| [[*kind as u8], [*bump]]).collect();
    let seeds: Vec<[&[u8]; 4]> = seeds
        .iter()
        .map(|[kind, bump]| [SIGNER_SEED, state.as_ref(), &kind[..], &bump[..]])
        .collect();
    let seeds: Vec<&[&[u8]]> = seeds.iter().map(|set| &set[..]).collect();
    invoke_signed(ix, accounts, &seeds)?;
    Ok(())
}

/// Invokes the Token-2022 instruction `build` returns, signed by `kind`'s signer PDA acting as a
/// native authority: the authority itself, or, when `multisig` is given, the signing member of
/// that native multisig. `build` receives the authority and its signers. Token-2022 checks the
/// authority is the mint's and that this one signature meets the multisig's threshold, so only a
/// 1-of-n multisig works.
pub(crate) fn invoke_as_authority<'info>(
    state: &Pubkey,
    kind: SignerKind,
    signer: &AccountInfo<'info>,
    bump: u8,
    multisig: Option<&AccountInfo<'info>>,
    build: impl FnOnce(&Pubkey, &[&Pubkey]) -> std::result::Result<Instruction, ProgramError>,
    mut accounts: Vec<AccountInfo<'info>>,
) -> Result<()> {
    accounts.push(signer.clone());
    let ix = match multisig {
        Some(multisig) => {
            accounts.push(multisig.clone());
            build(multisig.key, &[signer.key])?
        },
        None => build(signer.key, &[])?,
    };
    invoke_as(state, &[(kind, bump)], &ix, &accounts)
}
